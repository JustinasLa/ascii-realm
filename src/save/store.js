// The storage side of one world's saves. It reads and writes the realm and
// edits records (`format.js`) and decides whether this page may write them.
//
// One tab writes a world at a time. The writer holds the world's Web Lock for
// the life of the page; any other tab reads only. Every write is also
// compare-and-set on `rev`: it goes through only when the stored record is
// the one this page last wrote or claimed, so a page never writes over a save
// it hasn't seen. Without Web Locks that check is the only guard, and two
// tabs writing at the same instant can still both pass it.
//
// `writer` is 'pending' until `ready` resolves, then 'writer', or 'other-tab'
// when another tab holds the lock. Hiding the page (`pagehide`) runs `onHide`
// and lets the lock go ('released'). A page brought back from the
// back/forward cache asks again, and turns 'stale' when another tab saved
// meanwhile, until `claim()`. Nothing here throws: refusals come back as
// reasons.

import { corruptKey, editsKey, readRecord, realmKey, SAVE_FEATURES, serialize, worldIdOf } from './format.js';

const KINDS = ['realm', 'edits'];

// A full or over-quota storage, as each browser reports it.
export const isQuota = (error) => ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name)
  || error?.code === 22 || error?.code === 1014;

export class SaveStore {
  // `events` is the window, to hear other tabs save and the page hide or come
  // back; `locks` is `navigator.locks`.
  constructor({ storage, world, events = null, locks = globalThis.navigator?.locks ?? null, now = () => Date.now() } = {}) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
    }
    this.storage = storage;
    this.world = world;
    this.keys = { realm: realmKey(worldIdOf(world)), edits: editsKey(worldIdOf(world)) };
    this.locks = locks;
    this.now = now;
    // The `rev` this page last wrote or claimed, per kind.
    this.ownRev = { realm: null, edits: null };
    // 'newer' or 'newer-features' once a record this build mustn't replace is read.
    this.readOnly = null;
    this.pausedBy = null;
    // Set when another tab saves this world; `onForeign` runs then.
    this.foreign = false;
    this.onForeign = null;
    this.onHide = null;
    // The realm record in play: the one `claim()` read, or one the page began
    // for its first save, kept even when that save is refused; null before.
    this.realm = null;
    this.quarantined = {};
    this.unlock = null;
    // Raised by `release()`, so a lock request still out then lets the lock go.
    this.epoch = 0;
    this.writer = 'pending';
    this.ready = this.#request((held) => held ? 'writer' : 'other-tab');
    events?.addEventListener('storage', (event) => {
      if (event.key !== this.keys.realm && event.key !== this.keys.edits) return;
      this.foreign = true;
      this.onForeign?.();
    });
    events?.addEventListener('pagehide', () => {
      try { this.onHide?.(); } finally { this.release(); }
    });
    events?.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      this.writer = 'pending';
      this.ready = this.#request((held) => !held ? 'other-tab' : this.#moved() ? 'stale' : 'writer');
    });
  }

  get paused() { return this.pausedBy !== null; }

  // Stops writes for the rest of the page.
  pause(reason) { this.pausedBy = reason; }

  // Lets the world's lock go, so another tab can take it.
  release() {
    this.unlock?.();
    this.unlock = null;
    this.writer = 'released';
    this.epoch++;
  }

  // Asks for the lock without waiting for it, then sets `writer` to what
  // `settle(held)` says. Resolves to the new state.
  #request(settle) {
    const epoch = this.epoch;
    const state = (held) => epoch === this.epoch ? (this.writer = settle(held)) : this.writer;
    if (!this.locks) return Promise.resolve(state(true));
    return new Promise((resolve) => {
      let settled = false;
      const done = (held) => {
        if (!settled) resolve(state(held));
        settled = true;
      };
      Promise.resolve()
        .then(() => this.locks.request(this.keys.realm, { mode: 'exclusive', ifAvailable: true }, (lock) => {
          done(!!lock);
          if (lock && epoch === this.epoch) return new Promise((free) => { this.unlock = free; });
        }))
        // A browser that refuses locks falls back to the `rev` check alone.
        .catch(() => done(true));
    });
  }

  // The stored text, or undefined when storage can't be read.
  #raw(kind) {
    try {
      return this.storage.getItem(this.keys[kind]);
    } catch {
      return undefined;
    }
  }

  // The stored `rev`: null with no record, 0 when it has none readable.
  #rev(raw) {
    if (raw == null) return null;
    try {
      const { rev } = JSON.parse(raw);
      return Number.isSafeInteger(rev) && rev >= 0 ? rev : 0;
    } catch {
      return 0;
    }
  }

  // Whether another tab saved since this page last wrote or claimed.
  #moved() {
    return KINDS.some((kind) => this.ownRev[kind] !== null && this.#rev(this.#raw(kind)) !== this.ownRev[kind]);
  }

  // `{ status, record, repaired, newerFeatures }` (see `readRecord`), or
  // status 'unavailable'. A corrupt text is first copied aside; a newer one
  // makes the store read-only. Reading never makes this page the owner.
  read(kind = 'realm', raw = this.#raw(kind)) {
    if (raw === undefined) return { status: 'unavailable', record: null, repaired: 0, newerFeatures: false };
    const result = readRecord(raw, kind, this.world);
    if (result.status === 'corrupt' && this.quarantined[kind] !== raw) {
      try {
        this.storage.setItem(corruptKey(this.keys[kind]), raw);
        this.quarantined[kind] = raw;
      } catch { /* kept in place; the next read tries again */ }
    }
    if (result.status === 'newer') this.readOnly = 'newer';
    else if (result.newerFeatures) this.readOnly ??= 'newer-features';
    return result;
  }

  // Makes this page the world's writer: takes the lock when it lacks it, reads
  // both records, keeps the realm as `this.realm` and adopts their revs. For
  // Continue and New game: `{ ok, reason?, ...read }`. A release meanwhile wins.
  async claim() {
    const epoch = this.epoch;
    await this.ready;
    const lost = () => epoch !== this.epoch || this.writer === 'released';
    if (!lost() && this.locks && !this.unlock) await this.#request((held) => held ? 'writer' : 'other-tab');
    if (lost()) return { ok: false, reason: 'released' };
    if (this.writer === 'other-tab') return { ok: false, reason: 'other-tab' };
    const raw = { realm: this.#raw('realm'), edits: this.#raw('edits') };
    const result = this.read('realm', raw.realm);
    const { status } = this.read('edits', raw.edits);
    if ([result.status, status].includes('unavailable')) return { ok: false, reason: 'unavailable', ...result };
    if ([result.status, status].includes('newer')) return { ok: false, reason: 'read-only', ...result };
    for (const kind of KINDS) this.ownRev[kind] = this.#rev(raw[kind]);
    this.writer = 'writer';
    this.foreign = false;
    this.realm = result.record;
    return { ok: true, ...result };
  }

  // Writes `record` as this world's `kind` record: `{ ok: true, rev }`, or
  // `{ ok: false, reason }` with reason 'unavailable', 'read-only', 'paused',
  // 'pending', 'other-tab', 'released', 'stale', 'unclaimed', 'too-big',
  // 'quota' or 'error'. A refused write leaves the stored record as it was;
  // a written one gets its new `rev` and `savedAt`.
  write(kind, record) {
    const refuse = (reason) => ({ ok: false, reason });
    if (!this.storage) return refuse('unavailable');
    if (this.readOnly) return refuse('read-only');
    if (this.paused) return refuse('paused');
    if (this.writer !== 'writer') return refuse(this.writer);
    const raw = this.#raw(kind);
    if (raw === undefined) return refuse('unavailable');
    const stored = this.#rev(raw);
    if (stored !== null && this.ownRev[kind] === null) return refuse('unclaimed');
    if (stored !== null && stored !== this.ownRev[kind]) {
      this.foreign = true;
      return refuse('other-tab');
    }
    const stamp = { rev: (stored ?? this.ownRev[kind] ?? 0) + 1, savedAt: this.now(), features: SAVE_FEATURES };
    try {
      const out = serialize({ ...record, ...stamp });
      if (out.reason) return refuse(out.reason);
      this.storage.setItem(this.keys[kind], out.text);
    } catch (error) {
      return refuse(isQuota(error) ? 'quota' : 'error');
    }
    Object.assign(record, stamp);
    this.ownRev[kind] = stamp.rev;
    return { ok: true, rev: stamp.rev };
  }
}

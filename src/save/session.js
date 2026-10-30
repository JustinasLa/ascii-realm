// When this page saves play, and what the player is told (`docs/saves.md`).
// The store decides whether a write may land; the session decides when to
// try: on its timer, as the page hides, after a defeat, before a lobby,
// after a character switch and by hand. It writes nothing until a Continue
// has finished (`writable`), and holds the world while one is under way
// (`holding`).
//
// `live` is the body's `{ player, inventory, world, appliedId }`; `clock` is
// `{ get() → { day, tick }, set({ day, tick }) }`; `notify(text)` shows a
// toast; `off` is 'tool' on pages that never save (?nogate). Lobby pages and
// preview scenes have no store and so no session.

import { bodyIdOf, applyBody, fileBody, putBody, starterKit } from './body.js';
import { cleanClock, emptyRealm } from './format.js';

export const AUTOSAVE_MS = 60_000;
export const IDLE_TIMEOUT_MS = 5000;

// Each fits the phone's one-line toast (48 characters).
export const NOTICES = {
  saved: 'Game saved.',
  quota: 'Couldn\'t save: storage is full.',
  'too-big': 'Couldn\'t save: the save is too big.',
  error: 'Couldn\'t save.',
  unavailable: 'Saving isn\'t available in this browser.',
  corrupt: 'Your save couldn\'t be read: starting fresh.',
  repaired: 'Some saved things couldn\'t be read.',
  'read-only': 'Saved by a newer version: saving is off.',
  'other-tab': 'Open in another tab: this tab won\'t save.',
  stale: 'Saved in another tab: reload to carry on.',
  paused: 'Lobby play isn\'t saved.',
  gated: 'Your save is still opening.',
  tool: 'Saving is off on this page.',
  lobby: 'Game saved. Lobby play isn\'t saved.',
  'lobby-failed': 'Couldn\'t save before the lobby.',
};
// Refusals an automatic save keeps to itself; a save by hand says why.
const QUIET = ['unclaimed', 'pending', 'released', 'paused', 'gated', 'tool'];
const AS_TOLD = { pending: 'gated', unclaimed: 'gated', released: 'gated' };

// "0:42", "12:05" or "1:02:05".
const ago = (s) => {
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60];
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};

export class SaveSession {
  constructor({ store, world, live, characters, clock, notify, now = () => Date.now(), off = null }) {
    Object.assign(this, { store, world, live, characters, clock, notify, now, off });
    this.writable = false;
    this.holding = false;
    this.lastSaved = null;
    // Why the last Continue was refused, for a save by hand.
    this.refused = null;
    this.told = new Set();
    // Bodies a character switch filed that no save has written yet, by id.
    // They go into whichever realm the next save writes, even one claimed
    // meanwhile.
    this.unsaved = new Map();
    // Runs after a body is put on (the camera and pose wake with it).
    this.onSwitch = null;
  }

  // Tells `reason`'s notice, once a page until a save lands, or always.
  tell(reason, always = false) {
    if (!NOTICES[reason] || !always && this.told.has(reason)) return;
    this.told.add(reason);
    this.notify(NOTICES[reason]);
  }

  // Reads this world's save as the page starts: the read (`store.read`), or
  // status 'off'. Says when it can't be read, can't be written or is missing.
  boot() {
    if (this.off) return { status: this.off };
    const read = this.store.read('realm');
    this.tell(read.status === 'newer' || read.newerFeatures ? 'read-only' : read.status);
    return read;
  }

  // Continue: claims the save and puts the active character's body and the
  // clock back (the starter kit at spawn when they have none; the body as it
  // is when nothing is stored). Writes nothing; the next save does.
  async resume({ restoreClock = true } = {}) {
    if (this.off) return { ok: false, reason: this.off };
    this.holding = true;
    try {
      const claimed = await this.store.claim();
      if (!claimed.ok) {
        this.refused = claimed.reason;
        this.tell(claimed.reason);
        return { ok: false, reason: claimed.reason, status: claimed.status, repaired: 0, applied: false };
      }
      const realm = claimed.record;
      let repaired = claimed.repaired;
      if (realm) {
        const id = bodyIdOf(this.characters);
        const { spawn } = this.live.world;
        repaired += applyBody(realm.bodies[id] ?? { ...starterKit(), x: spawn.x, y: spawn.y }, this.live, id).repaired;
        this.onSwitch?.();
        if (realm.clock && restoreClock) this.clock.set(realm.clock);
      }
      if (repaired) this.tell('repaired');
      this.refused = null;
      this.writable = true;
      return { ok: true, status: claimed.status, repaired, applied: !!realm };
    } finally {
      this.holding = false;
    }
  }

  // Files the unsaved bodies and the live body into the save in memory (a
  // new one when none is stored), switching bodies first when the active
  // character changed. `{ realm, switched }`.
  #file() {
    const realm = this.store.realm ?? emptyRealm(this.world);
    const liveIds = this.characters.characters.map((character) => character.id);
    for (const [id, body] of this.unsaved) putBody(realm, id, body, liveIds);
    const outgoing = this.live.appliedId;
    const switched = fileBody(realm, this.live, this.characters, this.now());
    if (switched) {
      this.onSwitch?.();
      if (realm.bodies[outgoing]) this.unsaved.set(outgoing, realm.bodies[outgoing]);
    }
    return { realm, switched };
  }

  // After the active character changed: puts their body on at once. True
  // when it switched, so the page saves soon.
  sync() {
    return bodyIdOf(this.characters) !== this.live.appliedId && this.#file().switched;
  }

  // Saves for `reason` ('auto', 'hide', 'death', 'lobby', 'switch' or
  // 'manual'): `{ ok: true, rev }`, or `{ ok: false, reason }` with the
  // store's reason, 'tool' or 'gated'. A save by hand always answers.
  save(reason) {
    const manual = reason === 'manual';
    const blocked = this.off ?? (this.writable ? null : 'gated');
    if (blocked) return this.#refuse(blocked, manual);
    const { realm } = this.#file();
    realm.clock = cleanClock(this.clock.get());
    const written = this.store.write('realm', realm);
    if (!written.ok) return this.#refuse(written.reason, manual);
    this.store.realm = realm;
    this.unsaved.clear();
    this.told.clear();
    this.lastSaved = this.now();
    if (manual) this.tell('saved', true);
    return written;
  }

  #refuse(reason, manual) {
    // After a Continue, another tab writing means this page is behind.
    const why = reason === 'other-tab' ? 'stale' : reason === 'gated' ? this.refused ?? reason : reason;
    if (manual || !QUIET.includes(reason)) this.tell(AS_TOLD[why] ?? why, manual);
    return { ok: false, reason };
  }

  // The save just before joining a lobby, then no more for this page.
  beforeLobby() {
    const { ok, reason } = this.save('lobby');
    this.store.pause('lobby');
    this.notify(NOTICES[ok ? 'lobby' : ['gated', 'tool'].includes(reason) ? 'paused' : 'lobby-failed']);
  }

  // The menu's line: how saving goes, or why it doesn't.
  status() {
    const { store } = this;
    const why = this.off ?? (store.readOnly ? 'read-only' : store.paused ? 'paused'
      : ['other-tab', 'stale'].includes(store.writer) ? store.writer : this.writable ? null : this.refused ?? 'gated');
    if (why) return NOTICES[AS_TOLD[why] ?? why];
    const last = this.lastSaved === null ? '' : ` Last saved ${ago((this.now() - this.lastSaved) / 1000)} ago.`;
    return `Saves every minute and when you leave.${last}`;
  }
}

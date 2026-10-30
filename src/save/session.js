// When this page saves play, and what the player is told (`docs/saves.md`).
// The store decides whether a write may land; the session decides when to
// try: on its timer, as the page hides, after a defeat, before a lobby,
// after a character switch and by hand. It writes nothing until a Continue
// or New game has finished (`writable`), and holds the world while the
// choice is open (`choosing`, set by the page) or one is under way
// (`holding`).
//
// `live` is the body's `{ player, inventory, world, appliedId }`; `clock` is
// `{ get() → { day, tick }, set({ day, tick }) }`; `notify(text, reason)`
// tells the player (the page shows 'other-tab' and 'stale' as screens); `off` is 'tool' on pages that never save (?nogate). Lobby pages and
// preview scenes have no store and so no session.

import { bodyIdOf, applyBody, fileBody, putBody, starterKit } from './body.js';
import { cleanClock, emptyEdits, emptyRealm } from './format.js';

export const AUTOSAVE_MS = 60_000;
export const IDLE_TIMEOUT_MS = 5000;

// Each fits the phone's one-line toast (27 characters on a 393 px wide
// phone held upright).
export const NOTICES = {
  saved: 'Game saved.',
  quota: 'Storage full: not saved.',
  'too-big': 'Save too big: not saved.',
  error: 'Couldn\'t save.',
  unavailable: 'This browser can\'t save.',
  corrupt: 'Save damaged: fresh start.',
  repaired: 'Some of the save was lost.',
  'read-only': 'Newer save: saving is off.',
  'other-tab': 'Other tab open: not saving.',
  stale: 'Other tab saved: reload.',
  paused: 'Lobby play isn\'t saved.',
  gated: 'Your save is still opening.',
  tool: 'Saving is off on this page.',
  lobby: 'Saved. Lobby play isn\'t.',
  'lobby-failed': 'Not saved before the lobby.',
};
// Refusals an automatic save keeps to itself; a save by hand says why.
// A save from a newer build is told on the Continue screen instead.
const QUIET = ['unclaimed', 'pending', 'released', 'paused', 'gated', 'tool', 'declined', 'read-only'];
const AS_TOLD = { pending: 'gated', unclaimed: 'gated', released: 'gated', declined: 'tool' };

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
    this.restoring = false;
    this.choosing = false;
    // Set by "Play without saving": nothing more is written on this page.
    this.declined = false;
    // The read `boot()` made, for the Continue screen.
    this.booted = null;
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
    this.notify(NOTICES[reason], reason);
  }

  // The notice for a refusal's `reason`, for the choice's message line.
  explain(reason) {
    return NOTICES[AS_TOLD[reason] ?? reason] ?? NOTICES.error;
  }

  get holding() { return this.restoring || this.choosing; }

  // Reads this world's save as the page starts: the read (`store.read`), or
  // status 'off'. Says when it can't be read or this browser can't save; the
  // choice tells the rest.
  boot() {
    if (this.off) return { status: this.off };
    const read = this.booted = this.store.read('realm');
    if (['corrupt', 'unavailable'].includes(read.status)) this.tell(read.status);
    return read;
  }

  // What the Continue screen says about the save `boot()` read:
  // `{ day, savedAt, hasBody, newerFeatures }`, with day null when no time
  // of day was saved.
  summary() {
    const { record, newerFeatures } = this.booted;
    return { day: record.clock?.day ?? null, savedAt: record.savedAt,
      hasBody: Object.hasOwn(record.bodies, bodyIdOf(this.characters)), newerFeatures };
  }

  // Continue: claims the save and puts the active character's body and the
  // clock back (the starter kit at spawn when they have none; the body as it
  // is when nothing is stored). Writes nothing; the next save does.
  async resume({ restoreClock = true } = {}) {
    if (this.off) return { ok: false, reason: this.off };
    this.restoring = true;
    try {
      const claimed = await this.#claim();
      if (!claimed.ok) return { ok: false, reason: claimed.reason, status: claimed.status, repaired: 0, applied: false };
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
      this.restoring = false;
    }
  }

  async #claim() {
    const claimed = await this.store.claim();
    if (!claimed.ok) {
      this.refused = claimed.reason;
      this.tell(claimed.reason);
    }
    return claimed;
  }

  // New game: claims the save and writes a fresh one holding only the body
  // played now, then clears the land's changes, but only once the fresh save
  // has landed. A refused write leaves both records as they were and isn't
  // told: the choice shows it (`explain`).
  async startOver() {
    this.restoring = true;
    try {
      const claimed = await this.#claim();
      if (!claimed.ok) return claimed;
      this.store.realm = emptyRealm(this.world);
      this.unsaved.clear();
      this.refused = null;
      this.writable = true;
      const written = this.save('new');
      if (!written.ok) this.writable = false;
      else this.store.write('edits', emptyEdits(this.world));
      return written;
    } finally {
      this.restoring = false;
    }
  }

  // Play without saving: nothing more is written on this page.
  decline() {
    this.declined = true;
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

  // Saves for `reason` ('auto', 'hide', 'death', 'lobby', 'switch', 'new'
  // or 'manual'): `{ ok: true, rev }`, or `{ ok: false, reason }` with the
  // store's reason, 'tool', 'declined' or 'gated'. A save by hand always
  // answers; New game's never does.
  save(reason) {
    const manual = reason === 'manual';
    const blocked = this.off ?? (this.declined ? 'declined' : this.writable ? null : 'gated');
    if (blocked) return this.#refuse(blocked, manual);
    const { realm } = this.#file();
    realm.clock = cleanClock(this.clock.get());
    const written = this.store.write('realm', realm);
    if (!written.ok) return reason === 'new' ? written : this.#refuse(written.reason, manual);
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
    this.notify(NOTICES[ok ? 'lobby' : ['gated', 'tool', 'declined'].includes(reason) ? 'paused' : 'lobby-failed']);
  }

  // The menu's line: how saving goes, or why it doesn't.
  status() {
    const { store } = this;
    const why = this.off ?? (this.declined ? 'declined' : store.readOnly ? 'read-only' : store.paused ? 'paused'
      : ['other-tab', 'stale'].includes(store.writer) ? store.writer : this.writable ? null : this.refused ?? 'gated');
    if (why) return NOTICES[AS_TOLD[why] ?? why];
    const last = this.lastSaved === null ? '' : ` Last saved ${ago((this.now() - this.lastSaved) / 1000)} ago.`;
    return `Saves every minute and when you leave.${last}`;
  }
}

// The roster: up to three characters kept on this device, and which one is
// played. It holds the session's copy in memory and writes it to storage
// after every change, so private browsing or a full disk keeps the
// characters for this visit instead of losing them.
//
// Each saved record carries a `rev` that grows with every write. Before a
// change the roster re-reads storage and takes the stored copy when it is
// newer, so changes made one after another in two tabs both survive. Two
// tabs changing at the same instant can still lose one change: the last
// write wins.
//
// Changes this tab couldn't save yet are laid over a newer stored copy, one
// character at a time, and saved with it once a write works. Their sheets
// and skins win, but every time keeps the later of the two copies, so an
// edit never lifts a cooldown or a lock. A record from a newer version is
// never written over, and neither is one the unsaved changes no longer fit.
// Nothing is written unless the read just before it worked, since a record
// that can't be read might be a newer version's.

import { RULES } from './catalog.js';
import { cleanSkin } from './skin.js';
import { blankSheet, canChange, cleanSheet, fieldError, nameKey, normalName, nameError, sheetErrors } from './rules.js';

export const ROSTER_KEY = 'ascii-realm-characters';
export const ROSTER_VERSION = 1;
// The name the lobby form saved before characters existed.
const LEGACY_NAME_KEY = 'ascii-realm-name';

// Upgrades from each older version to the next, keyed by the version they
// upgrade from. None yet.
export const MIGRATIONS = Object.freeze({});

// Runs `record` through each upgrade up to `target`.
export function migrate(record, steps = MIGRATIONS, target = ROSTER_VERSION) {
  let next = record;
  for (let v = record.v; v < target; v++) next = { ...steps[v](next), v: v + 1 };
  return next;
}

const ID = /^[a-z0-9-]{4,40}$/i;
const time = (ms) => Number.isSafeInteger(ms) && ms > 0;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const later = (a, b) => a === null ? b : b === null ? a : Math.max(a, b);

// A saved character with its sheet repaired, or null when it is too broken
// to keep.
function cleanCharacter(raw, seen) {
  if (!plain(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || seen.has(raw.id)) return null;
  if (!time(raw.createdAt) || !plain(raw.sheet)) return null;
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    switchedAt: time(raw.switchedAt) ? raw.switchedAt : null,
    sheet: cleanSheet(raw.sheet),
    skin: plain(raw.skin) ? cleanSkin(raw.skin) : null,
  };
}

// A record as the current version stores it. It never throws.
export function cleanRoster(record) {
  const seen = new Set();
  const characters = [];
  for (const raw of Array.isArray(record?.characters) ? record.characters : []) {
    const character = characters.length < RULES.slots && cleanCharacter(raw, seen);
    if (character) {
      characters.push(character);
      seen.add(character.id);
    }
  }
  return {
    v: ROSTER_VERSION,
    rev: Number.isSafeInteger(record?.rev) && record.rev > 0 ? record.rev : 0,
    active: seen.has(record?.active) ? record.active : characters[0]?.id ?? null,
    characters,
  };
}

const empty = () => cleanRoster(null);

// 'c' and 16 hex digits. `getRandomValues` works on plain-http LAN hosts,
// where `randomUUID` is missing.
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `c${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

const FIELD_NAMES = { race: 'Race', class: 'Class', birthday: 'Age', attributes: 'Attributes' };
export const SHEET_FIELDS = ['name', 'gender', 'race', 'birthday', 'class', 'attributes', 'description', 'clues'];
// Fields checked when a field changes: a new race must still allow the age.
const CHECKS = { race: ['race', 'birthday'] };
const NEWER = 'Characters were saved by a newer version of the game.';
const MISSING = 'No such character.';
const CLASH = 'Characters changed in another tab clash with the ones made here, so these stay for this visit only.';
const UNSAVED = 'Characters cannot be saved on this device, so changes last for this visit only.';

export class Roster {
  // `events` is the window, to hear other tabs change the roster; `onChange`
  // runs after it does.
  constructor({ storage, now = () => Date.now(), bypassCooldown = false, randomId: makeId = randomId,
    events = null, onChange = null } = {}) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
    }
    this.storage = storage;
    this.now = now;
    this.bypassCooldown = bypassCooldown;
    this.randomId = makeId;
    this.onChange = onChange;
    this.readOnly = false;
    this.storageOk = true;
    // Whether the last read worked.
    this.readOk = true;
    this.state = this.read() ?? empty();
    // The `rev` last read or written, the ids changed since, and whether the
    // active character changed since.
    this.syncedRev = this.state.rev;
    this.unsaved = new Set();
    this.activeUnsaved = false;
    this.clash = false;
    this.legacyName = this.readLegacyName();
    events?.addEventListener('storage', (event) => {
      if (event.key === ROSTER_KEY && this.sync()) this.onChange?.();
    });
  }

  // The stored record, cleaned, or null when there is none or it can't be
  // read. A newer version's record makes the roster read-only.
  read() {
    let raw;
    try {
      raw = this.storage.getItem(ROSTER_KEY);
    } catch {
      this.storageOk = this.readOk = false;
      return null;
    }
    this.readOk = true;
    if (raw === null) return null;
    try {
      const record = JSON.parse(raw);
      if (!Number.isInteger(record?.v) || record.v < 1) return null;
      if (record.v > ROSTER_VERSION) {
        this.readOnly = true;
        return null;
      }
      return cleanRoster(migrate(record));
    } catch {
      return null;
    }
  }

  // Takes what another tab saved since this one last read or wrote, keeping
  // this tab's unsaved changes on top. It reads even after failed writes, so
  // a newer version's record is seen before anything is written over it.
  // Returns whether the roster changed.
  sync() {
    const wasReadOnly = this.readOnly;
    const stored = this.read();
    if (this.readOnly !== wasReadOnly) return true;
    if (!stored || stored.rev <= this.syncedRev) return false;
    const merged = this.unsaved.size ? this.merge(stored) : stored;
    this.clash = !merged;
    if (this.clash) return false;
    this.state = merged;
    this.syncedRev = stored.rev;
    return true;
  }

  // The stored copy with this tab's unsaved characters laid over its own,
  // or null when they no longer fit: more than the slots, or a name taken.
  // Of the two active characters, the one switched to last stays active.
  merge(stored) {
    const characters = stored.characters.map((character) => {
      if (!this.unsaved.has(character.id)) return character;
      const mine = this.find(character.id);
      return { ...mine, createdAt: Math.max(mine.createdAt, character.createdAt),
        switchedAt: later(mine.switchedAt, character.switchedAt) };
    });
    for (const id of this.unsaved) {
      if (!characters.some((character) => character.id === id)) characters.push(this.find(id));
    }
    const names = new Set(characters.map((character) => nameKey(character.sheet.name)));
    if (characters.length > RULES.slots || names.size < characters.length) return null;
    const activeAt = (id) => {
      const character = characters.find((each) => each.id === id);
      return character ? character.switchedAt ?? character.createdAt : -Infinity;
    };
    const mine = this.activeUnsaved && activeAt(this.state.active) >= activeAt(stored.active);
    return { ...stored, active: mine ? this.state.active : stored.active, characters };
  }

  // Why changes aren't being saved, or null when they are.
  get saveError() {
    if (this.readOnly) return NEWER;
    if (this.clash) return CLASH;
    return this.storageOk ? null : UNSAVED;
  }

  // Saves after a change to character `id`, which made it active if
  // `activated`.
  save(id, activated = false) {
    this.state.rev++;
    this.unsaved.add(id);
    this.activeUnsaved ||= activated;
    if (this.clash || !this.readOk) return;
    try {
      this.storage.setItem(ROSTER_KEY, JSON.stringify(this.state));
      this.storageOk = true;
      this.syncedRev = this.state.rev;
      this.unsaved.clear();
      this.activeUnsaved = false;
    } catch {
      // Full or disabled storage keeps the roster for this visit.
      this.storageOk = false;
    }
  }

  readLegacyName() {
    try {
      const name = normalName(this.storage.getItem(LEGACY_NAME_KEY));
      return nameError(name) ? '' : name;
    } catch {
      return '';
    }
  }

  get characters() {
    return structuredClone(this.state.characters);
  }

  get active() {
    const character = this.find(this.state.active);
    return character ? structuredClone(character) : null;
  }

  // The old lobby name, offered for the first character only.
  get suggestedName() {
    return this.state.characters.length ? '' : this.legacyName;
  }

  // When the active character last changed, or null if it never has.
  get lastSwitchAt() {
    const times = this.state.characters.map((character) => character.switchedAt).filter((at) => at !== null);
    return times.length ? Math.max(...times) : null;
  }

  find(id) {
    return this.state.characters.find((character) => character.id === id) ?? null;
  }

  // A blank sheet with its id already chosen, so the birthday an age gives
  // stays the same while the player is creating it.
  newDraft() {
    return { id: this.randomId(), sheet: blankSheet() };
  }

  cooldownEnds() {
    const last = this.lastSwitchAt;
    if (this.bypassCooldown || last === null) return null;
    const opensAt = last + RULES.switchCooldownMs;
    return this.now() < opensAt ? opensAt : null;
  }

  // A new character becomes the active one, so it counts as a switch.
  canCreate() {
    if (this.readOnly) return { ok: false, reason: NEWER };
    if (this.state.characters.length >= RULES.slots) {
      return { ok: false, reason: `All ${RULES.slots} character slots are taken.` };
    }
    const opensAt = this.state.characters.length ? this.cooldownEnds() : null;
    return opensAt ? { ok: false, reason: 'You are on cooldown from switching characters.', opensAt } : { ok: true };
  }

  create(draft) {
    this.sync();
    const allowed = this.canCreate();
    if (!allowed.ok) return allowed;
    if (typeof draft?.id !== 'string' || !ID.test(draft.id) || this.find(draft.id)) {
      return { ok: false, reason: 'This character needs a new id.' };
    }
    const now = this.now();
    const sheet = { ...blankSheet(), ...draft.sheet };
    const errors = sheetErrors({ id: draft.id, sheet }, { others: this.state.characters, now });
    if (errors.length) return { ok: false, errors };
    const character = { id: draft.id, createdAt: now, switchedAt: this.state.active ? now : null,
      sheet: cleanSheet(sheet), skin: plain(draft.skin) ? cleanSkin(draft.skin) : null };
    this.state.characters.push(character);
    this.state.active = character.id;
    this.save(character.id, true);
    return { ok: true, character: structuredClone(character) };
  }

  // Why `update(id, changes)` would refuse now, without writing: `{ reason }`,
  // `{ errors }`, or null when it would save. Locked fields are refused, and
  // only the changed fields are checked.
  check(id, changes) {
    if (this.readOnly) return { reason: NEWER };
    const character = this.find(id);
    if (!character) return { reason: MISSING };
    const sheet = { ...character.sheet, ...changes };
    const cleaned = cleanSheet(sheet);
    const changed = SHEET_FIELDS.filter((field) =>
      JSON.stringify(cleaned[field]) !== JSON.stringify(character.sheet[field]));
    const now = this.now();
    const locked = changed.find((field) => !canChange(character, field, now));
    if (locked) return { reason: `${FIELD_NAMES[locked]} is locked.` };
    const ctx = { others: this.state.characters, selfId: id, now };
    const errors = [...new Set(changed.flatMap((field) => CHECKS[field] ?? [field]))]
      .map((field) => ({ field, message: fieldError(field, { id, sheet }, ctx) }))
      .filter((error) => error.message);
    return errors.length ? { errors } : null;
  }

  // Changes some of a character's sheet, if `check` allows.
  update(id, changes) {
    this.sync();
    const refused = this.check(id, changes);
    if (refused) return { ok: false, ...refused };
    const character = this.find(id);
    character.sheet = cleanSheet({ ...character.sheet, ...changes });
    this.save(id);
    return { ok: true, character: structuredClone(character) };
  }

  canSwitch(id) {
    if (!this.find(id)) return { ok: false, reason: MISSING };
    const opensAt = id === this.state.active ? null : this.cooldownEnds();
    return opensAt ? { ok: false, reason: 'You are on cooldown from switching characters.', opensAt } : { ok: true };
  }

  switchTo(id) {
    this.sync();
    if (this.readOnly) return { ok: false, reason: NEWER };
    const allowed = this.canSwitch(id);
    if (!allowed.ok || id === this.state.active) return allowed;
    this.find(id).switchedAt = this.now();
    this.state.active = id;
    this.save(id, true);
    return { ok: true };
  }

  // The skin can always change. A malformed one is repaired by `cleanSkin`.
  setSkin(id, skin) {
    this.sync();
    if (this.readOnly) return { ok: false, reason: NEWER };
    const character = this.find(id);
    if (!character) return { ok: false, reason: MISSING };
    character.skin = plain(skin) ? cleanSkin(skin) : null;
    this.save(id);
    return { ok: true };
  }
}

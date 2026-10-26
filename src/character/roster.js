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

import { RULES } from './catalog.js';
import { blankSheet, canChange, cleanSheet, fieldError, normalName, nameError, sheetErrors } from './rules.js';

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
    skin: plain(raw.skin) ? raw.skin : null,
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
const SHEET_FIELDS = ['name', 'gender', 'race', 'birthday', 'class', 'attributes', 'description', 'clues'];
// Fields checked when a field changes: a new race must still allow the age.
const CHECKS = { race: ['race', 'birthday'] };
const NEWER = 'Characters were saved by a newer version of the game.';
const MISSING = 'No such character.';

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
    this.state = this.read() ?? empty();
    this.legacyName = this.readLegacyName();
    events?.addEventListener('storage', (event) => {
      if (event.key === ROSTER_KEY && this.adoptNewer()) this.onChange?.();
    });
  }

  // The stored record, cleaned, or null when there is none or it can't be
  // read. A newer version's record makes the roster read-only.
  read() {
    let raw;
    try {
      raw = this.storage.getItem(ROSTER_KEY);
    } catch {
      this.storageOk = false;
      return null;
    }
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

  // Takes the stored copy when another tab saved a newer one.
  adoptNewer() {
    const stored = this.storageOk ? this.read() : null;
    if (!stored || stored.rev <= this.state.rev) return false;
    this.state = stored;
    return true;
  }

  save() {
    this.state.rev++;
    try {
      this.storage.setItem(ROSTER_KEY, JSON.stringify(this.state));
      this.storageOk = true;
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
    this.adoptNewer();
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
      sheet: cleanSheet(sheet), skin: plain(draft.skin) ? structuredClone(draft.skin) : null };
    this.state.characters.push(character);
    this.state.active = character.id;
    this.save();
    return { ok: true, character: structuredClone(character) };
  }

  // Changes some of a character's sheet. Locked fields are refused, and only
  // the changed fields are checked.
  update(id, changes) {
    this.adoptNewer();
    if (this.readOnly) return { ok: false, reason: NEWER };
    const character = this.find(id);
    if (!character) return { ok: false, reason: MISSING };
    const sheet = { ...character.sheet, ...changes };
    const cleaned = cleanSheet(sheet);
    const changed = SHEET_FIELDS.filter((field) =>
      JSON.stringify(cleaned[field]) !== JSON.stringify(character.sheet[field]));
    const now = this.now();
    const locked = changed.find((field) => !canChange(character, field, now));
    if (locked) return { ok: false, reason: `${FIELD_NAMES[locked]} is locked.` };
    const ctx = { others: this.state.characters, selfId: id, now };
    const errors = [...new Set(changed.flatMap((field) => CHECKS[field] ?? [field]))]
      .map((field) => ({ field, message: fieldError(field, { id, sheet }, ctx) }))
      .filter((error) => error.message);
    if (errors.length) return { ok: false, errors };
    character.sheet = cleaned;
    this.save();
    return { ok: true, character: structuredClone(character) };
  }

  canSwitch(id) {
    if (!this.find(id)) return { ok: false, reason: MISSING };
    const opensAt = id === this.state.active ? null : this.cooldownEnds();
    return opensAt ? { ok: false, reason: 'You are on cooldown from switching characters.', opensAt } : { ok: true };
  }

  switchTo(id) {
    this.adoptNewer();
    if (this.readOnly) return { ok: false, reason: NEWER };
    const allowed = this.canSwitch(id);
    if (!allowed.ok || id === this.state.active) return allowed;
    this.find(id).switchedAt = this.now();
    this.state.active = id;
    this.save();
    return { ok: true };
  }

  // The skin can always change; its contents are the skin's own to check.
  setSkin(id, skin) {
    this.adoptNewer();
    if (this.readOnly) return { ok: false, reason: NEWER };
    const character = this.find(id);
    if (!character) return { ok: false, reason: MISSING };
    character.skin = plain(skin) ? structuredClone(skin) : null;
    this.save();
    return { ok: true };
  }
}

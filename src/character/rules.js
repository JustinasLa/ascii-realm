// The character sheet's rules: what a valid name, age, attribute spend,
// description and set of clues look like, and which fields stay open to
// change after creation. Every check returns a plain message or null, so the
// creator, the character menu and the lobby server word errors the same way.
// Nothing here touches the page, storage or the clock: callers pass `now`.

import { ATTRIBUTES, classOf, genderOf, raceOf, RULES } from './catalog.js';
import { ageOn, birthdayFromAge, fromIso, parseBirthday, realmToday, toIso } from './calendar.js';

// Phones type curly apostrophes and some keyboards type decomposed letters;
// both are made the plain form so "Zoë" is always the same name.
export function normalName(raw) {
  return typeof raw === 'string' ? raw.normalize('NFC').replace(/[\u2019\u02bc]/g, "'").trim() : '';
}

export const nameKey = (name) => normalName(name).toLowerCase();

// Letters as a reader counts them, so an accented or combined letter is one.
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
export const textLength = (text) => graphemes ? [...graphemes.segment(text)].length : [...text].length;

const NAME = /^\p{L}[\p{L}\p{M} .'-]*$/u;

// `others` are the player's other characters; `selfId` is the one renamed.
export function nameError(name, { others = [], selfId = null } = {}) {
  const n = normalName(name);
  if (n === '') return 'Name cannot be empty.';
  if (!NAME.test(n)) return 'Name may only use letters, spaces, apostrophes, hyphens and full stops.';
  const length = textLength(n);
  if (length < RULES.name.min) return `Name must be at least ${RULES.name.min} characters.`;
  if (length > RULES.name.max) return `Name cannot exceed ${RULES.name.max} characters.`;
  const key = nameKey(n);
  if (others.some((other) => other.id !== selfId && nameKey(other.sheet?.name) === key)) return 'Name already in use.';
  return null;
}

export const genderError = (gender) => gender === null || genderOf(gender) ? null : 'Pick a gender or leave it unset.';

export function raceError(race) {
  if (race === null || race === undefined) return 'Pick a race.';
  return raceOf(race) ? null : `Unknown race: ${race}`;
}

export function classError(id) {
  if (id === null || id === undefined) return 'Pick a class.';
  return classOf(id) ? null : `Unknown class: ${id}`;
}

// An age chosen for a race at creation, or when the age is changed.
export function ageError(age, raceId) {
  const race = raceOf(raceId);
  if (!race) return 'Select a race before setting a birthday.';
  if (!Number.isInteger(age) || age < RULES.minAge || age > race.maxAge) {
    return `Age must be between ${RULES.minAge} and ${race.maxAge} for your race.`;
  }
  return null;
}

export const ageOf = (sheet, now) => ageOn(sheet.birthday, realmToday(now));

// The stored birthday must make the character an age the race allows today.
export function birthdayError(sheet, now) {
  if (!raceOf(sheet.race)) return 'Select a race before setting a birthday.';
  if (!fromIso(sheet.birthday)) return 'Invalid birthday.';
  return ageError(ageOf(sheet, now), sheet.race);
}

export function descriptionError(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t === '') return 'Description cannot be empty.';
  if (t.length < RULES.description.min) return `Description must be at least ${RULES.description.min} characters.`;
  if (t.length > RULES.description.max) return `Description cannot exceed ${RULES.description.max} characters.`;
  return null;
}

// Evil characters must leave more for others to recognise them by.
export const cluesNeeded = (sheet) => sheet.traits?.some((trait) => trait?.evil)
  ? RULES.clues.neededEvil : RULES.clues.needed;

// Clues are checked one at a time in the order written, so the first bad
// clue decides the message.
export function cluesError(clues, needed = RULES.clues.needed) {
  const { min, max, most } = RULES.clues;
  const list = Array.isArray(clues) ? clues : [];
  if (list.length > most) return `You cannot have more than ${most} clues.`;
  const seen = new Set();
  for (const clue of list) {
    const text = typeof clue === 'string' ? clue.trim() : '';
    if (text.length < min || text.length > max) return `Each clue must be ${min} to ${max} characters.`;
    const key = text.toLowerCase();
    if (seen.has(key)) return `Duplicate clue: ${text}`;
    seen.add(key);
  }
  if (list.length < needed) return `Needs at least ${needed} clues.`;
  return null;
}

// Points for buying an attribute up to `rank`: 1 + 2 + 4 + 8, so each rank
// costs twice the one before.
export const attributeCost = (rank) => 2 ** rank - 1;

export const attributesSpent = (attributes) => ATTRIBUTES
  .reduce((sum, key) => sum + attributeCost(attributes?.[key] ?? 0), 0);

const rankOk = (rank) => Number.isInteger(rank) && rank >= 0 && rank <= RULES.maxRank;

export function attributesError(attributes) {
  if (!ATTRIBUTES.every((key) => rankOk(attributes?.[key] ?? 0))) {
    return `Attribute ranks must be whole numbers from 0 to ${RULES.maxRank}.`;
  }
  const spent = attributesSpent(attributes);
  return spent === RULES.pool ? null : `Spend exactly ${RULES.pool} attribute points (spent ${spent}).`;
}

// Each attribute's total: the race's bonus, the bought ranks and any trait
// modifiers, never below 0.
export function attributeTotals(sheet) {
  const bonus = raceOf(sheet.race) ? RULES.raceBonus : 0;
  return Object.fromEntries(ATTRIBUTES.map((key) => {
    const traits = (sheet.traits ?? []).reduce((sum, trait) => sum + (trait?.modifiers?.[key] ?? 0), 0);
    return [key, Math.max(0, bonus + (sheet.attributes?.[key] ?? 0) + traits)];
  }));
}

// The creator's steps that check something, in order.
export const STEPS = Object.freeze(['name', 'class', 'race', 'age', 'attributes', 'description', 'clues']);

// The first problem with one stored field of `draft` ({ id, sheet }), or
// null. `ctx` holds the player's other characters and the time. Edits check
// only the fields they change, so a character who has aged past the race's
// maximum can still be renamed.
export function fieldError(field, draft, { others = [], selfId = draft.id, now = Date.now() } = {}) {
  const { sheet } = draft;
  switch (field) {
    case 'name': return nameError(sheet.name, { others, selfId });
    case 'gender': return genderError(sheet.gender);
    case 'race': return raceError(sheet.race);
    case 'birthday': return birthdayError(sheet, now);
    case 'class': return classError(sheet.class);
    case 'attributes': return attributesError(sheet.attributes);
    case 'description': return descriptionError(sheet.description);
    case 'clues': return cluesError(sheet.clues, cluesNeeded(sheet));
    default: return `Unknown field: ${field}`;
  }
}

// The creator's steps and the fields each one sets.
const STEP_FIELDS = { name: ['name'], class: ['class'], race: ['race'], age: ['birthday'],
  attributes: ['attributes'], description: ['description', 'gender'], clues: ['clues'] };

// The first problem with one step of `draft`, or null.
export function stepError(step, draft, ctx) {
  if (!(step in STEP_FIELDS)) return `Unknown step: ${step}`;
  for (const field of STEP_FIELDS[step]) {
    const message = fieldError(field, draft, ctx);
    if (message) return message;
  }
  return null;
}

// Every step's problem, in step order: what blocks Create.
export function sheetErrors(draft, ctx) {
  return STEPS.map((step) => ({ step, message: stepError(step, draft, ctx) })).filter((error) => error.message);
}

// How long after creation each field may still change. The birthday is how
// the age is stored, so it follows the age's lock.
const LOCKED_AS = { race: 'race', class: 'class', age: 'age', birthday: 'age', attributes: 'attributes' };
const ALWAYS = new Set(['name', 'gender', 'description', 'clues', 'skin']);

export function canChange(character, field, now) {
  if (ALWAYS.has(field)) return true;
  if (!(field in LOCKED_AS)) return false;
  return now - character.createdAt < RULES.locks[LOCKED_AS[field]];
}

// When a field locks, or null for a field that never does.
export function lockEndsAt(character, field) {
  return field in LOCKED_AS ? character.createdAt + RULES.locks[LOCKED_AS[field]] : null;
}

// A copy of `sheet` aged `age`, its birthday picked from `id` so the same age
// always gives the same day.
export function setAge(sheet, age, id, now) {
  const message = ageError(age, sheet.race);
  if (message) return { ok: false, message };
  return { ok: true, sheet: { ...sheet, birthday: birthdayFromAge(age, realmToday(now), id) } };
}

// A copy of `sheet` with a typed birthday, if it parses and gives an age the
// race allows.
export function setBirthday(sheet, input, now) {
  const birthday = parseBirthday(input);
  const next = { ...sheet, birthday };
  const message = birthday ? birthdayError(next, now) : 'Invalid birthday.';
  return message ? { ok: false, message } : { ok: true, sheet: next };
}

export function blankSheet() {
  return {
    name: '',
    gender: null,
    race: null,
    birthday: null,
    class: null,
    attributes: Object.fromEntries(ATTRIBUTES.map((key) => [key, 0])),
    description: '',
    clues: [],
    traits: [],
  };
}

const clampRank = (rank) => Number.isFinite(rank) ? Math.min(RULES.maxRank, Math.max(0, Math.trunc(rank))) : 0;

// A saved sheet repaired field by field to the right types. A sheet that
// breaks a rule is kept as it is, so a rule change never deletes a character.
export function cleanSheet(raw) {
  const sheet = raw && typeof raw === 'object' ? raw : {};
  const date = fromIso(sheet.birthday);
  return {
    name: normalName(sheet.name),
    gender: genderOf(sheet.gender) ? sheet.gender : null,
    race: raceOf(sheet.race) ? sheet.race : null,
    birthday: date && toIso(date),
    class: classOf(sheet.class) ? sheet.class : null,
    attributes: Object.fromEntries(ATTRIBUTES.map((key) => [key, clampRank(sheet.attributes?.[key])])),
    description: typeof sheet.description === 'string' ? sheet.description.trim() : '',
    clues: Array.isArray(sheet.clues) ? sheet.clues.filter((clue) => typeof clue === 'string').map((clue) => clue.trim()) : [],
    traits: [],
  };
}

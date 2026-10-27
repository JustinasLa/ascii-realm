// The character creator's flow, without the page: the draft, the pages in
// order, where Back, Next and Edit go, and which rule each step must pass.
// Every message comes from the sheet's rules; this adds only the copy of the
// info pages and the order.

import { ATTRIBUTE_NAMES, ATTRIBUTES, classOf, genderOf, raceOf, RULES, UNSET } from './catalog.js';
import { formatBirthday } from './calendar.js';
import { ageOf, attributeCost, attributesSpent, attributeTotals, cluesError, setAge, setBirthday,
  sheetErrors, stepError } from './rules.js';
import { cleanSkin, DEFAULT_SKIN, toneForRace } from './skin.js';

const info = (id, title, ...lines) => ({ id, kind: 'info', title, lines });
const step = (id, title) => ({ id, kind: 'step', step: id, title });

// Info pages have Continue only and aren't counted as steps.
export const PAGES = Object.freeze([
  info('welcome', 'Welcome', 'Welcome to Cerrith.', 'Before you set out, make the character you will play.'),
  info('creation', 'Character creation', 'Most choices can be changed later.',
    "Your race can change only during your character's first day; class, age and attributes during the first five days.",
    'You can always make another character: up to three.'),
  info('name-info', 'Name', 'Choose the name others will know you by.',
    'Letters in any alphabet, spaces, apostrophes, hyphens and full stops; 3 to 24 letters.'),
  step('name', 'Name'),
  info('class-info', 'Class', 'Your class is who your character is: archer, bard, warrior, paladin, guardian, mage or musketeer.',
    'For now every class carries the same sword, bow and runes.', 'You can change it during the first five days.'),
  step('class', 'Class'),
  step('race', 'Race'),
  step('age', 'Age'),
  step('attributes', 'Attributes'),
  info('description-info', 'Description', 'Describe how your character looks and carries themselves, as others would see them.',
    '32 to 256 characters. Gender is optional.'),
  step('description', 'Description'),
  info('clues-info', 'Clues', 'Clues are how others recognise you: looks, smell, habits.',
    'Write at least 2, each 12 to 48 characters.'),
  step('clues', 'Clues'),
  { id: 'summary', kind: 'summary', title: 'Review your character' },
].map((page) => Object.freeze(page)));

const STEP_PAGES = PAGES.filter((page) => page.kind === 'step');
const pageOf = (id) => PAGES.findIndex((page) => page.id === id);
const SUMMARY = pageOf('summary');

// Whether start-up opens the creator: always with ?creator, never for tools
// (?nocreator, ?nogate), and otherwise on a first visit, while there is no
// character yet and one can be made.
export function wantsCreator(params, roster) {
  if (params.has('creator')) return true;
  if (params.has('nocreator') || params.has('nogate')) return false;
  return !roster.characters.length && roster.canCreate().ok;
}

// A finished draft, for screenshots of any page with `?debug&creator=<page>`.
export function sampleDraft(roster, now) {
  const { id } = roster.newDraft();
  const sheet = { name: 'Arwen Vale', gender: 'female', race: 'elf', class: 'archer', traits: [],
    attributes: { strength: 1, dexterity: 3, constitution: 2, intelligence: 1, wisdom: 0, charisma: 0 },
    description: 'A tall, quiet hunter in a weathered green hood, who never stands with her back to a door.',
    clues: ['Smells faintly of pine resin', 'Hums old songs under her breath'] };
  return { id, sheet: setAge(sheet, 34, id, now).sheet, skin: DEFAULT_SKIN, toneChosen: false };
}

export class Creation {
  constructor({ roster, now = () => Date.now(), start = 'welcome', draft = null }) {
    Object.assign(this, { roster, now });
    this.draft = draft ?? { ...roster.newDraft(), skin: DEFAULT_SKIN, toneChosen: false };
    if (!draft) this.draft.sheet.name = roster.suggestedName;
    this.go(Math.max(0, pageOf(start)));
  }

  get page() { return PAGES[this.index]; }
  get sheet() { return this.draft.sheet; }
  get ctx() { return { others: this.roster.characters, now: this.now() }; }

  // "Step n of N" on steps; null on info pages and the Summary.
  get counter() {
    const n = STEP_PAGES.indexOf(this.page) + 1;
    return n ? { n, total: STEP_PAGES.length } : null;
  }

  // What keeps this page from passing: invalid typed input first, then the
  // step's rule. On the Summary: any step's problem, or why no character can
  // be made now.
  get error() {
    if (this.page.kind === 'summary') {
      const allowed = this.allowed;
      return this.review[0]?.message ?? (allowed.ok ? null : allowed.reason);
    }
    if (this.page.kind !== 'step') return null;
    return Object.values(this.pending)[0]?.message ?? stepError(this.page.step, this.draft, this.ctx);
  }

  go(index, returning = false) {
    Object.assign(this, { index, returning, pending: {} });
    // The age starts at the youngest a character can be made.
    if (this.page.id === 'age' && !this.sheet.birthday) this.setAge(RULES.minAge);
  }

  next() {
    if (this.error) return false;
    this.go(this.returning ? SUMMARY : Math.min(this.index + 1, SUMMARY));
    return true;
  }

  back() {
    if (!this.index) return false;
    this.go(this.returning ? SUMMARY : this.index - 1);
    return true;
  }

  // Opens a step from the Summary; Next and Back return there. Gender is set
  // on the Description step.
  edit(step) { this.go(pageOf(step === 'gender' ? 'description' : step), true); }

  // Sets 'name', 'class', 'race', 'gender' or 'description'. A new race
  // brings its skin tone until the player picks one, and keeps the age even
  // past the race's maximum, which the Age step and the Summary then report.
  set(field, value) {
    this.sheet[field] = value;
    if (field === 'race' && !this.draft.toneChosen) {
      this.draft.skin = cleanSkin({ ...this.draft.skin, tone: toneForRace(value) ?? DEFAULT_SKIN.tone });
    }
  }

  get age() { return this.sheet.birthday ? ageOf(this.sheet, this.now()) : null; }

  setAge(age) { return this.apply(setAge(this.sheet, age, this.draft.id, this.now())); }
  setBirthday(text) { return this.apply(setBirthday(this.sheet, text, this.now())); }

  apply({ ok, sheet, message = null }) {
    if (ok) [this.draft.sheet, this.pending] = [sheet, {}];
    return { ok, message };
  }

  // Typed text: kept with its message until it is valid, since the rules
  // leave the last good birthday in the sheet.
  typeAge(text) { this.type('age', text, this.setAge(/^\s*\d+\s*$/.test(text) ? Number(text) : NaN)); }
  typeBirthday(text) { this.type('birthday', text, this.setBirthday(text)); }

  type(field, text, result) {
    if (!result.ok) this.pending = { ...this.pending, [field]: { text, message: result.message } };
  }

  get left() { return RULES.pool - attributesSpent(this.sheet.attributes); }

  // Why an attribute can't move one rank that way, or null.
  rankBlock(key, delta) {
    const rank = this.sheet.attributes[key];
    if (delta < 0) return rank > 0 ? null : 'Already at rank 0.';
    if (rank >= RULES.maxRank) return 'Maximum rank reached.';
    const cost = attributeCost(rank + 1) - attributeCost(rank);
    return cost > this.left ? `Costs ${cost} points; ${this.left} points available.` : null;
  }

  rank(key, delta) {
    if (this.rankBlock(key, delta)) return false;
    this.sheet.attributes = { ...this.sheet.attributes, [key]: this.sheet.attributes[key] + delta };
    return true;
  }

  addClue(raw) {
    const text = raw.trim();
    const clues = [...this.sheet.clues, text];
    const message = this.sheet.clues.length >= RULES.clues.most
      ? `You cannot have more than ${RULES.clues.most} clues.` : cluesError(clues, 0);
    if (!message) this.sheet.clues = clues;
    return { ok: !message, message };
  }

  removeClue(index) { this.sheet.clues = this.sheet.clues.filter((_, i) => i !== index); }

  // The Summary's rows, each with the step its Edit opens.
  get rows() {
    const s = this.sheet;
    const totals = attributeTotals(s);
    return [
      ['name', 'Name', s.name], ['gender', 'Gender', genderOf(s.gender)?.name ?? UNSET],
      ['class', 'Class', classOf(s.class)?.name ?? ''], ['race', 'Race', raceOf(s.race)?.name ?? ''],
      ['age', 'Age', `${this.age} (born ${formatBirthday(s.birthday)})`],
      ['attributes', 'Attributes', ATTRIBUTES.map((key) => `${ATTRIBUTE_NAMES[key]} ${totals[key]}`).join('\n')],
      ['description', 'Description', s.description], ['clues', 'Clues', s.clues.join('\n')],
    ].map(([step, label, value]) => ({ step, label, value }));
  }

  // Every step checked again, as Create does.
  get review() {
    return sheetErrors(this.draft, this.ctx).map((e) => ({ ...e, label: PAGES[pageOf(e.step)].title }));
  }

  get allowed() { return this.roster.canCreate(); }

  create() { return this.roster.create(this.draft); }
}

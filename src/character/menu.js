// The character menu's words: the sheet as the Character page lists it, and
// how long until a choice locks. Pure text from a character and the time, so
// the pages only lay it out.

import { ATTRIBUTE_NAMES, ATTRIBUTES, classOf, genderOf, raceOf, RULES, UNSET } from './catalog.js';
import { formatBirthday } from './calendar.js';
import { ageOf, attributeTotals, lockEndsAt } from './rules.js';

const MINUTE = 60 * 1000;

// "3d 4h 12m". Minutes round up, so a wait never reads 0 until it is over.
export function countdown(ms) {
  if (!(ms > 0)) return '0m';
  const minutes = Math.ceil(ms / MINUTE);
  const parts = [[Math.floor(minutes / 1440), 'd'], [Math.floor(minutes / 60) % 24, 'h'], [minutes % 60, 'm']];
  return parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`).join(' ');
}

// Whether a field has locked and when it does, or null for one that never
// locks.
export function lockState(character, field, now) {
  const at = lockEndsAt(character, field);
  return at === null ? null : { locked: now >= at, at };
}

const dateOf = (ms) => new Date(ms).toLocaleDateString();

// "Locked since {date}" or "Locks in 3d 4h".
export function lockNote(lock, now, formatDate = dateOf) {
  return lock.locked ? `Locked since ${formatDate(lock.at)}` : `Locks in ${countdown(lock.at - now)}`;
}

// The Character page's rows in sheet order: `{ label, value }`, with a
// `list` for attributes and clues, the race's `colour` and a lock `note`.
// `shown` is the name this visit shows when ?name= overrides it.
export function sheetRows(character, now, { shown = null, formatDate = dateOf } = {}) {
  const { sheet } = character;
  const note = (field) => lockNote(lockState(character, field, now), now, formatDate);
  const totals = attributeTotals(sheet);
  const race = raceOf(sheet.race);
  const remark = shown && shown !== sheet.name ? ` (shown as ${shown} this visit)` : '';
  return [
    { label: 'Name', value: `${sheet.name}${remark}` },
    { label: 'Gender', value: genderOf(sheet.gender)?.name ?? UNSET },
    { label: 'Age', value: String(ageOf(sheet, now)), note: note('age') },
    { label: 'Birthday', value: formatBirthday(sheet.birthday) },
    { label: 'Race', value: race?.name ?? UNSET, colour: race?.colour ?? null, note: note('race') },
    { label: 'Description', value: sheet.description },
    { label: 'Class', value: classOf(sheet.class)?.name ?? UNSET, note: note('class') },
    { label: 'Attributes', list: ATTRIBUTES.map((key) => `${ATTRIBUTE_NAMES[key]} ${totals[key]}`), note: note('attributes') },
    { label: 'Clues', list: [...sheet.clues] },
  ];
}

// The Characters page's rows, most recently played first, then by name:
// `{ id, name, line: 'Elf · Archer · 34', active, play }`, where `play` is
// whether Play as may switch to it now.
export function rosterRows(roster, now) {
  const active = roster.active?.id;
  const played = (character) => character.switchedAt ?? character.createdAt;
  return roster.characters
    .sort((a, b) => played(b) - played(a) || a.sheet.name.localeCompare(b.sheet.name))
    .map(({ id, sheet }) => ({ id, name: sheet.name, active: id === active, play: roster.canSwitch(id),
      line: [raceOf(sheet.race)?.name ?? UNSET, classOf(sheet.class)?.name ?? UNSET, ageOf(sheet, now)].join(' · ') }));
}

// Whether Create character may start one now, with the slots used.
export function createState(roster) {
  return { ...roster.canCreate(), used: `${roster.characters.length} of ${RULES.slots} character slots used` };
}

const dateTimeOf = (ms) => new Date(ms).toLocaleString();

// A refusal and, when it ends, how long until and when.
export function waitText({ reason, opensAt }, now, formatDate = dateTimeOf) {
  return opensAt ? `${reason} Opens in ${countdown(opensAt - now)}, on ${formatDate(opensAt)}.` : reason;
}

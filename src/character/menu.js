// The character menu's words: the sheet as the Character page lists it, and
// how long until a choice locks. Pure text from a character and the time, so
// the pages only lay it out.

import { ATTRIBUTE_NAMES, ATTRIBUTES, classOf, genderOf, raceOf, UNSET } from './catalog.js';
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

// The Character page's rows in sheet order: `{ label, value }`, with a
// `list` for attributes and clues, the race's `colour` and a lock `note`.
// `shown` is the name this visit shows when ?name= overrides it.
export function sheetRows(character, now, { shown = null, formatDate = dateOf } = {}) {
  const { sheet } = character;
  const note = (field) => {
    const lock = lockState(character, field, now);
    return lock.locked ? `Locked since ${formatDate(lock.at)}` : `Locks in ${countdown(lock.at - now)}`;
  };
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

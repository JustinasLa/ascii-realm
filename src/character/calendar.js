// The realm calendar. A realm date keeps the real day and month and counts
// years 1647 fewer, so 2026 is 379 AE. Characters store a birthday in it and
// grow older in real time.
//
// Dates are plain `{ y, m, d }` integers with day counts for spans. `Date`
// is read only for the player's local "today": its arithmetic maps years
// 0-99 to the 1900s and steps across daylight saving.

export const YEAR_OFFSET = 1647;
export const ERA = 'AE';

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m) => m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

const realDate = (y, m, d) => Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
  && y >= 0 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

// Days since 1970-01-01 in the proleptic Gregorian calendar, and back.
export function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const dayNumber = ({ y, m, d }) => daysFromCivil(y, m, d);

export function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

// The same day and month `years` earlier; 29 February becomes the 28th in a
// year without one.
const minusYears = ({ y, m, d }, years) => ({ y: y - years, m, d: Math.min(d, daysInMonth(y - years, m)) });

export const realmYear = (realYear) => realYear - YEAR_OFFSET;

// Today in the realm, from the player's local calendar date.
export function realmToday(nowMs) {
  const date = new Date(nowMs);
  const y = realmYear(date.getFullYear());
  const m = date.getMonth() + 1;
  return { y, m, d: Math.min(date.getDate(), daysInMonth(y, m)) };
}

const pad = (n, width) => String(n).padStart(width, '0');
export const toIso = ({ y, m, d }) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

// A stored birthday, 'YYYY-MM-DD' with a four-digit year, or null.
export function fromIso(iso) {
  const match = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  return realDate(y, m, d) ? { y, m, d } : null;
}

// Full years from `birthdayIso` to `today`, counted as whole months like a
// birthday: 0 if the date is invalid or still to come.
export function ageOn(birthdayIso, today) {
  const birthday = fromIso(birthdayIso);
  if (!birthday) return 0;
  let months = (today.y * 12 + today.m) - (birthday.y * 12 + birthday.m);
  if (months > 0 && today.d < birthday.d) months--;
  return Math.max(0, Math.floor(months / 12));
}

// FNV-1a, 32 bits, over UTF-16 code units.
export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

// A birthday that makes a character exactly `age` on `today`. The day within
// that year-long window comes from a hash of `<salt>:<age>`, so the same
// character and age always give the same birthday.
export function birthdayFromAge(age, today, salt) {
  if (!Number.isInteger(age) || age < 0) return null;
  const earliest = dayNumber(minusYears(today, age + 1)) + 1;
  const latest = dayNumber(minusYears(today, age));
  const offset = fnv1a32(`${salt}:${age}`) % (latest - earliest + 1);
  return toIso(civilFromDays(earliest + offset));
}

// A typed birthday: 'DD.MM.YYYY', 'DD/MM/YYYY' (commas read as full stops)
// or a stored 'YYYY-MM-DD'. Gives the stored form, or null.
export function parseBirthday(input) {
  if (typeof input !== 'string') return null;
  const match = /^(\d{1,2})[./](\d{1,2})[./](\d{1,4})$/.exec(input.trim().replaceAll(',', '.'));
  if (!match) return fromIso(input) && toIso(fromIso(input));
  const [d, m, y] = match.slice(1).map(Number);
  return realDate(y, m, d) ? toIso({ y, m, d }) : null;
}

export const formatYear = (y) => `${y} ${ERA}`;

// '14.07.251 AE', or 'Unset' with no valid birthday.
export function formatBirthday(iso) {
  const date = fromIso(iso);
  return date ? `${pad(date.d, 2)}.${pad(date.m, 2)}.${formatYear(date.y)}` : 'Unset';
}

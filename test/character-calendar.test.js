import assert from 'node:assert/strict';
import test from 'node:test';
import { ageOn, birthdayFromAge, civilFromDays, daysFromCivil, daysInMonth, ERA, fnv1a32, formatBirthday, formatYear,
  fromIso, isLeap, parseBirthday, realmToday, realmYear, toIso, YEAR_OFFSET } from '../src/character/calendar.js';

// Local noon, so the date doesn't depend on the time zone.
const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

test('the realm year is the real year less 1647', () => {
  assert.equal(YEAR_OFFSET, 1647);
  assert.equal(ERA, 'AE');
  assert.equal(realmYear(2026), 379);
  assert.deepEqual(realmToday(at(2026, 10, 26)), { y: 379, m: 10, d: 26 });
  assert.equal(formatYear(379), '379 AE');
});

test('real leap days fall on 28 February in the realm', () => {
  assert.deepEqual(realmToday(at(2028, 2, 28)), { y: 381, m: 2, d: 28 });
  assert.deepEqual(realmToday(at(2028, 2, 29)), { y: 381, m: 2, d: 28 });
  assert.deepEqual(realmToday(at(2027, 3, 1)), { y: 380, m: 3, d: 1 });
});

test('leap years', () => {
  assert.equal(isLeap(300), false);
  assert.equal(isLeap(304), true);
  assert.equal(isLeap(400), true);
  assert.equal(isLeap(380), true);
  assert.equal(isLeap(379), false);
  assert.deepEqual([1, 2, 4, 12].map((m) => daysInMonth(379, m)), [31, 28, 30, 31]);
  assert.equal(daysInMonth(380, 2), 29);
});

test('day numbers round-trip', () => {
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.equal(daysFromCivil(2000, 3, 1), 11017);
  for (const day of [-800000, -1, 0, 59, 60, 11016, 100000]) {
    const { y, m, d } = civilFromDays(day);
    assert.equal(daysFromCivil(y, m, d), day);
  }
  assert.deepEqual(civilFromDays(daysFromCivil(351, 10, 2)), { y: 351, m: 10, d: 2 });
});

test('stored dates are four-digit ISO', () => {
  assert.equal(toIso({ y: 351, m: 10, d: 2 }), '0351-10-02');
  assert.deepEqual(fromIso('0351-10-02'), { y: 351, m: 10, d: 2 });
  assert.deepEqual(fromIso(' 0351-10-02 '), { y: 351, m: 10, d: 2 });
  for (const bad of ['351-10-02', '0351-13-01', '0351-04-31', '0300-02-29', 'x', '', null, 42]) assert.equal(fromIso(bad), null);
});

test('typed birthdays', () => {
  for (const input of ['02.10.351', '02/10/351', '02,10,351', '2.10.351', '0351-10-02']) {
    assert.equal(parseBirthday(input), '0351-10-02', input);
  }
  assert.equal(parseBirthday('29.02.304'), '0304-02-29');
  for (const bad of ['31.04.351', '29.02.300', '1.2', 'a.b.c', '00.01.351', '', null, undefined, 5]) {
    assert.equal(parseBirthday(bad), null, String(bad));
  }
});

test('birthdays print as DD.MM.YYYY AE', () => {
  assert.equal(formatBirthday('0351-10-02'), '02.10.351 AE');
  assert.equal(formatBirthday('0251-07-14'), '14.07.251 AE');
  assert.equal(formatBirthday(null), 'Unset');
  assert.equal(formatBirthday('nonsense'), 'Unset');
});

test('age counts whole years to the birthday', () => {
  const today = { y: 379, m: 10, d: 26 };
  assert.equal(ageOn('0349-10-26', today), 30);
  assert.equal(ageOn('0349-10-27', today), 29);
  assert.equal(ageOn('0349-11-01', today), 29);
  assert.equal(ageOn('0349-09-30', today), 30);
  assert.equal(ageOn('0380-01-01', today), 0);
  assert.equal(ageOn('0379-10-27', today), 0);
  assert.equal(ageOn('bad', today), 0);
  // A 29 February birthday comes round on 1 March in other years.
  assert.equal(ageOn('0360-02-29', { y: 378, m: 2, d: 28 }), 17);
  assert.equal(ageOn('0360-02-29', { y: 378, m: 3, d: 1 }), 18);
  assert.equal(ageOn('0360-02-29', { y: 380, m: 2, d: 29 }), 20);
});

test('FNV-1a 32-bit known values', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
});

test('a chosen age always gives a birthday of exactly that age', () => {
  for (const y of [379, 380]) {
    for (const [m, d] of [[1, 1], [2, 28], [3, 1], [12, 31]]) {
      const today = { y, m, d };
      for (let age = 18; age <= 210; age++) {
        const birthday = birthdayFromAge(age, today, `c${age}`);
        assert.equal(ageOn(birthday, today), age, `${age} on ${toIso(today)}`);
      }
    }
  }
  assert.equal(ageOn(birthdayFromAge(20, { y: 380, m: 2, d: 29 }, 'x'), { y: 380, m: 2, d: 29 }), 20);
});

test('the same id and age give the same birthday', () => {
  const today = { y: 379, m: 10, d: 26 };
  assert.equal(birthdayFromAge(30, today, 'c0123'), birthdayFromAge(30, today, 'c0123'));
  assert.notEqual(birthdayFromAge(30, today, 'c0123'), birthdayFromAge(30, today, 'c0124'));
  // By hand: the window is 0348-10-27 .. 0349-10-26 (365 days), and
  // fnv1a32('salt:30') % 365 days in.
  const offset = fnv1a32('salt:30') % 365;
  assert.equal(birthdayFromAge(30, today, 'salt'), toIso(civilFromDays(daysFromCivil(348, 10, 27) + offset)));
  assert.equal(birthdayFromAge(-1, today, 'x'), null);
  assert.equal(birthdayFromAge(1.5, today, 'x'), null);
});

test('both ends of the birthday window are reachable', () => {
  const today = { y: 379, m: 10, d: 26 };
  const salts = (wanted) => {
    for (let i = 0; i < 100000; i++) if (fnv1a32(`s${i}:30`) % 365 === wanted) return `s${i}`;
    return null;
  };
  assert.equal(birthdayFromAge(30, today, salts(0)), '0348-10-27');
  assert.equal(birthdayFromAge(30, today, salts(364)), '0349-10-26');
});

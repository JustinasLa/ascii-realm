import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isPhone, PHONE_QUERY, watchPhone } from '../src/core/phone.js';

const touch = { coarse: true, hover: false };
const mouse = { coarse: false, hover: true };

test('phones in portrait and landscape use the phone layout', () => {
  assert.equal(isPhone({ ...touch, width: 390, height: 844 }), true);
  assert.equal(isPhone({ ...touch, width: 844, height: 390 }), true);
  assert.equal(isPhone({ ...touch, width: 320, height: 568 }), true);
});

test('desktops, touchscreen laptops and tablets keep their layout', () => {
  assert.equal(isPhone({ ...mouse, width: 500, height: 800 }), false, 'narrow desktop window');
  assert.equal(isPhone({ ...mouse, width: 1280, height: 500 }), false, 'short desktop window');
  assert.equal(isPhone({ ...mouse, width: 1366, height: 768 }), false, 'touchscreen laptop: fine primary pointer');
  assert.equal(isPhone({ ...touch, width: 820, height: 1180 }), false, 'tablet portrait');
  assert.equal(isPhone({ ...touch, width: 1180, height: 820 }), false, 'tablet landscape');
  assert.equal(isPhone({ coarse: true, hover: true, width: 390, height: 844 }), false, 'a phone with a mouse attached');
});

test('the short side decides at exactly 600 CSS px', () => {
  assert.equal(isPhone({ ...touch, width: 600, height: 960 }), true);
  assert.equal(isPhone({ ...touch, width: 960, height: 600 }), true);
  assert.equal(isPhone({ ...touch, width: 601, height: 960 }), false);
});

test('style.css uses the same phone query exactly once', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.equal(css.split(`@media ${PHONE_QUERY} {`).length - 1, 1);
});

function fakeWindow(matches) {
  const query = Object.assign(new EventTarget(), { matches });
  const classes = new Set();
  const classList = { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); } };
  const queries = [];
  const win = {
    matchMedia: (text) => { queries.push(text); return query; },
    document: { documentElement: { classList } },
  };
  return { win, query, classes, queries };
}

test('watchPhone follows the media query and marks the document', () => {
  const { win, query, classes, queries } = fakeWindow(false);
  const changes = [];
  const device = watchPhone(win, (phone) => changes.push(phone));
  assert.deepEqual(queries, [PHONE_QUERY]);
  assert.equal(device.phone, false);
  assert.equal(classes.has('is-phone'), false);
  query.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
  assert.equal(device.phone, true);
  assert.equal(classes.has('is-phone'), true);
  query.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
  assert.deepEqual(changes, [true], 'an unchanged answer is not reported again');
  query.matches = false;
  query.dispatchEvent(new Event('change'));
  assert.deepEqual(changes, [true, false], 'falls back to the query when the event has no answer');
  assert.equal(classes.has('is-phone'), false);
  device.dispose();
  query.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
  assert.deepEqual(changes, [true, false], 'disposed watchers stop listening');
});

test('watchPhone starts as a phone when the query already matches', () => {
  const { win, classes } = fakeWindow(true);
  assert.equal(watchPhone(win).phone, true);
  assert.equal(classes.has('is-phone'), true);
});

test('watchPhone is safe without matchMedia or change events', () => {
  const missing = watchPhone({});
  assert.equal(missing.phone, false);
  missing.dispose();
  const bare = watchPhone({ matchMedia: () => ({ matches: false }) });
  assert.equal(bare.phone, false);
  bare.dispose();
});

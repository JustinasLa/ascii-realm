import assert from 'node:assert/strict';
import test from 'node:test';
import { HIT_MS, HURT_MS, MIN_GAP_MS, createHaptics } from '../src/core/haptics.js';

const recorder = () => {
  const calls = [];
  return { calls, nav: { vibrate: ms => { calls.push(ms); return true; } } };
};

test('a landed blow and a wound give short pulses of their own lengths', () => {
  let now = 0;
  const { calls, nav } = recorder();
  const haptics = createHaptics({ nav, now: () => now });
  assert.equal(haptics.hit(), true);
  now += MIN_GAP_MS;
  assert.equal(haptics.hurt(), true);
  assert.deepEqual(calls, [HIT_MS, HURT_MS]);
  assert.deepEqual([HIT_MS, HURT_MS, MIN_GAP_MS], [12, 30, 90]);
});

test('pulses are rate-limited, but a wound may cut a hit short', () => {
  let now = 1000;
  const { calls, nav } = recorder();
  const haptics = createHaptics({ nav, now: () => now });
  haptics.hit();
  now += 30;
  assert.equal(haptics.hit(), false, 'a second hit inside the gap is dropped');
  now += 20;
  assert.equal(haptics.hurt(), true, 'a wound 20 ms after a hit still comes through');
  now += 20;
  assert.equal(haptics.hurt(), false, 'a second wound inside the gap is dropped');
  assert.equal(haptics.hit(), false);
  now += MIN_GAP_MS;
  assert.equal(haptics.hit(), true);
  assert.deepEqual(calls, [12, 30, 12]);
});

test('no vibration API, a refusal, a throw or a desktop are all silent', () => {
  assert.equal(createHaptics({ nav: {} }).hit(), false);
  assert.equal(createHaptics({ nav: undefined }).hurt(), false);
  assert.equal(createHaptics({ nav: { vibrate: () => false } }).hit(), false);
  assert.equal(createHaptics({ nav: { vibrate: () => { throw new Error('blocked'); } } }).hit(), false);
  const { calls, nav } = recorder();
  assert.equal(createHaptics({ nav, enabled: () => false }).hit(), false);
  assert.deepEqual(calls, []);
  // The defaults read the browser's navigator and clock.
  assert.equal(typeof createHaptics().hit(), 'boolean');
});

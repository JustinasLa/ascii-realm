import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playPickup } from '../src/audio/pickup.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';

test('a pickup brushes and taps on the shared effects bus at the pickup', () => {
  const audio = fakeRecordedAudio();
  const handles = playPickup(audio.engine, { type: 'pickup', id: 'stick', count: 2, x: 4, y: -3 });
  assert.equal(handles.length, 2);
  assert.ok(audio.routes.length > 0 && audio.routes.every((route) => route.bus === 'sfx' && route.x === 4 && route.y === -3));
  for (const handle of handles) handle.stop();
});

test('failed, empty, unrelated or silent pickups make no sound', () => {
  const audio = fakeRecordedAudio();
  for (const event of [{ type: 'pickup', count: 0 }, { type: 'pickup', success: false },
    { type: 'pickup', count: NaN }, { type: 'drop', count: 1 }, null]) {
    assert.deepEqual(playPickup(audio.engine, event), []);
  }
  audio.engine.context.state = 'suspended';
  assert.deepEqual(playPickup(audio.engine, { type: 'pickup', count: 1 }), []);
  assert.equal(audio.routes.length, 0);
});

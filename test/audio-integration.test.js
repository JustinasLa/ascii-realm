import assert from 'node:assert/strict';
import test from 'node:test';
import { GameAudio } from '../src/audio/audio.js';

test('suspended game audio clears persistent voices even without another animation frame', () => {
  const audio = new GameAudio({}, { context: { state: 'suspended' }, setListener() {} });
  const paused = [];
  for (const key of ['charge', 'music', 'ambience']) audio[key].pause = () => paused.push(key);
  audio.update(0.016, 1, {}, { x: 2, y: 3 }, []);
  assert.deepEqual(paused, ['charge', 'music', 'ambience']);
  paused.length = 0;
  audio.pause();
  assert.deepEqual(paused, ['charge', 'music', 'ambience']);
});

test('locked event playback never queries terrain or allocates audio', () => {
  const audio = new GameAudio({ typeAt() { assert.fail('locked sound should not sample terrain'); } }, { context: null });
  for (const type of ['step', 'jump', 'land', 'skid', 'draw', 'sheathe', 'swing', 'slam', 'whirl']) {
    audio.play({ type, x: 0, y: 0 });
  }
});

test('pausing clears pending effect voices as well as persistent ambience', () => {
  const audio = new GameAudio({}, { context: null });
  let stops = 0;
  audio.effects.add({ stop() { stops++; } });
  audio.pause();
  audio.pause();
  assert.equal(stops, 1);
  assert.equal(audio.effects.size, 0);
});

test('audio signals follow the camera and source charge follows the player', () => {
  let listener;
  const audio = new GameAudio({}, { context: { state: 'running' }, setListener(...position) { listener = position; } });
  audio.environment.update = (...args) => {
    assert.deepEqual(args, [0.016, 2, 3, 42]);
    return { night: 0.8, gust: 0.4, water: null };
  };
  audio.charge.update = (...args) => assert.deepEqual(args, [0.5, 9, 10]);
  const fireflies = [{ x: 1, y: 2, phase: 0 }];
  audio.ambience.update = signals => {
    assert.equal(signals.time, 42);
    assert.equal(signals.gust, 0.4);
    assert.equal(signals.fireflies, fireflies);
  };
  audio.music.update = signals => assert.equal(signals.night, 0.8);
  audio.update(0.016, 42, { x: 9, y: 10, combat: { charge: 0.5 } }, { x: 2, y: 3 }, fireflies);
  assert.deepEqual(listener, [2, 3]);
});

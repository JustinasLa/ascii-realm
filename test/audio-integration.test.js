import assert from 'node:assert/strict';
import test from 'node:test';
import { GameAudio } from '../src/audio/audio.js';

test('suspended game audio clears persistent voices even without another animation frame', () => {
  const audio = new GameAudio({}, { context: { state: 'suspended' }, setListener() {} });
  const paused = [];
  for (const key of ['charge', 'music', 'ambience', 'fires', 'weather']) audio[key].pause = () => paused.push(key);
  audio.update(0.016, 1, {}, { x: 2, y: 3 }, []);
  assert.deepEqual(paused, ['charge', 'music', 'ambience', 'fires', 'weather']);
  paused.length = 0;
  audio.pause();
  assert.deepEqual(paused, ['charge', 'music', 'ambience', 'fires', 'weather']);
});

test('locked event playback never queries terrain or allocates audio', () => {
  const audio = new GameAudio({ typeAt() { assert.fail('locked sound should not sample terrain'); } }, { context: null });
  for (const type of ['step', 'jump', 'land', 'skid', 'draw', 'sheathe', 'swing', 'slam', 'whirl', 'fire-stir']) {
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
  const fires = [{ id: 1, x: 4, y: 5, seed: 7 }];
  audio.fires.update = (...args) => assert.deepEqual(args, [fires, 42]);
  audio.ambience.update = signals => {
    assert.equal(signals.time, 42);
    assert.equal(signals.gust, 0.4);
    assert.equal(signals.fireflies, fireflies);
  };
  audio.music.update = signals => assert.equal(signals.night, 0.8);
  audio.weather.update = signals => assert.deepEqual(signals, { time: 42, dt: 0.016, water: null });
  audio.update(0.016, 42, { x: 9, y: 10, combat: { charge: 0.5 } }, { x: 2, y: 3 }, fireflies, fires);
  assert.deepEqual(listener, [2, 3]);
});

test('rain splashes sample the player shoreline independently of the camera and skip dry weather', () => {
  const audio = new GameAudio({}, { context: { state: 'running' }, setListener() {} });
  const shoreline = { x: 10.5, y: 10.5, strength: 0.95 };
  audio.environment.update = () => ({ night: 1, gust: 0.4, water: null });
  let waterSamples = 0;
  audio.weatherEnvironment.update = (...args) => {
    assert.deepEqual(args, [0.016, 9, 10, 42]);
    waterSamples++;
    return { water: shoreline };
  };
  for (const key of ['charge', 'ambience', 'music']) audio[key].update = () => {};
  let received;
  audio.weather.update = signals => { received = signals; };
  const player = { x: 9, y: 10, combat: { charge: 0 } };
  const camera = { x: -100, y: 100 };
  audio.weather.preset = 'rain';
  audio.update(0.016, 42, player, camera, []);
  assert.equal(waterSamples, 1);
  assert.deepEqual(received, { time: 42, dt: 0.016, water: shoreline });

  audio.weather.preset = 'blizzard';
  audio.update(0.016, 42, player, camera, []);
  assert.equal(waterSamples, 1, 'dry weather adds no player-water terrain sampling');
  assert.equal(received.water, null);

  audio.weather.preset = 'rain';
  audio.weather.setIntensity(0);
  audio.update(0.016, 42, player, camera, []);
  assert.equal(waterSamples, 1, 'silent rain adds no player-water terrain sampling');
  assert.equal(received.water, null);
});

test('the world clock sets how dark the music and ambience hear it, awake or not', () => {
  const asleep = new GameAudio({}, { context: { state: 'suspended' }, setListener() {} });
  const heard = [];
  asleep.music.update = (signals) => heard.push(signals.night);
  asleep.update(0.016, 0, {}, { x: 0, y: 0 }, [], [], 0.25);
  asleep.update(0.016, 0, {}, { x: 0, y: 0 }, []);
  assert.deepEqual(heard, [0.25, 1], 'without a clock, its own night (full at time 0)');

  const awake = new GameAudio({}, { context: { state: 'running' }, setListener() {} });
  awake.environment.update = () => ({ night: 0.8, gust: 0.4, water: null });
  for (const key of ['charge', 'fires', 'weather']) awake[key].update = () => {};
  const music = [], ambience = [];
  awake.music.update = (signals) => music.push(signals.night);
  awake.ambience.update = (signals) => ambience.push([signals.night, signals.gust]);
  awake.update(0.016, 42, { combat: { charge: 0 } }, { x: 0, y: 0 }, [], [], 0.1);
  awake.update(0.016, 42, { combat: { charge: 0 } }, { x: 0, y: 0 }, [], [], undefined);
  assert.deepEqual(music, [0.1, 0.8]);
  assert.deepEqual(ambience, [[0.1, 0.4], [0.8, 0.4]]);
});

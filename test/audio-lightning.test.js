import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { GameAudio } from '../src/audio/audio.js';
import { LIGHTNING_RECORDINGS, prepareLightningSounds, playLightning } from '../src/audio/lightning.js';
import { prepareWaterSounds } from '../src/audio/water.js';
import { WATER, STONE } from '../src/world/world.js';
import { fakeRecordedAudio as fakeAudio, loadTestRecording, sources } from '../test-support/recorded-audio.js';

const ready = async audio => {
  await prepareLightningSounds(audio.engine, { loadBuffer: loadTestRecording });
  await prepareWaterSounds(audio.engine, { loadBuffer: loadTestRecording });
};
function assertDisposed(audio) {
  assert.ok(audio.nodes.every(node => node.disconnects === 1));
  assert.ok(audio.routes.every(route => route.disposals === 1));
  assert.deepEqual(audio.invalid, []);
}

test('lightning uses a local CC0 recording with a real thunderclap and long rolling tail', async () => {
  const url = LIGHTNING_RECORDINGS.thunder[0];
  const bytes = await readFile(url);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 24000);
  const { duration } = await loadTestRecording(url);
  assert.equal(duration, 9.5);
  assert.equal(bytes.readInt16LE(44), 0);
  assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
  const license = await readFile(new URL('../assets/audio/lightning/LICENSE.txt', import.meta.url), 'utf8');
  for (const text of ['CC0 1.0', 'WuxiaScrub', 'rain-long-thunder', '21.38']) assert.ok(license.includes(text));
  const audio = fakeAudio();
  await ready(audio);
  const handles = playLightning(audio.engine, { x: -4.5, y: 12.5, strength: 0.8 });
  assert.equal(handles.length, 1);
  assert.equal(sources(audio)[0].buffer.id, 'thunder.wav');
  assert.equal(sources(audio)[0].loop, false);
  assert.ok(audio.routes.every(route => route.bus === 'weather' && route.x === -4.5 && route.y === 12.5));
  assert.ok(audio.nodes.every(node => ['source', 'gain'].includes(node.kind)));
  assert.equal(audio.allocations.length, 0);
  sources(audio)[0].onended();
  handles[0].stop();
  assertDisposed(audio);
});

test('locked and silent lightning allocates no sources and respects Master, Ambience and Weather', async () => {
  const audio = fakeAudio();
  let loads = 0;
  const options = { loadBuffer: async url => { loads++; return loadTestRecording(url); } };
  audio.context.state = 'suspended';
  assert.equal(await prepareLightningSounds(audio.engine, options), false);
  assert.deepEqual(playLightning(audio.engine), []);
  audio.context.state = 'running';
  audio.engine.muted = true;
  assert.equal(await prepareLightningSounds(audio.engine), false);
  assert.deepEqual(playLightning(audio.engine), []);
  audio.engine.muted = false;
  for (const bus of ['master', 'ambience', 'weather']) {
    audio.engine.volumes[bus] = 0;
    assert.equal(await prepareLightningSounds(audio.engine), false);
    assert.deepEqual(playLightning(audio.engine), []);
    audio.engine.volumes[bus] = 0.7;
  }
  assert.deepEqual(playLightning(audio.engine, { strength: 0 }), []);
  assert.deepEqual(playLightning(null), []);
  assert.equal(loads, 0);
  assert.equal(audio.nodes.length, 0);
});

test('dry strikes play thunder; lake strikes add displaced water; distant flashes never splash', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const sound = new GameAudio({ typeAt: x => x > 0 ? WATER : STONE }, audio.engine);
  const dry = sound.play({ type: 'lightning', x: -5.5, y: 8.5, strength: 1 });
  assert.equal(dry.length, 1);
  assert.equal(dry[0].bus, 'weather');
  const wet = sound.play({ type: 'lightning', x: 5.5, y: 8.5, strength: 1 });
  assert.deepEqual(wet.map(handle => handle.bus), ['weather', 'sfx']);
  assert.equal(sources(audio).at(-1).buffer.id, 'splash-big.wav');
  assert.ok(audio.routes.slice(-2).every(route => route.x === 5.5 && route.y === 8.5));
  assert.equal(sound.play({ type: 'lightning', x: 5.5, y: 8.5, distant: true }).length, 1);
  assert.equal(sound.play({ type: 'lightning', x: 5.5, y: 8.5, thunder: false }).length, 1);
  const noPosition = new GameAudio({ typeAt() { assert.fail('distant or missing positions never query terrain'); } }, audio.engine);
  noPosition.play({ type: 'lightning', x: NaN, y: Infinity });
  noPosition.play({ type: 'lightning', x: 5.5, y: 8.5, distant: true });
  sound.pause();
  noPosition.pause();
  assertDisposed(audio);
});

test('rapid summoned lightning bounds thunder to four voices and releases every graph', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const handles = Array.from({ length: 20 }, () => playLightning(audio.engine, { strength: 1 })[0]);
  assert.equal(handles.filter(handle => !handle.ended).length, 4);
  for (const handle of handles) { handle.stop(); handle.stop(); }
  assertDisposed(audio);
});

test('natural storm strikes share the recorded sound, use actual impact coordinates and avoid duplicate thunder', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const sound = new GameAudio({ typeAt: () => WATER }, audio.engine);
  let bolts = 0;
  sound.weather.onLightning = event => { bolts++; return { ...event, x: 2.5, y: 9.5 }; };
  sound.weather.setPreset('thunderstorm');
  const group = sound.weather._active;
  group.events[0].next = audio.context.currentTime + 0.1;
  const before = sources(audio).length;
  audio.context.currentTime += 0.1;
  sound.weather.update({ time: 1, dt: 0.1 });
  assert.equal(bolts, 1);
  assert.equal(sources(audio).length - before, 2, 'one recorded thunder and one water impact, without layered noise thunder');
  assert.deepEqual(sources(audio).slice(before).map(source => source.buffer.id), ['thunder.wav', 'splash-big.wav']);
  assert.ok(audio.routes.slice(-2).every(route => route.x === 2.5 && route.y === 9.5));
  assert.equal(sound.weather._lightningSounds.size, 2);
  sound.weather.setIntensity(0);
  assert.ok([...sound.effects].every(handle => handle.ended));
  sound.weather.setIntensity(0.6);
  group.events[0].next = audio.context.currentTime + 0.1;
  audio.context.currentTime += 0.1;
  sound.weather.update({ time: 1.1, dt: 0.1 });
  assert.equal(bolts, 2);
  sound.weather.setPreset('clear');
  assert.ok([...sound.effects].every(handle => handle.ended));
  sound.pause();
  assertDisposed(audio);
});

test('dry automatic thunder works without a visual callback; sky flashes do not add water', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const sound = new GameAudio({ typeAt() { assert.fail('no ground impact is available'); } }, audio.engine);
  sound.weather.setPreset('distant-thunder');
  const group = sound.weather._active;
  group.events[0].next = audio.context.currentTime + 0.1;
  const before = sources(audio).length;
  audio.context.currentTime += 0.1;
  sound.weather.update({ time: 1, dt: 0.1 });
  assert.equal(sources(audio).length - before, 1);
  assert.equal(sources(audio).at(-1).buffer.id, 'thunder.wav');
  sound.pause();
  assertDisposed(audio);
});

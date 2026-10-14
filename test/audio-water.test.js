import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GameAudio } from '../src/audio/audio.js';
import { playFootstep } from '../src/audio/footsteps.js';
import { WATER_RECORDINGS, WaterSounds, prepareWaterSounds, playWaterSound } from '../src/audio/water.js';
import { SHORE, STONE, WATER } from '../src/world/world.js';
import { fakeRecordedAudio as fakeAudio, loadTestRecording, sources, peak } from '../test-support/recorded-audio.js';

const ready = audio => prepareWaterSounds(audio.engine, { loadBuffer: loadTestRecording });
const lake = { typeAt: () => WATER };
function assertDisposed(audio) {
  assert.ok(audio.routes.every(route => route.disposals === 1));
  assert.ok(audio.nodes.every(node => node.disconnects === 1));
  assert.deepEqual(audio.invalid, []);
}

test('water contacts use distinct local PCM recordings with intact runoff and CC0 provenance', async () => {
  const hashes = new Set();
  for (const url of Object.values(WATER_RECORDINGS).flat()) {
    const bytes = await readFile(url);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 24000);
    assert.equal(bytes.readUInt16LE(34), 16);
    const { duration } = await loadTestRecording(url);
    assert.ok(duration >= 0.2 && duration <= 3);
    const samples = [];
    for (let i = 44; i < bytes.length; i += 2) samples.push(bytes.readInt16LE(i) / 32768);
    assert.ok(Math.max(...samples) < 0.9);
    assert.ok(Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) > 0.025);
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 0);
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, 15);
  const license = await readFile(new URL('../assets/audio/water/LICENSE.txt', import.meta.url), 'utf8');
  for (const text of ['CC0 1.0', 'rosenberg3', 'wormer2', 'qubodup', '627004', '415670', '442773']) assert.ok(license.includes(text));
});

test('water steps, takeoffs and impacts play actual recordings without noise or filtering', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const signatures = [];
  for (const type of ['step', 'jump', 'land', 'splash', 'skid', 'slam', 'whirl', 'lightning']) {
    const handles = playWaterSound(audio.engine, { type, x: -2.5, y: 12.5, strength: 0.8 });
    assert.equal(handles.length, 1);
    const source = sources(audio).at(-1);
    signatures.push(source.buffer.id);
    assert.equal(source.loop, false);
    assert.deepEqual(source.starts, [audio.context.currentTime]);
    assert.equal(source.stops.length, 0, 'natural recorded runoff is never cut short');
    assert.ok(audio.routes.at(-1).bus === 'sfx' && audio.routes.at(-1).x === -2.5 && audio.routes.at(-1).y === 12.5);
    source.onended();
    assert.equal(handles[0].ended, true);
    handles[0].stop();
  }
  assert.ok(signatures[0].startsWith('wade-'));
  assert.ok(signatures[1].startsWith('lift-'));
  assert.ok(signatures[2].startsWith('splash-'));
  assert.ok(audio.nodes.every(node => ['source', 'gain'].includes(node.kind)));
  assert.equal(audio.allocations.length, 0, 'water never synthesizes a noise buffer');
  assertDisposed(audio);
});

test('strong running contacts and landings gain weight while retaining their recorded envelopes', async t => {
  t.mock.method(Math, 'random', () => 0.5);
  const walk = fakeAudio(), run = fakeAudio(), landing = fakeAudio();
  for (const audio of [walk, run, landing]) await ready(audio);
  const handles = [
    ...playWaterSound(walk.engine, { type: 'step', strength: 0.2 }),
    ...playWaterSound(run.engine, { type: 'step', strength: 0.8 }),
    ...playWaterSound(landing.engine, { type: 'land', strength: 1 }),
  ];
  assert.ok(peak(run) > peak(walk));
  assert.ok(peak(landing) > peak(run));
  assert.ok(sources(landing)[0].buffer.duration > sources(walk)[0].buffer.duration);
  assert.ok(sources(run)[0].playbackRate.calls[0].args[0] > sources(walk)[0].playbackRate.calls[0].args[0]);
  handles.forEach(handle => { handle.stop(); handle.stop(); });
  for (const audio of [walk, run, landing]) assertDisposed(audio);
});

test('locked, muted and zero-volume water contacts allocate nothing and never fetch or replay', async () => {
  const audio = fakeAudio();
  let loads = 0;
  const player = new WaterSounds(audio.engine, { loadBuffer: async url => { loads++; return loadTestRecording(url); } });
  for (const state of ['suspended', 'closed']) {
    audio.context.state = state;
    assert.equal(await player.prepare(), false);
    assert.deepEqual(player.contact({ type: 'land' }), []);
  }
  audio.context.state = 'running';
  audio.engine.muted = true;
  assert.equal(await player.prepare(), false);
  assert.deepEqual(player.contact({ type: 'step' }), []);
  audio.engine.muted = false;
  for (const bus of ['master', 'sfx']) {
    audio.engine.volumes[bus] = 0;
    assert.equal(await player.prepare(), false);
    assert.deepEqual(player.contact({ type: 'jump' }), []);
    audio.engine.volumes[bus] = 0.7;
  }
  for (const event of [{ type: 'step', strength: 0 }, { type: 'land', strength: -1 },
    { type: 'splash', volume: 0 }, { type: 'breath' }, { type: '__proto__' }, null]) {
    assert.deepEqual(player.contact(event), []);
  }
  assert.deepEqual(playWaterSound(null, { type: 'step' }), []);
  assert.equal(await prepareWaterSounds(null), false);
  assert.equal(loads, 0);
  assert.equal(audio.nodes.length, 0);
  await player.prepare();
  player.contact({ type: 'step' }).forEach(handle => handle.stop());
  assert.equal(sources(audio).length, 1);
  assertDisposed(audio);
});

test('concurrent preloads share decoded buffers and discard contacts received while loading', async () => {
  const audio = fakeAudio();
  let release;
  let loads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const first = prepareWaterSounds(audio.engine, { loadBuffer: async url => { loads++; await gate; return loadTestRecording(url); } });
  const second = prepareWaterSounds(audio.engine);
  assert.equal(first, second);
  assert.deepEqual(playWaterSound(audio.engine, { type: 'step' }), []);
  assert.equal(audio.nodes.length, 0);
  release();
  assert.equal(await first, true);
  assert.equal(loads, 15);
  await prepareWaterSounds(audio.engine);
  assert.equal(loads, 15);
  assert.equal(audio.nodes.length, 0, 'missed contacts never replay after decoding');
  const handles = playWaterSound(audio.engine, { type: 'step' });
  assert.equal(handles.length, 1);
  handles.forEach(handle => handle.stop());
  assertDisposed(audio);
});

test('water skids throttle at time zero without suppressing new footsteps or context replacement', async () => {
  const audio = fakeAudio();
  const player = new WaterSounds(audio.engine, { loadBuffer: loadTestRecording });
  await player.prepare();
  audio.context.currentTime = 0;
  assert.equal(player.contact({ type: 'skid' }).length, 1);
  audio.context.currentTime = 0.1;
  assert.deepEqual(player.contact({ type: 'skid' }), []);
  assert.equal(player.contact({ type: 'step' }).length, 1);
  audio.context.currentTime = 0.13;
  assert.equal(player.contact({ type: 'skid' }).length, 1);
  const next = fakeAudio();
  audio.engine.context = next.context;
  await player.prepare();
  assert.equal(player.contact({ type: 'skid' }).length, 1);
  player.pause();
  assertDisposed(audio);
  assert.ok(next.nodes.every(node => node.disconnects === 1));
});

test('recorded water voices clean up malformed positions, natural completion and playback failure', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const handles = playWaterSound(audio.engine, { type: 'splash', strength: Infinity, volume: NaN, x: NaN, y: Infinity });
  assert.equal(handles.length, 1);
  assert.ok(audio.routes.every(route => route.x === undefined && route.y === undefined));
  sources(audio)[0].onended();
  assert.ok(handles.every(handle => handle.ended));
  handles.forEach(handle => handle.stop());
  assertDisposed(audio);
  const failure = fakeAudio();
  await ready(failure);
  failure.context.createGain = () => { throw new Error('audio device changed'); };
  assert.deepEqual(playWaterSound(failure.engine, { type: 'land' }), []);
  assertDisposed(failure);
});

test('missing water recordings back off, retry only missing files and never substitute scratching noise', async () => {
  const audio = fakeAudio();
  let missing = true, loads = 0;
  const player = new WaterSounds(audio.engine, { loadBuffer: async url => {
    loads++;
    if (missing && url.pathname.endsWith('wade-1.wav')) throw new Error('offline');
    return loadTestRecording(url);
  } });
  assert.equal(await player.prepare(), false);
  assert.equal(loads, 15);
  assert.deepEqual(player.contact({ type: 'step' }), []);
  assert.equal(await player.prepare(), false);
  assert.equal(loads, 15);
  missing = false;
  audio.context.currentTime += 5;
  assert.equal(await player.prepare(), true);
  assert.equal(loads, 16);
  player.contact({ type: 'step' }).forEach(handle => handle.stop());
  assert.equal(audio.allocations.length, 0);
  assertDisposed(audio);
});

test('GameAudio selects recorded water for contact events and stops all runoff on pause', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const sound = new GameAudio(lake, audio.engine);
  for (const type of ['step', 'jump', 'land', 'splash']) sound.play({ type, x: 5.5, y: 8.5, strength: 0.7 });
  assert.equal(sound.effects.size, 4);
  assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === 5.5 && route.y === 8.5));
  sound.pause();
  sound.pause();
  assert.equal(sound.effects.size, 0);
  assertDisposed(audio);
});

test('wave-washed shore and direct wet footsteps share recordings; dry stone keeps its footstep', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const sound = new GameAudio({ typeAt: x => x === 0 ? SHORE : WATER }, audio.engine);
  sound.play({ type: 'step', x: 0.5, y: 0.5 });
  assert.equal(sound.effects.size, 1);
  assert.ok(sources(audio)[0].buffer.id.startsWith('wade-'));
  const [direct] = playFootstep(audio.engine, 'water');
  assert.ok(sources(audio).at(-1).buffer.id.startsWith('wade-'));
  direct.stop();
  sound.pause();
  assertDisposed(audio);
  const dry = fakeAudio();
  const stone = new GameAudio({ typeAt: () => STONE }, dry.engine);
  stone.play({ type: 'splash', x: 0.5, y: 0.5 });
  assert.equal(dry.routes.length, 0);
  stone.play({ type: 'step', x: 0.5, y: 0.5 });
  assert.equal(stone.effects.size, 3);
  stone.pause();
  assertDisposed(dry);
});

test('sword strikes add natural fluid impacts only where the visible strike meets water', async () => {
  for (const type of ['slam', 'whirl']) {
    const audio = fakeAudio();
    await ready(audio);
    const sound = new GameAudio({ typeAt: x => x > 0 ? WATER : STONE }, audio.engine);
    sound.play({ type, x: 5.5, y: 8.5, strength: 0.8 });
    assert.ok(audio.routes.some(route => route.bus === 'sword'));
    assert.ok(audio.routes.some(route => route.bus === 'sfx'));
    const before = audio.routes.length;
    sound.play({ type, x: -5.5, y: 8.5, strength: 0.8 });
    assert.ok(audio.routes.slice(before).every(route => route.bus === 'sword'));
    sound.pause();
    assertDisposed(audio);
  }
});

test('recorded water visits 25 articulations and six footfalls without adjacent repeats', async t => {
  t.mock.method(Math, 'random', () => 0.5);
  const audio = fakeAudio();
  await ready(audio);
  const rates = [], clips = [];
  for (let i = 0; i < 50; i++) {
    const [handle] = playWaterSound(audio.engine, { type: 'step', strength: 0.4 });
    const source = sources(audio).at(-1);
    rates.push(source.playbackRate.calls[0].args[0]);
    clips.push(source.buffer.id);
    handle.stop();
  }
  assert.equal(new Set(rates.slice(0, 25)).size, 25);
  assert.equal(new Set(rates.slice(25)).size, 25);
  assert.ok(rates.every((rate, i) => rate >= 0.985 && rate <= 1.015 && (i === 0 || rate !== rates[i - 1])));
  for (let i = 0; i < 48; i += 6) assert.equal(new Set(clips.slice(i, i + 6)).size, 6);
  assert.ok(clips.every((clip, i) => i === 0 || clip !== clips[i - 1]));
  assertDisposed(audio);
});

test('rapid water contacts have a finite voice budget and muting releases active sources', async () => {
  const audio = fakeAudio();
  await ready(audio);
  const handles = Array.from({ length: 100 }, () => playWaterSound(audio.engine, { type: 'splash' })[0]);
  assert.equal(handles.filter(handle => !handle.ended).length, 24);
  audio.engine.muted = true;
  assert.deepEqual(playWaterSound(audio.engine, { type: 'step' }), []);
  assert.ok(handles.every(handle => handle.ended));
  assertDisposed(audio);
});

test('stale decoding cannot attach samples or replay sounds after the audio context is replaced', async () => {
  const audio = fakeAudio();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const original = audio.context;
  const player = new WaterSounds(audio.engine, { loadBuffer: async (url, context) => {
    if (context === original) await gate;
    return loadTestRecording(url);
  } });
  const stale = player.prepare();
  await Promise.resolve();
  const next = fakeAudio();
  audio.engine.context = next.context;
  assert.equal(await player.prepare(), true);
  release();
  assert.equal(await stale, false);
  assert.equal(player.context, next.context);
  assert.equal(player.contact({ type: 'step' }).length, 1);
  player.pause();
  assert.ok(next.nodes.every(node => node.disconnects === 1));
  assertDisposed(audio);
});

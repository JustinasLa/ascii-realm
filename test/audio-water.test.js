import assert from 'node:assert/strict';
import test from 'node:test';
import { GameAudio } from '../src/audio/audio.js';
import { playWaterSound } from '../src/audio/water.js';
import { SHORE, STONE, WATER } from '../src/world/world.js';

function fakeAudio() {
  const nodes = [];
  const routes = [];
  const invalid = [];
  const context = { state: 'running', currentTime: 10, sampleRate: 16000 };
  const parameter = (value = 0) => {
    const param = { value, calls: [] };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
      'setTargetAtTime', 'cancelAndHoldAtTime', 'cancelScheduledValues']) {
      param[method] = (...args) => {
        if (!args.every(Number.isFinite)) invalid.push({ method, args });
        param.calls.push({ method, args });
      };
    }
    return param;
  };
  const node = (kind) => {
    const result = { kind, starts: [], stops: [], disconnects: 0,
      connect() {}, disconnect() { this.disconnects++; },
      start(at, offset = 0) {
        if (!Number.isFinite(at) || at < context.currentTime || !Number.isFinite(offset)) invalid.push({ at, offset });
        this.starts.push(at);
      },
      stop(at = context.currentTime) { this.stops.push(at); },
    };
    nodes.push(result);
    return result;
  };
  context.createGain = () => Object.assign(node('gain'), { gain: parameter() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: parameter(), Q: parameter() });
  context.createBufferSource = () => Object.assign(node('source'), { playbackRate: parameter(1) });
  context.createBuffer = (channels, length) => {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  };
  const engine = { context, muted: false, volumes: { master: 0.7, sfx: 0.8 },
    spatial: () => ({ gain: 1, pan: 0 }), setListener() {},
    route(bus, x, y) {
      const route = { bus, x, y, input: {}, disposals: 0, dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    },
  };
  return { engine, context, nodes, routes, invalid };
}

const lake = { typeAt: () => WATER };
const peak = (audio) => Math.max(...audio.nodes.filter((n) => n.kind === 'gain')
  .flatMap((n) => n.gain.calls.map((c) => c.args[0])));
const filters = (audio) => audio.nodes.filter((n) => n.kind === 'filter');
function assertDisposed(audio) {
  assert.ok(audio.routes.every((r) => r.disposals === 1));
  assert.ok(audio.nodes.every((n) => n.disconnects === 1));
  assert.deepEqual(audio.invalid, []);
}

test('steps, water takeoffs and landing splashes have distinct liquid envelopes and positioned Effects routes', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const signatures = new Set();
  for (const type of ['step', 'jump', 'land']) {
    const audio = fakeAudio();
    const handles = playWaterSound(audio.engine, { type, x: -2.5, y: 12.5, strength: 0.8 });
    assert.ok(handles.length >= 4 && handles.length <= 6);
    assert.ok(audio.routes.every((r) => r.bus === 'sfx' && r.x === -2.5 && r.y === 12.5));
    assert.ok(audio.nodes.every((n) => n.kind !== 'oscillator'));
    const sources = audio.nodes.filter((n) => n.kind === 'source');
    assert.ok(sources.some((n) => n.starts[0] > audio.context.currentTime), 'runoff follows the contact');
    assert.ok(sources.every((n) => n.stops[0] - audio.context.currentTime < 0.6), 'each splash stays compact');
    signatures.add(JSON.stringify({ filters: filters(audio).map((n) => [n.type, n.frequency.value]),
      starts: sources.map((n) => n.starts[0]), stops: sources.map((n) => n.stops[0]) }));
    for (const handle of handles) { handle.stop(); handle.stop(); }
    assertDisposed(audio);
  }
  assert.equal(signatures.size, 3);
});

test('running contacts and larger landing impacts gain weight without becoming long noise beds', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const walk = fakeAudio();
  const run = fakeAudio();
  const landing = fakeAudio();
  const voices = [
    [walk, playWaterSound(walk.engine, { type: 'step', strength: 0.2 })],
    [run, playWaterSound(run.engine, { type: 'step', strength: 0.8 })],
    [landing, playWaterSound(landing.engine, { type: 'land', strength: 1 })],
  ];
  assert.ok(peak(run) > peak(walk));
  assert.ok(peak(landing) > peak(run));
  assert.ok(landing.routes.length > walk.routes.length);
  for (const [audio, handles] of voices) { handles.forEach((h) => h.stop()); assertDisposed(audio); }
});

test('locked, suspended, muted and zero-volume water contacts allocate nothing and never replay', () => {
  const audio = fakeAudio();
  for (const state of ['suspended', 'closed']) {
    audio.context.state = state;
    assert.deepEqual(playWaterSound(audio.engine, { type: 'land' }), []);
  }
  assert.deepEqual(playWaterSound({ context: null }, { type: 'jump' }), []);
  audio.context.state = 'running';
  audio.engine.muted = true;
  assert.deepEqual(playWaterSound(audio.engine, { type: 'step' }), []);
  audio.engine.muted = false;
  for (const bus of ['master', 'sfx']) {
    audio.engine.volumes[bus] = 0;
    assert.deepEqual(playWaterSound(audio.engine, { type: 'step' }), []);
    audio.engine.volumes[bus] = 0.7;
  }
  for (const event of [{ type: 'step', strength: 0 }, { type: 'land', strength: -1 },
    { type: 'splash', volume: 0 }, { type: 'breath' }, { type: '__proto__' }, null]) {
    assert.deepEqual(playWaterSound(audio.engine, event), []);
  }
  assert.equal(audio.nodes.length, 0);
  const handles = playWaterSound(audio.engine, { type: 'step', strength: 0.3 });
  assert.equal(handles.length, 4, 'unlock plays only the new contact');
  handles.forEach((h) => h.stop());
  assertDisposed(audio);
});

test('water skids are throttled, including at time zero, while footsteps are never suppressed', () => {
  const audio = fakeAudio();
  audio.context.currentTime = 0;
  const handles = playWaterSound(audio.engine, { type: 'skid', strength: 0.6 });
  assert.equal(handles.length, 2);
  for (let frame = 1; frame <= 6; frame++) {
    audio.context.currentTime = frame / 60;
    assert.deepEqual(playWaterSound(audio.engine, { type: 'skid', strength: 0.6 }), []);
  }
  handles.push(...playWaterSound(audio.engine, { type: 'step', strength: 0.3 }));
  assert.equal(handles.length, 6);
  audio.context.currentTime = 0.13;
  handles.push(...playWaterSound(audio.engine, { type: 'skid', strength: 0.6 }));
  assert.equal(handles.length, 8);
  handles.forEach((h) => h.stop());
  assertDisposed(audio);
  const next = fakeAudio();
  next.context.currentTime = 0.16;
  audio.engine.context = next.context;
  const fresh = playWaterSound(audio.engine, { type: 'skid' });
  assert.equal(fresh.length, 2, 'a new context starts without the previous skid cooldown');
  fresh.forEach((h) => h.stop());
  assertDisposed(next);
});

test('water voices handle malformed inputs, natural completion and partial playback failure safely', () => {
  const audio = fakeAudio();
  const handles = playWaterSound(audio.engine, { type: 'splash', strength: Infinity, volume: NaN, x: NaN, y: Infinity });
  assert.equal(handles.length, 6);
  assert.ok(audio.routes.every((r) => r.x === undefined && r.y === undefined));
  assert.ok(filters(audio).every((n) => Number.isFinite(n.frequency.value) && Number.isFinite(n.Q.value)));
  for (const source of audio.nodes.filter((n) => n.kind === 'source')) source.onended();
  assert.ok(handles.every((h) => h.ended));
  handles.forEach((h) => h.stop());
  assertDisposed(audio);
  const failure = fakeAudio();
  failure.context.createBiquadFilter = () => { throw new Error('audio device changed'); };
  assert.deepEqual(playWaterSound(failure.engine, { type: 'land' }), []);
  assertDisposed(failure);
});

test('GameAudio selects the water cues at each contact and clears all of their tails on pause', () => {
  const audio = fakeAudio();
  const sound = new GameAudio(lake, audio.engine);
  for (const type of ['step', 'jump', 'land', 'splash']) sound.play({ type, x: 5.5, y: 8.5, strength: 0.7 });
  assert.equal(sound.effects.size, 20);
  assert.ok(audio.routes.every((r) => r.bus === 'sfx' && r.x === 5.5 && r.y === 8.5));
  sound.pause();
  sound.pause();
  assert.equal(sound.effects.size, 0);
  assertDisposed(audio);
  const count = audio.routes.length;
  audio.context.state = 'suspended';
  sound.play({ type: 'step', x: 5.5, y: 8.5 });
  assert.equal(audio.routes.length, count);
});

test('wave-washed shore uses water steps, while dry ground never emits an explicit splash', () => {
  const wet = fakeAudio();
  const shore = { typeAt: (x) => x === 0 ? SHORE : WATER };
  const sound = new GameAudio(shore, wet.engine);
  sound.play({ type: 'step', x: 0.5, y: 0.5 });
  assert.equal(sound.effects.size, 4);
  assert.ok(filters(wet)[0].frequency.value >= 250 && filters(wet)[0].frequency.value <= 600);
  sound.pause();
  assertDisposed(wet);
  const dry = fakeAudio();
  const land = new GameAudio({ typeAt: () => STONE }, dry.engine);
  land.play({ type: 'splash', x: 0.5, y: 0.5 });
  assert.equal(dry.routes.length, 0);
  land.play({ type: 'step', x: 0.5, y: 0.5 });
  assert.equal(land.effects.size, 3, 'dry stone retains its original footstep');
  land.pause();
  assertDisposed(dry);
});

test('sword impacts add fluid sounds only where the visible strike meets water', () => {
  for (const type of ['slam', 'whirl']) {
    const audio = fakeAudio();
    const sound = new GameAudio({ typeAt: (x) => x > 0 ? WATER : STONE }, audio.engine);
    sound.play({ type, x: 5.5, y: 8.5, strength: 0.8 });
    assert.ok(audio.routes.some((r) => r.bus === 'sword'));
    assert.ok(audio.routes.some((r) => r.bus === 'sfx'));
    assert.ok(audio.routes.every((r) => r.x === 5.5 && r.y === 8.5));
    const before = audio.routes.length;
    sound.play({ type, x: -5.5, y: 8.5, strength: 0.8 });
    assert.ok(audio.routes.slice(before).every((r) => r.bus === 'sword'));
    sound.pause();
    assertDisposed(audio);
  }
});

test('water contacts visit 25 textures before repeating and never repeat at a deck boundary', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const audio = fakeAudio();
  const signatures = [];
  for (let i = 0; i < 50; i++) {
    const before = audio.nodes.length;
    const handles = playWaterSound(audio.engine, { type: 'step', strength: 0.4 });
    const created = audio.nodes.slice(before);
    signatures.push(JSON.stringify(created.filter((n) => n.kind === 'filter')
      .map((n) => n.frequency.value)));
    assert.equal(handles.length, 4);
    handles.forEach((h) => h.stop());
  }
  assert.equal(new Set(signatures.slice(0, 25)).size, 25);
  assert.equal(new Set(signatures.slice(25)).size, 25);
  assert.ok(signatures.every((s, i) => i === 0 || s !== signatures[i - 1]));
  assertDisposed(audio);
});

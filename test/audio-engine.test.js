import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine, DEFAULT_VOLUMES } from '../src/audio/engine.js';
import { ASPECT } from '../src/world/world.js';

// Only model the graph and scheduled parameter targets, never browser audio.
class FakeParam {
  constructor(value = 1) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam();
    this.connections = [];
    this.disconnects = 0;
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; this.disconnects++; }
}

class FakeContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = new FakeNode();
    this.resumeCalls = 0;
    this.closeCalls = 0;
  }
  createGain() { return new FakeNode(); }
  createStereoPanner() {
    const node = new FakeNode();
    node.pan = new FakeParam(0);
    return node;
  }
  async resume() { this.resumeCalls++; this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.closeCalls++; this.state = 'closed'; }
}

function fixture() {
  const context = new FakeContext();
  const engine = new AudioEngine({ contextFactory: () => context, storage: null });
  return { engine, context };
}

test('audio constructs lazily and exposes independent buses after a gesture unlock', async () => {
  let constructions = 0;
  const context = new FakeContext();
  const engine = new AudioEngine({
    contextFactory: () => { constructions++; return context; }, storage: null,
  });
  assert.equal(engine.context, null);
  assert.equal(engine.route(), null);
  assert.equal(constructions, 0);
  assert.deepEqual(engine.volumes, DEFAULT_VOLUMES);

  assert.equal(await engine.unlock(), true);
  assert.equal(constructions, 1);
  assert.equal(engine.context, context);
  for (const bus of ['music', 'sfx', 'ambience']) {
    assert.ok(engine.buses[bus].connections.includes(engine.buses.master));
    assert.equal(engine.buses[bus].gain.value, DEFAULT_VOLUMES[bus]);
  }
  assert.ok(engine.buses.master.connections.includes(context.destination));
  assert.equal(await engine.unlock(), true);
  assert.equal(constructions, 1, 'repeated gestures reuse the audio context');
  await engine.dispose();
});

test('unsupported audio and a failed context constructor leave sound optional', async () => {
  for (const contextFactory of [() => null, () => { throw new Error('Unavailable'); }]) {
    const engine = new AudioEngine({ contextFactory, storage: null });
    assert.equal(await engine.unlock(), false);
    assert.equal(engine.route(), null);
    assert.equal(await engine.suspend(), false);
    engine.setVolume('music', 0.2);
    engine.toggleMute();
    await engine.dispose();
  }
});

test('a rejected resume is recoverable on a later gesture', async () => {
  const { engine, context } = fixture();
  let rejectResume = true;
  context.resume = async () => {
    if (rejectResume) throw new Error('Gesture required');
    context.state = 'running';
  };
  assert.equal(await engine.unlock(), false);
  assert.equal(engine.route(), null);
  rejectResume = false;
  assert.equal(await engine.unlock(), true);
  const route = engine.route();
  assert.ok(route);
  route.dispose();
  await engine.dispose();
});

test('overlapping unlock gestures share a pending resume', async () => {
  const { engine, context } = fixture();
  let resume;
  context.resume = () => {
    context.resumeCalls++;
    return new Promise((resolve) => { resume = () => { context.state = 'running'; resolve(); }; });
  };
  const first = engine.unlock();
  const second = engine.unlock();
  assert.equal(context.resumeCalls, 1);
  resume();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  await engine.dispose();
});

test('mute silences the master bus while preserving editable individual volumes', async () => {
  const { engine } = fixture();
  engine.setMuted(true);
  await engine.unlock();
  assert.equal(engine.buses.master.gain.value, 0, 'saved mute applies before playback');
  engine.setVolume('master', 0.4);
  engine.setVolume('music', 0.15);
  assert.equal(engine.buses.master.gain.value, 0);
  assert.equal(engine.volumes.master, 0.4);
  assert.equal(engine.buses.music.gain.value, 0.15);
  assert.equal(engine.toggleMute(), false);
  assert.equal(engine.buses.master.gain.value, 0.4);
  assert.equal(engine.buses.music.gain.value, 0.15);
  await engine.dispose();
});

test('volume controls clamp finite values and ignore invalid bus names and values', async () => {
  const { engine } = fixture();
  await engine.unlock();
  engine.setVolume('sfx', 10);
  assert.equal(engine.volumes.sfx, 1);
  engine.setVolume('ambience', -2);
  assert.equal(engine.volumes.ambience, 0);
  for (const value of [NaN, Infinity, '0.5', undefined]) engine.setVolume('music', value);
  engine.setVolume('unknown', 0.2);
  assert.equal(engine.volumes.music, DEFAULT_VOLUMES.music);
  assert.equal(Object.hasOwn(engine.volumes, 'unknown'), false);
  await engine.dispose();
});

test('sword volume is independent while still respecting the effects and master buses', async () => {
  const { engine } = fixture();
  await engine.unlock();
  assert.ok(engine.buses.sword.connections.includes(engine.buses.sfx));
  engine.setVolume('sword', 0);
  assert.equal(engine.buses.sword.gain.value, 0);
  assert.equal(engine.buses.sfx.gain.value, DEFAULT_VOLUMES.sfx);
  assert.equal(engine.buses.master.gain.value, DEFAULT_VOLUMES.master);
  const route = engine.route('sword', 1, 2);
  assert.ok(route);
  route.dispose();
  await engine.dispose();
});

test('weather has independent volume within ambience and master routing', async () => {
  const { engine } = fixture();
  await engine.unlock();
  assert.ok(engine.buses.weather.connections.includes(engine.buses.ambience));
  engine.setVolume('weather', 0);
  assert.equal(engine.buses.weather.gain.value, 0);
  assert.equal(engine.buses.ambience.gain.value, DEFAULT_VOLUMES.ambience);
  assert.equal(engine.buses.master.gain.value, DEFAULT_VOLUMES.master);
  const route = engine.route('weather', 10, 20);
  assert.ok(route);
  route.dispose();
  await engine.dispose();
});

test('persisted preferences clamp invalid levels and retain defaults for malformed values', async () => {
  let saved;
  const engine = new AudioEngine({
    contextFactory: () => new FakeContext(),
    storage: {
      getItem: () => JSON.stringify({ volumes: { master: 4, music: -3, sfx: 'loud', ambience: null }, muted: true }),
      setItem: (_key, value) => { saved = JSON.parse(value); },
    },
  });
  assert.deepEqual(engine.volumes, { ...DEFAULT_VOLUMES, master: 1, music: 0 });
  assert.equal(engine.muted, true);
  engine.setVolume('sfx', 0.3);
  engine.setMuted(false);
  assert.equal(saved.volumes.sfx, 0.3);
  assert.equal(saved.muted, false);
  await engine.dispose();
});

test('malformed or inaccessible preference storage never prevents audio controls', async () => {
  for (const storage of [
    { getItem: () => '{broken', setItem: () => { throw new Error('Write denied'); } },
    { getItem: () => { throw new Error('Read denied'); }, setItem: () => { throw new Error('Write denied'); } },
  ]) {
    const engine = new AudioEngine({ contextFactory: () => new FakeContext(), storage });
    assert.deepEqual(engine.volumes, DEFAULT_VOLUMES);
    engine.setVolume('music', 0.2);
    assert.equal(engine.toggleMute(), true);
    assert.equal(await engine.unlock(), true);
    assert.equal(engine.buses.master.gain.value, 0);
    await engine.dispose();
  }
});

test('spatial sound pans left and right, attenuates with distance, and corrects cell aspect', () => {
  const { engine } = fixture();
  engine.setListener(10, 20);
  assert.deepEqual(engine.spatial(10, 20), { pan: 0, gain: 1 });
  const left = engine.spatial(0, 20);
  const right = engine.spatial(20, 20);
  assert.ok(left.pan < 0 && right.pan > 0);
  assert.equal(left.gain, right.gain);
  assert.ok(engine.spatial(100, 20).gain < right.gain);
  const horizontal = engine.spatial(10 + 12 / ASPECT, 20);
  const vertical = engine.spatial(10, 32);
  assert.ok(Math.abs(horizontal.gain - vertical.gain) < 1e-12);
  assert.equal(engine.spatial(10000, 20).pan, 1);
  assert.equal(engine.spatial(-10000, 20).pan, -1);
  assert.deepEqual(engine.spatial(undefined, undefined), { pan: 0, gain: 1 });
  engine.setListener(NaN, 0);
  assert.deepEqual(engine.spatial(10, 20), { pan: 0, gain: 1 });
});

test('positioned routes connect to their bus and update their gain and pan', async () => {
  const { engine } = fixture();
  await engine.unlock();
  engine.setListener(0, 0);
  const route = engine.route('ambience', 12, 0);
  assert.ok(route);
  const panner = route.input.connections.find((node) => node.pan);
  assert.ok(panner.connections.includes(engine.buses.ambience));
  assert.equal(route.input.gain.value, engine.spatial(12, 0).gain);
  assert.ok(panner.pan.value > 0);
  route.update(-12, 0);
  assert.ok(panner.pan.value < 0);
  route.update(0, 0);
  assert.equal(route.input.gain.value, 1);
  assert.equal(panner.pan.value, 0);
  assert.equal(engine.route('unknown'), null);
  route.dispose();
  assert.deepEqual(route.input.connections, []);
  assert.deepEqual(panner.connections, []);
  route.dispose();
  assert.equal(route.input.disconnects, 1, 'route disposal is idempotent');
  await engine.dispose();
});

test('routes still play in browsers without stereo panning support', async () => {
  const { engine, context } = fixture();
  context.createStereoPanner = undefined;
  await engine.unlock();
  const route = engine.route('sfx', 20, 0);
  assert.ok(route.input.connections.includes(engine.buses.sfx));
  assert.ok(route.input.gain.value < 1);
  route.update(0, 0);
  assert.equal(route.input.gain.value, 1);
  await engine.dispose();
});

test('suspending blocks new sources until unlocked again and teardown is idempotent', async () => {
  const { engine, context } = fixture();
  await engine.unlock();
  const route = engine.route('music');
  assert.equal(await engine.suspend(), true);
  assert.equal(engine.route(), null);
  assert.equal(await engine.unlock(), true);
  const buses = Object.values(engine.buses);
  await engine.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(engine.context, null);
  assert.deepEqual(route.input.connections, []);
  assert.ok(buses.every((bus) => bus.connections.length === 0));
  route.update(4, 0);
  route.dispose();
  await engine.dispose();
  assert.equal(context.closeCalls, 1);
  assert.equal(route.input.disconnects, 1);
  assert.equal(await engine.unlock(), false);
  assert.equal(engine.route(), null);
});

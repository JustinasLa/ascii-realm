import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PickupAudio } from '../src/audio/pickup.js';

function fixture({ saved, contextFactory, storage } = {}) {
  const nodes = [];
  const buffers = [];
  const context = { state: 'suspended', currentTime: 8, sampleRate: 8000,
    destination: {}, resumeCalls: 0, closeCalls: 0,
    async resume() { this.resumeCalls++; this.state = 'running'; },
    async close() { this.closeCalls++; this.state = 'closed'; },
  };
  const param = () => ({ value: 0, calls: [],
    setValueAtTime(value, time) { this.record(value, time); },
    linearRampToValueAtTime(value, time) { this.record(value, time); },
    record(value, time) {
      assert.ok(Number.isFinite(value) && Number.isFinite(time));
      assert.ok(time >= context.currentTime);
      this.calls.push([value, time]);
    },
  });
  const node = kind => {
    const result = { kind, connections: [], disconnects: 0, starts: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at) { assert.ok(Number.isFinite(at) && at >= context.currentTime); this.starts.push(at); },
      stop(at) { if (at !== undefined) assert.ok(Number.isFinite(at) && at >= context.currentTime); this.stops.push(at); },
    };
    nodes.push(result);
    return result;
  };
  context.createGain = () => Object.assign(node('gain'), { gain: param() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: param(), Q: param() });
  context.createBufferSource = () => node('rustle');
  context.createOscillator = () => Object.assign(node('contact'), { frequency: param() });
  context.createBuffer = (channels, length, sampleRate) => {
    const samples = new Float32Array(length);
    const buffer = { channels, length, sampleRate, getChannelData: () => samples };
    buffers.push(buffer);
    return buffer;
  };
  let preferences = saved === undefined ? null : JSON.stringify(saved);
  const preferencesStorage = storage ?? {
    getItem(key) { assert.equal(key, 'ascii-realm.audio'); return preferences; },
    setItem(key, value) { assert.equal(key, 'ascii-realm.audio'); preferences = value; },
  };
  let constructions = 0;
  const audio = new PickupAudio({ storage: preferencesStorage,
    contextFactory: contextFactory ?? (() => { constructions++; return context; }),
  });
  return { audio, context, nodes, buffers, storage: preferencesStorage,
    get constructions() { return constructions; },
    get saved() { return JSON.parse(preferences); },
  };
}

test('pickup audio stays lazy and never queues locked pickups', async () => {
  const f = fixture();
  assert.equal(f.audio.context, null);
  assert.equal(f.audio.play({ type: 'pickup', count: 1 }), false);
  f.audio.setMuted(true);
  f.audio.setMuted(false);
  assert.equal(f.constructions, 0);
  assert.equal(f.nodes.length, 0);
  assert.equal(await f.audio.unlock(), true);
  assert.equal(f.constructions, 1);
  assert.equal(f.nodes.length, 1, 'unlock does not replay a prior pickup');
  assert.equal(await f.audio.unlock(), true);
  assert.equal(f.constructions, 1);
  await f.audio.dispose();
});

test('pickup sounds are short and clean up their shared noise and contact graph once', async () => {
  const f = fixture();
  await f.audio.unlock();
  const output = f.nodes[0];
  assert.ok(output.connections.includes(f.context.destination));
  assert.equal(output.gain.value, 0.7 * 0.8);
  assert.equal(f.audio.play({ type: 'pickup', count: 3 }), true);
  const voices = f.nodes.slice(1);
  const sources = voices.filter(node => ['rustle', 'contact'].includes(node.kind));
  assert.equal(sources.length, 2);
  for (const source of sources) {
    assert.deepEqual(source.starts, [8]);
    assert.ok(source.stops[0] > 8 && source.stops[0] < 8.25);
  }
  for (const gain of voices.filter(node => node.kind === 'gain')) {
    assert.equal(gain.gain.calls[0][0], 0);
    assert.equal(gain.gain.calls.at(-1)[0], 0);
    assert.ok(gain.gain.calls.every(([value]) => value >= 0 && value <= 0.06));
    assert.ok(gain.connections.includes(output));
  }
  assert.ok(f.buffers[0].getChannelData(0).every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  sources.forEach(source => { source.onended(); source.onended(); });
  f.audio.pause();
  assert.ok(voices.every(node => node.disconnects === 1));
  assert.ok(sources.every(source => source.stops.length === 1));
  await f.audio.dispose();
});

test('only successful pickup events create voices, with no replay after suspension', async () => {
  const f = fixture();
  await f.audio.unlock();
  for (const event of [undefined, {}, { type: 'drop' }, { type: 'pickup', success: false },
    ...[0, -1, NaN, Infinity, '1'].map(count => ({ type: 'pickup', count }))]) {
    assert.equal(f.audio.play(event), false);
  }
  assert.equal(f.nodes.length, 1);
  f.context.state = 'suspended';
  assert.equal(f.audio.play({ type: 'pickup', count: 1 }), false);
  await f.audio.unlock();
  assert.equal(f.nodes.length, 1);
  assert.equal(f.audio.play({ type: 'pickup' }), true);
  await f.audio.dispose();
});

test('saved mute and master/effects levels apply before any pickup becomes audible', async () => {
  const f = fixture({ saved: { muted: true, volumes: { master: 0.4, sfx: 0.25 } } });
  assert.equal(f.audio.muted, true);
  await f.audio.unlock();
  assert.equal(f.nodes[0].gain.value, 0);
  assert.equal(f.audio.play({ type: 'pickup' }), false);
  assert.equal(f.nodes.length, 1);
  assert.equal(f.audio.setMuted(false), false);
  assert.equal(f.nodes[0].gain.value, 0.1);
  assert.equal(f.audio.play({ type: 'pickup' }), true);
  const voices = f.nodes.slice(1);
  assert.equal(f.audio.setMuted(true), true);
  assert.equal(f.nodes[0].gain.value, 0);
  assert.ok(voices.every(node => node.disconnects === 1));
  f.audio.setMuted(false);
  assert.equal(f.nodes[0].gain.value, 0.1);
  assert.ok(voices.every(node => node.disconnects === 1));
  await f.audio.dispose();
});

test('zero category levels skip playback, and malformed levels are bounded or ignored', async () => {
  for (const volumes of [{ master: 0, sfx: 1 }, { master: 1, sfx: 0 }, { master: -9, sfx: 1 }]) {
    const f = fixture({ saved: { volumes } });
    await f.audio.unlock();
    assert.equal(f.audio.play({ type: 'pickup' }), false);
    assert.equal(f.nodes.length, 1);
    await f.audio.dispose();
  }
  const f = fixture({ saved: { volumes: { master: 4, sfx: 'loud' } } });
  await f.audio.unlock();
  assert.equal(f.nodes[0].gain.value, 0.8);
  assert.equal(f.audio.play({ type: 'pickup' }), true);
  await f.audio.dispose();
});

test('mute writes preserve all other saved preferences, including newer controls', () => {
  const f = fixture({ saved: { muted: false, volumes: { music: 0.17, sfx: 0.4 }, other: 'keep' } });
  const latest = { volumes: { music: 0.3, sfx: 0.8, weather: 0.1 }, other: 'updated', extra: [1, 2] };
  f.storage.setItem('ascii-realm.audio', JSON.stringify(latest));
  f.audio.setMuted(true);
  assert.deepEqual(f.saved, { ...latest, muted: true });
});

test('unsupported audio and unavailable storage do not interrupt collection', async () => {
  for (const contextFactory of [() => null, () => { throw new Error('No audio'); }]) {
    const audio = new PickupAudio({ contextFactory, storage: {
      getItem() { throw new Error('No storage'); }, setItem() { throw new Error('Read only'); },
    } });
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.setMuted(true), true);
    assert.equal(audio.play({ type: 'pickup' }), false);
    await audio.dispose();
  }
  for (const saved of ['broken', '"string"', '[]']) {
    const audio = new PickupAudio({ storage: { getItem: () => saved }, contextFactory: () => null });
    assert.equal(audio.muted, false);
    assert.deepEqual(audio.volumes, { master: 0.7, sfx: 0.8 });
    assert.equal(audio.setMuted(true), true);
  }
});

test('failed unlock retries and overlapping gestures share a single resume', async () => {
  const f = fixture();
  f.context.resume = () => { f.context.resumeCalls++; return Promise.reject(new Error('Gesture needed')); };
  assert.equal(await f.audio.unlock(), false);
  assert.equal(f.audio.play({ type: 'pickup' }), false);
  let resume;
  f.context.resume = () => {
    f.context.resumeCalls++;
    return new Promise(resolve => { resume = () => { f.context.state = 'running'; resolve(); }; });
  };
  const first = f.audio.unlock();
  const second = f.audio.unlock();
  assert.equal(f.context.resumeCalls, 2);
  assert.equal(f.constructions, 1);
  resume();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  await f.audio.dispose();
});

test('voice budget, pause, and disposal release their graphs without duplicate cleanup', async () => {
  const f = fixture();
  await f.audio.unlock();
  for (let i = 0; i < 12; i++) assert.equal(f.audio.play({ type: 'pickup' }), true);
  const sources = f.nodes.filter(node => ['rustle', 'contact'].includes(node.kind));
  assert.equal(sources.filter(source => source.disconnects === 0).length, 16, 'at most eight paired voices');
  assert.equal(f.buffers.length, 1, 'rustle samples are reused');
  f.audio.pause();
  f.audio.pause();
  assert.ok(f.nodes.slice(1).every(node => node.disconnects === 1));
  assert.ok(sources.every(source => source.stops.length === 2));
  await f.audio.dispose();
  await f.audio.dispose();
  sources.forEach(source => source.onended());
  assert.ok(f.nodes.every(node => node.disconnects === 1));
  assert.equal(f.context.closeCalls, 1);
  assert.equal(f.audio.context, null);
  assert.equal(await f.audio.unlock(), false);
  assert.equal(f.audio.play({ type: 'pickup' }), false);
});

test('partial graph failures clean up and leave later playback recoverable', async () => {
  const f = fixture();
  await f.audio.unlock();
  const createFilter = f.context.createBiquadFilter;
  f.context.createBiquadFilter = () => { throw new Error('Graph failure'); };
  assert.equal(f.audio.play({ type: 'pickup' }), false);
  assert.equal(f.nodes[1].disconnects, 1);
  assert.equal(f.nodes[1].stops.length, 1);
  f.context.createBiquadFilter = createFilter;
  assert.equal(f.audio.play({ type: 'pickup' }), true);
  await f.audio.dispose();
  assert.ok(f.nodes.every(node => node.disconnects === 1));
});

test('disposing during a pending unlock prevents later playback', async () => {
  const f = fixture();
  let resume;
  f.context.resume = () => new Promise(resolve => { resume = resolve; });
  const unlocking = f.audio.unlock();
  await f.audio.dispose();
  resume();
  assert.equal(await unlocking, false);
  assert.equal(f.audio.play({ type: 'pickup' }), false);
  assert.ok(f.nodes.every(node => node.disconnects === 1));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playMusicNote, createMusicRoom } from '../src/audio/music-voices.js';

function fakeAudio(currentTime = 20) {
  const nodes = [];
  const routes = [];
  const buffers = [];
  const context = { state: 'running', currentTime, sampleRate: 16000 };
  function param(value = 0) {
    const calls = [];
    const result = { value, calls };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime',
      'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelAndHoldAtTime',
      'cancelScheduledValues']) {
      result[method] = (...args) => {
        assert.ok(args.every(Number.isFinite), `${method} parameters are finite`);
        const at = ['cancelAndHoldAtTime', 'cancelScheduledValues'].includes(method) ? args[0] : args[1];
        assert.ok(at >= context.currentTime, `${method} is scheduled on the audio clock`);
        calls.push({ method, args });
      };
    }
    return result;
  }
  function node(kind) {
    const result = { kind, connections: [], disconnects: 0, starts: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at) {
        if (at !== undefined) assert.ok(Number.isFinite(at) && at >= context.currentTime);
        this.starts.push(at);
      },
      stop(at) {
        if (at !== undefined) assert.ok(Number.isFinite(at) && at >= context.currentTime);
        this.stops.push(at);
      } };
    nodes.push(result);
    return result;
  }
  context.createGain = () => Object.assign(node('gain'), { gain: param() });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: param(), detune: param() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: param(), Q: param() });
  context.createConvolver = () => node('convolver');
  context.createBufferSource = () => node('bufferSource');
  context.createBuffer = (channels, length, sampleRate) => {
    assert.ok(Number.isInteger(length) && length > 0);
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate,
      getChannelData: channel => data[channel] };
    buffers.push(buffer);
    return buffer;
  };
  const engine = { context,
    route(bus) {
      const route = { bus, input: {}, disposals: 0, dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    } };
  return { context, engine, nodes, routes, buffers,
    sources: () => nodes.filter(item => ['oscillator', 'bufferSource'].includes(item.kind)) };
}

const choir = { voice: 'choir', note: 57, gain: 0.03, attack: 0.6,
  decay: 0.4, sustain: 0.65, release: 1.4, cutoff: 1600, spread: 8, detune: 0 };

test('music instruments allocate nothing before audio is running', () => {
  for (const context of [null, undefined, { state: 'suspended' }, { state: 'closed' }]) {
    const engine = { context, route() { assert.fail('locked music allocated a route'); } };
    assert.equal(playMusicNote(engine, choir, 21, 3), null);
    assert.equal(createMusicRoom(context, {}), null);
  }
});

test('sustained music notes attack and decay gently and keep their authored release tail', () => {
  const fake = fakeAudio();
  const handle = playMusicNote(fake.engine, choir, 21, 3);
  assert.ok(handle);
  assert.equal(fake.routes[0].bus, 'music');
  assert.ok(handle.end >= 21 + 3 + choir.release);
  assert.ok(handle.end <= 21 + 3 + choir.release + 0.1);
  const sources = fake.sources();
  assert.equal(sources.length, 2, 'spread gives sustained harmony two quiet detuned layers');
  assert.ok(sources.every(source => source.starts[0] === 21));
  assert.ok(sources.every(source => source.stops[0] >= 25.4));
  const tuning = sources.map(source => source.detune.calls.find(call => call.method === 'setValueAtTime').args[0]);
  assert.ok(tuning.some(value => value < 0) && tuning.some(value => value > 0));
  assert.ok(sources.every(source => source.detune.calls.some(call =>
    call.method === 'linearRampToValueAtTime' && call.args[1] > 21)),
  'sustained layers drift slowly rather than sounding like a static oscillator');
  const envelopes = fake.nodes.filter(node => node.kind === 'gain').map(node => node.gain.calls);
  assert.ok(envelopes.some(calls => calls.some(call =>
    call.method === 'linearRampToValueAtTime' && Math.abs(call.args[0] - choir.gain) < 1e-9 &&
    call.args[1] >= 21.5)), 'the voice reaches its peak after a slow attack');
  assert.ok(envelopes.some(calls => calls.some(call =>
    ['linearRampToValueAtTime', 'exponentialRampToValueAtTime'].includes(call.method) &&
    Math.abs(call.args[0] - choir.gain * choir.sustain) < 1e-9 && call.args[1] > 21.6)),
  'the envelope decays to the authored sustain level');
  assert.ok(fake.nodes.some(node => node.kind === 'filter' && node.type === 'lowpass' &&
    node.frequency.calls.some(call => call.method === 'setValueAtTime' &&
      call.args[0] > 0 && call.args[0] <= 2000)), 'the sustained voice is lowpass filtered');
  assert.equal(handle.ended, false);
  handle.stop();
  handle.stop();
  for (const source of sources) source.onended();
  assert.equal(handle.ended, true);
  assert.equal(fake.routes[0].disposals, 1);
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
});

test('bell notes decay to silence and clean up only when their final partial ends', () => {
  const fake = fakeAudio();
  const event = { voice: 'bell', note: 74, gain: 0.025,
    attack: 0.012, decay: 1.1, sustain: 0, release: 0.7, cutoff: 2600, ratio: 2.76 };
  const handle = playMusicNote(fake.engine, event, 20.25, 2);
  assert.ok(handle);
  const sources = fake.sources();
  assert.ok(sources.length >= 2, 'bell includes its quiet authored partial');
  assert.ok(fake.nodes.filter(node => node.kind === 'gain').some(node =>
    node.gain.calls.some(call => ['linearRampToValueAtTime', 'exponentialRampToValueAtTime'].includes(call.method)
      && call.args[0] <= 0.0001 && call.args[1] > 20.25 && call.args[1] < 22.25)),
  'bell energy decays during the held note');
  sources[0].onended();
  assert.equal(handle.ended, false);
  assert.equal(fake.routes[0].disposals, 0);
  for (const source of sources.slice(1)) source.onended();
  assert.equal(handle.ended, true);
  assert.equal(fake.routes[0].disposals, 1);
  handle.stop();
  for (const source of sources) source.onended();
  assert.equal(fake.routes[0].disposals, 1);
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
});

test('invalid music parameters remain finite and scheduled source lifetimes stay bounded', () => {
  for (const value of [NaN, Infinity, -Infinity, -1e9, 1e9]) {
    const fake = fakeAudio();
    const handle = playMusicNote(fake.engine, { ...choir, note: value,
      attack: value, decay: value, sustain: value, release: value,
      cutoff: value, spread: value, detune: value, ratio: value }, value, value);
    assert.ok(handle);
    assert.ok(Number.isFinite(handle.end));
    for (const source of fake.sources()) {
      assert.ok(source.starts[0] >= fake.context.currentTime);
      assert.ok(source.starts[0] <= fake.context.currentTime + 60);
      assert.ok(source.stops[0] > source.starts[0]);
      assert.ok(source.stops[0] - source.starts[0] <= 70);
    }
    for (const node of fake.nodes) {
      for (const field of ['gain', 'frequency', 'Q', 'detune']) {
        if (node[field]) assert.ok(Number.isFinite(node[field].value));
      }
    }
    handle.stop();
    assert.ok(fake.nodes.every(node => node.disconnects === 1));
  }
});

test('silent music notes and missing destinations allocate no graphs', () => {
  for (const gain of [0, -1, -1e9]) {
    const fake = fakeAudio();
    assert.equal(playMusicNote(fake.engine, { ...choir, gain }, 21, 3), null);
    assert.equal(fake.nodes.length, 0);
    assert.equal(fake.routes.length, 0);
  }
  const fake = fakeAudio();
  assert.equal(createMusicRoom(fake.context, null), null);
  fake.engine.route = () => null;
  assert.equal(playMusicNote(fake.engine, choir, 21, 3), null);
  assert.equal(fake.nodes.length, 0);
});

test('music room uses a finite decaying stereo impulse cached per context and releases its graph', () => {
  const fake = fakeAudio();
  const destination = {};
  const first = createMusicRoom(fake.context, destination);
  const second = createMusicRoom(fake.context, destination);
  assert.ok(first?.input && second?.input);
  const convolvers = fake.nodes.filter(node => node.kind === 'convolver');
  assert.equal(convolvers.length, 2);
  assert.equal(convolvers[0].buffer, convolvers[1].buffer);
  const impulse = convolvers[0].buffer;
  assert.equal(impulse.numberOfChannels, 2);
  assert.ok(impulse.length / impulse.sampleRate >= 1 && impulse.length / impulse.sampleRate <= 4);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  assert.ok(left.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  assert.ok(right.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  assert.notDeepEqual(left, right, 'room has a stereo field');
  const energy = samples => samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
  const window = Math.floor(left.length / 4);
  assert.ok(energy(left.slice(0, window)) > energy(left.slice(-window)), 'the room tail loses energy');
  assert.ok(fake.nodes.filter(node => node.connections.includes(destination)).length >= 2,
    'dry music and the quiet room return reach the destination');
  first.dispose();
  first.dispose();
  second.dispose();
  assert.ok(convolvers.every(node => node.buffer === null));
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
  const other = fakeAudio();
  const room = createMusicRoom(other.context, {});
  assert.notEqual(other.nodes.find(node => node.kind === 'convolver').buffer, impulse);
  room.dispose();
});

test('failed music voice setup releases partially created sources and its route', () => {
  for (const stage of ['filter', 'second oscillator']) {
    const fake = fakeAudio();
    if (stage === 'filter') {
      fake.context.createBiquadFilter = () => { throw new Error('audio device closed'); };
    } else {
      const createOscillator = fake.context.createOscillator;
      let count = 0;
      fake.context.createOscillator = () => {
        if (++count === 2) throw new Error('audio device closed');
        return createOscillator();
      };
    }
    assert.equal(playMusicNote(fake.engine, choir, 21, 3), null);
    assert.equal(fake.routes[0].disposals, 1);
    assert.ok(fake.nodes.every(node => node.disconnects === 1));
    assert.ok(fake.sources().every(source => source.stops.includes(undefined)),
      'sources allocated before a later failure are stopped');
  }
});

test('failed room setup disconnects partial nodes and drops its convolution buffer', () => {
  const fake = fakeAudio();
  fake.context.createBiquadFilter = () => { throw new Error('audio device closed'); };
  assert.equal(createMusicRoom(fake.context, {}), null);
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
  assert.equal(fake.nodes.find(node => node.kind === 'convolver').buffer, null);
});

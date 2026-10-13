import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tone, noise, loopNoise, setParam } from '../src/audio/voices.js';

function fakeEngine(state = 'running', currentTime = 8) {
  const nodes = [];
  const buffers = [];
  const routes = [];
  const automation = [];
  const context = { state, currentTime, sampleRate: 8000 };
  function param(value = 0) {
    const parameter = { value, calls: [] };
    for (const [api, method] of Object.entries({ setValueAtTime: 'set',
      linearRampToValueAtTime: 'linear', exponentialRampToValueAtTime: 'exponential',
      setTargetAtTime: 'target', cancelAndHoldAtTime: 'hold', cancelScheduledValues: 'cancel' })) {
      parameter[api] = (...args) => {
        record(method, args);
        parameter.calls.push({ method, args });
      };
    }
    return parameter;
  }
  function record(method, args) {
    assert.ok(args.every(Number.isFinite), `${method} has finite parameters`);
    const time = ['hold', 'cancel'].includes(method) ? args[0] : args[1];
    assert.ok(time >= currentTime, `${method} scheduled before the audio clock`);
    automation.push({ method, args });
  }
  function node(kind) {
    const value = {
      kind, connections: [], disconnects: 0, starts: [], offsets: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at, offset) {
        if (at !== undefined) {
          assert.ok(Number.isFinite(at));
          assert.ok(at >= currentTime);
        }
        if (offset !== undefined) assert.ok(Number.isFinite(offset) && offset >= 0);
        this.starts.push(at);
        this.offsets.push(offset);
      },
      stop(at) {
        if (at !== undefined) {
          assert.ok(Number.isFinite(at));
          assert.ok(at >= currentTime);
        }
        this.stops.push(at);
      },
    };
    nodes.push(value);
    return value;
  }
  context.createGain = () => Object.assign(node('gain'), { gain: param() });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: param(), detune: param() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: param(), Q: param() });
  context.createBufferSource = () => node('bufferSource');
  context.createBuffer = (channels, length, sampleRate) => {
    const samples = new Float32Array(length);
    const buffer = { channels, length, sampleRate, getChannelData: () => samples };
    buffers.push(buffer);
    return buffer;
  };
  const engine = {
    context,
    route(bus, x, y) {
      const route = { bus, x, y, input: {}, disposals: 0, dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    },
  };
  return { engine, context, nodes, buffers, routes, automation };
}

test('voices allocate nothing until an audio context is running', () => {
  for (const context of [undefined, null, { state: 'suspended' }, { state: 'closed' }]) {
    const engine = { context, route() { assert.fail('locked audio must not allocate a route'); } };
    assert.equal(tone(engine), null);
    assert.equal(noise(engine), null);
    assert.equal(loopNoise(engine), null);
  }
  assert.equal(tone(undefined), null);
});

test('tone schedules an absolute-time envelope and frequency glide, then cleans up once', () => {
  const { engine, nodes, routes, automation } = fakeEngine();
  const handle = tone(engine, { when: 8.25, duration: 0.5, frequency: 220, endFrequency: 110,
    gain: 0.3, attack: 0.02, cutoff: 1000, type: 'triangle', bus: 'music', x: 12, y: 34 });
  assert.ok(handle);
  const source = nodes.find(node => node.kind === 'oscillator');
  assert.deepEqual(source.starts, [8.25]);
  assert.deepEqual(source.stops, [8.76]);
  assert.equal(source.type, 'triangle');
  assert.deepEqual(automation.slice(0, 4), [
    { method: 'set', args: [0, 8.25] },
    { method: 'linear', args: [0.3, 8.27] },
    { method: 'set', args: [0.3, 8.67] },
    { method: 'linear', args: [0, 8.75] },
  ]);
  assert.ok(automation.some(call => call.method === 'exponential' && call.args[0] === 110 && call.args[1] === 8.75));
  assert.deepEqual([routes[0].bus, routes[0].x, routes[0].y], ['music', 12, 34]);
  source.onended();
  source.onended();
  handle.stop();
  assert.equal(routes[0].disposals, 1);
  assert.ok(nodes.every(node => node.disconnects === 1));
  assert.equal(source.stops.length, 1);
});

test('invalid and extreme options stay finite, audible frequencies and durations stay bounded', () => {
  for (const play of [tone, noise]) {
    for (const value of [NaN, Infinity, -Infinity, -1e9, 1e9]) {
      const { engine, nodes, automation } = fakeEngine();
      const handle = play(engine, { when: value, duration: value, attack: value, gain: value,
        frequency: value, endFrequency: value, detune: value, cutoff: value,
        type: 'invalid', filterType: 'invalid' });
      assert.ok(handle);
      const source = nodes.find(node => ['oscillator', 'bufferSource'].includes(node.kind));
      const elapsed = source.stops[0] - source.starts[0];
      assert.ok(elapsed >= 0.015 - 1e-10 && elapsed <= 60.01 + 1e-10);
      assert.ok(source.starts[0] <= engine.context.currentTime + 60);
      const filter = nodes.find(node => node.kind === 'filter');
      assert.equal(filter.type, 'lowpass');
      assert.ok(filter.frequency.value >= 20 && filter.frequency.value <= engine.context.sampleRate * 0.45);
      assert.ok(automation[1].args[0] >= 0 && automation[1].args[0] <= 1);
      if (source.kind === 'oscillator') {
        assert.equal(source.type, 'sine');
        const initialPitch = automation[4].args[0];
        assert.ok(initialPitch >= 20 && initialPitch <= engine.context.sampleRate * 0.45);
        const initialDetune = automation[5].args[0];
        assert.ok(initialDetune >= -4800 && initialDetune <= 4800);
      }
      for (const node of nodes) {
        for (const key of ['frequency', 'Q', 'gain', 'detune']) {
          if (node[key]) assert.ok(Number.isFinite(node[key].value));
        }
      }
      assert.ok(automation.length >= 4);
      handle.stop();
    }
  }
});

test('past absolute times are clamped to the current audio clock', () => {
  const { engine, nodes } = fakeEngine();
  tone(engine, { when: 0.1 });
  assert.deepEqual(nodes.find(node => node.kind === 'oscillator').starts, [8]);
});

test('manual stop releases all nodes and the route exactly once', () => {
  for (const play of [tone, noise, loopNoise]) {
    const { engine, nodes, routes } = fakeEngine();
    const handle = play(engine);
    const source = nodes.find(node => ['oscillator', 'bufferSource'].includes(node.kind));
    const priorStops = source.stops.length;
    handle.stop();
    handle.stop();
    source.onended();
    assert.equal(source.stops.length, priorStops + 1);
    assert.equal(routes[0].disposals, 1);
    assert.ok(nodes.every(node => node.disconnects === 1));
  }
});

test('noise voices share one deterministic, seamless buffer per context', () => {
  const first = fakeEngine();
  const burst = noise(first.engine);
  const loop = loopNoise(first.engine, { gain: 0.2, cutoff: 600 });
  assert.equal(first.buffers.length, 1);
  const sources = first.nodes.filter(node => node.kind === 'bufferSource');
  assert.equal(sources[0].buffer, sources[1].buffer);
  assert.ok(sources.every(source => source.loop === true));
  assert.equal(loop.gain.gain.value, 0.2);
  assert.equal(loop.filter.frequency.value, 600);
  assert.equal(first.routes[1].bus, 'ambience');
  assert.equal(sources[1].stops.length, 0);
  const samples = first.buffers[0].getChannelData(0);
  assert.equal(samples.length, first.context.sampleRate * 2);
  assert.equal(samples[0], samples[samples.length - 1]);
  assert.ok(samples.every(value => Number.isFinite(value) && value >= -1 && value <= 1));
  assert.ok(samples.some(value => value !== samples[0]));
  const second = fakeEngine();
  const other = noise(second.engine);
  assert.notEqual(second.buffers[0], first.buffers[0]);
  assert.deepEqual(second.buffers[0].getChannelData(0), samples);
  burst.stop();
  loop.stop();
  other.stop();
});

test('failed node setup disposes the partial graph and route', () => {
  for (const play of [tone, noise, loopNoise]) {
    const { engine, context, nodes, routes } = fakeEngine();
    context.createBiquadFilter = () => { throw new Error('context closed'); };
    assert.equal(play(engine, { cutoff: 1000 }), null);
    assert.equal(routes[0].disposals, 1);
    assert.ok(nodes.every(node => node.disconnects === 1));
    const source = nodes.find(node => ['oscillator', 'bufferSource'].includes(node.kind));
    assert.equal(source.stops.length, 1);
  }
});

test('parameter smoothing rejects nonfinite inputs and supports the fallback cancellation API', () => {
  const { nodes, context, automation } = fakeEngine();
  const parameter = context.createGain().gain;
  setParam(parameter, NaN, 8);
  setParam(parameter, 0.5, Infinity);
  assert.equal(automation.length, 0);
  setParam(parameter, 0.5, 8, 0.3);
  assert.equal(automation[0].method, 'hold');
  assert.equal(automation[1].method, 'target');
  assert.ok(Math.abs(automation[1].args[2] - 0.1) < 1e-10);
  delete parameter.cancelAndHoldAtTime;
  setParam(parameter, 0.2, 8, 0);
  assert.deepEqual(automation.slice(2), [
    { method: 'cancel', args: [8] },
    { method: 'set', args: [0, 8] },
    { method: 'set', args: [0.2, 8] },
  ]);
  assert.equal(nodes.length, 1);
});

test('explicit decay lowers a transient after attack while the legacy envelope holds its peak', () => {
  for (const play of [tone, noise]) {
    const legacy = fakeEngine();
    const decayed = fakeEngine();
    const original = play(legacy.engine, { gain: 0.4, duration: 0.5, attack: 0.01 });
    const transient = play(decayed.engine, { gain: 0.4, duration: 0.5, attack: 0.01,
      decay: 0.08, sustain: 0.2, release: 0.12 });
    assert.ok(original && transient);
    const legacyCalls = legacy.nodes.find(node => node.kind === 'gain').gain.calls;
    assert.equal(legacyCalls.length, 4);
    assert.equal(legacyCalls[2].args[0], 0.4, 'old callers sustain the full peak until release');
    const envelope = decayed.nodes.find(node => node.kind === 'gain').gain.calls;
    const peak = envelope.find(call => call.method === 'linear' && call.args[0] === 0.4);
    const decay = envelope.find(call => call.method === 'linear' && call.args[0] > 0 && call.args[0] < 0.4);
    assert.ok(peak && decay, 'the decay has its own descending ramp');
    assert.ok(Math.abs(decay.args[0] - 0.08) < 1e-10);
    assert.ok(Math.abs(decay.args[1] - peak.args[1] - 0.08) < 1e-10);
    const hold = envelope.find(call => call.method === 'set' && call.args[0] > 0);
    assert.ok(Math.abs(hold.args[0] - 0.08) < 1e-10);
    assert.ok(Math.abs(hold.args[1] - 8.38) < 1e-10);
    assert.deepEqual(envelope.at(-1), { method: 'linear', args: [0, 8.5] });
    original.stop();
    transient.stop();
  }
});

test('zero decay attacks directly to the sustain level without a jump at release', () => {
  for (const play of [tone, noise]) {
    for (const sustain of [0, 0.2, 0.75]) {
      const audio = fakeEngine();
      const handle = play(audio.engine, { gain: 0.4, duration: 0.5, attack: 0.01,
        decay: 0, sustain, release: 0.12 });
      assert.ok(handle);
      const envelope = audio.nodes.find(node => node.kind === 'gain').gain.calls;
      const heldLevel = 0.4 * sustain;
      assert.ok(envelope.every(call => call.args[0] <= heldLevel), 'zero decay never reaches the unsustained peak');
      assert.deepEqual(envelope[1], { method: 'linear', args: [heldLevel, 8.01] });
      assert.equal(envelope[2].method, 'set');
      assert.equal(envelope[2].args[0], envelope[1].args[0], 'the release begins at the same held level');
      assert.ok(Math.abs(envelope[2].args[1] - 8.38) < 1e-10);
      assert.deepEqual(envelope.at(-1), { method: 'linear', args: [0, 8.5] });
      handle.stop();
    }
  }
});

test('malformed new envelope options preserve the legacy defaults and default filter resonance', () => {
  for (const play of [tone, noise]) {
    const baseline = fakeEngine();
    const handle = play(baseline.engine, { cutoff: 1000 });
    for (const value of [NaN, Infinity, -Infinity, 'invalid', null]) {
      const audio = fakeEngine();
      const malformed = play(audio.engine, { cutoff: 1000, decay: value,
        sustain: value, release: value, Q: value });
      assert.ok(malformed);
      assert.deepEqual(audio.nodes.find(node => node.kind === 'gain').gain.calls,
        baseline.nodes.find(node => node.kind === 'gain').gain.calls);
      assert.equal(audio.nodes.find(node => node.kind === 'filter').Q.value, 0.7);
      malformed.stop();
    }
    handle.stop();
  }
});

test('extreme attack, decay, sustain and release options remain chronological and inside each voice', () => {
  const cases = [
    { duration: 0.005, attack: 1e9, decay: 1e9, release: 1e9, sustain: 1e9 },
    { duration: 0.2, attack: -1e9, decay: -1e9, release: -1e9, sustain: -1e9 },
    { duration: 0.2, attack: 0.1, decay: 0.2, release: 0.2, sustain: 0 },
    { duration: 0.2, attack: 0.001, decay: 0, release: 0, sustain: 0.3 },
  ];
  for (const play of [tone, noise]) {
    for (const options of cases) {
      const audio = fakeEngine();
      const handle = play(audio.engine, { gain: 0.5, ...options });
      assert.ok(handle);
      const calls = audio.nodes.find(node => node.kind === 'gain').gain.calls;
      const times = calls.map(call => call.args[1]);
      assert.ok(times.every((time, index) => time >= 8 && time <= 8 + options.duration + 1e-10
        && (index === 0 || time >= times[index - 1])));
      assert.ok(calls.every(call => call.args[0] >= 0 && call.args[0] <= 0.5));
      assert.equal(calls.at(-1).args[0], 0);
      assert.ok(Math.abs(calls.at(-1).args[1] - (8 + options.duration)) < 1e-10);
      handle.stop();
    }
  }
});

test('filter resonance honors authored Q and bounds out-of-range resonance for burst and loop noise', () => {
  for (const play of [tone, noise, loopNoise]) {
    for (const value of [-1e9, 0, 0.45, 1.3, 1e9]) {
      const audio = fakeEngine();
      const handle = play(audio.engine, { cutoff: 600, Q: value });
      assert.ok(handle);
      const q = audio.nodes.find(node => node.kind === 'filter').Q.value;
      assert.ok(Number.isFinite(q) && q >= 0 && q <= 30);
      if (value === 0.45 || value === 1.3) assert.equal(q, value);
      handle.stop();
    }
  }
});

test('noise bursts vary their sample offset while reusing the same cached buffer', t => {
  const audio = fakeEngine();
  let random = 0.25;
  t.mock.method(Math, 'random', () => random);
  const first = noise(audio.engine);
  random = 0.75;
  const second = noise(audio.engine);
  const sources = audio.nodes.filter(node => node.kind === 'bufferSource');
  assert.equal(audio.buffers.length, 1);
  assert.equal(sources[0].buffer, sources[1].buffer);
  assert.ok(sources[0].offsets[0] < sources[1].offsets[0]);
  assert.ok(sources.every(source => source.offsets[0] < source.buffer.length / audio.context.sampleRate));
  assert.deepEqual(sources.map(source => source.starts[0]), [8, 8]);
  first.stop();
  second.stop();
});

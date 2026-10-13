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
    return {
      value,
      setValueAtTime: (...args) => record('set', args),
      linearRampToValueAtTime: (...args) => record('linear', args),
      exponentialRampToValueAtTime: (...args) => record('exponential', args),
      setTargetAtTime: (...args) => record('target', args),
      cancelAndHoldAtTime: (...args) => record('hold', args),
      cancelScheduledValues: (...args) => record('cancel', args),
    };
  }
  function record(method, args) {
    assert.ok(args.every(Number.isFinite), `${method} has finite parameters`);
    const time = ['hold', 'cancel'].includes(method) ? args[0] : args[1];
    assert.ok(time >= currentTime, `${method} scheduled before the audio clock`);
    automation.push({ method, args });
  }
  function node(kind) {
    const value = {
      kind, connections: [], disconnects: 0, starts: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at) {
        if (at !== undefined) {
          assert.ok(Number.isFinite(at));
          assert.ok(at >= currentTime);
        }
        this.starts.push(at);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { FireAudio } from '../src/audio/fire.js';

function fakeAudio() {
  const nodes = [];
  const routes = [];
  const invalid = [];
  const context = { state: 'running', currentTime: 10, sampleRate: 16000 };
  const parameter = (value = 0) => {
    const param = { value, calls: [] };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime',
      'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelAndHoldAtTime', 'cancelScheduledValues']) {
      param[method] = (...args) => {
        const at = method.startsWith('cancel') ? args[0] : args[1];
        if (!args.every(Number.isFinite) || at < context.currentTime) invalid.push({ method, args });
        param.calls.push({ method, args });
      };
    }
    return param;
  };
  const node = kind => {
    const result = { kind, disconnects: 0, starts: [], offsets: [], stops: [], connections: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at = context.currentTime, offset) {
        if (!Number.isFinite(at) || at < context.currentTime
          || (offset !== undefined && (!Number.isFinite(offset) || offset < 0))) invalid.push({ at, offset });
        this.starts.push(at);
        this.offsets.push(offset);
      },
      stop(at = context.currentTime) { this.stops.push(at); },
    };
    nodes.push(result);
    return result;
  };
  context.createGain = () => Object.assign(node('gain'), { gain: parameter() });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: parameter(), detune: parameter() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: parameter(), Q: parameter() });
  context.createBufferSource = () => Object.assign(node('noise'), { playbackRate: parameter(1) });
  context.createBuffer = (channels, length) => {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  };
  const engine = {
    context, listener: { x: 20, y: 40 },
    spatial: () => ({ gain: 0.8, pan: 0.2 }),
    route(bus, x, y) {
      const route = { bus, x, y, input: {}, pan: { pan: parameter() }, disposals: 0, updates: [],
        dispose() { this.disposals++; },
        update(...position) { this.updates.push(position); },
      };
      routes.push(route);
      return route;
    },
  };
  return { engine, context, nodes, routes, invalid };
}

function assertDisposed(audio) {
  assert.ok(audio.routes.length > 0);
  assert.ok(audio.routes.every(route => route.disposals === 1));
  assert.ok(audio.nodes.every(node => node.disconnects === 1));
  assert.deepEqual(audio.invalid, []);
}


test('campfire sound stays lazy, uses ambience, and updates listener attenuation once', () => {
  const audio = fakeAudio();
  const fires = new FireAudio(audio.engine);
  const sources = [{ id: 1, x: 3, y: 4, seed: 17 }];
  audio.context.state = 'suspended';
  fires.update(sources, 1);
  assert.equal(audio.nodes.length, 0);
  audio.context.state = 'running';
  fires.update(sources, 1);
  const bed = fires.voices.get(1).bed;
  const gain = bed.gain.gain.calls.findLast(call => call.method === 'setTargetAtTime').args[0];
  assert.ok(gain > 0 && gain <= 0.075 * 0.8);
  assert.equal(audio.routes[0].bus, 'ambience');
  assert.equal(audio.routes[0].x, undefined, 'noise bed applies spatial gain only in its live parameter');
  assert.equal(bed.pan.pan.calls.at(-1).args[0], 0.2);
  audio.engine.spatial = () => ({ gain: 0.4, pan: -0.6 });
  fires.update(sources, 1);
  assert.equal(fires.voices.get(1).bed, bed);
  assert.ok(Math.abs(bed.gain.gain.calls.at(-1).args[0] - gain / 2) < 1e-9);
  assert.equal(bed.pan.pan.calls.at(-1).args[0], -0.6);
  fires.pause();
  assertDisposed(audio);
});

test('campfire crackles are positioned, bounded, and released on extinguishing and pause', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const audio = fakeAudio();
  const fires = new FireAudio(audio.engine);
  const sources = Array.from({ length: 8 }, (_, id) => ({ id, x: id * 5, y: 4, seed: id }));
  fires.update(sources, 0);
  assert.equal(fires.voices.size, 4);
  for (let i = 0; i < 20; i++) {
    audio.context.currentTime += 1;
    fires.update(sources, i);
    assert.ok(fires.pops.size <= 16);
  }
  assert.ok(audio.routes.some(route => route.x === 0 && route.y === 4));
  assert.ok(audio.routes.every(route => route.bus === 'ambience'));
  assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0);
  fires.update([], 21);
  assert.equal(fires.voices.size, 0);
  assert.equal(fires.pops.size, 0);
  assertDisposed(audio);
  fires.update(sources, 22);
  assert.equal(fires.voices.size, 4);
  audio.context.state = 'suspended';
  fires.update(sources, 23);
  assert.equal(fires.voices.size, 0);
  fires.dispose();
  audio.context.state = 'running';
  fires.update(sources, 24);
  assert.equal(fires.voices.size, 0);
  assertDisposed(audio);
});

test('fire audio replaces old-context voices and drops distant sources', () => {
  const a = fakeAudio();
  const b = fakeAudio();
  const fires = new FireAudio(a.engine);
  const sources = [{ id: 1, x: 0, y: 4, seed: 1 }];
  fires.update(sources, 0);
  fires.engine = b.engine;
  fires.update(sources, 1);
  assertDisposed(a);
  assert.equal(fires.voices.size, 1);
  b.engine.spatial = () => ({ gain: 0.01, pan: 1 });
  fires.update(sources, 2);
  assert.equal(fires.voices.size, 0);
  assertDisposed(b);
});

test('fire contacts use short positioned Effects voices and remain silent before unlock', () => {
  const audio = fakeAudio();
  const fire = new FireAudio(audio.engine);
  const event = { type: 'fire-stir', x: 3, y: 4, strength: 1 };
  audio.context.state = 'suspended';
  assert.deepEqual(fire.react(event), []);
  assert.equal(audio.nodes.length, 0);
  audio.context.state = 'running';
  const handles = fire.react(event);
  assert.equal(handles.length, 2);
  assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === 4));
  assert.ok(audio.nodes.filter(node => node.kind === 'noise').every(node => node.stops[0] - node.starts[0] < 0.4));
  assert.deepEqual(fire.react({ ...event, strength: NaN }), []);
  handles.forEach(handle => handle.stop());
  fire.dispose();
  assert.deepEqual(fire.react(event), []);
  assertDisposed(audio);
});

test('fire sound builds with flame intensity and stops at extinction', () => {
  const audio = fakeAudio();
  const fires = new FireAudio(audio.engine);
  const fire = { id: 1, x: 3, y: 4, seed: 17, intensity: 0.18 };
  fires.update([fire], 1);
  const bed = fires.voices.get(1).bed;
  const initial = bed.gain.gain.calls.at(-1).args[0];
  fire.intensity = 1;
  fires.update([fire], 1);
  assert.equal(fires.voices.get(1).bed, bed);
  assert.ok(bed.gain.gain.calls.at(-1).args[0] > initial * 5);
  fire.intensity = 0;
  fires.update([fire], 1);
  assert.equal(fires.voices.size, 0);
  assertDisposed(audio);
});

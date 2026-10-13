import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playFootstep } from '../src/audio/footsteps.js';
import { playSword, ChargeHum } from '../src/audio/sword.js';
import { Ambience } from '../src/audio/ambience.js';

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
    const result = { kind, disconnects: 0, starts: [], stops: [], connections: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at = context.currentTime) { this.starts.push(at); },
      stop(at = context.currentTime) { this.stops.push(at); },
    };
    nodes.push(result);
    return result;
  };
  context.createGain = () => Object.assign(node('gain'), { gain: parameter() });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: parameter(), detune: parameter() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: parameter(), Q: parameter() });
  context.createBufferSource = () => node('noise');
  context.createBuffer = (channels, length) => {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
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

test('grass footsteps contain only noise, with a swish and uneven delayed leaf grains', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const audio = fakeAudio();
  const handles = playFootstep(audio.engine, 'grass', { strength: 1, x: 21, y: 40 });
  assert.ok(handles.length >= 4 && handles.length <= 8);
  assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0);
  const sources = audio.nodes.filter(node => node.kind === 'noise');
  assert.equal(sources.length, handles.length);
  const delayed = [...new Set(sources.map(source => source.starts[0]))]
    .filter(time => time > audio.context.currentTime).sort((a, b) => a - b);
  assert.ok(delayed.length >= 3);
  assert.ok(Math.abs((delayed[1] - delayed[0]) - (delayed[2] - delayed[1])) > 0.005);
  assert.ok(sources.some(source => source.stops[0] - source.starts[0] > 0.2), 'a sustained brushing layer');
  assert.ok(sources.every(source => source.stops[0] - source.starts[0] < 0.35));
  assert.ok(audio.routes.every(route => route.x === 21 && route.y === 40));
  handles.forEach(handle => { handle.stop(); handle.stop(); });
  assertDisposed(audio);
});

test('draw, sheath, swing and whirl use material and air noise through the sword bus', () => {
  for (const type of ['draw', 'sheathe', 'swing', 'whirl']) {
    const audio = fakeAudio();
    const handles = playSword(audio.engine, { type, strength: 1, speed: 1, x: 3, y: 4 });
    assert.ok(handles.length > 0);
    assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0, type);
    assert.ok(audio.routes.every(route => route.bus === 'sword' && route.x === 3 && route.y === 4));
    const sources = audio.nodes.filter(node => node.kind === 'noise');
    assert.ok(sources.every(source => source.stops[0] - source.starts[0] <= 0.35));
    assert.ok(sources.every(source => source.starts[0] >= audio.context.currentTime));
    handles.forEach(handle => handle.stop());
    assertDisposed(audio);
  }
});

test('sword impact is short and has no oscillator pitch sweep', () => {
  const audio = fakeAudio();
  const handles = playSword(audio.engine, { type: 'slam', strength: 1 });
  const sources = audio.nodes.filter(node => ['noise', 'oscillator'].includes(node.kind));
  assert.ok(sources.some(source => source.kind === 'noise'));
  assert.ok(sources.every(source => source.stops[0] - source.starts[0] < 0.15));
  for (const oscillator of sources.filter(source => source.kind === 'oscillator')) {
    assert.ok(oscillator.frequency.calls.every(call => call.method === 'setValueAtTime'));
  }
  assert.ok(audio.routes.every(route => route.bus === 'sword'));
  handles.forEach(handle => handle.stop());
  assertDisposed(audio);
});

test('charging holds one quiet noise texture, then pauses, restarts and disposes cleanly', () => {
  const audio = fakeAudio();
  const charge = new ChargeHum(audio.engine);
  charge.update(0.05, 1, 2);
  charge.update(0.25, 2, 3);
  charge.update(0.5, 3, 4);
  assert.equal(audio.nodes.filter(node => node.kind === 'noise').length, 1);
  assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0);
  const first = audio.nodes.find(node => node.kind === 'noise');
  assert.equal(first.loop, true);
  assert.equal(first.stops.length, 0);
  const levels = audio.nodes.find(node => node.kind === 'gain').gain.calls
    .filter(call => call.method === 'setTargetAtTime').map(call => call.args[0]);
  assert.ok(levels.length >= 3);
  assert.ok(levels.every(level => level > 0 && level <= 0.05));
  assert.ok(levels[levels.length - 1] > levels[0]);
  assert.deepEqual(audio.routes[0].updates.at(-1), [3, 4]);
  charge.pause();
  charge.pause();
  assert.equal(first.stops.length, 1);
  assert.equal(audio.routes[0].disposals, 1);
  charge.update(0.3, 4, 5);
  assert.equal(audio.nodes.filter(node => node.kind === 'noise').length, 2);
  charge.release();
  assert.equal(charge.voice, null);
  assert.equal(charge.retiring.size, 1);
  charge.dispose();
  charge.dispose();
  assert.equal(charge.retiring.size, 0);
  charge.update(0.5, 5, 6);
  assert.equal(audio.nodes.filter(node => node.kind === 'noise').length, 2);
  assert.ok(audio.routes.every(route => route.bus === 'sword'));
  assertDisposed(audio);
});

const wildlifeTimers = ['nextCricket', 'nextShimmer', 'nextBird', 'nextOwl', 'nextFrog',
  'nextAnimal', 'nextInsect', 'nextBuzz', 'nextRustle'];

function recordWildlife(timer, environment) {
  const audio = fakeAudio();
  const ambience = new Ambience(audio.engine);
  ambience.update();
  for (const name of wildlifeTimers) ambience[name] = Infinity;
  ambience[timer] = 0;
  const calls = [];
  ambience._note = options => calls.push({ kind: 'note', options });
  ambience._breath = options => calls.push({ kind: 'breath', options });
  ambience.update(environment);
  assert.ok(calls.length < 16, 'a due timer schedules one phrase rather than a catch-up burst');
  assert.ok(calls.every(call => call.options.when >= audio.context.currentTime));
  assert.ok(calls.every(call => Number.isFinite(call.options.x) && Number.isFinite(call.options.y)));
  ambience.dispose();
  assertDisposed(audio);
  return calls;
}

test('bird and insect calls belong to daylight; owls and crickets belong to night', t => {
  t.mock.method(Math, 'random', () => 0.5);
  for (const timer of ['nextBird', 'nextInsect']) {
    assert.ok(recordWildlife(timer, { night: 0 }).length > 0, timer);
    assert.equal(recordWildlife(timer, { night: 1 }).length, 0, timer);
  }
  for (const timer of ['nextOwl', 'nextCricket']) {
    assert.equal(recordWildlife(timer, { night: 0 }).length, 0, timer);
    assert.ok(recordWildlife(timer, { night: 1 }).length > 0, timer);
  }
  assert.equal(recordWildlife('nextRustle', { gust: 0 }).length, 0);
  assert.ok(recordWildlife('nextRustle', { gust: 1 }).length > 0);
});

test('frog calls require a nearby valid lake at night and use the lake position', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const lake = { x: 120, y: 40, strength: 0.8 };
  for (const environment of [
    { night: 1 },
    { night: 0, water: lake },
    { night: 1, water: { ...lake, strength: 0 } },
    { night: 1, water: { ...lake, x: NaN } },
  ]) assert.equal(recordWildlife('nextFrog', environment).length, 0);
  const calls = recordWildlife('nextFrog', { night: 1, water: lake });
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.options.x === lake.x && call.options.y === lake.y));
  assert.ok(calls.some(call => call.kind === 'note') && calls.some(call => call.kind === 'breath'));
});

test('ambience clock jumps prune expired notes and keep wildlife bounded with complete cleanup', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const audio = fakeAudio();
  const ambience = new Ambience(audio.engine);
  const environment = { night: 0.5, gust: 1, water: { x: 15, y: 20, strength: 1 } };
  ambience.update(environment);
  for (let update = 0; update < 15; update++) {
    const previous = [...ambience.notes];
    audio.context.currentTime += 10000;
    const sourceCount = audio.nodes.filter(node => ['noise', 'oscillator'].includes(node.kind)).length;
    ambience.update(environment);
    const newSources = audio.nodes.filter(node => ['noise', 'oscillator'].includes(node.kind)).length - sourceCount;
    assert.ok(newSources > 0 && newSources <= 48);
    assert.ok(ambience.notes.length <= 48);
    assert.ok(previous.every(note => note.end < audio.context.currentTime));
    assert.ok(previous.every(note => !ambience.notes.includes(note)));
    const routes = audio.routes.length;
    ambience.update(environment);
    assert.equal(audio.routes.length, routes, 'same-clock updates do not repeat due wildlife phrases');
  }
  ambience.pause();
  assert.equal(ambience.notes.length, 0);
  assertDisposed(audio);
  ambience.update(environment);
  assert.ok(ambience.wind && ambience.leaves && ambience.water);
  ambience.dispose();
  ambience.dispose();
  const totalRoutes = audio.routes.length;
  ambience.update(environment);
  assert.equal(audio.routes.length, totalRoutes);
  assertDisposed(audio);
});

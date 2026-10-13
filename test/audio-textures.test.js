import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playFootstep } from '../src/audio/footsteps.js';
import { playMovement } from '../src/audio/movement.js';
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

test('draw, sheath, swing and whirl use material and air noise through the sword bus', () => {
  for (const type of ['draw', 'sheathe', 'swing', 'whirl']) {
    const audio = fakeAudio();
    const handles = playSword(audio.engine, { type, strength: 1, speed: 1, x: 3, y: 4 });
    assert.ok(handles.length > 0);
    assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0, type);
    assert.ok(audio.routes.every(route => route.bus === 'sword' && route.x === 3 && route.y === 4));
    const sources = audio.nodes.filter(node => node.kind === 'noise');
    assert.ok(sources.every(source => source.stops[0] - source.starts[0] <= 0.4));
    assert.ok(sources.every(source => source.starts[0] >= audio.context.currentTime));
    handles.forEach(handle => handle.stop());
    assertDisposed(audio);
  }
});

test('sword impact is a short unpitched, decaying contact', () => {
  const audio = fakeAudio();
  const handles = playSword(audio.engine, { type: 'slam', strength: 1 });
  const sources = audio.nodes.filter(node => ['noise', 'oscillator'].includes(node.kind));
  assert.ok(sources.some(source => source.kind === 'noise'));
  assert.ok(sources.every(source => source.stops[0] - source.starts[0] < 0.3));
  assert.equal(sources.filter(source => source.kind === 'oscillator').length, 0);
  for (const gain of audio.nodes.filter(node => node.kind === 'gain')) {
    const ramps = gain.gain.calls.filter(call => call.method === 'linearRampToValueAtTime');
    assert.ok(ramps.length >= 3 && ramps[1].args[0] < ramps[0].args[0]);
  }
  assert.ok(audio.routes.every(route => route.bus === 'sword'));
  handles.forEach(handle => handle.stop());
  assertDisposed(audio);
});

test('four procedural footstep materials keep distinct colors and envelopes, with strength and position', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const colors = new Set();
  const envelopes = new Set();
  for (const surface of ['dirt', 'sand', 'rock', 'water']) {
    const audio = fakeAudio();
    const handles = playFootstep(audio.engine, surface, { strength: 1, x: 32, y: 47 });
    assert.ok(handles.length >= 2 && handles.length <= 10, surface);
    assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0, surface);
    assert.ok(audio.routes.every(route => route.x === 32 && route.y === 47));
    colors.add(JSON.stringify(audio.nodes.filter(node => node.kind === 'filter')
      .map(node => [node.type, node.frequency.value, node.Q.value])));
    envelopes.add(JSON.stringify(audio.nodes.filter(node => node.kind === 'gain')
      .map(node => node.gain.calls.map(call => [call.method, call.args[1] - audio.context.currentTime]))));
    const loudness = Math.max(...audio.nodes.filter(node => node.kind === 'gain')
      .flatMap(node => node.gain.calls.map(call => call.args[0])));
    const soft = fakeAudio();
    const softHandles = playFootstep(soft.engine, surface, { strength: 0.1 });
    const softLoudness = Math.max(...soft.nodes.filter(node => node.kind === 'gain')
      .flatMap(node => node.gain.calls.map(call => call.args[0])));
    assert.ok(softLoudness < loudness, surface);
    for (const gain of audio.nodes.filter(node => node.kind === 'gain')) {
      const ramps = gain.gain.calls.filter(call => call.method === 'linearRampToValueAtTime');
      assert.ok(ramps.some((call, index) => index > 0 && call.args[0] < ramps[0].args[0]
        && call.args[0] > 0), 'contact drops to a damped tail');
    }
    handles.forEach(handle => handle.stop());
    softHandles.forEach(handle => handle.stop());
    assertDisposed(audio);
    assertDisposed(soft);
  }
  assert.equal(colors.size, 4, 'material filters differ');
  assert.equal(envelopes.size, 4, 'material contact timing differs');
  const silent = fakeAudio();
  assert.deepEqual(playFootstep(silent.engine, 'dirt', { strength: 0 }), []);
  silent.context.state = 'suspended';
  assert.deepEqual(playFootstep(silent.engine, 'grass'), []);
  assert.equal(silent.nodes.length, 0);
});

test('jump, landing and skid use unpitched material textures and return stoppable positioned handles', () => {
  const landingColors = new Set();
  for (const surface of ['grass', 'dirt', 'sand', 'rock', 'water']) {
    for (const type of ['jump', 'land', 'skid']) {
      const audio = fakeAudio();
      const handles = playMovement(audio.engine, { type, strength: 0.8, x: 24, y: 45 }, surface);
      assert.ok(handles.length >= 1 && handles.length <= 6);
      assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0, `${surface} ${type}`);
      assert.equal(audio.nodes.filter(node => node.kind === 'noise').length, handles.length);
      assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === 24 && route.y === 45));
      if (type === 'land') landingColors.add(JSON.stringify(audio.nodes.filter(node => node.kind === 'filter')
        .map(node => [node.type, node.frequency.value])));
      const gains = audio.nodes.filter(node => node.kind === 'gain');
      assert.ok(gains.every(node => node.gain.calls.some(call => call.method === 'linearRampToValueAtTime'
        && call.args[0] > 0 && call.args[0] < node.gain.calls[1].args[0])));
      handles.forEach(handle => handle.stop());
      assertDisposed(audio);
    }
  }
  assert.equal(landingColors.size, 5);
});

test('movement strength changes weight; skid cooldown suppresses per-frame repeats and expires', () => {
  for (const type of ['jump', 'land', 'skid']) {
    const quiet = fakeAudio();
    const heavy = fakeAudio();
    const soft = playMovement(quiet.engine, { type, strength: 0.1 }, 'dirt');
    const strong = playMovement(heavy.engine, { type, strength: 1 }, 'dirt');
    const peak = audio => Math.max(...audio.nodes.filter(node => node.kind === 'gain')
      .flatMap(node => node.gain.calls.map(call => call.args[0])));
    assert.ok(peak(heavy) > peak(quiet), type);
    soft.forEach(handle => handle.stop());
    strong.forEach(handle => handle.stop());
    assertDisposed(quiet);
    assertDisposed(heavy);
  }
  const audio = fakeAudio();
  audio.context.currentTime = 0;
  const first = playMovement(audio.engine, { type: 'skid', strength: 1 });
  assert.ok(first.length > 0);
  const routes = audio.routes.length;
  for (let frame = 1; frame <= 5; frame++) {
    audio.context.currentTime = frame / 60;
    assert.deepEqual(playMovement(audio.engine, { type: 'skid', strength: 1 }), []);
  }
  assert.equal(audio.routes.length, routes);
  audio.context.currentTime = 0.12;
  const next = playMovement(audio.engine, { type: 'skid', strength: 1 });
  assert.ok(next.length > 0);
  audio.context.currentTime = 0.3;
  assert.deepEqual(playMovement(audio.engine, { type: 'skid', strength: 0 }), []);
  assert.deepEqual(playMovement(audio.engine, { type: 'unrecognized' }), []);
  audio.context.state = 'suspended';
  assert.deepEqual(playMovement(audio.engine, { type: 'land' }), []);
  [...first, ...next].forEach(handle => handle.stop());
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

test('charge clears retiring tails on suspension and replaces old voices when the audio context changes', () => {
  const audio = fakeAudio();
  const charge = new ChargeHum(audio.engine);
  charge.update(0.3, 1, 2);
  charge.release();
  assert.equal(charge.retiring.size, 1);
  audio.context.state = 'suspended';
  charge.update(0.3, 1, 2);
  assert.equal(charge.retiring.size, 0);
  assert.equal(charge.voice, null);
  assertDisposed(audio);
  audio.context.state = 'running';
  charge.update(0.3, 1, 2);
  const oldVoice = charge.voice;
  const replacement = fakeAudio();
  audio.engine.context = replacement.context;
  charge.update(0.3, 1, 2);
  assert.notEqual(charge.voice, oldVoice);
  assert.equal(oldVoice.cleaned, true);
  assert.equal(charge.voice.context, replacement.context);
  assert.equal(charge.retiring.size, 0);
  charge.dispose();
  assertDisposed(audio);
  assert.ok(replacement.nodes.length > 0 && replacement.nodes.every(node => node.disconnects === 1));
  assert.deepEqual(replacement.invalid, []);
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

test('firefly glints are rare night-gated positioned noise, without musical pings', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const environment = { time: 0, fireflies: [
    { x: 120, y: 40, phase: Math.PI / 2 },
    { x: 8, y: 9, phase: 0 },
  ] };
  assert.equal(recordWildlife('nextShimmer', { ...environment, night: 0 }).length, 0);
  const calls = recordWildlife('nextShimmer', { ...environment, night: 1 });
  assert.ok(calls.length > 0 && calls.length <= 4);
  assert.ok(calls.every(call => call.kind === 'breath'));
  assert.ok(calls.every(call => call.options.x === 120 && call.options.y === 40));
  const audio = fakeAudio();
  const ambience = new Ambience(audio.engine);
  ambience.update();
  for (const name of wildlifeTimers) ambience[name] = Infinity;
  ambience.nextShimmer = 0;
  const initialRoutes = audio.routes.length;
  ambience.update({ ...environment, night: 1 });
  assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0);
  assert.ok(audio.routes.slice(initialRoutes).every(route => route.bus === 'ambience'
    && route.x === 120 && route.y === 40));
  assert.ok(ambience.nextShimmer > audio.context.currentTime + 8, 'glints have a long quiet gap');
  const routes = audio.routes.length;
  audio.context.currentTime += 1;
  ambience.update({ ...environment, night: 1 });
  assert.equal(audio.routes.length, routes);
  ambience.dispose();
  assertDisposed(audio);
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

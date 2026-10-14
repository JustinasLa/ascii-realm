import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playFootstep } from '../src/audio/footsteps.js';
import { playMovement } from '../src/audio/movement.js';
import { playSword, ChargeHum } from '../src/audio/sword.js';
import { Ambience } from '../src/audio/ambience.js';
import { Fireflies } from '../src/world/fireflies.js';
import { WATER } from '../src/world/world.js';
import { FireAudio } from '../src/audio/fire.js';
import { playWaterSound, prepareWaterSounds } from '../src/audio/water.js';
import { SOUND_VARIANT_COUNT } from '../src/audio/variations.js';

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

function textureSignature(nodes) {
  return JSON.stringify(nodes.map(node => ({ kind: node.kind,
    cutoff: node.kind === 'filter' ? node.frequency.value : undefined,
    frequency: node.kind === 'oscillator' ? node.frequency.calls.map(call => call.args[0]) : undefined,
    levels: node.kind === 'gain' ? node.gain.calls.filter(call => !call.method.startsWith('cancel')).map(call => call.args[0]) : undefined,
    duration: node.kind === 'noise' ? node.stops[0] - node.starts[0] : undefined,
  })));
}

test('every material, movement, sword and water cue plays 25 distinct textures without extra voices', async t => {
  t.mock.method(Math, 'random', () => 0.5);
  const cues = [
    ...['dirt', 'sand', 'rock', 'water'].map(surface => [surface, engine => playFootstep(engine, surface)]),
    ...['grass', 'dirt', 'sand', 'rock', 'water'].flatMap(surface =>
      ['jump', 'land', 'skid'].map(type => [`${type}:${surface}`, engine => playMovement(engine, { type, strength: 1 }, surface)])),
    ...['draw', 'sheathe', 'swing', 'slam', 'whirl'].map(type => [type, engine => playSword(engine, { type })]),
    ...['step', 'jump', 'land', 'skid', 'splash', 'slam', 'whirl'].map(type => [`water:${type}`, engine => playWaterSound(engine, { type })]),
  ];
  for (const [name, play] of cues) {
    const audio = fakeAudio();
    if (name === 'water' || name.startsWith('water:')) await prepareWaterSounds(audio.engine, {
      loadBuffer: async () => ({ duration: 0.4 }),
    });
    const signatures = new Set();
    for (let index = 0; index < SOUND_VARIANT_COUNT; index++) {
      audio.context.currentTime += 1;
      const before = audio.nodes.length;
      const handles = play(audio.engine);
      assert.ok(handles.length > 0 && handles.length <= 6, name);
      signatures.add(textureSignature(audio.nodes.slice(before)));
      handles.forEach(handle => handle?.stop());
    }
    assert.equal(signatures.size, SOUND_VARIANT_COUNT, name);
    assertDisposed(audio);
  }
});

test('all wildlife phrases and firefly glints play 25 distinct variations with complete cleanup', t => {
  t.mock.method(Math, 'random', () => 0.5);
  for (const timer of wildlifeTimers) {
    const audio = fakeAudio();
    const ambience = new Ambience(audio.engine);
    const environment = { night: ['nextBird', 'nextInsect'].includes(timer) ? 0 : 1,
      gust: 1, water: { x: 20, y: 40, strength: 1 }, time: 0,
      fireflies: [{ x: 20, y: 40, phase: Math.PI / 2 }] };
    ambience.update(environment);
    for (const name of wildlifeTimers) ambience[name] = Infinity;
    const signatures = new Set();
    for (let index = 0; index < SOUND_VARIANT_COUNT; index++) {
      const before = audio.nodes.length;
      ambience[timer] = 0;
      ambience.update(environment);
      const nodes = audio.nodes.slice(before);
      assert.ok(nodes.length > 0, timer);
      signatures.add(textureSignature(nodes));
      for (const note of ambience.notes) note.handle.stop();
      ambience.notes.length = 0;
    }
    assert.equal(signatures.size, SOUND_VARIANT_COUNT, timer);
    ambience.dispose();
    assertDisposed(audio);
  }
});

test('winter removes actual insect and frog voices while still allowing nocturnal owls', () => {
  for (const timer of ['nextCricket', 'nextInsect', 'nextBuzz', 'nextFrog']) {
    assert.equal(recordWildlife(timer, { season: 'winter', night: timer === 'nextInsect' ? 0 : 1,
      water: { x: 20, y: 40, strength: 1 } }).length, 0, timer);
  }
  assert.ok(recordWildlife('nextOwl', { season: 'winter', night: 1 }).length > 0);
});

test('charge textures and campfire crackles visit 25 variations without accumulating voices', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const audio = fakeAudio();
  const charge = new ChargeHum(audio.engine);
  const charges = new Set();
  for (let index = 0; index < SOUND_VARIANT_COUNT; index++) {
    charge.update(0.5, 3, 4);
    charges.add(charge.voice.lowpass.frequency.calls.at(-1).args[0]);
    charge.pause();
  }
  assert.equal(charges.size, SOUND_VARIANT_COUNT);
  charge.dispose();
  const fires = new FireAudio(audio.engine);
  const sources = [{ id: 1, x: 3, y: 4, seed: 17, age: 20, strength: 1 }];
  fires.update(sources, 0);
  const pops = new Set();
  for (let index = 0; index < SOUND_VARIANT_COUNT; index++) {
    fires.voices.get(1).nextPop = audio.context.currentTime;
    const before = audio.nodes.length;
    fires.update(sources, 0);
    pops.add(textureSignature(audio.nodes.slice(before)));
    assert.ok(fires.pops.size <= 16);
    for (const pop of fires.pops) pop.stop();
  }
  assert.equal(pops.size, SOUND_VARIANT_COUNT);
  fires.dispose();
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

test('three procedural footstep materials keep distinct colors and envelopes, with strength and position', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const colors = new Set();
  const envelopes = new Set();
  for (const surface of ['dirt', 'sand', 'rock']) {
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
  assert.equal(colors.size, 3, 'material filters differ');
  assert.equal(envelopes.size, 3, 'material contact timing differs');
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

test('firefly glints ignore failed spawns and invalid phases without hiding a bright source', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const fireflies = new Fireflies();
  fireflies.update(0, 0, { typeAt: () => WATER }, 20, 40, 10, 5);
  assert.ok(fireflies.list.length > 0);
  assert.ok(fireflies.list.every(firefly => firefly.retryAt > 0));
  const inactive = [
    ...fireflies.list,
    { x: 20, y: 40, phase: NaN },
    { x: 20, y: 40, phase: Infinity },
    { x: 20, y: 40, phase: Math.PI / 2, retryAt: 1 },
  ];
  const environment = { time: 0, night: 1, fireflies: inactive };
  assert.deepEqual(recordWildlife('nextShimmer', environment), []);

  const bright = { x: 120, y: 40, phase: Math.PI / 2 };
  const calls = recordWildlife('nextShimmer', {
    ...environment, fireflies: [...inactive, bright],
  });
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.options.x === bright.x && call.options.y === bright.y));
  assert.ok(calls.every(call => Number.isFinite(call.options.gain) && call.options.gain > 0));
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

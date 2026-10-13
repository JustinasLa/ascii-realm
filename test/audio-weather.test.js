import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine } from '../src/audio/engine.js';
import { WeatherAudio } from '../src/audio/weather.js';
import { WeatherGroup } from '../src/audio/weather/runtime.js';
import { WEATHER_PRESETS } from '../src/audio/weather/presets.js';
import { ASPECT } from '../src/world/world.js';

const expectedIds = ['rain', 'drizzle', 'heavy-rain', 'thunderstorm', 'distant-thunder',
  'wind-gusts', 'gale', 'light-snow', 'snowstorm', 'blizzard', 'hail', 'sleet',
  'sandstorm', 'fog', 'forest-squall', 'ocean-storm', 'ice-storm'];
const filters = new Set(['lowpass', 'highpass', 'bandpass']);

function bounded(value, min, max, message) {
  assert.ok(Number.isFinite(value) && value >= min && value <= max,
    `${message}: ${value} must be finite and within ${min}..${max}`);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

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
        if (!method.startsWith('cancel')) param.value = args[0];
      };
    }
    return param;
  };
  const node = kind => {
    const result = { kind, disconnects: 0, starts: [], stops: [], connections: [],
      connect(target) { this.connections.push(target); return target; },
      disconnect() { this.disconnects++; this.connections = []; },
      start(at = context.currentTime, offset) {
        if (!Number.isFinite(at) || at < context.currentTime
          || (offset !== undefined && (!Number.isFinite(offset) || offset < 0))) invalid.push({ at, offset });
        this.starts.push(at);
      },
      stop(at = context.currentTime) {
        if (!Number.isFinite(at) || at < context.currentTime) invalid.push({ stop: at });
        this.stops.push(at);
      },
    };
    nodes.push(result);
    return result;
  };
  context.makeParam = parameter;
  context.createGain = () => Object.assign(node('gain'), { gain: parameter() });
  context.createStereoPanner = () => Object.assign(node('panner'), { pan: parameter() });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: parameter(), detune: parameter() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: parameter(), Q: parameter() });
  context.createBufferSource = () => Object.assign(node('noise'), { playbackRate: parameter(1) });
  context.createBuffer = (_channels, length) => {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  };
  const engine = {
    context, listener: { x: 20, y: 40 },
    spatial(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { gain: 1, pan: 0 };
      const dx = (x - this.listener.x) * ASPECT;
      const dy = y - this.listener.y;
      return { gain: 1 / (1 + (Math.hypot(dx, dy) / 24) ** 2),
        pan: Math.max(-1, Math.min(1, dx / 24)) };
    },
    route(bus, x, y) {
      if (this.context?.state !== 'running') return null;
      const route = { bus, x, y, input: {}, pan: { pan: this.context.makeParam() },
        disposals: 0, updates: [],
        dispose() { this.disposals++; },
        update(...position) { this.updates.push(position); },
      };
      routes.push(route);
      return route;
    },
  };
  return { engine, context, nodes, routes, invalid };
}

function sources(audio) {
  return audio.nodes.filter(node => node.kind === 'noise' || node.kind === 'oscillator');
}

function assertDisposed(audio) {
  assert.ok(audio.routes.every(route => route.disposals === 1), 'every route disposed once');
  assert.ok(audio.nodes.every(node => node.disconnects === 1), 'every voice node disconnected once');
  assert.deepEqual(audio.invalid, [], 'all audio automation uses finite current/future times');
}

function advance(audio, weather, seconds, simulationTime = 100) {
  const end = audio.context.currentTime + seconds;
  while (audio.context.currentTime < end - 1e-9) {
    audio.context.currentTime = Math.min(end, audio.context.currentTime + 0.1);
    weather.update({ dt: 0.1, time: simulationTime });
  }
}

test('weather registry contains all seventeen individually named natural presets', () => {
  assert.equal(WEATHER_PRESETS.length, 17);
  assert.deepEqual(WEATHER_PRESETS.map(preset => preset.id).sort(), [...expectedIds].sort());
  assert.equal(new Set(WEATHER_PRESETS.map(preset => preset.label)).size, 17);
  for (const preset of WEATHER_PRESETS) {
    assert.equal(Object.getPrototypeOf(preset), Object.prototype, preset.id);
    assert.ok(typeof preset.label === 'string' && preset.label.trim(), preset.id);
    assert.ok(typeof preset.description === 'string' && preset.description.trim(), preset.id);
    assert.ok(preset.layers.length <= 3, preset.id);
    assert.equal(new Set(preset.layers.map(layer => layer.name)).size, preset.layers.length, preset.id);
    for (const layer of preset.layers) {
      assert.ok(typeof layer.name === 'string' && layer.name.length > 0, preset.id);
      assert.ok(filters.has(layer.filterType), preset.id);
      bounded(layer.cutoff, 20, 10000, `${preset.id} layer cutoff`);
      bounded(layer.Q, 0, 8, `${preset.id} layer Q`);
      bounded(layer.gain, 0, 0.14, `${preset.id} layer gain`);
    }
    assert.ok((preset.events?.length ?? 0) <= 2, preset.id);
    for (const group of preset.events ?? []) {
      assert.equal(group.interval.length, 2, preset.id);
      bounded(group.interval[0], 0.01, 120, `${preset.id} minimum event interval`);
      bounded(group.interval[1], group.interval[0], 120, `${preset.id} maximum event interval`);
      if (group.firstDelay) {
        bounded(group.firstDelay[0], 0, 120, `${preset.id} minimum first delay`);
        bounded(group.firstDelay[1], group.firstDelay[0], 120, `${preset.id} maximum first delay`);
      }
    }
  }
});

test('all preset modulation and randomized noise cues stay bounded and silent at zero intensity', () => {
  for (const preset of WEATHER_PRESETS) {
    for (const intensity of [0, 0.6, 1]) {
      for (const now of [0, 0.1, 10, 63, 300, 1800, 100000]) {
        const updates = preset.modulate?.({ now, time: now * 2, intensity }) ?? {};
        for (const [name, update] of Object.entries(updates)) {
          assert.ok(preset.layers.some(layer => layer.name === name), `${preset.id} known layer ${name}`);
          for (const value of Object.values(update)) assert.ok(Number.isFinite(value), preset.id);
          if (update.gain !== undefined) bounded(update.gain, 0, 0.14, `${preset.id} modulated gain`);
          if (update.cutoff !== undefined) bounded(update.cutoff, 20, 10000, `${preset.id} modulated cutoff`);
          if (update.Q !== undefined) bounded(update.Q, 0, 8, `${preset.id} modulated Q`);
          if (update.pan !== undefined) bounded(update.pan, -1, 1, `${preset.id} modulated pan`);
        }
        for (const layer of preset.layers) {
          const gain = updates[layer.name]?.gain ?? layer.gain * intensity;
          if (intensity === 0) assert.equal(gain, 0, `${preset.id} zero-intensity layer`);
        }
        for (const group of preset.events ?? []) {
          const randoms = [() => 0, () => 0.5, () => 0.999999,
            seededRandom(1), seededRandom(42), seededRandom(0xdeadbeef)];
          for (const random of randoms) {
            const cues = group.create({ now, time: now * 2, intensity, random });
            assert.ok(Array.isArray(cues) && cues.length <= 16, preset.id);
            for (const cue of cues) {
              assert.equal(cue.kind, 'noise', `${preset.id} natural unpitched cue`);
              assert.ok(filters.has(cue.filterType), preset.id);
              for (const value of Object.values(cue)) {
                if (typeof value === 'number') assert.ok(Number.isFinite(value), preset.id);
              }
              bounded(cue.delay, 0, 4, `${preset.id} cue delay`);
              bounded(cue.duration, 0.01, 8, `${preset.id} cue duration`);
              bounded(cue.cutoff, 20, 10000, `${preset.id} cue cutoff`);
              bounded(cue.Q, 0, 8, `${preset.id} cue Q`);
              bounded(cue.gain, 0, 0.25, `${preset.id} cue gain`);
              bounded(cue.pan, -1, 1, `${preset.id} cue pan`);
              bounded(cue.sustain, 0, 1, `${preset.id} cue sustain`);
              for (const name of ['attack', 'decay', 'release']) {
                bounded(cue[name], 0, cue.duration, `${preset.id} cue ${name}`);
              }
              assert.ok(cue.attack + cue.decay + cue.release <= cue.duration + 1e-12,
                `${preset.id} envelope fits duration`);
              if (intensity === 0) assert.equal(cue.gain, 0, `${preset.id} zero-intensity cue`);
            }
          }
        }
      }
    }
  }
});

test('weather stays lazy before unlock, while suspended, and on unsupported browsers', async () => {
  let constructions = 0;
  const engine = new AudioEngine({
    contextFactory: () => { constructions++; return null; }, storage: null,
  });
  const unsupported = new WeatherAudio(engine, { storage: null });
  assert.equal(unsupported.preset, 'clear');
  assert.equal(unsupported.intensity, 0.6);
  unsupported.setPreset('rain');
  unsupported.update({ dt: 1 / 60, time: 20 });
  unsupported.pause();
  unsupported.update();
  assert.equal(engine.context, null);
  assert.equal(constructions, 0, 'weather never constructs an audio context');
  assert.equal(await engine.unlock(), false);
  unsupported.update();
  unsupported.dispose();
  unsupported.dispose();
  await engine.dispose();

  const audio = fakeAudio();
  audio.context.state = 'suspended';
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.5 });
  weather.setPreset('rain');
  weather.update({ dt: 1 / 60, time: 100 });
  assert.equal(audio.nodes.length, 0);
  audio.context.state = 'running';
  weather.update({ dt: 1 / 60, time: 100 });
  assert.ok(sources(audio).length > 0);
  weather.dispose();
  assertDisposed(audio);
});

test('clear weather allocates no voices and switching back retires the previous weather', () => {
  const audio = fakeAudio();
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.5 });
  for (let update = 0; update < 3; update++) weather.update({ dt: 1 / 60, time: update });
  weather.setPreset('clear');
  assert.equal(audio.nodes.length, 0);
  assert.equal(audio.routes.length, 0);
  weather.setPreset('rain');
  weather.update();
  const count = sources(audio).length;
  assert.ok(count > 0);
  weather.setPreset('clear');
  assert.equal(sources(audio).length, count, 'clear adds no new sources');
  audio.context.currentTime += 2;
  weather.update();
  assert.ok(sources(audio).every(source => source.disconnects === 1));
  weather.dispose();
  assertDisposed(audio);
});

test('weather changes crossfade and rapid repeated changes bound retiring noise beds', () => {
  const audio = fakeAudio();
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.5 });
  weather.setPreset('rain');
  weather.update();
  const oldSources = [...sources(audio)];
  weather.setPreset('drizzle');
  assert.ok(oldSources.every(source => source.stops.length === 0), 'outgoing weather keeps its fade tail');
  assert.ok(audio.nodes.some(node => node.kind === 'gain'
    && node.gain.calls.some(call => ['setTargetAtTime', 'linearRampToValueAtTime'].includes(call.method)
      && call.args[0] === 0 && call.args[1] > audio.context.currentTime)),
  'gain automation fades the outgoing weather over future audio time');
  for (let change = 0; change < 60; change++) {
    weather.setPreset(['heavy-rain', 'blizzard', 'forest-squall', 'rain'][change % 4]);
    weather.update({ dt: 1 / 60, time: change / 60 });
    assert.ok(sources(audio).filter(source => source.disconnects === 0).length <= 9,
      'at most three groups with three persistent layers each');
  }
  const selectedSources = sources(audio).filter(source => source.disconnects === 0);
  const total = audio.nodes.length;
  weather.setPreset(weather.preset);
  assert.equal(audio.nodes.length, total, 'choosing the same preset does not restart it');
  audio.context.currentTime += 2;
  weather.update();
  assert.ok(oldSources.every(source => source.disconnects === 1));
  assert.ok(selectedSources.filter(source => source.disconnects === 0).length <= 3);
  weather.dispose();
  weather.dispose();
  assertDisposed(audio);
});

test('weather validates and persists selection and intensity without depending on storage access', () => {
  let saved;
  const storage = {
    getItem(key) {
      assert.equal(key, 'ascii-realm.weather');
      return JSON.stringify({ preset: 'rain', intensity: 4 });
    },
    setItem(key, value) {
      assert.equal(key, 'ascii-realm.weather');
      saved = JSON.parse(value);
    },
  };
  const audio = fakeAudio();
  audio.engine.context = null;
  const weather = new WeatherAudio(audio.engine, { storage });
  assert.equal(weather.preset, 'rain');
  assert.equal(weather.intensity, 1);
  weather.setPreset('missing');
  assert.equal(weather.preset, 'rain');
  weather.setIntensity(-1);
  assert.equal(weather.intensity, 0);
  weather.setIntensity(0.37);
  for (const invalid of [NaN, Infinity, '0.5', null, undefined]) weather.setIntensity(invalid);
  assert.equal(weather.intensity, 0.37);
  weather.setPreset('clear');
  assert.deepEqual(saved, { preset: 'clear', intensity: 0.37 });
  assert.equal(audio.nodes.length, 0);
  weather.dispose();

  for (const savedValue of ['{broken', 'null', '[]',
    JSON.stringify({ preset: 'missing', intensity: 'loud' })]) {
    const badStorage = { getItem: () => savedValue, setItem: () => { throw new Error('Denied'); } };
    const recovered = new WeatherAudio({ context: null }, { storage: badStorage });
    assert.equal(recovered.preset, 'clear');
    assert.equal(recovered.intensity, 0.6);
    recovered.setPreset('drizzle');
    recovered.setIntensity(0.2);
    assert.equal(recovered.preset, 'drizzle');
    assert.equal(recovered.intensity, 0.2);
    recovered.dispose();
  }
  const denied = new WeatherAudio({ context: null }, { storage: {
    getItem: () => { throw new Error('Denied'); },
    setItem: () => { throw new Error('Denied'); },
  } });
  denied.setPreset('rain');
  denied.setIntensity(0.4);
  denied.update();
  denied.pause();
  denied.dispose();
});

test('zero intensity silences beds and all group gates and schedules no rain events', () => {
  const audio = fakeAudio();
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.5 });
  weather.setIntensity(0);
  weather.setPreset('rain');
  weather.update();
  const beds = sources(audio).length;
  assert.equal(beds, 2);
  advance(audio, weather, 6);
  assert.equal(sources(audio).length, beds, 'silent weather allocates no event sources');
  assert.equal(weather._active.gate.gain.value, 0);
  assert.ok(weather._active.layers.every(layer => layer.handle.gain.gain.value === 0));
  weather.setIntensity(0.7);
  advance(audio, weather, 1);
  assert.equal(weather._active.gate.gain.value, 1);
  assert.ok(weather._active.layers.every(layer => layer.handle.gain.gain.value > 0));
  assert.ok(sources(audio).length > beds, 'raising intensity resumes fresh rain events');
  weather.setPreset('heavy-rain');
  weather.setIntensity(0);
  const sourceCount = sources(audio).length;
  for (const group of [weather._active, ...weather._retiring]) assert.equal(group.gate.gain.value, 0);
  advance(audio, weather, 3);
  assert.equal(sources(audio).length, sourceCount, 'both current and fading weather remain event-silent');
  assert.equal(weather._budget.voices.size, 0);
  weather.dispose();
  assertDisposed(audio);
});

test('events follow audio time and clock jumps skip old cues without replay bursts', () => {
  const audio = fakeAudio();
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.5 });
  weather.setPreset('rain');
  weather.update({ dt: 1 / 60, time: 0 });
  const beds = sources(audio).length;
  for (let update = 1; update <= 10; update++) weather.update({ dt: 1000, time: update * 1000 });
  assert.equal(sources(audio).length, beds, 'simulation time alone does not trigger audio events');
  advance(audio, weather, 1);
  assert.ok(sources(audio).length > beds);
  const previousVoices = [...weather._active.voices];
  const count = sources(audio).length;
  audio.context.currentTime += 10000;
  weather.update({ dt: 10000, time: 20000 });
  assert.equal(sources(audio).length, count, 'missed rainfall is skipped on a large clock jump');
  assert.equal(weather._active.voices.length, 0, 'expired one-shots are pruned');
  assert.ok(previousVoices.every(voice => voice.handle.ended && !weather._budget.voices.has(voice)));
  for (let update = 0; update < 10; update++) weather.update({ dt: 1 / 60, time: 30000 + update });
  assert.equal(sources(audio).length, count, 'same-clock updates do not replay due events');
  advance(audio, weather, 2);
  assert.ok(sources(audio).length > count, 'fresh future events resume after the jump');
  weather.dispose();
  assertDisposed(audio);
});

test('weather cues use filtered noise and keep their pan relative to the moving listener', () => {
  const audio = fakeAudio();
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.9 });
  weather.setPreset('drizzle');
  advance(audio, weather, 1.5);
  assert.equal(sources(audio).length, 2, 'one persistent mist bed and one foliage tick');
  assert.equal(audio.nodes.filter(node => node.kind === 'oscillator').length, 0);
  const source = sources(audio).at(-1);
  const filter = source.connections[0];
  assert.equal(filter.type, 'bandpass');
  assert.equal(filter.frequency.value, 5460);
  assert.ok(Math.abs(filter.Q.value - 0.72) < 1e-12);
  const gain = filter.connections[0];
  const input = gain.connections[0];
  const panner = input.connections[0];
  assert.equal(panner.kind, 'panner');
  assert.ok(Math.abs(panner.pan.value - 0.64) < 1e-12);
  assert.ok(source.starts[0] >= 11.4 && source.starts[0] <= audio.context.currentTime);
  assert.ok(audio.routes.every(route => route.bus === 'weather'), 'all textures share the weather bus');
  audio.engine.listener = { x: 220, y: -60 };
  audio.context.currentTime += 0.01;
  weather.update();
  assert.ok(Math.abs(panner.pan.value - 0.64) < 1e-12, 'camera movement keeps a weather tick at its relative side');
  source.onended();
  weather.update();
  assert.equal(weather._budget.voices.size, 0);
  assert.ok([source, filter, gain, input, panner].every(node => node.disconnects === 1),
    'natural source completion cleans the whole event graph');
  weather.dispose();
  weather.dispose();
  assertDisposed(audio);
});

test('pause, suspension and context replacement clean every old group and preserve preferences', () => {
  const audio = fakeAudio();
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.5 });
  weather.setPreset('rain');
  advance(audio, weather, 0.5);
  weather.setPreset('drizzle');
  assert.equal(weather._retiring.length, 1);
  weather.pause();
  weather.pause();
  assert.equal(weather._active, null);
  assert.equal(weather._retiring.length, 0);
  assert.equal(weather._budget.voices.size, 0);
  assert.equal(weather.preset, 'drizzle');
  assert.equal(weather.intensity, 0.6);
  assertDisposed(audio);
  weather.update();
  const resumed = weather._active;
  assert.ok(resumed);
  audio.context.state = 'suspended';
  weather.update();
  assert.equal(weather._active, null);
  assertDisposed(audio);
  audio.context.state = 'running';
  weather.update();
  const old = weather._active;
  const replacement = fakeAudio();
  audio.engine.context = replacement.context;
  weather.update();
  assert.equal(old.disposed, true);
  assert.notEqual(weather._active, old);
  assert.equal(weather._active.context, replacement.context);
  assert.equal(weather._retiring.length, 0);
  assert.ok(replacement.nodes.length > 0);
  assert.ok(audio.nodes.every(node => node.disconnects === 1), 'the original context retains no weather nodes');
  weather.dispose();
  weather.dispose();
  const total = audio.routes.length;
  weather.setPreset('rain');
  weather.setIntensity(1);
  weather.update();
  assert.equal(audio.routes.length, total, 'disposed weather never restarts');
  assertDisposed(audio);
  assertDisposed(replacement);
});

test('weather remains optional without stereo panning support', () => {
  const audio = fakeAudio();
  audio.context.createStereoPanner = undefined;
  const weather = new WeatherAudio(audio.engine, { storage: null, random: () => 0.5 });
  weather.setPreset('rain');
  advance(audio, weather, 1);
  assert.ok(sources(audio).length > 2);
  assert.equal(audio.nodes.filter(node => node.kind === 'panner').length, 0);
  weather.dispose();
  assertDisposed(audio);
});

test('fading groups share a bounded event budget and release it on teardown', () => {
  const audio = fakeAudio();
  const cue = { kind: 'noise', delay: 0, duration: 8, filterType: 'lowpass',
    cutoff: 700, Q: 0.4, gain: 0.02, attack: 0.1, decay: 0.5,
    sustain: 0.2, release: 2, pan: 0 };
  const definition = { id: 'test-shower', layers: [], events: [{
    interval: [0.05, 0.05], firstDelay: [0, 0],
    create: () => Array.from({ length: 16 }, () => ({ ...cue })),
  }] };
  const budget = { voices: new Set(), limit: 64 };
  const groups = Array.from({ length: 3 }, () => new WeatherGroup(audio.engine, definition,
    { budget, intensity: 1, random: () => 0.5 }));
  for (let update = 0; update < 10; update++) {
    for (const group of groups) group.update();
    assert.ok(budget.voices.size <= 64);
    audio.context.currentTime += 0.1;
  }
  assert.equal(budget.voices.size, 64, 'event scheduling reaches but never exceeds the shared cap');
  assert.equal(sources(audio).filter(source => source.disconnects === 0).length, 64);
  groups[0].dispose();
  const released = budget.voices.size;
  assert.ok(released < 64);
  groups[1].update();
  assert.ok(budget.voices.size > released && budget.voices.size <= 64, 'freed slots can serve a still-active group');
  groups.forEach(group => { group.dispose(); group.dispose(); });
  assert.equal(budget.voices.size, 0);
  assertDisposed(audio);
});

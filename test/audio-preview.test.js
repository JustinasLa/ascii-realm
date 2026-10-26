import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindAudioControls } from '../src/audio/controls.js';
import { AudioEngine } from '../src/audio/engine.js';
import { GRASS_SAMPLE_URLS, prepareGrassFootsteps } from '../src/audio/grass-steps.js';

class Element extends EventTarget {
  constructor() {
    super();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.dataset = {};
    this.nextElementSibling = { value: '' };
  }
  setAttribute() {}
  append() {}
  replaceChildren(...nodes) { this.textContent = nodes.map(node => node.textContent ?? node).join(''); }
}

function dom(t) {
  const cleanups = [];
  const document = Object.assign(new EventTarget(), { hidden: false, createElement: () => new Element() });
  const window = new EventTarget();
  const previous = new Map(['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => {
    cleanups.forEach(cleanup => cleanup());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const bind = (engine, onPause = () => {}) => {
    const ids = ['audio-mute', 'audio-status', 'audio-skip', 'audio-song', 'audio-weather',
      'weather-intensity', 'weather-description', 'grass-preview'];
    const elements = new Map(ids.map(id => [`#${id}`, new Element()]));
    const sliders = Object.keys(engine.volumes).map(volume => Object.assign(new Element(), { dataset: { volume } }));
    const root = { querySelector: selector => elements.get(selector), querySelectorAll: () => sliders };
    const preview = elements.get('#grass-preview');
    preview.textContent = 'Preview grass footsteps';
    const unbind = bindAudioControls(engine, { currentSong: 'Field song', skip() {} },
      { preset: 'clear', intensity: 0.6, presets: [] }, onPause, root);
    cleanups.push(unbind);
    return { preview, unbind, sliders, mute: elements.get('#audio-mute') };
  };
  return { document, window, bind };
}

function fakeAudio() {
  const nodes = [];
  const routes = [];
  const context = { state: 'running', currentTime: 10 };
  const parameter = value => ({ value, calls: [],
    cancelAndHoldAtTime(at) { this.calls.push(['hold', at]); },
    setTargetAtTime(target, at, smoothing) { this.value = target; this.calls.push(['target', target, at, smoothing]); },
    setValueAtTime(target, at) { this.value = target; this.calls.push(['set', target, at]); },
    linearRampToValueAtTime(target, at) { this.value = target; this.calls.push(['ramp', target, at]); },
  });
  const node = kind => {
    const result = { kind, connections: [], disconnects: 0, starts: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; this.connections = []; },
      start(at) {
        assert.equal(context.state, 'running');
        this.starts.push(at);
        this.endAt = at + this.buffer.duration / this.playbackRate.value;
      },
      stop() { this.stops.push(context.currentTime); },
    };
    nodes.push(result);
    return result;
  };
  context.createBufferSource = () => Object.assign(node('source'), { playbackRate: parameter(1) });
  context.createGain = () => Object.assign(node('gain'), { gain: parameter(0) });
  const volumes = Object.freeze({ master: 0.7, music: 0.35, sfx: 0.8, ambience: 0.6, sword: 0.65, weather: 0.55 });
  const engine = {
    context, volumes, muted: false, listener: { x: 21, y: 40 },
    buses: Object.fromEntries(Object.entries(volumes).map(([bus, value]) => [bus, { gain: parameter(value) }])),
    preferenceEdits: 0, suspends: 0,
    async unlock() { context.state = 'running'; return true; },
    async suspend() { this.suspends++; context.state = 'suspended'; },
    toggleMute() { this.muted = !this.muted; },
    setVolume() { this.preferenceEdits++; },
    route(bus, x, y) {
      const route = { bus, x, y, input: {}, disposals: 0, dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    },
  };
  return { engine, context, nodes, routes };
}

const sources = audio => audio.nodes.filter(node => node.kind === 'source');
const recording = url => ({ duration: 0.32, id: url.pathname.split('/').at(-1) });

async function settle() {
  // EventTarget does not return promises from async event listeners.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function advance(t, audio, milliseconds) {
  if (audio.context.state === 'running') audio.context.currentTime += milliseconds / 1000;
  for (const source of sources(audio)) {
    if (source.endAt <= audio.context.currentTime && source.onended && source.stops.length === 0) source.onended();
  }
  t.mock.timers.tick(milliseconds);
}

function assertClean(audio) {
  assert.ok(audio.nodes.every(node => node.disconnects === 1), 'every sample graph disconnects once');
  assert.ok(audio.routes.every(route => route.disposals === 1), 'every effects route disposes once');
}

test('grass preview plays six recorded contacts at 420ms spacing and restores only its temporary duck', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.5);
  const ui = dom(t);
  const audio = fakeAudio();
  const saved = { ...audio.engine.volumes };
  assert.equal(await prepareGrassFootsteps(audio.engine, { loadBuffer: async url => recording(url) }), true);
  const { preview, unbind } = ui.bind(audio.engine);
  preview.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(preview.disabled, true);
  assert.match(preview.textContent, /Playing grass footsteps/);
  assert.equal(sources(audio).length, 1);
  for (const bus of ['music', 'ambience']) assert.equal(audio.engine.buses[bus].gain.value, 0);
  for (let step = 1; step < 6; step++) {
    advance(t, audio, 419);
    assert.equal(sources(audio).length, step, 'the next contact waits for its full interval');
    advance(t, audio, 1);
    assert.equal(sources(audio).length, step + 1);
  }
  const played = sources(audio);
  assert.deepEqual(played.map(source => source.buffer.id).sort(), GRASS_SAMPLE_URLS.map(url => recording(url).id).sort());
  for (let index = 0; index < played.length; index++) {
    assert.ok(Math.abs(played[index].starts[0] - (10 + index * 0.42)) < 1e-10);
    assert.equal(played[index].loop, false);
  }
  assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === 21 && route.y === 40));
  advance(t, audio, 549);
  assert.equal(preview.disabled, true, 'the button remains disabled through the last tail');
  assert.equal(audio.engine.buses.music.gain.value, 0);
  advance(t, audio, 1);
  assert.equal(preview.disabled, false);
  assert.equal(preview.textContent, 'Preview grass footsteps');
  for (const bus of ['music', 'ambience']) assert.equal(audio.engine.buses[bus].gain.value, saved[bus]);
  for (const bus of ['master', 'sfx', 'sword', 'weather']) assert.deepEqual(audio.engine.buses[bus].gain.calls, []);
  assert.deepEqual(audio.engine.volumes, saved);
  assert.equal(audio.engine.preferenceEdits, 0);
  advance(t, audio, 5000);
  assert.equal(sources(audio).length, 6);
  unbind();
  assertClean(audio);
});

test('the game unlocks audio inside every key and pointer gesture, before anything waits', t => {
  const ui = dom(t);
  const audio = fakeAudio();
  let calls = 0;
  audio.engine.unlock = () => { calls++; return Promise.resolve(true); };
  ui.bind(audio.engine);
  const pointer = (type, pointerType) => Object.assign(new Event(type), { pointerType });
  ui.window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Digit1' }));
  assert.equal(calls, 1, 'a key press unlocks within its handler');
  ui.window.dispatchEvent(pointer('pointerdown', 'mouse'));
  assert.equal(calls, 2, 'a mouse press unlocks within its handler');
  ui.window.dispatchEvent(pointer('pointerdown', 'touch'));
  assert.equal(calls, 2, 'touch gains activation on release');
  ui.window.dispatchEvent(pointer('pointerup', 'touch'));
  assert.equal(calls, 3, 'a tap unlocks within its release handler');
});

test('volume changes and mute controls preserve preview ducking with the real engine', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = dom(t);
  const audio = fakeAudio();
  const engine = new AudioEngine({ contextFactory: () => audio.context, storage: null });
  assert.equal(await engine.unlock(), true);
  await prepareGrassFootsteps(engine, { loadBuffer: async url => recording(url) });
  const { preview, sliders, mute } = ui.bind(engine);
  preview.dispatchEvent(new Event('click'));
  await settle();
  const assertDucked = () => {
    assert.equal(preview.disabled, true);
    for (const bus of ['music', 'ambience']) assert.equal(engine.buses[bus].gain.value, 0);
  };
  assertDucked();
  assert.equal(sliders.find(slider => slider.dataset.volume === 'records').value, 80);
  for (const [bus, value] of [['sfx', 50], ['music', 25], ['ambience', 40], ['records', 30]]) {
    const slider = sliders.find(slider => slider.dataset.volume === bus);
    slider.value = value;
    slider.dispatchEvent(new Event('input'));
    assert.equal(engine.volumes[bus], value / 100);
    assertDucked();
  }
  assert.equal(engine.buses.records.gain.value, 0.3, 'the grass preview leaves instruments alone');
  mute.dispatchEvent(new Event('click'));
  assert.equal(engine.muted, true);
  assertDucked();
  ui.window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyM' }));
  assert.equal(engine.muted, false);
  assertDucked();
  for (let step = 1; step < 6; step++) advance(t, audio, 420);
  advance(t, audio, 550);
  assert.equal(preview.disabled, false);
  assert.equal(engine.buses.music.gain.value, 0.25);
  assert.equal(engine.buses.ambience.gain.value, 0.4);
  assert.equal(engine.buses.sfx.gain.value, 0.5);
});

test('unbind, hiding the document and context suspension stop preview voices and pending contacts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = dom(t);
  for (const mode of ['unbind', 'hidden', 'suspended']) {
    ui.document.hidden = false;
    const audio = fakeAudio();
    await prepareGrassFootsteps(audio.engine, { loadBuffer: async url => recording(url) });
    let pauses = 0;
    const { preview, unbind } = ui.bind(audio.engine, () => { pauses++; });
    preview.dispatchEvent(new Event('click'));
    await settle();
    assert.equal(sources(audio).length, 1, mode);
    if (mode === 'unbind') unbind();
    if (mode === 'hidden') {
      ui.document.hidden = true;
      ui.document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      assert.equal(pauses, 1);
      assert.equal(audio.engine.suspends, 1);
    }
    if (mode === 'suspended') {
      audio.context.state = 'suspended';
      advance(t, audio, 420);
    }
    assert.equal(preview.disabled, false, mode);
    assert.equal(preview.textContent, 'Preview grass footsteps');
    assert.equal(sources(audio)[0].stops.length, 1, `${mode} stops an active recording`);
    for (const bus of ['music', 'ambience']) assert.equal(audio.engine.buses[bus].gain.value, audio.engine.volumes[bus]);
    advance(t, audio, 5000);
    assert.equal(sources(audio).length, 1, `${mode} cancels the remaining five contacts`);
    assert.equal(audio.engine.preferenceEdits, 0);
    unbind();
    unbind();
    assertClean(audio);
  }
});

test('unbind during pending recording decode prevents late playback or a renewed duck', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = dom(t);
  const audio = fakeAudio();
  const releases = [];
  const loading = prepareGrassFootsteps(audio.engine, {
    loadBuffer: url => new Promise(resolve => releases.push(() => resolve(recording(url)))),
  });
  const { preview, unbind } = ui.bind(audio.engine);
  preview.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(releases.length, 6);
  assert.equal(preview.disabled, true);
  assert.match(preview.textContent, /Loading footsteps/);
  assert.equal(sources(audio).length, 0);
  unbind();
  releases.forEach(release => release());
  assert.equal(await loading, true, 'the real cached loader may finish safely after controls unbind');
  await settle();
  advance(t, audio, 5000);
  assert.equal(sources(audio).length, 0, 'completed loading never replays the cancelled preview');
  assert.equal(audio.routes.length, 0);
  for (const bus of Object.keys(audio.engine.buses)) assert.deepEqual(audio.engine.buses[bus].gain.calls, []);
  assert.equal(audio.engine.preferenceEdits, 0);
  assert.equal(preview.disabled, false);
  assert.equal(preview.textContent, 'Preview grass footsteps');
  preview.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(sources(audio).length, 0, 'the preview click listener was removed');
});

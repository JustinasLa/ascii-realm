import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INSTRUMENT_IDS, INSTRUMENTS, MAX_VOICES, START_LEAD, STEAL_RELEASE, noteMidi, playInstrumentNote,
  prepareInstrument, soundingVoices,
} from '../src/audio/instruments.js';
import {
  MAX_STRING_BUFFERS, STRING_RATE, STRING_RECIPES, buildVoice, prepareStrings, renderString, stringBuffer,
} from '../src/audio/instrument-voices.js';

// A fake audio graph: parameters must be finite and scheduled on the audio
// clock; nodes record their connections, starts and stops.
function fakeAudio({ sampleRate = 48000, currentTime = 10, throwOn = null } = {}) {
  const nodes = [];
  const routes = [];
  const buffers = [];
  let made = 0;
  const context = { state: 'running', currentTime, sampleRate };
  function param(value = 0) {
    const calls = [];
    const result = { value, calls };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
      'setTargetAtTime', 'cancelAndHoldAtTime', 'cancelScheduledValues']) {
      result[method] = (...args) => {
        assert.ok(args.every(Number.isFinite), `${method} parameters are finite`);
        const at = ['cancelAndHoldAtTime', 'cancelScheduledValues'].includes(method) ? args[0] : args[1];
        assert.ok(at >= context.currentTime - 1e-9, `${method} is scheduled on the audio clock`);
        calls.push({ method, args });
      };
    }
    return result;
  }
  function node(kind) {
    made++;
    if (throwOn && throwOn(kind, made)) throw new Error('Unsupported node');
    const result = { kind, connections: [], disconnects: 0, starts: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at, offset) {
        assert.ok(Number.isFinite(at) && at >= context.currentTime - 1e-9);
        if (offset !== undefined) assert.ok(Number.isFinite(offset) && offset >= 0);
        this.starts.push(at);
      },
      stop(at) {
        if (at !== undefined) assert.ok(Number.isFinite(at) && at >= context.currentTime - 1e-9);
        this.stops.push(at);
      } };
    nodes.push(result);
    return result;
  }
  context.createGain = () => Object.assign(node('gain'), { gain: param(1) });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: param(), detune: param() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: param(), Q: param(), gain: param() });
  context.createBufferSource = () => Object.assign(node('bufferSource'), { playbackRate: param(1) });
  context.createBuffer = (channels, length, rate) => {
    assert.ok(Number.isInteger(length) && length > 0);
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate: rate, getChannelData: channel => data[channel] };
    buffers.push(buffer);
    return buffer;
  };
  const engine = { context,
    route(bus, x, y) {
      const route = { bus, x, y, input: { kind: 'route', gain: { value: 1 } }, disposals: 0,
        dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    } };
  return { context, engine, nodes, routes, buffers,
    sources: () => nodes.filter(item => ['oscillator', 'bufferSource'].includes(item.kind)) };
}

const rms = (samples, from, to) => {
  let sum = 0;
  for (let index = from; index < to; index++) sum += samples[index] ** 2;
  return Math.sqrt(sum / (to - from));
};
const db = value => 20 * Math.log10(value);
function pitchOf(samples, rate, near) {
  const start = Math.round(rate * 0.1);
  const span = Math.round(rate * 0.1);
  const values = new Map();
  let best = -Infinity;
  let lag = 0;
  for (let candidate = Math.floor(rate / (near * 1.2)); candidate <= Math.ceil(rate / (near / 1.2)); candidate++) {
    let sum = 0;
    for (let index = 0; index < span; index++) sum += samples[start + index] * samples[start + index + candidate];
    values.set(candidate, sum);
    if (sum > best) { best = sum; lag = candidate; }
  }
  const [a, b, c] = [values.get(lag - 1), best, values.get(lag + 1)];
  return rate / (lag + (a - c) / (2 * (a - 2 * b + c)));
}
const cents = (got, want) => 1200 * Math.log2(got / want);
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
// Notes played at the fake clock's 10 s start a little ahead of it.
const T = 10 + START_LEAD;

test('every instrument builds a complete one-shot on the records bus', () => {
  for (const id of INSTRUMENT_IDS) {
    const fake = fakeAudio();
    const handle = playInstrumentNote(fake.engine, { instrument: id, degree: 2, x: 12, y: -4 });
    assert.ok(handle, id);
    assert.equal(fake.routes.length, 1);
    const route = fake.routes[0];
    assert.equal(route.bus, 'records');
    assert.deepEqual([route.x, route.y], [12, -4], 'the route pans from the note position');
    assert.equal(route.input.gain.value, 1, 'instruments set their own loudness');
    assert.ok(fake.nodes.some(node => node.connections.includes(route.input)), `${id} reaches the route`);
    const length = INSTRUMENTS[id].length;
    for (const source of fake.sources()) {
      assert.deepEqual(source.starts, [T]);
      assert.ok(Math.abs(source.stops[0] - T - length) <= 0.05, `${id} lasts its natural length`);
    }
    assert.equal(handle.end, T + length);
    assert.equal(handle.voices.length, 1);
    // The envelope reaches the instrument's level and ends silent.
    const envelope = fake.nodes.find(node => node.connections.includes(route.input));
    const calls = envelope.gain.calls;
    assert.ok(calls.some(call => Math.abs(call.args[0] - INSTRUMENTS[id].level) < 1e-9));
    assert.deepEqual(calls.at(-1), { method: 'linearRampToValueAtTime', args: [0, T + length] });
  }
});

test('each instrument has its own sound: no two graphs are alike', () => {
  const signatures = new Map();
  for (const id of INSTRUMENT_IDS) {
    const fake = fakeAudio();
    playInstrumentNote(fake.engine, { instrument: id, degree: 0 });
    const lfo = fake.nodes.some(node => node.kind === 'oscillator'
      && node.connections.some(gain => gain.connections?.some(target => Array.isArray(target.calls))));
    const parts = fake.nodes.map(node => node.kind === 'oscillator' ? `osc:${node.type}`
      : node.kind === 'filter' ? `filter:${node.type}:${Math.round(node.frequency.value)}`
        : node.kind === 'bufferSource' ? (node.loop ? 'noise' : `string:${node.buffer.length}`) : node.kind);
    const signature = JSON.stringify([parts.sort(), lfo]);
    assert.equal(lfo, ['vielle', 'flute'].includes(id), `${id} vibrato`);
    for (const [other, seen] of signatures) assert.notEqual(signature, seen, `${id} sounds like ${other}`);
    signatures.set(id, signature);
  }
  // The shapes that make each voice what it is.
  const graphOf = id => {
    const fake = fakeAudio();
    playInstrumentNote(fake.engine, { instrument: id, degree: 0 });
    return fake;
  };
  const vielle = graphOf('vielle');
  assert.ok(vielle.nodes.some(node => node.kind === 'bufferSource' && node.loop), 'bow noise');
  assert.ok(vielle.nodes.filter(node => node.kind === 'oscillator').some(node =>
    node.type === 'sine' && node.frequency.calls[0].args[0] === 5.5), 'a vibrato');
  const accordion = graphOf('accordion');
  const reeds = accordion.nodes.filter(node => node.kind === 'oscillator').map(node => node.detune.calls[0].args[0]);
  assert.deepEqual(reeds, [-7, 7], 'two reeds tuned apart');
  const bagpipe = graphOf('bagpipe');
  const pipes = bagpipe.nodes.filter(node => node.kind === 'oscillator');
  assert.deepEqual(pipes[0].frequency.calls.map(call => call.args), [[hz(60) * 1.5, T], [hz(60), T + 0.022]],
    'a grace note a fifth above opens the chanter');
  assert.equal(pipes[1].frequency.calls[0].args[0], hz(48), 'the drone sits on C3');
  const trumpet = graphOf('trumpet');
  const bell = trumpet.nodes.find(node => node.kind === 'filter');
  assert.deepEqual(bell.frequency.calls.map(call => Math.round(call.args[0])), [392, 2093, 1308], 'the bell opens');
  const kalimba = graphOf('kalimba');
  assert.ok(kalimba.nodes.some(node => node.kind === 'oscillator'
    && Math.abs(node.frequency.calls[0].args[0] - hz(72) * 5.95) < 1e-6), 'an inharmonic partial');
  const lute = graphOf('lute');
  assert.equal(lute.buffers[0].sampleRate, STRING_RATE, 'strings render at the string rate');
});

test('chords are three equal-power pitches behind one handle', () => {
  const fake = fakeAudio();
  const handle = playInstrumentNote(fake.engine, { instrument: 'lute', degree: 1, chord: true, level: 0.6 });
  assert.equal(handle.voices.length, 3);
  assert.deepEqual(handle.voices.map(voice => voice.midi), noteMidi('lute', 1, 0, true));
  assert.equal(fake.routes.length, 3);
  for (const route of fake.routes) assert.ok(Math.abs(route.input.gain.value - 0.6 / Math.sqrt(3)) < 1e-12);
  // Chords play on octave instruments too, and levels clamp.
  const flute = fakeAudio();
  const loud = playInstrumentNote(flute.engine, { instrument: 'flute', degree: 0, chord: true, level: 4 });
  assert.equal(loud.voices.length, 3);
  assert.ok(Math.abs(flute.routes[0].input.gain.value - 1 / Math.sqrt(3)) < 1e-12);
  assert.equal(handle.ended, false);
  handle.stop();
  assert.equal(handle.ended, true);
  assert.ok(fake.sources().every(source => source.stops.length === 2), 'every pitch is stopped');
  assert.ok(fake.routes.every(route => route.disposals === 1));
  handle.stop();
  assert.ok(fake.routes.every(route => route.disposals === 1), 'stopping twice is harmless');
});

test('notes clean up when their last source ends', () => {
  const fake = fakeAudio();
  const handle = playInstrumentNote(fake.engine, { instrument: 'vielle', degree: 0 });
  const sources = fake.sources();
  for (const source of sources.slice(1)) source.onended();
  assert.equal(handle.ended, false);
  sources[0].onended();
  assert.equal(handle.ended, true);
  assert.equal(fake.routes[0].disposals, 1);
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
  assert.deepEqual(soundingVoices(fake.engine), [], 'ended voices are pruned');
  fake.context.state = 'closed';
  handle.stop();
});

test('nothing plays without running audio or a valid note', () => {
  for (const context of [null, undefined, { state: 'suspended' }, { state: 'closed' }]) {
    const engine = { context, route() { assert.fail('locked audio made a route'); } };
    assert.equal(playInstrumentNote(engine, { instrument: 'lute', degree: 0 }), null);
  }
  assert.equal(playInstrumentNote(undefined, { instrument: 'lute', degree: 0 }), null);
  for (const event of [undefined, {}, { instrument: 'harp', degree: 0 }, { instrument: 'lute', degree: 9 },
    { instrument: 'lute', degree: 0, octave: 3 }, { instrument: 'lute', degree: 0, level: 0 },
    { instrument: 'lute', degree: 0, level: -1 }]) {
    const fake = fakeAudio();
    assert.equal(playInstrumentNote(fake.engine, event), null, JSON.stringify(event));
    assert.equal(fake.nodes.length, 0);
  }
  const fake = fakeAudio();
  assert.ok(playInstrumentNote(fake.engine, { instrument: 'lute', degree: 0, level: NaN }), 'a missing level is full');
  const routeless = fakeAudio();
  routeless.engine.route = () => null;
  assert.equal(playInstrumentNote(routeless.engine, { instrument: 'lute', degree: 0 }), null);
  // A chord whose third route fails stops the two pitches already started.
  const partial = fakeAudio();
  const route = partial.engine.route;
  partial.engine.route = (...args) => partial.routes.length < 2 ? route(...args) : null;
  assert.equal(playInstrumentNote(partial.engine, { instrument: 'trumpet', degree: 0, chord: true }), null);
  assert.ok(partial.routes.every(item => item.disposals === 1));
  assert.ok(partial.sources().every(source => source.stops.length === 2));
});

test('a graph that fails midway disconnects what it built and disposes its route', () => {
  for (const id of INSTRUMENT_IDS) {
    for (const at of [2, 3]) {
      const fake = fakeAudio({ throwOn: (kind, made) => made === at });
      assert.equal(playInstrumentNote(fake.engine, { instrument: id, degree: 0 }), null);
      assert.equal(fake.routes[0].disposals, 1, id);
      assert.ok(fake.nodes.every(node => node.disconnects === 1), id);
      assert.deepEqual(soundingVoices(fake.engine), []);
    }
  }
  // A source that refuses to stop is still cleaned up.
  const fake = fakeAudio({ throwOn: kind => kind === 'filter' });
  fake.context.createOscillator = () => {
    const node = { kind: 'oscillator', connections: [], disconnects: 0,
      frequency: { setValueAtTime() {} }, detune: { setValueAtTime() {} },
      connect() {}, disconnect() { this.disconnects++; throw new Error('closed'); },
      start() {}, stop() { throw new Error('not started'); } };
    fake.nodes.push(node);
    return node;
  };
  assert.equal(playInstrumentNote(fake.engine, { instrument: 'trumpet', degree: 0 }), null);
});

test('above the Nyquist guard the kalimba drops its partial and nothing runs past 0.45 of the rate', () => {
  const fake = fakeAudio({ sampleRate: 16000 });
  playInstrumentNote(fake.engine, { instrument: 'kalimba', degree: 7, octave: 1 });
  const oscillators = fake.nodes.filter(node => node.kind === 'oscillator');
  assert.equal(oscillators.length, 1, 'C7 x 5.95 is past the guard');
  for (const id of INSTRUMENT_IDS) {
    const probe = fakeAudio({ sampleRate: 16000 });
    playInstrumentNote(probe.engine, { instrument: id, degree: 7, octave: 1, chord: true });
    for (const node of probe.nodes) {
      for (const param of [node.frequency].filter(Boolean)) {
        for (const call of param.calls) assert.ok(call.args[0] <= 16000 * 0.45 + 1e-9, id);
        assert.ok(param.value <= 16000 * 0.45 + 1e-9, id);
      }
    }
  }
});

test('the string renderer is deterministic, in tune and rings out', () => {
  const lute = STRING_RECIPES.pluck;
  assert.deepEqual(renderString(STRING_RATE, hz(60), lute, 1, 7), renderString(STRING_RATE, hz(60), lute, 1, 7));
  assert.notDeepEqual(renderString(STRING_RATE, hz(60), lute, 1, 7), renderString(STRING_RATE, hz(60), lute, 1, 8));
  assert.ok(renderString(STRING_RATE, hz(60), lute, 0.5).length === STRING_RATE / 2, 'a default seed');
  for (const [recipe, midi] of [[lute, 60], [lute, 79], [STRING_RECIPES.harp, 91], [STRING_RECIPES.hammered, 64]]) {
    const samples = renderString(STRING_RATE, hz(midi), recipe, recipe.decay, 3);
    assert.ok(Math.abs(cents(pitchOf(samples, STRING_RATE, hz(midi)), hz(midi))) < 5, `MIDI ${midi} is in tune`);
    const peak = samples.reduce((top, value) => Math.max(top, Math.abs(value)), 0);
    assert.ok(Math.abs(peak - 1) < 1e-6, 'normalised');
    const tail = samples.length - Math.round(STRING_RATE * 0.03);
    assert.ok(db(rms(samples, tail - Math.round(STRING_RATE * 0.05), tail)) < -50, `MIDI ${midi} decays`);
    assert.equal(Math.abs(samples.at(-1)), 0, 'the end fades to silence');
  }
});

test('the harp rings longer and brighter than the lute, and the dulcimer beats', () => {
  const rate = STRING_RATE;
  const window = Math.round(rate * 0.02);
  const envelope = samples => {
    const out = [];
    for (let at = 0; at + window <= samples.length; at += window) out.push(db(rms(samples, at, at + window)));
    return out;
  };
  const fall = samples => envelope(samples).findIndex(level => level < -40);
  const crossings = samples => {
    let count = 0;
    for (let index = 1; index < Math.round(rate * 0.1); index++) if (samples[index - 1] < 0 !== samples[index] < 0) count++;
    return count;
  };
  const lute = renderString(rate, hz(72), STRING_RECIPES.pluck, 2.5, 3);
  const harp = renderString(rate, hz(72), STRING_RECIPES.harp, 2.5, 3);
  assert.ok(fall(harp) > fall(lute), 'the harp takes longer to fall 40 dB');
  assert.ok(crossings(harp) > crossings(lute), 'the harp is brighter');
  // Three strings a few cents apart: the level dips and swells again.
  const levels = [];
  const dulcimer = renderString(rate, hz(60), STRING_RECIPES.hammered, 2.3, 3);
  for (let at = 0; at + rate * 0.1 <= dulcimer.length; at += rate * 0.1) levels.push(db(rms(dulcimer, at, at + rate * 0.1)));
  assert.ok(levels.some((level, index) => index > 1 && levels[index + 1] > level + 0.5), 'the dulcimer beats');
});

test('string buffers are cached per context, least recently used dropped first', () => {
  const fake = fakeAudio({ sampleRate: 44100 });
  const lute = INSTRUMENTS.lute;
  const first = stringBuffer(fake.context, lute, 60);
  assert.equal(stringBuffer(fake.context, lute, 60), first);
  assert.equal(first.sampleRate, STRING_RATE);
  assert.equal(first.length, Math.round(STRING_RATE * lute.length));
  const other = fakeAudio({ sampleRate: 22050 });
  const second = stringBuffer(other.context, lute, 60);
  assert.notEqual(second, first, 'a new context renders its own');
  assert.equal(second.sampleRate, 22050, 'slow contexts render at their own rate');
  // Fill the cache past its size, touching the first pitch every time.
  for (let midi = 70; midi < 70 + MAX_STRING_BUFFERS; midi++) {
    stringBuffer(fake.context, lute, midi);
    assert.equal(stringBuffer(fake.context, lute, 60), first, 'recently used buffers stay');
  }
  const count = fake.buffers.length;
  stringBuffer(fake.context, lute, 70 + MAX_STRING_BUFFERS - 1);
  assert.equal(fake.buffers.length, count, 'a cached pitch is not rendered again');
  stringBuffer(fake.context, lute, 70);
  assert.equal(fake.buffers.length, count + 1, 'the oldest was dropped and is rendered again');
});

test('preparing an instrument renders its pitches a few at a time between frames', async (t) => {
  const slices = [];
  t.mock.method(globalThis, 'setTimeout', callback => slices.push(callback));
  const fake = fakeAudio();
  const ready = prepareInstrument(fake.engine, 'dulcimer');
  assert.equal(fake.buffers.length, 0, 'nothing renders in the calling frame');
  slices.shift()();
  assert.equal(fake.buffers.length, 4);
  slices.shift()();
  slices.shift()();
  assert.equal(fake.buffers.length, 12, 'every octave-0 pitch of every chord');
  assert.equal(slices.length, 0);
  assert.equal(await ready, true);
  const renders = fake.buffers.length;
  playInstrumentNote(fake.engine, { instrument: 'dulcimer', degree: 6, chord: true });
  assert.equal(fake.buffers.length, renders, 'the chord plays from the cache');
  assert.equal(await prepareInstrument(fake.engine, 'flute'), false, 'live voices need nothing');
  assert.equal(await prepareInstrument(fake.engine, 'harp'), false);
  assert.equal(await prepareInstrument({ context: null }, 'lute'), false);
  const broken = fakeAudio();
  broken.context.createBuffer = () => { throw new Error('No memory'); };
  const failed = prepareStrings(broken.context, INSTRUMENTS.lute, [60, 62]);
  slices.shift()();
  assert.equal(await failed, false);
});

test('at most 24 pitches sound, fading ones included, under 20 chords a second', () => {
  const fake = fakeAudio({ currentTime: 0 });
  const voices = [];
  const ids = ['accordion', 'lute', 'celticHarp', 'vielle'];
  for (let index = 0; index < 60; index++) {
    fake.context.currentTime = index * 0.05;
    const handle = playInstrumentNote(fake.engine, { instrument: ids[index % 4], degree: index % 8, chord: true });
    assert.ok(handle, 'every chord plays');
    assert.ok(handle.voices[0].start - fake.context.currentTime <= STEAL_RELEASE + 1e-9, 'within the steal release');
    voices.push(...handle.voices);
    assert.ok(soundingVoices(fake.engine).length <= MAX_VOICES + 3);
  }
  for (let time = 0; time < 6; time += 0.001) {
    const audible = voices.filter(voice => voice.start <= time && time < voice.end).length;
    assert.ok(audible <= MAX_VOICES, `${audible} voices at ${time.toFixed(3)} s`);
  }
  // A stolen voice fades over the release, then stops.
  const stolen = voices.find(voice => voice.fading);
  assert.ok(stolen);
  assert.ok(stolen.end - stolen.start < 3);
});

test('a burst of single notes fades the oldest sounding ones and starts the newest within 40 ms', () => {
  const fake = fakeAudio({ currentTime: 5 });
  const handles = [];
  for (let index = 0; index < 24; index++) handles.push(playInstrumentNote(fake.engine, { instrument: 'trumpet', degree: index % 8 }));
  // The first 24 have started when six more arrive.
  fake.context.currentTime = 5.1;
  for (let index = 0; index < 6; index++) handles.push(playInstrumentNote(fake.engine, { instrument: 'trumpet', degree: index }));
  assert.ok(handles.every(Boolean));
  const voices = handles.flatMap(handle => handle.voices);
  assert.equal(voices.filter(voice => voice.fading).length, 6, 'the six oldest are stolen');
  assert.ok(voices.slice(0, 6).every(voice => voice.fading && !voice.ended));
  assert.ok(voices.slice(24).every(voice => voice.start === 5.1 + STEAL_RELEASE), 'the newest wait for the fade');
  const envelopes = fake.nodes.filter(node => node.kind === 'gain' && node.connections.some(target => target.kind === 'route'));
  for (const envelope of envelopes.slice(0, 6)) {
    assert.ok(envelope.gain.calls.some(call => call.method === 'cancelAndHoldAtTime' && call.args[0] === 5.1));
    assert.ok(envelope.gain.calls.some(call => call.method === 'linearRampToValueAtTime'
      && call.args[0] === 0 && call.args[1] === 5.1 + STEAL_RELEASE));
  }
  const stops = fake.sources().filter(source => source.stops.length === 2);
  assert.ok(stops.length >= 6 && stops.every(source => source.stops[1] <= 5.1 + 0.05), 'stolen sources stop');
  // Ten chords at once also fit.
  const chords = fakeAudio();
  for (let index = 0; index < 10; index++) playInstrumentNote(chords.engine, { instrument: 'lute', degree: index % 8, chord: true });
  assert.equal(soundingVoices(chords.engine).filter(voice => !voice.fading).length, 24);
});

test('notes that have not started yet are cancelled outright, not faded', () => {
  const fake = fakeAudio({ currentTime: 5 });
  const handles = [];
  for (let index = 0; index < 30; index++) handles.push(playInstrumentNote(fake.engine, { instrument: 'trumpet', degree: index % 8 }));
  const voices = handles.flatMap(handle => handle.voices);
  assert.ok(voices.slice(0, 6).every(voice => voice.ended && !voice.fading && voice.end === voice.start),
    'the six oldest never sounded and are gone');
  assert.ok(voices.slice(6).every(voice => !voice.ended && voice.start === 5 + START_LEAD), 'nobody waits');
  assert.equal(soundingVoices(fake.engine).length, MAX_VOICES);
  const envelopes = fake.nodes.filter(node => node.kind === 'gain' && node.connections.some(target => target.kind === 'route'));
  assert.ok(envelopes.every(envelope => !envelope.gain.calls.some(call => call.method === 'cancelAndHoldAtTime')),
    'no fade is scheduled');
  assert.ok(fake.routes.slice(0, 6).every(route => route.disposals === 1), 'their routes are released');
});

test('a burst of 17 chords waits at most one 40 ms release, even over sounding chords', () => {
  for (const sounding of [0, 8]) {
    const fake = fakeAudio({ currentTime: 0 });
    const voices = [];
    for (let index = 0; index < sounding; index++) {
      voices.push(...playInstrumentNote(fake.engine, { instrument: 'lute', degree: index % 8, chord: true }).voices);
    }
    fake.context.currentTime = 1;
    let latest = 0;
    for (let index = 0; index < 17; index++) {
      const handle = playInstrumentNote(fake.engine, { instrument: 'dulcimer', degree: index % 8, chord: true });
      assert.ok(handle, 'every chord plays');
      latest = Math.max(latest, ...handle.voices.map(voice => voice.start));
      voices.push(...handle.voices);
    }
    assert.ok(latest - 1 <= STEAL_RELEASE + 1e-9, `the last chord starts ${(latest - 1) * 1000} ms late`);
    assert.equal(latest, sounding ? 1 + STEAL_RELEASE : 1 + START_LEAD);
    for (let time = 0; time < 4; time += 0.001) {
      const audible = voices.filter(voice => voice.start <= time && time < voice.end).length;
      assert.ok(audible <= MAX_VOICES, `${audible} voices at ${time.toFixed(3)} s`);
    }
  }
});

test('a cold chord renders before its start time: one shared start, no envelope point in the past', () => {
  for (const id of ['lute', 'celticHarp', 'dulcimer', 'vielle']) {
    const fake = fakeAudio();
    // Rendering is slow here: each new buffer takes 5 ms of audio clock,
    // longer than a string's 2 ms attack. The fake asserts every start and
    // automation point is at or after the clock when it is scheduled.
    const create = fake.context.createBuffer;
    fake.context.createBuffer = (...args) => {
      fake.context.currentTime += 0.005;
      return create(...args);
    };
    const handle = playInstrumentNote(fake.engine, { instrument: id, degree: 3, chord: true });
    assert.ok(handle, id);
    assert.ok(fake.buffers.length >= 1, `${id} rendered something`);
    const starts = new Set(fake.sources().flatMap(source => source.starts));
    assert.equal(starts.size, 1, `${id} chord pitches share one start`);
    const [start] = starts;
    assert.ok(handle.voices.every(voice => voice.start === start));
    assert.ok(Math.abs(start - (fake.context.currentTime + START_LEAD)) < 1e-9,
      `${id} starts just ahead of the clock read after rendering`);
  }
  // A render that fails plays nothing and builds nothing.
  const broken = fakeAudio();
  broken.context.createBuffer = () => { throw new Error('No memory'); };
  assert.equal(playInstrumentNote(broken.engine, { instrument: 'lute', degree: 0 }), null);
  assert.equal(broken.nodes.length, 0);
  assert.equal(broken.routes.length, 0);
});

test('fading works without cancelAndHold, is idempotent and survives a closed context', () => {
  const fake = fakeAudio();
  const handle = playInstrumentNote(fake.engine, { instrument: 'flute', degree: 0 });
  const envelope = fake.nodes.find(node => node.connections.some(target => target.kind === 'route'));
  delete envelope.gain.cancelAndHoldAtTime;
  envelope.gain.value = 0.05;
  fake.context.currentTime = 10.5;
  handle.fade();
  handle.fade();
  assert.deepEqual(envelope.gain.calls.slice(-3).map(call => call.method),
    ['cancelScheduledValues', 'setValueAtTime', 'linearRampToValueAtTime']);
  assert.equal(handle.voices[0].end, 10.5 + STEAL_RELEASE);
  // A note not yet started fades from its start.
  const later = fakeAudio();
  const queued = playInstrumentNote(later.engine, { instrument: 'lute', degree: 0 });
  queued.voices[0].start = 10.5;
  queued.fade(0.1);
  assert.equal(queued.voices[0].end, 10.6);
  // If the envelope can't be automated, the note simply stops.
  const broken = fakeAudio();
  const note = playInstrumentNote(broken.engine, { instrument: 'lute', degree: 0 });
  broken.nodes.find(node => node.connections.some(target => target.kind === 'route')).gain.cancelAndHoldAtTime = () => {
    throw new Error('closed');
  };
  note.fade();
  assert.equal(note.ended, true);
  note.fade();
  // An engine whose context went away fades from time zero.
  const gone = fakeAudio();
  const orphan = playInstrumentNote(gone.engine, { instrument: 'kalimba', degree: 0 });
  gone.context.currentTime = 0;
  gone.engine.context = null;
  orphan.fade();
  assert.equal(soundingVoices(gone.engine).length, 1);
});

test('bagpipe notes over other bagpipe notes bring less drone', () => {
  const fake = fakeAudio();
  playInstrumentNote(fake.engine, { instrument: 'bagpipe', degree: 0 });
  playInstrumentNote(fake.engine, { instrument: 'bagpipe', degree: 2 });
  const drones = fake.nodes.filter(node => node.kind === 'gain' && node.gain.value > 0 && node.gain.value < 0.2);
  assert.deepEqual(drones.map(node => node.gain.value), [0.12, 0.06]);
  const direct = fakeAudio();
  const built = buildVoice(direct.context, {}, INSTRUMENTS.bagpipe, 60, 10);
  assert.ok(built.sources.length === 2 && built.envelope);
});

test('the game plays instrument notes as effects, so pausing stops them', async () => {
  const { GameAudio } = await import('../src/audio/audio.js');
  const fake = fakeAudio();
  const audio = new GameAudio({}, fake.engine);
  const handles = audio.play({ type: 'instrument', instrument: 'lute', degree: 4, chord: true, x: 1, y: 2 });
  assert.equal(handles.length, 1);
  assert.equal(handles[0].voices.length, 3);
  assert.ok(audio.effects.has(handles[0]));
  assert.deepEqual(audio.play({ type: 'instrument', instrument: 'harp', degree: 0 }), [], 'an invalid note is silent');
  audio.pause();
  assert.equal(handles[0].ended, true);
  assert.equal(audio.effects.size, 0);
  fake.context.state = 'suspended';
  assert.equal(audio.play({ type: 'instrument', instrument: 'lute', degree: 0 }), undefined, 'nothing plays while locked');
});

test('every game sound event reaches its voice, and teardown disposes the engine', async () => {
  const { GameAudio } = await import('../src/audio/audio.js');
  const fake = fakeAudio();
  let disposed = 0;
  fake.engine.dispose = async () => { disposed++; };
  fake.engine.setListener = () => {};
  const audio = new GameAudio({ typeAt: () => 0 }, fake.engine);
  let stirred = 0;
  audio.fires.react = () => { stirred++; return []; };
  assert.deepEqual(audio.play({ type: 'fire-stir', x: 1, y: 1 }), []);
  assert.equal(stirred, 1);
  for (const type of ['pickup', 'bone-hit', 'bone-collapse', 'bone-rise', 'goblin-spot', 'goblin-hit',
    'goblin-death', 'troll-roar', 'troll-hit', 'troll-death', 'elf-spot', 'elf-hit', 'elf-death', 'elf-shoot',
    'draw', 'sheathe', 'swing']) {
    assert.ok(Array.isArray(audio.play({ type, x: 2, y: 3 })), type);
  }
  // Spell voices beyond 96 retire the oldest.
  const stopped = [];
  for (let index = 0; index < 97; index++) {
    audio.spellEffects.set({ ended: false, stop: () => stopped.push(index) }, 'caster');
  }
  audio.play({ type: 'spell', presentation: { sounds: {} }, stage: 'cast' });
  assert.equal(audio.spellEffects.size, 96);
  assert.deepEqual(stopped, [0]);
  await audio.dispose();
  assert.equal(disposed, 1);
});

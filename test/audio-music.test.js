import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Music } from '../src/audio/music.js';
import { SONGS, SONG_PAIRS, midiToFrequency } from '../src/audio/songs.js';

function fakeEngine(currentTime = 12) {
  const nodes = [];
  const routes = [];
  const buffers = [];
  const context = { state: 'running', currentTime, sampleRate: 48000 };
  function param() {
    const calls = [];
    const result = { value: 0, calls };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime',
      'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelAndHoldAtTime']) {
      result[method] = (...args) => {
        assert.ok(args.every(Number.isFinite), `${method} uses finite parameters`);
        const at = method === 'cancelAndHoldAtTime' ? args[0] : args[1];
        assert.ok(at >= context.currentTime, `${method} does not schedule in the past`);
        calls.push({ method, args });
      };
    }
    return result;
  }
  function node(kind) {
    const result = {
      kind, connections: [], starts: [], stops: [], disconnects: 0, ended: false,
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at) {
        assert.ok(Number.isFinite(at) && at >= context.currentTime);
        this.starts.push(at);
      },
      stop(at) {
        if (at !== undefined) assert.ok(Number.isFinite(at) && at >= context.currentTime);
        this.stops.push(at);
      },
    };
    nodes.push(result);
    return result;
  }
  context.createGain = () => Object.assign(node('gain'), { gain: param() });
  context.createOscillator = () => Object.assign(node('oscillator'), {
    frequency: param(), detune: param(),
  });
  context.createBufferSource = () => node('bufferSource');
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: param(), Q: param() });
  context.createConvolver = () => node('convolver');
  context.createBuffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate,
      getChannelData: channel => data[channel] };
    buffers.push(buffer);
    return buffer;
  };
  const engine = {
    context,
    route(bus) {
      const route = { bus, input: { gain: param() }, disposals: 0, dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    },
  };
  function advance(time) {
    context.currentTime = time;
    for (const source of nodes.filter(item => ['oscillator', 'bufferSource'].includes(item.kind))) {
      if (!source.ended && source.stops.some(at => at !== undefined && at <= time)) {
        source.ended = true;
        source.onended();
      }
    }
  }
  return { engine, context, nodes, routes, buffers, advance,
    sources: () => nodes.filter(item => ['oscillator', 'bufferSource'].includes(item.kind)) };
}

const target = gain => gain.calls.findLast(call => call.method === 'setTargetAtTime').args[0];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${actual} is approximately ${expected}`);
const pitchClasses = { A: 9, B: 11, C: 0, D: 2, E: 4, F: 5, G: 7 };
const modes = {
  Aeolian: [0, 2, 3, 5, 7, 8, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};

test('six original scores contain playable ordered notes across sixteen complete bars', () => {
  assert.deepEqual(Object.keys(SONGS), ['day', 'night']);
  assert.notEqual(SONGS.day.title, SONGS.night.title);
  assert.notDeepEqual(SONGS.day.events, SONGS.night.events);
  assert.equal(SONG_PAIRS.length, 3);
  assert.ok(Object.isFrozen(SONG_PAIRS));
  assert.equal(SONG_PAIRS[0].day, SONGS.day);
  assert.equal(SONG_PAIRS[0].night, SONGS.night);
  const songs = SONG_PAIRS.flatMap(pair => [pair.day, pair.night]);
  assert.equal(new Set(songs.map(song => song.title)).size, 6);
  assert.equal(new Set(songs.map(song => JSON.stringify(song.events))).size, 6);
  for (const pair of SONG_PAIRS) {
    assert.equal(pair.day.bpm, pair.night.bpm, 'overlapping scores share a tempo');
    assert.equal(pair.day.key, pair.night.key, 'overlapping scores share a tonal mode');
    assert.equal(pair.day.duration, pair.night.duration, 'paired loops stay aligned');
    assert.ok(pair.day.bpm >= 40 && pair.day.bpm <= 65, 'the soundtrack uses a slow pulse');
  }
  close(midiToFrequency(69), 440);
  close(midiToFrequency(81), 880);
  for (const song of songs) {
    assert.ok(Object.isFrozen(song) && Object.isFrozen(song.events));
    assert.equal(song.bars, 16);
    assert.equal(song.beats, song.bars * 4);
    close(song.duration, song.beats * 60 / song.bpm);
    assert.ok(song.duration >= 30 && song.duration <= 120);
    const [tonic, mode] = [song.key.slice(0, 1), song.key.slice(2)];
    assert.ok(modes[mode], 'score declares one of the soundtrack minor modes');
    const allowedNotes = new Set(modes[mode].map(interval => (pitchClasses[tonic] + interval) % 12));
    const bars = new Set();
    let previousBeat = -1;
    for (const event of song.events) {
      assert.ok(Object.isFrozen(event));
      assert.ok(Number.isInteger(event.note) && event.note >= 24 && event.note <= 96);
      assert.ok(allowedNotes.has(event.note % 12), `${song.key}: note ${event.note} stays in its declared mode`);
      assert.ok(midiToFrequency(event.note) >= 20 && midiToFrequency(event.note) <= 20000);
      assert.ok(event.beat >= previousBeat && event.beat >= 0 && event.beat < song.beats);
      assert.ok(event.beats > 0 && event.beat + event.beats <= song.beats);
      assert.ok(event.length > 0 && event.length <= 1);
      assert.ok(event.gain > 0 && event.gain < 0.1);
      assert.ok(Number.isFinite(event.attack) && event.attack > 0);
      assert.equal(typeof event.voice, 'string');
      assert.ok(Number.isFinite(event.release) && event.release > 0);
      assert.ok(Number.isFinite(event.decay) && event.decay > 0);
      assert.ok(Number.isFinite(event.sustain) && event.sustain >= 0 && event.sustain <= 1);
      assert.ok(Number.isFinite(event.cutoff) && event.cutoff >= 20 && event.cutoff <= 20000);
      for (const field of ['detune', 'spread', 'ratio']) {
        if (event[field] !== undefined) assert.ok(Number.isFinite(event[field]));
      }
      assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(event.type));
      bars.add(Math.floor(event.beat / 4));
      previousBeat = event.beat;
    }
    assert.equal(bars.size, song.bars);
  }
});

test('music waits for running audio and does not allocate when the bus is unavailable', () => {
  for (const context of [null, undefined, { state: 'suspended' }, { state: 'closed' }]) {
    const music = new Music({ context, route() { assert.fail('locked audio allocated a route'); } });
    music.update();
    music.dispose();
    assert.equal(music.tracks.length, 0);
  }
  const fake = fakeEngine();
  fake.engine.route = () => null;
  const music = new Music(fake.engine);
  assert.doesNotThrow(() => music.update());
  assert.equal(fake.nodes.length, 0);
  assert.equal(music.context, null);
});

test('music starts on the absolute audio clock and fills only the lookahead window', () => {
  const fake = fakeEngine(123.5);
  const music = new Music(fake.engine);
  music.update();
  assert.equal(fake.routes.length, 1);
  assert.equal(fake.routes[0].bus, 'music');
  assert.equal(music.tracks.length, 2);
  const initial = fake.sources();
  assert.ok(initial.length > 0 && initial.length <= 48);
  for (const source of initial) close(source.starts[0], 123.54);
  const count = initial.length;
  music.update();
  assert.equal(fake.sources().length, count, 'repeated frame does not replay scheduled notes');

  // Exercise a complete loop at ordinary frame intervals, including its boundary.
  const end = 123.54 + SONGS.day.duration + 0.4;
  for (let now = 123.55; now <= end; now += 0.05) {
    fake.advance(now);
    const before = fake.sources().length;
    music.update();
    const added = fake.sources().slice(before);
    assert.ok(added.length <= 48);
    for (const source of added) {
      assert.ok(source.starts[0] >= now && source.starts[0] <= now + 0.2 + 1e-9);
    }
    assert.ok(music.voices.size <= 48, 'completed voices leave the scheduler set');
  }
  assert.ok(fake.sources().some(source => source.starts[0] >= 123.54 + SONGS.day.duration));
  music.dispose();
});

test('late frames skip missed score events instead of creating a backlog', () => {
  const fake = fakeEngine(0);
  const music = new Music(fake.engine);
  music.update({ night: 0.5 });
  const initial = fake.sources();
  fake.advance(2);
  const stillPlaying = initial.filter(source => !source.ended);
  assert.ok(stillPlaying.length > 0);
  let before = fake.sources().length;
  music.update({ night: 0.5 });
  assert.ok(stillPlaying.every(source => source.stops.includes(undefined)));
  assert.ok(fake.sources().length - before <= 48);
  fake.advance(10000);
  before = fake.sources().length;
  music.update({ night: 0.5 });
  const newSources = fake.sources().slice(before);
  assert.ok(newSources.length <= 48);
  assert.ok(newSources.every(source => source.starts[0] >= 10000 && source.starts[0] <= 10000.2));
  assert.ok(music.tracks.every(track => track.loop > 100));
  music.dispose();
});

test('day/night transition uses smooth equal-power gains and clamps invalid blends', () => {
  const fake = fakeEngine();
  const music = new Music(fake.engine);
  music.update({ night: 0 });
  const [day, night] = music.tracks;
  close(target(day.gain.gain), 1);
  close(target(night.gain.gain), 0);
  for (const blend of [0.25, 0.5, 0.75]) {
    music.update({ night: blend });
    const a = target(day.gain.gain);
    const b = target(night.gain.gain);
    close(a, Math.cos(blend * Math.PI / 2));
    close(b, Math.sin(blend * Math.PI / 2));
    close(a * a + b * b, 1);
    assert.ok(day.gain.gain.calls.at(-1).args[2] > 0, 'gain change has a smoothing interval');
  }
  for (const [blend, expected] of [[1, 1], [100, 1], [-100, 0], [NaN, 0], [Infinity, 0]]) {
    music.update({ night: blend });
    close(target(day.gain.gain), expected ? 0 : 1);
    close(target(night.gain.gain), expected ? 1 : 0);
  }
  music.dispose();
});

test('suspension stops voices and releases the route; resumption starts a fresh phrase', () => {
  const fake = fakeEngine();
  const music = new Music(fake.engine);
  music.update({ night: 1 });
  const sources = fake.sources();
  const tracks = music.tracks.map(track => track.gain);
  fake.context.state = 'suspended';
  music.update();
  assert.equal(fake.routes[0].disposals, 1);
  assert.ok(sources.every(source => source.stops.includes(undefined) && source.disconnects === 1));
  assert.ok(tracks.every(gain => gain.disconnects === 1));
  assert.equal(music.voices.size, 0);
  assert.equal(music.tracks.length, 0);
  fake.context.state = 'running';
  fake.advance(45);
  const before = fake.sources().length;
  music.update({ night: 1 });
  assert.equal(fake.routes.length, 2);
  assert.ok(fake.sources().length > before);
  assert.ok(fake.sources().slice(before).every(source => source.starts[0] === 45.04));
  music.dispose();
});

test('context replacement and repeated disposal release each graph exactly once', () => {
  const first = fakeEngine();
  const second = fakeEngine(80);
  const music = new Music(first.engine);
  music.update();
  const firstSources = first.sources();
  const firstTracks = music.tracks.map(track => track.gain);
  first.engine.context = second.context;
  first.engine.route = second.engine.route;
  music.update({ night: 1 });
  assert.equal(first.routes[0].disposals, 1);
  assert.ok(firstSources.every(source => source.disconnects === 1));
  assert.ok(firstTracks.every(gain => gain.disconnects === 1));
  assert.ok(second.sources().length > 0);
  music.dispose();
  const nodeCount = second.nodes.length;
  music.dispose();
  music.update();
  for (const source of second.sources()) source.onended();
  assert.equal(second.nodes.length, nodeCount);
  assert.equal(second.routes[0].disposals, 1);
  assert.ok(second.nodes.every(node => node.disconnects === 1));
});

test('partially failed music setup cleans up and can retry on the next frame', () => {
  const fake = fakeEngine();
  const createGain = fake.context.createGain;
  let allocations = 0;
  fake.context.createGain = () => {
    if (++allocations === 2) throw new Error('audio device changed');
    return createGain();
  };
  const music = new Music(fake.engine);
  assert.doesNotThrow(() => music.update());
  assert.equal(fake.routes[0].disposals, 1);
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
  assert.equal(music.context, null);
  fake.context.createGain = createGain;
  music.update();
  assert.ok(fake.sources().length > 0);
  music.dispose();
});

test('skipping locked music cycles all pairs without allocating audio and preserves the night title', () => {
  const fake = fakeEngine();
  fake.context.state = 'suspended';
  const music = new Music(fake.engine);
  assert.equal(music.songCount, 6);
  assert.equal(music.currentSong, SONG_PAIRS[0].day.title);
  music.update({ night: 1 });
  assert.equal(music.currentSong, SONG_PAIRS[0].night.title);
  for (let index = 1; index <= SONG_PAIRS.length; index++) {
    music.skip();
    assert.equal(music.currentSong, SONG_PAIRS[index % SONG_PAIRS.length].night.title);
  }
  assert.equal(fake.nodes.length, 0);
  assert.equal(fake.routes.length, 0);
  music.skip();
  fake.context.state = 'running';
  music.update({ night: 1 });
  assert.deepEqual(music.tracks.map(track => track.song),
    [SONG_PAIRS[1].day, SONG_PAIRS[1].night]);
  assert.ok(fake.sources().length > 0);
  music.update({ night: 0 });
  assert.equal(music.currentSong, SONG_PAIRS[1].day.title);
  music.dispose();
});

test('running skip fades old music out while the next pair starts and then retires its graph', () => {
  const fake = fakeEngine();
  const music = new Music(fake.engine);
  music.update({ night: 0.25 });
  const oldGains = music.tracks.map(track => track.gain);
  const oldSources = fake.sources();
  const oldRoute = fake.routes[0];
  music.skip();
  music.update({ night: 0.25 });
  assert.equal(music.currentSong, SONG_PAIRS[1].day.title);
  assert.deepEqual(music.tracks.map(track => track.song),
    [SONG_PAIRS[1].day, SONG_PAIRS[1].night]);
  assert.equal(oldRoute.disposals, 0, 'the old route survives the crossfade');
  assert.ok(oldSources.every(source => !source.stops.includes(undefined)),
    'the outgoing phrase is not abruptly stopped');
  const fadeOut = oldRoute.input.gain.calls.findLast(call =>
    call.method === 'linearRampToValueAtTime' && call.args[0] === 0);
  assert.ok(fadeOut, 'outgoing route gain fades to silence');
  assert.ok(fadeOut.args[1] > fake.context.currentTime);
  const incoming = fake.routes.at(-1);
  assert.ok(incoming.input.gain.calls.some(call =>
    call.method === 'setValueAtTime' && call.args[0] === 0), 'incoming song starts at silence');
  assert.ok(incoming.input.gain.calls.some(call =>
    call.method === 'linearRampToValueAtTime' && call.args[0] === 1 &&
    call.args[1] > fake.context.currentTime), 'incoming song fades in');
  const [day, night] = music.tracks;
  close(target(day.gain.gain), Math.cos(0.25 * Math.PI / 2));
  close(target(night.gain.gain), Math.sin(0.25 * Math.PI / 2));
  assert.ok(fake.sources().length > oldSources.length);
  fake.advance(12.5);
  music.update({ night: 0.25 });
  assert.equal(oldRoute.disposals, 1);
  assert.ok(oldGains.every(gain => gain.disconnects === 1));
  assert.ok(oldSources.every(source => source.disconnects === 1));
  music.dispose();
  assert.equal(oldRoute.disposals, 1, 'retired route is not disposed twice');
});

test('rapid repeated skips bound live graphs and dispose both active and retiring music', () => {
  const fake = fakeEngine();
  const music = new Music(fake.engine);
  music.update({ night: 0.5 });
  for (let index = 0; index < 20; index++) {
    music.skip();
    music.update({ night: 0.5 });
    const liveRoutes = fake.routes.filter(route => route.disposals === 0);
    assert.ok(liveRoutes.length <= 3, 'at most the active pair and two retiring pairs exist');
    const liveSources = fake.sources().filter(source => source.disconnects === 0);
    assert.ok(liveSources.length <= 3 * 48, 'rapid clicks cannot accumulate voices without bound');
  }
  assert.equal(music.currentSong, SONG_PAIRS[20 % SONG_PAIRS.length].night.title);
  music.dispose();
  assert.ok(fake.routes.every(route => route.disposals === 1));
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
  const count = fake.nodes.length;
  const title = music.currentSong;
  music.skip();
  music.update();
  music.dispose();
  assert.equal(music.currentSong, title);
  assert.equal(fake.nodes.length, count);
});

test('pause releases active and fading songs while retaining the selected pair for resume', () => {
  const fake = fakeEngine();
  const music = new Music(fake.engine);
  music.update();
  music.skip();
  music.update({ night: 1 });
  const title = music.currentSong;
  music.pause();
  assert.ok(fake.routes.every(route => route.disposals === 1));
  assert.ok(fake.nodes.every(node => node.disconnects === 1));
  assert.equal(music.currentSong, title);
  fake.advance(90);
  const before = fake.sources().length;
  music.update({ night: 1 });
  assert.equal(music.currentSong, SONG_PAIRS[1].night.title);
  assert.ok(fake.sources().slice(before).every(source => source.starts[0] === 90.04));
  music.dispose();
});

test('a temporarily unavailable bus during skip recovers on a later frame', () => {
  const fake = fakeEngine();
  const music = new Music(fake.engine);
  music.update();
  const route = fake.engine.route;
  fake.engine.route = () => null;
  assert.doesNotThrow(() => music.skip());
  assert.equal(music.currentSong, SONG_PAIRS[1].day.title);
  fake.engine.route = route;
  const before = fake.sources().length;
  music.update();
  assert.deepEqual(music.tracks.map(track => track.song),
    [SONG_PAIRS[1].day, SONG_PAIRS[1].night]);
  assert.ok(fake.sources().length > before, 'restored bus resumes the selected score');
  music.dispose();
  assert.ok(fake.routes.every(item => item.disposals === 1));
});

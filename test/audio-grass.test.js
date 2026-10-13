import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { GRASS_SAMPLE_URLS, GrassFootsteps, prepareGrassFootsteps, playGrassFootstep } from '../src/audio/grass-steps.js';
import { playFootstep } from '../src/audio/footsteps.js';

function fakeAudio(state = 'running') {
  const nodes = [];
  const routes = [];
  const decodes = [];
  const context = { state, currentTime: 10, sampleRate: 22050 };
  const parameter = () => ({ calls: [],
    setValueAtTime(value, at) { this.calls.push(['set', value, at]); },
    linearRampToValueAtTime(value, at) { this.calls.push(['ramp', value, at]); },
  });
  const node = kind => {
    const value = { kind, disconnects: 0, connections: [], starts: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at) { this.starts.push(at); },
      stop() { this.stops.push(context.currentTime); },
    };
    nodes.push(value);
    return value;
  };
  context.createBufferSource = () => Object.assign(node('source'), { playbackRate: parameter() });
  context.createGain = () => Object.assign(node('gain'), { gain: parameter() });
  context.createBiquadFilter = () => assert.fail('recorded grass must remain unfiltered');
  context.createBuffer = () => assert.fail('recorded grass must not generate noise');
  context.decodeAudioData = async bytes => {
    decodes.push(bytes);
    return { duration: 0.32, id: new Uint8Array(bytes)[0] };
  };
  const engine = { context, muted: false, volumes: { master: 0.7, sfx: 0.8 },
    route(bus, x, y) {
      const route = { bus, x, y, input: {}, disposals: 0,
        dispose() { this.disposals++; },
      };
      routes.push(route);
      return route;
    },
  };
  return { engine, context, nodes, routes, decodes };
}

function recordedLoader(calls = []) {
  return async (url, context) => {
    calls.push({ url, context });
    return { duration: 0.32, id: url.pathname.split('/').at(-1) };
  };
}

function assertClean(audio) {
  assert.ok(audio.nodes.every(node => node.disconnects === 1));
  assert.ok(audio.routes.every(route => route.disposals === 1));
}

test('six distinct dry grass recordings have compact tails, mono PCM headers and CC0 provenance', async () => {
  const hashes = new Set();
  let totalBytes = 0;
  for (const url of GRASS_SAMPLE_URLS) {
    const bytes = await readFile(url);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
    let format;
    let data;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4);
      const chunk = bytes.subarray(offset + 8, offset + 8 + size);
      const name = bytes.toString('ascii', offset, offset + 4);
      if (name === 'fmt ') format = chunk;
      if (name === 'data') data = chunk;
      offset += 8 + size + (size % 2);
    }
    assert.ok(format && data);
    assert.equal(format.readUInt16LE(0), 1, 'uncompressed PCM');
    assert.equal(format.readUInt16LE(2), 1, 'mono');
    assert.equal(format.readUInt32LE(4), 22050);
    assert.equal(format.readUInt16LE(14), 16);
    const duration = data.length / format.readUInt32LE(8);
    assert.ok(duration >= 0.14 && duration <= 0.2, `${url.pathname}: ${duration}`);
    let peak = 0;
    let energy = 0;
    let tailEnergy = 0;
    for (let offset = 0; offset + 2 <= data.length; offset += 2) {
      const value = data.readInt16LE(offset) / 32768;
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
      if (offset / 2 / 22050 >= 0.12) tailEnergy += value * value;
    }
    assert.ok(peak > 0.02 && peak < 1, 'audible recording without digital clipping');
    assert.ok(tailEnergy / energy < 0.03, 'weight ends before a prolonged brushing or squeezing tail');
    hashes.add(createHash('sha256').update(data).digest('hex'));
    totalBytes += bytes.length;
  }
  assert.equal(hashes.size, 6);
  assert.ok(totalBytes < 125000, 'small assets suitable for static hosting');
  const license = await readFile(new URL('../assets/audio/grass/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(license, /CC0 1\.0 Universal/);
  assert.match(license, /qubodup/);
  assert.match(license, /https:\/\/opengameart\.org\/content\/20-rustles-dry-leaves/);
  assert.match(license, /https:\/\/kenney\.nl\/assets\/impact-sounds/);
  assert.match(license, /footstep_carpet_000\.ogg/);
  assert.match(license, /rustle12\.flac/);
});

test('locked grass allocates no voices and performs no fetch or decode', async () => {
  for (const state of ['suspended', 'closed']) {
    const audio = fakeAudio(state);
    const calls = [];
    const player = new GrassFootsteps(audio.engine, { loadBuffer: recordedLoader(calls) });
    assert.equal(await player.prepare(), false);
    assert.deepEqual(player.play(), []);
    assert.deepEqual(playFootstep(audio.engine, 'grass'), []);
    assert.deepEqual(calls, []);
    assert.deepEqual(audio.nodes, []);
    assert.deepEqual(audio.decodes, []);
    assert.deepEqual(audio.routes, []);
  }
  assert.equal(await prepareGrassFootsteps(null), false);
  assert.deepEqual(playGrassFootstep(undefined), []);
});

test('concurrent preparation fetches and decodes each recording once', async () => {
  const audio = fakeAudio();
  const fetched = [];
  const fetcher = async url => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => Uint8Array.of(fetched.length).buffer };
  };
  const first = prepareGrassFootsteps(audio.engine, { fetcher });
  const second = prepareGrassFootsteps(audio.engine);
  assert.equal(first, second);
  assert.equal(await first, true);
  assert.equal(await prepareGrassFootsteps(audio.engine), true);
  assert.equal(fetched.length, 6);
  assert.equal(audio.decodes.length, 6);
  assert.deepEqual(fetched.map(url => url.href), GRASS_SAMPLE_URLS.map(url => url.href));
  assert.deepEqual(audio.nodes, []);
});

test('steps during loading are discarded, and grass has no synthetic fallback', async () => {
  const audio = fakeAudio();
  const releases = [];
  const pending = prepareGrassFootsteps(audio.engine, {
    loadBuffer: url => new Promise(resolve => releases.push(() => resolve({ duration: 0.32, id: url.href }))),
  });
  assert.deepEqual(playFootstep(audio.engine, 'grass', { x: 3, y: 4 }), []);
  assert.deepEqual(playGrassFootstep(audio.engine), []);
  await Promise.resolve();
  assert.equal(releases.length, 6);
  releases.forEach(release => release());
  assert.equal(await pending, true);
  assert.deepEqual(audio.nodes, [], 'load completion never replays old gait events');
  const handles = playFootstep(audio.engine, 'grass', { x: 3, y: 4 });
  assert.equal(handles.length, 1);
  assert.equal(audio.nodes.filter(node => node.kind === 'source').length, 1);
  handles[0].stop();
  assertClean(audio);
});

test('grass cycles six recorded variants without repeats, at original pitch through the sfx spatial route', async t => {
  t.mock.method(Math, 'random', () => 0.5);
  const audio = fakeAudio();
  await prepareGrassFootsteps(audio.engine, { loadBuffer: recordedLoader() });
  const variants = [];
  for (let step = 0; step < 13; step++) {
    const [handle] = playFootstep(audio.engine, 'grass', { strength: 1, x: 21, y: 40 });
    assert.ok(handle);
    const source = audio.nodes.at(-2);
    const gain = audio.nodes.at(-1);
    variants.push(source.buffer.id);
    assert.equal(source.loop, false);
    assert.deepEqual(source.starts, [audio.context.currentTime]);
    assert.deepEqual(source.playbackRate.calls, [['set', 1, audio.context.currentTime]]);
    assert.equal(gain.gain.calls.length, 4, 'only start and end fades color the recording');
    assert.equal(gain.gain.calls[1][1], gain.gain.calls[2][1], 'hold the original recorded envelope');
    assert.ok(gain.gain.calls[1][2] - audio.context.currentTime <= 0.004);
    assert.ok(gain.gain.calls.at(-1)[2] - gain.gain.calls.at(-2)[2] <= 0.009);
    assert.equal(gain.gain.calls.at(-1)[1], 0);
    assert.deepEqual(audio.routes.at(-1), {
      ...audio.routes.at(-1), bus: 'sfx', x: 21, y: 40,
    });
    handle.stop();
  }
  assert.equal(new Set(variants.slice(0, 6)).size, 6);
  assert.deepEqual(variants.slice(0, 6), variants.slice(6, 12));
  assert.ok(variants.every((name, index) => index === 0 || name !== variants[index - 1]));
  assertClean(audio);
});

test('strength and event volume scale grass within a quiet bounded gain', async t => {
  const audio = fakeAudio();
  const player = new GrassFootsteps(audio.engine, { loadBuffer: recordedLoader() });
  await player.prepare();
  const levels = [];
  for (const [strength, volume, random] of [[0.1, 1, 0], [1, 1, 0.5], [999, 999, 1], [1, 0.25, 0.5]]) {
    t.mock.method(Math, 'random', () => random);
    const [handle] = player.play({ strength, volume });
    const source = audio.nodes.at(-2);
    const gain = audio.nodes.at(-1);
    const rate = source.playbackRate.calls[0][1];
    assert.ok(rate >= 0.98 && rate <= 1.02);
    levels.push(gain.gain.calls[1][1]);
    assert.ok(gain.gain.calls.every(([, value, at]) => Number.isFinite(value) && Number.isFinite(at)
      && value >= 0 && value <= 0.12 && at >= audio.context.currentTime));
    handle.stop();
  }
  assert.ok(levels[0] < levels[1] && levels[1] <= levels[2] && levels[3] < levels[1]);
  assert.deepEqual(player.play({ strength: 0 }), []);
  assert.deepEqual(player.play({ strength: -1 }), []);
  assert.deepEqual(player.play({ volume: 0 }), []);
  const [fallback] = player.play({ strength: NaN, volume: NaN, x: Infinity, y: NaN });
  assert.equal(audio.routes.at(-1).x, undefined);
  assert.equal(audio.routes.at(-1).y, undefined);
  fallback.stop();
  assertClean(audio);
});

test('natural end and explicit stop release every resource once and mark effect handles ended', async () => {
  const audio = fakeAudio();
  const player = new GrassFootsteps(audio.engine, { loadBuffer: recordedLoader() });
  await player.prepare();
  const [natural] = player.play();
  const source = audio.nodes.at(-2);
  const ended = source.onended;
  assert.equal(natural.ended, false);
  ended();
  ended();
  natural.stop();
  assert.equal(natural.ended, true);
  assert.equal(source.stops.length, 0);
  const [stopped] = player.play();
  const second = audio.nodes.at(-2);
  const secondEnded = second.onended;
  stopped.stop();
  stopped.stop();
  secondEnded();
  assert.equal(stopped.ended, true);
  assert.equal(second.stops.length, 1);
  assert.equal(player.handles.size, 0);
  assertClean(audio);
});

test('mute, suspension and context replacement stop grass handles and never replay contacts', async () => {
  const audio = fakeAudio();
  const calls = [];
  const player = new GrassFootsteps(audio.engine, { loadBuffer: recordedLoader(calls) });
  await player.prepare();
  const [muted] = player.play();
  audio.engine.muted = true;
  assert.deepEqual(player.play(), []);
  assert.equal(muted.ended, true);
  audio.engine.muted = false;
  const [suspended] = player.play();
  audio.context.state = 'suspended';
  assert.equal(await player.prepare(), false);
  assert.equal(suspended.ended, true);
  audio.context.state = 'running';
  assert.equal(await player.prepare(), true);
  assert.equal(calls.length, 6, 'resume reuses decoded recordings');
  const [old] = player.play();
  const replacement = fakeAudio();
  audio.engine.context = replacement.context;
  assert.deepEqual(player.play(), []);
  assert.equal(old.ended, true);
  assert.equal(await player.prepare(), true);
  assert.equal(calls.length, 12, 'new context gets its own decoded buffers');
  assertClean(audio);
  for (const bus of ['master', 'sfx']) {
    audio.engine.volumes[bus] = 0;
    assert.deepEqual(player.play(), []);
    audio.engine.volumes[bus] = 1;
  }
});

test('HTTP and decode failures stay quiet, retry with cooldowns and reuse successful assets', async () => {
  const audio = fakeAudio();
  let failing = true;
  const fetched = [];
  const player = new GrassFootsteps(audio.engine, { fetcher: async url => {
    fetched.push(url);
    return { ok: !(failing && url.pathname.endsWith('grass-L1.wav')),
      arrayBuffer: async () => Uint8Array.of(1).buffer };
  } });
  assert.equal(await player.prepare(), false);
  assert.equal(fetched.length, 6);
  assert.deepEqual(player.play(), []);
  assert.equal(await player.prepare(), false);
  assert.equal(fetched.length, 6);
  audio.context.currentTime += 4.99;
  assert.equal(await player.prepare(), false);
  assert.equal(fetched.length, 6);
  audio.context.currentTime += 0.02;
  assert.equal(await player.prepare(), false);
  assert.equal(fetched.length, 7, 'only the failed recording is retried');
  failing = false;
  audio.context.currentTime += 9.99;
  assert.equal(await player.prepare(), false);
  audio.context.currentTime += 0.02;
  assert.equal(await player.prepare(), true);
  assert.equal(fetched.length, 8);
  assert.equal(audio.decodes.length, 6);
  assert.deepEqual(audio.nodes, []);
  const [handle] = player.play();
  handle.stop();
  assertClean(audio);

  const broken = fakeAudio();
  broken.context.decodeAudioData = async () => { throw new Error('bad WAV'); };
  const invalid = new GrassFootsteps(broken.engine, { fetcher: async () => ({
    ok: true, arrayBuffer: async () => new ArrayBuffer(1),
  }) });
  assert.equal(await invalid.prepare(), false);
  assert.deepEqual(invalid.play(), []);
  assert.deepEqual(broken.nodes, []);
});

test('stale load completion cannot replace a new context or trigger delayed playback', async () => {
  const audio = fakeAudio();
  const oldReleases = [];
  const player = new GrassFootsteps(audio.engine, { loadBuffer: async (url, context) => {
    if (context === audio.context) return new Promise(resolve => oldReleases.push(() => resolve({ duration: 0.3, id: 'old' })));
    return { duration: 0.3, id: 'new' };
  } });
  const oldLoad = player.prepare();
  await Promise.resolve();
  const replacement = fakeAudio();
  audio.engine.context = replacement.context;
  assert.equal(await player.prepare(), true);
  oldReleases.forEach(release => release());
  assert.equal(await oldLoad, false);
  assert.ok(player.buffers.every(buffer => buffer.id === 'new'));
  assert.deepEqual(audio.nodes, []);
  assert.deepEqual(replacement.nodes, []);
});

test('partial playback failures clean sources and spatial routes without interrupting gameplay', async () => {
  for (const failure of ['gain', 'start', 'route']) {
    const audio = fakeAudio();
    const player = new GrassFootsteps(audio.engine, { loadBuffer: recordedLoader() });
    await player.prepare();
    if (failure === 'gain') audio.context.createGain = () => { throw new Error('closed device'); };
    if (failure === 'start') {
      const createSource = audio.context.createBufferSource;
      audio.context.createBufferSource = () => Object.assign(createSource(), {
        start() { throw new Error('closed device'); },
      });
    }
    if (failure === 'route') audio.engine.route = () => null;
    assert.deepEqual(player.play(), []);
    assert.equal(player.handles.size, 0);
    assertClean(audio);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ambience } from '../src/audio/ambience.js';
import { EnvironmentSampler } from '../src/audio/environment.js';
import { KINDS, Monster } from '../src/entities/monsters.js';
import { Player } from '../src/entities/player.js';
import { family } from '../src/render/glyphs.js';
import { currentAt, immersion, screenOrientation, toCells, toGround } from '../src/world/rivers.js';
import { Splashes } from '../src/world/splashes.js';
import { animated, bedStone, FLOATING, shade } from '../src/world/terrain/water.js';
import { ASPECT, CHUNK_SIZE, MAX_WATER_DEPTH, WATER, WATER_LEVEL, World } from '../src/world/world.js';

const dt = 1 / 60;
const still = { x: 0, y: 0 };

// A broad, straight reach of some river near the origin; with `eastward`
// one that runs along the rows of the screen.
function reach(world, { eastward = false } = {}) {
  let best = null;
  for (let ry = -4; ry <= 4; ry++) {
    for (let rx = -4; rx <= 4; rx++) {
      const river = world.rivers.region(rx, ry);
      if (!river) continue;
      for (let i = 6; i < river.mouthFrom - 6; i++) {
        let bend = 0;
        for (let k = i - 5; k <= i + 5; k++) bend = Math.max(bend, Math.abs(river.curve[k]) * river.half[k] * 2);
        if (bend > 0.12 || (eastward && Math.abs(river.dir[2 * i]) < 0.97)) continue;
        if (!best || river.half[i] > best.river.half[best.i]) best = { river, i };
      }
    }
  }
  const { river, i } = best;
  return { river, i, x: river.points[2 * i] / ASPECT, y: river.points[2 * i + 1] };
}

// Shades a whole chunk's water at time t.
function shadeChunk(world, chunk, t) {
  const n = 64 * 64 * 4;
  const out = { fg: new Uint8ClampedArray(n), bg: new Uint8ClampedArray(n), ov: new Uint8ClampedArray(n) };
  for (let i = 0; i < 4096; i++) {
    if (chunk.type[i] === WATER) shade(out, i * 4, chunk, i, chunk.cx * 64 + (i & 63), chunk.cy * 64 + (i >> 6), world.seed ?? 1, t, 0);
  }
  return out;
}
const glyphOf = (out, i) => out.fg[i * 4 + 3] | ((out.bg[i * 4 + 3] & 15) << 8);
const layerOf = (out, i) => out.ov[i * 4 + 3] | ((out.bg[i * 4 + 3] >> 4) << 8);
const shown = (out, i) => layerOf(out, i) || glyphOf(out, i);

const STREAKS = [0, 1, 2, 3].map(o => new Set(family(`water.streak.${o}.`)));
const isStreak = (g) => STREAKS.some(s => s.has(g));

test('an idle player in a river drifts downstream, and an idle player on a lake does not', () => {
  const world = new World(1);
  world.propsIn = () => [];
  const { x, y } = reach(world);
  const p = new Player(x, y);
  for (let i = 0; i < 120; i++) p.update(dt, world, still, false);
  const flow = world.flowAt(p.x, p.y);
  const want = currentAt(world, p.x, p.y, immersion(world.waterDepthAt(p.x, p.y)), 1.2);
  const carried = Math.hypot(p.carry.x, p.carry.y);
  assert.ok(Math.abs(carried - Math.hypot(want.x, want.y)) / Math.hypot(want.x, want.y) < 0.15, `${carried}`);
  assert.ok((p.carry.x * flow.x + p.carry.y * flow.y) / carried > 0.99, 'carried along the current');
  const moved = toGround((p.x - x) * ASPECT, p.y - y);
  assert.ok(moved.x * flow.x + moved.y * flow.y > 0.3, 'it has drifted downstream');
  assert.ok(p.groundSpeed < 0.05 && p.walk < 0.05, 'drifting is not walking');

  const lake = new World(1);
  lake.propsIn = () => [];
  const q = new Player(0.5, 85.5);
  for (let i = 0; i < 120; i++) q.update(dt, lake, still, false);
  assert.deepEqual(q.carry, { x: 0, y: 0 });
  assert.equal(q.x, 0.5);
  assert.equal(q.y, 85.5);
});

test('wading upstream still makes headway, and the current never pushes into a blocked cell', () => {
  const world = new World(1);
  world.propsIn = () => [];
  const { x, y } = reach(world);
  const flow = world.flowAt(x, y);
  const p = new Player(x, y);
  for (let i = 0; i < 120; i++) p.update(dt, world, { x: -flow.x, y: -flow.y }, false);
  const moved = toGround((p.x - x) * ASPECT, p.y - y);
  assert.ok(moved.x * flow.x + moved.y * flow.y < -0.5, 'upstream against the current');

  // A rock just downstream stops the drift at its face.
  const ahead = toCells(flow.x * 0.25, flow.y * 0.25);
  const rock = { x: x + ahead.cols, y: y + ahead.rows, footW: 2, footH: 1 };
  const blocked = new World(1);
  blocked.propsIn = () => [rock];
  const q = new Player(x, y);
  for (let i = 0; i < 300; i++) {
    q.update(dt, blocked, still, false);
    assert.ok(blocked.isWalkable(q.x, q.y));
  }
  assert.ok(Math.hypot(q.carry.x, q.carry.y) > 0.1, 'still pressed on by the water');
});

test('a jump clears the feet of the water: no new push, and the drift carries on through the landing', () => {
  const world = new World(1);
  world.propsIn = () => [];
  const { x, y } = reach(world);
  // Leaping in from above the water gets no push while airborne.
  const fresh = new Player(x, y);
  fresh.air = 1;
  fresh.update(dt, world, still, false);
  assert.deepEqual(fresh.carry, { x: 0, y: 0 });
  // Already drifting, a hop keeps the drift and lands without a jolt.
  const p = new Player(x, y);
  for (let i = 0; i < 120; i++) p.update(dt, world, still, false);
  p.jump();
  let last = { ...p.carry };
  let flew = 0;
  for (let i = 0; i < 90; i++) {
    const airborne = p.air > 0;
    p.update(dt, world, still, false);
    if (airborne) {
      flew++;
      assert.deepEqual(p.carry, last, 'no push while airborne');
    }
    assert.ok(Math.hypot(p.carry.x - last.x, p.carry.y - last.y) < 0.02, 'no jolt');
    last = { ...p.carry };
  }
  assert.ok(flew > 5);
});

test('monsters wading in a river drift with it; dead and rising ones do not', () => {
  const world = new World(1);
  world.propsIn = () => [];
  const { x, y } = reach(world);
  const flow = world.flowAt(x, y);
  const idle = new Monster(x, y, { risen: true });
  const stunned = new Monster(x, y, { risen: true });
  stunned.magicStunned = true;
  const dead = new Monster(x, y, { risen: true });
  dead.state = 'dead';
  const rising = new Monster(x, y, { kind: KINDS.skeleton });
  assert.equal(rising.state, 'rise');
  const stunnedRising = new Monster(x, y, { kind: KINDS.skeleton });
  stunnedRising.magicStunned = true;
  for (let i = 0; i < 120; i++) {
    for (const m of [idle, stunned, dead, stunnedRising]) m.update(dt, world, null, [], () => 0.5);
    // Still climbing out of the ground for the first half second.
    if (i < 30) rising.update(dt, world, null, [], () => 0.5);
  }
  for (const m of [idle, stunned]) {
    const moved = toGround((m.x - x) * ASPECT, m.y - y);
    assert.ok(moved.x * flow.x + moved.y * flow.y > 0.2, 'carried downstream');
    assert.equal(m.groundSpeed, 0, 'drifting is not walking');
  }
  assert.deepEqual([dead.x, dead.y], [x, y]);
  assert.deepEqual([rising.x, rising.y], [x, y]);
  assert.equal(stunnedRising.state, 'rise');
  assert.deepEqual([stunnedRising.x, stunnedRising.y], [x, y], 'stunned while rising, it stays put');
  // Against a wall of rock it slides along or stays put, never through.
  const walled = new World(1);
  const ahead = toCells(flow.x * 0.2, flow.y * 0.2);
  walled.propsIn = () => [{ x: x + ahead.cols, y: y + ahead.rows, footW: 30, footH: 30 }];
  const m = new Monster(x, y, { risen: true });
  const start = walled.isWalkable(x, y);
  for (let i = 0; i < 120; i++) m.update(dt, walled, null, [], () => 0.5);
  if (start) assert.ok(walled.isWalkable(m.x, m.y));
  // Sliding along a face when only one axis is open.
  const slide = { isWalkable: (px) => px < x + 0.5, waterDepthAt: () => MAX_WATER_DEPTH,
    flowAt: (px, py, out = {}) => Object.assign(out, { x: 0.8, y: 0.6, speed: 0.5 }), typeAt: () => WATER };
  const a = new Monster(x - 3, y, { risen: true });
  for (let i = 0; i < 60; i++) a.update(dt, slide, null, [], () => 0.5);
  assert.ok(a.y > y && a.x < x + 0.5, 'slides down the face');
  const sideways = { ...slide, isWalkable: (px, py) => py < y + 0.2 };
  const b = new Monster(x, y, { risen: true });
  for (let i = 0; i < 60; i++) b.update(dt, sideways, null, [], () => 0.5);
  assert.ok(b.x > x && b.y < y + 0.2, 'slides along the face');
});

test('a splash in a river rides the current; one on a lake stays put', () => {
  const world = new World(1);
  const { x, y } = reach(world);
  const splashes = new Splashes();
  assert.equal(splashes.react(world, { type: 'land', x, y, strength: 1 }), true);
  const ring = splashes.rings[0];
  const drop = splashes.drops[0];
  const dropFrom = { x: drop.x + drop.vx * 0.1 * 0.9, y: drop.y };
  const flow = world.flowAt(x, y);
  splashes.update(0.1);
  const moved = toGround((ring.x - x) * ASPECT, ring.y - y);
  const speed = Math.hypot(moved.x, moved.y) / 0.1;
  assert.ok((moved.x * flow.x + moved.y * flow.y) / Math.hypot(moved.x, moved.y) > 0.99, 'downstream');
  assert.ok(Math.abs(speed - flow.speed) / flow.speed < 0.1, `at the water's speed (${speed} vs ${flow.speed})`);
  assert.ok(Number.isFinite(dropFrom.x));

  const lake = new World(1);
  const calm = new Splashes();
  calm.precipitate(lake, 0.5, 85.5, 1, 'rain', () => 0.5);
  const before = { x: calm.rings[0].x, y: calm.rings[0].y };
  calm.update(0.1);
  assert.deepEqual({ x: calm.rings[0].x, y: calm.rings[0].y }, before);
  // Without a world yet, nothing rides anything.
  const none = new Splashes();
  none.ring(3, 4, 1);
  none.update(0.1);
  assert.deepEqual([none.rings[0].x, none.rings[0].y], [3, 4]);
});

test('a splash, the foam and a drifting body all head downstream at the paces they should', () => {
  const world = new World(1);
  world.propsIn = () => [];
  const { x, y } = reach(world);
  const flow = world.flowAt(x, y);
  const step = toCells(flow.x * 0.3, flow.y * 0.3);
  const ahead = world.flowAt(x + step.cols, y + step.rows);
  // The foam is laid out by travel time, so it advances at the water's speed.
  const foam = 0.3 / (ahead.tau - flow.tau);
  assert.ok(Math.abs(foam - flow.speed) / flow.speed < 0.15, `foam ${foam} vs ${flow.speed}`);
  const splashes = new Splashes();
  splashes.world = world;
  splashes.ring(x, y, 1);
  splashes.update(0.2);
  const ring = toGround((splashes.rings[0].x - x) * ASPECT, splashes.rings[0].y - y);
  const p = new Player(x, y);
  for (let i = 0; i < 90; i++) p.update(dt, world, still, false);
  for (const v of [ring, p.carry]) {
    const l = Math.hypot(v.x, v.y);
    assert.ok((v.x * flow.x + v.y * flow.y) / l > 0.99);
  }
  assert.ok(Math.abs(Math.hypot(ring.x, ring.y) / 0.2 - flow.speed) / flow.speed < 0.1);
});

test('river water is drawn with streaks of foam that travel downstream, lying along the flow', () => {
  const world = new World(1);
  const { river, x, y } = reach(world, { eastward: true });
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const chunk = world.chunk(cx, cy);
  const flow = {};
  let rivers = 0;
  let streaks = 0;
  const pads = new Set([...family('water.pad.'), ...family('water.pads.'), ...family('water.padfill.'),
    ...family('water.skater.'), ...family('water.bubbles.')]);
  const frames = [];
  for (let t = 10; t < 13; t += 0.25) frames.push([t, shadeChunk(world, chunk, t)]);
  for (let i = 0; i < 4096; i++) {
    if (!chunk.flow?.river[i] || chunk.type[i] !== WATER) continue;
    const wx = cx * 64 + (i & 63);
    const wy = cy * 64 + (i >> 6);
    world.flowAt(wx + 0.5, wy + 0.5, flow);
    if (flow.speed < 0.05) continue;
    rivers++;
    assert.equal(animated(chunk, i, wx, wy, 1), true);
    for (const [, out] of frames) {
      const g = shown(out, i);
      assert.ok(!pads.has(g), 'no lily pads, skaters or bubbles in running water');
      if (isStreak(g)) {
        streaks++;
        assert.ok(STREAKS[0].has(g), 'an eastward river\'s foam lies along the rows');
        assert.ok(FLOATING[g], 'foam hides what the water mirrors');
      }
    }
  }
  assert.ok(rivers > 20 && streaks > 10, `${rivers} river cells, ${streaks} streak sightings`);
  assert.equal(screenOrientation(1, 0.02), 0);

  // Row by row, the foam pattern a moment later is the earlier one moved
  // downstream by about as far as the water went.
  const sign = Math.sign(river.dir[2 * Math.floor(river.mouthFrom / 2)]) || 1;
  const t0 = 20;
  const a = shadeChunk(world, chunk, t0);
  const b = shadeChunk(world, chunk, t0 + 0.5);
  const votes = new Map();
  for (let row = 0; row < 64; row++) {
    const cols = [];
    for (let col = 0; col < 64; col++) {
      const i = row * 64 + col;
      if (chunk.flow?.river[i]) cols.push(col);
    }
    if (cols.length < 8) continue;
    let best = 0;
    let bestScore = -1;
    for (let shift = -12; shift <= 12; shift++) {
      let score = 0;
      for (const col of cols) {
        const i = row * 64 + col;
        const j = row * 64 + col + shift;
        if (col + shift < 0 || col + shift > 63) continue;
        if (isStreak(shown(a, i)) && isStreak(shown(b, j))) score++;
      }
      if (score > bestScore) { bestScore = score; best = shift; }
    }
    if (bestScore > 0) votes.set(best, (votes.get(best) ?? 0) + 1);
  }
  const [shift] = [...votes].sort((p, q) => q[1] - p[1])[0];
  world.flowAt(x, y, flow);
  const expected = toCells(flow.speed * 0.5, 0).cols;
  assert.ok(Math.sign(shift) === sign && Math.abs(Math.abs(shift) - expected) <= expected * 0.6 + 1,
    `foam moved ${shift} columns; the water ${expected * sign}`);
});

test('lake water away from rivers is drawn exactly as before', () => {
  const rivers = new World(1);
  const plain = new World(1, { rivers: false });
  for (const t of [0, 7.5]) {
    const a = shadeChunk(rivers, rivers.chunk(0, 1), t);
    const b = shadeChunk(plain, plain.chunk(0, 1), t);
    assert.deepEqual(a, b);
  }
});

// A made-up chunk of river: running east, deep down the middle rows, with
// a stone midstream and a bend so every part of the current shows.
function riverChunk({ speed = 0.6, bend = 0, secondary = 0, stones = [], depth = 0.05 } = {}) {
  const n = 64 * 64;
  const chunk = { cx: 0, cy: 0, version: 0, type: new Uint8Array(n).fill(2), elev: new Float32Array(n).fill(0.5),
    rnd: new Float32Array(n), shade: new Float32Array(n).fill(0.5), riverStones: stones, flow: {
      heading: new Uint8Array(n), speed: new Uint8Array(n), across: new Int8Array(n), bend: new Uint8Array(n),
      secondary: new Int8Array(n), width: new Uint8Array(n), tau: new Float32Array(n), river: new Uint16Array(n) } };
  const f = chunk.flow;
  for (let i = 0; i < n; i++) {
    const row = i >> 6;
    const col = i & 63;
    chunk.rnd[i] = ((i * 2654435761) >>> 0) / 4294967296;
    if (row < 20 || row > 44) continue;
    const q = (row - 32) / 12.5;
    chunk.type[i] = WATER;
    chunk.elev[i] = WATER_LEVEL - depth * Math.max(0.08, 1 - q * q);
    f.river[i] = 7;
    f.speed[i] = Math.round(speed * 255);
    f.across[i] = Math.round(q * 80);
    f.width[i] = Math.min(255, Math.round(12.5 * 40));
    f.bend[i] = Math.round(bend * 255);
    f.secondary[i] = Math.round(secondary * 127);
    f.tau[i] = (col / 21.67) / speed;
  }
  return chunk;
}

test('a stone breaks the current into froth, a V-wake and an eddy, and bends froth on the outer bank', () => {
  const vee = new Set(family('water.vee.'));
  const eddy = new Set(family('water.eddy.'));
  const froth = new Set([...family('water.froth.'), ...family('water.foam.')]);
  const riffle = new Set(family('water.riffle.'));
  const leaves = new Set(Array.from({ length: 8 }, (_, k) => family('leaf.')[k]));
  const chunk = riverChunk({ stones: [{ x: 20.5, y: 32.5, r: 1.6 }], bend: 1, secondary: 1 });
  const seen = { vee: 0, eddy: 0, froth: 0, riffle: 0, leaf: 0, outer: 0 };
  for (let t = 0; t < 40; t += 0.37) {
    const out = shadeChunk({ seed: 3 }, chunk, t);
    for (let i = 0; i < 4096; i++) {
      if (chunk.type[i] !== WATER) continue;
      const g = shown(out, i);
      const row = i >> 6;
      const col = i & 63;
      if (vee.has(g)) seen.vee++;
      if (eddy.has(g)) seen.eddy++;
      if (froth.has(g) && Math.abs(col - 18) < 3 && Math.abs(row - 32) < 2) seen.froth++;
      if (froth.has(g) && row < 26 && col > 30) seen.outer++;
      if (riffle.has(g)) seen.riffle++;
      if (leaves.has(g)) seen.leaf++;
    }
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `${k} shows`);
  // Slow deep pools are calm enough for fish to rise.
  const pool = riverChunk({ speed: 0.08, depth: 0.065 });
  const rings = new Set(family('water.ring.'));
  let risen = 0;
  for (let t = 0; t < 30; t += 0.2) {
    const out = shadeChunk({ seed: 3 }, pool, t);
    for (let i = 0; i < 4096; i++) if (pool.type[i] === WATER && rings.has(shown(out, i))) risen++;
  }
  assert.ok(risen > 0, 'a fish rises in the pool');
  // Water hardly moving is drawn as calm as a lake.
  const slack = riverChunk({ speed: 0.02 });
  assert.equal(animated(slack, 32 * 64 + 5, 5, 32, 3), animated(riverChunk({ speed: 0.02, depth: 0.05 }), 32 * 64 + 5, 5, 32, 3));
});

test('stones on a river bed are told apart, under the surface or breaking it', () => {
  const world = new World(1);
  const kinds = new Set();
  for (let ry = -4; ry <= 4 && kinds.size < 3; ry++) {
    for (let rx = -4; rx <= 4 && kinds.size < 3; rx++) {
      const river = world.rivers.region(rx, ry);
      if (!river) continue;
      for (let k = 0; k < river.mouthFrom; k += 3) {
        const c = world.chunk(Math.floor(river.points[2 * k] / ASPECT / 64), Math.floor(river.points[2 * k + 1] / 64));
        for (let i = 0; i < 4096; i++) if (c.type[i] === WATER) kinds.add(bedStone(c, i, 1));
      }
    }
  }
  assert.deepEqual([...kinds].sort(), [0, 1, 2]);
});

function fakeAudio() {
  const nodes = [];
  const context = { state: 'running', currentTime: 10, sampleRate: 16000 };
  const parameter = (value = 0) => {
    const param = { value, calls: [] };
    for (const method of ['setValueAtTime', 'setTargetAtTime', 'cancelAndHoldAtTime', 'cancelScheduledValues',
      'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) {
      param[method] = (...args) => { param.calls.push({ method, args }); if (method === 'setTargetAtTime') param.target = args[0]; };
    }
    return param;
  };
  const node = (kind) => {
    const result = { kind, connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; } };
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
  const engine = { context, listener: { x: 0, y: 0 }, spatial: () => ({ gain: 0.8, pan: 0.2 }),
    route: () => ({ input: {}, pan: { pan: parameter() }, dispose() {}, update() {} }) };
  return { engine, nodes };
}

test('near a river the water babbles, alongside any lapping, and falls quiet away from it', () => {
  const audio = fakeAudio();
  const ambience = new Ambience(audio.engine);
  ambience.update({ time: 1 });
  assert.equal(ambience.river, null, 'no babble without a river');
  const river = { x: 5, y: 6, strength: 0.8, speed: 0.5 };
  const gains = [];
  for (let t = 0; t < 1; t += 0.05) {
    ambience.update({ time: t, river, water: { x: 1, y: 1, strength: 0.5 } });
    gains.push(ambience.river.gain.gain.target);
  }
  assert.ok(ambience.water && ambience.river, 'both voices play together');
  assert.ok(Math.min(...gains) > 0 && Math.max(...gains) > Math.min(...gains) * 1.2, 'a babbling, not a steady hiss');
  assert.equal(ambience.river.filter.type ?? 'bandpass', 'bandpass');
  ambience.update({ time: 2, river: null });
  assert.equal(ambience.river.gain.gain.target, 0, 'fades out away from the river');
  const voice = ambience.river;
  ambience.pause();
  assert.equal(ambience.river, null);
  assert.ok(voice);
});

test('the sound sampler hears even the narrowest river from anywhere within earshot, and none far away', () => {
  const world = new World(1);
  // The narrowest reach of any river near the origin.
  let narrow = null;
  for (let ry = -4; ry <= 4; ry++) {
    for (let rx = -4; rx <= 4; rx++) {
      const river = world.rivers.region(rx, ry);
      if (!river) continue;
      for (let i = 3; i < river.mouthFrom - 3; i++) if (!narrow || river.half[i] < narrow.river.half[narrow.i]) narrow = { river, i };
    }
  }
  const { river, i } = narrow;
  const x = river.points[2 * i] / ASPECT;
  const y = river.points[2 * i + 1];
  // From every offset across one spacing of the lake sampler's grid.
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const sampler = new EnvironmentSampler(world);
      const heard = sampler.update(0.5, x + 20 + dx, y + 10 + dy, 0).river;
      assert.ok(heard && heard.strength > 0 && heard.strength < 1 && heard.speed > 0, `${dx},${dy}`);
    }
  }
  const far = new EnvironmentSampler(world);
  assert.equal(far.update(0.5, world.spawn.x, world.spawn.y, 0).river, null);
  // Without rivers at all the sampler still works.
  const none = new EnvironmentSampler({ seed: 1, typeAt: () => 2 });
  assert.equal(none.update(0.5, 0, 0, 0).river, null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { GLYPHS } from '../src/render/glyphs.js';
import { bogDepth, bogStyle, paintBog, SEDGE, wetness } from '../src/world/bogs.js';
import { Dust } from '../src/world/dust.js';
import { ConnectedFire, vegetationFuel } from '../src/world/fire-spread.js';
import { PALETTES } from '../src/world/grass-roots.js';
import { Mushrooms } from '../src/world/mushrooms.js';
import { toCellPoint, toMetres } from '../src/world/provinces.js';
import * as bogShader from '../src/world/terrain/bog.js';
import { TERRAIN_SHADERS } from '../src/world/terrain/index.js';
import { BOG, CHUNK_SIZE, GRASS, grassLike, SHORE, WATER, World } from '../src/world/world.js';
import { FakeWorld, loadGame } from './helpers/main-game.js';

const world = new World(1);
const plain = new World(1, { bogs: false });
const bogId = world.provinces.nearest('bog', world.spawn.x, world.spawn.y);
const edge = world.provinces.edgePoint(bogId, world.spawn);
const heart = world.provinces.heart(bogId);
const chunkOf = (w, p) => w.chunk(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.y / CHUNK_SIZE));
const count = (c, t) => c.type.reduce((n, v) => n + (v === t), 0);
// A chunk at the bog's edge that holds both bog and meadow.
const edgeChunk = chunkOf(world, edge);

test('bog is grass-like: meadow and bog, never shore or water', () => {
  assert.equal(BOG, 5);
  assert.ok(grassLike(GRASS) && grassLike(BOG));
  assert.ok(!grassLike(SHORE) && !grassLike(0));
  assert.equal(TERRAIN_SHADERS[BOG], bogShader);
  assert.deepEqual(PALETTES[SEDGE], [60, 66, 34]);
});

test('bog ground lies only in bog provinces, more than 7 m inside their border', () => {
  const heartChunk = chunkOf(world, heart);
  assert.equal(count(heartChunk, BOG), CHUNK_SIZE * CHUNK_SIZE, 'a bog\'s heart is all bog');
  assert.ok(count(edgeChunk, BOG) > 0 && count(edgeChunk, GRASS) > 0, 'its edge holds bog and meadow');
  for (const c of [edgeChunk, heartChunk]) {
    for (let i = 0; i < c.type.length; i += 7) {
      if (c.type[i] !== BOG) continue;
      const x = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const y = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      assert.equal(world.provinces.idAt(x, y), bogId);
      assert.ok(world.provinces.ringInside(bogId, x, y, 7), `bog at ${x},${y} is 7 m inside`);
    }
  }
  // A chunk outside every bog skips the bog layer.
  assert.equal(world.chunk(0, 0).bog, null);
});

test('depth rises in 2 m steps away from the border, and wetness with it', () => {
  const h = toMetres(heart.x, heart.y);
  const e = toMetres(edge.x, edge.y);
  const len = Math.hypot(h.x - e.x, h.y - e.y);
  let last = -1;
  // From the edge point outward past the border, then inward to the heart.
  for (let t = -12; t <= len; t += 1) {
    const p = toCellPoint(e.x + (h.x - e.x) * t / len, e.y + (h.y - e.y) * t / len);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const id = world.provinces.idAt(x, y);
    const depth = id === bogId ? bogDepth(world.provinces, bogId, x, y) : 0;
    if (t > 0) assert.ok(depth >= last, `depth ${depth} after ${last} at ${t} m`);
    if (t > 0) last = depth;
    if (depth <= 2) assert.equal(wetness(depth, x, y, 1), 0);
  }
  assert.equal(last, 12);
  assert.equal(wetness(12, heart.x, heart.y, 1), 1);
});

test('no cell is painted deeper than its own ring allows', () => {
  let painted = 0;
  for (const seed of [1, 2, 3]) {
    const w = seed === 1 ? world : new World(seed);
    const id = w.provinces.nearest('bog', w.spawn.x, w.spawn.y);
    const p = w.provinces.edgePoint(id, w.spawn);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const c = w.chunk(Math.floor(p.x / CHUNK_SIZE) + dx, Math.floor(p.y / CHUNK_SIZE) + dy);
      for (let i = 0; c.bog && i < c.type.length; i++) {
        const x = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
        const y = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        const own = w.provinces.idAt(x, y);
        const e = w.provinces.terrain(own) === 'bog' ? bogDepth(w.provinces, own, x, y) : 0;
        const w0 = wetness(e, x, y, seed);
        assert.ok(c.bog[i] <= Math.round(w0 * 255), `${x},${y} wetter than its depth ${e} allows`);
        if (c.type[i] === BOG) assert.ok(w0 > 0.5, `${x},${y} is bog at depth ${e}`);
        painted += c.type[i] === BOG;
      }
    }
  }
  assert.ok(painted > 10000, `${painted} bog cells`);
});

test('the bog is a drawing layer: meadow chunks and every prop are as without bogs', () => {
  const meadow = world.chunk(0, 0);
  const same = plain.chunk(0, 0);
  for (const key of ['type', 'elev', 'grassHeight', 'grassDensity', 'grassStyle']) assert.deepEqual(meadow[key], same[key]);
  const ids = (w, c) => w.propsOf(c.cx, c.cy).map((p) => `${p.id}:${p.kind}:${p.x},${p.y}`);
  for (const p of [edge, heart]) {
    const c = chunkOf(world, p);
    assert.deepEqual(ids(world, c), ids(plain, chunkOf(plain, p)));
    // Generators read the land as it lay before the bog.
    assert.ok(c.landType.every((t) => t !== BOG));
    assert.equal(world.preRiverTypeAt(p.x, p.y), plain.typeAt(p.x, p.y));
  }
});

test('props are as without bogs in dense groves and where a river crosses a bog', () => {
  const ids = (w, cx, cy) => w.propsOf(cx, cy).map((p) => `${p.id}:${p.kind}:${p.x},${p.y}`);
  let trees = 0;
  let rivers = 0;
  for (const seed of [1, 2, 3]) {
    const on = new World(seed, { woodland: 'dense' });
    const off = new World(seed, { woodland: 'dense', bogs: false });
    const id = on.provinces.nearest('bog', on.spawn.x, on.spawn.y);
    const h = on.provinces.heart(id);
    const hx = Math.floor(h.x / CHUNK_SIZE);
    const hy = Math.floor(h.y / CHUNK_SIZE);
    for (let cy = hy - 4; cy <= hy + 4; cy++) {
      for (let cx = hx - 4; cx <= hx + 4; cx++) {
        const c = on.chunk(cx, cy);
        if (!c.type.includes(BOG)) continue;
        // A river's own water, not a lake's.
        const river = !!c.flow?.river.some((v) => v);
        rivers += river;
        if (!river && (cx + cy) % 3) continue;
        assert.deepEqual(ids(on, cx, cy), ids(off, cx, cy), `chunk ${cx},${cy} of seed ${seed}`);
        // A grove's sward reads the land before the bog too.
        assert.deepEqual(c.grove, off.chunk(cx, cy).grove);
        trees += on.propsOf(cx, cy).length;
      }
    }
  }
  assert.ok(rivers >= 3, `${rivers} river chunks`);
  assert.ok(trees > 40, `${trees} props`);
});

test('bog grass is mostly sedge, thinning into the meadow\'s own across the margin', () => {
  const heartChunk = chunkOf(world, heart);
  const sedge = heartChunk.grassStyle.reduce((n, s) => n + (s === SEDGE), 0);
  assert.ok(sedge > heartChunk.grassStyle.length * 0.8, `${sedge} sedge cells`);
  assert.ok(heartChunk.grassHeight.every((h) => h > 2), 'bog grows grass like the meadow');
  assert.equal(bogStyle(3, GRASS, 0, 0, 0, 1), 3);
  assert.equal(bogStyle(3, BOG, 1, 0, 0, 1), SEDGE);
});

test('painting bog lays a sedge lawn, and resetting brings the meadow back', () => {
  const w = new World(1);
  const scene = new Scenery(w);
  const x = Math.floor(w.spawn.x);
  const y = Math.floor(w.spawn.y);
  const { c, i } = w.locate(x, y);
  const style = c.grassStyle[i];
  assert.equal(scene.paint(x, y, 0, BOG), 1);
  assert.equal(c.type[i], BOG);
  assert.equal(c.grassStyle[i], SEDGE);
  assert.ok(c.grassHeight[i] > 2);
  assert.ok(Math.abs(c.elev[i] - 0.46) < 1e-6);
  // A cell of the bog itself, painted meadow, is bog again after a reset.
  const b = chunkOf(w, heart);
  const k = b.type.indexOf(BOG);
  const bx = b.cx * CHUNK_SIZE + (k % CHUNK_SIZE);
  const by = b.cy * CHUNK_SIZE + Math.floor(k / CHUNK_SIZE);
  const sedge = b.grassStyle[k];
  assert.equal(scene.paint(bx, by, 0, GRASS), 1);
  assert.equal(w.typeAt(bx, by), GRASS);
  scene.reset();
  assert.equal(c.type[i], GRASS);
  assert.equal(c.grassStyle[i], style);
  const again = w.locate(bx, by);
  assert.equal(again.c.type[again.i], BOG);
  assert.equal(again.c.grassStyle[again.i], sedge);
  assert.throws(() => scene.paint(x, y, 0, 6));
});

test('a fire on bog grass spreads through it and stops where the fuel ends', () => {
  const w = new World(1);
  const c = chunkOf(w, heart);
  const i = c.type.findIndex((t, k) => t === BOG && c.blades.present[k]);
  const x = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE) + 0.5;
  const y = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) + 0.5;
  const fire = new ConnectedFire(w, vegetationFuel(w, x, y), x, y);
  for (let s = 0; s < 400 && fire.events.length; s++) fire.update(0.5);
  assert.equal(fire.events.length, 0, 'the fire burns out');
  const lit = [...fire.nodes.keys()].map((k) => k.slice(6).split(',').map(Number));
  assert.ok(lit.length > 100, `${lit.length} cells burnt`);
  let shore = 0;
  for (const [lx, ly] of lit) {
    assert.equal(w.typeAt(lx, ly), BOG);
    const at = w.locate(lx, ly);
    assert.equal(at.c.burnt[at.i], 255);
    // Every unburnt neighbour is no fuel at all.
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (fire.nodes.has(`grass:${lx + dx},${ly + dy}`)) continue;
      assert.equal(vegetationFuel(w, lx + dx, ly + dy), null);
      shore += [SHORE, WATER].includes(w.typeAt(lx + dx, ly + dy));
    }
  }
  // The front runs up to the water's edge.
  assert.ok(shore > 10, `${shore} cells of the front meet the shore`);
});

test('glowcaps grow on bog, and the meadow\'s glowcaps and fuel are as without bogs', () => {
  const caps = new Mushrooms(world, { spawnRate: 1 });
  const c = chunkOf(world, heart);
  const x0 = (c.cx - 1) * CHUNK_SIZE;
  const y0 = (c.cy - 1) * CHUNK_SIZE;
  const listed = caps.nodesIn(x0, y0, x0 + 3 * CHUNK_SIZE, y0 + 3 * CHUNK_SIZE);
  assert.ok(listed.filter((p) => world.typeAt(p.x, p.y) === BOG).length > 10);
  const on = new Mushrooms(world);
  const off = new Mushrooms(plain);
  const at = (m, cx, cy) => m.nodesOf(cx, cy).map((p) => `${p.x},${p.y},${p.size}`);
  assert.deepEqual(on.starters, off.starters);
  const sx = Math.floor(world.spawn.x / CHUNK_SIZE);
  const sy = Math.floor(world.spawn.y / CHUNK_SIZE);
  let meadows = 0;
  for (let cy = sy - 2; cy <= sy + 2; cy++) {
    for (let cx = sx - 2; cx <= sx + 2; cx++) {
      if (world.chunk(cx, cy).bog) continue;
      meadows++;
      assert.deepEqual(at(on, cx, cy), at(off, cx, cy));
    }
  }
  assert.ok(meadows > 10);
  const fuel = (w) => Array.from({ length: CHUNK_SIZE * 8 }, (_, k) => vegetationFuel(w, k % CHUNK_SIZE, Math.floor(k / CHUNK_SIZE))?.duration);
  assert.deepEqual(fuel(world), fuel(plain));
  assert.ok(fuel(world).some(Boolean));
});

test('dust over bog throws blade bits and no grit', () => {
  const dust = new Dust();
  dust.burst({ typeAt: () => BOG }, 0, 0, 4, 6);
  assert.ok(dust.list.length > 4);
  // Blade clippings spin; grit and pebbles would lie still.
  assert.ok(dust.list.some((d) => d.mode === 3));
  assert.ok(dust.list.every((d) => d.mode !== 1 && !d.bounce));
});

test('the bog floor is still, olive and dark, and burnt bog looks like burnt meadow', () => {
  const c = chunkOf(world, heart);
  const n = CHUNK_SIZE * CHUNK_SIZE;
  const out = { fg: new Uint8ClampedArray(n * 4), bg: new Uint8ClampedArray(n * 4), ov: new Uint8ClampedArray(n * 4) };
  const banned = [...'≈·°'].map((ch) => GLYPHS.indexOf(ch));
  let moss = 0;
  for (let i = 0; i < n; i++) {
    assert.equal(bogShader.animated(c, i), false);
    bogShader.shade(out, i * 4, c, i, c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE), 1, 0);
    const base = out.fg[i * 4 + 3] | ((out.bg[i * 4 + 3] & 15) << 8);
    assert.ok(!banned.includes(base));
    // Moss is far greener than the peat.
    if (out.fg[i * 4 + 1] > out.fg[i * 4] * 1.5) moss++;
    // Never brighter than the meadow's floor.
    assert.ok(out.fg[i * 4 + 1] < 120);
  }
  assert.ok(moss > n * 0.05 && moss < n * 0.4, `${moss} cells of moss`);
  const burnt = { ...c, burnt: new Uint8Array(n).fill(255) };
  const a = { fg: new Uint8ClampedArray(4), bg: new Uint8ClampedArray(4), ov: new Uint8ClampedArray(4) };
  const b = { fg: new Uint8ClampedArray(4), bg: new Uint8ClampedArray(4), ov: new Uint8ClampedArray(4) };
  bogShader.shade(a, 0, burnt, 9, 9, 0, 1, 0);
  TERRAIN_SHADERS[GRASS].shade(b, 0, burnt, 9, 9, 0, 1, 0);
  assert.deepEqual(a, b);
});

test('paintBog leaves a chunk with no bog in reach alone', () => {
  const type = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(GRASS);
  assert.equal(paintBog(world, 0, 0, CHUNK_SIZE, type, null), null);
  const wet = paintBog(world, Math.floor(heart.x / CHUNK_SIZE), Math.floor(heart.y / CHUNK_SIZE), CHUNK_SIZE, type, null);
  assert.ok(wet.land.every((t) => t === GRASS) && type.every((t) => t === BOG));
});

// The page's Bog start, with a bog whose edge stands at a known cell.
class BogWorld extends FakeWorld {
  constructor(...args) {
    super(...args);
    this.provinces = { nearest: () => 26, edgePoint: () => ({ x: 40, y: 30 }) };
  }
}

test('?bog starts the player at the nearest bog\'s edge, or says there is none', async () => {
  const { game } = await loadGame(undefined, { href: 'http://localhost/?debug&animals=0&bog', real: { World: BogWorld } });
  assert.deepEqual([game.player.x, game.player.y], [40.5, 30.5]);
  assert.equal(game.camera.x, 40.5);
  const none = await loadGame(undefined, { href: 'http://localhost/?debug&animals=0&bog' });
  assert.ok(none.game.hud.toasts.includes('No bog nearby.'));
});

test('a club slamming into bog throws no sparks, as on the meadow; on stone it does', async () => {
  let ground = BOG;
  const sparks = [];
  class Ground extends FakeWorld { typeAt() { return ground; } }
  class Dusty { update() {} draw() {} burst() {} breath() {} sparks(...args) { sparks.push(args); } }
  const { game, frame } = await loadGame(undefined, { href: 'http://localhost/?debug&animals=0',
    real: { World: Ground, Dust: Dusty } });
  game.monsters.events.push({ type: 'slam', x: 3, y: 4, strength: 1 });
  frame();
  assert.equal(sparks.length, 0);
  ground = 4;
  game.monsters.events.push({ type: 'slam', x: 3, y: 4, strength: 1 });
  frame();
  assert.equal(sparks.length, 1);
});

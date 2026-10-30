import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { GLYPHS } from '../src/render/glyphs.js';
import { bogDepth, bogStyle, paintBog, SEDGE, wetness } from '../src/world/bogs.js';
import { Dust } from '../src/world/dust.js';
import { vegetationFuel } from '../src/world/fire-spread.js';
import { PALETTES } from '../src/world/grass-roots.js';
import { toCellPoint, toMetres } from '../src/world/provinces.js';
import * as bogShader from '../src/world/terrain/bog.js';
import { TERRAIN_SHADERS } from '../src/world/terrain/index.js';
import { BOG, CHUNK_SIZE, GRASS, grassLike, SHORE, World } from '../src/world/world.js';
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
  scene.reset();
  assert.equal(c.type[i], GRASS);
  assert.equal(c.grassStyle[i], style);
  assert.throws(() => scene.paint(x, y, 0, 6));
});

test('bog grass is fuel, scorches and burns like the meadow', () => {
  const w = new World(1);
  const c = chunkOf(w, heart);
  const i = c.type.findIndex((t, k) => t === BOG && c.blades.present[k]);
  const x = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
  const y = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
  assert.equal(vegetationFuel(w, x + 0.5, y + 0.5)?.kind, 'grass');
  w.burnGrassCell(x, y);
  assert.equal(c.burnt[i], 255);
  const before = c.burnt.filter((v) => v > 0).length;
  w.burnGrass(x, y);
  assert.ok(c.burnt.filter((v) => v > 0).length > before + 5);
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

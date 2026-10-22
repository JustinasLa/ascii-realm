import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { grassRoots } from '../src/world/grass-roots.js';
import { Grass } from '../src/world/grass.js';
import { createProp } from '../src/world/props.js';
import { CHUNK_SIZE, DIRT, GRASS, SHORE, STONE, WATER, World } from '../src/world/world.js';

const coordinates = [[-2, 1], [0, 0], [1, -1]];
const arrays = ['type', 'elev', 'shade', 'rnd', 'grassHeight', 'grassDensity', 'grassStyle'];

function digest(world) {
  const hash = createHash('sha256');
  for (const [cx, cy] of coordinates) {
    const c = world.chunk(cx, cy);
    for (const name of arrays) hash.update(Buffer.from(c[name].buffer));
    for (const value of Object.values(c.blades)) hash.update(Buffer.from(value.buffer));
  }
  return hash.digest('hex');
}

test('default grass remains byte-identical to the original seeded field', () => {
  // Captured from the original World and grassRoots before adding the profile.
  for (const [seed, expected] of [
    [1, 'af7e5dda0f6888b2f212f318338f9f3f3e982df043c6d05781cb75000d2eff18'],
    [19, 'bb9a56642701374f41893d15cdfc6f7594cc5898c11c03a12936b6d22dfdf957'],
  ]) {
    assert.equal(digest(new World(seed)), expected);
    assert.equal(digest(new World(seed, { meadow: false })), expected);
  }
});

test('meadow grows a broad denser field while leaving terrain and seeds unchanged', () => {
  const ordinary = new World(19);
  const meadow = new World(19, { meadow: true });
  let before = 0, after = 0, grassy = 0, tall = 0;
  for (const [cx, cy] of coordinates) {
    const a = ordinary.chunk(cx, cy), b = meadow.chunk(cx, cy);
    for (const key of ['type', 'elev', 'shade', 'rnd']) assert.deepEqual(a[key], b[key]);
    before += a.blades.indices.length;
    after += b.blades.indices.length;
    for (let i = 0; i < b.type.length; i++) if (b.type[i] === GRASS) grassy++;
    tall += [...b.blades.heights].filter(h => h >= 3).length;
    // Every quadrant contains grass, including areas outside the old islands.
    for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
      const roots = [...b.blades.indices].filter(i => Math.floor((i % CHUNK_SIZE) / 32) === qx
        && Math.floor(i / CHUNK_SIZE / 32) === qy);
      const land = [...b.type].filter((type, i) => type === GRASS
        && Math.floor((i % CHUNK_SIZE) / 32) === qx && Math.floor(i / CHUNK_SIZE / 32) === qy).length;
      assert.ok(roots.length > land * 0.2, 'coverage reaches each grassy quadrant');
    }
  }
  assert.ok(after > before * 3, `${after} meadow roots versus ${before} default roots`);
  assert.ok(after > grassy * 0.35, 'the broad field has substantial root coverage');
  assert.ok(tall > after * 0.95, 'most roots have at least three rows of grass');
});

test('meadow preserves painted paths, water, burned holes and zero-height ground', () => {
  const world = new World(19, { meadow: true });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const type = x < 20 ? GRASS : [DIRT, WATER, STONE][Math.floor((x - 20) / 15)];
    world.setTerrain(x, y, type);
    if (x < 20 && y > 15) world.burnGrassCell(x, y);
  }
  const c = world.chunk(0, 0);
  for (const i of c.blades.indices) {
    assert.ok(c.type[i] === GRASS || c.type[i] === SHORE);
    assert.equal(c.burnt?.[i] ?? 0, 0);
    assert.ok(c.grassHeight[i] >= 2);
  }
  assert.ok([...c.blades.indices].some(i => i % 64 < 20 && i < 16 * 64));
  // Even a stale/non-grass density array cannot plant blades through a path.
  c.grassHeight.fill(4);
  c.grassDensity.fill(1);
  c.grassHeight[0] = 0;
  const blades = grassRoots(c, world.seed, CHUNK_SIZE, { flora: false, meadow: true });
  assert.equal(blades.present[0], 0);
  for (const i of blades.indices) {
    assert.ok(c.type[i] === GRASS || c.type[i] === SHORE);
    assert.equal(c.burnt?.[i] ?? 0, 0);
  }
});

test('painted meadow stays bare under a solid, regrows after removal and survives scene load', () => {
  const world = new World(1, { meadow: true });
  const x = Math.floor(world.spawn.x), y = Math.floor(world.spawn.y);
  const rock = createProp('rock', x + 0.5, y + 0.5, { seed: 7 });
  rock.id = 'test-meadow-rock';
  world.addProp(rock);
  for (const type of [DIRT, GRASS]) world.setTerrain(x, y, type);
  let { c, i } = world.locate(x, y);
  assert.equal(c.grassHeight[i], 0);
  assert.equal(c.blades.present[i], 0);
  world.deleteProp(rock.id);
  ({ c, i } = world.locate(x, y));
  assert.ok(c.grassHeight[i] > 3);
  const scene = new Scenery(world);
  scene.paint(x + 10, y, 2, DIRT);
  const saved = JSON.parse(JSON.stringify(scene.serialize()));
  scene.load(saved);
  assert.equal(world.meadow, true);
  assert.equal(world.typeAt(x + 10, y), DIRT);
  assert.deepEqual(scene.serialize(), saved);
});

test('meadow roots still respond to contact and recover their upright pose', () => {
  const world = new World(19, { meadow: true });
  const c = world.chunk(0, 0);
  const i = c.blades.indices.find(i => i % 64 > 8 && i % 64 < 56 && i > 8 * 64 && i < 56 * 64);
  assert.notEqual(i, undefined);
  const x = i % 64, y = Math.floor(i / 64);
  const grass = new Grass();
  grass.disturb(world, x + 0.5, y + 0.5, x + 0.5, y + 0.5, 2, 0, 0, 1);
  assert.ok(grass.pressAt(x, y, 0) > 0.9);
  assert.equal(grass.pressAt(x, y, 20), 0);
});

test('bulk scenery load rebuilds meadow blades once per touched chunk', () => {
  const world = new World(1, { meadow: true });
  const chunk = world.chunk(0, 0);
  let blades = chunk.blades, rebuilds = 0;
  Object.defineProperty(chunk, 'blades', {
    get: () => blades,
    set(value) { blades = value; rebuilds++; },
    configurable: true,
  });
  const scene = new Scenery(world);
  const data = scene.serialize();
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) data.terrain.push({ x, y, type: DIRT });
  scene.load(data);
  world.chunk(0, 0);
  assert.equal(rebuilds, 1, '576 edits must not regenerate thousands of blades after every cell');
  assert.equal(world.typeAt(12, 12), DIRT);
  assert.equal(chunk.blades.present[12 * 64 + 12], 0);
  scene.undo();
  world.chunk(0, 0);
  assert.equal(rebuilds, 2, 'undo also regrows the chunk only once');
});

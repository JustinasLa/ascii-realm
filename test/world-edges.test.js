import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS, Monster, Monsters } from '../src/entities/monsters.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { family } from '../src/render/glyphs.js';
import { bakeFine, fineOf } from '../src/world/fine-bakes.js';
import { drawProp, rebuildProp } from '../src/world/props.js';
import { shade } from '../src/world/terrain/water.js';
import { makeTree } from '../src/world/trees.js';
import { CHUNK_SIZE, WATER, World } from '../src/world/world.js';
import { mulberry32 } from '../src/core/rng.js';

function renderer(cols = 60, rows = 60) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  return r;
}

test('an archer that loses its prey stands down', () => {
  const elf = new Monster(0, 0, { kind: KINDS.elf, risen: true });
  elf.setState('chase');
  elf.update(1 / 60, { isWalkable: () => true, typeAt: () => 2 }, null, [], () => 0.5);
  assert.equal(elf.state, 'idle');
});

test('monsters find no footing on open water, and can all be called off', () => {
  const monsters = new Monsters({ seed: 4 });
  const sea = { isWalkable: () => true, typeAt: () => WATER };
  assert.equal(monsters.spawnNear(sea, { x: 0, y: 0 }), null);
  const land = { isWalkable: () => true, typeAt: () => 2 };
  assert.ok(monsters.spawnNear(land, { x: 0, y: 0 }, 'goblin'));
  monsters.arrows.list.push({});
  monsters.clear();
  assert.equal(monsters.list.length, 0);
  assert.equal(monsters.arrows.list.length, 0);
  assert.ok(Object.values(monsters.spawnIn).every(v => v > 0));
});

test('a burning tree glows in its fine letters, and its leaves still part for the player behind it', () => {
  const tree = makeTree(30.5, 50.5, mulberry32(9), { species: 'oak', season: 'summer', seed: 1 });
  fineOf(tree, true);
  bakeFine();
  const view = { x0: 0, y0: 0, cols: 60, rows: 60 };
  const plain = renderer();
  drawProp(plain, view, tree, undefined, 1, null, 1);
  const lit = renderer();
  tree.burning = { progress: 0.6, heat: 1 };
  drawProp(lit, view, tree, undefined, 1, null, 1);
  assert.notDeepEqual(lit.fine, plain.fine, 'embers redden the burning crown');
  delete tree.burning;
  const behind = renderer();
  const player = { y: tree.y - 1, foliageBounds: { x: tree.x, y: tree.y + tree.bounds.minY / 2, rx: 40, ry: 40 } };
  drawProp(behind, view, tree, undefined, 1, player, 1);
  assert.notDeepEqual(behind.fine, plain.fine, 'leaves part around the player');
  // Drawn the ordinary way (without the fine grid), a burning rock-like
  // prop is reddened too.
  const coarse = { fine: null, cols: 60, rows: 60 };
  const writes = [];
  const write = (r, sx, sy, g, red, green, blue) => writes.push([red, green, blue]);
  const cold = [];
  drawProp(coarse, view, tree, (r, sx, sy, g, red, green, blue) => cold.push([red, green, blue]), 1, null, 1);
  tree.burning = { progress: 0.6, heat: 1 };
  drawProp(coarse, view, tree, write, 1, null, 1);
  delete tree.burning;
  assert.equal(writes.length, cold.length);
  assert.ok(writes.some((c, k) => c[0] !== cold[k][0]));
  assert.equal(rebuildProp({ make: 'nothing' }), null);
});

test('lily pads with blooms and notches float, gently shining, on still water', () => {
  // Still water laid over open country, where pad colonies can take hold.
  const blooms = new Set(family('water.bloom.'));
  const slits = new Set(family('water.slit.'));
  const pads = new Set([...family('water.pad.'), ...family('water.pads.'), ...family('water.padfill.')]);
  const out = { fg: new Uint8ClampedArray(4), bg: new Uint8ClampedArray(4), ov: new Uint8ClampedArray(4) };
  let bloom = 0;
  let slit = 0;
  let pad = 0;
  const shines = new Set();
  for (let cy = -3; cy < 3; cy++) {
    for (let cx = -3; cx < 3; cx++) {
      const n = 4096;
      const chunk = { cx, cy, version: 0, type: new Uint8Array(n).fill(WATER), elev: new Float32Array(n).fill(0.37),
        rnd: new Float32Array(n).map((_, i) => ((i * 2654435761) >>> 0) / 4294967296), shade: new Float32Array(n).fill(0.5) };
      for (let i = 0; i < n; i++) {
        shade(out, 0, chunk, i, cx * CHUNK_SIZE + (i & 63), cy * CHUNK_SIZE + (i >> 6), 1, 3, 0);
        const g = out.fg[3] | ((out.bg[3] & 15) << 8);
        const layer = out.ov[3] | ((out.bg[3] >> 4) << 8);
        // One character per cell: a bloom is drawn in place of its pad.
        if (blooms.has(layer) || blooms.has(g)) bloom++;
        if (slits.has(layer) || slits.has(g)) slit++;
        if (pads.has(g)) {
          pad++;
          if (shines.size < 2) {
            shade(out, 0, chunk, i, cx * CHUNK_SIZE + (i & 63), cy * CHUNK_SIZE + (i >> 6), 1, 5, 0);
            shines.add(out.fg[0]);
            shade(out, 0, chunk, i, cx * CHUNK_SIZE + (i & 63), cy * CHUNK_SIZE + (i >> 6), 1, 3, 0);
            shines.add(out.fg[0]);
          }
        }
      }
    }
  }
  assert.ok(pad > 100 && bloom > 0 && slit > 0, `${pad} pads, ${bloom} blooms, ${slit} notches`);
  assert.equal(shines.size, 2, 'a pad\'s sheen changes slowly with time');
});

test('the world fills in a view nearest its middle first, within a time budget', () => {
  const world = new World(1);
  assert.equal(world.loaded(50, 50), null);
  let clock = 0;
  const left = world.load(0, 0, 3 * CHUNK_SIZE - 1, 2 * CHUNK_SIZE - 1, 5, () => (clock += 3));
  assert.ok(left > 0 && left < 6, 'a few chunks wait for the next frame');
  assert.ok(world.loaded(1, 1)?.props, 'the middle came first');
  assert.equal(world.load(0, 0, 3 * CHUNK_SIZE - 1, 2 * CHUNK_SIZE - 1, 1e9), 0);
  assert.equal(typeof world.rockTypeAt(3, 4), 'string');
  // Where no shore can be found, the player starts at the origin.
  assert.deepEqual(World.prototype.findSpawn.call({ typeAt: () => WATER }), { x: 0.5, y: 0.5 });
});

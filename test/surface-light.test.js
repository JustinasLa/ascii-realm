import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { FINE } from '../src/render/cells.js';
import { glyph } from '../src/render/glyphs.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { drawFireLight } from '../src/world/fire.js';
import { bakeFine, fineOf, fineBuffers, packFine } from '../src/world/fine-bakes.js';
import { drawGround } from '../src/world/ground.js';
import { fineRecipe } from '../src/world/prop-art.js';
import { createProp, drawProp, makeRiverStone } from '../src/world/props.js';
import {
  AMBIENT, GLOSS_DAMP, GLOSS_DRY, GLOSS_SUBMERGED, GLOSS_WET, glossByte, glossOf, normalByte, normalOf, shadeFactors,
  worldNormal,
} from '../src/world/surface-light.js';
import * as water from '../src/world/terrain/water.js';
import { STONE_GLYPH } from '../src/world/terrain/water.js';
import { CHUNK_SIZE, WATER, World } from '../src/world/world.js';

function renderer(cols = 8, rows = 6) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  return r;
}
const finish = (steps) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};

test('gloss and normals pack into bytes, 0 kept for no normal', () => {
  for (const g of [GLOSS_DRY, GLOSS_DAMP, GLOSS_SUBMERGED, GLOSS_WET]) {
    assert.ok(glossByte(g) > 0);
    assert.ok(Math.abs(glossOf(glossByte(g)) - g) < 0.003);
  }
  assert.deepEqual([GLOSS_DRY, GLOSS_DAMP, GLOSS_SUBMERGED].map(glossByte), [38, 102, 140]);
  assert.equal(glossByte(0), 1);
  for (const v of [-1, -0.4, 0, 0.7, 1]) assert.ok(Math.abs(normalOf(normalByte(v)) - v) < 0.01);
});

test('a face takes the light by facing it: full, none at a right angle or behind', () => {
  const f = shadeFactors(0, 0, 0, 0, 5, 0);
  assert.equal(f.diffuse, 1, 'flat ground under the light takes the even light');
  assert.equal(shadeFactors(0.8, 0, 0, 0, 1, 0).diffuse > AMBIENT, true);
  assert.equal(shadeFactors(Math.SQRT1_2, 0, -1, 0, 1, 0).diffuse, AMBIENT);
  const behind = shadeFactors(0.9, 0, -1, 0, 0.1, glossByte(1));
  assert.equal(behind.diffuse, AMBIENT);
  assert.equal(behind.spec, 0);
  assert.equal(shadeFactors(0, 0.99, 0, -0.2, 1, glossByte(1)).spec, 0, 'faces turned from the viewer never glint');
});

test('wet glints are brighter at the mirror angle and narrower than dry sheen', () => {
  // The face halfway between the light (straight up) and the viewer.
  const h = worldNormal(0, 0, 1).map((v, i) => v + [0, 0, 1][i]);
  const k = Math.hypot(...h);
  const n = h.map((v) => v / k);
  const wet = shadeFactors(n[0], n[1], 0, 0, 1, glossByte(GLOSS_WET)).spec;
  const dry = shadeFactors(n[0], n[1], 0, 0, 1, glossByte(GLOSS_DRY)).spec;
  assert.ok(wet > 2 * dry);
  const off = shadeFactors(n[0] + 0.3, n[1], 0, 0, 1, glossByte(GLOSS_WET)).spec / wet;
  const offDry = shadeFactors(n[0] + 0.3, n[1], 0, 0, 1, glossByte(GLOSS_DRY)).spec / dry;
  assert.ok(off < offDry);
  // A broader lobe for whole pebbles.
  assert.ok(shadeFactors(n[0] + 0.3, n[1], 0, 0, 1, glossByte(1), undefined, 0.35).spec > off * wet);
});

test('screen normals turn into the world frame with faces kept above the ground', () => {
  const n = worldNormal(0, 0, 1);
  assert.ok(Math.abs(n[0]) < 1e-9 && Math.abs(n[1] - 0.6) < 1e-9 && Math.abs(n[2] - 0.8) < 1e-9);
  assert.equal(worldNormal(0, 1, 0)[2], 0);
  assert.ok(worldNormal(0, 0, 0).every((v) => v === 0));
});

test('drawFireLight leaves everything without a normal as it always was', () => {
  const old = renderer(30, 20), now = renderer(30, 20);
  for (const r of [old, now]) {
    r.fineAt(20, 10, glyph('@'), 50, 50, 50, 5, 5, 5);
    r.fg.fill(20);
  }
  delete old.fineLit;
  delete old.cellLit;
  const source = { x: 12, y: 10, intensity: 1, seed: 3 };
  drawFireLight(old, { x0: 0, y0: 0 }, 1, source, 8, 2);
  drawFireLight(now, { x0: 0, y0: 0 }, 1, source, 8, 2);
  assert.deepEqual(now.fg, old.fg);
  assert.deepEqual(now.bg, old.bg);
  assert.deepEqual(now.fine, old.fine);
  assert.deepEqual(now.fineBg, old.fineBg);
});

test('a stone cell lights on the side facing the light and stays dark behind', () => {
  const lit = (nx) => {
    const r = renderer(30, 20);
    const o = (8 * 30 + 10) * 4;
    r.cellLit.set([normalByte(nx), normalByte(0), glossByte(GLOSS_SUBMERGED), 255], o);
    drawFireLight(r, { x0: 0, y0: 0 }, 1, { x: 14, y: 8, intensity: 1, seed: 1 }, 10, 0);
    return r.fg[o];
  };
  assert.ok(lit(0.8) > 2 * lit(-0.8), 'a light to the east lights east faces');
});

test('fine cells keep a normal only while their own stone is drawn there', () => {
  const r = renderer();
  r.fineAt(4, 4, glyph('@'), 100, 100, 100, 5, 5, 5, 15, 200, 60, 38, 6);
  const at = (4 * r.fineCols + 4) * 4;
  assert.deepEqual([...r.fineLit.subarray(at, at + 4)], [200, 60, 38, 6]);
  r.fineAt(4, 4, glyph('#'), 100, 100, 100, 5, 5, 5);
  assert.equal(r.fineLit[at + 2], 0, 'anything else drawn there takes light evenly');
  r.put(1, 1, glyph('x'), 1, 1, 1);
  r.cellLit[(1 * r.cols + 1) * 4 + 2] = 9;
  r.setGlyph(1 * r.cols + 1, glyph('y'));
  assert.equal(r.cellLit[(1 * r.cols + 1) * 4 + 2], 0);
  r.cellLit[(1 * r.cols + 1) * 4 + 2] = 9;
  r.put(1, 1, glyph('x'), 1, 1, 1);
  assert.equal(r.cellLit[(1 * r.cols + 1) * 4 + 2], 0);
});

test('a light to one side of a fine stone lights that side', () => {
  const side = (lx) => {
    const r = renderer(10, 6);
    for (let i = 0; i < FINE; i++) {
      r.fineAt(8 + i, 4, glyph('@'), 40, 40, 40, 4, 4, 4, 0, normalByte(i ? 0.7 : -0.7), normalByte(0), glossByte(GLOSS_DRY), 2);
    }
    r.lightFineLit(2 * 10 + 4, 0.5, lx, 2.5, 3, 156, 72, 12);
    const a = (4 * r.fineCols + 8) * 4;
    return [r.fine[a], r.fine[a + 4]];
  };
  const [lw, le] = side(0);
  assert.ok(lw > le, 'west light: west face brighter');
  const [rw, re] = side(10);
  assert.ok(re > rw, 'east light: east face brighter');
});

test('river stone bakes carry normals in the fine bake only, the ordinary bake unchanged', () => {
  const stone = makeRiverStone(10, 20, mulberry32(1));
  assert.ok(stone.cells.every((c) => c.nx === undefined));
  const fine = finish(fineRecipe(stone)());
  const solid = fine.filter((c) => c.br !== undefined);
  assert.ok(solid.length && solid.every((c) => Number.isFinite(c.nx) && Math.hypot(c.nx, c.ny) <= 1));
  const packed = packFine(fine);
  assert.ok(packed.bump.some(Boolean));
  assert.ok(fineBuffers(packed).includes(packed.normal.buffer));
  assert.ok(fineBuffers(packed).includes(packed.bump.buffer));
  // Builder rocks keep their normals through their variation.
  const rock = createProp('rock', 0, 0, { seed: 4 });
  assert.ok(finish(fineRecipe(rock)()).some((c) => c.nx !== undefined));
});

test('drawing a wet stone writes its normals with a wet gloss', () => {
  const stone = makeRiverStone(4.5, 8.5, mulberry32(2));
  fineOf(stone, true);
  bakeFine();
  const r = renderer(12, 10);
  r.fine = new Uint8ClampedArray(r.fine.length);
  drawProp(r, { x0: 0, y0: 0, cols: 12, rows: 10 }, stone);
  const glosses = new Set();
  for (let i = 0; i < r.fineCols * r.fineRows; i++) if (r.fineBg[i * 4 + 3] >= 16) glosses.add(r.fineLit[i * 4 + 2]);
  assert.ok(glosses.has(glossByte(GLOSS_WET)));
  stone.wet = false;
  stone.damp = true;
  r.clear();
  drawProp(r, { x0: 0, y0: 0, cols: 12, rows: 10 }, stone);
  let damp = false;
  for (let i = 0; i < r.fineCols * r.fineRows; i++) if (r.fineLit[i * 4 + 2] === glossByte(GLOSS_DAMP)) damp = true;
  assert.ok(damp);
});

test('riverbed stones in view are copied into cellLit with the ground, foam over them is not', () => {
  const world = new World(1);
  const r = renderer(160, 60);
  const view = { x0: -600, y0: -100, cols: 160, rows: 60 };
  drawGround(r, world, view, 3, null, 0);
  let stones = 0;
  for (let i = 0; i < 160 * 60; i++) if (r.cellLit[i * 4 + 2]) {
    stones++;
    assert.ok(r.cellLit[i * 4 + 3] > 0);
  }
  assert.ok(stones > 0, 'some bed stones show');
  // A second frame from the cached ground keeps them.
  const before = r.cellLit.slice();
  drawGround(r, world, view, 3, null, 0);
  assert.deepEqual(r.cellLit, before);
  // Not yet generated ground has none.
  drawGround(r, { loaded: () => null, seed: 1 }, view, 3, null, 0, true);
  assert.ok(r.cellLit.every((v, i) => i % 4 !== 2 || v === 0));
});

test('rocks by the water are damp', () => {
  const world = new World(1);
  const near = { kind: 'rock', x: -631.5, y: -150.5, footW: 3, footH: 1 };
  assert.equal(world.byWater(near), true);
  assert.equal(world.byWater({ kind: 'rock', x: world.spawn.x, y: world.spawn.y }), false);
});

// Shades one water cell into a one-cell buffer the way the ground does, and
// returns the glyph it ended up showing and the gloss it was given. The
// buffer is kept from frame to frame, as the screen's is, so a normal left
// from an earlier frame would show.
const cell = () => ({ fg: new Uint8ClampedArray(4), bg: new Uint8ClampedArray(4), ov: new Uint8ClampedArray(4),
  cellLit: new Uint8Array(4) });
function shadeCell(out, chunk, i, wx, wy, t) {
  water.shade(out, 0, chunk, i, wx, wy, 1, t);
  return { g: out.fg[3] | ((out.bg[3] & 15) << 8), gloss: out.cellLit[2] };
}

test('only a cell whose final glyph is a bed stone gets a normal: foam over a stone loses it, still pools keep it', () => {
  const world = new World(1);
  let still = 0, moving = 0, covered = 0;
  for (let cy = -3; cy <= 0; cy++) for (let cx = -11; cx <= -8; cx++) {
    const chunk = world.chunk(cx, cy);
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      if (chunk.type[i] !== WATER) continue;
      const wx = cx * CHUNK_SIZE + (i % CHUNK_SIZE), wy = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      const anim = water.animated(chunk, i, wx, wy, 1);
      let stone = false, lost = false;
      const out = cell();
      for (const t of anim ? [0, 0.7, 1.9, 3.3, 5.1] : [0]) {
        const { g, gloss } = shadeCell(out, chunk, i, wx, wy, t);
        assert.equal(gloss !== 0, !!STONE_GLYPH[g], `cell ${wx},${wy} at ${t}`);
        if (gloss) stone = true;
        else if (stone) lost = true;
      }
      if (stone && !anim) still++;
      if (stone && anim) moving++;
      if (lost) covered++;
    }
  }
  assert.ok(still > 0, 'bed stones in still water are shaded');
  assert.ok(moving > 0, 'bed stones in moving water are shaded');
  assert.ok(covered > 0, 'a stone that foam or a wavelet covers loses its normal for that frame');
});

test('a ground-cache hit keeps the bed normals of the first, uncached draw', () => {
  const world = new World(1);
  const view = { x0: -600, y0: -100, cols: 160, rows: 60 };
  const first = renderer(160, 60), second = renderer(160, 60);
  drawGround(first, world, view, 0, null, 0);
  second.cellLit.fill(99);
  drawGround(second, world, view, 0, null, 0);
  assert.ok(first.cellLit.some(Boolean));
  assert.deepEqual(second.cellLit, first.cellLit);
});

test('a builder rock added beside water is damp, one added on dry land is not', () => {
  const world = new World(1);
  const near = createProp('rock', -631.5, -150.5, { seed: 4 });
  near.id = 'near';
  world.addProp(near);
  assert.equal(near.damp, true);
  const dry = createProp('rock', world.spawn.x, world.spawn.y, { seed: 4 });
  dry.id = 'dry';
  world.addProp(dry);
  assert.equal(dry.damp, undefined);
});

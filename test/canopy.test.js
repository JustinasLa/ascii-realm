import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { TILT } from '../src/entities/rig.js';
import {
  CLIP_FADE, GAIN, GAIN_FLOOR, LAYER_UNIT, LEAF_GAIN, MOON_GROUND, canopyStamp, hasStamp, stampStrength,
} from '../src/world/canopy.js';
import { canopyOf, withCanopy } from '../src/world/prop-art.js';
import { createProp } from '../src/world/props.js';
import { MOON, worldNormal } from '../src/world/surface-light.js';
import { MAX_TREE_HALF_WIDTH, TREE_SPECIES, makeTree } from '../src/world/trees.js';
import { ASPECT } from '../src/world/world.js';

const tree = (species, options = {}) => makeTree(40.5, 80.5, mulberry32(7), { species, seed: 3, ...options });

// The stamp's cells as { dx, dy, v } from the tree's base, v in layers.
function cells(stamp) {
  const out = [];
  for (let y = 0; y < stamp.h; y++) {
    for (let x = 0; x < stamp.w; x++) {
      const v = stamp.layers[y * stamp.w + x];
      if (v) out.push({ dx: stamp.x0 + x, dy: stamp.y0 + y, v: v / LAYER_UNIT });
    }
  }
  return out;
}

function centroid(list) {
  let sx = 0, sy = 0, sw = 0;
  for (const c of list) { sx += (c.dx + 0.5) * c.v; sy += (c.dy + 0.5) * c.v; sw += c.v; }
  return { x: sx / sw, y: sy / sw };
}

test('the moon throws shadows away from itself along the ground', () => {
  const [x, y] = worldNormal(...MOON);
  const k = Math.hypot(x, y);
  assert.deepEqual(MOON_GROUND, [-x / k, -y / k]);
  assert.ok(Math.abs(MOON_GROUND[0] - 0.866) < 0.01 && Math.abs(MOON_GROUND[1] - 0.499) < 0.01,
    'east and a little south: right and toward the viewer');
});

test('one leaf layer keeps LEAF_GAIN of the light, down to a floor', () => {
  assert.equal(GAIN.length, 256);
  for (let i = 0; i < 256; i++) assert.equal(GAIN[i], Math.fround(Math.max(GAIN_FLOOR, LEAF_GAIN ** (i / LAYER_UNIT))));
  assert.equal(GAIN[0], 1);
  assert.equal(GAIN[LAYER_UNIT], LEAF_GAIN);
  assert.equal(GAIN[255], Math.fround(GAIN_FLOOR));
});

test('every kind of tree, spruce included, has leaf masses and a footprint; bushes have none', () => {
  for (const species of TREE_SPECIES) {
    for (const growth of ['mature', 'sapling']) {
      const prop = tree(species, { growth });
      const masses = canopyOf(prop);
      assert.ok(masses && masses.length >= 12 && masses.length % 4 === 0, `${species} ${growth} has three or more masses`);
      for (let i = 0; i < masses.length; i += 4) {
        assert.ok(masses.slice(i, i + 4).every(Number.isFinite), `${species} finite`);
        assert.ok(masses[i + 1] > 0 && masses[i + 2] > 0, `${species} mass above the ground with a radius`);
      }
      const stamp = canopyStamp(prop, 3);
      assert.ok(cells(stamp).length > 5, `${species} ${growth} casts a shadow`);
      assert.ok(stamp.layers.every((v) => Number.isFinite(v)));
    }
  }
  const bush = makeTree(40.5, 80.5, mulberry32(7), { growth: 'bush' });
  assert.equal(canopyOf(bush), null);
  assert.equal(canopyStamp(bush), null);
  assert.equal(hasStamp(bush), true, 'a prop without leaves is not baked again');
  assert.equal(canopyStamp({ kind: 'rock', x: 0, y: 0 }), null);
});

test('a footprint stays within a tree\'s reach and leans away from the moon', () => {
  for (const species of TREE_SPECIES) {
    const prop = tree(species);
    const stamp = canopyStamp(prop, 3);
    assert.ok(stamp.x0 >= -MAX_TREE_HALF_WIDTH && stamp.x0 + stamp.w - 1 <= MAX_TREE_HALF_WIDTH, `${species} width`);
    assert.ok(stamp.y0 >= -MAX_TREE_HALF_WIDTH && stamp.y0 + stamp.h - 1 <= MAX_TREE_HALF_WIDTH, `${species} depth`);
    const list = cells(stamp);
    const c = centroid(list);
    // The crown's own middle, seen from straight above (an acacia's stands
    // off to one side of its trunk).
    const masses = canopyOf(prop);
    let mx = 0, area = 0, widest = 0;
    for (let i = 0; i < masses.length; i += 4) {
      mx += masses[i] / ASPECT * masses[i + 2] ** 2;
      area += masses[i + 2] ** 2;
      widest = Math.max(widest, masses[i + 2] / ASPECT);
    }
    assert.ok(c.x > mx / area + 0.5, `${species} leans right (${c.x} from ${mx / area})`);
    assert.ok(c.y >= -1, `${species} does not lean up (${c.y})`);
    // Darkest under the crown: within its widest mass's half width of the trunk.
    const darkest = list.reduce((a, b) => (b.v > a.v ? b : a));
    assert.ok(Math.abs(darkest.dx) <= widest, `${species} darkest under the crown`);
  }
});

test('a footprint is lobed, not round', () => {
  for (const species of TREE_SPECIES) {
    const stamp = canopyStamp(tree(species), 3);
    const list = cells(stamp);
    const c = centroid(list);
    const at = (dx, dy) => {
      const x = dx - stamp.x0, y = dy - stamp.y0;
      if (x < 0 || y < 0 || x >= stamp.w || y >= stamp.h) return 0;
      return stamp.layers[y * stamp.w + x] / LAYER_UNIT;
    };
    // The outline's radius at 32 angles, in a plan with the tilt undone.
    const radii = [];
    for (let k = 0; k < 32; k++) {
      const a = k / 32 * Math.PI * 2;
      let r = 0;
      while (r < 200 && at(Math.floor(c.x + Math.cos(a) * r / ASPECT), Math.floor(c.y + Math.sin(a) * r * TILT)) >= 0.1) r += 0.25;
      radii.push(r);
    }
    const mean = radii.reduce((a, b) => a + b) / radii.length;
    const sd = Math.sqrt(radii.reduce((a, b) => a + (b - mean) ** 2, 0) / radii.length);
    assert.ok(sd / mean > 0.08, `${species} outline varies (${(sd / mean).toFixed(3)})`);
  }
});

test('felled, burning and bare winter trees cast less shadow', () => {
  const oak = tree('oak');
  assert.equal(stampStrength(oak), 1);
  assert.equal(stampStrength({ ...oak, chopped: true }), 0);
  assert.equal(stampStrength({ ...oak, burnt: true }), 0);
  assert.equal(stampStrength(tree('oak', { season: 'winter' })), 0.35);
  assert.equal(stampStrength(tree('spruce', { season: 'winter' })), 1, 'an evergreen keeps its needles');
  assert.equal(stampStrength(tree('pine', { season: 'winter' })), 1);
  const early = stampStrength({ ...oak, burning: { progress: 0.2 } });
  const late = stampStrength({ ...oak, burning: { progress: 0.9 } });
  assert.ok(early < 1 && late < early && late > 0);
  // A scenery-builder tree keeps its leaves all year.
  assert.equal(stampStrength({ ...createProp('tree', 0.5, 0.5), season: 'winter' }), 1);
});

test('a builder tree\'s canopy scales with it and its footprint stays inside the reach', () => {
  const small = createProp('tree', 10.5, 20.5, { seed: 4 });
  const big = createProp('tree', 10.5, 20.5, { seed: 4, scale: 2 });
  const a = canopyOf(small), b = canopyOf(big);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(b[i] - a[i] * 2) < 1e-4, `mass value ${i}`);
  for (let seed = 1; seed <= 6; seed++) {
    const prop = createProp('tree', 10.5, 20.5, { seed, scale: 3 });
    const stamp = canopyStamp(prop, 1);
    assert.ok(stamp.x0 >= -MAX_TREE_HALF_WIDTH && stamp.x0 + stamp.w - 1 <= MAX_TREE_HALF_WIDTH);
    assert.equal(stamp.layers.length, stamp.w * stamp.h);
  }
});

test('a crown too wide for the reach is clipped and fades out before the edge', () => {
  // One leaf mass 100 cells wide either side of the trunk.
  const prop = withCanopy({ kind: 'tree', x: 0.5, y: 0.5 }, Float32Array.from([0, 20, 100 * ASPECT, 10]));
  const stamp = canopyStamp(prop, 1);
  assert.equal(stamp.x0, -MAX_TREE_HALF_WIDTH);
  assert.equal(stamp.x0 + stamp.w - 1, MAX_TREE_HALF_WIDTH);
  const column = (dx) => {
    let most = 0;
    for (let y = 0; y < stamp.h; y++) most = Math.max(most, stamp.layers[y * stamp.w + dx - stamp.x0]);
    return most;
  };
  assert.equal(column(MAX_TREE_HALF_WIDTH), 0);
  assert.equal(column(-MAX_TREE_HALF_WIDTH), 0);
  assert.ok(column(MAX_TREE_HALF_WIDTH - 1) < column(MAX_TREE_HALF_WIDTH - CLIP_FADE));
  assert.ok(column(0) > 0);
});

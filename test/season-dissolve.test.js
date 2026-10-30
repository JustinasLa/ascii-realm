import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { stampStrength } from '../src/world/canopy.js';
import { bakeFine, fineOf, rebakeHere } from '../src/world/fine-bakes.js';
import { drawLeaves } from '../src/world/leaves.js';
import { turnOf } from '../src/world/prop-art.js';
import { bakeWhole, drawProp } from '../src/world/props.js';
import { Seasons } from '../src/world/season-turn.js';
import { makeTree } from '../src/world/trees.js';

// The same oak in two seasons: the same draws give the same tree.
const VIEW = { x0: 0, y0: 0, cols: 90, rows: 120 };
const oak = (season, fine = true) => {
  const prop = makeTree(45.5, 110.5, mulberry32(9), { species: 'oak', season, seed: 42 });
  if (fine) {
    fineOf(prop);
    bakeFine();
  }
  return prop;
};
const world = { season: 'summer', measureProp() {} };

// An oak turning from summer to winter in view, stopped at `k`.
function turning(k, fine = true) {
  rebakeHere(bakeWhole);
  try {
    const prop = oak('summer', fine);
    const seasons = new Seasons(world);
    seasons.update([prop], 55, 23999, 0, { visible: () => true });
    const turn = turnOf(prop);
    assert.ok(turn, 'it dissolves');
    turn.k = k;
    return prop;
  } finally {
    rebakeHere(null);
  }
}

// Everything a drawing leaves: its small letters and the ordinary grid, on
// ground of one colour so a shadow shows.
function draw(prop, write) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(VIEW.cols, VIEW.rows);
  r.fg.fill(100);
  r.ov.fill(100);
  r.bg.fill(100);
  const fine = [];
  const fineAt = r.fineAt;
  r.fineAt = function (fx, fy, g, ...rest) {
    fine.push(`${fx},${fy},${g}`);
    return fineAt.call(this, fx, fy, g, ...rest);
  };
  drawProp(r, VIEW, prop, write, 0, null, 42);
  return { fine, fg: [...r.fg], ov: [...r.ov], bg: [...r.bg] };
}

test('a turning tree shows its old look at k = 0 and its new one at k = 1, one shadow throughout', () => {
  const summer = draw(oak('summer'));
  const winter = draw(oak('winter'));
  assert.notDeepEqual(summer.fine, winter.fine);
  assert.deepEqual(draw(turning(0)), summer);
  assert.deepEqual(draw(turning(1)), winter);
});

test('half way, each small cell comes from one look or the other, and the ground is shaded once', () => {
  const summer = draw(oak('summer'));
  const winter = draw(oak('winter'));
  const half = draw(turning(0.5));
  const old = new Set(summer.fine), next = new Set(winter.fine);
  assert.ok(half.fine.every((cell) => old.has(cell) || next.has(cell)));
  const only = (a, b) => half.fine.filter((cell) => a.has(cell) && !b.has(cell)).length;
  assert.ok(only(old, next) > 100 && only(next, old) > 100, 'both looks show');
  // Where neither look puts a ground cell, the contact shadow darkens the
  // ground exactly as much as the old tree's does.
  let shaded = 0;
  for (let i = 0; i < summer.bg.length; i += 4) {
    if (summer.bg[i] === 100 || summer.bg[i] !== winter.bg[i] || summer.fg[i] !== winter.fg[i]) continue;
    assert.equal(half.bg[i], summer.bg[i]);
    shaded++;
  }
  assert.ok(shaded > 20, `${shaded} cells`);
});

test('a tree turning in ordinary cells and in the water dissolves the same way', () => {
  const cells = (prop, reflected = false) => {
    const out = [];
    const write = (_r, x, y, g) => out.push(`${x},${y},${g}`);
    drawProp(null, VIEW, prop, write, 0, null, 42, reflected);
    return out;
  };
  const summer = oak('summer', false), winter = oak('winter', false);
  for (const reflected of [false, true]) {
    assert.deepEqual(cells(turning(0, false), reflected), cells(summer, reflected));
    assert.deepEqual(cells(turning(1, false), reflected), cells(winter, reflected));
    const old = new Set(cells(summer, reflected)), next = new Set(cells(winter, reflected));
    const half = cells(turning(0.5, false), reflected);
    assert.ok(half.every((cell) => old.has(cell) || next.has(cell)));
    // (In the water only the trunk shows, the same in both.)
    if (!reflected) assert.ok(half.some((cell) => !old.has(cell)) && half.some((cell) => !next.has(cell)));
  }
  // Drawn coarse, it is not baked small until its turn is done.
  const coarse = turning(0.5, false);
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(VIEW.cols, VIEW.rows);
  drawProp(r, VIEW, coarse, undefined, 0, null, 42);
  assert.equal(r.fineUsed, false);
});

test('a bare crown\'s shadow thins over the turn', () => {
  const prop = turning(0);
  assert.equal(stampStrength(prop), 1);
  turnOf(prop).k = 0.5;
  assert.equal(stampStrength(prop), 0.675);
  turnOf(prop).k = 1;
  assert.equal(stampStrength(prop), 0.35);
  assert.equal(stampStrength(oak('winter', false)), 0.35);
});

test('leaves already falling keep the season and crown they were born from', () => {
  const leaves = (prop, t) => {
    const out = [];
    drawLeaves({ put: (...cell) => out.push(cell.join()) }, VIEW, prop, t, 42);
    return out;
  };
  const autumn = makeTree(45.5, 110.5, mulberry32(9), { species: 'oak', season: 'autumn', seed: 42 });
  const prop = turning(0);
  const turn = turnOf(prop);
  turn.from = 'autumn';
  turn.cells = autumn.cells;
  turn.leafColor = autumn.leafColor;
  let seen = 0;
  for (let t = 20; t < 60; t += 0.5) {
    turn.at = t;
    const born = leaves(prop, t);
    assert.deepEqual(born, leaves(autumn, t), 'all born before the turn');
    seen += born.length;
    turn.at = t - 20;
    assert.deepEqual(leaves(prop, t), [], 'a bare crown drops none');
  }
  assert.ok(seen > 0);
});

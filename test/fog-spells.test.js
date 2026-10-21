import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MISSILE_SIZE, ROWS_PER_METRE, SpellFogStirs } from '../src/world/fog-spells.js';
import { FogWake } from '../src/world/fog-wake.js';

const still = { driftX: 0, driftY: 0, time: 0, coverage: 1 };
const even = () => new FogWake({ banks: () => 0.6 });
// A field centred on a player standing at (100, 50); spells go off nearby.
const run = (wake, frames, spells, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) wake.update(dt, [{ id: 'self', x: 100, y: 50 }], still, spells(i));
};

test('a spell going off throws the fog outward without losing any', () => {
  const wake = even();
  run(wake, 1, () => ({}));
  const before = wake.total();
  run(wake, 40, (i) => (i === 0 ? { bursts: [{ x: 100, y: 30, radius: 12, strength: 1 }] } : {}));
  assert.ok(Math.abs(wake.total() - before) < before * 0.005, `${before} -> ${wake.total()}`);
  assert.ok(wake.fogAt(60, 30) < 0.35, 'the middle of the burst is thinned');
  assert.ok(Math.max(...wake.fog) > 0.9, 'the fog it threw piled up around it');
  // It settles back.
  run(wake, 600, () => ({}), 0.1);
  for (let d = -16; d <= 16; d += 4) assert.ok(Math.abs(wake.fogAt(60 + d, 30) - 0.6) < 0.03);
});

test('a lasting zone turns the fog around itself', () => {
  for (const spin of [1, -1]) {
    const wake = even();
    run(wake, 30, () => ({ whirls: [{ x: 100, y: 30, radius: 12, spin, strength: 1 }] }));
    // Air to the right of the middle moves down the screen for a clockwise
    // turn and up for an anticlockwise one.
    const n = wake.cells;
    const i = Math.floor((60 + 8 - wake.ox) / 2);
    const j = Math.floor((30 - wake.oy) / 2);
    assert.equal(Math.sign(wake.vy[j * n + i]), spin);
  }
});

test('bad or oversized spell input is ignored or held in bounds', () => {
  const wake = even();
  run(wake, 5, () => ({ bursts: [{ x: NaN, y: 0 }, { x: 100, y: 30, radius: 1e6, strength: 50 }, null],
    whirls: [{ x: 100, y: 30, radius: -3 }, { x: 100, y: 30, radius: 8, spin: Infinity }] }));
  assert.ok(wake.texels.every((v) => Number.isFinite(v) && v >= 0));
  assert.ok(wake.vx.every((v, c) => Math.hypot(v, wake.vy[c]) <= 60.001));
});

test('spells are read once per burst, while they fly and while zones last', () => {
  const stirs = new SpellFogStirs();
  const missile = { x: 10, y: 20 };
  const impact = { x: 5, y: 5, stage: 'impact', radius: 1 };
  const aura = { x: 7, y: 7, stage: 'aura', radius: 1 };
  const glow = { x: 7, y: 7, stage: 'projectile', radius: 1 };
  const zone = { x: 3, y: 4, radius: 2 };
  const casting = { projectiles: [missile], effects: { list: [impact, aura, glow] }, zones: [zone] };
  const first = stirs.collect(casting);
  assert.deepEqual(first.walkers, [{ id: missile, x: 10, y: 20, size: MISSILE_SIZE, lift: 0 }]);
  assert.equal(first.bursts.length, 1);
  assert.equal(first.bursts[0].radius, ROWS_PER_METRE);
  assert.equal(first.whirls.length, 2);
  const again = stirs.collect(casting);
  assert.equal(again.bursts.length, 0, 'an impact throws the fog only once');
  assert.equal(again.whirls.length, 2);
  assert.deepEqual(again.whirls.map((w) => w.spin), first.whirls.map((w) => w.spin));
  assert.deepEqual(stirs.collect(null), { walkers: [], bursts: [], whirls: [] });
  const many = { projectiles: Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0 })) };
  assert.equal(stirs.collect(many).walkers.length, 8);
});

test('a spell in flight cuts a channel narrower than a walker would', () => {
  const thinned = (size) => {
    const wake = even();
    run(wake, 1, () => ({}));
    const before = wake.total();
    let x = 80;
    for (let i = 0; i < 20; i++) {
      x += 3;
      wake.update(1 / 60, [{ id: 'self', x: 100, y: 50 }, { id: 'bolt', x, y: 20, size, lift: 0 }], still);
    }
    assert.ok(Math.abs(wake.total() - before) < before * 0.005);
    let cells = 0;
    for (const v of wake.fog) if (v < 0.4) cells++;
    return cells;
  };
  const missile = thinned(MISSILE_SIZE);
  assert.ok(missile > 0 && missile < thinned(1) * 0.7, `missile ${missile}, walker ${thinned(1)}`);
});

test('a fast spell clears its whole path, not just where each frame lands', () => {
  const wake = even();
  run(wake, 1, () => ({}));
  // 15 cells (9 rows) a frame, about a fire shard's pace.
  let x = 60;
  for (let i = 0; i < 6; i++) {
    x += 15;
    wake.update(1 / 60, [{ id: 'self', x: 100, y: 50 }, { id: 'bolt', x, y: 20, size: MISSILE_SIZE, lift: 0 }], still);
  }
  // Give the shoved air a moment to carry the fog aside.
  run(wake, 15, () => ({}));
  for (let gx = 75 * 0.6 + 4; gx < x * 0.6 - 4; gx += 1) {
    assert.ok(wake.fogAt(gx, 20) < 0.5, `gap in the channel at ${gx}: ${wake.fogAt(gx, 20)}`);
  }
});

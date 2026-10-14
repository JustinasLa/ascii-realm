import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPlayPosition } from '../src/editor/recovery.js';

test('recovery preserves an existing safe position without changing state', () => {
  const player = Object.freeze({ x: -3.25, y: 7.75, vx: 5 });
  const camera = Object.freeze({ x: 10, y: 20 });
  const samples = [];
  const world = Object.freeze({
    spawn: Object.freeze({ x: 100, y: 100 }),
    isWalkable: (x, y) => { samples.push([x, y]); return true; },
  });
  assert.deepEqual(findPlayPosition(world, player, camera), { x: -3.25, y: 7.75 });
  assert.deepEqual(samples, [[-3.25, 7.75], [-4.45, 7.75], [-2.05, 7.75]]);
  assert.equal(player.vx, 5);
});

test('a safe center with blocked lateral samples is not a playable position', () => {
  const world = { isWalkable: (x, y) => x === 0.5 && y === 0.5 };
  assert.equal(findPlayPosition(world, { x: 0.5, y: 0.5 }), null);
});

test('recovery picks the nearest safe cell using the whole player footprint', () => {
  const world = {
    // Only this patch fits the player, and a farther patch is also safe.
    isWalkable: (x, y) => y === 0.5 && ((x >= 2.3 && x <= 4.7) || (x >= 10 && x <= 15)),
  };
  assert.deepEqual(findPlayPosition(world, { x: 0.5, y: 0.5 }), { x: 3.5, y: 0.5 });
});

test('an entirely blocked world returns null after a bounded search', () => {
  let checks = 0;
  const world = {
    spawn: { x: 1000.5, y: 1000.5 },
    isWalkable: () => { checks++; return false; },
  };
  assert.equal(findPlayPosition(world, { x: 0.5, y: 0.5 }, { x: 500.5, y: 500.5 }), null);
  assert.ok(checks < 25000, `search must remain bounded, checked ${checks} positions`);
});

test('recovery searches around the camera when no local player position is safe', () => {
  const world = { isWalkable: (x, y) => y === 100.5 && x >= 99 && x <= 102 };
  assert.deepEqual(findPlayPosition(world, { x: 0.5, y: 0.5 }, { x: 100.5, y: 100.5 }),
    { x: 100.5, y: 100.5 });
});

test('recovery falls back to a safe spawn after both local searches fail', () => {
  const world = {
    spawn: { x: -500.25, y: -500.75 },
    isWalkable: (x, y) => y === -500.75 && x >= -502 && x <= -498,
  };
  assert.deepEqual(findPlayPosition(world, { x: 0.5, y: 0.5 }, { x: 100.5, y: 100.5 }),
    { x: -500.25, y: -500.75 });
});

test('invalid or imprecise origins cannot make the bounded search stall', () => {
  let checks = 0;
  const world = { isWalkable: () => { checks++; return false; } };
  assert.equal(findPlayPosition(world, { x: 1e20, y: 0 }, { x: NaN, y: Infinity }), null);
  assert.equal(checks, 0);
});

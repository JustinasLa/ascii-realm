import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { buildRig, project } from '../src/entities/rig.js';
import { ASPECT, GRASS } from '../src/world/world.js';

// An endless open meadow.
const meadow = { isWalkable: () => true, typeAt: () => GRASS };

// Walks the player in one direction and measures how far whichever foot is
// planted slides across the ground, against how far the body travels. A
// moonwalk scores above 1; a perfect walk scores 0.
function slide(move, running) {
  const p = new Player(0, 0);
  const dt = 1 / 60;
  let drift = 0;
  let prev = null;
  for (let i = 0; i < 60; i++) p.update(dt, meadow, move, running);
  const x0 = p.x;
  const y0 = p.y;
  for (let i = 0; i < 240; i++) {
    p.update(dt, meadow, move, running);
    const rig = buildRig(p);
    const feet = rig.legs.map((l) => {
      const a = project(l.ankle);
      return { x: p.x * ASPECT + a[0], y: p.y + a[1], h: l.ankle[1] };
    });
    const k = feet[0].h < feet[1].h ? 0 : 1;
    if (prev && prev.k === k) drift += Math.hypot(feet[k].x - prev.x, feet[k].y - prev.y);
    prev = { k, x: feet[k].x, y: feet[k].y };
  }
  const travel = Math.hypot((p.x - x0) * ASPECT, p.y - y0);
  return drift / travel;
}

test('planted feet barely slide when walking sideways', () => {
  assert.ok(slide({ x: 1, y: 0 }, false) < 0.35);
});

test('planted feet barely slide when walking towards the camera', () => {
  assert.ok(slide({ x: 0, y: 1 }, false) < 0.5);
});

test('running feet slide far less than a moonwalk', () => {
  assert.ok(slide({ x: -1, y: 0 }, true) < 0.6);
});

test('legs stop striding when the way is blocked', () => {
  const p = new Player(0, 0);
  const wall = { isWalkable: () => false, typeAt: () => GRASS };
  for (let i = 0; i < 120; i++) p.update(1 / 60, wall, { x: 1, y: 0 }, false);
  assert.ok(p.walk < 0.05, `walk ${p.walk}`);
});

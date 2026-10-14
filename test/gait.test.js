import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { buildRig, project } from '../src/entities/rig.js';
import { ASPECT, GRASS } from '../src/world/world.js';

// An endless open meadow.
const meadow = { isWalkable: () => true, typeAt: () => GRASS };

// Walks the player in one direction and measures how far the points the
// feet are standing on slide across the ground, against how far the body
// travels. A moonwalk scores above 1; a perfect walk scores 0.
//
// `move` and `running` may also be functions of the frame number, to steer.
function slide(move, running) {
  const at = (v, i) => (typeof v === 'function' ? v(i) : v);
  const p = new Player(0, 0);
  const dt = 1 / 60;
  let drift = 0;
  let prev = [null, null];
  for (let i = 0; i < 60; i++) p.update(dt, meadow, at(move, i), at(running, i));
  let travel = 0;
  for (let i = 0; i < 240; i++) {
    const ox = p.x;
    const oy = p.y;
    p.update(dt, meadow, at(move, i), at(running, i));
    travel += Math.hypot((p.x - ox) * ASPECT, p.y - oy);
    const rig = buildRig(p);
    rig.legs.forEach((l, k) => {
      if (!l.contact) {
        prev[k] = null;
        return;
      }
      const c = project(l.contact);
      const now = { x: p.x * ASPECT + c[0], y: p.y + c[1] };
      if (prev[k]) drift += Math.hypot(now.x - prev[k].x, now.y - prev[k].y);
      prev[k] = now;
    });
  }
  return drift / travel;
}

test('planted feet barely slide when walking sideways', () => {
  assert.ok(slide({ x: 1, y: 0 }, false) < 0.05);
});

test('planted feet barely slide when walking towards the camera', () => {
  assert.ok(slide({ x: 0, y: 1 }, false) < 0.05);
});

test('planted feet barely slide when sprinting', () => {
  assert.ok(slide({ x: -1, y: 0 }, true) < 0.05);
});

test('planted feet stay put while turning in circles', () => {
  assert.ok(slide((i) => ({ x: Math.cos(i / 40), y: Math.sin(i / 40) }), false) < 0.02);
  assert.ok(slide((i) => ({ x: Math.cos(i / 40), y: Math.sin(i / 40) }), true) < 0.02);
});

test('planted feet stay put through sharp zigzags', () => {
  assert.ok(slide((i) => ({ x: (i / 30) % 2 < 1 ? 1 : -1, y: 1 }), false) < 0.02);
});

test('planted feet stay put breaking into a sprint and stopping', () => {
  assert.ok(slide({ x: 1, y: 0 }, (i) => i > 90) < 0.02);
  assert.ok(slide((i) => ((i / 50) % 2 < 1 ? { x: 1, y: 0 } : { x: 0, y: 0 }), false) < 0.02);
});

test('legs stop striding when the way is blocked', () => {
  const p = new Player(0, 0);
  const wall = { isWalkable: () => false, typeAt: () => GRASS };
  for (let i = 0; i < 120; i++) p.update(1 / 60, wall, { x: 1, y: 0 }, false);
  assert.ok(p.walk < 0.05, `walk ${p.walk}`);
});

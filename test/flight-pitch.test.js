import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Projectiles } from '../src/world/projectiles.js';
import { Torches } from '../src/world/torch.js';

// A renderer that keeps the rows it was asked to draw on.
const rowsDrawn = () => {
  const rows = [];
  return { rows, put: (_x, y) => rows.push(y) };
};
const view = { x0: -50, y0: -50, cols: 200, rows: 200 };

test('things in flight are drawn at the pitch\'s height, landed ones where they lie', () => {
  const shot = () => {
    const p = new Projectiles();
    p.list.push({ x: 10, y: 20, h: 12, length: 0, color: [1, 1, 1], kind: 'arrow', orientation: { x: 1, y: 0 },
      trail: [{ x: 9, y: 20, h: 12 }] });
    p.landed.push({ x: 3, y: 4, h: 8, length: 0, color: [1, 1, 1], kind: 'arrow', orientation: { x: 1, y: 0 } });
    return p;
  };
  const drawn = (scale) => {
    const p = shot();
    p.heightScale = scale;
    const flying = rowsDrawn();
    const landed = rowsDrawn();
    p.drawFlying(flying, view);
    p.drawLanded(landed, view);
    return { flying: flying.rows, landed: landed.rows, h: p.list[0].h };
  };
  const usual = drawn(1);
  assert.deepEqual(usual.flying, [20 - 12 + 50, 20 - 12 + 50]);
  const low = drawn(0.5);
  assert.deepEqual(low.flying, [20 - 6 + 50, 20 - 6 + 50], 'trail and head at half the height');
  assert.deepEqual(low.landed, usual.landed, 'stuck where it struck');
  assert.equal(low.h, 12, 'the flight keeps its own height');
});

test('a thrown torch is drawn at the pitch\'s height, the one in hand as posed', () => {
  const lift = (scale) => {
    const torches = new Torches();
    torches.heightScale = scale;
    const player = new Player(0, 0);
    player.torch = true;
    torches.throw(player, { x: 0, y: 0, h: 12 });
    player.torch = true;
    const pose = { x: 0, y: 0, h: 10 };
    const [held, thrown] = torches.prepare(view, 1, player, pose);
    return { held: held.flameH, thrown: thrown.flameH, h: torches.list[0].h };
  };
  const usual = lift(1);
  const low = lift(0.5);
  assert.equal(low.held, usual.held);
  assert.equal(low.thrown, usual.thrown - 6);
  assert.equal(low.h, 12);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { glyph } from '../src/render/glyphs.js';
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

test('a shaft in flight points along the path the pitch draws, a landed one as it lay', () => {
  // Rising 6 rows a second and coming 4 nearer: at the usual pitch it climbs
  // the screen, at half the height it is drawn sinking down it.
  const glyphs = (scale) => {
    const p = new Projectiles();
    p.heightScale = scale;
    const arrow = () => ({ x: 10, y: 20, h: 12, vx: 0.1, vy: 4, vh: 6, length: 1, color: [1, 1, 1], kind: 'arrow',
      trail: [] });
    p.list.push(arrow());
    const lying = arrow();
    p.list.push(lying);
    p.impact(lying);
    p.list.pop();
    const drawn = () => {
      const out = [];
      return { out, put: (_x, _y, g) => out.push(g) };
    };
    const flying = drawn();
    const landed = drawn();
    p.drawFlying(flying, view);
    p.drawLanded(landed, view);
    return { flying: flying.out, landed: landed.out };
  };
  const usual = glyphs(1);
  const low = glyphs(0.5);
  assert.equal(usual.flying.at(-1), glyph('^'));
  assert.equal(low.flying.at(-1), glyph('v'), 'the head follows the drawn path down');
  assert.deepEqual(low.landed, usual.landed, 'landed as it struck');
  assert.equal(low.landed.at(-1), glyph('^'));
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

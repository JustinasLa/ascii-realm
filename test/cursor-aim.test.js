import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { GRASS } from '../src/world/world.js';

const meadow = { isWalkable: () => true, typeAt: () => GRASS };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function steps(p, seconds, move = { x: 0, y: 0 }) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    p.update(1 / 60, meadow, move, false);
    p.events.length = 0;
  }
}

test('an aimed swing turns the body to the cursor before the blade lands', () => {
  const p = new Player(0, 0);
  p.combat.inHand = true;
  const aim = Math.PI / 2;
  assert.ok(p.attack(aim));
  let strike = null;
  for (let i = 0; i < 60 && !strike; i++) {
    p.update(1 / 60, meadow, { x: 0, y: 0 }, false);
    strike = p.events.find((e) => e.type === 'strike');
    p.events.length = 0;
  }
  assert.ok(strike, 'the swing landed');
  assert.ok(Math.abs(wrap(p.heading - aim)) < 0.2, `heading ${p.heading}`);
  assert.ok(strike.x > p.x, 'the cut lands on the cursor side');
});

test('an aimed swing holds its heading against the keys until it is over', () => {
  const p = new Player(0, 0);
  p.combat.inHand = true;
  p.attack(-Math.PI / 2);
  steps(p, 0.2, { x: 1, y: 0 });
  assert.ok(Math.abs(wrap(p.heading + Math.PI / 2)) < 0.2, `held ${p.heading}`);
  steps(p, 1.2, { x: 1, y: 0 });
  assert.equal(p.facing, null);
  assert.ok(Math.abs(wrap(p.heading - Math.PI / 2)) < 0.3, `walking again ${p.heading}`);
});

test('an unaimed swing keeps the heading the body already had', () => {
  const p = new Player(0, 0);
  p.combat.inHand = true;
  p.heading = 1;
  p.attack();
  steps(p, 0.3);
  assert.equal(p.facing, null);
  assert.ok(Math.abs(wrap(p.heading - 1)) < 1e-9);
});

test('a spell faces its aim for a moment, then lets go', () => {
  const p = new Player(0, 0);
  p.face(Math.PI, 0.35);
  steps(p, 0.2);
  assert.ok(Math.abs(wrap(p.heading - Math.PI)) < 0.05);
  steps(p, 0.3);
  assert.equal(p.facing, null);
  p.face(NaN);
  assert.equal(p.facing, null);
});

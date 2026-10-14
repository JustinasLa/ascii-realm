import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { GRASS } from '../src/world/world.js';

const meadow = { isWalkable: () => true, typeAt: () => GRASS };
const still = { x: 0, y: 0 };

// Runs the player for `seconds`, collecting every event it emits.
function run(player, seconds) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 120) {
    player.update(1 / 120, meadow, still, false);
    events.push(...player.events.splice(0));
  }
  return events;
}

test('one attack draws first, then strikes once a stride ahead when the blade cuts', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const player = new Player(10, 10);
  player.attack();
  const events = run(player, 2.5);
  const strikes = events.filter((e) => e.type === 'strike');
  assert.equal(strikes.length, 1);
  assert.ok(events.findIndex((e) => e.type === 'draw') < events.findIndex((e) => e.type === 'strike'));
  const reach = Math.hypot((strikes[0].x - 10) * 0.6, strikes[0].y - 10);
  assert.ok(reach > 0.5, 'the strike lands ahead of the body');
});

test('queued combo presses strike once for each cut actually swung', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const player = new Player(0, 0);
  player.combat.inHand = true;
  player.attack();
  const events = [];
  for (let i = 0; i < 360; i++) {
    if (i % 10 === 0) player.attack();
    player.update(1 / 120, meadow, still, false);
    events.push(...player.events.splice(0));
  }
  const swings = events.filter((e) => e.type === 'swing').length;
  assert.ok(swings >= 2);
  assert.equal(events.filter((e) => e.type === 'strike').length, swings);
});

test('drawing and sheathing the sword strike nothing', () => {
  const player = new Player(0, 0);
  player.toggleSword();
  const drawn = run(player, 1);
  player.toggleSword();
  const sheathed = run(player, 1);
  assert.equal([...drawn, ...sheathed].filter((e) => e.type === 'strike').length, 0);
});

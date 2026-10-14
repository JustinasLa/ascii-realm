import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat } from '../src/entities/combat.js';
import { Player } from '../src/entities/player.js';
import { GRASS } from '../src/world/world.js';

const dt = 1 / 120;
const meadow = { isWalkable: () => true, typeAt: () => GRASS };
const still = { x: 0, y: 0 };

function advance(combat, seconds, ctx = {}) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) combat.update(dt, ctx);
}

function until(combat, condition, ctx = {}) {
  for (let i = 0; i < 360 && !condition(); i++) combat.update(dt, ctx);
  assert.ok(condition(), 'combat did not reach the expected state');
}

function swings(combat) {
  return combat.events.filter((event) => event.type === 'swing');
}

function assertSwing(event, move) {
  assert.equal(event.move, move);
  assert.ok(Number.isFinite(event.speed) && event.speed > 0, 'swing speed must be positive and finite');
}

test('drawing and sheathing sound once when the sword changes hands', () => {
  const combat = new Combat();
  combat.toggle();
  assert.equal(combat.inHand, false);
  assert.deepEqual(combat.events, [], 'reaching for the hilt should be silent');

  until(combat, () => combat.inHand);
  assert.deepEqual(combat.events, [{ type: 'draw' }]);
  until(combat, () => !combat.busy);
  assert.deepEqual(combat.events, [{ type: 'draw' }]);

  combat.toggle();
  assert.equal(combat.inHand, true);
  assert.equal(combat.events.length, 1, 'sheathing should wait for the sword transfer');
  until(combat, () => !combat.inHand);
  assert.deepEqual(combat.events.map((event) => event.type), ['draw', 'sheathe']);
  advance(combat, 1);
  assert.deepEqual(combat.events.map((event) => event.type), ['draw', 'sheathe']);
});

test('an idle drawn sword emits one sheathe sound when automatically put away', () => {
  const combat = new Combat();
  combat.inHand = true;
  advance(combat, 6);
  assert.equal(combat.inHand, false);
  assert.deepEqual(combat.events, [{ type: 'sheathe' }]);
  advance(combat, 1);
  assert.equal(combat.events.length, 1);
});

for (const [middle, choice] of [['b', 0], ['d', 0.99]]) {
  test(`a queued a-${middle}-c combo sounds each cut once and preserves the chop impact`, (t) => {
    t.mock.method(Math, 'random', () => choice);
    const combat = new Combat();
    combat.attack();
    until(combat, () => combat.move === 'a');
    assert.deepEqual(combat.events.map((event) => event.type), ['draw']);

    combat.attack();
    until(combat, () => combat.move === middle);
    combat.attack();
    until(combat, () => combat.move === 'c');
    until(combat, () => !combat.busy);
    advance(combat, 0.5);

    assert.deepEqual(swings(combat).map((event) => event.move), ['a', middle, 'c']);
    for (const event of swings(combat)) assertSwing(event, event.move);
    assert.equal(combat.events.filter((event) => event.type === 'draw').length, 1);
    assert.equal(combat.events.filter((event) => event.type === 'slam').length, 1);
    assert.equal(combat.events.at(-1).type, 'slam');
  });
}

test('a swing waits for its cutting motion and does not repeat across cutting frames', () => {
  const combat = new Combat();
  combat.inHand = true;
  combat.attack();
  combat.update(0.05);
  assert.equal(swings(combat).length, 0, 'winding up should be silent');
  until(combat, () => swings(combat).length > 0);
  assertSwing(swings(combat)[0], 'a');
  advance(combat, 0.6);
  assert.equal(swings(combat).length, 1);

  // A fresh attack after the combo window must sound again.
  advance(combat, 0.7);
  combat.attack();
  advance(combat, 0.6);
  assert.equal(swings(combat).length, 2);
  assertSwing(swings(combat)[1], 'a');
});

test('sprinting emits one thrust sound followed by one lunge', () => {
  const combat = new Combat();
  combat.inHand = true;
  combat.attack({ running: true });
  assert.equal(swings(combat).length, 0);
  advance(combat, 0.8, { running: true, moving: true });
  assert.equal(swings(combat).length, 1);
  assertSwing(swings(combat)[0], 'thrust');
  assert.deepEqual(combat.events.map((event) => event.type), ['swing', 'lunge']);
});

test('an airborne attack draws immediately, cuts once, and slams only after landing', () => {
  const combat = new Combat();
  combat.attack({ air: true });
  assert.deepEqual(combat.events, [{ type: 'draw' }]);
  assert.equal(combat.inHand, true);
  advance(combat, 1, { air: true });
  assert.deepEqual(combat.events.map((event) => event.type), ['draw', 'swing']);
  assertSwing(swings(combat)[0], 'plunge');
  advance(combat, 0.6, { air: false });
  assert.deepEqual(combat.events.map((event) => event.type), ['draw', 'swing', 'slam']);

  const drawn = new Combat();
  drawn.inHand = true;
  drawn.attack({ air: true });
  advance(drawn, 0.3, { air: true });
  assert.deepEqual(drawn.events.map((event) => event.type), ['swing']);
});

test('charging is silent and releasing emits one spin cut followed by one whirl', () => {
  const combat = new Combat();
  combat.inHand = true;
  advance(combat, 0.7, { held: true });
  assert.equal(combat.charged, true);
  assert.deepEqual(combat.events, []);
  combat.update(dt, { held: false });
  assert.equal(combat.move, 'spin');
  advance(combat, 0.8);
  assert.deepEqual(combat.events.map((event) => event.type), ['swing', 'whirl']);
  assertSwing(swings(combat)[0], 'spin');
  assert.equal(combat.spin, 0);
});

test('jump sounds at launch, ignores repeated input, and precedes the landing', () => {
  const player = new Player(17, 29);
  player.jump();
  player.jump();
  assert.deepEqual(player.events, []);
  player.updateJump(0.05);
  assert.deepEqual(player.events, [], 'jump wind-up should be silent');
  player.jump();
  player.updateJump(0.06);
  assert.ok(player.air > 0);
  assert.deepEqual(player.events, [{ type: 'jump', x: 17, y: 29, strength: 1 }]);
  player.jump();
  for (let i = 0; i < 120; i++) player.updateJump(dt);
  assert.deepEqual(player.events.map((event) => event.type), ['jump', 'land']);
  assert.equal(player.air, 0);
  assert.equal(player.events[1].x, 17);
  assert.equal(player.events[1].y, 29);
  assert.ok(player.events[1].strength > 0);
});

test('a long jump frame preserves launch before landing event order', () => {
  const player = new Player(-7, 13);
  player.jump();
  player.updateJump(0.7);
  assert.deepEqual(player.events.map((event) => event.type), ['jump', 'land']);
  for (const event of player.events) {
    assert.equal(event.x, -7);
    assert.equal(event.y, 13);
  }
});

test('Player forwards sword audio payloads at the current world position and drains them once', () => {
  const player = new Player(23, -41);
  const payloads = [{ type: 'draw' }, { type: 'swing', move: 'd', speed: 1.2 }, { type: 'sheathe' }];
  player.combat.events.push(...payloads);
  player.update(dt, meadow, still, false);
  assert.deepEqual(player.events, payloads.map((event) => ({ ...event, x: 23, y: -41, strength: 1 })));
  assert.deepEqual(player.combat.events, []);
  player.events.length = 0;
  player.update(dt, meadow, still, false);
  assert.deepEqual(player.events, [], 'forwarded combat sounds should not replay next frame');
});

test('Player forwards an immediate airborne draw even though it happens before update', () => {
  const player = new Player(31, 47);
  player.air = 0.5;
  player.attack();
  player.update(dt, meadow, still, false);
  const draws = player.events.filter((event) => event.type === 'draw');
  assert.deepEqual(draws, [{ type: 'draw', x: 31, y: 47, strength: 1 }]);
  assert.deepEqual(player.combat.events, []);
  player.events.length = 0;
  player.update(dt, meadow, still, false);
  assert.equal(player.events.filter((event) => event.type === 'draw').length, 0);
});

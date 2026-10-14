import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player, TRICKS } from '../src/entities/player.js';
import { GRASS } from '../src/world/world.js';

// An endless open meadow.
const meadow = { isWalkable: () => true, typeAt: () => GRASS };
const dt = 1 / 60;
const still = { x: 0, y: 0 };
const east = { x: 1, y: 0 };

// Moves the player for `seconds`.
function run(p, seconds, move = still, running = false) {
  for (let t = 0; t < seconds; t += dt) p.update(dt, meadow, move, running);
}

// Steps until the player is back on the ground, returning the seconds spent
// off it.
function untilLanded(p, move = still, running = false) {
  let t = 0;
  do {
    p.update(dt, meadow, move, running);
    t += dt;
  } while ((p.windUp >= 0 || p.air > 0) && t < 5);
  return t;
}

test('jumping on the spot again and again goes through a run of different jumps', () => {
  const p = new Player(0, 0);
  run(p, 0.5);
  const kinds = [];
  for (let i = 0; i < 4; i++) {
    p.jump();
    kinds.push(p.jumpKind);
    untilLanded(p);
    run(p, 0.1);
  }
  assert.deepEqual(kinds, ['stand', 'hop', 'spin', 'stand']);
});

test('a pause after landing starts the run of jumps again', () => {
  const p = new Player(0, 0);
  p.jump();
  untilLanded(p);
  run(p, 0.6);
  p.jump();
  assert.equal(p.jumpKind, 'stand');
});

test('walking and running jumps are leaps off one foot', () => {
  const walker = new Player(0, 0);
  run(walker, 1, east);
  walker.jump();
  assert.equal(walker.jumpKind, 'stride');

  const runner = new Player(0, 0);
  run(runner, 1.5, east, true);
  runner.jump();
  assert.equal(runner.jumpKind, 'leap');
});

test('jumping again in the air does the trick for that jump, once, and stays up longer', () => {
  for (const [move, running, kind] of [[still, false, 'stand'], [east, false, 'stride'], [east, true, 'leap']]) {
    const plain = new Player(0, 0);
    run(plain, 1.5, move, running);
    plain.jump();
    const alone = untilLanded(plain, move, running);

    const p = new Player(0, 0);
    run(p, 1.5, move, running);
    p.jump();
    assert.equal(p.jumpKind, kind);
    run(p, 0.2, move, running);
    p.jump();
    assert.equal(p.trick, TRICKS[kind]);
    const vy = p.vy;
    run(p, 0.05, move, running);
    p.jump();
    assert.ok(p.vy < vy, 'a third press does not spring again');
    const total = 0.25 + untilLanded(p, move, running);
    assert.ok(total > alone + 0.15, `${kind}: ${total.toFixed(2)}s in the air against ${alone.toFixed(2)}s`);
    assert.equal(p.trick, null);
    assert.equal(p.lastJump, null, 'a trick does not count towards a run of jumps');
  }
  assert.equal(TRICKS.leap, 'barrel');
});

test('a quick double press while gathering for a running jump becomes a barrel roll', () => {
  const p = new Player(0, 0);
  run(p, 1.5, east, true);
  p.jump();
  run(p, 2 * dt, east, true);
  p.jump();
  assert.equal(p.trick, null, 'still on the ground');
  run(p, 0.3, east, true);
  assert.equal(p.trick, 'barrel');
});

test('a trick ends the run of jumps on the spot', () => {
  const p = new Player(0, 0);
  p.jump();
  run(p, 0.3);
  p.jump();
  untilLanded(p);
  run(p, 0.1);
  p.jump();
  assert.equal(p.jumpKind, 'stand');
});

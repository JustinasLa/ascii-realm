import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat } from '../src/entities/combat.js';

// Runs the combat state for `seconds` in small steps.
function run(cb, seconds, ctx = {}) {
  for (let t = 0; t < seconds; t += 1 / 60) cb.update(1 / 60, ctx);
}

test('the first strike draws the sword, then swings the forehand', () => {
  const cb = new Combat();
  cb.attack();
  assert.equal(cb.move, 'draw');
  run(cb, 0.45);
  assert.ok(cb.inHand);
  assert.equal(cb.move, 'a');
});

test('the combo runs forehand, then backhand or uppercut, then the chop', () => {
  const cb = new Combat();
  cb.inHand = true;
  const seen = [];
  // Each swing is queued during the one before, as a player mashing the
  // button would, and comes out as soon as that one has cut through.
  cb.attack();
  seen.push(cb.move);
  for (let i = 0; i < 2; i++) {
    run(cb, 0.1);
    cb.attack();
    const was = cb.move;
    while (cb.move === was) cb.update(1 / 60, {});
    seen.push(cb.move);
  }
  assert.equal(seen[0], 'a');
  assert.ok(['b', 'd'].includes(seen[1]), seen[1]);
  assert.equal(seen[2], 'c');
});

test('a strike while sprinting is a lunging thrust', () => {
  const cb = new Combat();
  cb.inHand = true;
  cb.attack({ running: true });
  assert.equal(cb.move, 'thrust');
  run(cb, 0.3, { running: true, moving: true });
  assert.ok(cb.events.some((e) => e.type === 'lunge'));
});

test('a strike in the air plunges and slams only on landing', () => {
  const cb = new Combat();
  cb.attack({ air: true });
  assert.equal(cb.move, 'plunge');
  run(cb, 1, { air: true });
  assert.ok(!cb.events.some((e) => e.type === 'slam'), 'slammed before landing');
  run(cb, 0.2, {});
  assert.ok(cb.events.some((e) => e.type === 'slam'));
});

test('holding the button charges a spin that fires on release', () => {
  const cb = new Combat();
  cb.inHand = true;
  run(cb, 0.3, { held: true });
  assert.ok(!cb.charged);
  run(cb, 0.4, { held: true });
  assert.ok(cb.charged);
  cb.update(1 / 60, {});
  assert.equal(cb.move, 'spin');
  run(cb, 0.5, {});
  assert.ok(cb.events.some((e) => e.type === 'whirl'));
  assert.equal(cb.spin, 0);
});

test('an attack while drawing manually chooses a thrust when sprinting', () => {
  const cb = new Combat();
  cb.toggle();
  cb.attack({ running: true });
  run(cb, 0.45, { moving: true, running: true });
  assert.equal(cb.move, 'thrust');
});

test('jumping with attack held pauses charging until an actual release', () => {
  const cb = new Combat();
  cb.inHand = true;
  cb.update(0.6, { held: true });
  const charge = cb.charge;
  cb.update(0.2, { held: true, air: true });
  assert.equal(cb.move, null);
  assert.equal(cb.charge, charge);
  cb.update(1 / 60, { air: true });
  assert.equal(cb.move, 'spin');
});

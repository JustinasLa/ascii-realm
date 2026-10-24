import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat, SHEATHE_AFTER } from '../src/entities/combat.js';

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

test('a swing reports winding up, cutting and recovering in turn', () => {
  const cb = new Combat();
  cb.inHand = true;
  assert.equal(cb.swingStage, null);
  cb.attack();
  assert.deepEqual(cb.swingStage, { part: 'wind', u: 0, windUp: true });
  const parts = [];
  for (let i = 0; i < 40 && cb.move; i++) {
    const stage = cb.swingStage;
    if (parts.at(-1) !== stage.part) parts.push(stage.part);
    assert.ok(stage.u >= 0 && stage.u <= 1);
    cb.update(1 / 60, {});
  }
  assert.deepEqual(parts, ['wind', 'cut', 'recover']);
});

test('a backhand cuts straight away, and a plunge holds its cut until landing', () => {
  const cb = new Combat();
  cb.inHand = true;
  cb.start('b');
  assert.deepEqual(cb.swingStage, { part: 'cut', u: 0, windUp: false });
  cb.start('plunge');
  run(cb, 0.5, { air: true });
  assert.equal(cb.swingStage.part, 'cut');
  assert.equal(cb.swingStage.u, 0);
  run(cb, 0.1, {});
  assert.equal(cb.swingStage.part, 'recover');
});

test('the sword is put away after a quiet spell standing, but not while moving', () => {
  const cb = new Combat();
  cb.attack();
  run(cb, 1.2);
  assert.ok(cb.inHand);
  run(cb, SHEATHE_AFTER + 0.1, { moving: true });
  assert.ok(cb.inHand, 'walking keeps the sword out');
  assert.notEqual(cb.move, 'sheathe');
  // Standing still after that long, it goes away at once.
  cb.update(1 / 60, {});
  assert.equal(cb.move, 'sheathe');
  run(cb, 1.5);
  assert.equal(cb.inHand, false);
  cb.attack();
  assert.equal(cb.move, 'draw', 'the next strike draws it again');
});

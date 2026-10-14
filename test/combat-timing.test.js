import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat } from '../src/entities/combat.js';

function run(cb, seconds, dt) {
  for (let left = seconds; left > 1e-12;) {
    const step = Math.min(left, dt);
    cb.update(step);
    left -= step;
  }
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('forehand finishes on time at both coarse and fine frame rates', () => {
  for (const dt of [0.1, 1 / 30, 1 / 120]) {
    const cb = new Combat();
    cb.inHand = true;
    cb.attack();
    run(cb, 0.49, dt);
    assert.equal(cb.move, null, `still attacking with dt=${dt}`);
    close(cb.calm, 0.01);
  }
});

test('time left after drawing advances the queued attack and its pose', () => {
  const coarse = new Combat();
  const fine = new Combat();
  for (const [cb, dt] of [[coarse, 0.1], [fine, 1 / 120]]) {
    cb.attack();
    run(cb, 0.53, dt);
    assert.equal(cb.move, 'a');
    assert.equal(cb.step, 1);
    assert.equal(cb.inHand, true);
    close(cb.t, 0.02);
  }
  coarse.pose.hand.forEach((value, i) => close(value, fine.pose.hand[i]));
});

test('queued chop uses the remaining frame and emits its impact once', () => {
  for (const dt of [0.1, 1 / 120]) {
    const cb = new Combat();
    cb.inHand = true;
    cb.start('b');
    cb.attack();
    run(cb, 0.5, dt);
    assert.equal(cb.move, 'c');
    assert.equal(cb.step, 3);
    close(cb.t, 0.05);
    assert.equal(cb.events.filter((e) => e.type === 'slam').length, 1);
    run(cb, 0.5, dt);
    assert.equal(cb.move, null);
    assert.equal(cb.events.filter((e) => e.type === 'slam').length, 1);
  }
});

test('queuing during recovery does not spend the next frame on the cancelled recovery', () => {
  const cb = new Combat();
  cb.inHand = true;
  cb.start('b');
  run(cb, 0.2, 0.01);
  cb.attack();
  cb.update(0.05);
  assert.equal(cb.move, 'c');
  assert.equal(cb.step, 0);
  close(cb.t, 0.05);
});

test('sheathe completion carries the remaining frame into the idle timer', () => {
  const cb = new Combat();
  cb.inHand = true;
  cb.toggle();
  run(cb, 0.55, 0.1);
  assert.equal(cb.inHand, false);
  assert.equal(cb.move, null);
  close(cb.calm, 0.03);
});

test('repeated sprint attacks preserve the thrust queued during drawing', () => {
  const cb = new Combat();
  cb.attack({ running: true });
  cb.attack({ running: true });
  run(cb, 0.45, 0.1);
  assert.equal(cb.move, 'thrust');
  run(cb, 0.4, 0.1);
  assert.deepEqual(cb.events.map((e) => e.type), ['draw', 'swing', 'lunge']);
  assert.equal(cb.events[1].move, 'thrust');
});

test('an attack while drawing manually chooses a thrust when sprinting', () => {
  const cb = new Combat();
  cb.toggle();
  cb.attack({ running: true });
  run(cb, 0.45, 0.1);
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

test('a coarse airborne plunge sounds once and waits for landing before impact', () => {
  const cb = new Combat();
  cb.attack({ air: true });
  cb.update(0.8, { air: true });
  assert.equal(cb.move, 'plunge');
  assert.equal(cb.step, 1);
  assert.equal(cb.t, 0);
  assert.deepEqual(cb.events.map((e) => e.type), ['draw', 'swing']);
  cb.update(0.09);
  assert.deepEqual(cb.events.map((e) => e.type), ['draw', 'swing']);
  cb.update(0.02);
  assert.deepEqual(cb.events.map((e) => e.type), ['draw', 'swing', 'slam']);
  cb.update(0.5);
  assert.equal(cb.move, null);
  assert.equal(cb.events.length, 3);
});

test('releasing a charged spin consumes the frame and sounds its cut and whirl once', () => {
  const cb = new Combat();
  cb.inHand = true;
  cb.update(0.6, { held: true });
  cb.update(0.7);
  assert.equal(cb.move, null);
  assert.equal(cb.spin, 0);
  assert.deepEqual(cb.events.map((e) => e.type), ['swing', 'whirl']);
  cb.update(0.1);
  assert.equal(cb.events.length, 2);
});

test('coarse combo frames preserve the order and count of sword sounds', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const cb = new Combat();
  cb.attack();
  cb.update(0.4);
  assert.equal(cb.move, 'a');
  cb.attack();
  cb.update(0.3);
  assert.equal(cb.move, 'b');
  cb.attack();
  cb.update(0.8);
  assert.equal(cb.move, null);
  assert.deepEqual(cb.events.map((e) => e.type), ['draw', 'swing', 'swing', 'swing', 'slam']);
  assert.deepEqual(cb.events.filter((e) => e.type === 'swing').map((e) => e.move), ['a', 'b', 'c']);
  cb.toggle();
  cb.update(0.55);
  assert.deepEqual(cb.events.map((e) => e.type), ['draw', 'swing', 'swing', 'swing', 'slam', 'sheathe']);
  cb.update(0.1);
  assert.equal(cb.events.length, 6);
});

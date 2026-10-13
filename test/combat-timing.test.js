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

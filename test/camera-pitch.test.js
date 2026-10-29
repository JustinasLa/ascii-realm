import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCALE, TILT } from '../src/entities/rig.js';
import { BASE_LOOK, Camera, PITCH, pitchLook } from '../src/world/camera.js';
import { LIFT_PER_METRE } from '../src/world/relief.js';

const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

test('the usual pitch, or none, is the camera as it always was', () => {
  for (const deg of [null, undefined, '', 30, '30', 30.4]) assert.equal(pitchLook(deg), BASE_LOOK, String(deg));
  assert.equal(new Camera().look, BASE_LOOK);
  assert.equal(BASE_LOOK.rise, LIFT_PER_METRE);
  assert.equal(BASE_LOOK.rowsPerUnit, SCALE);
  assert.equal(BASE_LOOK.scale, 1);
  assert.ok(Object.isFrozen(BASE_LOOK));
});

test('a pitch is rounded to a whole degree and kept in range; junk is the usual pitch', () => {
  assert.equal(pitchLook(10).deg, PITCH.min);
  assert.equal(pitchLook(90).deg, PITCH.max);
  assert.equal(pitchLook('37').deg, 37);
  assert.equal(pitchLook(36.6).deg, 37);
  assert.equal(pitchLook('abc'), BASE_LOOK);
  assert.equal(pitchLook(Infinity), BASE_LOOK);
  assert.ok(Object.isFrozen(pitchLook(45)));
  assert.equal(pitchLook('45'), pitchLook(60), 'one look a pitch');
});

test('at every pitch ground depth stays put and the 3D image agrees with the lift', () => {
  for (let deg = PITCH.min; deg <= PITCH.max; deg++) {
    const look = pitchLook(deg);
    near(look.sin * look.rowsPerUnit, SCALE * TILT, `${deg}° ground depth`);
    near(look.cos * look.rowsPerUnit, look.rise, `${deg}° height`);
    near(look.up * SCALE, look.rise, `${deg}° up`);
    near(look.scale * LIFT_PER_METRE, look.rise, `${deg}° scale`);
    assert.equal(look.scale === 1, deg === PITCH.base, `${deg}° scale ${look.scale}`);
  }
  near(pitchLook(45).rise, SCALE * TILT, '45° rises as far as it reaches back');
  assert.ok(pitchLook(25).rise > LIFT_PER_METRE && pitchLook(35).rise < LIFT_PER_METRE);
});

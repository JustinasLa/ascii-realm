import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SWORD_SIDE } from '../src/entities/combat.js';
import { Player } from '../src/entities/player.js';
import { buildRig, SCALE, TILT } from '../src/entities/rig.js';
import { ASPECT } from '../src/world/world.js';

const meadow = { isWalkable: () => true };
const still = { x: 0, y: 0 };
const dt = 1 / 60;
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const freeHand = (rig) => rig.arms.find((arm) => arm.s !== SWORD_SIDE).hand;

function groundGap(rig) {
  return Math.min(...rig.legs.flatMap((leg) => [leg.ankle[1] - 0.065, leg.toe[1] - 0.05, leg.knee[1] - 0.07]));
}

function peak(player) {
  assert.equal(player.animatePickup(), true);
  for (let i = 0; i < 15; i++) player.update(dt, meadow, still, false);
  assert.equal(player.pickupPose, 1);
}

// The 3D character plays a full pickup clip; the shape-built stand-in only
// stoops, keeping its feet planted.
test('a pickup stoops, reaches down and returns upright with planted feet', () => {
  const p = new Player(0, 0);
  const standing = buildRig(p);
  const standingHand = freeHand(standing)[1];
  assert.equal(p.animatePickup(), true);
  let head = Infinity;
  let hand = Infinity;
  for (let i = 0; i < 50; i++) {
    p.update(dt, meadow, still, false);
    const rig = buildRig(p);
    head = Math.min(head, rig.head[1]);
    hand = Math.min(hand, freeHand(rig)[1]);
    assert.ok(Math.abs(groundGap(rig)) < 0.05, 'the feet must stay on the ground');
  }
  assert.ok(head < standing.head[1] - 0.05, `head only lowered to ${head}`);
  assert.ok(hand < standingHand - 0.05, `free hand did not reach down: ${hand}`);
  assert.equal(p.pickupPose, 0);
  assert.equal(p.pickupTime, -1);
  assert.ok(buildRig(p).head[1] > standing.head[1] - 0.05, 'the outlaw did not stand back up');
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test('repeated collection during a grab does not restart or pin the crouch', () => {
  const p = new Player(0, 0);
  assert.equal(p.animatePickup(), true);
  let frames = 0;
  while (p.pickupTime >= 0 && frames < 60) {
    const before = p.pickupTime;
    assert.equal(p.animatePickup(), false);
    assert.equal(p.pickupTime, before);
    p.update(dt, meadow, still, false);
    frames++;
  }
  assert.ok(frames < 60, 'collection kept the pose active for more than a second');
  assert.equal(p.pickupPose, 0);
  assert.equal(p.animatePickup(), true, 'a later pickup should be able to start another grab');
});

test('movement cancels the grab immediately without changing travel', () => {
  const p = new Player(0, 0);
  const reference = new Player(0, 0);
  peak(p);
  for (let i = 0; i < 15; i++) reference.update(dt, meadow, still, false);
  const move = { x: 1, y: 1 };
  p.update(dt, meadow, move, true);
  reference.update(dt, meadow, move, true);
  assert.equal(p.pickupPose, 0);
  assert.equal(p.pickupTime, -1);
  assert.equal(p.x, reference.x);
  assert.equal(p.y, reference.y);
  assert.ok(p.x > 0 && p.y > 0, 'pickup must not lock movement');
  assert.equal(p.animatePickup(), false, 'walking must keep priority over collecting');
  p.update(dt, meadow, still, false);
  assert.equal(p.animatePickup(), true);
});

test('jumping cancels pickup and keeps the existing launch and flight', () => {
  const p = new Player(0, 0);
  peak(p);
  p.jump();
  assert.equal(p.pickupPose, 0);
  assert.equal(p.windUp, 0);
  assert.equal(p.animatePickup(), false);
  for (let i = 0; i < 8; i++) p.update(dt, meadow, still, false);
  assert.ok(p.air > 0, 'the jump should still launch');
  assert.ok(p.crouch > 0, 'the jump keeps its independent leg tuck');
  assert.equal(p.animatePickup(), false);
  for (let i = 0; i < 50; i++) p.update(dt, meadow, still, false);
  assert.equal(p.air, 0);
  assert.equal(p.pickupPose, 0, 'landing must not resume the cancelled grab');
});

test('attacking and drawing the sword immediately take precedence over pickup', () => {
  for (const action of ['attack', 'toggleSword']) {
    const p = new Player(0, 0);
    peak(p);
    p[action]();
    assert.equal(p.pickupPose, 0, action);
    assert.equal(p.combat.busy, true, action);
    assert.equal(p.animatePickup(), false, action);
    const supplied = buildRig({ ...p, pickupPose: 1 });
    const combat = buildRig({ ...p, pickupPose: 0 });
    for (const part of ['head', 'pelvis', 'arms', 'legs', 'sword']) {
      assert.deepEqual(supplied[part], combat[part], 'an externally supplied pickup pose must not override combat');
    }
  }
});

test('a drawn idle sword stays attached while the free hand grabs', () => {
  const p = new Player(0, 0);
  p.toggleSword();
  for (let i = 0; i < 60; i++) p.update(dt, meadow, still, false);
  assert.equal(p.combat.inHand, true);
  assert.equal(p.combat.busy, false);
  const guarding = buildRig(p);
  const guardGrip = distance(guarding.sword.guard, guarding.arms.find((arm) => arm.s === SWORD_SIDE).wrist);
  const blade = distance(guarding.sword.guard, guarding.sword.tip);
  peak(p);
  const rig = buildRig(p);
  assert.ok(freeHand(rig)[1] < freeHand(guarding)[1] - 0.05, 'idle guard must let the free hand reach down');
  assert.ok(rig.sword);
  const swordArm = rig.arms.find((arm) => arm.s === SWORD_SIDE);
  assert.ok(Math.abs(distance(rig.sword.guard, swordArm.wrist) - guardGrip) < 1e-9,
    'the blade must stay attached to the sword wrist');
  assert.ok(Math.abs(distance(rig.sword.guard, rig.sword.tip) - blade) < 1e-9);
  assert.ok(Math.abs(groundGap(rig)) < 0.05);
});

test('pickup joints remain finite and grounded through the pose at every heading', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (let pickupPose = 0; pickupPose <= 1; pickupPose += 0.05) {
      const p = new Player(0, 0);
      const rig = buildRig({ ...p, heading, pickupPose, kneel: 0.5 });
      const joints = [rig.head, rig.pelvis, ...rig.arms.flatMap((arm) =>
        [arm.shoulder, arm.elbow, arm.wrist, arm.hand]), ...rig.legs.flatMap((leg) =>
        [leg.hip, leg.knee, leg.ankle, leg.toe])];
      assert.ok(joints.flat().every(Number.isFinite));
      assert.ok(Math.abs(groundGap(rig)) < 1e-9);
    }
  }
});

test('combat events retain their type and metadata with strikes and slams placed ahead', () => {
  for (const heading of [0, Math.PI / 2]) {
    const p = new Player(10, 20);
    p.heading = heading;
    p.combat.events.push({ type: 'strike', move: 'a', strength: 0.6 },
      { type: 'slam', strength: 0.8 }, { type: 'draw' });
    p.update(dt, meadow, still, false);
    assert.deepEqual(p.events.map((event) => event.type), ['strike', 'slam', 'draw']);
    const reach = 0.95 * SCALE;
    for (const event of p.events.slice(0, 2)) {
      assert.equal(event.x, p.x + Math.sin(heading) * reach / ASPECT);
      assert.equal(event.y, p.y + Math.cos(heading) * reach * TILT);
    }
    assert.equal(p.events[0].move, 'a');
    assert.equal(p.events[0].strength, 0.6);
    assert.equal(p.events[1].strength, 0.8);
    assert.equal(p.events[2].x, p.x);
    assert.equal(p.events[2].y, p.y);
    assert.equal(p.combat.events.length, 0);
  }
});

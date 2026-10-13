import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenToWorld } from '../src/core/aim.js';
import { solveBallisticShot } from '../src/core/ballistics.js';
import { Player } from '../src/entities/player.js';
import { buildRig, dot, norm, SCALE, sub, TILT } from '../src/entities/rig.js';
import { Projectiles } from '../src/world/projectiles.js';
import { ASPECT, GRASS } from '../src/world/world.js';

const DT = 1 / 120;
const STILL = { x: 0, y: 0 };
const meadow = { isWalkable: () => true, typeAt: () => GRASS, propsIn: () => [] };
const shots = (events) => events.filter((event) => event.projectile?.kind === 'arrow');

function near(actual, expected, message, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}

function nearVector(actual, expected, message, tolerance = 1e-7) {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, i) => near(value, expected[i], `${message}[${i}]`, tolerance));
}

function tick(player, input = {}, move = STILL, elapsed = DT) {
  player.events.length = 0;
  player.update(elapsed, meadow, move, false, input);
  return player.events.splice(0);
}

function holdBow(target, { heading = 0, x = 10.25, y = -7.75, seconds = 2 } = {}) {
  const player = new Player(x, y, 'bow');
  player.heading = heading;
  player.nextBreath = 100;
  player.nextBlink = 100;
  if (target !== undefined) player.setAimTarget(target);
  assert.equal(player.attack({ held: true }), true, 'the bow starts drawing');
  for (let frame = 0; frame < Math.ceil(seconds / DT); frame++) {
    const input = { held: true, ...(target !== undefined ? { aimTarget: target } : {}) };
    assert.equal(shots(tick(player, input)).length, 0, 'holding never releases an arrow');
  }
  assert.equal(player.combat.charging, true);
  near(player.combat.charge, 1, 'the bow reaches full charge');
  return player;
}

function finishAction(player, input = {}) {
  const released = [];
  for (let frame = 0; frame < 240; frame++) {
    const emitted = shots(tick(player, { held: false, ...input }));
    for (const event of emitted) {
      const rig = buildRig(player);
      released.push({ event, direction: norm(sub(rig.weapon.arrow.tip, rig.weapon.arrow.tail)), player });
    }
    if (!player.combat.busy) break;
  }
  assert.equal(player.combat.busy, false, 'a released shot finishes');
  return released;
}

function releaseBow(player, input = {}) {
  assert.equal(player.release(), true, 'a deliberate release fires the held bow');
  const released = finishAction(player, input);
  assert.equal(released.length, 1, 'one held draw releases exactly one arrow');
  return released[0];
}

function flight(event, steps = [DT]) {
  const projectiles = new Projectiles();
  const arrow = projectiles.launch(event);
  assert.ok(arrow, 'the world accepts the arrow');
  assert.ok([arrow.vx, arrow.vy, arrow.vh].every(Number.isFinite), 'launch velocity is finite');
  const direction = norm([arrow.vx * ASPECT / SCALE, arrow.vh / SCALE, arrow.vy / (SCALE * TILT)]);
  for (let frame = 0; projectiles.list.length && frame < 6000; frame++) {
    projectiles.update(steps[frame % steps.length], meadow);
  }
  assert.equal(projectiles.list.length, 0, 'the arrow completes its flight');
  assert.equal(projectiles.events.length, 1, 'the flight generates one impact');
  return { impact: projectiles.events[0], direction };
}

function assertCursorImpact(impact, target, label) {
  assert.equal(impact.kind, 'arrow', label);
  assert.equal(impact.prop, null, `${label}: unobstructed ground`);
  near(impact.x, target.x, `${label}: cursor column`);
  near(impact.y, target.y, `${label}: cursor row`);
  near(impact.h, 0, `${label}: ground height`);
}

test('full bow draw stays by the cheek with a long pull at every heading', () => {
  for (let i = 0; i < 8; i++) {
    const heading = i * Math.PI / 4;
    const target = {
      x: 10.25 + Math.sin(heading) * 8 * SCALE / ASPECT,
      y: -7.75 + Math.cos(heading) * 8 * SCALE * TILT,
    };
    const player = holdBow(target, { heading });
    const rig = buildRig(player);
    const bow = rig.weapon;
    assert.ok(Math.hypot(...sub(bow.grip, bow.string)) >= 0.4,
      `heading=${heading}: the drawing hand reaches a full bow pull`);
    assert.ok(Math.hypot(...sub(bow.string, rig.head)) < 0.25,
      `heading=${heading}: the nock rests near the cheek`);
    const support = rig.arms.find((arm) => arm.s === 1);
    nearVector(bow.string, support.hand, 'the support hand holds the string');
    nearVector(bow.arrow.tail, bow.string, 'the arrow is nocked on the string');
    const direction = norm(sub(bow.arrow.tip, bow.arrow.tail));
    assert.ok(dot(sub(support.elbow, bow.string), direction) < -0.03,
      `heading=${heading}: the drawing elbow stays behind the nock`);
    nearVector(direction, player.bowAimDirection(bow.arrow.tip), 'the nocked arrow follows the ballistic aim', 1e-4);
    for (const arm of rig.arms) {
      assert.ok(Math.hypot(...sub(arm.elbow, arm.shoulder)) <= 0.291, 'upper arm remains physically bounded');
      assert.ok(Math.hypot(...sub(arm.wrist, arm.elbow)) <= 0.261, 'forearm remains physically bounded');
    }
    const firstPull = Math.hypot(...sub(bow.grip, bow.string));
    for (let frame = 0; frame < 360; frame++) {
      assert.equal(shots(tick(player, { held: true, aimTarget: target })).length, 0,
        'a fully drawn bow stays held until deliberate release');
    }
    const held = buildRig(player).weapon;
    assert.ok(Math.hypot(...sub(held.grip, held.string)) >= 0.4, 'the prolonged hold retains full draw');
    near(Math.hypot(...sub(held.grip, held.string)), firstPull, 'full draw remains stable through breathing', 0.02);
  }
});

test('released arrows hit the exact ground cursor nearby and in every quadrant', () => {
  const targets = [
    { x: 11.5, y: -7.2 },
    { x: 10.25, y: -7.75 },
    { x: 10.25, y: -40.25 },
    { x: 10.25, y: 22.5 },
    { x: -33.5, y: -29.25 },
    { x: -31.75, y: 18.5 },
    { x: 44.5, y: -27.75 },
    { x: 45.25, y: 21.75 },
  ];
  for (const [i, target] of targets.entries()) {
    const player = holdBow(target, { heading: i * Math.PI / 4 });
    const released = releaseBow(player);
    assert.deepEqual(released.event.aimTarget, target, 'the release carries the cursor target');
    const { impact, direction } = flight(released.event);
    assertCursorImpact(impact, target, `target ${JSON.stringify(target)}`);
    nearVector(released.direction, direction, `target ${JSON.stringify(target)}: launched velocity follows the rendered arrow`, 1e-4);
  }
});

test('aiming at the feet keeps a finite full draw and a stable downward arrow', () => {
  for (const target of [{ x: 10.25, y: -7.75 }, { x: 11.5, y: -7.2 }]) {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const player = holdBow(target, { heading, seconds: 1.4 });
      const rig = buildRig(player);
      const bow = rig.weapon;
      for (const point of [bow.grip, bow.string, bow.arrow.tail, bow.arrow.tip]) {
        assert.ok(point.every(Number.isFinite), 'near-vertical bow geometry stays finite');
        assert.ok(Math.hypot(...point) < 3, 'nearby cursor geometry stays on the warrior');
      }
      assert.ok(Math.hypot(...sub(bow.grip, bow.string)) >= 0.4, 'a nearby cursor still allows a full string pull');
      nearVector(norm(sub(bow.arrow.tip, bow.arrow.tail)), player.bowAimDirection(bow.arrow.tip),
        'the held downward arrow follows the exact target solution', 1e-4);
    }
  }
});

test('a live cursor change redirects the held bow while release locks its own target', () => {
  const initial = { x: 42, y: 15 };
  const player = holdBow(initial);
  const before = norm(sub(buildRig(player).weapon.arrow.tip, buildRig(player).weapon.arrow.tail));
  const releaseTarget = { x: -39.25, y: -24.5 };
  for (let frame = 0; frame < 120; frame++) {
    assert.equal(shots(tick(player, { held: true, aimTarget: releaseTarget })).length, 0);
  }
  const after = norm(sub(buildRig(player).weapon.arrow.tip, buildRig(player).weapon.arrow.tail));
  assert.ok(dot(before, after) < 0.5, 'moving the cursor steers the held arrow');
  assert.deepEqual(player.getBowAimTarget(), releaseTarget);
  assert.equal(player.release(), true);
  const expected = { ...releaseTarget };
  releaseTarget.x = 999;
  releaseTarget.y = 999;
  const nextCursor = { x: 60, y: -5 };
  const released = finishAction(player, { aimTarget: nextCursor });
  assert.equal(released.length, 1);
  assert.deepEqual(released[0].event.aimTarget, expected, 'release copies the target before later pointer movement');
  assertCursorImpact(flight(released[0].event).impact, expected, 'the released arrow keeps its target');
  assert.deepEqual(player.getBowAimTarget(), nextCursor, 'the next idle aim uses the current cursor');
});

test('the launch frame retains full draw and exact aim before the string relaxes', () => {
  for (const target of [{ x: 14.25, y: -5.75 }, { x: 10.25, y: -7.75 }]) {
    const player = holdBow(target);
    assert.equal(player.release(), true);
    let launched = false;
    for (let frame = 0; frame < 240; frame++) {
      const event = shots(tick(player, { held: false, aimTarget: { x: -50, y: 30 } }))[0];
      if (!event) continue;
      const bow = buildRig(player).weapon;
      assert.ok(Math.hypot(...sub(bow.grip, bow.string)) > 0.4, 'the arrow leaves a fully drawn bow');
      near(player.combat.bowDraw, event.charge, 'launch pose retains the released charge');
      near(player.combat.charge, 0, 'gameplay charge finishes on launch');
      nearVector(norm(sub(bow.arrow.tip, bow.arrow.tail)), norm(event.projectile.velocity),
        'the launched arrow follows the fully drawn nock', 1e-6);
      assertCursorImpact(flight(event).impact, target, 'the near full draw reaches its released cursor');
      tick(player, { held: false });
      assert.equal(player.combat.bowDraw, null, 'the string can relax after launch');
      launched = true;
      break;
    }
    assert.ok(launched, 'the full draw releases an arrow');
  }
});

test('queuing another draw preserves the prior arrow aim and draw on its launch frame', () => {
  const target = { x: 65, y: -14 };
  const nextCursor = { x: -45, y: 30 };
  const player = new Player(10.25, -7.75, 'bow');
  player.setAimTarget(target);
  assert.equal(player.attack({ held: true }), true);
  for (let frame = 0; frame < 12; frame++) tick(player, { held: true, aimTarget: target });
  assert.equal(player.release(), true, 'a short hold releases the light shot');
  assert.equal(player.attack({ held: true, aimTarget: nextCursor }), true, 'a second draw queues during that shot');
  let launched = false;
  for (let frame = 0; frame < 240; frame++) {
    const event = shots(tick(player, { held: true, aimTarget: nextCursor }))[0];
    if (!event) continue;
    assert.deepEqual(event.aimTarget, target, 'the earlier release keeps its original cursor');
    assert.deepEqual(player.getBowAimTarget(), target, 'the launch frame still shows the earlier arrow');
    near(player.combat.bowDraw, event.charge, 'the earlier arrow does not use the next draw charge');
    const bow = buildRig(player).weapon;
    nearVector(norm(sub(bow.arrow.tip, bow.arrow.tail)), norm(event.projectile.velocity),
      'the queued draw cannot steer the already released arrow', 1e-6);
    assertCursorImpact(flight(event).impact, target, 'the earlier shot reaches its released cursor');
    tick(player, { held: true, aimTarget: nextCursor });
    assert.deepEqual(player.getBowAimTarget(), nextCursor, 'the next draw then follows its own cursor');
    launched = true;
    break;
  }
  assert.ok(launched, 'the queued draw does not prevent the earlier shot');
});

test('strafe movement keeps a drawn bow facing its cursor and launches from the moved archer', () => {
  const target = { x: 90.5, y: -35.25 };
  const player = holdBow(target);
  const start = { x: player.x, y: player.y };
  for (let frame = 0; frame < 120; frame++) {
    assert.equal(shots(tick(player, { held: true, aimTarget: target }, { x: -1, y: 0 })).length, 0);
  }
  assert.ok(player.x < start.x - 1, 'movement still translates the archer');
  near(player.y, start.y, 'sideways movement keeps its world row');
  const wanted = Math.atan2((target.x - player.x) * ASPECT, (target.y - player.y) / TILT);
  near(Math.atan2(Math.sin(player.heading - wanted), Math.cos(player.heading - wanted)), 0,
    'the bow faces the cursor while strafing', 0.025);
  const released = releaseBow(player, { aimTarget: target });
  near(released.event.originX, player.x, 'release uses the moved player column');
  near(released.event.originY, player.y, 'release uses the moved player row');
  assertCursorImpact(flight(released.event).impact, target, 'a strafing archer hits the cursor');
});

test('targeted flight lands identically under small, irregular and large timesteps', () => {
  const target = { x: -110.75, y: 49.5 };
  const released = releaseBow(holdBow(target));
  const impacts = [[1 / 240], [0.017, 0.004, 0.083], [10]].map((steps) => flight(released.event, steps).impact);
  for (const impact of impacts) assertCursorImpact(impact, target, 'timestep-independent aimed flight');
  for (const impact of impacts.slice(1)) {
    nearVector([impact.x, impact.y, impact.h], [impacts[0].x, impacts[0].y, impacts[0].h],
      'the cursor impact is independent of integration steps');
  }
});

test('aimed arrows reach distant cursors beyond nominal limits and support zero gravity', () => {
  const source = releaseBow(holdBow({ x: 60, y: 20 })).event;
  const distant = { x: 1100.25, y: -907.75 };
  const longShot = {
    ...source, aimTarget: distant,
    projectile: { ...source.projectile, range: 1, lifetime: 0.01 },
  };
  assertCursorImpact(flight(longShot, [0.5]).impact, distant, 'the clicked target defines the aimed flight endpoint');
  const straightTarget = { x: -21.5, y: 13.75 };
  const straightShot = {
    ...source, aimTarget: straightTarget,
    projectile: { ...source.projectile, gravity: 0 },
  };
  assertCursorImpact(flight(straightShot, [10]).impact, straightTarget, 'a zero-gravity arrow reaches its ground cursor');
});

test('both arrows of an aimed double-shot land on its captured cursor', () => {
  const target = { x: 73.5, y: 12.25 };
  const player = new Player(10.25, -7.75, 'bow');
  player.nextBreath = 100;
  player.nextBlink = 100;
  player.setAimTarget(target);
  assert.equal(player.attack(), true);
  const first = finishAction(player, { aimTarget: target });
  assert.equal(first.length, 1);
  assert.equal(player.attack(), true);
  const next = finishAction(player, { aimTarget: target });
  assert.equal(next.length, 1, 'combat emits one double-shot packet');
  assert.equal(next[0].event.projectile.count, 2);
  const projectiles = new Projectiles();
  assert.ok(projectiles.launch(next[0].event));
  assert.equal(projectiles.list.length, 2, 'the packet creates two arrows');
  for (let frame = 0; projectiles.list.length && frame < 2400; frame++) projectiles.update(DT, meadow);
  assert.equal(projectiles.list.length, 0);
  assert.equal(projectiles.events.length, 2);
  for (const impact of projectiles.events) assertCursorImpact(impact, target, 'paired arrow');
});

test('aim target objects are copied and invalid cursor data clears aim', () => {
  const player = new Player(0, 0, 'bow');
  const target = { x: -3.25, y: 9.5 };
  assert.equal(player.setAimTarget(target), true);
  target.x = 900;
  assert.deepEqual(player.aimTarget, { x: -3.25, y: 9.5 }, 'external changes cannot mutate the stored cursor');
  assert.equal(player.setAimTarget({ x: NaN, y: 1 }), false);
  assert.equal(player.aimTarget, null);
  assert.equal(player.bowAimDirection([0, 1, 0]), null, 'no valid target requests no ballistic override');
});

test('bows without a cursor target preserve forward shooting', () => {
  const heading = -Math.PI / 3;
  const player = holdBow(undefined, { heading });
  const released = releaseBow(player);
  assert.ok(released.event.aimTarget == null, 'legacy shots have no target');
  near(released.event.dx, Math.sin(heading) * SCALE / ASPECT, 'legacy horizontal direction');
  near(released.event.dy, Math.cos(heading) * SCALE * TILT, 'legacy depth direction');
  const projectiles = new Projectiles();
  const arrow = projectiles.launch(released.event);
  assert.ok(arrow);
  near(arrow.vh, 0, 'legacy arrows start with their unchanged vertical velocity');
  near(arrow.vx, released.event.dx * released.event.projectile.speed, 'legacy column velocity');
  near(arrow.vy, released.event.dy * released.event.projectile.speed, 'legacy row velocity');
});

test('focus cancellation of an aimed full draw never becomes a shot', () => {
  const player = holdBow({ x: -30, y: 25 });
  assert.equal(shots(tick(player, { held: true, cancelled: true })).length, 0);
  assert.equal(player.combat.charging, false);
  assert.equal(player.release(), false, 'a cancelled draw cannot later be released');
  for (let frame = 0; frame < 240; frame++) {
    assert.equal(shots(tick(player, { held: false, aimTarget: { x: 40, y: 10 } })).length, 0,
      'later cursor and focus updates do not release the cancelled draw');
  }
});

test('ballistic solutions reach their targets vertically, at distance and without gravity', () => {
  const cases = [
    { origin: [0, 1.5, 0], target: [6, 0, 3], speed: 18, gravity: 5 },
    { origin: [-3, 2, 4], target: [-3, 0, 4], speed: 18, gravity: 5 },
    { origin: [2, 0.5, -1], target: [2.00001, 0, -0.99999], speed: 12, gravity: 5 },
    { origin: [0, 1, 0], target: [200, 0, -140], speed: 6, gravity: 9.8 },
    { origin: [-2, 1, 3], target: [7, 4, -8], speed: 14, gravity: 0 },
  ];
  for (const { origin, target, speed, gravity } of cases) {
    const shot = solveBallisticShot(origin, target, speed, gravity);
    assert.ok(shot, 'a valid cursor target has a solution');
    assert.ok([...shot.velocity, ...shot.direction, shot.duration, shot.speed].every(Number.isFinite));
    assert.ok(shot.duration > 0 && shot.speed > 0);
    near(Math.hypot(...shot.direction), 1, 'ballistic direction is normalized');
    const arrival = origin.map((value, i) => value + shot.velocity[i] * shot.duration -
      (i === 1 ? gravity * shot.duration * shot.duration / 2 : 0));
    nearVector(arrival, target, 'the analytic trajectory reaches the target', 1e-6);
  }
  const distant = solveBallisticShot([0, 1, 0], [200, 0, -140], 6, 9.8);
  assert.ok(distant.speed > 6, 'a distant cursor is reachable beyond the nominal speed envelope');
  const coincident = solveBallisticShot([2, 0, -3], [2, 0, -3], 14, 5);
  assert.ok(coincident && [...coincident.velocity, ...coincident.direction, coincident.duration].every(Number.isFinite),
    'a cursor exactly at the origin has a finite limiting solution');
  near(coincident.duration, 0, 'a coincident target needs no flight time');
});

test('cursor world coordinates invert the displayed grid at fractional zoom and every DPR', () => {
  const bounds = { left: 105, top: 27, width: 900, height: 600 };
  const pointer = { x: bounds.left + 321.25, y: bounds.top + 277.5 };
  for (const dpr of [1, 1.5, 2.5]) {
    for (const [cellWidth, cellHeight] of [[6, 10], [9.75, 16.25], [18, 30]]) {
      const frame = {
        width: bounds.width * dpr, height: bounds.height * dpr,
        cellW: cellWidth * dpr, cellH: cellHeight * dpr,
        view: { x0: -51, y0: 23, offX: 3.5 * dpr, offY: 2.25 * dpr },
      };
      const target = screenToWorld(pointer, frame, bounds);
      assert.ok(target);
      near(target.x, -51 + (321.25 + 3.5) / cellWidth, 'column respects zoom, DPR and fractional camera offset');
      near(target.y, 23 + (277.5 + 2.25) / cellHeight, 'row respects zoom, DPR and fractional camera offset');
    }
  }
  const frame = { width: 900, height: 600, cellW: 6, cellH: 10,
    view: { x0: 0, y0: 0, offX: 0, offY: 0 } };
  assert.equal(screenToWorld({ x: bounds.left - 1, y: bounds.top }, frame, bounds), null);
  assert.equal(screenToWorld({ x: bounds.left + bounds.width, y: bounds.top }, frame, bounds), null);
  assert.equal(screenToWorld(null, frame, bounds), null);
});

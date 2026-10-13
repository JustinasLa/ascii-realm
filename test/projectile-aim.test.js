import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { buildRig, dot, norm, SCALE, sub, TILT } from '../src/entities/rig.js';
import { Projectiles } from '../src/world/projectiles.js';
import { ASPECT, GRASS } from '../src/world/world.js';

const DT = 1 / 120;
const STILL = { x: 0, y: 0 };
const meadow = { isWalkable: () => true, typeAt: () => GRASS, propsIn: () => [] };
const physical = [['bow', 'arrow'], ['spear', 'spear'], ['javelin', 'javelin']];
const start = { x: 10.25, y: -7.75 };

function near(actual, expected, label, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

function nearVector(actual, expected, label, tolerance = 1e-7) {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, i) => near(value, expected[i], `${label}[${i}]`, tolerance));
}

function tick(player, input = {}, move = STILL, running = false, dt = DT) {
  player.events.length = 0;
  player.update(dt, meadow, move, running, input);
  return player.events.splice(0);
}

function makePlayer(weapon, target, heading = 0) {
  const player = new Player(start.x, start.y, weapon, 'bronze');
  player.heading = heading;
  player.nextBreath = 100;
  player.nextBlink = 100;
  if (target !== undefined) player.setAimTarget(target);
  return player;
}

function hold(weapon, target, heading = 0) {
  const player = makePlayer(weapon, target, heading);
  assert.equal(player.attack({ held: true }), true, `${weapon}: a hold begins`);
  for (let frame = 0; frame < 144; frame++) {
    const events = tick(player, { held: true });
    assert.equal(events.some((event) => event.projectile), false, `${weapon}: holding never fires`);
  }
  assert.equal(player.combat.charging, true);
  near(player.combat.charge, 1, `${weapon}: fully charged`);
  return player;
}

function posedShot(player) {
  const rig = buildRig(player);
  const weapon = rig.weapon;
  assert.ok(weapon, 'the projectile weapon is held');
  const origin = weapon.arrow?.tip ?? weapon.tip;
  const direction = norm(weapon.arrow
    ? sub(weapon.arrow.tip, weapon.arrow.tail) : sub(weapon.tip, weapon.guard));
  return { rig, weapon, origin, direction };
}

function assertBoundedAim(player, label) {
  const { rig, weapon, origin, direction } = posedShot(player);
  for (const point of [weapon.grip, weapon.guard, weapon.tip, origin]) {
    assert.ok(point.every(Number.isFinite), `${label}: finite weapon geometry`);
    assert.ok(Math.hypot(...point) < 3, `${label}: the shaft stays within reach`);
  }
  assert.ok(origin[1] > 0, `${label}: the launch tip stays above ground`);
  for (const arm of rig.arms) {
    assert.ok(Math.hypot(...sub(arm.elbow, arm.shoulder)) <= 0.291, `${label}: bounded upper arm`);
    assert.ok(Math.hypot(...sub(arm.wrist, arm.elbow)) <= 0.261, `${label}: bounded forearm`);
  }
  nearVector(direction, player.projectileAimDirection(origin), `${label}: the held shaft follows the cursor arc`, 1e-4);
  if (weapon.arrow) {
    assert.ok(Math.hypot(...sub(weapon.grip, weapon.string)) >= 0.4, `${label}: full bow pull remains`);
    assert.ok(Math.hypot(...sub(weapon.string, rig.head)) < 0.25, `${label}: string stays by the cheek`);
  }
}

function finish(player, input = {}) {
  const shots = [];
  const events = [];
  for (let frame = 0; frame < 240; frame++) {
    for (const event of tick(player, { held: false, ...input })) {
      events.push(event);
      if (event.projectile) shots.push({ event, ...posedShot(player) });
    }
    if (!player.combat.busy) break;
  }
  assert.equal(player.combat.busy, false, 'the released action finishes');
  return { shots, events };
}

function release(player, input = {}) {
  assert.equal(player.release(), true, 'release accepts the held action');
  const { shots } = finish(player, input);
  assert.equal(shots.length, 1, 'one hold emits one projectile packet');
  return shots[0];
}

function flight(event) {
  const world = new Projectiles();
  const projectile = world.launch(event);
  assert.ok(projectile, `${event.weapon}: the world accepts the real launch`);
  const direction = norm([
    projectile.vx * ASPECT / SCALE, projectile.vh / SCALE, projectile.vy / (SCALE * TILT),
  ]);
  const steps = [0.017, 0.004, 0.083];
  for (let frame = 0; world.list.length && frame < 2400; frame++) {
    world.update(steps[frame % steps.length], meadow);
  }
  assert.equal(world.list.length, 0, 'the projectile finishes its flight');
  assert.equal(world.events.length, 1, 'the projectile impacts exactly once');
  return { impact: world.events[0], direction };
}

function assertShotAtCursor(shot, target, kind) {
  const { event, origin, direction } = shot;
  assert.equal(event.projectile.kind, kind);
  assert.deepEqual(event.aimTarget, target, 'combat carries the captured cursor');
  near(event.x, event.originX + origin[0] * SCALE / ASPECT, 'flight starts at the visible tip column');
  near(event.y, event.originY + origin[2] * SCALE * TILT, 'flight starts at the visible tip depth');
  near(event.h, origin[1] * SCALE, 'flight starts at the visible tip height');
  nearVector(direction, norm(event.projectile.velocity), 'emitted velocity aligns with the rendered shaft', 1e-4);
  const { impact, direction: launched } = flight(event);
  nearVector(direction, launched, 'world flight keeps the rendered launch direction', 1e-4);
  assert.equal(impact.kind, kind);
  assert.equal(impact.prop, null, 'the unobstructed cursor reaches ground');
  near(impact.x, target.x, 'impact matches the cursor column');
  near(impact.y, target.y, 'impact matches the cursor row');
  near(impact.h, 0, 'impact matches ground height');
}

for (const [weapon, kind] of physical) {
  test(`${weapon} shares exact cursor aiming and safe near-foot geometry`, () => {
    const targets = [
      { x: -55.5, y: -29.25 }, { x: -41.75, y: 18.5 },
      { x: 48.25, y: -27.75 }, { x: 45.25, y: 21.75 },
      { ...start },
    ];
    for (const [i, target] of targets.entries()) {
      const player = hold(weapon, target, i * Math.PI / 2);
      assert.equal(player.usesCursorAim, true, `${weapon}: shared cursor controls are enabled`);
      assert.deepEqual(player.getProjectileAimTarget(), target);
      assertBoundedAim(player, `${weapon}: target ${i}`);
      assertShotAtCursor(release(player), target, kind);
    }
  });

  test(`${weapon} follows live aim and freezes the release cursor before later movement`, () => {
    const player = hold(weapon, { x: 90, y: 21 });
    const before = posedShot(player).direction;
    const target = { x: -45.5, y: -29.75 };
    for (let frame = 0; frame < 24; frame++) tick(player, { held: true, aimTarget: target });
    assert.ok(dot(before, posedShot(player).direction) < 0.5, 'moving the cursor redirects the held shaft');
    assert.equal(player.release({ aimTarget: target }), true);
    const captured = { ...target };
    target.x = 900;
    target.y = 900;
    const nextCursor = { x: 60, y: -5 };
    const { shots } = finish(player, { aimTarget: nextCursor });
    assert.equal(shots.length, 1);
    assertShotAtCursor(shots[0], captured, kind);
    assert.deepEqual(player.getProjectileAimTarget(), nextCursor, 'the next idle aim uses the current cursor');
  });

  test(`${weapon} keeps cursor aim while strafing and launches from the moved player`, () => {
    const target = { x: 85.5, y: -31.25 };
    const player = hold(weapon, target);
    for (let frame = 0; frame < 48; frame++) {
      assert.equal(tick(player, { held: true }, { x: -1, y: 0 }, true).some((event) => event.projectile), false);
    }
    assert.ok(player.x < start.x - 1, 'movement still translates the aiming player');
    near(player.y, start.y, 'strafe keeps ground depth');
    const wanted = Math.atan2((target.x - player.x) * ASPECT, (target.y - player.y) / TILT);
    near(Math.atan2(Math.sin(player.heading - wanted), Math.cos(player.heading - wanted)), 0,
      'heading follows the cursor independently of travel', 0.025);
    assertBoundedAim(player, `${weapon}: strafe`);
    const shot = release(player);
    near(shot.event.originX, player.x, 'release uses the translated column');
    near(shot.event.originY, player.y, 'release uses the translated row');
    assertShotAtCursor(shot, target, kind);
  });
}

test('spear and javelin releases queued during weapon draw retain their target snapshots', () => {
  for (const weapon of ['spear', 'javelin']) {
    const target = { x: -43.25, y: 19.5 };
    const player = makePlayer(weapon, target);
    assert.equal(player.attack({ held: true }), true);
    for (let frame = 0; frame < 27; frame++) tick(player, { held: true });
    assert.equal(player.combat.move, 'draw', 'a quarter-second release can precede drawing the pole');
    assert.equal(player.release(), true);
    assert.equal(player.combat.queued, player.combat.moveset.charged);
    const captured = { ...target };
    target.x = 900;
    player.setAimTarget({ x: 100, y: -30 });
    assert.deepEqual(player.getProjectileAimTarget(), captured, 'the queued throw exposes its own aim');
    const { shots } = finish(player, { aimTarget: { x: 100, y: -30 } });
    assert.equal(shots.length, 1);
    assertShotAtCursor(shots[0], captured, weapon);
  }
});

test('a javelin combo throw keeps its launch pose while another held throw queues', () => {
  const target = { x: -42, y: -23 };
  const nextCursor = { x: 65, y: 30 };
  const player = makePlayer('javelin', target);
  player.combat.inHand = true;
  player.combat.lastSwing = 'butt-strike';
  assert.equal(player.attack(), true);
  assert.equal(player.combat.move, 'throw');
  assert.equal(player.attack({ held: true, aimTarget: nextCursor }), true, 'a follow-up hold queues during a combo throw');
  let launched = false;
  for (let frame = 0; frame < 120; frame++) {
    const event = tick(player, { held: true, aimTarget: nextCursor }).find((entry) => entry.projectile);
    if (!event) continue;
    assert.deepEqual(player.getProjectileAimTarget(), target, 'the emission frame retains the earlier throw target');
    assertShotAtCursor({ event, ...posedShot(player) }, target, 'javelin');
    tick(player, { held: true, aimTarget: nextCursor });
    assert.deepEqual(player.getProjectileAimTarget(), nextCursor, 'the queued hold then follows its own cursor');
    launched = true;
    break;
  }
  assert.ok(launched, 'queuing does not suppress the current throw');
});

test('physical weapons without a cursor retain their forward-flight fallback', () => {
  const heading = -Math.PI / 3;
  for (const [weapon] of physical) {
    const player = hold(weapon, undefined, heading);
    const { event } = release(player);
    assert.ok(event.aimTarget == null, 'a legacy shot has no invented target');
    assert.equal(event.projectile.velocity, undefined, 'cursor solving does not override legacy velocity');
    near(event.dx, Math.sin(heading) * SCALE / ASPECT, `${weapon}: forward column direction`);
    near(event.dy, Math.cos(heading) * SCALE * TILT, `${weapon}: forward depth direction`);
    const projectile = new Projectiles().launch(event);
    assert.ok(projectile, `${weapon}: the legacy launch is accepted`);
    near(projectile.vh, 0, `${weapon}: legacy vertical speed`);
    near(projectile.vx, event.dx * event.projectile.speed, `${weapon}: legacy horizontal speed`);
    near(projectile.vy, event.dy * event.projectile.speed, `${weapon}: legacy depth speed`);
  }
});

test('short spear and javelin holds still release their first melee combo', () => {
  for (const weapon of ['spear', 'javelin']) {
    const player = makePlayer(weapon, { x: -40, y: -20 });
    player.combat.inHand = true;
    assert.equal(player.attack({ held: true }), true);
    for (let frame = 0; frame < 4; frame++) tick(player, { held: true });
    assert.equal(player.release(), true);
    const { shots, events } = finish(player);
    assert.equal(shots.length, 0, `${weapon}: a short hold does not become a throw`);
    const hit = events.find((event) => event.type === 'thrust');
    assert.ok(hit, `${weapon}: the first melee jab still strikes`);
    assert.equal(hit.move, player.combat.moveset.combo[0]);
    assert.equal(hit.aimTarget, undefined, 'melee events do not carry projectile targets');
    assert.equal(hit.charged, false);
  }
});

test('running and airborne javelin attacks also keep their captured cursor', () => {
  for (const move of ['running-throw', 'air-throw']) {
    const target = { x: 44.5, y: -26.25 };
    const player = makePlayer('javelin', target);
    player.combat.inHand = true;
    if (move === 'running-throw') {
      player.moving = true;
      player.running = true;
    } else {
      player.air = 0.6;
      player.vy = 0;
    }
    assert.equal(player.attack(), true);
    assert.equal(player.combat.move, move);
    const { shots } = finish(player, { aimTarget: { x: -60, y: 22 } });
    assert.equal(shots.length, 1);
    assert.equal(shots[0].event.move, move);
    assertShotAtCursor(shots[0], target, 'javelin');
  }
});

test('cancelling a physical weapon hold never releases it on later input', () => {
  for (const [weapon] of physical) {
    const player = hold(weapon, { x: -32, y: 15 });
    assert.equal(tick(player, { held: true, cancelled: true }).some((event) => event.projectile), false);
    assert.equal(player.combat.charging, false);
    assert.equal(player.release(), false, 'a cancelled hold cannot be released later');
    for (let frame = 0; frame < 90; frame++) {
      assert.equal(tick(player, { held: false, aimTarget: { x: 45, y: -20 } }).some((event) => event.projectile), false,
        `${weapon}: later cursor input cannot turn cancellation into firing`);
    }
  }
});

test('staff magic keeps facing-based shooting despite the shared physical aiming APIs', () => {
  const heading = Math.PI / 4;
  const player = hold('staff', { x: -90, y: -30 }, heading);
  assert.equal(player.usesCursorAim, false, 'staff controls stay facing-based');
  assert.equal(player.getProjectileAimTarget(), null);
  const { event } = release(player, { aimTarget: { x: 100, y: -70 } });
  assert.equal(event.projectile.kind, 'magic');
  assert.equal(event.aimTarget, undefined);
  assert.equal(event.projectile.velocity, undefined);
  near(event.dx, Math.sin(heading) * SCALE / ASPECT, 'magic follows the held heading');
  near(event.dy, Math.cos(heading) * SCALE * TILT, 'magic follows the held depth direction');
});

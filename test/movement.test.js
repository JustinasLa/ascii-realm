import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JUMPS, Player, TRICKS } from '../src/entities/player.js';
import { GRASS, WATER, World } from '../src/world/world.js';

const meadow = { isWalkable: () => true, typeAt: () => GRASS };

// Use the world's real terrain and prop collision checks without generating
// scenery outside the small obstacle under test.
function obstacleWorld(props = [], typeAt = () => GRASS) {
  return Object.assign(Object.create(World.prototype), {
    typeAt,
    propsIn: () => props,
  });
}

function runningPlayer(x, y) {
  const p = new Player(0, 0);
  for (let i = 0; i < 180; i++) {
    p.update(1 / 60, meadow, { x: 1, y: 0 }, true);
    p.events.length = 0;
  }
  p.x = x;
  p.y = y;
  return p;
}

test('a long running frame cannot pass through a tree', () => {
  const tree = { kind: 'tree', x: 0, y: 0, footW: 2.4, footH: 1.2 };
  const world = obstacleWorld([tree]);
  for (const frames of [1, 10]) {
    const p = runningPlayer(-3.1, 0.8);
    for (let i = 0; i < frames; i++) p.update(0.1 / frames, world, { x: 1, y: 0 }, true);
    assert.ok(p.x < 0, `crossed the tree in ${frames} frames: x=${p.x}`);
    for (const offset of [-1.2, 0, 1.2]) assert.ok(world.isWalkable(p.x + offset, p.y));
  }
});

test('movement cannot skip a thin obstacle between clear endpoints', () => {
  const fence = { x: 0, y: 0.25, footW: 4, footH: 0.18 };
  const world = obstacleWorld([fence]);
  for (const direction of [-1, 1]) {
    const p = new Player(0, -2 * direction);
    assert.ok(world.isWalkable(p.x, p.y));
    assert.ok(world.isWalkable(p.x, p.y + 4 * direction));
    p.tryMove(world, 0, 4 * direction);
    assert.ok((p.y - fence.y) * direction < 0, `crossed the thin obstacle: y=${p.y}`);
    assert.ok(world.isWalkable(p.x, p.y));
  }
});

test('movement stops before a one-cell strip of water', () => {
  const world = obstacleWorld([], (_x, y) => Math.floor(y) === 0 ? WATER : GRASS);
  const p = new Player(0, -1);
  p.tryMove(world, 0, 3);
  assert.ok(p.y < 0, `crossed the water: y=${p.y}`);
  assert.ok(world.isWalkable(p.x, p.y));
});

test('a blocked axis still lets the player slide along the shore', () => {
  const world = obstacleWorld([], (x) => x >= 2 ? WATER : GRASS);
  const p = new Player(0, 0);
  p.tryMove(world, 8, 0);
  const stoppedX = p.x;
  assert.ok(stoppedX < 0.8);
  p.tryMove(world, 0, 5);
  assert.equal(p.x, stoppedX);
  assert.equal(p.y, 5);
});

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} != ${expected}`);
}

test('a frame crossing takeoff spends only its remaining time in flight', () => {
  const p = new Player(0, 0);
  p.jump();
  p.updateJump(0.08);
  assert.equal(p.air, 0);
  p.updateJump(0.07);
  close(p.air, 0.001 + 3.6 * 0.05 - 7 * 0.05 ** 2, 'height after 0.05 seconds airborne');
  close(p.vy, 3.6 - 14 * 0.05, 'takeoff velocity after gravity');
  assert.equal(p.windUp, -1);
});

test('jump height, apex and landing agree across frame partitions', () => {
  const impactSpeed = Math.sqrt(3.6 ** 2 + 2 * 14 * 0.001);
  const landingTime = 0.1 + (3.6 + impactSpeed) / 14;
  const samples = [0.099, 0.1, 0.15, 0.1 + 3.6 / 14, 0.55, landingTime - 0.0001, landingTime, landingTime + 0.05];
  for (const hz of [10, 30, 60, 120]) {
    for (const elapsed of samples) {
      const p = new Player(0, 0);
      p.jump();
      let time = 0;
      while (time < elapsed - 1e-12) {
        const dt = Math.min(1 / hz, elapsed - time);
        p.updateJump(dt);
        time += dt;
      }
      const flight = elapsed - 0.1;
      const landed = elapsed >= landingTime;
      const height = flight < 0 || landed ? 0 : 0.001 + 3.6 * flight - 7 * flight ** 2;
      const vy = flight < 0 ? 0 : landed ? -impactSpeed : 3.6 - 14 * flight;
      close(p.air, height, `height at ${elapsed}s and ${hz} Hz`);
      close(p.vy, vy, `velocity at ${elapsed}s and ${hz} Hz`);
      close(p.landed, landed ? 1 - (elapsed - landingTime) * 4 : 0, 'landing recovery');
      assert.equal(p.events.filter((e) => e.type === 'land').length, landed ? 1 : 0);
    }
  }
});

test('landing emits once and leaves the player able to jump again', () => {
  const p = new Player(0, 0);
  p.jump();
  for (let i = 0; i < 20; i++) p.updateJump(0.1);
  assert.equal(p.events.filter((e) => e.type === 'land').length, 1);
  assert.equal(p.air, 0);
  assert.equal(p.landed, 0);
  p.jump();
  p.updateJump(0.15);
  assert.ok(p.air > 0);
});

function stepAt(phase, air = 0, world = meadow) {
  const p = new Player(0, 0);
  p.phase = phase - 1e-6;
  p.walk = 1;
  p.air = air;
  p.update(1 / 60, world, { x: 1, y: 0 }, false);
  return p.events.filter((e) => e.type === 'step');
}

test('footsteps coincide with alternating footfalls', () => {
  assert.equal(stepAt(Math.PI / 2).length, 1);
  assert.equal(stepAt(3 * Math.PI / 2).length, 1);
  assert.equal(stepAt(Math.PI).length, 0);
  assert.equal(stepAt(2 * Math.PI).length, 0);
});

test('airborne and blocked players do not emit footsteps', () => {
  assert.equal(stepAt(Math.PI / 2, 0.5).length, 0);
  assert.equal(stepAt(Math.PI / 2, 0, { isWalkable: () => false }).length, 0);
});

test('a model supplies its own footsteps without procedural duplicates', () => {
  const p = new Player(0, 0);
  p.modelTrail = true;
  p.phase = Math.PI / 2 - 1e-6;
  p.walk = 1;
  p.update(1 / 60, meadow, { x: 1, y: 0 }, false);
  assert.ok(p.phase > Math.PI / 2);
  assert.equal(p.events.filter((e) => e.type === 'step').length, 0);
});

function styledJump(kind) {
  const p = new Player(0, 0);
  if (kind === 'stride') p.speed = 1;
  if (kind === 'leap') p.speed = p.runSpeed;
  if (kind === 'hop' || kind === 'spin') {
    p.sinceLand = 0;
    p.lastJump = kind === 'hop' ? 'stand' : 'hop';
  }
  p.jump();
  assert.equal(p.jumpKind, kind);
  return p;
}

function advanceJump(p, elapsed, hz) {
  let time = 0;
  while (time < elapsed - 1e-12) {
    const dt = Math.min(1 / hz, elapsed - time);
    p.updateJump(dt);
    time += dt;
  }
}

test('all jump styles preserve flight clocks and landing chains across frame rates', () => {
  for (const [name, kind] of Object.entries(JUMPS)) {
    const impact = Math.sqrt(kind.rise ** 2 + 2 * 14 * 0.001);
    const flight = (kind.rise + impact) / 14;
    for (const hz of [10, 30, 60, 120]) {
      for (const t of [0.05, kind.rise / 14, flight - 0.0001, flight + 0.05]) {
        const p = styledJump(name);
        advanceJump(p, kind.windUp + t, hz);
        const landed = t >= flight;
        close(p.air, landed ? 0 : 0.001 + kind.rise * t - 7 * t ** 2, `${name} height at ${hz} Hz`);
        close(p.vy, landed ? -impact : kind.rise - 14 * t, `${name} velocity`);
        close(p.jumpT, Math.min(t, flight), `${name} animation clock`);
        close(p.flight, flight, `${name} animation flight duration`);
        close(p.surge, kind.surge ?? 0, `${name} forward push`);
        assert.equal(p.events.filter((e) => e.type === 'land').length, landed ? 1 : 0);
        if (landed) {
          close(p.sinceLand, t - flight, `${name} time since impact`);
          close(p.landed, Math.min(1, impact / 3.6) - (t - flight) * 4, `${name} landing recovery`);
          assert.equal(p.lastJump, name);
        }
      }
    }
  }
});

test('queued aerial tricks start at the same flight time for every frame partition', () => {
  for (const [name, kind] of Object.entries(JUMPS)) {
    const trickHeight = 0.001 + kind.rise * 0.1 - 7 * 0.1 ** 2;
    const impact = Math.sqrt(4 ** 2 + 2 * 14 * trickHeight);
    const trickFlight = (4 + impact) / 14;
    for (const hz of [10, 30, 60, 120]) {
      for (const t of [0, 0.2, trickFlight + 0.05]) {
        const p = styledJump(name);
        p.jump();
        assert.equal(p.trickQueued, true);
        advanceJump(p, kind.windUp + 0.1 + t, hz);
        const landed = t >= trickFlight;
        close(p.air, landed ? 0 : trickHeight + 4 * t - 7 * t ** 2, `${name} trick height at ${hz} Hz`);
        close(p.vy, landed ? -impact : 4 - 14 * t, `${name} trick velocity`);
        close(p.jumpT, 0.1 + Math.min(t, trickFlight), `${name} jump clock during trick`);
        close(p.trickT, Math.min(t, trickFlight), `${name} trick animation clock`);
        close(p.trickFlight, trickFlight, `${name} trick animation flight duration`);
        assert.equal(p.trickQueued, false);
        assert.equal(p.trick, landed ? null : TRICKS[name]);
        assert.equal(p.events.filter((e) => e.type === 'land').length, landed ? 1 : 0);
        if (landed) {
          close(p.sinceLand, t - trickFlight, `${name} trick time since impact`);
          assert.equal(p.lastJump, null, 'tricks reset the standing-jump chain');
        }
      }
    }
  }
});

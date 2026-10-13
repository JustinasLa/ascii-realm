import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { buildRig, project, SCALE, TILT } from '../src/entities/rig.js';
import { MATERIAL_IDS, WEAPON_IDS, getWeapon } from '../src/entities/weapons.js';
import { ASPECT, GRASS } from '../src/world/world.js';

const meadow = { isWalkable: () => true, typeAt: () => GRASS };
const still = { x: 0, y: 0 };
const dt = 1 / 120;

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
}

function injectCombat(player, events = [], motion = { forward: 0, turn: 0 }) {
  player.combat.update = () => {
    player.combat.events.push(...events);
    player.combat.motion = motion;
  };
}

function assertLaunchMatchesRig(player, event, point, label) {
  assert.ok(point, `${label} has a posed launch point`);
  const projected = project(point);
  near(event.originX, player.x, `${label} player origin x`);
  near(event.originY, player.y, `${label} player origin y`);
  near(event.x, player.x + projected[0] / ASPECT, `${label} visible spawn x`);
  near(event.y, player.y + point[2] * SCALE * TILT, `${label} ground depth`);
  near(event.h, point[1] * SCALE, `${label} launch height`);
  near(event.y - event.h, player.y + projected[1], `${label} visible spawn row`);
}

test('player supplies running, flight, held attack and blocking context to combat', () => {
  const player = new Player(0, 0);
  player.air = 0.4;
  player.vy = 1;
  let updated;
  player.combat.update = (elapsed, context) => {
    updated = { elapsed, ...context };
  };
  player.update(dt, meadow, { x: 1, y: 0 }, true, { held: true, blocking: true });
  assert.equal(updated.elapsed, dt);
  assert.equal(updated.moving, true);
  assert.equal(updated.running, true);
  assert.equal(updated.held, true);
  assert.equal(updated.blocking, true);
  near(updated.air, player.air, 'flight height');

  let attacked;
  player.combat.attack = (context) => {
    attacked = context;
    return true;
  };
  assert.equal(player.attack({ held: true }), true);
  assert.equal(attacked.moving, true);
  assert.equal(attacked.running, true);
  assert.equal(attacked.held, true);
  near(attacked.air, player.air, 'attack flight height');
});

test('cancelled player input clears held attacks and blocking before combat updates', () => {
  const player = new Player(0, 0);
  let cancelled = 0;
  let updated;
  player.combat.cancelAction = () => { cancelled++; };
  player.combat.update = (elapsed, context) => { updated = context; };
  player.update(dt, meadow, still, false, { held: true, blocking: true, cancelled: true });
  assert.equal(updated.held, false);
  assert.equal(updated.blocking, false);
  assert.equal(cancelled, 1);
  player.cancelAction();
  assert.equal(cancelled, 2);
});

test('combat hits retain damage and identity at the weapon reach in world coordinates', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const player = new Player(12, -7);
    player.heading = heading;
    const hit = {
      type: 'hit', weapon: 'spear', material: 'bronze', attack: 'thrust',
      damage: 37, reach: 2.1, strength: 0.7,
    };
    injectCombat(player, [hit]);
    player.update(dt, meadow, still, false);
    const emitted = player.events.find((event) => event.type === 'hit');
    assert.ok(emitted, 'a hit must remain a hit rather than become a slam');
    for (const [key, value] of Object.entries(hit)) assert.deepEqual(emitted[key], value);
    near(emitted.originX, player.x, 'hit origin x');
    near(emitted.originY, player.y, 'hit origin y');
    near(emitted.dx, Math.sin(heading) * SCALE / ASPECT, 'hit direction x');
    near(emitted.dy, Math.cos(heading) * SCALE * TILT, 'hit direction y');
    near(emitted.x, player.x + emitted.dx * hit.reach, 'hit x');
    near(emitted.y, player.y + emitted.dy * hit.reach, 'hit y');
    assert.equal(player.combat.events.length, 0, 'player consumes each combat event once');
  }
});

test('non-impact combat events preserve their type without generating ground slams', () => {
  const player = new Player(4, 8);
  const events = [
    { type: 'block', weapon: 'sword-shield', absorbed: 16 },
    { type: 'parry', weapon: 'sword-shield', window: 0.12 },
    { type: 'charge', weapon: 'bow', progress: 0.5 },
  ];
  injectCombat(player, events);
  player.update(dt, meadow, still, false);
  assert.equal(player.events.filter((event) => event.type === 'slam').length, 0);
  for (const source of events) {
    const emitted = player.events.find((event) => event.type === source.type);
    assert.ok(emitted, `${source.type} event survives player routing`);
    for (const [key, value] of Object.entries(source)) assert.deepEqual(emitted[key], value);
    near(emitted.originX, 4, `${source.type} origin x`);
    near(emitted.originY, 8, `${source.type} origin y`);
  }
});

test('synthetic ranged events preserve explicit launch height and projectile metadata', () => {
  for (const type of ['projectile', 'magic']) {
    const player = new Player(4, 8);
    player.heading = Math.PI / 2;
    player.air = 0.4;
    const shot = {
      type, weapon: 'bow', material: 'copper', damage: 29, reach: 4,
      projectile: { kind: 'arrow', speed: 12, gravity: 0.5, launchHeight: 1.1, color: [240, 190, 80] },
    };
    injectCombat(player, [shot]);
    player.update(dt, meadow, still, false);
    const emitted = player.events.find((event) => event.type === type);
    assert.ok(emitted);
    assert.deepEqual(emitted.projectile, shot.projectile);
    assert.equal(emitted.damage, shot.damage);
    near(emitted.x, player.x + 0.45 * SCALE / ASPECT, 'projectile spawn x');
    near(emitted.y, player.y, 'projectile spawn y');
    near(emitted.h, (player.air + shot.projectile.launchHeight) * SCALE, 'projectile launch height');
    near(emitted.originX, player.x, 'projectile origin x');
    near(emitted.originY, player.y, 'projectile origin y');
    near(emitted.dx, SCALE / ASPECT, 'projectile direction x');
    near(emitted.dy, 0, 'projectile direction y');
    assert.equal(player.events.some((event) => event.type === 'slam'), false);
  }
});

test('a ranged event without held geometry keeps the forward launch and height fallback', () => {
  const player = new Player(4, 8);
  player.heading = Math.PI / 4;
  player.air = 0.4;
  const shot = { type: 'projectile', reach: 4, projectile: { kind: 'arrow', speed: 12 } };
  injectCombat(player, [shot]);
  player.update(dt, meadow, still, false);
  const emitted = player.events.find((event) => event.projectile);
  assert.ok(emitted);
  near(emitted.x, player.x + Math.sin(player.heading) * 0.45 * SCALE / ASPECT, 'fallback x');
  near(emitted.y, player.y + Math.cos(player.heading) * 0.45 * SCALE * TILT, 'fallback y');
  near(emitted.h, (player.air + 0.75) * SCALE, 'fallback height');
});

test('a forward combat lunge drives actual travel and gait without changing heading', () => {
  const player = new Player(0, 0);
  player.heading = Math.PI / 4;
  injectCombat(player, [], { forward: 4, turn: Math.PI });
  player.update(0.1, meadow, still, false);
  near(player.x, Math.sin(Math.PI / 4) * 0.4 * SCALE / ASPECT, 'lunge x');
  near(player.y, Math.cos(Math.PI / 4) * 0.4 * SCALE * TILT, 'lunge y');
  near(player.heading, Math.PI / 4, 'movement heading during visual spin');
  assert.ok(player.phase > 0, 'feet respond to combat travel');
  assert.ok(player.walk > 0, 'lunge is included in gait movement');
  assert.ok(Number.isFinite(player.combatSpin));
});

test('a large lunge cannot tunnel across a narrow obstacle into walkable ground', () => {
  const wall = {
    isWalkable: (x, y) => y < 2 || y >= 4,
    typeAt: () => GRASS,
  };
  const player = new Player(0, 0);
  injectCombat(player, [], { forward: 12, turn: 0 });
  player.update(0.5, wall, still, false);
  assert.ok(player.y > 0, 'lunge advances to the obstacle');
  assert.ok(player.y < 2, `lunge crossed obstacle to y=${player.y}`);
  near(player.x, 0, 'forward lunge x');
  assert.ok(wall.isWalkable(player.x, player.y));
});

test('busy loadout changes cannot reset combat or erase an active trail', () => {
  const player = new Player(0, 0);
  player.attack();
  const before = {
    weaponId: player.combat.weaponId, material: player.combat.material,
    move: player.combat.move, step: player.combat.step,
    t: player.combat.t, queued: player.combat.queued,
  };
  const trail = [{ t: player.time, hx: 0, hy: 0, tx: 1, ty: 1 }];
  player.trail = trail;
  assert.equal(player.equipWeapon('spear'), false);
  assert.equal(player.cycleWeapon(), false);
  assert.equal(player.cycleMaterial(), false);
  for (const [key, value] of Object.entries(before)) assert.equal(player.combat[key], value);
  assert.equal(player.trail, trail, 'rejected loadout changes leave the current trail intact');
});

test('an idle loadout change clears stale trails and selects its weapon and material', () => {
  const player = new Player(0, 0);
  player.trail.push({ t: 0, hx: 0, hy: 0, tx: 1, ty: 1 });
  assert.equal(player.equipWeapon('spear', 'bronze'), true);
  assert.equal(player.combat.weapon.id, 'spear');
  assert.equal(player.combat.weapon.material, 'bronze');
  assert.deepEqual(player.trail, []);
  assert.equal(player.combat.busy, false);
  assert.equal(player.equipWeapon('unknown weapon'), false);
  assert.equal(player.combat.weapon.id, 'spear');
});

test('loadout cycling wraps in both directions and retains the other selection', () => {
  const player = new Player(0, 0, WEAPON_IDS.at(-1), MATERIAL_IDS.at(-1));
  assert.equal(player.cycleWeapon(), true);
  assert.equal(player.combat.weaponId, WEAPON_IDS[0]);
  assert.equal(player.combat.material, MATERIAL_IDS.at(-1));
  assert.equal(player.cycleMaterial(), true);
  assert.equal(player.combat.weaponId, WEAPON_IDS[0]);
  assert.equal(player.combat.material, MATERIAL_IDS[0]);
  assert.equal(player.cycleMaterial(-1), true);
  assert.equal(player.combat.material, MATERIAL_IDS.at(-1));
  assert.equal(player.cycleWeapon(-1), true);
  assert.equal(player.combat.weaponId, WEAPON_IDS.at(-1));
  assert.equal(player.combat.material, MATERIAL_IDS.at(-1));
});

test('a held bow releases one charged projectile through the player into world coordinates', () => {
  const player = new Player(10, 11, 'bow', 'bronze');
  player.heading = Math.PI / 2;
  assert.equal(player.attack({ held: true }), true);
  for (let frame = 0; frame < 240; frame++) {
    player.events.length = 0;
    player.update(dt, meadow, still, false, { held: true });
    assert.equal(player.events.some((event) => event.projectile), false,
      'holding the bow should not release an arrow');
  }
  assert.equal(player.release(), true);
  const shots = [];
  for (let frame = 0; frame < 120; frame++) {
    player.events.length = 0;
    player.update(dt, meadow, still, false, { held: false });
    for (const event of player.events.filter((entry) => entry.projectile)) {
      assertLaunchMatchesRig(player, event, buildRig(player).weapon?.arrow?.tip, 'charged arrow');
      shots.push(event);
    }
  }
  assert.equal(shots.length, 1);
  const [shot] = shots;
  assert.equal(shot.weapon, 'bow');
  assert.equal(shot.material, 'bronze');
  assert.equal(shot.charged, true);
  assert.ok(shot.damage > 0);
  near(shot.dx, SCALE / ASPECT, 'charged arrow direction x');
  near(shot.dy, 0, 'charged arrow direction y');
});

test('airborne javelins and magic launch from their posed tips across headings', () => {
  for (const weaponId of ['javelin', 'staff']) {
    for (const heading of [0, Math.PI / 2]) {
      const player = new Player(10, 11, weaponId);
      player.heading = heading;
      assert.equal(player.attack({ held: true }), true);
      for (let frame = 0; frame < 240; frame++) {
        player.events.length = 0;
        player.update(dt, meadow, still, false, { held: true });
      }
      assert.equal(player.release(), true);
      player.air = 0.8;
      player.vy = 2;
      let shots = 0;
      for (let frame = 0; frame < 120; frame++) {
        player.events.length = 0;
        player.update(dt, meadow, still, false, { held: false });
        for (const event of player.events.filter((entry) => entry.projectile)) {
          shots++;
          assert.ok(player.air > 0, `${weaponId} regression exercises an airborne release`);
          assertLaunchMatchesRig(player, event, buildRig(player).weapon?.tip, `${weaponId} heading=${heading}`);
        }
      }
      assert.equal(shots, 1, `${weaponId} releases exactly one projectile`);
    }
  }
});

test('focus cancellation stops a real held bow without firing on the following frame', () => {
  const player = new Player(0, 0, 'bow');
  player.attack({ held: true });
  for (let frame = 0; frame < 60; frame++) {
    player.events.length = 0;
    player.update(dt, meadow, still, false, { held: true });
  }
  player.events.length = 0;
  player.update(dt, meadow, still, false, { held: false, cancelled: true });
  assert.equal(player.combat.charging, false);
  assert.equal(player.events.some((event) => event.projectile), false);
  for (let frame = 0; frame < 120; frame++) {
    player.events.length = 0;
    player.update(dt, meadow, still, false, { held: false });
    assert.equal(player.events.some((event) => event.projectile), false,
      'losing focus must not become a delayed bow release');
  }
});

test('real melee swings record finite weapon-coloured trails for every material tier', () => {
  for (const weaponId of WEAPON_IDS.filter((id) => id !== 'bow')) {
    for (const material of MATERIAL_IDS) {
      const player = new Player(17, -9, weaponId, material);
      player.heading = Math.PI / 3;
      const weapon = getWeapon(weaponId, material);
      player.attack();
      let samples = 0;
      for (let frame = 0; frame < 300; frame++) {
        player.events.length = 0;
        player.update(dt, meadow, still, false);
        for (const sample of player.trail) {
          samples++;
          assert.equal(sample.weapon, weaponId);
          assert.equal(sample.material, material);
          assert.deepEqual(sample.color, weapon.trailColor, `${weaponId}/${material} trail colour`);
          for (const field of ['t', 'hx', 'hy', 'tx', 'ty']) {
            assert.ok(Number.isFinite(sample[field]), `${weaponId}/${material} trail ${field}`);
          }
          assert.ok(Math.hypot(sample.tx - sample.hx, sample.ty - sample.hy) > 0,
            `${weaponId}/${material} trail should span the weapon`);
        }
      }
      assert.ok(samples > 0, `${weaponId}/${material} swing must leave a trail`);
      assert.deepEqual(player.trail, [], `${weaponId}/${material} trail should expire`);
    }
  }
});

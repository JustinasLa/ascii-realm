import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { SCALE, TILT } from '../src/entities/rig.js';
import { Projectiles } from '../src/world/projectiles.js';
import { ASPECT, GRASS } from '../src/world/world.js';

const toCols = SCALE / ASPECT;
const toRows = SCALE * TILT;
const still = { x: 0, y: 0 };
const meadow = { isWalkable: () => true, typeAt: () => GRASS, propsIn: () => [] };

function position(x, y = 0) {
  return { x: x * toCols, y: y * toRows };
}

// Go through a real physical impact so inventory checks use the same
// material and weapon metadata as projectiles launched by the game.
function drop(projectiles, kind, x, y = 0, material = 'steel') {
  const target = position(x, y);
  const weapon = kind === 'arrow' ? 'bow' : kind;
  assert.ok(projectiles.launch({
    type: 'projectile', weapon, material,
    x: target.x - toCols, y: target.y, h: SCALE / 2,
    dx: toCols, dy: 0, aimTarget: target,
    projectile: { kind, speed: 10, gravity: 5 },
  }));
  projectiles.update(5, meadow);
  const record = projectiles.landed.at(-1);
  assert.equal(record.kind, kind);
  assert.ok(Math.abs(record.x - target.x) < 1e-8);
  assert.ok(Math.abs(record.y - target.y) < 1e-8);
  return record;
}

test('standing within reach leaves projectiles in place until the player actually walks', () => {
  const player = new Player(0, 0);
  const projectiles = new Projectiles();
  const item = drop(projectiles, 'arrow', 0.25);
  for (let frame = 0; frame < 6; frame++) {
    player.update(0.1, meadow, still, false);
    assert.deepEqual(player.collectProjectiles(projectiles), []);
  }
  assert.deepEqual(projectiles.landed, [item]);
  assert.deepEqual(player.recoveredCounts, { arrow: 0, spear: 0, javelin: 0 });
  assert.deepEqual(player.recoveredItems, []);
  assert.equal(player.lastCollection, null);

  player.update(0.1, meadow, { x: 1, y: 0 }, false);
  assert.equal(player.collectProjectiles(projectiles).length, 1);
  assert.equal(projectiles.landed.length, 0);
});

test('walking input against a blocked path cannot collect a nearby item', () => {
  const player = new Player(0, 0);
  const projectiles = new Projectiles();
  const item = drop(projectiles, 'spear', 0.25);
  const wall = { ...meadow, isWalkable: () => false };
  player.update(0.5, wall, { x: 1, y: 0 }, false);
  assert.equal(player.moving, true, 'the attempted movement reaches Player.update');
  assert.equal(player.x, 0);
  assert.equal(player.y, 0);
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  assert.deepEqual(projectiles.landed, [item]);
  assert.equal(player.recoveredItems.length, 0);
});

test('airborne travel and the landing frame do not collect before a grounded step', () => {
  const player = new Player(0, 0);
  const projectiles = new Projectiles();
  const item = drop(projectiles, 'javelin', 0.4);
  player.air = 0.8;
  player.vy = 1;
  player.update(0.1, meadow, { x: 1, y: 0 }, false);
  assert.ok(player.air > 0);
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  assert.deepEqual(projectiles.landed, [item]);

  player.air = 0.01;
  player.vy = -2;
  player.update(0.1, meadow, { x: 1, y: 0 }, false);
  assert.equal(player.air, 0, 'this frame includes the landing');
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  assert.deepEqual(projectiles.landed, [item]);

  player.update(0.1, meadow, { x: 1, y: 0 }, false);
  assert.equal(player.collectProjectiles(projectiles).length, 1);
  assert.equal(player.recoveredCounts.javelin, 1);
});

test('a combat lunge without walking input does not collect nearby projectiles', () => {
  const player = new Player(0, 0);
  const projectiles = new Projectiles();
  const item = drop(projectiles, 'arrow', 0, 0.5);
  player.combat.update = () => { player.combat.motion = { forward: 2, turn: 0 }; };
  player.update(0.2, meadow, still, false);
  assert.ok(player.y > 0, 'combat still moves the character forward');
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  assert.deepEqual(projectiles.landed, [item]);
});

test('blocked walking input cannot authorize pickup through a separate combat lunge', () => {
  const player = new Player(0, 0);
  const projectiles = new Projectiles();
  const item = drop(projectiles, 'javelin', 0, 0.2);
  // The body's right-edge probe blocks all requested sideways walking,
  // while the forward combat component can still travel along the wall.
  const wall = { ...meadow, isWalkable: (x) => x <= 1.2 };
  player.combat.update = () => { player.combat.motion = { forward: 4, turn: 0 }; };
  player.update(0.1, wall, { x: 1, y: 0 }, false);
  assert.equal(player.x, 0, 'walking remains fully blocked');
  assert.ok(player.y > 0, 'the combat lunge still produces real displacement');
  assert.equal(player.moving, true, 'walking input alone cannot grant collection');
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  assert.deepEqual(projectiles.landed, [item]);
  assert.equal(player.recoveredItems.length, 0);
});

test('a walking pickup preserves all physical kinds, materials and weapon identities', () => {
  const player = new Player(0, 0, 'hammer', 'steel');
  const projectiles = new Projectiles();
  const drops = [
    drop(projectiles, 'arrow', 0.4, 0, 'copper'),
    drop(projectiles, 'spear', 0.5, 0, 'bronze'),
    drop(projectiles, 'javelin', 0.6, 0, 'iron'),
  ];
  player.update(0.4, meadow, { x: 1, y: 0 }, false);
  const picked = player.collectProjectiles(projectiles);
  assert.equal(picked.length, 3);
  assert.equal(projectiles.landed.length, 0);
  assert.deepEqual(player.recoveredCounts, { arrow: 1, spear: 1, javelin: 1 });
  assert.equal(player.recoveredItems.length, 3);
  for (const original of drops) {
    const stored = player.recoveredItems.find((item) => item.id === original.id);
    assert.ok(stored, `${original.kind} is stored in the player's inventory`);
    assert.equal(stored.kind, original.kind);
    assert.equal(stored.material, original.material);
    assert.equal(stored.weaponId, original.weaponId);
    assert.equal(stored.collectedAt, player.time);
  }
  assert.equal(player.lastCollection.time, player.time);
  assert.deepEqual(player.lastCollection.counts, { arrow: 1, spear: 1, javelin: 1 });
  assert.equal(player.lastCollection.items.length, 3);
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  player.update(0.1, meadow, { x: 1, y: 0 }, false);
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  assert.equal(player.recoveredItems.length, 3, 'each impacted item enters inventory once');
});

test('long walking and running frames collect items crossed between distant endpoints', () => {
  for (const running of [false, true]) {
    const player = new Player(0, 0);
    if (running) {
      for (let frame = 0; frame < 60; frame++) {
        player.update(1 / 60, meadow, { x: 1, y: 0 }, true);
      }
    }
    const from = { x: player.x, y: player.y };
    const projectiles = new Projectiles();
    const travelTime = running ? 1 : 2;
    const x = player.x / toCols + 1.1;
    const item = drop(projectiles, running ? 'javelin' : 'spear', x);
    player.update(travelTime, meadow, { x: 1, y: 0 }, running);
    assert.ok((item.x - from.x) / toCols > 0.75, 'item starts outside pickup reach');
    assert.ok((player.x - item.x) / toCols > 0.75, 'item finishes behind pickup reach');
    assert.equal(player.collectProjectiles(projectiles).length, 1,
      `${running ? 'running' : 'walking'} checks the whole actual travelled segment`);
    assert.equal(projectiles.landed.length, 0);
  }
});

test('collection uses ground-plane metres in both screen directions', () => {
  const player = new Player(0, 0);
  const projectiles = new Projectiles();
  drop(projectiles, 'arrow', 0.2, 0.7);
  const outside = drop(projectiles, 'spear', 0.2, 0.8);
  player.update(0.16, meadow, { x: 1, y: 0 }, false);
  assert.equal(player.collectProjectiles(projectiles).length, 1);
  assert.equal(player.recoveredCounts.arrow, 1);
  assert.equal(player.recoveredCounts.spear, 0);
  assert.deepEqual(projectiles.landed, [outside]);
});

test('stationary or invalid updates cannot reuse an earlier walking segment', () => {
  for (const dt of [0, NaN, -1, 0.1]) {
    const player = new Player(0, 0);
    const projectiles = new Projectiles();
    player.update(0.4, meadow, { x: 1, y: 0 }, false);
    const item = drop(projectiles, 'arrow', 0.4);
    player.update(dt, meadow, still, false);
    assert.deepEqual(player.collectProjectiles(projectiles), [], `dt=${dt} clears stale movement`);
    assert.deepEqual(projectiles.landed, [item]);
  }
});

test('one walking segment is consumed once even if a second impact arrives nearby', () => {
  const player = new Player(0, 0);
  const projectiles = new Projectiles();
  drop(projectiles, 'arrow', 0.3);
  player.update(0.2, meadow, { x: 1, y: 0 }, false);
  assert.equal(player.collectProjectiles(projectiles).length, 1);
  const later = drop(projectiles, 'arrow', 0.3, 0, 'bronze');
  assert.deepEqual(player.collectProjectiles(projectiles), []);
  assert.deepEqual(projectiles.landed, [later]);
  assert.equal(player.recoveredCounts.arrow, 1);
  player.update(0.1, meadow, { x: 1, y: 0 }, false);
  assert.equal(player.collectProjectiles(projectiles).length, 1);
  assert.equal(player.recoveredCounts.arrow, 2);
  assert.equal(player.lastCollection.counts.arrow, 1, 'feedback reports this batch, not lifetime totals');
});

test('two approaching players cannot both recover the same landed item', () => {
  const projectiles = new Projectiles();
  const item = drop(projectiles, 'spear', 0, 0, 'stone');
  const left = new Player(-toCols, 0);
  const right = new Player(toCols, 0);
  left.update(0.4, meadow, { x: 1, y: 0 }, false);
  right.update(0.4, meadow, { x: -1, y: 0 }, false);
  assert.equal(left.collectProjectiles(projectiles).length, 1);
  assert.deepEqual(right.collectProjectiles(projectiles), []);
  assert.equal(projectiles.landed.length, 0);
  assert.equal(left.recoveredItems[0].id, item.id);
  assert.equal(left.recoveredItems[0].material, 'stone');
  assert.equal(left.recoveredCounts.spear, 1);
  assert.equal(right.recoveredCounts.spear, 0);
  assert.deepEqual(right.recoveredItems, []);
});

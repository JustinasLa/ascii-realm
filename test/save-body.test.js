import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { emptyRealm, MAX_BODIES, OUTLAW, readRecord, serialize } from '../src/save/format.js';
import { applyBody, bodyIdOf, captureBody, fileBody, putBody, starterKit, switchBody } from '../src/save/body.js';

const WORLD = { seed: 1, woodland: 'sparse' };

// A live game on a world that is walkable except where `blocked` says.
function liveGame({ blocked = () => false, appliedId = OUTLAW } = {}) {
  const world = { spawn: { x: 4, y: 5 }, isWalkable: (x, y) => !blocked(x, y) };
  const inventory = new Inventory({ starter: false });
  inventory.restore(starterKit());
  const player = new Player(world.spawn.x, world.spawn.y);
  player.equipment = inventory.equipment;
  return { player, inventory, world, appliedId };
}

const body = (fields = {}) => ({ savedAt: 1, x: 30, y: -12, heading: 1, health: 40, stamina: 20, respawn: null,
  bag: [{ id: 'oakLog', count: 3 }], worn: { mainHand: { id: 'dagger', count: 1 } }, ...fields });

test('the body id is the active character\'s, or the outlaw\'s', () => {
  assert.equal(bodyIdOf({ active: { id: 'c1' } }), 'c1');
  assert.equal(bodyIdOf({ active: null }), OUTLAW);
  assert.equal(bodyIdOf(undefined), OUTLAW);
});

test('a captured body is the player\'s place, vitals, bag and gear, and reads back unchanged', () => {
  const game = liveGame();
  Object.assign(game.player, { x: 12.5, y: -3 });
  game.player.heading = 2;
  game.player.vitals.health = 64;
  game.inventory.add('oakLog', 2);
  const captured = captureBody(game, 77);
  assert.deepEqual({ ...captured, bag: captured.bag.slice(0, 2) }, { savedAt: 77, x: 12.5, y: -3, heading: 2, health: 64,
    stamina: 100, respawn: null, bag: [{ id: 'stonePickaxe', count: 1 }, { id: 'oakLog', count: 2 }],
    worn: captured.worn });
  assert.deepEqual(captured.worn.mainHand, { id: 'shortSword', count: 1 });
  assert.equal(typeof captureBody(game).savedAt, 'number');
  const realm = emptyRealm(WORLD);
  putBody(realm, OUTLAW, captured, []);
  const read = readRecord(serialize(realm).text, 'realm', WORLD);
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.record.bodies[OUTLAW], captured);
});

test('a body is put back at its place with its vitals and gear, and the equipment stays the same object', () => {
  const game = liveGame();
  const { equipment } = game.inventory;
  game.player.combat.charge = 1;
  game.player.air = 2;
  assert.deepEqual(applyBody(body({ heading: 7 }), game, 'c1'), { repaired: 0 });
  const { player, inventory } = game;
  assert.deepEqual([player.x, player.y], [30, -12]);
  assert.ok(Math.abs(player.heading - (7 - 2 * Math.PI)) < 1e-9, 'the heading is kept within a turn');
  assert.deepEqual([player.vitals.health, player.vitals.stamina], [40, 20]);
  assert.equal(player.air, 0, 'a fresh pose, as after a defeat');
  assert.equal(player.combat.charge, 0);
  assert.equal(player.equipment, equipment);
  assert.equal(inventory.equipment, equipment);
  assert.equal(equipment.mainHand.id, 'dagger');
  assert.deepEqual(inventory.slots[0], { id: 'oakLog', count: 3 });
  assert.equal(game.appliedId, 'c1');
});

test('health and stamina are kept in range, and a missing one is full', () => {
  const game = liveGame();
  applyBody(body({ health: 0.2, stamina: -5 }), game, OUTLAW);
  assert.deepEqual([game.player.vitals.health, game.player.vitals.stamina], [1, 0]);
  applyBody(body({ health: 900, stamina: 900 }), game, OUTLAW);
  assert.deepEqual([game.player.vitals.health, game.player.vitals.stamina], [100, 100]);
  applyBody(body({ health: null, stamina: null, heading: null }), game, OUTLAW);
  assert.deepEqual([game.player.vitals.health, game.player.vitals.stamina, game.player.heading], [100, 100, 0]);
});

test('a place that is missing, out of bounds or no longer walkable wakes at the spawn, counted', () => {
  const game = liveGame({ blocked: (x) => x === 30 });
  for (const fields of [{}, { x: null }, { x: 2e7 }, { y: Number.NaN }]) {
    assert.deepEqual(applyBody(body(fields), game, OUTLAW), { repaired: 1 }, JSON.stringify(fields));
    assert.deepEqual([game.player.x, game.player.y], [4, 5]);
    assert.equal(game.player.vitals.health, 40);
  }
  const full = Array.from({ length: 30 }, () => ({ id: 'shortSword', count: 1 }));
  assert.deepEqual(applyBody(body({ x: 1, bag: full }), game, OUTLAW), { repaired: 6 }, 'items with no room count too');
});

test('a body saved fallen wakes at the spawn with full vitals', () => {
  const game = liveGame();
  assert.deepEqual(applyBody(body({ health: 0, heading: 2 }), game, OUTLAW), { repaired: 0 });
  assert.deepEqual([game.player.x, game.player.y, game.player.heading], [4, 5, 0]);
  assert.deepEqual([game.player.vitals.health, game.player.vitals.stamina], [100, 100]);
  assert.equal(game.inventory.slots[0].id, 'oakLog', 'the bag is kept');
});

test('putting a body keeps unknown fields, drops deleted characters and keeps the newest past the cap', () => {
  const realm = emptyRealm(WORLD);
  realm.bodies = { gone: body(), [OUTLAW]: body({ savedAt: 0 }), c1: body({ mark: 'kept', health: 1 }) };
  putBody(realm, 'c1', body({ savedAt: 9, health: 70 }), ['c1', 'c2']);
  assert.deepEqual(Object.keys(realm.bodies).sort(), ['c1', OUTLAW]);
  assert.equal(realm.bodies.c1.mark, 'kept');
  assert.equal(realm.bodies.c1.health, 70);
  assert.equal(realm.active, 'c1');
  const ids = Array.from({ length: MAX_BODIES + 2 }, (_, i) => `c${i}`);
  realm.bodies = Object.fromEntries(ids.map((id, i) => [id, body({ savedAt: 100 + i })]));
  putBody(realm, 'c0', body({ savedAt: 50 }), ids);
  assert.equal(Object.keys(realm.bodies).length, MAX_BODIES);
  assert.ok(realm.bodies.c0, 'the body just put stays, though it is the oldest');
  assert.ok(!realm.bodies.c1 && !realm.bodies.c2, 'the oldest others go');
});

test('switching files the outgoing body under its own id and plays the incoming one, or the starter kit', () => {
  const game = liveGame({ appliedId: 'c1' });
  game.inventory.add('oakLog', 4);
  game.player.x = 9;
  const realm = emptyRealm(WORLD);
  realm.bodies.c2 = body({ bag: [{ id: 'arrow', count: 5 }] });
  assert.deepEqual(switchBody(realm, 'c1', 'c2', game, ['c1', 'c2'], 5), { repaired: 0 });
  assert.equal(realm.bodies.c1.x, 9);
  assert.equal(realm.bodies.c1.savedAt, 5);
  assert.equal(game.appliedId, 'c2');
  assert.deepEqual(game.inventory.slots[0], { id: 'arrow', count: 5 });
  switchBody(realm, 'c2', 'c3', game, ['c1', 'c2', 'c3']);
  assert.equal(game.appliedId, 'c3');
  assert.deepEqual([game.player.x, game.player.y], [4, 5]);
  assert.deepEqual(game.inventory.serialize().bag.filter(Boolean), [{ id: 'stonePickaxe', count: 1 }]);
  assert.equal(game.inventory.equipment.mainHand.id, 'shortSword');
  assert.ok(realm.bodies.c1 && realm.bodies.c2, 'the earlier bodies are kept');
});

test('filing a body switches first when the active character changed, so no bag goes under another id', () => {
  const game = liveGame({ appliedId: 'c1' });
  game.inventory.add('oakLog', 4);
  const realm = emptyRealm(WORLD);
  const roster = { active: { id: 'c1' }, characters: [{ id: 'c1' }] };
  assert.equal(fileBody(realm, game, roster, 3), false);
  assert.equal(realm.bodies.c1.bag[1].id, 'oakLog');
  // Another tab made a new character and switched to it.
  roster.active = { id: 'c2' };
  roster.characters.push({ id: 'c2' });
  game.inventory.add('oakLog', 2);
  assert.equal(fileBody(realm, game, roster), true);
  assert.equal(realm.bodies.c1.bag[1].count, 6, 'the live bag went under its own character');
  assert.deepEqual(realm.bodies.c2.bag.filter(Boolean), [{ id: 'stonePickaxe', count: 1 }]);
  assert.equal(realm.active, 'c2');
  assert.equal(game.appliedId, 'c2');
});

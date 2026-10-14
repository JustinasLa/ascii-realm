import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heldWeapon, isBow, isThrown, weaponFeel } from '../src/entities/loadout.js';
import { Player } from '../src/entities/player.js';
import { FULL_DRAW, Ranged, TAP } from '../src/entities/ranged.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { MAX_LANDED, Projectiles } from '../src/world/projectiles.js';
import { GRASS, TREE_HITS, World } from '../src/world/world.js';

const hand = (id, material) => ({ mainHand: { id, count: 1, ...(material ? { material } : {}) } });

test('every weapon item maps to a weapon profile in its material', () => {
  for (const item of Object.values(ITEMS).filter((i) => i.weapon)) {
    const weapon = heldWeapon(hand(item.id));
    assert.equal(weapon.id, item.weapon, item.id);
    assert.equal(weapon.material, 'iron');
  }
  assert.equal(heldWeapon(hand('spear', 'steel')).material, 'steel');
  assert.equal(heldWeapon(hand('healingDraught')), null);
  assert.equal(heldWeapon({}), null);
});

test('the short sword keeps the outlaw\'s swings; heavier weapons are slower, costlier and chop harder', () => {
  const sword = weaponFeel(heldWeapon(hand('shortSword')));
  assert.deepEqual([sword.tempo, sword.stamina, sword.chop], [1, 15, 1]);
  const axe = weaponFeel(heldWeapon(hand('battleAxe')));
  const hammer = weaponFeel(heldWeapon(hand('warHammer')));
  const dagger = weaponFeel(heldWeapon(hand('dagger')));
  assert.ok(axe.tempo < 1 && hammer.tempo < axe.tempo && dagger.tempo > 1);
  assert.ok(hammer.stamina > sword.stamina && dagger.stamina < sword.stamina);
  assert.equal(axe.chop, TREE_HITS, 'an axe fells a tree in one blow');
  assert.ok(weaponFeel(heldWeapon(hand('spear'))).reach > sword.reach);
  assert.ok(isBow(heldWeapon(hand('longbow'))) && isThrown(heldWeapon(hand('javelin'))));
});

test('a player swing uses the equipped weapon\'s stamina, tempo and chop power', () => {
  for (const [id, chop] of [['shortSword', 1], ['battleAxe', TREE_HITS]]) {
    const player = new Player(0, 0);
    player.equipment = hand(id);
    const before = player.vitals.stamina;
    assert.equal(player.attack(), true);
    assert.equal(player.vitals.stamina, before);
    const events = [];
    for (let i = 0; i < 240 && !events.some((e) => e.type === 'strike'); i++) {
      player.update(1 / 60, { isWalkable: () => true, typeAt: () => GRASS }, { x: 0, y: 0 }, false);
      events.push(...player.events.splice(0));
    }
    assert.equal(events.find((e) => e.type === 'strike').chop, chop);
  }
});

test('a bow draws while held and shoots on release; spears jab on a tap and throw after a hold', () => {
  const bow = heldWeapon(hand('longbow'));
  const spear = heldWeapon(hand('spear'));
  const ranged = new Ranged();
  assert.equal(ranged.update(0.1, true, bow), null);
  assert.equal(ranged.aiming, true);
  assert.equal(ranged.update(0, false, bow), null, 'a flick does not loose an arrow');
  ranged.update(FULL_DRAW * 2, true, bow);
  assert.deepEqual(ranged.update(0, false, bow), { action: 'shoot', draw: 1 });
  ranged.update(TAP / 2, true, spear);
  assert.equal(ranged.aiming, false);
  assert.deepEqual(ranged.update(0, false, spear), { action: 'jab' });
  ranged.update(TAP * 2, true, spear);
  assert.equal(ranged.aiming, true);
  assert.equal(ranged.update(0, false, spear).action, 'throw');
  ranged.update(1, true, bow);
  assert.equal(ranged.update(1, true, heldWeapon(hand('shortSword'))), null);
  assert.equal(ranged.aiming, false, 'a melee weapon never aims');
});

test('weapon materials survive the satchel, equipping and unequipping', () => {
  const inventory = new Inventory({ starter: false });
  assert.equal(inventory.add('spear', 1, { material: 'steel' }), 1);
  assert.equal(inventory.add('spear', 1, { material: 'bronze' }), 1);
  assert.equal(inventory.equip(0), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'spear', count: 1, material: 'steel' });
  assert.equal(inventory.unequip('mainHand'), true);
  assert.deepEqual(inventory.slots.filter(Boolean).map((s) => s.material).sort(), ['bronze', 'steel']);
});

test('landed arrows are capped so a long archery session cannot pile them up forever', () => {
  const projectiles = new Projectiles();
  const world = { propsIn: () => [] };
  for (let i = 0; i < MAX_LANDED + 20; i++) {
    projectiles.launch({ x: 0, y: 0, h: 5, aimTarget: { x: 10 + i, y: 0 }, projectile: { kind: 'arrow' } });
    for (let k = 0; k < 120 && projectiles.list.length; k++) projectiles.update(1 / 30, world);
  }
  assert.equal(projectiles.landed.length, MAX_LANDED);
});

test('a heavy blow counts for several hits and a tree never takes more than it needs', () => {
  const world = new World(3);
  const tree = { kind: 'tree', id: 'p:test', x: 0, y: 0 };
  assert.equal(world.hitTree(tree, 2), 2);
  assert.equal(world.hitTree(tree, 5), TREE_HITS);
  assert.equal(tree.chopped, true);
});

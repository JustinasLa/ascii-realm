import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { dressFigure, drawFigure } from '../src/entities/figure.js';
import { heldKey, heldWeapon } from '../src/entities/loadout.js';
import { MATERIALS } from '../src/entities/materials.js';
import { Player } from '../src/entities/player.js';
import { getWeapon, INGOT_TIERS, isMaterialId, MATERIAL_IDS, WEAPON_IDS, WEAPON_MATERIALS, weaponMaterial } from '../src/entities/weapons.js';
import { Inventory } from '../src/inventory/inventory.js';

// Damage, speed, stamina cost and weight per kind for stone, copper, bronze,
// iron and steel, as they were before forged weapons existed.
const BEFORE = {
  greatsword: [[17.92, 0.82, 21.6, 4.94], [22.4, 0.91, 20.16, 4.18], [25.6, 0.95, 19.26, 3.99], [29.12, 0.98, 18.54, 3.88], [32, 1, 18, 3.8]],
  'sword-shield': [[13.44, 0.97, 14.4, 3.51], [16.8, 1.07, 13.44, 2.97], [19.2, 1.12, 12.84, 2.84], [21.84, 1.16, 12.36, 2.75], [24, 1.18, 12, 2.7]],
  axe: [[20.16, 0.7, 24, 4.29], [25.2, 0.77, 22.4, 3.63], [28.8, 0.81, 21.4, 3.47], [32.76, 0.83, 20.6, 3.37], [36, 0.85, 20, 3.3]],
  hammer: [[24.64, 0.53, 31.2, 5.98], [30.8, 0.59, 29.12, 5.06], [35.2, 0.62, 27.82, 4.83], [40.04, 0.64, 26.78, 4.69], [44, 0.65, 26, 4.6]],
  pickaxe: [[24.64, 0.53, 31.2, 5.98], [30.8, 0.59, 29.12, 5.06], [35.2, 0.62, 27.82, 4.83], [40.04, 0.64, 26.78, 4.69], [44, 0.65, 26, 4.6]],
  spear: [[14.56, 0.87, 15.6, 2.6], [18.2, 0.96, 14.56, 2.2], [20.8, 1.01, 13.91, 2.1], [23.66, 1.04, 13.39, 2.04], [26, 1.06, 13, 2]],
  dagger: [[7.84, 1.27, 8.4, 0.72], [9.8, 1.41, 7.84, 0.61], [11.2, 1.47, 7.49, 0.58], [12.74, 1.52, 7.21, 0.56], [14, 1.55, 7, 0.55]],
  bow: [[12.32, 0.82, 12, 1.63], [15.4, 0.91, 11.2, 1.38], [17.6, 0.95, 10.7, 1.31], [20.02, 0.98, 10.3, 1.27], [22, 1, 10, 1.25]],
  staff: [[11.2, 0.79, 18, 2.21], [14, 0.87, 16.8, 1.87], [16, 0.91, 16.05, 1.79], [18.2, 0.94, 15.45, 1.73], [20, 0.96, 15, 1.7]],
  javelin: [[15.68, 0.89, 16.8, 1.5], [19.6, 0.98, 15.68, 1.26], [22.4, 1.03, 14.98, 1.21], [25.48, 1.06, 14.42, 1.17], [28, 1.08, 14, 1.15]],
};
const COLOURS = { stone: [150, 153, 162], copper: [218, 139, 96], bronze: [199, 165, 99], iron: [167, 180, 195], steel: [206, 214, 228] };

const forged = (metal, attackDamage, colour) => ({
  metal, ...(colour ? { colour } : {}), quality: 'polished', hits: 80, stats: { attackDamage, durability: 500 }, inputs: { ironIngot: 4 },
});
const sword = (extras = {}) => {
  const inventory = new Inventory({ starter: false });
  assert.equal(inventory.add('shortSword', 1, extras), 1);
  return inventory.slots[0];
};
const held = (id, extras) => {
  const inventory = new Inventory({ starter: false });
  inventory.add(id, 1, extras);
  inventory.equip(0);
  return inventory.equipment;
};

test('every kind and tier hits, swings, tires and weighs exactly as before', () => {
  assert.deepEqual(WEAPON_IDS, Object.keys(BEFORE));
  assert.deepEqual(MATERIAL_IDS, ['stone', 'copper', 'bronze', 'iron', 'steel']);
  for (const id of WEAPON_IDS) {
    MATERIAL_IDS.forEach((material, i) => {
      const weapon = getWeapon(id, material);
      assert.deepEqual([weapon.damage, weapon.speed, weapon.staminaCost, weapon.weight], BEFORE[id][i], `${id} ${material}`);
      assert.deepEqual(weapon.materialColor, COLOURS[material]);
      assert.equal(weapon.material, material);
      assert.equal(weapon.materialName, WEAPON_MATERIALS[material].name);
      assert.equal(weapon.materialKey, material);
      assert.equal(getWeapon(id, weaponMaterial(material)), weapon, 'the lookup gives the same profile');
    });
  }
  assert.equal(getWeapon('nope', 'gold'), getWeapon('greatsword', 'steel'), 'unknown picks still fall back to steel');
  assert.equal(getWeapon(), getWeapon('greatsword', 'steel'));
  assert.equal(getWeapon('dagger', { key: 'fake', damage: 9 }), getWeapon('dagger', 'steel'), 'only the lookup makes profiles');
});

test('the lookup resolves tiers, ingots, stacks and their fallbacks', () => {
  assert.deepEqual(INGOT_TIERS, { copperIngot: 'copper', bronzeIngot: 'bronze', ironIngot: 'iron', steelIngot: 'steel' });
  assert.equal(isMaterialId('bronze'), true);
  assert.equal(isMaterialId('forged'), false);
  assert.equal(isMaterialId('toString'), false);
  assert.equal(weaponMaterial('copper').damage, 0.7);
  assert.equal(weaponMaterial('copper').key, 'copper');
  assert.equal(weaponMaterial('bronzeIngot'), weaponMaterial('bronze'));
  assert.equal(weaponMaterial({ id: 'dagger', material: 'iron' }), weaponMaterial('iron'));
  assert.equal(weaponMaterial({ id: 'dagger' }), weaponMaterial('steel'));
  assert.equal(weaponMaterial('gold', 'iron'), weaponMaterial('iron'));
  assert.equal(weaponMaterial(null), weaponMaterial('steel'));
  assert.equal(weaponMaterial('toString', 'iron'), weaponMaterial('iron'), 'inherited keys are not ingots');
  assert.equal(weaponMaterial('gold', 'gold'), weaponMaterial('steel'));
  assert.equal(weaponMaterial({ forged: 'Iron', material: 'copper' }), weaponMaterial('copper'), 'a forging must be an object');
  assert.ok(Object.isFrozen(weaponMaterial('iron')));
});

test('a forged stack is its own metal: damage from Attack Damage ÷ 4, the feel of iron, its colour', () => {
  const alloy = sword({ forged: forged('Blackiron', 4.2, '5E6568') });
  const profile = weaponMaterial(alloy);
  assert.equal(profile.key, 'forged:5E6568:4.2');
  assert.equal(profile.name, 'Blackiron');
  assert.equal(profile.damage, 1.05);
  const iron = WEAPON_MATERIALS.iron;
  assert.deepEqual([profile.speed, profile.staminaCost, profile.weight], [iron.speed, iron.staminaCost, iron.weight]);
  assert.deepEqual(profile.color, [0x5e, 0x65, 0x68]);
  assert.equal(weaponMaterial(alloy), profile, 'the same forging gives the same profile');
  const ingot = sword({ material: 'copper', forged: forged('Copper', 3) });
  assert.equal(weaponMaterial(ingot).key, 'forged:copper:3');
  assert.deepEqual(weaponMaterial(ingot).color, COLOURS.copper, 'an ingot weapon takes its tier colour');
  // A friend's sword carries only its look: iron's damage, its own colour.
  const look = { id: 'shortSword', forged: { metal: 'Blackiron', colour: 'B0B3B5' } };
  assert.equal(weaponMaterial(look).key, 'forged:B0B3B5:-');
  assert.equal(weaponMaterial(look).damage, iron.damage);
  assert.deepEqual(weaponMaterial({ forged: { metal: 'Iron' } }).color, COLOURS.iron);
});

test('the held weapon hits as its stack says, and the starter sword is still iron', () => {
  assert.equal(heldWeapon(new Inventory().equipment).damage, 21.84);
  assert.equal(heldWeapon(held('shortSword', { material: 'steel' })).damage, 24);
  assert.equal(heldWeapon(held('stonePickaxe')).damage, 24.64);
  const iron = heldWeapon(held('shortSword', { material: 'iron', forged: forged('Iron', 3.5) }));
  assert.equal(iron.damage, 21);
  assert.equal(iron.material, 'forged');
  assert.equal(iron.materialName, 'Iron');
  assert.deepEqual([iron.speed, iron.staminaCost, iron.weight], [1.16, 12.36, 2.75], 'it swings like iron');
  assert.equal(heldWeapon(held('shortSword', { forged: forged('Blackiron', 4.2, '5E6568') })).damage, 25.2);
  assert.equal(heldWeapon(held('shortSword', { material: 'copper', forged: forged('Copper', 3) })).damage, 18);
  assert.equal(heldWeapon(held('shortSword', { material: 'bronze', forged: forged('Bronze', 4.25) })).damage, 25.5);
  assert.equal(heldWeapon(held('greatsword', { material: 'steel', forged: forged('Steel', 4) })).damage, 32);
  const equipment = held('shortSword', { forged: forged('Blackiron', 4.2, '5E6568') });
  assert.equal(heldWeapon(equipment), heldWeapon(equipment), 'nothing new is made frame to frame');
  assert.equal(heldWeapon({ mainHand: { id: 'torch', count: 1 } }), null);
});

test('the held key tells a forged metal apart from its tier', () => {
  assert.equal(heldKey({ id: 'shortSword' }), '');
  assert.equal(heldKey({ id: 'shortSword', material: 'steel' }), 'steel');
  assert.equal(heldKey(sword({ material: 'iron', forged: forged('Iron', 3.5) })), 'forged:iron:3.5');
  assert.equal(heldKey(sword({ forged: forged('Blackiron', 4.2, '5E6568') })), 'forged:5E6568:4.2');
});

// The figure as drawn cells, digested, so a change to any cell shows.
const view = { x0: -30, y0: -30, cols: 60, rows: 60 };
function figure(mainHand, drawn, heading) {
  const player = new Player(0, 0);
  player.heading = heading;
  player.settleCape();
  const inventory = new Inventory();
  if (mainHand) inventory.equipment.mainHand = mainHand;
  player.equipment = inventory.equipment;
  if (drawn) {
    player.combat.active = 1;
    player.combat.inHand = true;
  }
  const cells = [];
  drawFigure({}, view, player, dressFigure(player), (r, x, y, ...a) =>
    cells.push([x, y, ...a.map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))]));
  return { player, digest: createHash('sha256').update(JSON.stringify(cells)).digest('hex').slice(0, 16) };
}
// The short sword's cells at four headings, sheathed and drawn, before forged weapons.
const STARTER = {
  'false:0': 'f2310adb2a8a5b63', 'false:1.2': 'ae1916b9bfc8f92c', 'false:3.14': '44de827f2b41b1bb', 'false:-2': '35adad62c41d58a8',
  'true:0': 'b2112c63d5dfc54b', 'true:1.2': '97ed7f25e30b7bc4', 'true:3.14': 'cb8c81337d1b171c', 'true:-2': '9a7d67b8e7801671',
};

test('the starter sword and tier short swords draw exactly as before, sheathed and drawn', () => {
  for (const [key, digest] of Object.entries(STARTER)) {
    const [drawn, heading] = key.split(':');
    const angle = heading === '3.14' ? Math.PI : Number(heading);
    for (const mainHand of [null, { id: 'shortSword', count: 1, material: 'steel' }, { id: 'shortSword', count: 1, material: 'copper' }]) {
      assert.equal(figure(mainHand, drawn === 'true', angle).digest, digest, `${mainHand?.material ?? 'starter'} ${key}`);
    }
  }
});

test('a forged short sword is drawn in its metal, sheathed and drawn', () => {
  const metals = (parts) => new Set(parts.map((part) => part.mat?.color?.map(Math.round).join()));
  for (const [stack, colour] of [
    [sword({ material: 'iron', forged: forged('Iron', 3.5) }), COLOURS.iron],
    [sword({ forged: forged('Blackiron', 4.2, '5E6568') }), [0x5e, 0x65, 0x68]],
  ]) {
    const fitting = colour.map((c) => Math.round(c * 0.66)).join();
    const sheathed = figure(stack, false, 0);
    assert.notEqual(sheathed.digest, STARTER['false:0']);
    const seen = metals(dressFigure(sheathed.player));
    assert.ok(seen.has(fitting), 'the guard and pommel take its metal');
    const drawn = figure(stack, true, 0);
    assert.notEqual(drawn.digest, STARTER['true:0']);
    const parts = dressFigure(drawn.player);
    assert.ok(metals(parts).has(colour.join()), 'the blade takes its metal');
    assert.ok(metals(parts).has(fitting));
    assert.equal(parts.some((part) => part.mat === MATERIALS.blade), false, 'no plain blade is left');
  }
});

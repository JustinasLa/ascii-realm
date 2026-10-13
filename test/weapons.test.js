import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MATERIAL_IDS, WEAPON_IDS, WEAPON_MATERIALS, WEAPONS, getWeapon,
} from '../src/entities/weapons.js';
import { WEAPON_MOVESETS, getWeaponMoves } from '../src/entities/weapon-moves.js';
import { MATERIALS } from '../src/entities/materials.js';

const expectedWeapons = [
  'greatsword', 'sword-shield', 'axe', 'hammer', 'spear', 'dagger', 'bow', 'staff', 'javelin',
];
const expectedMaterials = ['stone', 'copper', 'bronze', 'iron', 'steel'];
const statNames = ['damage', 'reach', 'speed', 'staminaCost', 'weight'];

function vector(value, label) {
  assert.ok(Array.isArray(value), `${label} must be a vector`);
  assert.equal(value.length, 3, `${label} must have three coordinates`);
  assert.ok(value.every(Number.isFinite), `${label} must have finite coordinates`);
}

function color(value, label) {
  vector(value, label);
  assert.ok(value.every((channel) => channel >= 0 && channel <= 255), `${label} must be RGB`);
}

function frozenTree(value, label) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), `${label} must be immutable`);
  for (const [key, child] of Object.entries(value)) frozenTree(child, `${label}.${key}`);
}

function spritePart(part, label) {
  assert.ok(Object.hasOwn(MATERIALS, part.material), `${label} uses an unknown material`);
  if (part.glyph) assert.equal([...part.glyph].length, 1, `${label} needs a single glyph`);
  switch (part.shape) {
    case 'limb':
      vector(part.a, `${label}.a`);
      vector(part.b, `${label}.b`);
      for (const radius of ['ra', 'rb']) {
        assert.ok(Number.isFinite(part[radius]) && part[radius] > 0, `${label}.${radius}`);
      }
      break;
    case 'blob':
      vector(part.c, `${label}.c`);
      for (const radius of ['rx', 'ry']) {
        assert.ok(Number.isFinite(part[radius]) && part[radius] > 0, `${label}.${radius}`);
      }
      break;
    case 'panel':
      assert.equal(part.points.length, 4, `${label} panel needs four corners`);
      for (const point of part.points) vector(point, `${label}.corner`);
      break;
    default:
      assert.fail(`${label} uses an unknown shape ${part.shape}`);
  }
}

test('all nine weapon definitions contain usable stats, colours, grips, sprites and sheath poses', () => {
  assert.deepEqual([...WEAPON_IDS], expectedWeapons);
  assert.deepEqual(Object.keys(WEAPONS).sort(), [...expectedWeapons].sort());

  for (const id of WEAPON_IDS) {
    const weapon = getWeapon(id);
    assert.equal(weapon.id, id);
    assert.equal(weapon.material, 'steel');
    for (const stat of statNames) {
      assert.ok(Number.isFinite(weapon[stat]) && weapon[stat] > 0, `${id}.${stat}`);
      assert.equal(weapon.stats[stat], weapon[stat], `${id}.stats.${stat}`);
    }
    color(weapon.trailColor, `${id}.trailColor`);
    color(weapon.materialColor, `${id}.materialColor`);
    assert.ok([1, 2].includes(weapon.hands), `${id}.hands`);
    assert.equal(weapon.handedness, weapon.hands === 1 ? 'one' : 'two');
    assert.ok(weapon.spriteParts.length > 0, `${id} needs a drawable silhouette`);
    for (const [index, part] of weapon.spriteParts.entries()) spritePart(part, `${id}.spriteParts[${index}]`);
    for (const [index, part] of (weapon.shieldParts ?? []).entries()) spritePart(part, `${id}.shieldParts[${index}]`);
    if (id === 'sword-shield') assert.ok(weapon.shieldParts.length > 0, 'sword and shield needs a shield');
    if (id === 'bow') {
      vector(weapon.quiver.mount, 'bow.quiver.mount');
      assert.ok(weapon.quiver.radius > 0 && weapon.quiver.length > 0);
      assert.ok(Number.isInteger(weapon.quiver.arrowCount) && weapon.quiver.arrowCount > 0);
    }
    for (const point of ['hand', 'blade', 'guard', 'tip', 'pommel']) {
      vector(weapon.sheath[point], `${id}.sheath.${point}`);
    }
    assert.ok(Math.hypot(...weapon.sheath.blade) > 0, `${id} needs a sheath blade direction`);
    assert.ok(weapon.combo.length > 0, `${id} needs a light combo`);
    for (const move of ['sprintAttack', 'airAttack', 'chargedAttack']) {
      assert.equal(typeof weapon[move], 'string', `${id}.${move}`);
      assert.ok(weapon[move].length > 0, `${id}.${move}`);
    }
  }
});

test('stone through steel improve every weapon without changing its reach or silhouette', () => {
  assert.deepEqual([...MATERIAL_IDS], expectedMaterials);
  assert.deepEqual(Object.keys(WEAPON_MATERIALS).sort(), [...expectedMaterials].sort());

  for (const id of WEAPON_IDS) {
    let previous;
    const steel = getWeapon(id, 'steel');
    for (const material of MATERIAL_IDS) {
      const weapon = getWeapon(id, material);
      assert.equal(weapon.id, id);
      assert.equal(weapon.material, material);
      assert.equal(weapon.reach, steel.reach, `${id} reach should describe its geometry`);
      assert.deepEqual(weapon.spriteParts, steel.spriteParts);
      assert.deepEqual(weapon.materialColor, WEAPON_MATERIALS[material].color);
      if (previous) {
        assert.ok(weapon.damage > previous.damage, `${id}: ${material} damage`);
        assert.ok(weapon.speed > previous.speed, `${id}: ${material} speed`);
        assert.ok(weapon.staminaCost < previous.staminaCost, `${id}: ${material} stamina cost`);
        assert.ok(weapon.weight < previous.weight, `${id}: ${material} weight`);
      }
      previous = weapon;
    }
  }
});

test('tier resolution preserves the steel definitions and other resolved profiles', () => {
  const definitions = structuredClone(WEAPONS);
  const bronze = getWeapon('spear', 'bronze');
  const before = structuredClone(bronze);

  for (const id of WEAPON_IDS) {
    for (const material of MATERIAL_IDS) getWeapon(id, material);
  }
  assert.deepEqual(WEAPONS, definitions);
  assert.deepEqual(bronze, before);
  assert.deepEqual(getWeapon('spear', 'bronze'), before);
  assert.equal(getWeapon('spear', 'steel').damage, WEAPONS.spear.damage);
});

test('catalogues and resolved profiles prevent nested state from leaking between consumers', () => {
  frozenTree(WEAPON_IDS, 'WEAPON_IDS');
  frozenTree(MATERIAL_IDS, 'MATERIAL_IDS');
  frozenTree(WEAPONS, 'WEAPONS');
  frozenTree(WEAPON_MATERIALS, 'WEAPON_MATERIALS');

  const weapon = getWeapon('dagger', 'copper');
  frozenTree(weapon, 'resolved dagger');
  const before = structuredClone(weapon);
  assert.throws(() => { weapon.damage = 999; }, TypeError);
  assert.throws(() => { weapon.sheath.guard[0] = 999; }, TypeError);
  assert.throws(() => { weapon.spriteParts.push({}); }, TypeError);
  assert.deepEqual(getWeapon('dagger', 'copper'), before);
});

test('missing and invalid selections fall back independently to greatsword and steel', () => {
  assert.deepEqual(getWeapon(), getWeapon('greatsword', 'steel'));

  for (const invalid of [undefined, null, '', 'unknown', 'constructor', '__proto__', 'toString', 7, true, {}, []]) {
    const weaponFallback = getWeapon(invalid, 'bronze');
    assert.equal(weaponFallback.id, 'greatsword');
    assert.equal(weaponFallback.material, 'bronze');
    assert.deepEqual(weaponFallback, getWeapon('greatsword', 'bronze'));

    const materialFallback = getWeapon('bow', invalid);
    assert.equal(materialFallback.id, 'bow');
    assert.equal(materialFallback.material, 'steel');
    assert.deepEqual(materialFallback, getWeapon('bow', 'steel'));
  }
});

test('weapon silhouettes differ and the catalogue covers back, hip and quiver mounts', () => {
  const silhouettes = new Set();
  const mounts = new Set();
  for (const id of WEAPON_IDS) {
    const weapon = getWeapon(id);
    silhouettes.add(JSON.stringify(weapon.spriteParts));
    mounts.add(weapon.sheath.mount);
  }
  assert.equal(silhouettes.size, WEAPON_IDS.length, 'every weapon needs a distinct silhouette');
  for (const mount of ['back', 'hip', 'quiver']) {
    assert.ok(mounts.has(mount), `missing ${mount} sheath mount`);
  }
});

test('each catalogue attack resolves to a complete moveset with valid pose references', () => {
  assert.deepEqual(Object.keys(WEAPON_MOVESETS).sort(), [...expectedWeapons].sort());
  for (const id of WEAPON_IDS) {
    const weapon = getWeapon(id);
    const moveset = getWeaponMoves(weapon);
    assert.deepEqual(moveset.comboNames, weapon.combo, `${id} light combo must match its catalogue`);
    assert.ok(moveset.chargeDuration > 0 && Number.isFinite(moveset.chargeDuration), `${id}.chargeDuration`);
    for (const name of ['draw', 'sheathe', 'charge', ...weapon.combo,
      weapon.sprintAttack, weapon.airAttack, weapon.chargedAttack]) {
      assert.ok(moveset.moves[name], `${id} is missing move ${name}`);
    }
    for (const [name, move] of Object.entries(moveset.moves)) {
      assert.ok(move.steps.length > 0, `${id}.${name} has no animation steps`);
      assert.ok(move.steps.some((step) => step.time > 0), `${id}.${name} needs time to animate`);
      for (const step of move.steps) {
        const pose = moveset.keys[step.key];
        assert.ok(pose, `${id}.${name} references missing pose ${step.key}`);
        vector(pose.hand, `${id}.${name}.${step.key}.hand`);
        vector(pose.blade, `${id}.${name}.${step.key}.blade`);
        assert.ok(Math.hypot(...pose.blade) > 0, `${id}.${name} needs a blade direction`);
        // Charge holds its key until release, and a combo can enter contact
        // immediately with no extra preparation step.
        if (name === 'charge') assert.equal(step.time, Infinity, `${id} charge should hold until release`);
        else assert.ok(Number.isFinite(step.time) && step.time >= 0, `${id}.${name} step time`);
        assert.ok(Number.isFinite(step.rate) && step.rate > 0, `${id}.${name} step rate`);
      }
    }
  }
});

test('every weapon has distinct attack timing and body poses', () => {
  const signatures = new Set();
  for (const id of WEAPON_IDS) {
    const weapon = getWeapon(id);
    const moveset = getWeaponMoves(weapon);
    const attacks = [...weapon.combo, weapon.sprintAttack, weapon.airAttack, weapon.chargedAttack];
    signatures.add(JSON.stringify(attacks.map((name) => moveset.moves[name].steps.map((step) => ({
      pose: moveset.keys[step.key], time: step.time, trail: !!step.trail,
    })))));
  }
  assert.equal(signatures.size, WEAPON_IDS.length, 'attack differences must go beyond their names');
});

test('moveset resolution accepts profiles and safely falls back for invalid selections', () => {
  const fallback = getWeaponMoves('greatsword');
  assert.deepEqual(getWeaponMoves(), fallback);
  for (const id of WEAPON_IDS) {
    assert.deepEqual(getWeaponMoves(getWeapon(id, 'stone')), getWeaponMoves(id));
  }
  for (const invalid of [undefined, null, '', 'unknown', 'constructor', '__proto__', 'toString', 7, true, {}, []]) {
    assert.deepEqual(getWeaponMoves(invalid), fallback);
    assert.deepEqual(getWeaponMoves({ id: invalid }), fallback);
  }
});

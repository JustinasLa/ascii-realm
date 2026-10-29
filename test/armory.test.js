import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// The browser import map, in Node: `three` is the vendored build, so the
// armory loads from its own file and counts towards coverage.
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
registerHooks({ resolve: (specifier, context, next) => (specifier === 'three' ? { url: threeURL, shortCircuit: true } : next(specifier, context)) });
const THREE = await import('three');
const { Armory } = await import('../src/entities/armory.js');

function rig() {
  const model = new THREE.Group();
  const bones = {};
  for (const name of ['DEF-hand.R', 'DEF-hand.L', 'DEF-spine.003', 'DEF-hips']) {
    const b = new THREE.Bone();
    b.name = THREE.PropertyBinding.sanitizeNodeName(name);
    bones[b.name] = b;
    model.add(b);
  }
  return { model, bones, hand: bones[THREE.PropertyBinding.sanitizeNodeName('DEF-hand.R')] };
}

test('every weapon kind gets its own mesh, drawn in hand or put away', () => {
  const { model, bones, hand } = rig();
  const armory = new Armory(model, bones);
  const parts = {};
  for (const type of ['sword', 'sword-shield', 'greatsword', 'axe', 'hammer', 'pickaxe', 'spear', 'javelin', 'dagger', 'staff', 'bow']) {
    armory.update({ type, material: 'iron' }, false);
    assert.equal(armory.held, null, `${type} put away`);
    assert.equal(armory.active.parent, type === 'sword' || type === 'sword-shield' || type === 'dagger' ? armory.hip : armory.back);
    armory.update({ type, material: 'iron' }, true);
    assert.equal(armory.held, armory.active);
    assert.equal(armory.active.parent, hand);
    assert.equal(armory.active.rotation.y, type === 'bow' ? Math.PI / 2 : 0);
    parts[type] = armory.active.children.length;
  }
  assert.equal('sword-shield' in armory.weapons, false, 'sword and shield share the sword');
  assert.equal(parts.pickaxe, 4, 'haft, pick, peen and collar');
  assert.deepEqual(armory.weapons.pickaxe.userData.tip.toArray(), [0, 0.7, 0]);
  // The same weapon again changes nothing; none at all hides the last one.
  const active = armory.active;
  armory.update({ type: 'bow', material: 'iron' }, true);
  assert.equal(armory.active, active);
  armory.update(null, false);
  assert.equal(armory.active, null);
  assert.equal(active.visible, false);
  assert.equal(armory.held, null);
});

test('metal parts take the material colour, and go back to plain when it is gone', () => {
  const { model, bones } = rig();
  const armory = new Armory(model, bones);
  armory.update({ type: 'pickaxe', material: 'stone', materialColor: [120, 120, 120] }, true);
  const [metal] = armory.active.userData.metal;
  const tinted = metal.mesh.material.color.clone();
  assert.notDeepEqual(tinted.toArray(), metal.color.toArray());
  armory.update({ type: 'pickaxe', material: 'iron' }, true);
  assert.deepEqual(metal.mesh.material.color.toArray(), metal.color.toArray());
});

test('a forged blade re-tints when its metal changes, and not frame to frame', async () => {
  const { getWeapon, weaponMaterial } = await import('../src/entities/weapons.js');
  const forged = (colour, attackDamage) => ({ id: 'shortSword', material: colour ? undefined : 'iron',
    forged: { metal: 'Blackiron', ...(colour ? { colour } : {}), quality: 'rusted', hits: 0, stats: { attackDamage }, inputs: { ironIngot: 4 } } });
  const { model, bones } = rig();
  const armory = new Armory(model, bones);
  const iron = getWeapon('sword-shield', weaponMaterial(forged(null, 3.5)));
  armory.update(getWeapon('sword-shield', 'iron'), true);
  const [blade] = armory.active.userData.metal;
  const tierIron = blade.mesh.material.color.clone();
  armory.update(iron, true);
  assert.notEqual(armory.signature, 'sword:iron:true');
  assert.deepEqual(blade.mesh.material.color.toArray(), tierIron.toArray(), 'forged iron looks like iron');
  const alloy = getWeapon('sword-shield', weaponMaterial(forged('5E6568', 4.2)));
  armory.update(alloy, true);
  assert.equal(armory.signature, 'sword:forged:5E6568:4.2:true');
  const tinted = blade.mesh.material.color.clone();
  assert.notDeepEqual(tinted.toArray(), tierIron.toArray());
  blade.mesh.material.color.set(0, 0, 0);
  armory.update(alloy, true);
  assert.deepEqual(blade.mesh.material.color.toArray(), [0, 0, 0], 'the same sword again is left alone');
  armory.update(alloy, false);
  assert.deepEqual(blade.mesh.material.color.toArray(), tinted.toArray(), 'sheathed, it keeps its metal');
});

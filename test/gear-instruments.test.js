import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

// The page's import map in Node: `three` is the vendored build. Gear and the
// shapes load as files, so they count toward coverage.
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
    return next(specifier, context);
  }
`)}`);
const THREE = await import('three');
const { Gear } = await import('../src/entities/gear.js');
const { buildInstrumentShape, HOLD, INSTRUMENT_SHAPES } = await import('../src/entities/instrument-shapes.js');
const { INSTRUMENT_IDS } = await import('../src/audio/instruments.js');

// A rest-pose skeleton with the three bones the gear rides on.
function rig() {
  const model = new THREE.Group();
  const bones = {};
  for (const [name, at] of [['DEF-head', [0, 1.67, 0]], ['DEF-spine003', [0, 1.43, 0]], ['DEF-forearmL', [0.5, 1.49, 0]]]) {
    const bone = new THREE.Bone();
    bone.position.set(...at);
    model.add(bone);
    bones[name] = bone;
  }
  // A two-vertex skin, one vertex on the forearm and one on the chest, so the
  // gear paints it by region; a joint marker is left unpainted.
  const list = Object.entries(bones).map(([name, bone]) => { bone.name = name.replace(/L$/, '.L'); return bone; });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0.5, 1.49, 0, 0, 1.67, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 2, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([0.2, 0.8, 0, 0, 1, 0, 0, 0], 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshLambertMaterial());
  skin.bind(new THREE.Skeleton(list));
  const joint = new THREE.SkinnedMesh(geometry.clone(), new THREE.MeshLambertMaterial());
  joint.material.userData.joint = true;
  model.add(skin, joint);
  model.updateMatrixWorld(true);
  return { model, bones, skin, gear: new Gear(model, bones) };
}

const shown = gear => [...gear.instruments].filter(([, shape]) => shape?.visible).map(([id]) => id);
const size = object => new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());

test('each of the nine instruments has its own simple held shape', () => {
  assert.deepEqual([...INSTRUMENT_SHAPES].sort(), [...INSTRUMENT_IDS].sort());
  const signatures = new Set();
  for (const id of INSTRUMENT_SHAPES) {
    const shape = buildInstrumentShape(THREE, id);
    assert.ok(shape.isGroup, id);
    assert.equal(shape.name, `instrument:${id}`);
    assert.ok(shape.children.length >= 2, id);
    const extent = size(shape);
    assert.ok(Math.max(extent.x, extent.y, extent.z) <= 0.75, `${id} fits in the hand`);
    assert.ok(Math.min(extent.x, extent.y, extent.z) >= 0.04, `${id} is thick enough to draw`);
    signatures.add(JSON.stringify(shape.children.map(mesh => [mesh.geometry.type, mesh.material.color.getHex()])));
  }
  assert.equal(signatures.size, INSTRUMENT_SHAPES.length, 'no two shapes alike');
  assert.equal(buildInstrumentShape(THREE, 'woodenBuckler'), null);
  assert.equal(buildInstrumentShape(THREE, 'toString'), null);
});

test('the shapes hang from the hand, face to the front, while the outlaw stands', () => {
  // The standing pose's forearm, as measured: the bone points forward.
  const forearm = new THREE.Quaternion(-0.255, 0.646, 0.674, -0.252).normalize();
  const held = forearm.clone().multiply(new THREE.Quaternion(...HOLD.quaternion));
  const down = new THREE.Vector3(1, 0, 0).applyQuaternion(held);
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(held);
  assert.ok(down.y < -0.99, 'long axis down');
  assert.ok(front.z > 0.99, 'face forward');
  assert.deepEqual(HOLD.at, [0, 0.34, 0]);
});

test('the outlaw shows exactly the off-hand instrument, built once', () => {
  const { gear, bones } = rig();
  assert.equal(gear.offHand.parent, bones['DEF-forearmL']);
  for (const id of INSTRUMENT_IDS) {
    gear.apply({ offHand: { id } });
    assert.deepEqual(shown(gear), [id]);
    assert.equal(gear.buckler.visible, false);
  }
  assert.equal(gear.offHand.children.length, 9);
  const lute = gear.instruments.get('lute');
  gear.apply({ offHand: { id: 'flute' } });
  gear.apply({ offHand: { id: 'lute' } });
  assert.equal(gear.instruments.get('lute'), lute, 'reused, not rebuilt');
  assert.equal(gear.offHand.children.length, 9);
});

test('the buckler and an empty off hand dress as before', () => {
  const { gear } = rig();
  gear.apply({ offHand: { id: 'woodenBuckler' } });
  assert.equal(gear.buckler.visible, true);
  assert.deepEqual(shown(gear), []);
  assert.equal(gear.offHand.children.length, 0);
  gear.apply({ offHand: { id: 'lute' } });
  gear.apply({ offHand: { id: 'woodenBuckler' } });
  assert.equal(gear.buckler.visible, true);
  assert.deepEqual(shown(gear), []);
  gear.apply({ offHand: null });
  assert.equal(gear.buckler.visible, false);
  assert.deepEqual(shown(gear), []);
  gear.apply(undefined);
  assert.equal(gear.buckler.visible, false);
  assert.deepEqual(shown(gear), []);
});

test('carrying an instrument still paints the outlaw by region', () => {
  const { gear, skin } = rig();
  assert.equal(gear.painted.length, 1);
  assert.equal(gear.painted[0].mesh, skin);
  assert.deepEqual(gear.painted[0].regions, ['forearm', 'torso']);
  gear.apply({ offHand: { id: 'lute' }, helm: { id: 'hood' } });
  const colours = [...skin.geometry.attributes.color.array];
  assert.equal(colours.length, 6);
  assert.ok(colours.some(value => value > 0));
  assert.deepEqual(shown(gear), ['lute']);
});

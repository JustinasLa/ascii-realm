import { register } from 'node:module';

// The page's import map in Node: `three` is the vendored build. Gear and the
// shapes load as files, so they count toward coverage.
const threeURL = new URL('../../vendor/three/three.module.min.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
    return next(specifier, context);
  }
`)}`);
export const THREE = await import('three');
export const { Gear } = await import('../../src/entities/gear.js');

// A rest-pose skeleton with the three bones the gear rides on, plus any
// `extra` bones by name.
export function rig(extra = []) {
  const model = new THREE.Group();
  const bones = {};
  for (const [name, at] of [['DEF-head', [0, 1.67, 0]], ['DEF-spine003', [0, 1.43, 0]], ['DEF-forearmL', [0.5, 1.49, 0]],
    ...extra.map((name) => [name, [0, 1, 0]])]) {
    const bone = new THREE.Bone();
    bone.position.set(...at);
    model.add(bone);
    bones[name] = bone;
  }
  // A two-vertex skin, one vertex on the forearm and one on the chest, so the
  // gear paints it by region, then one vertex on each extra bone; a joint
  // marker is left unpainted.
  const list = Object.entries(bones).map(([name, bone]) => { bone.name = name.replace(/L$/, '.L'); return bone; });
  const vertices = [[2, 0, 0.8, 0.2], [1, 0, 1, 0], ...extra.map((_, i) => [3 + i, 0, 1, 0])];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(() => [0, 1, 0]), 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(vertices.flatMap(([a, b]) => [a, b, 0, 0]), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(vertices.flatMap(([, , wa, wb]) => [wa, wb, 0, 0]), 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshLambertMaterial());
  skin.bind(new THREE.Skeleton(list));
  const joint = new THREE.SkinnedMesh(geometry.clone(), new THREE.MeshLambertMaterial());
  joint.material.userData.joint = true;
  model.add(skin, joint);
  model.updateMatrixWorld(true);
  return { model, bones, skin, gear: new Gear(model, bones) };
}

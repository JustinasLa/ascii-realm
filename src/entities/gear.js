import * as THREE from 'three';
import { wears } from './loadout.js';

// What the outlaw wears on the 3D character. The mannequin is one plain
// mesh, so clothing is painted onto it by body region, each vertex taking
// the region of the bone that moves it most, and the hood, cloak, buckler
// and hair are simple shapes riding on the bones. The hands' gear follows
// the inventory's equipment slots; the clothes are always worn for now.

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);

// Undyed wool, worn leather and skin, matching the shape-built figure.
const COLORS = {
  jerkin: 0x6c4e34,
  tunic: 0x5c4a3c,
  linen: 0x968e7c,
  hose: 0x484852,
  boot: 0x4e3828,
  leather: 0x563c2a,
  bracer: 0x5a402a,
  skin: 0x967660,
  hood: 0x46444a,
  cloak: 0x3a3840,
  hair: 0x342820,
  wood: 0x84623e,
  iron: 0x70747c,
};

const REGION_OF = [
  [/head|neck/, 'head'],
  [/upper_arm/, 'upperArm'],
  [/forearm/, 'forearm'],
  [/hand|f_|thumb/, 'hand'],
  [/thigh/, 'thigh'],
  [/shin/, 'shin'],
  [/foot|toe/, 'foot'],
  [/hips|spine|shoulder/, 'torso'],
];

// The colour of each body region for the gear being worn.
export function regionColors(equipment) {
  const wearing = (slot) => wears(equipment, slot);
  const sleeve = wearing('chest') ? 'tunic' : 'linen';
  return {
    head: wearing('helm') ? 'hood' : 'skin',
    torso: wearing('chest') ? 'jerkin' : 'linen',
    upperArm: sleeve,
    forearm: wearing('hands') ? 'bracer' : sleeve,
    hand: wearing('hands') ? 'leather' : 'skin',
    thigh: 'hose',
    shin: wearing('legs') ? 'boot' : 'hose',
    foot: wearing('legs') ? 'boot' : 'leather',
  };
}

function mesh(geometry, color) {
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
}

export class Gear {
  // `model` and `bones` come straight from the loaded character, still in
  // its rest pose, so pieces can be placed in model space.
  constructor(model, bones) {
    this.bones = bones;
    this.painted = [];
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isSkinnedMesh || o.material?.userData?.joint) return;
      const { skinIndex, skinWeight } = o.geometry.attributes;
      const regions = new Array(skinIndex.count);
      for (let i = 0; i < skinIndex.count; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
        const name = o.skeleton.bones[skinIndex.getComponent(i, best)]?.name ?? '';
        regions[i] = REGION_OF.find(([pattern]) => pattern.test(name))?.[1] ?? 'torso';
      }
      o.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skinIndex.count * 3), 3));
      o.material.color.set(0xffffff);
      o.material.vertexColors = true;
      o.material.needsUpdate = true;
      this.painted.push({ mesh: o, regions });
    });

    const head = bones[bone('DEF-head')];
    const chest = bones[bone('DEF-spine.003')];
    const forearm = bones[bone('DEF-forearm.L')];

    // A hood open at the face, a peak pulled over the brow, a tail down the
    // back and a short cape over the shoulders.
    this.hood = new THREE.Group();
    const cowl = mesh(new THREE.SphereGeometry(0.185, 18, 12, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7), COLORS.hood);
    cowl.material.side = THREE.DoubleSide;
    const peak = mesh(new THREE.ConeGeometry(0.06, 0.12, 10), COLORS.hood);
    peak.position.set(0, 0.18, -0.03);
    peak.rotation.x = -0.35;
    const tail = mesh(new THREE.ConeGeometry(0.05, 0.32, 8), COLORS.hood);
    tail.position.set(0, -0.14, -0.17);
    tail.rotation.x = Math.PI - 0.35;
    this.hood.add(cowl, peak, tail);
    this.attach(this.hood, head, [0, 1.67, -0.02]);
    this.capelet = mesh(new THREE.CylinderGeometry(0.11, 0.25, 0.16, 16, 1, true), COLORS.hood);
    this.capelet.material.side = THREE.DoubleSide;
    this.attach(this.capelet, chest, [0, 1.43, -0.01]);

    this.hair = mesh(new THREE.SphereGeometry(0.172, 14, 8, 0, Math.PI * 2, 0, 1.2), COLORS.hair);
    this.attach(this.hair, head, [0, 1.675, -0.02]);

    // The cloak hangs from the shoulders to the calves behind the back.
    const cloakShape = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(-0.32, -0.95, -0.08),
      new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(0.32, -0.95, -0.08), new THREE.Vector3(-0.32, -0.95, -0.08),
    ]);
    cloakShape.computeVertexNormals();
    this.cloak = mesh(cloakShape, COLORS.cloak);
    this.cloak.material.side = THREE.DoubleSide;
    this.attach(this.cloak, chest, [0, 1.44, -0.15]);

    // A round buckler on the back of the left forearm.
    this.buckler = new THREE.Group();
    const board = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 20), COLORS.wood);
    const rim = mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 24), COLORS.iron);
    rim.rotation.x = Math.PI / 2;
    const boss = mesh(new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.iron);
    this.buckler.add(board, rim, boss);
    this.attach(this.buckler, forearm, [0.62, 1.49, -0.068]);

    this.signature = null;
  }

  // Parents `object` to `parent` so that, in the rest pose, it sits at
  // `at` in model space with the model's own orientation.
  attach(object, parent, at) {
    const world = new THREE.Matrix4().makeTranslation(...at);
    const local = parent.matrixWorld.clone().invert().multiply(world);
    local.decompose(object.position, object.quaternion, object.scale);
    parent.add(object);
  }

  // Shows and paints what `equipment` says is worn; cheap when unchanged.
  apply(equipment) {
    const signature = equipment === undefined ? 'all'
      : ['helm', 'chest', 'legs', 'hands', 'cape', 'mainHand', 'offHand'].map((s) => equipment?.[s]?.id ?? '').join();
    if (signature === this.signature) return;
    this.signature = signature;
    const wearing = (slot) => wears(equipment, slot);
    this.hood.visible = wearing('helm');
    this.capelet.visible = wearing('helm');
    this.hair.visible = !wearing('helm');
    this.cloak.visible = wearing('cape');
    this.buckler.visible = equipment?.offHand?.id === 'woodenBuckler';
    const regions = regionColors(equipment);
    const color = new THREE.Color();
    for (const { mesh: o, regions: of } of this.painted) {
      const out = o.geometry.attributes.color;
      for (let i = 0; i < of.length; i++) {
        color.set(COLORS[regions[of[i]]]);
        out.setXYZ(i, color.r, color.g, color.b);
      }
      out.needsUpdate = true;
    }
  }
}

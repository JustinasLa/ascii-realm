import * as THREE from 'three';

// The outlaw's weapons on the 3D character, one simple shape per kind. A
// drawn weapon rides in the right hand (the bow in the left); otherwise it is
// slung across the back, or worn at the hip for the short sword and dagger.

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);
const WOOD = 0x6e5236;
const GRIP = 0x3a2a1e;

function box(w, h, d, color, y = 0, x = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, 0);
  return mesh;
}

function rod(length, radius, color, from = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8),
    new THREE.MeshLambertMaterial({ color }));
  mesh.position.y = from + length / 2;
  return mesh;
}

function point(radius, height, color, y) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 8), new THREE.MeshLambertMaterial({ color }));
  mesh.position.y = y;
  return mesh;
}

// Each weapon is built along +y from its grip; `metal` marks the parts the
// material tier tints. `tip`/`base` bound its cutting edge, for the trail.
function build(type) {
  const g = new THREE.Group();
  const metal = [];
  const add = (mesh, isMetal = false) => {
    g.add(mesh);
    if (isMetal) metal.push(mesh);
    return mesh;
  };
  let base = 0.08;
  let tip = 0.77;
  switch (type) {
    case 'greatsword':
      add(box(0.05, 1.0, 0.012, 0xd8e0f0, 0.6), true);
      add(box(0.26, 0.03, 0.035, 0x8a8a90, 0.09), true);
      add(box(0.035, 0.26, 0.035, GRIP, -0.05));
      base = 0.1; tip = 1.1;
      break;
    case 'axe':
      add(rod(0.85, 0.018, WOOD, -0.15));
      add(box(0.16, 0.14, 0.02, 0xc0c6d0, 0.6, 0.08), true);
      base = 0.5; tip = 0.7;
      break;
    case 'hammer':
      add(rod(0.85, 0.02, WOOD, -0.15));
      add(box(0.22, 0.11, 0.11, 0x9aa0aa, 0.66), true);
      base = 0.55; tip = 0.72;
      break;
    case 'pickaxe':
      // An arched head: a pick on one side, a blunt peen on the other.
      add(rod(0.85, 0.018, WOOD, -0.15));
      add(box(0.2, 0.035, 0.035, 0x9aa0aa, 0.64, -0.09), true).rotation.z = 0.3;
      add(box(0.2, 0.035, 0.035, 0x9aa0aa, 0.64, 0.09), true).rotation.z = -0.3;
      add(box(0.05, 0.05, 0.05, 0x8a8a90, 0.64), true);
      base = 0.55; tip = 0.7;
      break;
    case 'spear':
      add(rod(1.7, 0.016, WOOD, -0.5));
      add(point(0.035, 0.18, 0xc8d4dc, 1.29), true);
      base = 0.9; tip = 1.38;
      break;
    case 'javelin':
      add(rod(1.15, 0.013, WOOD, -0.3));
      add(point(0.028, 0.12, 0xc8d4dc, 0.91), true);
      base = 0.6; tip = 0.97;
      break;
    case 'dagger':
      add(box(0.03, 0.26, 0.01, 0xd8e0f0, 0.21), true);
      add(box(0.11, 0.02, 0.025, 0x8a8a90, 0.07), true);
      add(box(0.025, 0.09, 0.025, GRIP, 0.02));
      base = 0.08; tip = 0.34;
      break;
    case 'staff':
      add(rod(1.6, 0.02, WOOD, -0.6));
      add(rod(0.05, 0.025, 0x8a8a90, 0.95), true);
      add(rod(0.05, 0.025, 0x8a8a90, -0.6), true);
      base = 0.5; tip = 1.0;
      break;
    case 'bow': {
      // A tall stave held at its middle, across the fingers: two gently
      // bent limbs, and the string a hand's breadth behind the grip.
      const limb = (sign) => {
        const mesh = rod(0.75, 0.014, WOOD);
        mesh.position.set(0, 0, 0);
        mesh.geometry.translate(0, 0.375, 0);
        mesh.rotation.z = sign * (Math.PI / 2 + 0.18);
        return mesh;
      };
      add(limb(1));
      add(limb(-1));
      const string = box(1.46, 0.004, 0.004, 0xd8d0c0, -0.13);
      add(string);
      base = 0; tip = 0;
      break;
    }
    default:
      // The short sword.
      add(box(0.035, 0.7, 0.012, 0xd8e0f0, 0.42), true);
      add(box(0.18, 0.025, 0.03, 0x8a8a90, 0.07), true);
      add(box(0.03, 0.12, 0.03, GRIP, 0));
  }
  g.userData.base = new THREE.Vector3(0, base, 0);
  g.userData.tip = new THREE.Vector3(0, tip, 0);
  g.userData.metal = metal.map((m) => ({ mesh: m, color: m.material.color.clone() }));
  g.visible = false;
  return g;
}

export class Armory {
  // Set up with the character in its rest pose, like the gear.
  constructor(model, bones) {
    this.hands = { R: bones[bone('DEF-hand.R')], L: bones[bone('DEF-hand.L')] };
    model.updateMatrixWorld(true);
    // Mount points in model space: across the back, and at the left hip.
    this.back = this.mount(model, bones[bone('DEF-spine.003')], [0.04, 1.2, -0.17], -2.45);
    this.hip = this.mount(model, bones[bone('DEF-hips')], [-0.17, 0.92, 0.04], Math.PI - 0.25);
    this.weapons = {};
    this.active = null;
    this.signature = null;
  }

  mount(model, parent, at, roll) {
    const anchor = new THREE.Group();
    const world = new THREE.Matrix4().makeTranslation(...at).multiply(new THREE.Matrix4().makeRotationZ(roll));
    parent.matrixWorld.clone().invert().multiply(world).decompose(anchor.position, anchor.quaternion, anchor.scale);
    parent.add(anchor);
    return anchor;
  }

  // Shows `weapon` (a profile from weapons.js, or null) drawn or put away.
  update(weapon, drawn) {
    const type = weapon?.type === 'sword-shield' ? 'sword' : weapon?.type ?? null;
    const signature = `${type}:${weapon?.materialKey ?? weapon?.material}:${drawn}`;
    if (signature === this.signature) return;
    this.signature = signature;
    if (this.active) this.active.visible = false;
    this.active = null;
    if (!type) return;
    const mesh = this.weapons[type] ??= build(type);
    for (const { mesh: part, color } of mesh.userData.metal) {
      part.material.color.copy(color);
      if (weapon.materialColor) part.material.color.lerp(new THREE.Color(...weapon.materialColor.map((c) => c / 255)), 0.55);
    }
    const hand = this.hands.R;
    const parent = drawn ? hand : type === 'sword' || type === 'dagger' ? this.hip : this.back;
    parent.add(mesh);
    mesh.position.set(0, drawn ? 0.08 : 0, drawn ? 0.02 : 0);
    // A drawn bow stands upright in the extended hand.
    mesh.rotation.set(0, drawn && type === 'bow' ? Math.PI / 2 : 0, 0);
    mesh.visible = true;
    this.active = mesh;
    this.drawn = drawn;
  }

  // The weapon in hand, if any, for the blade's trail.
  get held() {
    return this.active?.visible && this.drawn ? this.active : null;
  }
}

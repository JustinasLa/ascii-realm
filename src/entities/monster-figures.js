import * as THREE from 'three';
import { clone as cloneSkinned } from '../../vendor/three/utils/SkeletonUtils.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { Armory } from './armory.js';
import { outline } from './model.js';
import { SCALE, TILT } from './rig.js';
import { getWeapon } from './weapons.js';

// Monsters drawn the same way as the player: a rigged 3D figure playing the
// animation library's clips, rendered from the game's camera into a small
// image and turned into character cells. A skeleton hides the mannequin's
// skin and hangs bones on its armature instead: a skull with ember eyes,
// ribs, a pelvis and long thin limbs. A goblin keeps the skin, painted green
// with a ragged loincloth, shrunk to a little over a metre, with a big head,
// long ears and nose and yellow eyes. A troll is the same skin grown to
// two and a half metres, mossy grey, hunched over broad shoulders and a
// small head with tusks, swinging a stone club. An elf is tall and pale in
// a green hooded tunic, with long swept-back ears and a bow. One offscreen
// renderer serves every monster, each drawn into its own slot of the image,
// read back in one go.

const SX = 4;
const SY = 6;
const N = SX * SY;
// Each slot, in cells: wide enough for a troll lying full length across the
// screen, tall enough for its club raised overhead, and deep enough for one
// fallen towards the camera.
const COLS = 64;
const ROWS = 52;
const FEET_ROW = 38;
// At most this many are drawn, nearest the player first.
export const MAX_DRAWN = 4;
const FOOT_FLOOR = 0.1;
const COS = Math.sqrt(1 - TILT * TILT);

const RAMP = [...' .:-=+*#%@'].map(glyph);
const RIM = [214, 222, 236];
const BONE = 0xd9d0b4;
const KNUCKLE = 0xa89f88;
const EMBER = 0xff5a1e;
// The colours of each skinned kind: skin, the hide or cloth round its hips,
// and, where they differ from the skin, its torso, arms, legs, hands and
// feet; its glowing eyes, and anything bony such as tusks.
const PALETTES = {
  goblin: { skin: 0x6b8a3c, dark: 0x4c6630, cloth: 0x5c4630, eye: 0xffdc28 },
  troll: { skin: 0x7c8268, dark: 0x5c6150, cloth: 0x5e4834, eye: 0xffa020, tusk: 0xe6dcc0 },
  elf: { skin: 0xdccbb0, hands: 0xdccbb0, feet: 0x4a3828, cloth: 0x3c5634, torso: 0x45663a, arms: 0x45663a,
    legs: 0x5a4a36, hood: 0x3a5532 },
};

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);
const RUSTED_SWORD = { ...getWeapon('sword-shield', 'copper'), materialColor: [120, 84, 58] };
const NOTCHED_DAGGER = { ...getWeapon('dagger', 'copper'), materialColor: [150, 110, 70] };
const STONE_CLUB = { ...getWeapon('hammer', 'copper'), materialColor: [128, 124, 112] };
const LONGBOW = getWeapon('bow', 'steel');

// How each kind looks and moves: its clips, its size, how some bones are
// scaled (a goblin's big head, a troll's broad shoulders and small head),
// what is hung on it, and the weapon in its hand and how big that is.
const LOOKS = {
  skeleton: {
    clips: { idle: 'Sword_Idle', walk: 'Walk_Loop', run: 'Sprint_Loop', attack: 'Sword_Attack', hit: 'Hit_Chest',
      death: 'Death01' },
    skinned: false,
    scale: 1,
    bones: {},
    weapon: RUSTED_SWORD,
    weaponScale: 1,
  },
  goblin: {
    clips: { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Sprint_Loop', attack: 'Punch_Jab', hit: 'Hit_Head',
      death: 'Death01' },
    skinned: true,
    scale: 0.62,
    bones: { 'DEF-head': 1.35 },
    weapon: NOTCHED_DAGGER,
    weaponScale: 1,
  },
  troll: {
    // The arms are posed by hand round the two-handed club (see wield); the
    // attack clip is a crouch the body drops into as the club comes down.
    clips: { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', attack: 'Crouch_Idle_Loop', hit: 'Hit_Chest',
      death: 'Death01' },
    skinned: true,
    scale: 1.45,
    // Scaling the chest scales everything above it too: the shoulders and
    // arms broaden, so the head is shrunk back down past its own size.
    bones: { 'DEF-spine.003': 1.22, 'DEF-head': 0.62, 'DEF-forearm.L': 1.15, 'DEF-forearm.R': 1.15 },
    weapon: STONE_CLUB,
    weaponScale: 1.05,
    twoHanded: true,
  },
  elf: {
    // Drawing the bow raises both arms towards the target.
    clips: { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Sprint_Loop', attack: 'Pistol_Aim_Neutral',
      hit: 'Hit_Head', death: 'Death01' },
    skinned: true,
    scale: 1.06,
    bones: { 'DEF-head': 0.94 },
    weapon: LONGBOW,
    weaponScale: 1,
  },
};

// The two-handed club's swing, as the angle of the club above the forward
// horizontal: carried slanting back over the shoulder, heaved up behind the
// head, then brought down in front until its head meets the ground.
const DEG = Math.PI / 180;
const CARRY = 115 * DEG;
const HEAVE = 168 * DEG;
const SMASH = -45 * DEG;
// Along the club from the grip, in its own units: the head, and where each
// hand holds the haft (the right above the left).
const CLUB_HEAD = 0.72;
const UPPER_HAND = 0.1;
const LOWER_HAND = -0.07;
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);

// Where the club is in its swing `t` seconds into a smash.
function swingAngle(t, kind) {
  const w = kind.windUp;
  const lift = w * 0.7;
  if (t < lift) return CARRY + (HEAVE - CARRY) * (1 - (1 - t / lift) ** 2);
  // Gathering speed all the way down.
  if (t < w) return HEAVE + (SMASH - HEAVE) * ((t - lift) / (w - lift)) ** 2;
  if (t < w + 0.35) return SMASH;
  return SMASH + (CARRY - SMASH) * smooth(Math.min(1, (t - w - 0.35) / Math.max(0.01, kind.swingTime - w - 0.35)));
}

// How far the body has dropped into a crouch `t` seconds into a smash:
// upright while heaving the club up, sinking as it comes down, and rising
// again once it has struck.
function smashCrouch(t, kind) {
  const w = kind.windUp;
  if (t < w * 0.6) return 0;
  if (t < w) return smooth((t - w * 0.6) / (w * 0.4));
  if (t < w + 0.35) return 1;
  return 1 - smooth(Math.min(1, (t - w - 0.35) / Math.max(0.01, kind.swingTime - w - 0.35)));
}

// Turns a bone so its world orientation becomes `world`.
function setWorldQuaternion(b, world) {
  const parent = b.parent.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(parent.invert().multiply(world));
  b.updateMatrixWorld(true);
}

// Two-bone IK: bends the elbow and swings the upper arm so the hand reaches
// `target`, a world position, keeping the arm in its current plane.
function reachWith(arm, target) {
  const A = arm.upper.getWorldPosition(new THREE.Vector3());
  const B = arm.fore.getWorldPosition(new THREE.Vector3());
  const C = arm.hand.getWorldPosition(new THREE.Vector3());
  const a = A.distanceTo(B);
  const b = B.distanceTo(C);
  const d = Math.min(A.distanceTo(target), a + b - 1e-4);
  const BA = A.clone().sub(B).normalize();
  const BC = C.clone().sub(B).normalize();
  const axis = new THREE.Vector3().crossVectors(BA, BC);
  if (axis.lengthSq() > 1e-10) {
    axis.normalize();
    const now = Math.acos(Math.max(-1, Math.min(1, BA.dot(BC))));
    const want = Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - d * d) / (2 * a * b))));
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, want - now);
    setWorldQuaternion(arm.fore, turn.multiply(arm.fore.getWorldQuaternion(new THREE.Quaternion())));
  }
  const C2 = arm.hand.getWorldPosition(new THREE.Vector3());
  const swing = new THREE.Quaternion().setFromUnitVectors(C2.sub(A).normalize(), target.clone().sub(A).normalize());
  setWorldQuaternion(arm.upper, swing.multiply(arm.upper.getWorldQuaternion(new THREE.Quaternion())));
}

// Shared, built once: bone-white and darker knuckle materials, the eyes,
// and the goblin's painted skin.
let materials = null;
function materialsOf() {
  materials ??= {
    bone: new THREE.MeshLambertMaterial({ color: BONE }),
    knuckle: new THREE.MeshLambertMaterial({ color: KNUCKLE }),
    socket: new THREE.MeshBasicMaterial({ color: 0x0c0806 }),
    ember: new THREE.MeshBasicMaterial({ color: EMBER }),
    painted: new THREE.MeshLambertMaterial({ vertexColors: true }),
    goblinSkin: new THREE.MeshLambertMaterial({ color: PALETTES.goblin.skin }),
    goblinEye: new THREE.MeshBasicMaterial({ color: PALETTES.goblin.eye }),
    trollSkin: new THREE.MeshLambertMaterial({ color: PALETTES.troll.skin }),
    elfSkin: new THREE.MeshLambertMaterial({ color: PALETTES.elf.skin }),
    elfHood: new THREE.MeshLambertMaterial({ color: PALETTES.elf.hood, side: THREE.DoubleSide }),
    trollEye: new THREE.MeshBasicMaterial({ color: PALETTES.troll.eye }),
    tusk: new THREE.MeshLambertMaterial({ color: PALETTES.troll.tusk }),
  };
  return materials;
}

// A rod of bone between two points in model space, hung on `parent` so it
// follows the animation.
function rod(parent, a, b, radius, material) {
  const length = a.distanceTo(b);
  const geometry = new THREE.CylinderGeometry(radius * 0.8, radius, length, 6);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.frustumCulled = false;
  parent.attach(mesh);
  return mesh;
}

function ball(parent, at, radius, material, scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), material);
  mesh.position.copy(at);
  mesh.scale.set(...scale);
  mesh.frustumCulled = false;
  parent.attach(mesh);
  return mesh;
}

function ring(parent, at, rx, rz, tube, material) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, tube, 5, 14), material);
  mesh.position.copy(at);
  mesh.rotation.x = Math.PI / 2;
  mesh.scale.set(rx, rz, 1);
  mesh.frustumCulled = false;
  parent.attach(mesh);
  return mesh;
}

// A cone from `at` pointing along `toward`, hung on `parent`.
function cone(parent, at, radius, length, toward, material) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 7), material);
  mesh.position.copy(at).addScaledVector(toward, length / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toward);
  mesh.frustumCulled = false;
  parent.attach(mesh);
  return mesh;
}

// Hangs the bones on a rig standing in its rest pose, facing +z.
function dressBones(model, bones) {
  const m = materialsOf();
  model.updateMatrixWorld(true);
  const at = (name) => bones[bone(name)].getWorldPosition(new THREE.Vector3());
  const on = (name) => bones[bone(name)];
  const hips = at('DEF-hips');
  const spine = ['DEF-hips', 'DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003', 'DEF-neck', 'DEF-head'];
  for (let i = 0; i < spine.length - 1; i++) rod(on(spine[i]), at(spine[i]), at(spine[i + 1]), 0.03, m.bone);

  // The skull, its jaw, dark sockets and the embers burning in them.
  const head = at('DEF-head');
  const skull = head.clone().add(new THREE.Vector3(0, 0.1, 0.01));
  ball(on('DEF-head'), skull, 0.105, m.bone, [0.92, 1.05, 1.08]);
  ball(on('DEF-head'), skull.clone().add(new THREE.Vector3(0, -0.085, 0.045)), 0.06, m.bone, [1.1, 0.6, 1]);
  for (const side of [-1, 1]) {
    const eye = skull.clone().add(new THREE.Vector3(side * 0.04, 0.005, 0.09));
    ball(on('DEF-head'), eye, 0.03, m.socket);
    ball(on('DEF-head'), eye.clone().add(new THREE.Vector3(0, 0, 0.012)), 0.017, m.ember);
  }

  // The ribcage narrows downwards over the chest; the pelvis is a wide hoop.
  const low = at('DEF-spine.002');
  const high = at('DEF-spine.003');
  const chest = high.clone().lerp(at('DEF-neck'), 0.35);
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const p = low.clone().lerp(chest, 0.15 + t * 0.85);
    p.z += 0.03;
    ring(on(t < 0.4 ? 'DEF-spine.002' : 'DEF-spine.003'), p, 0.1 + t * 0.045, 0.075 + t * 0.02, 0.016, m.bone);
  }
  ring(on('DEF-hips'), hips.clone().add(new THREE.Vector3(0, 0.0, 0.01)), 0.12, 0.07, 0.024, m.bone);

  for (const side of ['L', 'R']) {
    // Collarbone, arm and a small bony hand.
    rod(on('DEF-spine.003'), chest, at(`DEF-upper_arm.${side}`), 0.022, m.bone);
    rod(on(`DEF-upper_arm.${side}`), at(`DEF-upper_arm.${side}`), at(`DEF-forearm.${side}`), 0.03, m.bone);
    rod(on(`DEF-forearm.${side}`), at(`DEF-forearm.${side}`), at(`DEF-hand.${side}`), 0.026, m.bone);
    ball(on(`DEF-forearm.${side}`), at(`DEF-forearm.${side}`), 0.035, m.knuckle);
    rod(on(`DEF-hand.${side}`), at(`DEF-hand.${side}`), at(`DEF-f_middle.02.${side}`), 0.03, m.knuckle);
    // Hip joint, leg and foot.
    rod(on('DEF-hips'), hips, at(`DEF-thigh.${side}`), 0.026, m.bone);
    rod(on(`DEF-thigh.${side}`), at(`DEF-thigh.${side}`), at(`DEF-shin.${side}`), 0.036, m.bone);
    rod(on(`DEF-shin.${side}`), at(`DEF-shin.${side}`), at(`DEF-foot.${side}`), 0.032, m.bone);
    ball(on(`DEF-shin.${side}`), at(`DEF-shin.${side}`), 0.042, m.knuckle);
    rod(on(`DEF-foot.${side}`), at(`DEF-foot.${side}`), at(`DEF-toe.${side}`), 0.032, m.bone);
  }
}

// Long ears swept back, a hooked nose and yellow eyes on the goblin's head,
// in its rest pose.
function dressGoblin(model, bones) {
  const m = materialsOf();
  model.updateMatrixWorld(true);
  const head = bones[bone('DEF-head')];
  const at = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0));
  for (const side of [-1, 1]) {
    const root = at.clone().add(new THREE.Vector3(side * 0.085, 0.02, -0.01));
    cone(head, root, 0.035, 0.2, new THREE.Vector3(side, 0.35, -0.35).normalize(), m.goblinSkin);
    ball(head, at.clone().add(new THREE.Vector3(side * 0.038, 0.012, 0.088)), 0.019, m.goblinEye);
  }
  cone(head, at.clone().add(new THREE.Vector3(0, -0.02, 0.09)), 0.026, 0.09,
    new THREE.Vector3(0, -0.45, 1).normalize(), m.goblinSkin);
}

// Tusks jutting up from the jaw, a bulbous nose and small amber eyes under
// a heavy brow, on the troll's head in its rest pose.
function dressTroll(model, bones) {
  const m = materialsOf();
  model.updateMatrixWorld(true);
  const head = bones[bone('DEF-head')];
  const at = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0));
  for (const side of [-1, 1]) {
    cone(head, at.clone().add(new THREE.Vector3(side * 0.055, -0.06, 0.08)), 0.022, 0.09,
      new THREE.Vector3(side * 0.25, 1, 0.3).normalize(), m.tusk);
    ball(head, at.clone().add(new THREE.Vector3(side * 0.042, 0.03, 0.085)), 0.016, m.trollEye);
  }
  ball(head, at.clone().add(new THREE.Vector3(0, 0.0, 0.11)), 0.04, m.trollSkin, [1, 0.9, 1.1]);
  ball(head, at.clone().add(new THREE.Vector3(0, 0.06, 0.07)), 0.07, m.trollSkin, [1.5, 0.45, 0.8]);
}

// Long ears swept up and back through a hood that is open at the face, on
// the elf's head in its rest pose.
function dressElf(model, bones) {
  const m = materialsOf();
  model.updateMatrixWorld(true);
  const head = bones[bone('DEF-head')];
  const at = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0));
  for (const side of [-1, 1]) {
    cone(head, at.clone().add(new THREE.Vector3(side * 0.08, 0.01, -0.005)), 0.024, 0.2,
      new THREE.Vector3(side, 0.6, -0.3).normalize(), m.elfSkin);
  }
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10, Math.PI / 2 + 0.9, Math.PI * 2 - 1.8), m.elfHood);
  hood.position.copy(at).add(new THREE.Vector3(0, 0.01, -0.015));
  hood.frustumCulled = false;
  head.attach(hood);
}

const DRESS = { goblin: dressGoblin, troll: dressTroll, elf: dressElf };

// The mannequin's own skin, painted from a kind's palette by the bone that
// moves each vertex most: a ragged hide round the hips and thighs, darker
// hands and feet. The geometry is copied, as the player's figure paints the
// shared one with clothes.
function paintSkin(model, palette) {
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.geometry = o.geometry.clone();
    const { skinIndex, skinWeight, position } = o.geometry.attributes;
    const colors = new Float32Array(skinIndex.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < skinIndex.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
      const name = o.skeleton.bones[skinIndex.getComponent(i, best)]?.name ?? '';
      // The hem rises and falls, so the cloth looks torn.
      const hem = /thigh/.test(name) && position.getY(i) > 0.68 + 0.05 * Math.sin(position.getX(i) * 60);
      const part = /hips/.test(name) || hem ? 'cloth'
        : /hand|f_|thumb/.test(name) ? 'hands'
          : /foot|toe/.test(name) ? 'feet'
            : /spine|shoulder/.test(name) ? 'torso'
              : /upper_arm|forearm/.test(name) ? 'arms'
                : /thigh|shin/.test(name) ? 'legs' : 'skin';
      const extremity = part === 'hands' || part === 'feet';
      color.set(palette[part] ?? (extremity ? palette.dark : palette.skin)).toArray(colors, i * 3);
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    o.material = materialsOf().painted;
    o.frustumCulled = false;
  });
}

// A copy of the library's scene with only what a kind needs: the armature,
// and for a skinned kind the mannequin's skin, freshly painted. Anything the
// player's figure hung on the bones is left behind.
function prototypeOf(scene, kind) {
  const skinned = LOOKS[kind].skinned;
  const copy = skinned ? cloneSkinned(scene) : scene.clone();
  const keep = (o) => o.isBone || (skinned && o.isSkinnedMesh);
  const drop = [];
  copy.traverse((o) => {
    if (o === copy || keep(o)) return;
    let needed = false;
    o.traverse((c) => { if (c !== o && keep(c)) needed = true; });
    if (!needed) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  if (skinned) paintSkin(copy, PALETTES[kind]);
  return copy;
}

// One monster's rig: a copy of the library's armature dressed for its kind,
// its own animation mixer, and the clip weights it is blending.
class Rig {
  constructor(kind, source, clips) {
    this.kind = kind;
    this.look = LOOKS[kind];
    this.model = this.look.skinned ? cloneSkinned(source) : source.clone();
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    if (this.look.skinned) DRESS[kind](this.model, this.bones);
    else dressBones(this.model, this.bones);
    this.armory = new Armory(this.model, this.bones);
    this.armory.update(this.look.weapon, true);
    this.armory.active.scale.setScalar(this.look.weaponScale);
    this.model.scale.setScalar(this.look.scale);
    this.head = this.bones[bone('DEF-head')];
    this.scaled = Object.entries(this.look.bones).map(([name, s]) => [this.bones[bone(name)], s]);
    if (this.look.twoHanded) {
      // The club leaves the hand bone: it is placed in the swing each frame
      // and both hands are brought to its haft.
      this.club = this.armory.active;
      this.model.add(this.club);
      this.arms = ['R', 'L'].map((side) => ({
        upper: this.bones[bone(`DEF-upper_arm.${side}`)],
        fore: this.bones[bone(`DEF-forearm.${side}`)],
        hand: this.bones[bone(`DEF-hand.${side}`)],
      }));
      this.swing = CARRY;
    }
    this.feet = ['DEF-foot.L', 'DEF-foot.R'].map((n) => this.bones[bone(n)]);
    this.legs = ['L', 'R'].map((side) => ['thigh', 'shin', 'foot'].map((b) => this.bones[bone(`DEF-${b}.${side}`)]));
    this.waterDepth = 0;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [key, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      this.actions[key] = action;
    }
    for (const key of ['attack', 'hit', 'death']) {
      this.actions[key].setLoop(THREE.LoopOnce, 1);
      this.actions[key].clampWhenFinished = true;
    }
    this.weights = Object.fromEntries(Object.keys(clips).map((k) => [k, k === 'idle' ? 1 : 0]));
    this.state = null;
    this.flash = 0;
  }

  // Sets this frame's pose from the monster's state.
  update(dt, s) {
    const k = s.kind;
    const w = Object.fromEntries(Object.keys(this.actions).map((key) => [key, 0]));
    const entered = s.state !== this.state;
    this.state = s.state;
    const a = this.actions;
    if (s.state === 'rise') {
      // Clawing out of the grave: the fall played backwards, from the ground.
      const d = a.death.getClip().duration;
      a.death.paused = true;
      a.death.time = d * (1 - Math.min(1, s.stateTime / k.rise));
      w.death = 1;
    } else if (s.state === 'dead') {
      if (entered) {
        a.death.reset();
        a.death.timeScale = 1.15;
        a.death.play();
      }
      w.death = 1;
    } else if (s.state === 'aim') {
      // Raising the bow and holding the draw.
      if (entered) a.attack.reset().play();
      w.attack = 1;
    } else if (s.state === 'attack' && this.look.twoHanded) {
      // Standing, then dropping into the smash.
      if (entered) a.attack.reset().play();
      w.attack = smashCrouch(s.stateTime, k);
      w.idle = 1 - w.attack;
    } else if (s.state === 'attack') {
      if (entered) {
        a.attack.reset();
        a.attack.timeScale = a.attack.getClip().duration / k.swingTime;
        a.attack.play();
      }
      w.attack = 1;
    } else if (s.state === 'stagger') {
      if (entered) {
        a.hit.reset();
        a.hit.timeScale = Math.max(1, a.hit.getClip().duration / (k.stagger + 0.15));
        a.hit.play();
      }
      w.hit = 1;
    } else {
      // Walking or running at the speed it covers the ground, the clips
      // played at the rate that keeps the feet from sliding. Wading slows
      // the body more than the legs, as for the player.
      const speed = s.groundSpeed / (s.speedScale ?? 1);
      const moving = Math.min(1, speed / (0.6 * this.look.scale));
      const run = Math.max(0, Math.min(1, (speed - k.walkSpeed) / 1.6));
      w.idle = 1 - moving;
      w.walk = moving * (1 - run);
      w.run = moving * run;
      a.walk.timeScale = Math.max(0.4, speed / this.walkSpeed);
      a.run.timeScale = Math.max(0.5, speed / this.runSpeed);
    }
    // A fall is sudden, everything else blends.
    const ease = s.state === 'dead' || s.state === 'rise' ? 1 : 1 - Math.exp(-dt * 16);
    for (const key in w) {
      this.weights[key] += (w[key] - this.weights[key]) * ease;
      a[key].setEffectiveWeight(this.weights[key]);
    }
    this.mixer.update(dt);
    // Bone sizes, set outright each frame: the clips key the bones' scale,
    // but stop writing it once a clamped clip such as the fall has ended.
    for (const [b, s] of this.scaled) b.scale.setScalar(s);
    this.model.rotation.y = s.heading;
    // Keep a standing monster's feet on the ground; a fallen one lies where
    // the clip put it, sinking away at last.
    this.model.position.y = 0;
    if (s.state !== 'dead' && s.state !== 'rise') {
      this.model.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let lowest = Infinity;
      for (const f of this.feet) lowest = Math.min(lowest, f.getWorldPosition(v).y);
      this.model.position.y = -(lowest - FOOT_FLOOR * this.look.scale);
    }
    // Wading, it stands on the lake bed; the water hides what is below.
    this.waterDepth = s.waterDepth ?? 0;
    this.model.position.y -= this.waterDepth + s.sunk * 0.6 * this.look.scale;
    this.model.updateMatrixWorld(true);
    if (this.club) this.wield(dt, s, entered);
    this.flash = s.hurt < 0.14 ? 1 - s.hurt / 0.14 : 0;
  }

  // Holds the club in both hands at its place in the swing, never letting
  // its head go below the ground; a fallen troll lets it drop beside it.
  // Worked out in the model's own space, where it faces +z.
  wield(dt, s, entered) {
    const club = this.club;
    // Where the ground is, a little raised, in the model's own units.
    const floor = (0.04 - this.model.position.y) / this.look.scale;
    if (s.state === 'dead') {
      if (entered) this.dropFrom = { position: club.position.clone(), quaternion: club.quaternion.clone(), t: 0 };
      const drop = this.dropFrom;
      drop.t = Math.min(1, drop.t + dt * 2.5);
      const k = drop.t * drop.t;
      const lying = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(0.95, 0, 0.3).normalize());
      club.position.lerpVectors(drop.position, new THREE.Vector3(0.45, floor, 0.5), k);
      club.quaternion.slerpQuaternions(drop.quaternion, lying, k);
      return;
    }
    const target = s.state === 'attack' ? swingAngle(s.stateTime, s.kind) : CARRY;
    this.swing = s.state === 'attack' ? target : this.swing + (target - this.swing) * (1 - Math.exp(-dt * 8));
    const local = (b) => this.model.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
    const shoulders = local(this.arms[0].upper).add(local(this.arms[1].upper)).multiplyScalar(0.5);
    // The hands travel a shallower arc than the club, from over the head
    // down to arm's length in front of the knees.
    const grip = (angle) => {
      const arc = angle > 0 ? 0.75 * angle - 0.1 : 1.1 * angle - 0.1;
      return shoulders.clone().add(new THREE.Vector3(0, -0.1 + 0.58 * Math.sin(arc), 0.58 * Math.cos(arc)));
    };
    let angle = this.swing;
    let at = grip(angle);
    const length = CLUB_HEAD * this.look.weaponScale;
    if (at.y + length * Math.sin(angle) < floor) {
      angle = Math.asin(Math.max(-1, Math.min(1, (floor - at.y) / length)));
      at = grip(angle);
      angle = Math.asin(Math.max(-1, Math.min(1, (floor - at.y) / length)));
    }
    const along = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle));
    club.position.copy(at);
    club.quaternion.setFromUnitVectors(UP, along);
    club.updateMatrixWorld(true);
    const hold = (offset) => this.model.localToWorld(at.clone().addScaledVector(along, offset * this.look.weaponScale));
    reachWith(this.arms[0], hold(UPPER_HAND));
    reachWith(this.arms[1], hold(LOWER_HAND));
  }

  // The club head's height above the ground, in metres, if it has a club.
  clubHeadHeight() {
    if (!this.club) return null;
    return this.club.localToWorld(new THREE.Vector3(0, CLUB_HEAD, 0)).y;
  }

  // Where the surface cuts each leg, in metres from the feet across and
  // along the ground, like the player's (see model.js).
  waterContacts() {
    if (this.waterDepth <= 0.001 || this.state === 'dead') return [];
    const contacts = [];
    for (const leg of this.legs) {
      const joints = leg.map((b) => b.getWorldPosition(new THREE.Vector3()));
      for (let i = 0; i < joints.length - 1; i++) {
        const a = joints[i];
        const b = joints[i + 1];
        if (a.y < 0 || b.y > 0 || a.y === b.y) continue;
        const at = a.clone().lerp(b, a.y / (a.y - b.y));
        contacts.push({ x: at.x, z: at.z });
        break;
      }
    }
    return contacts;
  }

  // How high the head is above the ground, in metres.
  headHeight() {
    return this.head.getWorldPosition(new THREE.Vector3()).y;
  }
}

// How fast a locomotion clip carries the body: a planted foot slides back
// under it at the clip's ground speed.
function groundSpeed(rig, key) {
  const a = rig.actions[key];
  const dur = a.getClip().duration;
  for (const other of Object.values(rig.actions)) other.setEffectiveWeight(0);
  a.setEffectiveWeight(1);
  const foot = rig.bones[bone('DEF-foot.L')];
  const p = new THREE.Vector3();
  const ys = [];
  const zs = [];
  const steps = 90;
  for (let i = 0; i < steps; i++) {
    a.time = (i / steps) * dur;
    rig.mixer.update(0);
    rig.model.updateMatrixWorld(true);
    foot.getWorldPosition(p);
    ys.push(p.y);
    zs.push(p.z);
  }
  a.setEffectiveWeight(0);
  const low = Math.min(...ys);
  const speeds = [];
  for (let i = 0; i < steps; i++) {
    const j = (i + 1) % steps;
    const v = ((zs[i] - zs[j]) * steps) / dur;
    if (ys[i] < low + 0.05 && ys[j] < low + 0.05 && v > 0) speeds.push(v);
  }
  speeds.sort((x, y) => x - y);
  return speeds[Math.floor(speeds.length / 2)] || 1;
}

export class MonsterFigures {
  // `gltf` is the loaded animation library; its scene is copied, not used.
  constructor(gltf, { renderer = null } = {}) {
    this.prototypes = Object.fromEntries(Object.keys(LOOKS).map((kind) => [kind, prototypeOf(gltf.scene, kind)]));
    this.clips = Object.fromEntries(Object.entries(LOOKS).map(([kind, look]) => [kind,
      Object.fromEntries(Object.entries(look.clips).map(([key, name]) => {
        const clip = gltf.animations.find((c) => c.name === name);
        if (!clip) throw new Error(`Missing clip ${name}`);
        return [key, clip];
      }))]));
    this.rigs = new Map();
    // Rigs of fallen monsters, kept for the next of their kind.
    this.spare = Object.fromEntries(Object.keys(LOOKS).map((kind) => [kind, []]));
    // How fast each kind's walk and run carry it, measured from its feet.
    this.speeds = {};
    this.scene = new THREE.Scene();
    // The same moonlight as the player, a touch colder.
    const moon = new THREE.DirectionalLight(0xd8e0ff, 3.2);
    moon.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.8);
    rim.position.set(2, 3, -5);
    this.scene.add(moon, rim, new THREE.HemisphereLight(0x8090b0, 0x202418, 1.4));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    this.camera.position.set(0, TILT * 20, COS * 20);
    this.camera.lookAt(0, 0, 0);
    this.width = COLS * SX * MAX_DRAWN;
    this.height = ROWS * SY;
    this.pixels = new Uint8Array(this.width * this.height * 4);
    if (renderer) this.renderer = renderer;
    else {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    // Whatever sinks below the ground is cut away, or below the surface
    // while wading.
    this.ground = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.03)];
    this.surface = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
    this.drawn = [];
  }

  rigOf(monster) {
    let rig = this.rigs.get(monster);
    if (rig) return rig;
    const kind = monster.kind.id;
    rig = this.spare[kind].pop() ?? new Rig(kind, this.prototypes[kind], this.clips[kind]);
    this.speeds[kind] ??= { walk: groundSpeed(rig, 'walk'), run: groundSpeed(rig, 'run') };
    rig.walkSpeed = this.speeds[kind].walk;
    rig.runSpeed = this.speeds[kind].run;
    rig.state = null;
    for (const a of Object.values(rig.actions)) {
      a.reset();
      a.play();
      a.setEffectiveWeight(0);
    }
    rig.weights = Object.fromEntries(Object.keys(rig.actions).map((k) => [k, k === 'idle' ? 1 : 0]));
    this.rigs.set(monster, rig);
    this.scene.add(rig.model);
    return rig;
  }

  // Poses every monster and lets go of the rigs of those that are gone.
  update(dt, monsters) {
    const present = new Set(monsters);
    for (const [monster, rig] of this.rigs) {
      if (present.has(monster)) continue;
      this.rigs.delete(monster);
      this.scene.remove(rig.model);
      this.spare[rig.kind].push(rig);
    }
    for (const monster of monsters) this.rigOf(monster).update(dt, monster);
  }

  // Renders the monsters nearest `near` that stand within the view, each in
  // its own slot, reads the image back once and turns each into cells.
  // Returns [{ monster, cells, base, top, contacts }].
  rasterise(view, monsters, near) {
    const inView = monsters.filter((s) => s.x > view.x0 - COLS / 2 && s.x < view.x0 + view.cols + COLS / 2
      && s.y > view.y0 - (ROWS - FEET_ROW) && s.y < view.y0 + view.rows + FEET_ROW);
    inView.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
    const drawn = inView.slice(0, MAX_DRAWN);
    this.drawn = [];
    if (!drawn.length) return this.drawn;
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear();
    r.setScissorTest(true);
    const slotW = COLS * SX;
    drawn.forEach((s, i) => {
      for (const [other, rig] of this.rigs) rig.model.visible = other === s;
      r.clippingPlanes = this.rigs.get(s).waterDepth > 0.001 ? this.surface : this.ground;
      this.frame(s.x, s.y);
      r.setViewport(i * slotW, 0, slotW, this.height);
      r.setScissor(i * slotW, 0, slotW, this.height);
      r.render(this.scene, this.camera);
    });
    r.setScissorTest(false);
    for (const rig of this.rigs.values()) rig.model.visible = true;
    const gl = r.getContext();
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    drawn.forEach((s, i) => {
      const rig = this.rigs.get(s);
      // Waterlines round the legs, in world cells.
      const contacts = rig.waterContacts().map((c) => ({ x: s.x + c.x * SCALE / ASPECT, y: s.y + c.z * SCALE * TILT }));
      this.drawn.push({ monster: s, contacts, ...this.cellsOf(i, s, view, rig.flash) });
    });
    return this.drawn;
  }

  // Points the camera so the monster's feet land on their fractional cell.
  frame(x, y) {
    const cx0 = Math.floor(x) - (COLS >> 1);
    const cy0 = Math.floor(y) - FEET_ROW;
    const widthM = (COLS * ASPECT) / SCALE;
    const heightM = ROWS / SCALE;
    const fx = (x - cx0) / COLS;
    const fy = (y - cy0) / ROWS;
    const cam = this.camera;
    cam.left = -fx * widthM;
    cam.right = (1 - fx) * widthM;
    cam.top = fy * heightM;
    cam.bottom = -(1 - fy) * heightM;
    cam.updateProjectionMatrix();
  }

  // Turns slot `slot` of the read-back image into cells, like the player's
  // figure: partly covered cells become a pale outline, solid ones a glyph
  // by brightness. Glowing eyes keep their colour, and a fresh cut flashes
  // the body white.
  cellsOf(slot, s, view, flash) {
    const cx0 = Math.floor(s.x) - (COLS >> 1);
    const cy0 = Math.floor(s.y) - FEET_ROW;
    const w = this.width;
    const h = this.height;
    const px = this.pixels;
    const cells = [];
    let top = Infinity;
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        let hits = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let mx = 0;
        let my = 0;
        for (let j = 0; j < SY; j++) {
          const row = h - 1 - (cy * SY + j);
          for (let i = 0; i < SX; i++) {
            const o = (row * w + slot * COLS * SX + cx * SX + i) * 4;
            if (px[o + 3] < 128) continue;
            hits++;
            r += px[o];
            g += px[o + 1];
            b += px[o + 2];
            mx += (i + 0.5) / SX - 0.5;
            my += (j + 0.5) / SY - 0.5;
          }
        }
        if (hits < 3) continue;
        top = Math.min(top, cy);
        r /= hits;
        g /= hits;
        b /= hits;
        // Unlit, the eyes come out at full strength, the skeleton's embers
        // and the goblin's yellow alike, unlike anything moonlit.
        const glow = r > 235 && b < 70;
        if (flash > 0) {
          r += (255 - r) * flash;
          g += (235 - g) * flash;
          b += (220 - b) * flash;
        }
        const sx = cx0 + cx - view.x0;
        const sy = cy0 + cy - view.y0;
        if (hits < N - 4 && !glow) {
          const o = outline(mx, my, hits / N);
          const t = Math.min(1, 0.3 + o.rim * 0.55);
          cells.push({ sx, sy, g: o.g, r: r + (RIM[0] - r) * t, gg: g + (RIM[1] - g) * t, b: b + (RIM[2] - b) * t,
            br: 4, bgG: 4, bb: 6 });
          continue;
        }
        const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
        const ch = glow ? glyph('*') : RAMP[Math.min(RAMP.length - 1, 3 + Math.floor(lum * 2.2 * (RAMP.length - 3)))];
        const k = glow ? 1 : 1.3;
        cells.push({ sx, sy, g: ch, r: Math.min(255, 30 + r * k), gg: Math.min(255, 28 + g * k), b: Math.min(255, 24 + b * k),
          br: 4 + r * 0.04, bgG: 4 + g * 0.04, bb: 5 + b * 0.04 });
      }
    }
    return { cells, top: top === Infinity ? null : cy0 + top, base: Math.floor(s.y) - view.y0 };
  }

  // Draws one monster's cells through a writer (see cells.js).
  static draw(renderer, figure, write) {
    for (const c of figure.cells) write(renderer, c.sx, c.sy, c.g, c.r, c.gg, c.b, figure.base, c.br, c.bgG, c.bb);
  }
}

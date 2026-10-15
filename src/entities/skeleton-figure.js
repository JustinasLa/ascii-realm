import * as THREE from 'three';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { Armory } from './armory.js';
import { outline } from './model.js';
import { SCALE, TILT } from './rig.js';
import { SKELETON } from './skeleton.js';
import { getWeapon } from './weapons.js';

// Skeletons drawn the same way as the player: a rigged 3D figure playing the
// animation library's clips, rendered from the game's camera into a small
// image and turned into character cells. The mannequin's skin is hidden and
// bones are hung on its skeleton instead: a skull with ember eyes, ribs, a
// pelvis and long thin limbs. One offscreen renderer serves every skeleton,
// each drawn into its own slot of the image, read back in one go.

const SX = 4;
const SY = 6;
const N = SX * SY;
// Each slot, in cells: wide enough for a skeleton lying full length across
// the screen, deep enough for one fallen towards the camera.
const COLS = 64;
const ROWS = 44;
const FEET_ROW = 30;
// At most this many are drawn, nearest the player first.
export const MAX_DRAWN = 4;
const FOOT_FLOOR = 0.1;
const COS = Math.sqrt(1 - TILT * TILT);

const RAMP = [...' .:-=+*#%@'].map(glyph);
const RIM = [214, 222, 236];
const BONE = 0xd9d0b4;
const KNUCKLE = 0xa89f88;
const EMBER = 0xff5a1e;

const CLIPS = {
  idle: 'Sword_Idle',
  walk: 'Walk_Loop',
  run: 'Sprint_Loop',
  attack: 'Sword_Attack',
  hit: 'Hit_Chest',
  death: 'Death01',
};

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);
const RUSTED_SWORD = { ...getWeapon('sword-shield', 'copper'), materialColor: [120, 84, 58] };

// Shared, built once: bone-white and darker knuckle materials, and the eyes.
let materials = null;
function materialsOf() {
  materials ??= {
    bone: new THREE.MeshLambertMaterial({ color: BONE }),
    knuckle: new THREE.MeshLambertMaterial({ color: KNUCKLE }),
    socket: new THREE.MeshBasicMaterial({ color: 0x0c0806 }),
    ember: new THREE.MeshBasicMaterial({ color: EMBER }),
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

// One skeleton's rig: a copy of the library's armature with bones hung on
// it, its own animation mixer, and the clip weights it is blending.
class Rig {
  constructor(source, clips, runSpeed) {
    this.model = source.clone();
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    dressBones(this.model, this.bones);
    this.armory = new Armory(this.model, this.bones);
    this.armory.update(RUSTED_SWORD, true);
    this.feet = ['DEF-foot.L', 'DEF-foot.R'].map((n) => this.bones[bone(n)]);
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
    this.runSpeed = runSpeed;
    this.state = null;
    this.flash = 0;
  }

  // Sets this frame's pose from the skeleton's state.
  update(dt, s) {
    const w = Object.fromEntries(Object.keys(this.actions).map((k) => [k, 0]));
    const entered = s.state !== this.state;
    this.state = s.state;
    const a = this.actions;
    if (s.state === 'rise') {
      // Clawing out of the grave: the fall played backwards, from the ground.
      const d = a.death.getClip().duration;
      a.death.paused = true;
      a.death.time = d * (1 - Math.min(1, s.stateTime / SKELETON.rise));
      w.death = 1;
    } else if (s.state === 'dead') {
      if (entered) {
        a.death.reset();
        a.death.timeScale = 1.15;
        a.death.play();
      }
      w.death = 1;
    } else if (s.state === 'attack') {
      if (entered) {
        a.attack.reset();
        a.attack.timeScale = a.attack.getClip().duration / SKELETON.swingTime;
        a.attack.play();
      }
      w.attack = 1;
    } else if (s.state === 'stagger') {
      if (entered) {
        a.hit.reset();
        a.hit.timeScale = Math.max(1, a.hit.getClip().duration / (SKELETON.stagger + 0.15));
        a.hit.play();
      }
      w.hit = 1;
    } else {
      // Walking or running at the speed it covers the ground, the clips
      // played at the rate that keeps the feet from sliding.
      const speed = s.groundSpeed;
      const moving = Math.min(1, speed / 0.6);
      const run = Math.max(0, Math.min(1, (speed - 1.4) / 1.6));
      w.idle = 1 - moving;
      w.walk = moving * (1 - run);
      w.run = moving * run;
      a.walk.timeScale = Math.max(0.4, speed / this.walkSpeed);
      a.run.timeScale = Math.max(0.5, speed / this.runSpeed);
    }
    // A fall is sudden, everything else blends.
    const ease = s.state === 'dead' || s.state === 'rise' ? 1 : 1 - Math.exp(-dt * 16);
    for (const k in w) {
      this.weights[k] += (w[k] - this.weights[k]) * ease;
      a[k].setEffectiveWeight(this.weights[k]);
    }
    this.mixer.update(dt);
    this.model.rotation.y = s.heading;
    // Keep a standing skeleton's feet on the ground; a fallen one lies where
    // the clip put it, sinking away at last.
    this.model.position.y = 0;
    if (s.state !== 'dead' && s.state !== 'rise') {
      this.model.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let lowest = Infinity;
      for (const f of this.feet) lowest = Math.min(lowest, f.getWorldPosition(v).y);
      this.model.position.y = -(lowest - FOOT_FLOOR);
    }
    this.model.position.y -= s.sunk * 0.6;
    this.model.updateMatrixWorld(true);
    this.flash = s.hurt < 0.14 ? 1 - s.hurt / 0.14 : 0;
  }

  // How high the skull is above the ground, in metres.
  headHeight() {
    return this.bones[bone('DEF-head')].getWorldPosition(new THREE.Vector3()).y;
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

export class SkeletonFigures {
  // `gltf` is the loaded animation library; its scene is copied, not used.
  constructor(gltf, { renderer = null } = {}) {
    // Only the armature is kept; the mannequin's skin and anything hung on
    // its bones are left behind.
    this.source = gltf.scene.clone();
    const drop = [];
    this.source.traverse((o) => { if (o !== this.source && !o.isBone && !o.children.some((c) => c.isBone)) drop.push(o); });
    for (const o of drop) o.removeFromParent();
    this.clips = Object.fromEntries(Object.entries(CLIPS).map(([key, name]) => {
      const clip = gltf.animations.find((c) => c.name === name);
      if (!clip) throw new Error(`Missing clip ${name}`);
      return [key, clip];
    }));
    this.rigs = new Map();
    this.spare = [];
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
    // Whatever sinks below the ground is cut away.
    this.renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.03)];
    this.drawn = [];
    this.walkSpeed = null;
    this.runSpeed = null;
  }

  rigOf(skeleton) {
    let rig = this.rigs.get(skeleton);
    if (rig) return rig;
    rig = this.spare.pop() ?? new Rig(this.source, this.clips, 1);
    if (this.runSpeed === null) {
      this.walkSpeed = groundSpeed(rig, 'walk');
      this.runSpeed = groundSpeed(rig, 'run');
    }
    rig.walkSpeed = this.walkSpeed;
    rig.runSpeed = this.runSpeed;
    rig.state = null;
    for (const a of Object.values(rig.actions)) {
      a.reset();
      a.play();
      a.setEffectiveWeight(0);
    }
    rig.weights = Object.fromEntries(Object.keys(rig.actions).map((k) => [k, k === 'idle' ? 1 : 0]));
    this.rigs.set(skeleton, rig);
    this.scene.add(rig.model);
    return rig;
  }

  // Poses every skeleton and lets go of the rigs of those that are gone.
  update(dt, skeletons) {
    const present = new Set(skeletons);
    for (const [skeleton, rig] of this.rigs) {
      if (present.has(skeleton)) continue;
      this.rigs.delete(skeleton);
      this.scene.remove(rig.model);
      this.spare.push(rig);
    }
    for (const skeleton of skeletons) this.rigOf(skeleton).update(dt, skeleton);
  }

  // Renders the skeletons nearest `near` that stand within the view, each
  // in its own slot, reads the image back once and turns each into cells.
  // Returns [{ skeleton, cells, base, top }].
  rasterise(view, skeletons, near) {
    const inView = skeletons.filter((s) => s.x > view.x0 - COLS / 2 && s.x < view.x0 + view.cols + COLS / 2
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
      this.drawn.push({ skeleton: s, ...this.cellsOf(i, s, view, this.rigs.get(s).flash) });
    });
    return this.drawn;
  }

  // Points the camera so the skeleton's feet land on their fractional cell.
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
  // by brightness. A fresh cut flashes the bones white.
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
        if (flash > 0) {
          r += (255 - r) * flash;
          g += (235 - g) * flash;
          b += (220 - b) * flash;
        }
        const sx = cx0 + cx - view.x0;
        const sy = cy0 + cy - view.y0;
        // The embers keep their glow rather than being rimmed in moonlight.
        const ember = r > 150 && r > g * 1.6 && r > b * 2;
        if (hits < N - 4 && !ember) {
          const o = outline(mx, my, hits / N);
          const t = Math.min(1, 0.3 + o.rim * 0.55);
          cells.push({ sx, sy, g: o.g, r: r + (RIM[0] - r) * t, gg: g + (RIM[1] - g) * t, b: b + (RIM[2] - b) * t,
            br: 4, bgG: 4, bb: 6 });
          continue;
        }
        const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
        const ch = ember ? glyph('*') : RAMP[Math.min(RAMP.length - 1, 3 + Math.floor(lum * 2.2 * (RAMP.length - 3)))];
        const k = ember ? 1 : 1.3;
        cells.push({ sx, sy, g: ch, r: Math.min(255, 30 + r * k), gg: Math.min(255, 28 + g * k), b: Math.min(255, 24 + b * k),
          br: 4 + r * 0.04, bgG: 4 + g * 0.04, bb: 5 + b * 0.04 });
      }
    }
    return { cells, top: top === Infinity ? null : cy0 + top, base: Math.floor(s.y) - view.y0 };
  }

  // Draws one skeleton's cells through a writer (see cells.js).
  static draw(renderer, figure, write) {
    for (const c of figure.cells) write(renderer, c.sx, c.sy, c.g, c.r, c.gg, c.b, figure.base, c.br, c.bgG, c.bb);
  }
}

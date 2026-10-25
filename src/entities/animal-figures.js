import * as THREE from 'three';
import { clone as cloneSkinned } from '../../vendor/three/utils/SkeletonUtils.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, WATER } from '../world/world.js';
import { KINDS } from './animals.js';
import { ModelFigure, outline } from './model.js';
import { SCALE, TILT } from './rig.js';

// Deer and rabbits drawn the way the player and monsters are: rigged models
// playing their own authored clips, rendered from the game's camera into
// slots of one offscreen image, read back in one go and turned into cells.
// Each model is scaled at load so its withers stand at the kind's height,
// and turned so heading 0 faces +z like every other figure.

const SX = 4;
const SY = 6;
const N = SX * SY;
const COLS = 56;
const ROWS = 36;
const MAX_COLS = 120;
const MAX_ROWS = 60;
const PAD = 2;
// At most this many are drawn, nearest the player first.
export const MAX_DRAWN = 6;
export const MAX_DRAWN_PHONE = 4;
const COS = Math.sqrt(1 - TILT * TILT);

const RAMP = [...' .:-=+*#%@'].map(glyph);
// A softer rim and gain than the monsters': animals are part of the land,
// and the player stays the brightest thing on screen.
const RIM = [170, 182, 204];
const GAIN = 1.1;

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);

// Each model: its file, the bone at the withers that sets its scale, the
// foot whose planted speed sets the gait rates, the bones down each leg to
// its tip, how much flesh lies round the bones, and its dark ground shadow
// (metres along and across the body).
export const LOOKS = {
  deer: { url: 'assets/animals/deer.glb', kind: 'deer', withers: 'Neck1', head: 'Head', hips: 'Body',
    foot: 'FrontLowerLeg.L_end', flesh: 0.22, shadow: [0.7, 0.25],
    legs: ['FrontUpperLeg.L', 'FrontUpperLeg.R', 'BackUpperLeg.L', 'BackUpperLeg.R'].map((upper) => {
      const lower = upper.replace('Upper', 'Lower');
      return [upper, lower, `${lower}_end`];
    }) },
  stag: { url: 'assets/animals/stag.glb', kind: 'deer', withers: 'Neck1', head: 'Head', hips: 'Body',
    foot: 'FrontLowerLeg.L_end', flesh: 0.22, shadow: [0.75, 0.27],
    legs: ['FrontUpperLeg.L', 'FrontUpperLeg.R', 'BackUpperLeg.L', 'BackUpperLeg.R'].map((upper) => {
      const lower = upper.replace('Upper', 'Lower');
      return [upper, lower, `${lower}_end`];
    }) },
  rabbit: { url: 'assets/animals/rabbit.glb', kind: 'rabbit', withers: 'Spine001', head: 'Head', hips: 'Hips',
    foot: 'BackPaw_L_end', flesh: 0.06, shadow: [0.18, 0.09],
    legs: [['FrontLeg_L', 'FrontPaw_L', 'FrontPaw_L_end'], ['FrontLeg_R', 'FrontPaw_R', 'FrontPaw_R_end'],
      ['BackLeg_L001', 'BackPaw_L', 'BackPaw_L_end'], ['BackLeg_R001', 'BackPaw_R', 'BackPaw_R_end']] },
};

// Which look an animal wears.
export const lookOf = (animal) => (animal.variant === 'stag' ? 'stag' : animal.kind.id);

// Flat-coloured or textured Lambert copies of a model's materials, so the
// lights fall on them as on the monsters; eyes are left unlit black.
function relight(scene) {
  const made = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const swap = (m) => {
      if (made.has(m)) return made.get(m);
      const dark = m.color && m.color.r + m.color.g + m.color.b < 0.03 && !m.map;
      const next = dark ? new THREE.MeshBasicMaterial({ color: 0x050505 })
        : new THREE.MeshLambertMaterial({ color: m.color?.clone() ?? new THREE.Color(1, 1, 1), map: m.map ?? null });
      made.set(m, next);
      return next;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

// The scale and turn that stand a model at its kind's withers height,
// facing +z, measured once in its rest pose.
function measure(scene, look, height) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const at = (name) => scene.getObjectByName(bone(name)).getWorldPosition(new THREE.Vector3());
  const withers = at(look.withers).y - box.min.y;
  const head = at(look.head);
  const hips = at(look.hips);
  return { scale: height / withers, yaw: Math.atan2(head.x - hips.x, head.z - hips.z) };
}

class Rig {
  constructor(name, source, clips, fit) {
    this.name = name;
    this.look = LOOKS[name];
    this.model = new THREE.Group();
    this.inner = cloneSkinned(source);
    this.inner.scale.setScalar(fit.scale);
    this.inner.rotation.y = -fit.yaw;
    this.model.add(this.inner);
    // Bones and the leaf nodes at the tips of the legs, by name.
    this.bones = {};
    this.inner.traverse((o) => { if (o.isBone || o.name.endsWith('_end')) this.bones[o.name] ??= o; });
    this.legs = this.look.legs.map((leg) => leg.map((b) => this.bones[bone(b)]));
    this.tips = this.legs.map((leg) => leg[leg.length - 1]);
    this.flesh = this.look.flesh;
    this.waterDepth = 0;
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.actions = {};
    for (const [key, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      this.actions[key] = action;
    }
    // The fall and the hit-reacts play once and hold their last pose.
    for (const key of ['death', 'dead', 'hitL', 'hitR']) {
      if (!this.actions[key]) continue;
      this.actions[key].setLoop(THREE.LoopOnce, 1);
      this.actions[key].clampWhenFinished = true;
    }
    this.reset();
  }

  reset() {
    for (const a of Object.values(this.actions)) {
      a.reset();
      a.play();
      a.setEffectiveWeight(0);
    }
    this.weights = Object.fromEntries(Object.keys(this.actions).map((k) => [k, 0]));
    this.state = null;
    this.flinch = null;
    this.flash = 0;
    this.ground = 0;
  }

  // The clip weights for what the animal is doing: standing, grazing with
  // its head now down and now up, watching, or on the move at a gait whose
  // rate keeps its feet planted.
  pose(s) {
    const w = Object.fromEntries(Object.keys(this.actions).map((key) => [key, 0]));
    const a = this.actions;
    const moving = s.groundSpeed > 0.05 && s.speed > 0;
    const deer = s.kind.id === 'deer';
    if (s.state === 'dead') {
      // The fall, played once from its start; a rabbit's then settles into
      // its lying pose.
      if (this.state !== 'dead') {
        a.death.reset();
        a.death.timeScale = 1.15;
        a.death.play();
        a.dead?.reset().play();
      }
      const fallen = a.dead && a.death.time >= a.death.getClip().duration - 1e-3;
      w[fallen ? 'dead' : 'death'] = 1;
    } else if (s.flinch && a.hitL) {
      // A fresh blow starts the hit-react on the side it came from.
      const key = s.flinch.side === 'L' ? 'hitL' : 'hitR';
      if (this.flinch !== s.flinch) {
        a[key].reset().play();
        this.flinch = s.flinch;
      }
      w[key] = 1;
    } else if (moving) {
      const speed = s.speedScale > 0 ? s.groundSpeed / s.speedScale : 0;
      // The gait's rate follows the speed, so the feet stay planted.
      const [lo, hi] = s.kind.rates;
      const rate = (v) => Math.max(lo, Math.min(hi, v));
      const run = a.walk ? Math.max(0, Math.min(1, (speed - this.walkSpeed * hi) / Math.max(0.01, this.runSpeed * lo - this.walkSpeed * hi))) : 1;
      if (a.walk) {
        w.walk = 1 - run;
        a.walk.timeScale = rate(speed / this.walkSpeed);
      }
      w.run = run;
      a.run.timeScale = rate(speed / this.runSpeed);
    } else if (s.state === 'graze') w[s.headUp ? (deer ? 'look' : 'alertLoop') : 'graze'] = 1;
    else if (s.state === 'alert' || s.state === 'freeze') w[deer ? 'look' : 'alertLoop'] = 1;
    else if (deer) w[s.looking ? 'look' : 'idle'] = 1;
    else w.groom = 1;
    return w;
  }

  update(dt, s) {
    const w = this.pose(s);
    // A fall is sudden, everything else blends.
    const ease = s.state === 'dead' && this.state !== 'dead' ? 1 : 1 - Math.exp(-dt * 14);
    this.state = s.state;
    for (const key in w) {
      this.weights[key] += (w[key] - this.weights[key]) * ease;
      this.actions[key].setEffectiveWeight(this.weights[key]);
    }
    this.mixer.update(dt);
    this.model.rotation.y = s.heading;
    // Standing, its feet are kept on the ground; fallen, it lies where the
    // clip puts it, at the height it stood, sinking away at last.
    if (s.state !== 'dead') {
      this.model.position.y = 0;
      this.model.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let lowest = Infinity;
      for (const tip of this.tips) lowest = Math.min(lowest, tip.getWorldPosition(v).y);
      this.ground = -lowest;
    }
    this.waterDepth = s.waterDepth ?? 0;
    this.model.position.y = this.ground - this.waterDepth - (s.sunk ?? 0) * 0.6 * s.kind.height;
    this.model.updateMatrixWorld(true);
    this.flash = s.hurt < 0.14 ? 1 - s.hurt / 0.14 : 0;
  }

  // Where each wading leg meets the water's surface, for splash rings.
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

  // How far the figure reaches round its feet on screen, in metres: left,
  // right, up and down, from its bones and the flesh on them.
  reach() {
    const box = { left: Infinity, right: -Infinity, up: -Infinity, down: Infinity };
    const v = new THREE.Vector3();
    const pad = this.flesh;
    this.model.updateMatrixWorld(true);
    for (const o of Object.values(this.bones)) {
      o.getWorldPosition(v);
      const up = v.y * COS - v.z * TILT;
      box.left = Math.min(box.left, v.x - pad);
      box.right = Math.max(box.right, v.x + pad);
      box.up = Math.max(box.up, up + pad);
      box.down = Math.min(box.down, up - pad);
    }
    return box;
  }
}

// The ground speed of a gait, metres a second: how fast the planted foot
// slides back under the body over one loop of the clip, as for monsters.
export function groundSpeed(rig, key) {
  const a = rig.actions[key];
  const dur = a.getClip().duration;
  for (const other of Object.values(rig.actions)) other.setEffectiveWeight(0);
  a.setEffectiveWeight(1);
  a.timeScale = 1;
  const foot = rig.bones[bone(rig.look.foot)];
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
  const high = Math.max(...ys);
  const planted = low + (high - low) * 0.15;
  const speeds = [];
  for (let i = 0; i < steps; i++) {
    const j = (i + 1) % steps;
    const v = ((zs[i] - zs[j]) * steps) / dur;
    if (ys[i] <= planted && ys[j] <= planted && v > 0) speeds.push(v);
  }
  speeds.sort((x, y) => x - y);
  return speeds[Math.floor(speeds.length / 2)] || 1;
}

export class AnimalFigures {
  // Fetches every model once and sets the figures up; null if WebGL could
  // not be had (the animals still live, unseen).
  static async load(options = {}) {
    const entries = await Promise.all(Object.entries(LOOKS).map(async ([name, look]) => [name, await ModelFigure.library(look.url)]));
    try {
      return new AnimalFigures(Object.fromEntries(entries), options);
    } catch (e) {
      console.warn('Animals are not drawn: no WebGL context for them', e);
      return null;
    }
  }

  constructor(gltfs, { renderer = null, phone = () => false } = {}) {
    this.sources = {};
    this.clips = {};
    this.fits = {};
    for (const [name, look] of Object.entries(LOOKS)) {
      const gltf = gltfs[name];
      const kind = KINDS[look.kind];
      relight(gltf.scene);
      this.sources[name] = gltf.scene;
      this.fits[name] = measure(gltf.scene, look, name === 'stag' ? kind.stagHeight : kind.height);
      this.clips[name] = Object.fromEntries(Object.entries(kind.clips).map(([key, clipName]) => {
        const clip = gltf.animations.find((c) => c.name === clipName);
        if (!clip) throw new Error(`Missing clip ${clipName}`);
        return [key, clip];
      }));
    }
    this.phone = phone;
    this.rigs = new Map();
    this.spare = Object.fromEntries(Object.keys(LOOKS).map((name) => [name, []]));
    this.speeds = {};
    this.scene = new THREE.Scene();
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
    this.readWidth = this.width;
    if (renderer) this.renderer = renderer;
    else {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.ground = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02)];
    this.surface = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
    this.drawn = [];
  }

  rigOf(animal) {
    let rig = this.rigs.get(animal);
    if (rig) return rig;
    const name = lookOf(animal);
    rig = this.spare[name].pop();
    if (rig) rig.reset();
    else rig = new Rig(name, this.sources[name], this.clips[name], this.fits[name]);
    this.speeds[name] ??= { walk: rig.actions.walk ? groundSpeed(rig, 'walk') : 0, run: groundSpeed(rig, 'run') };
    rig.walkSpeed = this.speeds[name].walk;
    rig.runSpeed = this.speeds[name].run;
    this.rigs.set(animal, rig);
    this.scene.add(rig.model);
    return rig;
  }

  // Poses every live animal; rigs of animals let go are kept for the next.
  update(dt, animals) {
    const present = new Set(animals);
    for (const [animal, rig] of this.rigs) {
      if (present.has(animal)) continue;
      this.rigs.delete(animal);
      this.scene.remove(rig.model);
      this.spare[rig.name].push(rig);
    }
    for (const animal of animals) this.rigOf(animal).update(dt, animal);
  }

  rasterise(view, animals, near) {
    const inView = [];
    for (const s of animals) {
      const slot = this.slotOf(s, view);
      if (slot) inView.push({ s, slot });
    }
    inView.sort((a, b) => Math.hypot(a.s.x - near.x, a.s.y - near.y) - Math.hypot(b.s.x - near.x, b.s.y - near.y));
    const drawn = inView.slice(0, this.phone() ? MAX_DRAWN_PHONE : MAX_DRAWN);
    this.drawn = [];
    if (!drawn.length) return this.drawn;
    let width = 0;
    let height = 0;
    for (const { slot } of drawn) {
      slot.x = width;
      width += slot.cols * SX;
      height = Math.max(height, slot.rows * SY);
    }
    this.fit(width, height);
    this.readWidth = width;
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear();
    r.setScissorTest(true);
    for (const { s, slot } of drawn) {
      for (const [other, rig] of this.rigs) rig.model.visible = other === s;
      r.clippingPlanes = this.rigs.get(s).waterDepth > 0.001 ? this.surface : this.ground;
      this.frame(s.x, s.y, slot);
      r.setViewport(slot.x, 0, slot.cols * SX, slot.rows * SY);
      r.setScissor(slot.x, 0, slot.cols * SX, slot.rows * SY);
      r.render(this.scene, this.camera);
    }
    r.setScissorTest(false);
    for (const rig of this.rigs.values()) rig.model.visible = true;
    const gl = r.getContext();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    for (const { s, slot } of drawn) {
      const rig = this.rigs.get(s);
      const contacts = rig.waterContacts().map((c) => ({ x: s.x + c.x * SCALE / ASPECT, y: s.y + c.z * SCALE * TILT }));
      this.drawn.push({ animal: s, contacts, depth: s.y, shadow: rig.look.shadow, ...this.cellsOf(slot, s, view, rig.flash) });
    }
    return this.drawn;
  }

  slotOf(s, view) {
    if (s.x < view.x0 - MAX_COLS / 2 || s.x > view.x0 + view.cols + MAX_COLS / 2
      || s.y < view.y0 - MAX_ROWS * 0.3 || s.y > view.y0 + view.rows + MAX_ROWS * 0.7) return null;
    const reach = this.rigOf(s).reach();
    const cols = SCALE / ASPECT;
    let cx0 = Math.floor(s.x + reach.left * cols) - PAD;
    let cx1 = Math.ceil(s.x + reach.right * cols) + PAD;
    let cy0 = Math.floor(s.y - reach.up * SCALE) - PAD;
    let cy1 = Math.ceil(s.y - reach.down * SCALE) + PAD;
    cx0 = Math.max(cx0, view.x0 - 1, Math.floor(s.x) - MAX_COLS / 2);
    cx1 = Math.min(cx1, view.x0 + view.cols + 1, Math.floor(s.x) + MAX_COLS / 2);
    cy0 = Math.max(cy0, view.y0 - 1, Math.floor(s.y) - MAX_ROWS * 0.7);
    cy1 = Math.min(cy1, view.y0 + view.rows + 1, Math.floor(s.y) + MAX_ROWS * 0.3);
    if (cx1 <= cx0 || cy1 <= cy0) return null;
    return { x: 0, cx0, cy0, cols: cx1 - cx0, rows: cy1 - cy0 };
  }

  fit(width, height) {
    if (width <= this.width && height <= this.height) return;
    this.width = Math.max(this.width, width);
    this.height = Math.max(this.height, height);
    this.pixels = new Uint8Array(this.width * this.height * 4);
    this.renderer.setSize(this.width, this.height, false);
  }

  frame(x, y, slot) {
    const cam = this.camera;
    cam.left = -((x - slot.cx0) * ASPECT) / SCALE;
    cam.right = cam.left + (slot.cols * ASPECT) / SCALE;
    cam.top = (y - slot.cy0) / SCALE;
    cam.bottom = cam.top - slot.rows / SCALE;
    cam.updateProjectionMatrix();
  }

  // The slot's pixels as cells: outline glyphs round the edge, lit by a
  // soft rim, and a density ramp inside. A fresh hit flashes the body.
  cellsOf(slot, s, view, flash = 0) {
    const { cx0, cy0 } = slot;
    const w = this.readWidth;
    const h = slot.rows * SY;
    const px = this.pixels;
    const cells = [];
    let top = Infinity;
    for (let cy = 0; cy < slot.rows; cy++) {
      for (let cx = 0; cx < slot.cols; cx++) {
        let hits = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let mx = 0;
        let my = 0;
        for (let j = 0; j < SY; j++) {
          const row = h - 1 - (cy * SY + j);
          for (let i = 0; i < SX; i++) {
            const o = (row * w + slot.x + cx * SX + i) * 4;
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
        if (hits < N - 4) {
          const o = outline(mx, my, hits / N);
          const t = Math.min(1, 0.25 + o.rim * 0.5);
          cells.push({ sx, sy, g: o.g, r: r + (RIM[0] - r) * t, gg: g + (RIM[1] - g) * t, b: b + (RIM[2] - b) * t,
            br: 4, bgG: 4, bb: 6 });
          continue;
        }
        const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
        const ch = RAMP[Math.min(RAMP.length - 1, 3 + Math.floor(lum * 2.2 * (RAMP.length - 3)))];
        cells.push({ sx, sy, g: ch, r: Math.min(255, 30 + r * GAIN), gg: Math.min(255, 28 + g * GAIN),
          b: Math.min(255, 24 + b * GAIN), br: 4 + r * 0.04, bgG: 4 + g * 0.04, bb: 5 + b * 0.04 });
      }
    }
    return { cells, top: top === Infinity ? null : cy0 + top, base: Math.floor(s.y) - view.y0 };
  }

  static draw(renderer, figure, write) {
    for (const c of figure.cells) write(renderer, c.sx, c.sy, c.g, c.r, c.gg, c.b, figure.base, c.br, c.bgG, c.bb);
  }

  // A dark ellipse on the ground under the body, long along its heading.
  static drawShadow(r, view, figure) {
    const { animal: s, shadow: [along, across] } = figure;
    const { fg, bg, cols } = r;
    const sin = Math.sin(s.heading);
    const cos = Math.cos(s.heading);
    const reachX = Math.ceil((along * SCALE) / ASPECT) + 1;
    const reachY = Math.ceil(along * SCALE * TILT) + 1;
    const fx = Math.floor(s.x);
    const fy = Math.floor(s.y);
    for (let cy = fy - reachY; cy <= fy + reachY; cy++) {
      const sy = cy - view.y0;
      if (sy < 0 || sy >= view.rows) continue;
      for (let cx = fx - reachX; cx <= fx + reachX; cx++) {
        const sx = cx - view.x0;
        if (sx < 0 || sx >= view.cols) continue;
        if (r.mask[sy * cols + sx] === WATER) continue;
        const mx = ((cx + 0.5 - s.x) * ASPECT) / SCALE;
        const mz = (cy + 0.5 - s.y) / (SCALE * TILT);
        const a = (mx * sin + mz * cos) / along;
        const b = (mx * cos - mz * sin) / across;
        const d = a * a + b * b;
        if (d >= 1) continue;
        const k = 1 - 0.6 * (1 - d);
        const o = (sy * cols + sx) * 4;
        for (let c = 0; c < 3; c++) {
          fg[o + c] *= k;
          bg[o + c] *= k;
        }
      }
    }
  }
}

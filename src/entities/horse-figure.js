import * as THREE from 'three';
import { clone as cloneSkinned } from '../../vendor/three/utils/SkeletonUtils.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { measure, relight } from './animal-figures.js';
import { HORSE } from './horses.js';
import { ModelFigure, dressCharacter, outline, reachFor, setWorldQuaternion } from './model.js';
import { SCALE, TILT } from './rig.js';
import { getWeapon } from './weapons.js';

// A saddled horse and the rider sitting it, drawn as one figure. Both are
// rigged models playing their own clips: the horse its idles, the rider the
// outlaw's own seated loop. They are rendered together from the game's
// camera into slots of one offscreen image, and the horse is drawn a
// second time as depth into the slots above, so a single read brings back
// how far each pixel is from the camera too. A horse is long, and grass
// rooted between its legs must hide the hind hooves but not the front
// ones, so its cells are sorted into bands by the ground row under each one
// and drawn among the grass rows band by band. The rider is left out of the
// depth: their cells take the depth of the horse behind them (their legs
// layer with its barrel) or else the horse's own row, and leaving out the
// rider's many triangles keeps the second pass cheap.

const SX = 4;
const SY = 6;
const N = SX * SY;
const MAX_COLS = 120;
const MAX_ROWS = 64;
const PAD = 2;
// At most this many are drawn, the nearest the player first: each costs
// two renders of the image.
export const MAX_DRAWN = 2;
export const MAX_DRAWN_PHONE = 2;
const COS = Math.sqrt(1 - TILT * TILT);
// The camera stands this far from the figure and sees depth only between
// NEAR and FAR, so one byte of depth tells points 4.7 cm apart.
const D = 20;
export const NEAR = 14;
export const FAR = 26;

// Drawn like the animals: a softer rim and gain than the player's.
const RAMP = [...' .:-=+*#%@'].map(glyph);
const RIM = [170, 182, 204];
const GAIN = 1.1;

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);

const LOOK = { url: 'assets/animals/horse.glb', withers: 'Neck1', head: 'Head', hips: 'Body', seat: 'Torso',
  hooves: ['FrontLowerLeg.L_end', 'FrontLowerLeg.R_end', 'BackLowerLeg.L_end', 'BackLowerLeg.R_end'],
  flesh: 0.3 };
const RIDER_URL = 'assets/ual1.glb';
const SHORT_SWORD = getWeapon('sword-shield', 'iron');
// How much of its length the rider's cloak keeps.
const CLOAK_TO_SADDLE = 0.55;

// The rider: the outlaw's seated loop from the waist up, legs set astride
// the barrel with their feet in the stirrups. Metres, measured on the
// horse as it stands: the seat on the back ahead of the seat bone, just
// behind the withers so the lower leg hangs at the girth (sinking a little
// into the back), the stirrups below the top of the back, a little ahead
// of the hips and out beyond the barrel, and where the knee is turned to,
// out round the barrel, before the leg reaches for its stirrup.
export const RIDER = Object.freeze({
  clip: 'Sitting_Idle_Loop',
  seat: { z: 0.4, sink: 0.02 },
  stirrup: { drop: 0.64, forward: 0.02, out: 0.06 },
  knee: { drop: 0.28, forward: 0.32, out: 0.16 },
});

// The skinned vertices of a model that pass `keep`, in world space. Only
// updateMatrixWorld brings a skinned mesh's bind matrix up to date.
function skinnedPoints(root, keep) {
  const out = [];
  const v = new THREE.Vector3();
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      if (keep(v)) out.push(v.clone());
    }
  });
  return out;
}

// Where a node is in the space of one of its ancestors, from the nodes'
// own transforms, without updating anything else.
function inRoot(node, root, out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  for (let o = node; o !== root; o = o.parent) {
    o.updateMatrix();
    out.applyMatrix4(o.matrix);
  }
  return out;
}

// The ground row of a depth sample: `byte` is the depth read back, and
// `pixelRow` its row down the slot, which is `frame.pxHeight` pixels tall
// and spans `frame.top` to `frame.bottom` metres on the camera's plane. The
// camera is D metres from the figure, so a point (y up, z toward the
// camera) is t = D - TILT·y - COS·z deep and u = COS·y - TILT·z up the
// plane; z follows from t and u.
export function groundRowOf(byte, pixelRow, frame) {
  const t = NEAR + (1 - byte / 255) * (FAR - NEAR);
  const u = frame.top - ((pixelRow + 0.5) / frame.pxHeight) * (frame.top - frame.bottom);
  const z = COS * (D - t) - TILT * u;
  return frame.y + z * SCALE * TILT;
}

// Cells grouped by the ground row under them, each group drawn among the
// grass rows as one: whole rows from `origin`, the row the horse stands on,
// front to back in drawing order.
export function bandCells(cells, origin, base) {
  const bands = new Map();
  for (const c of cells) {
    const k = Math.round(c.row - origin);
    let band = bands.get(k);
    if (!band) bands.set(k, band = { y: origin + k, cells: [], base });
    band.cells.push(c);
  }
  return [...bands.values()].sort((a, b) => a.y - b.y);
}

// The rider's legs: each knee turned out round the barrel toward its knee
// point, then the leg reaches for the stirrup with the two-bone IK the
// player's feet use, starting from the seated clip's own hip, knee and
// ankle. Reaching swings the whole leg, so it is then turned about the
// line from hip to stirrup until the knee is as near its knee point as it
// can be, which leaves the foot where it is. The foot rests level in the
// stirrup, facing the way the horse does. It sets a posture and adds no
// motion of its own: the stirrups ride on the horse's back, so the legs
// move only as the horse's idle moves it. An authored riding clip would
// replace this one function.
export function riderLegs(rig) {
  const fit = rig.fit;
  const riderQ = rig.rider.getWorldQuaternion(new THREE.Quaternion());
  const q = new THREE.Quaternion();
  const across = (v, axis) => v.addScaledVector(axis, -v.dot(axis)).normalize();
  rig.legs.forEach((leg, i) => {
    const stirrup = rig.torso.localToWorld(fit.stirrups[i].clone());
    const knee = rig.torso.localToWorld(fit.knees[i].clone());
    const hip = leg.thigh.getWorldPosition(new THREE.Vector3());
    const now = leg.shin.getWorldPosition(new THREE.Vector3()).sub(hip).normalize();
    q.setFromUnitVectors(now, knee.clone().sub(hip).normalize());
    setWorldQuaternion(leg.thigh, q.multiply(leg.thigh.getWorldQuaternion(new THREE.Quaternion())));
    reachFor(leg.thigh, leg.shin, leg.foot, stirrup);
    const axis = stirrup.clone().sub(hip).normalize();
    const bent = across(leg.shin.getWorldPosition(new THREE.Vector3()).sub(hip), axis);
    q.setFromUnitVectors(bent, across(knee.sub(hip), axis));
    setWorldQuaternion(leg.thigh, q.multiply(leg.thigh.getWorldQuaternion(new THREE.Quaternion())));
    setWorldQuaternion(leg.foot, riderQ.clone().multiply(leg.rest));
  });
}

// One horse and its rider.
class HorseRig {
  constructor(figures) {
    const fit = figures.fit;
    this.fit = fit;
    this.model = new THREE.Group();
    this.inner = cloneSkinned(figures.source);
    this.inner.scale.setScalar(fit.scale);
    this.inner.rotation.y = -fit.yaw;
    this.model.add(this.inner);
    this.hbones = {};
    this.inner.traverse((o) => { if (o.isBone || o.name.endsWith('_end')) this.hbones[o.name] ??= o; });
    this.tips = LOOK.hooves.map((b) => this.hbones[bone(b)]);
    this.torso = this.hbones[bone(LOOK.seat)];
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.actions = {};
    for (const [key, clip] of Object.entries(figures.clips)) {
      const action = this.mixer.clipAction(clip);
      if (key !== 'idle') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.play();
      action.setEffectiveWeight(0);
      this.actions[key] = action;
    }
    this.weights = Object.fromEntries(Object.keys(this.actions).map((k) => [k, 0]));
    this.plays = null;

    // The rider, dressed as the outlaw with the short sword at the hip. The
    // cloak, cut to hang to the calves of someone standing, would hang
    // through the horse, so it is taken up to end at the saddle.
    const { model, bones, gear, armory } = dressCharacter(figures.riderSource);
    gear.apply(undefined);
    armory.update(SHORT_SWORD, false);
    gear.cloak.scale.y *= CLOAK_TO_SADDLE;
    this.rider = model;
    this.rbones = bones;
    this.gear = gear;
    this.hips = bones[bone('DEF-hips')];
    // Each foot's turn in the standing rest pose, which is level and
    // facing forward, kept to set the foot level in its stirrup.
    model.updateWorldMatrix(true, true);
    this.legs = ['L', 'R'].map((side) => {
      const foot = bones[bone(`DEF-foot.${side}`)];
      return { thigh: bones[bone(`DEF-thigh.${side}`)], shin: bones[bone(`DEF-shin.${side}`)], foot,
        rest: foot.getWorldQuaternion(new THREE.Quaternion()) };
    });
    this.rmixer = new THREE.AnimationMixer(model);
    this.sit = this.rmixer.clipAction(figures.riderClip);
    this.sit.play();
    this.model.add(model);

    // Every mesh of the horse's own material and a depth one with the same
    // sidedness, so a surface seen from behind still has its depth.
    this.surfaces = [];
    this.inner.traverse((o) => {
      if (!o.isMesh) return;
      const colour = o.material;
      const depth = Array.isArray(colour) ? colour.map((m) => figures.depthFor(m)) : figures.depthFor(colour);
      this.surfaces.push({ mesh: o, colour, depth });
    });
    this.ground = 0;
  }

  // Draws the horse with the depth materials and hides the rider, or brings
  // both back.
  showDepth(on) {
    for (const s of this.surfaces) s.mesh.material = on ? s.depth : s.colour;
    this.rider.visible = !on;
  }

  // The horse's clip weights for what it is doing, eased as for the
  // animals; a weight shift or grazing plays once from its start.
  poseHorse(dt, horse) {
    const fresh = this.plays === null;
    if (horse.plays !== this.plays && horse.clip !== 'idle') this.actions[horse.clip].reset().play();
    this.plays = horse.plays;
    const ease = fresh ? 1 : 1 - Math.exp(-dt * 14);
    for (const key in this.actions) {
      this.weights[key] += ((key === horse.clip ? 1 : 0) - this.weights[key]) * ease;
      this.actions[key].setEffectiveWeight(this.weights[key]);
    }
    this.mixer.update(dt);
  }

  // Stands the horse on its lowest hoof.
  plant() {
    this.model.position.y = 0;
    this.inner.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    let lowest = Infinity;
    for (const tip of this.tips) lowest = Math.min(lowest, tip.getWorldPosition(v).y);
    this.ground = -lowest;
    this.model.position.y = this.ground;
    this.inner.updateWorldMatrix(true, true);
  }

  // Sits the rider on the seat: its seat on the back, rocking with the
  // back. The back's turn is taken in the horse's own space, so the heading
  // the two share is never applied twice.
  seat() {
    const fit = this.fit;
    const back = this.model.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(this.torso.getWorldQuaternion(new THREE.Quaternion()));
    this.rider.quaternion.copy(back.multiply(fit.unturn));
    const at = this.model.worldToLocal(this.torso.localToWorld(fit.seat.clone()));
    at.y -= RIDER.seat.sink;
    const contact = inRoot(this.hips, this.rider);
    contact.y -= fit.seatBelowHips;
    this.rider.position.copy(at.sub(contact.applyQuaternion(this.rider.quaternion)));
    this.rider.updateWorldMatrix(false, true);
  }

  update(dt, horse) {
    this.poseHorse(dt, horse);
    this.model.rotation.y = horse.heading;
    this.plant();
    this.rmixer.update(dt);
    this.seat();
    riderLegs(this);
  }

  // How far horse and rider reach round the hooves on screen, in metres:
  // left, right, up and down, from their bones and the flesh on them.
  reach() {
    const box = { left: Infinity, right: -Infinity, up: -Infinity, down: Infinity };
    const v = new THREE.Vector3();
    const add = (o, pad) => {
      o.getWorldPosition(v);
      const up = v.y * COS - v.z * TILT;
      box.left = Math.min(box.left, v.x - pad);
      box.right = Math.max(box.right, v.x + pad);
      box.up = Math.max(box.up, up + pad);
      box.down = Math.min(box.down, up - pad);
    };
    for (const o of Object.values(this.hbones)) add(o, LOOK.flesh);
    for (const o of Object.values(this.rbones)) add(o, 0.2);
    return box;
  }
}

export class HorseFigures {
  // Fetches the horse and the rider's library; null if WebGL could not be
  // had (the horses still stand, unseen).
  static async load(options = {}) {
    const [horse, rider] = await Promise.all([ModelFigure.library(LOOK.url), ModelFigure.library(RIDER_URL)]);
    try {
      return new HorseFigures(horse, rider, options);
    } catch (e) {
      console.warn('Horses are not drawn: no WebGL context for them', e);
      return null;
    }
  }

  constructor(horse, rider, { renderer = null, phone = () => false } = {}) {
    relight(horse.scene);
    this.source = horse.scene;
    this.riderSource = rider;
    this.clips = Object.fromEntries(Object.entries(HORSE.clips).map(([key, name]) => {
      const clip = horse.animations.find((c) => c.name === name);
      if (!clip) throw new Error(`Missing clip ${name}`);
      return [key, clip];
    }));
    this.riderClip = rider.animations.find((c) => c.name === RIDER.clip);
    if (!this.riderClip) throw new Error(`Missing clip ${RIDER.clip}`);
    this.depths = new Map();
    // Roughly to size by the withers first, then exactly by the back.
    this.fit = measure(horse.scene, LOOK, HORSE.withers);
    this.phone = phone;
    this.rigs = new Map();
    this.spare = [this.calibrate(new HorseRig(this))];
    this.flat = false;
    this.scene = new THREE.Scene();
    const moon = new THREE.DirectionalLight(0xd8e0ff, 3.2);
    moon.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.8);
    rim.position.set(2, 3, -5);
    this.scene.add(moon, rim, new THREE.HemisphereLight(0x8090b0, 0x202418, 1.4));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
    this.camera.position.set(0, TILT * D, COS * D);
    this.camera.lookAt(0, 0, 0);
    this.width = 56 * SX * MAX_DRAWN;
    this.height = 2 * 48 * SY;
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
    this.drawn = [];
  }

  // The depth material for a colour one: one for each sidedness.
  depthFor(material) {
    let depth = this.depths.get(material.side);
    if (!depth) {
      depth = new THREE.MeshDepthMaterial({ side: material.side });
      this.depths.set(material.side, depth);
    }
    return depth;
  }

  // Measures the first rig standing in its idle, facing +z: the scale that
  // brings the top of its back to the saddle height, the seat on the back,
  // the stirrups and knee points beside the barrel (all kept in the seat
  // bone's own space, so they ride with it), the back's turn as it stands,
  // and how far the rider's seat is below their hips.
  calibrate(rig) {
    const fit = this.fit;
    rig.actions.idle.setEffectiveWeight(1);
    rig.mixer.update(0);
    const backTop = () => {
      rig.plant();
      const z = rig.torso.getWorldPosition(new THREE.Vector3()).z + RIDER.seat.z;
      const top = Math.max(...skinnedPoints(rig.inner, (v) => Math.abs(v.x) < 0.08 && Math.abs(v.z - z) < 0.08).map((v) => v.y));
      return { z, top: top - rig.ground };
    };
    fit.scale *= HORSE.backHeight / backTop().top;
    rig.inner.scale.setScalar(fit.scale);
    const { z, top } = backTop();
    const y = top + rig.ground;
    const s = RIDER.stirrup;
    const girth = skinnedPoints(rig.inner, (v) => Math.abs(v.z - (z + s.forward)) < 0.1 && v.y < y - 0.15 && v.y > y - 0.55);
    fit.barrel = Math.max(...girth.map((v) => Math.abs(v.x)));
    const local = (v) => rig.torso.worldToLocal(v);
    fit.seat = local(new THREE.Vector3(0, y, z));
    fit.unturn = rig.torso.getWorldQuaternion(new THREE.Quaternion()).invert();
    rig.rmixer.update(0);
    rig.rider.position.set(0, 0, 0);
    rig.rider.quaternion.identity();
    rig.rider.updateWorldMatrix(true, true);
    const hips = rig.hips.getWorldPosition(new THREE.Vector3());
    const under = skinnedPoints(rig.rider, (v) => Math.abs(v.x - hips.x) < 0.12 && Math.abs(v.z - hips.z) < 0.15 && v.y < hips.y);
    fit.seatBelowHips = hips.y - Math.min(...under.map((v) => v.y));
    const k = RIDER.knee;
    fit.stirrups = rig.legs.map((leg) => {
      const side = Math.sign(leg.thigh.getWorldPosition(new THREE.Vector3()).x - hips.x);
      return local(new THREE.Vector3(side * (fit.barrel + s.out), y - s.drop, z + s.forward));
    });
    fit.knees = rig.legs.map((leg) => {
      const side = Math.sign(leg.thigh.getWorldPosition(new THREE.Vector3()).x - hips.x);
      return local(new THREE.Vector3(side * (fit.barrel + k.out), y - k.drop, z + k.forward));
    });
    return rig;
  }

  rigOf(horse) {
    let rig = this.rigs.get(horse);
    if (rig) return rig;
    rig = this.spare.pop() ?? new HorseRig(this);
    rig.plays = null;
    this.rigs.set(horse, rig);
    this.scene.add(rig.model);
    return rig;
  }

  // Poses every horse; the rigs of horses taken away are kept for the next.
  update(dt, horses) {
    const present = new Set(horses);
    for (const [horse, rig] of this.rigs) {
      if (present.has(horse)) continue;
      this.rigs.delete(horse);
      this.scene.remove(rig.model);
      this.spare.push(rig);
    }
    for (const horse of horses) this.rigOf(horse).update(dt, horse);
  }

  // The horses in view, nearest the player first, drawn into slots along
  // the bottom of one image and as depth into the same slots above, read
  // back at once and turned into cells banded by the ground under them.
  rasterise(view, horses, near) {
    const inView = [];
    for (const horse of horses) {
      const slot = this.slotOf(horse, view);
      if (slot) inView.push({ horse, slot });
    }
    inView.sort((a, b) => Math.hypot(a.horse.x - near.x, a.horse.y - near.y) - Math.hypot(b.horse.x - near.x, b.horse.y - near.y));
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
    this.grow(width, height * 2);
    this.readWidth = width;
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear();
    r.setScissorTest(true);
    r.clippingPlanes = this.ground;
    for (const depth of [false, true]) {
      for (const rig of this.rigs.values()) rig.showDepth(depth);
      for (const { horse, slot } of drawn) {
        for (const [other, rig] of this.rigs) rig.model.visible = other === horse;
        this.frame(horse.x, horse.y, slot);
        const y = depth ? height : 0;
        r.setViewport(slot.x, y, slot.cols * SX, slot.rows * SY);
        r.setScissor(slot.x, y, slot.cols * SX, slot.rows * SY);
        r.render(this.scene, this.camera);
      }
    }
    r.setScissorTest(false);
    for (const rig of this.rigs.values()) {
      rig.showDepth(false);
      rig.model.visible = true;
    }
    const gl = r.getContext();
    gl.readPixels(0, 0, width, height * 2, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    for (const { horse, slot } of drawn) {
      const { cells, top, base } = this.cellsOf(slot, horse, view, height);
      const bands = this.flat ? [{ y: horse.y, cells, base }] : bandCells(cells, horse.y, base);
      this.drawn.push({ horse, animal: horse, cells, bands, depth: horse.y, shadow: HORSE.shadow, top, base });
    }
    return this.drawn;
  }

  // The cells a horse and its rider cover on screen.
  slotOf(horse, view) {
    if (horse.x < view.x0 - MAX_COLS / 2 || horse.x > view.x0 + view.cols + MAX_COLS / 2
      || horse.y < view.y0 - MAX_ROWS * 0.3 || horse.y > view.y0 + view.rows + MAX_ROWS * 0.7) return null;
    const reach = this.rigOf(horse).reach();
    const cols = SCALE / ASPECT;
    const cx0 = Math.max(Math.floor(horse.x + reach.left * cols) - PAD, view.x0 - 1, Math.floor(horse.x) - MAX_COLS / 2);
    const cx1 = Math.min(Math.ceil(horse.x + reach.right * cols) + PAD, view.x0 + view.cols + 1, Math.floor(horse.x) + MAX_COLS / 2);
    const cy0 = Math.max(Math.floor(horse.y - reach.up * SCALE) - PAD, view.y0 - 1, Math.floor(horse.y) - MAX_ROWS * 0.7);
    const cy1 = Math.min(Math.ceil(horse.y - reach.down * SCALE) + PAD, view.y0 + view.rows + 1, Math.floor(horse.y) + MAX_ROWS * 0.3);
    if (cx1 <= cx0 || cy1 <= cy0) return null;
    return { x: 0, cx0, cy0, cols: cx1 - cx0, rows: cy1 - cy0 };
  }

  grow(width, height) {
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

  // The slot's pixels as cells, styled as the animals are: outline glyphs
  // round the edge lit by a soft rim, a density ramp inside. Each cell also
  // takes the ground row under the nearest of its samples, from the depth
  // drawn `lift` pixels above it.
  cellsOf(slot, horse, view, lift) {
    const { cx0, cy0 } = slot;
    const w = this.readWidth;
    const h = slot.rows * SY;
    const px = this.pixels;
    const frame = { top: (horse.y - cy0) / SCALE, bottom: (horse.y - cy0 - slot.rows) / SCALE, pxHeight: h, y: horse.y };
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
        let ground = -Infinity;
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
            const d = o + lift * w * 4;
            if (px[d + 3] >= 128) ground = Math.max(ground, groundRowOf(px[d], cy * SY + j, frame));
          }
        }
        if (hits < 3) continue;
        top = Math.min(top, cy);
        r /= hits;
        g /= hits;
        b /= hits;
        const sx = cx0 + cx - view.x0;
        const sy = cy0 + cy - view.y0;
        const at = ground === -Infinity ? horse.y : ground;
        if (hits < N - 4) {
          const o = outline(mx, my, hits / N);
          const t = Math.min(1, 0.25 + o.rim * 0.5);
          cells.push({ sx, sy, row: at, g: o.g, r: r + (RIM[0] - r) * t, gg: g + (RIM[1] - g) * t, b: b + (RIM[2] - b) * t,
            br: 4, bgG: 4, bb: 6 });
          continue;
        }
        const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
        const ch = RAMP[Math.min(RAMP.length - 1, 3 + Math.floor(lum * 2.2 * (RAMP.length - 3)))];
        cells.push({ sx, sy, row: at, g: ch, r: Math.min(255, 30 + r * GAIN), gg: Math.min(255, 28 + g * GAIN),
          b: Math.min(255, 24 + b * GAIN), br: 4 + r * 0.04, bgG: 4 + g * 0.04, bb: 5 + b * 0.04 });
      }
    }
    return { cells, top: top === Infinity ? null : cy0 + top, base: Math.floor(horse.y) - view.y0 };
  }

  // Draws a figure, or one of its bands, through a writer (see cells.js).
  static draw(renderer, figure, write) {
    for (const c of figure.cells) write(renderer, c.sx, c.sy, c.g, c.r, c.gg, c.b, figure.base, c.br, c.bgG, c.bb);
  }
}

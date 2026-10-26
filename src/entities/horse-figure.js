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
// camera into slots of one offscreen image. Every surface also writes how
// far it is from the camera into the image's alpha, so the one render and
// the one read bring back depth with the colour, for horse and rider alike
// and from whichever side a surface is seen. A horse is long, and grass
// rooted between its legs must hide the hind hooves but not the front
// ones, so its cells are sorted into bands by the ground row under each one
// and drawn among the grass rows band by band.
//
// Drawing is costly where the GPU is emulated, so the figure is kept cheap:
// the rider's body is a coarser copy of the outlaw's (the figure is a few
// dozen cells tall, and detail finer than a cell is never seen), and a
// horse whose pose has moved less than a pixel since it was last drawn
// keeps the cells it had.

const SX = 4;
const SY = 6;
const N = SX * SY;
const MAX_COLS = 120;
const MAX_ROWS = 64;
const PAD = 2;
// At most this many are drawn, the nearest the player first.
export const MAX_DRAWN = 4;
export const MAX_DRAWN_PHONE = 2;
const COS = Math.sqrt(1 - TILT * TILT);
// The camera stands this far from the figure. Depth is written into alpha
// from 128 at NEAR to 255 at FAR, so a drawn pixel still reads as covered
// and 127 steps tell points 3.9 cm apart, under a third of a ground row.
const D = 20;
export const NEAR = 17;
export const FAR = 22;
// Metres: the rider's body is merged to one vertex per cube this size, and
// a figure is not drawn again while every bone has moved less than STILL
// (about a pixel) since it was drawn, and turned too little to move its
// skin STILL or to shade it a step differently (TURN radians, about 3°).
export const DETAIL = 0.02;
export const STILL = 0.01;
export const TURN = 0.05;

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

// The alpha a surface `t` metres from the camera writes, as the shader
// below does it.
export function depthAlpha(t) {
  return 128 + Math.floor(Math.min(1, Math.max(0, (t - NEAR) / (FAR - NEAR))) * 127 + 0.5);
}

// Makes an opaque material write its depth into alpha (see depthAlpha);
// opaque, it is not blended, so the alpha lands in the image as written.
export function writeDepth(material) {
  material.userData.writesDepth = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying float vDepth;\n${shader.vertexShader}`
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvDepth = -mvPosition.z;');
    shader.fragmentShader = `varying float vDepth;\n${shader.fragmentShader}`
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
\tgl_FragColor.a = (128.0 + floor(clamp((vDepth - ${NEAR.toFixed(1)}) / ${(FAR - NEAR).toFixed(1)}, 0.0, 1.0) * 127.0 + 0.5)) / 255.0;`);
  };
  return material;
}

// A coarser copy of a geometry: its vertices merged to one for each cube
// `size` across that they fall in, the one nearest the middle of those
// merged, with every attribute (skin weights and painted colours too) as
// that vertex has it, and the triangles that collapse dropped.
export function coarsen(geometry, size) {
  const pos = geometry.attributes.position;
  const cubes = new Map();
  const into = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.floor(pos.getX(i) / size)} ${Math.floor(pos.getY(i) / size)} ${Math.floor(pos.getZ(i) / size)}`;
    let cube = cubes.get(key);
    if (!cube) cubes.set(key, cube = { at: cubes.size, members: [] });
    cube.members.push(i);
    into[i] = cube.at;
  }
  const kept = [...cubes.values()].map(({ members }) => {
    const mid = [0, 0, 0];
    for (const i of members) { mid[0] += pos.getX(i); mid[1] += pos.getY(i); mid[2] += pos.getZ(i); }
    const far = (i) => (pos.getX(i) - mid[0] / members.length) ** 2 + (pos.getY(i) - mid[1] / members.length) ** 2
      + (pos.getZ(i) - mid[2] / members.length) ** 2;
    return members.reduce((best, i) => (far(i) < far(best) ? i : best));
  });
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geometry.attributes)) {
    const array = new a.array.constructor(kept.length * a.itemSize);
    kept.forEach((i, k) => { for (let c = 0; c < a.itemSize; c++) array[k * a.itemSize + c] = a.array[i * a.itemSize + c]; });
    out.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize, a.normalized));
  }
  const index = geometry.index?.array ?? Array.from({ length: pos.count }, (_, i) => i);
  const tris = [];
  const seen = new Set();
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [into[index[t]], into[index[t + 1]], into[index[t + 2]]];
    if (a === b || b === c || a === c) continue;
    const first = Math.min(a, b, c);
    const key = first === a ? `${a} ${b} ${c}` : first === b ? `${b} ${c} ${a}` : `${c} ${a} ${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tris.push(a, b, c);
  }
  out.setIndex(tris);
  return out;
}

// How far each bone's skin reaches from it, weighted by how much the bone
// bends it, in the bone's own units: turned by a small angle, a bone moves
// its skin by that angle times this at most.
export function spans(meshes) {
  const out = new Map();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const { bones, boneInverses } = mesh.skeleton;
    for (let i = 0; i < position.count; i++) {
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k);
        if (!w) continue;
        const b = skinIndex.getComponent(i, k);
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(boneInverses[b]);
        out.set(bones[b], Math.max(out.get(bones[b]) ?? 0, w * v.length()));
      }
    }
  }
  return out;
}

// Skinned meshes in place of every mesh shown under `root`, one for the
// surfaces seen from the front only and one for those seen from both
// sides (a cloak), so a figure is drawn in a call or two and its closed
// surfaces keep their back faces culled. Each surface's colour is painted
// into its vertices; a rigid piece hung on a bone (a hood, a bow) is
// skinned wholly to that bone, so it moves exactly as it did; skinned
// surfaces are made coarser by `size` (see coarsen) when it is given.
// Hidden pieces are left out. Taken in the pose the figure stands in now.
export function mergeFigure(root, size = 0) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p !== root; p = p.parent) if (!p.visible) return;
    parts.push(o);
  });
  const base = parts.find((o) => o.isSkinnedMesh);
  const { skeleton, bindMatrix } = base;
  const index = new Map(skeleton.bones.map((b, i) => [b, i]));
  const unbind = bindMatrix.clone().invert();
  const v = new THREE.Vector3();
  const tint = new THREE.Color();
  const paint = new THREE.Color();
  const sides = new Map();
  // A piece drawn through a mirroring transform has its triangles wound the
  // other way round; they are turned back where the new mesh's is not.
  const mirrored = (o) => o.matrixWorld.determinant() < 0;
  for (const o of parts) {
    const material = o.material;
    let into = sides.get(material.side);
    if (!into) sides.set(material.side, into = { position: [], normal: [], color: [], skinIndex: [], skinWeight: [], triangles: [] });
    let geometry = o.geometry;
    // Skinned: the same skin as the base's, bone for bone. Rigid: from its
    // place now, through its bone, back to where the skin is bound.
    let toSkin;
    let bones;
    if (o.isSkinnedMesh) {
      geometry = size ? coarsen(geometry, size) : geometry;
      toSkin = unbind.clone().multiply(o.bindMatrix);
      bones = o.skeleton.bones.map((b) => index.get(b));
    } else {
      let at = o.parent;
      while (at && !index.has(at)) at = at.parent;
      if (!at) throw new Error(`${o.name || 'A piece'} hangs from no bone`);
      const b = index.get(at);
      toSkin = new THREE.Matrix4().multiplyMatrices(at.matrixWorld, skeleton.boneInverses[b])
        .multiply(bindMatrix).invert().multiply(o.matrixWorld);
      bones = [b];
    }
    const turn = new THREE.Matrix3().getNormalMatrix(toSkin);
    const { attributes } = geometry;
    const first = into.position.length / 3;
    const painted = material.vertexColors && attributes.color;
    for (let i = 0; i < attributes.position.count; i++) {
      v.fromBufferAttribute(attributes.position, i).applyMatrix4(toSkin);
      into.position.push(v.x, v.y, v.z);
      v.fromBufferAttribute(attributes.normal, i).applyMatrix3(turn).normalize();
      into.normal.push(v.x, v.y, v.z);
      tint.copy(material.color);
      if (painted) tint.multiply(paint.fromBufferAttribute(attributes.color, i));
      into.color.push(tint.r, tint.g, tint.b);
      for (let k = 0; k < 4; k++) {
        into.skinIndex.push(o.isSkinnedMesh ? bones[attributes.skinIndex.getComponent(i, k)] : k ? 0 : bones[0]);
        into.skinWeight.push(o.isSkinnedMesh ? attributes.skinWeight.getComponent(i, k) : k ? 0 : 1);
      }
    }
    const order = geometry.index?.array ?? Array.from({ length: attributes.position.count }, (_, i) => i);
    const turnBack = mirrored(o) !== mirrored(root);
    for (let t = 0; t < order.length; t += 3) {
      into.triangles.push(first + order[t], first + order[turnBack ? t + 2 : t + 1], first + order[turnBack ? t + 1 : t + 2]);
    }
    o.removeFromParent();
  }
  return [...sides].map(([side, into]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(into.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(into.normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(into.color, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(into.skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(into.skinWeight, 4));
    geometry.setIndex(into.triangles);
    const mesh = new THREE.SkinnedMesh(geometry, writeDepth(new THREE.MeshLambertMaterial({ vertexColors: true, side })));
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton, bindMatrix.clone());
    return mesh;
  });
}

// The ground row of a depth sample: `byte` is the alpha read back, and
// `pixelRow` its row down the slot, which is `frame.pxHeight` pixels tall
// and spans `frame.top` to `frame.bottom` metres on the camera's plane. The
// camera is D metres from the figure, so a point (y up, z toward the
// camera) is t = D - TILT·y - COS·z deep and u = COS·y - TILT·z up the
// plane; z follows from t and u.
export function groundRowOf(byte, pixelRow, frame) {
  const t = NEAR + ((byte - 128) / 127) * (FAR - NEAR);
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

    // The bones that bend the skins, to tell how far a pose has moved.
    const skinned = (root) => {
      const out = new Set();
      root.traverse((o) => { if (o.isSkinnedMesh) for (const b of o.skeleton.bones) out.add(b); });
      return [...out];
    };
    this.joints = skinned(this.inner);
    this.riderJoints = skinned(model);
    this.ground = 0;
    this.spans = new Map();
    // What was last drawn: where, the pose then, and the cells.
    this.raster = null;
  }

  // Readies the rig to be drawn cheaply, once it has been measured: horse
  // and rider each become one mesh, the rider's body a coarser one.
  simplify() {
    this.model.updateMatrixWorld(true);
    this.spans = spans([...mergeFigure(this.inner), ...mergeFigure(this.rider, DETAIL)]);
    return this;
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

  // A horse without a rider is posed, measured and drawn alone.
  update(dt, horse) {
    this.poseHorse(dt, horse);
    this.model.rotation.y = horse.heading;
    this.plant();
    this.rider.visible = Boolean(horse.rider);
    if (this.rider.visible) {
      this.rmixer.update(dt);
      this.seat();
      riderLegs(this);
    }
    this.model.updateMatrixWorld(true);
  }

  // The bones shown, horse and rider.
  shown() {
    return this.rider.visible ? [...this.joints, ...this.riderJoints] : this.joints;
  }

  // Where every bone shown is and which way it faces: its world matrix,
  // sixteen numbers each.
  pose() {
    const bones = this.shown();
    const out = new Float32Array(bones.length * 16);
    bones.forEach((o, i) => out.set(o.matrixWorld.elements, i * 16));
    return out;
  }

  // Whether the cells last drawn still serve: the horse where it was, its
  // slot within the one drawn, and no bone moved STILL since or turned
  // enough to move its skin STILL or by TURN. A bone turning in place (the
  // head, an ear, the tail's tip) moves no joint but still bends the skin
  // round it and the light on it; heading turns every bone.
  fresh(horse, slot) {
    const r = this.raster;
    if (!r || r.x !== horse.x || r.y !== horse.y) return false;
    const was = r.slot;
    if (slot.cx0 < was.cx0 || slot.cy0 < was.cy0 || slot.cx0 + slot.cols > was.cx0 + was.cols
      || slot.cy0 + slot.rows > was.cy0 + was.rows) return false;
    const bones = this.shown();
    if (bones.length * 16 !== r.pose.length) return false;
    const p = r.pose;
    for (let i = 0; i < bones.length; i++) {
      const e = bones[i].matrixWorld.elements;
      const o = i * 16;
      if ((e[12] - p[o + 12]) ** 2 + (e[13] - p[o + 13]) ** 2 + (e[14] - p[o + 14]) ** 2 >= STILL * STILL) return false;
      // A bone's axis turned by a small angle moves by that angle times its
      // length (the rig is scaled), its skin by that times the span; a bone
      // bending no skin changes nothing.
      const span = this.spans.get(bones[i]);
      if (!span) continue;
      for (let a = 0; a < 12; a += 4) {
        const d = (e[a] - p[o + a]) ** 2 + (e[a + 1] - p[o + a + 1]) ** 2 + (e[a + 2] - p[o + a + 2]) ** 2;
        if (d * span * span >= STILL * STILL
          || d >= TURN * TURN * (p[o + a] ** 2 + p[o + a + 1] ** 2 + p[o + a + 2] ** 2)) return false;
      }
    }
    return true;
  }

  // How far horse and rider reach round the hooves on screen, in metres:
  // left, right, up and down, from their bones (as last posed) and the
  // flesh on them.
  reach() {
    const box = { left: Infinity, right: -Infinity, up: -Infinity, down: Infinity };
    const v = new THREE.Vector3();
    const add = (o, pad) => {
      v.setFromMatrixPosition(o.matrixWorld);
      const up = v.y * COS - v.z * TILT;
      box.left = Math.min(box.left, v.x - pad);
      box.right = Math.max(box.right, v.x + pad);
      box.up = Math.max(box.up, up + pad);
      box.down = Math.min(box.down, up - pad);
    };
    for (const o of Object.values(this.hbones)) add(o, LOOK.flesh);
    if (this.rider.visible) for (const o of this.riderJoints) add(o, 0.2);
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
    // Roughly to size by the withers first, then exactly by the back.
    this.fit = measure(horse.scene, LOOK, HORSE.withers);
    this.phone = phone;
    this.rigs = new Map();
    this.spare = [this.calibrate(new HorseRig(this)).simplify()];
    this.flat = false;
    this.scene = new THREE.Scene();
    const moon = new THREE.DirectionalLight(0xd8e0ff, 3.2);
    moon.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.8);
    rim.position.set(2, 3, -5);
    this.scene.add(moon, rim, new THREE.HemisphereLight(0x8090b0, 0x202418, 1.4));
    // Each rig's matrices are brought up to date as it is posed, so drawing
    // one horse doesn't walk every rig again.
    this.scene.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    // The camera sees a little beyond the depth written, so nothing of the
    // figure is cut off; what lies outside reads as NEAR or FAR.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, D - 6, D + 6);
    this.camera.position.set(0, TILT * D, COS * D);
    this.camera.lookAt(0, 0, 0);
    this.width = 56 * SX * MAX_DRAWN;
    this.height = 48 * SY;
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
    rig = this.spare.pop() ?? new HorseRig(this).simplify();
    rig.plays = null;
    rig.raster = null;
    this.rigs.set(horse, rig);
    this.scene.add(rig.model);
    rig.model.updateMatrixWorld(true);
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

  // The horses in view, nearest the player first, as cells banded by the
  // ground under them. Those that moved since they were last drawn are
  // drawn into slots along one image, read back at once.
  rasterise(view, horses, near) {
    const inView = [];
    for (const horse of horses) {
      const slot = this.slotOf(horse, view);
      if (slot) inView.push({ horse, slot });
    }
    inView.sort((a, b) => Math.hypot(a.horse.x - near.x, a.horse.y - near.y) - Math.hypot(b.horse.x - near.x, b.horse.y - near.y));
    const drawn = inView.slice(0, this.phone() ? MAX_DRAWN_PHONE : MAX_DRAWN);
    const moved = drawn.filter(({ horse, slot }) => !this.rigs.get(horse).fresh(horse, slot));
    if (moved.length) this.paint(moved);
    this.drawn = [];
    for (const { horse } of drawn) {
      const { cells, top } = this.rigs.get(horse).raster;
      for (const c of cells) {
        c.sx = c.cx - view.x0;
        c.sy = c.cy - view.y0;
      }
      const base = Math.floor(horse.y) - view.y0;
      const bands = this.flat ? [{ y: horse.y, cells, base }] : bandCells(cells, horse.y, base);
      this.drawn.push({ horse, animal: horse, cells, bands, depth: horse.y, shadow: HORSE.shadow, top, base });
    }
    return this.drawn;
  }

  // Draws these horses, each alone in its slot, reads the image back once
  // and keeps each one's cells with the pose they were drawn in.
  paint(list) {
    let width = 0;
    let height = 0;
    for (const { slot } of list) {
      slot.x = width;
      width += slot.cols * SX;
      height = Math.max(height, slot.rows * SY);
    }
    this.grow(width, height);
    this.readWidth = width;
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear();
    r.setScissorTest(true);
    r.clippingPlanes = this.ground;
    for (const { horse, slot } of list) {
      for (const [other, rig] of this.rigs) rig.model.visible = other === horse;
      this.frame(horse.x, horse.y, slot);
      r.setViewport(slot.x, 0, slot.cols * SX, slot.rows * SY);
      r.setScissor(slot.x, 0, slot.cols * SX, slot.rows * SY);
      r.render(this.scene, this.camera);
    }
    r.setScissorTest(false);
    for (const rig of this.rigs.values()) rig.model.visible = true;
    const gl = r.getContext();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    for (const { horse, slot } of list) {
      const rig = this.rigs.get(horse);
      rig.raster = { x: horse.x, y: horse.y, slot, pose: rig.pose(), ...this.cellsOf(slot, horse) };
    }
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

  // The slot's pixels as cells at their place in the world, styled as the
  // animals are: outline glyphs round the edge lit by a soft rim, a density
  // ramp inside. Each cell also takes the ground row under the nearest of
  // its samples, from the depth in their alpha.
  cellsOf(slot, horse) {
    const { cx0, cy0 } = slot;
    const w = this.readWidth;
    const h = slot.rows * SY;
    const px = this.pixels;
    const frame = { top: (horse.y - cy0) / SCALE, bottom: (horse.y - cy0 - slot.rows) / SCALE, pxHeight: h, y: horse.y };
    // The ground row is linear in the depth byte and the pixel row, so it
    // is found from the steps of each.
    const ground0 = groundRowOf(128, 0, frame);
    const perByte = groundRowOf(129, 0, frame) - ground0;
    const perRow = groundRowOf(128, 1, frame) - ground0;
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
        let near = -Infinity;
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
            const at = perByte * (px[o + 3] - 128) + perRow * (cy * SY + j);
            if (at > near) near = at;
          }
        }
        if (hits < 3) continue;
        top = Math.min(top, cy);
        r /= hits;
        g /= hits;
        b /= hits;
        const at = { cx: cx0 + cx, cy: cy0 + cy, sx: 0, sy: 0, row: ground0 + near };
        if (hits < N - 4) {
          const o = outline(mx, my, hits / N);
          const t = Math.min(1, 0.25 + o.rim * 0.5);
          cells.push({ ...at, g: o.g, r: r + (RIM[0] - r) * t, gg: g + (RIM[1] - g) * t, b: b + (RIM[2] - b) * t,
            br: 4, bgG: 4, bb: 6 });
          continue;
        }
        const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
        const ch = RAMP[Math.min(RAMP.length - 1, 3 + Math.floor(lum * 2.2 * (RAMP.length - 3)))];
        cells.push({ ...at, g: ch, r: Math.min(255, 30 + r * GAIN), gg: Math.min(255, 28 + g * GAIN),
          b: Math.min(255, 24 + b * GAIN), br: 4 + r * 0.04, bgG: 4 + g * 0.04, bb: 5 + b * 0.04 });
      }
    }
    return { cells, top: top === Infinity ? null : cy0 + top };
  }

  // Draws a figure, or one of its bands, through a writer (see cells.js).
  static draw(renderer, figure, write) {
    for (const c of figure.cells) write(renderer, c.sx, c.sy, c.g, c.r, c.gg, c.b, figure.base, c.br, c.bgG, c.bb);
  }
}

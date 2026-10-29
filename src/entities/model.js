import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../../vendor/three/utils/SkeletonUtils.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { JUMPS as CAPTURES } from './jumps.js';
import { JUMPS as KINDS } from './player.js';
import { captureClip } from './retarget.js';
import { SCALE, TILT } from './rig.js';
import { footPlants } from './footfalls.js';
import { Armory } from './armory.js';
import { Gear } from './gear.js';
import { heldWeapon } from './loadout.js';
import { getWeapon } from './weapons.js';

const SHORT_SWORD = getWeapon('sword-shield', 'iron');

// The player as a real rigged 3D character playing professionally animated
// clips (Quaternius' Universal Animation Library, CC0), drawn every frame
// into a small offscreen image from the game's camera angle and then turned
// into character cells. The cells are shaded from the rendered image the
// same way the rest of the figure code works: coverage picks between ground,
// outline and fill, brightness picks the glyph.

// Subsamples per cell, across and down.
const SX = 4;
const SY = 6;
const N = SX * SY;
// How high the foot bone sits above the ground when the foot is flat.
const FOOT_FLOOR = 0.1;
// The region drawn around the airborne feet, in cells, with room for tricks.
// It follows jump height so spell launches cannot leave the render target.
const COLS = 36;
const ROWS = 52;
const FEET_ROW = 47;

// The camera looks down at the scene; TILT is how much a step towards the
// camera moves a point down the screen, so it is the sine of that angle.
const COS = Math.sqrt(1 - TILT * TILT);

const RAMP = [...' .:-=+*#%@'].map(glyph);
const EDGE = {
  top: glyph('_'),
  topLight: glyph('.'),
  bottom: glyph('"'),
  bottomLight: glyph("'"),
  side: glyph('|'),
  rise: glyph('/'),
  fall: glyph('\\'),
};
const RIM = [196, 218, 250];

const CLIPS = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  guard: 'Sword_Idle',
  attack: 'Sword_Attack',
  jumpStart: 'Jump_Start',
  jumpLoop: 'Jump_Loop',
  jumpLand: 'Jump_Land',
  rest: 'Fixing_Kneeling',
  pickup: 'PickUp_Table',
  aim: 'Pistol_Aim_Neutral',
};

// Jumps played from motion capture (see jumps.js). Those off one foot can be
// mirrored, to take off from whichever foot is down.
const MIRRORED = ['leap', 'stride'];
// How much of each capture before take-off is played while gathering for
// the jump, in seconds.
const PRE = { leap: 0.12, stride: 0.12, hop: 0.3, spin: 0.2 };
// Where in its capture each trick starts, in seconds before take-off.
const TRICK_FROM = { backflip: 0.08, spin: 0.04, barrel: 0.1 };
// A trick is stretched over the time left in the air, but never slowed
// below this fraction of its real speed: a long fall finishes the turn early
// and reaches for the ground.
const SLOWEST = 0.65;
// How long each landing plays on over the stride, in seconds, where a jump
// that keeps moving should hand straight back to it.
const LAND_FOR = { leap: 0.06, stride: 0.16, barrel: 0.22 };

// three.js strips characters such as '.' from node names on loading.
const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);

// The jog in the library is an athlete's bounding stride, far too long for
// someone carrying a sword and pack. Its leg swing is pulled in towards its
// average by this much, keeping the timing, which shortens every step.
const STRIDE_SCALE = { jog: 0.58 };
const LEG_BONES = ['DEF-thigh.L', 'DEF-shin.L', 'DEF-foot.L', 'DEF-toe.L', 'DEF-thigh.R', 'DEF-shin.R', 'DEF-foot.R',
  'DEF-toe.R'].map((n) => THREE.PropertyBinding.sanitizeNodeName(n));
// How much of the hips' rise and fall in a stride is kept; the rest is taken
// up by the planted knee, so the body glides instead of bobbing.
const BOB_KEEP = 0.4;

// The library has a single sword attack. Each swing of a combo plays it in
// one of two slots, turn about, so a swing that cuts the last one short
// fades in over it instead of snapping it back to the start.
const ATTACK_SLOTS = ['attack', 'attackB'];
// The clip winds up until CUT[0] seconds in and cuts through until CUT[1].
// It is scrubbed to the swing under way (see Combat.swingStage) so the cut
// shown is the cut that strikes, however soon the next swing is asked for;
// it then recovers at `rate`. `from` skips part of the wind-up where the
// swing follows straight on from another.
const CUT = [0.32, 0.52];
const SWING_PLAY = {
  a: { rate: 1.4, from: 0 },
  b: { rate: 1.6, from: 0.24 },
  d: { rate: 1.5, from: 0.1 },
  c: { rate: 1.1, from: 0 },
  thrust: { rate: 1.7, from: 0.12 },
  plunge: { rate: 1.2, from: 0 },
  spin: { rate: 1, from: 0 },
};
// On the move, a swing is played from the waist up over the stride, so the
// legs keep walking under it. Its spine follows the swing's hips too, so
// the chest still turns and leans into the cut.
const WAIST = bone('DEF-spine.001');
const HIPS = bone('DEF-hips');
// How much of that turn and lean of the swing's hips is kept: the swing
// lunges down low, and upright legs would leave the body folded over.
const HIPS_KEEP = 0.55;
// Walking one way while held facing another (a swing or spell aimed with
// the cursor, or a bow drawn), the legs turn to the way they are going and
// the body twists back over them. Past this angle from the way the chest
// faces they step backwards instead, and come round to stepping forwards
// again below the second.
const BACKPEDAL_AT = 1.75;
const FORWARD_AT = 1.35;
// Share of that twist taken by each joint of the spine, from the waist up.
const TWIST = [[bone('DEF-spine.001'), 0.35], [bone('DEF-spine.002'), 0.35], [bone('DEF-spine.003'), 0.3]];
const UP = new THREE.Vector3(0, 1, 0);

// Shortest signed angle from a to b.
function angleTo(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

// Scales the swing of a clip's leg rotations about their averages, in
// place. (The body's bounce is handled each frame, see update.)
function shortenStride(clip, k) {
  for (const track of clip.tracks) {
    const [node, prop] = track.name.split('.');
    const v = track.values;
    if (prop === 'quaternion' && LEG_BONES.includes(node)) {
      // The average orientation, with every key on the same side as the first.
      const n = v.length / 4;
      const mean = new THREE.Quaternion(0, 0, 0, 0);
      const q = new THREE.Quaternion();
      const first = new THREE.Quaternion().fromArray(v, 0);
      for (let i = 0; i < n; i++) {
        q.fromArray(v, i * 4);
        const s = q.dot(first) < 0 ? -1 : 1;
        mean.x += q.x * s;
        mean.y += q.y * s;
        mean.z += q.z * s;
        mean.w += q.w * s;
      }
      mean.normalize();
      for (let i = 0; i < n; i++) {
        q.fromArray(v, i * 4);
        if (q.dot(mean) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        mean.clone().slerp(q, k).toArray(v, i * 4);
      }
    }
  }
}

// Turns a bone so its world orientation becomes `world`.
export function setWorldQuaternion(b, world) {
  const parent = b.parent.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(parent.invert().multiply(world));
  b.updateMatrixWorld(true);
}

// Two-bone IK: bends and swings a limb to reach `target` in its current plane.
export function reachFor(upper, lower, end, target) {
  const A = upper.getWorldPosition(new THREE.Vector3());
  const B = lower.getWorldPosition(new THREE.Vector3());
  const C = end.getWorldPosition(new THREE.Vector3());
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
    setWorldQuaternion(lower, turn.multiply(lower.getWorldQuaternion(new THREE.Quaternion())));
  }
  const C2 = end.getWorldPosition(new THREE.Vector3());
  const swing = new THREE.Quaternion().setFromUnitVectors(C2.sub(A).normalize(), target.clone().sub(A).normalize());
  setWorldQuaternion(upper, swing.multiply(upper.getWorldQuaternion(new THREE.Quaternion())));
}

// Picks the outline glyph for a partly covered cell from the direction the
// covered samples lean, and how squarely that edge faces the moon.
export function outline(mx, my, cover) {
  const len = Math.hypot(mx, my) || 1;
  const nx = -mx / len;
  const ny = -my / len;
  const a = (Math.atan2(ny, nx) * 180) / Math.PI;
  let g;
  if (a > -112.5 && a <= -67.5) g = cover > 0.5 ? EDGE.top : EDGE.topLight;
  else if (a > 67.5 && a <= 112.5) g = cover > 0.5 ? EDGE.bottom : EDGE.bottomLight;
  else if ((a > -22.5 && a <= 22.5) || a > 157.5 || a <= -157.5) g = EDGE.side;
  else if ((a > -67.5 && a <= -22.5) || (a > 112.5 && a <= 157.5)) g = EDGE.fall;
  else g = EDGE.rise;
  return { g, rim: Math.max(0, nx * -0.6 + ny * -0.8) };
}

// The outlaw as the player sees them: a copy of the character with its own
// skeleton and geometry, in dark undyed cloth and leather, dressed in its
// clothing and weapons. Anyone else drawn as the outlaw (a rider) is made
// the same way.
export function dressCharacter(gltf) {
  const model = cloneSkinned(gltf.scene);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    // Gear paints vertex colours, so its geometry belongs to this figure too.
    o.geometry = o.geometry.clone();
    // Dark, undyed cloth and leather; the mannequin's joint rings a shade
    // darker still.
    const joint = o.material?.name === 'M_Joints';
    o.material = new THREE.MeshLambertMaterial({ color: joint ? 0x4a443e : 0x8c7a6c });
    o.material.userData.joint = joint;
  });
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
  });
  // Weapons in hand, across the back or at the hip; then clothing painted
  // by body region and gear on the bones, set up while the skeleton is
  // still in its rest pose.
  const armory = new Armory(model, bones);
  const gear = new Gear(model, bones);
  return { model, bones, gear, armory };
}

// Each animation library is fetched once and shared, e.g. with the skeletons.
const libraries = new Map();

export class ModelFigure {
  static library(url) {
    if (!libraries.has(url)) libraries.set(url, new GLTFLoader().loadAsync(url));
    return libraries.get(url);
  }

  static async load(url) {
    return new ModelFigure(await ModelFigure.library(url));
  }

  constructor(gltf) {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(COLS * SX, ROWS * SY, false);
    this.renderer.setClearColor(0x000000, 0);
    // Clip the submerged geometry in 3D, so each leg meets the surface at
    // its own position even when striding towards or away from the camera.
    this.waterClipping = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
    this.waterDepth = 0;
    this.pixels = new Uint8Array(COLS * SX * ROWS * SY * 4);

    this.scene = new THREE.Scene();
    // Moonlight from the upper left and in front, a cold rim from behind,
    // and a little sky light so the shadowed side is not black.
    // Lit brighter than the world around it, so the player always stands out.
    const moon = new THREE.DirectionalLight(0xd0dcff, 3.6);
    moon.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 2);
    rim.position.set(2, 3, -5);
    this.scene.add(moon, rim, new THREE.HemisphereLight(0x8090b0, 0x202418, 1.6));

    const { model, bones, gear, armory } = dressCharacter(gltf);
    this.model = model;
    this.scene.add(this.model);
    this.bones = bones;
    // Weapons in hand, across the back or at the hip, and the clothing.
    this.armory = armory;
    this.gear = gear;
    this.feet = ['DEF-foot.L', 'DEF-foot.R'].map((n) => this.bones[bone(n)]);
    this.legs = ['L', 'R'].map((side) => ({
      thigh: this.bones[bone(`DEF-thigh.${side}`)],
      shin: this.bones[bone(`DEF-shin.${side}`)],
      foot: this.bones[bone(`DEF-foot.${side}`)],
    }));
    this.torchArm = {
      upper: this.bones[bone('DEF-upper_arm.L')],
      fore: this.bones[bone('DEF-forearm.L')],
      hand: this.bones[bone('DEF-hand.L')],
    };
    this.torchLight = new THREE.PointLight(0xffa444, 0, 3, 2);
    this.scene.add(this.torchLight);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    this.camera.position.set(0, TILT * 20, COS * 20);
    this.camera.lookAt(0, 0, 0);
    // Rows a metre of height rises, as a fraction of SCALE, and rows per unit
    // across the camera's image: both follow the camera pitch (see setLook).
    this.up = COS;
    this.rowsPerUnit = SCALE;

    // The captured jumps are put onto the skeleton while it still stands in
    // its rest pose, with the hands held as in the library's jump.
    const clips = Object.fromEntries(Object.entries(CLIPS).map(([key, name]) => [key,
      gltf.animations.find((c) => c.name === name).clone()]));
    clips.attackB = clips.attack.clone();
    const captured = [];
    for (const [key, data] of Object.entries(CAPTURES)) {
      clips[key] = captureClip(key, data, this.model, this.bones, { hold: clips.jumpLoop });
      captured.push(key);
      if (MIRRORED.includes(key)) {
        clips[`${key}M`] = captureClip(`${key}M`, data, this.model, this.bones, { mirror: true, hold: clips.jumpLoop });
        captured.push(`${key}M`);
      }
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [key, clip] of Object.entries(clips)) {
      if (STRIDE_SCALE[key]) shortenStride(clip, STRIDE_SCALE[key]);
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[key] = a;
    }
    for (const k of [...ATTACK_SLOTS, 'jumpStart', 'jumpLand', 'pickup', ...captured]) {
      this.actions[k].setLoop(THREE.LoopOnce, 1);
      this.actions[k].clampWhenFinished = true;
    }
    // Every clip that belongs to jumping, for keeping the stride's footing
    // out of the way while they play.
    this.jumpKeys = ['jumpStart', 'jumpLoop', 'jumpLand', ...captured];
    this.weights = Object.fromEntries(Object.keys(clips).map((k) => [k, k === 'idle' ? 1 : 0]));
    // The swing from the waist up: each bone above the hips with the
    // attack's own track for it, sampled at either slot's moment.
    this.upper = [];
    this.bones[WAIST].traverse((b) => {
      const track = clips.attack.tracks.find((t) => t.name === `${b.name}.quaternion`);
      if (b.isBone && track) this.upper.push({ bone: b, track: track.createInterpolant() });
    });
    const hipsTrack = clips.attack.tracks.find((t) => t.name === `${HIPS}.quaternion`);
    this.swingHips = hipsTrack?.createInterpolant() ?? null;
    // How strongly each slot's swing is laid over the stride.
    this.layer = Object.fromEntries(ATTACK_SLOTS.map((k) => [k, 0]));
    this.slot = 1;
    // The legs' turn away from the chest, and whether they are stepping
    // backwards.
    this.legYaw = 0;
    this.backpedal = false;

    // How fast each locomotion clip moves over the ground, and when in it
    // the left foot touches down, measured from the feet themselves.
    this.gaits = ['walk', 'jog'].map((k) => this.measure(k));
    this.phase = 0;
    this.oneShot = null;
    this.lastMove = null;
    // The jump under way: its kind, which clip and any trick.
    this.jump = null;
    // Clips whose moment is set by hand this frame, and the turn about the
    // upright a spinning jump adds.
    this.held = {};
    this.turnFrom = null;
    this.turned = 0;
    this.turnLeft = 0;
    this.cells = [];
  }

  // Plays a locomotion clip on its own through one loop and finds how fast
  // a planted foot moves back (the clip's ground speed) and when the left
  // foot touches down.
  measure(key) {
    const a = this.actions[key];
    const dur = a.getClip().duration;
    const foot = this.bones[bone('DEF-foot.L')];
    for (const other of Object.values(this.actions)) other.setEffectiveWeight(0);
    a.setEffectiveWeight(1);
    const steps = 120;
    const p = new THREE.Vector3();
    const ys = [];
    const zs = [];
    for (let i = 0; i < steps; i++) {
      a.time = (i / steps) * dur;
      this.mixer.update(0);
      this.model.updateMatrixWorld(true);
      foot.getWorldPosition(p);
      ys.push(p.y);
      zs.push(p.z);
    }
    a.setEffectiveWeight(0);
    // A planted foot is near its lowest and sliding back under the body;
    // how fast it slides is the clip's ground speed.
    const low = Math.min(...ys);
    const down = (i) => ys[i] < low + 0.05;
    const speeds = [];
    let strike = 0;
    for (let i = 0; i < steps; i++) {
      const j = (i + 1) % steps;
      const v = ((zs[i] - zs[j]) * steps) / dur;
      if (down(i) && down(j) && v > 0) speeds.push(v);
      if (down(i) && !down((i + steps - 1) % steps)) strike = i / steps;
    }
    speeds.sort((x, y) => x - y);
    const speed = speeds[Math.floor(speeds.length / 2)] || 1;
    return { key, speed, cycle: speed * dur, strike };
  }

  // A respawn starts a new pose, without blending the old jump or attack
  // into it or treating the teleport as a landing.
  resetPose(player) {
    this.phase = 0;
    this.oneShot = null;
    this.lastMove = null;
    this.jump = null;
    this.picking = false;
    this.held = {};
    this.turnFrom = null;
    this.turned = 0;
    this.turnLeft = 0;
    this.level = undefined;
    for (const k in this.layer) this.layer[k] = 0;
    this.legYaw = 0;
    this.backpedal = false;
    for (const [key, action] of Object.entries(this.actions)) {
      action.reset().play();
      this.weights[key] = key === 'idle' ? 1 : 0;
      action.setEffectiveWeight(this.weights[key]);
    }
    this.update(0, player);
  }

  // Sets the pose for this frame from the player's state.
  update(dt, p) {
    this.posePending = false;
    this.renderLift = p.air * this.up * SCALE;
    const cb = p.combat;
    // The legs follow the ground actually covered this frame: as soon as the
    // body stops, so do they, rather than running on in place while a
    // smoothed speed dies away.
    const speed = p.groundSpeed ?? p.speed;
    // Water drag changes cadence, while the blend still follows whether
    // the player is walking or running at that reduced ground speed.
    // Roots and channels can reduce movement speed to exactly zero. A
    // stationary rooted character must keep a finite idle animation.
    const speedScale = p.speedScale ?? 1;
    const gaitSpeed = speedScale > 0 ? speed / speedScale : 0;
    const w = Object.fromEntries(Object.keys(this.actions).map((k) => [k, 0]));

    // Locomotion: pure walk at the player's walking speed, pure jog at
    // their running speed, blended in between while speeding up or slowing.
    const walkAt = p.walkSpeed;
    const runAt = p.runSpeed;
    const moving = Math.min(1, gaitSpeed / (walkAt * 0.5));
    const t = Math.max(0, Math.min(1, (gaitSpeed - walkAt) / (runAt - walkAt)));
    const loco = { walk: 1 - t, jog: t };
    // Advance one shared gait cycle by ground covered, so the feet keep pace
    // with the ground whichever clips are mixed.
    let perMetre = 0;
    for (const g of this.gaits) perMetre += (loco[g.key] ?? 0) / g.cycle;
    this.strafe(dt, p, moving);
    const before = this.phase;
    const after = before + (this.backpedal ? -1 : 1) * speed * dt * perMetre;
    this.phase = ((after % 1) + 1) % 1;
    // A swing on the move leaves the legs striding, so they still sound.
    const striding = !this.oneShot || ATTACK_SLOTS.includes(this.oneShot.key);
    const plants = moving > 0.5 && p.air === 0 && p.windUp < 0 && !cb.charge && striding
      ? footPlants(Math.min(before, after), Math.max(before, after)) : [];
    for (const g of this.gaits) {
      const a = this.actions[g.key];
      a.time = (((this.phase + g.strike) % 1) + 1) % 1 * a.getClip().duration;
    }
    const still = 1 - moving;
    w.idle = still;
    for (const k in loco) w[k] = loco[k] * moving;

    // Standing with the sword out, hold a guard instead of idling.
    if (cb.inHand) {
      w.guard = w.idle;
      w.idle = 0;
    }
    // Resting on one knee.
    if (p.kneel > 0.01) {
      for (const k in w) w[k] *= 1 - p.kneel;
      w.rest = p.kneel;
    }
    // Taking aim with a bow or a throw raises the arms toward the target,
    // less so while on the move.
    if (p.ranged?.aiming) {
      const k = 1 - moving * 0.6;
      for (const key in w) w[key] *= 1 - k;
      w.aim = k;
    }
    this.held = {};
    this.jumping(p, w);

    // Sword swings play the attack clip over everything else.
    const swing = cb.move && cb.move !== 'draw' && cb.move !== 'sheathe' ? cb.move : null;
    if (swing && swing !== this.lastMove) {
      const play = SWING_PLAY[swing] ?? { rate: 1.3, from: 0 };
      // Only a swing following straight on from another skips its wind-up.
      const chained = ATTACK_SLOTS.includes(this.oneShot?.key);
      this.slot = 1 - this.slot;
      this.start(ATTACK_SLOTS[this.slot], play.rate, chained ? play.from : 0);
      this.oneShot.swing = swing;
      this.oneShot.at = this.oneShot.from;
    }
    if (this.oneShot?.swing) this.followSwing(dt, cb);
    this.lastMove = cb.move;
    // Stooping to gather something plays once per pickup.
    const picking = p.pickupTime >= 0;
    if (picking && !this.picking && !swing) this.start('pickup', 1.3);
    else if (!picking && this.picking && this.oneShot?.key === 'pickup') this.oneShot = null;
    this.picking = picking;
    const layer = Object.fromEntries(ATTACK_SLOTS.map((k) => [k, 0]));
    if (this.oneShot) {
      this.oneShot.t += dt;
      const left = this.oneShot.swing ? (this.oneShot.until - this.oneShot.at) / this.oneShot.rate
        : (this.oneShot.until - this.oneShot.from) / this.oneShot.rate - this.oneShot.t;
      let k = Math.min(1, this.oneShot.t / 0.06, Math.max(0, left / 0.12));
      if (ATTACK_SLOTS.includes(this.oneShot.key)) {
        // Walking, running or in the air the legs carry on with what they
        // were doing; the swing takes the body from the waist up.
        const legs = p.air > 0 ? 1 : moving;
        layer[this.oneShot.key] = k * legs;
        k *= 1 - legs;
      }
      for (const key in w) w[key] *= 1 - k;
      w[this.oneShot.key] = k;
      if (left <= 0) this.oneShot = null;
    }

    // Ease each weight towards its target so changes never pop.
    const ease = 1 - Math.exp(-dt * 14);
    for (const k in w) {
      this.weights[k] += (w[k] - this.weights[k]) * ease;
      this.actions[k].setEffectiveWeight(this.weights[k]);
    }
    for (const k in layer) this.layer[k] += (layer[k] - this.layer[k]) * ease;
    this.mixer.update(dt);
    for (const g of this.gaits) {
      const a = this.actions[g.key];
      a.time = (((this.phase + g.strike) % 1) + 1) % 1 * a.getClip().duration;
    }
    for (const k in this.held) this.actions[k].time = this.held[k];
    this.mixer.update(0);
    this.layerSwing();

    this.gear.apply(p.equipment, p.skin);
    const weapon = p.equipment === undefined ? SHORT_SWORD : heldWeapon(p.equipment);
    this.armory.update(weapon, cb.inHand || Boolean(p.ranged?.aiming));
    this.turned = this.spinTurn(p);
    this.model.rotation.y = p.heading + (cb.spin ?? 0) + this.turned + this.legYaw;
    // Keep the stride on the ground. The run clip throws the body well clear
    // of it between steps and drives it down into each landing, which a
    // shorter, laden stride would not; with its legs shortened, the planted
    // foot would sink into the ground at the bottom. Find the lowest foot and
    // move the body so it rests on the ground, leaving only a trace of time
    // in the air.
    this.model.position.y = 0;
    this.model.updateMatrixWorld(true);
    this.twistBack();
    for (const side of plants) {
      const foot = this.bones[bone(side === 0 ? 'DEF-foot.L' : 'DEF-foot.R')];
      const at = foot.getWorldPosition(new THREE.Vector3());
      p.events.push({ type: 'step', x: p.x + at.x * SCALE / ASPECT,
        y: p.y + at.z * SCALE * TILT, strength: Math.min(1, speed / 5) });
    }
    const v = new THREE.Vector3();
    let lowest = Infinity;
    for (const f of this.feet) lowest = Math.min(lowest, f.getWorldPosition(v).y);
    const off = lowest - FOOT_FLOOR;
    // A jump's own clips put the body where it should be.
    let jumping = 0;
    for (const k of this.jumpKeys) jumping += this.weights[k];
    const grounded = moving * Math.max(0, 1 - jumping);
    const lift = (off > 0 ? off * 0.85 : off) * grounded;
    this.waterDepth = p.waterDepth ?? 0;
    this.model.position.y = p.air - this.waterDepth - lift;
    this.model.updateMatrixWorld(true);
    this.steady(dt, grounded);
    if (p.torch) {
      const shoulder = this.torchArm.upper.getWorldPosition(new THREE.Vector3());
      // Held ahead of the chest, which faces round from the legs.
      const chest = new THREE.Quaternion().setFromAxisAngle(UP, this.model.rotation.y - this.legYaw);
      const offset = new THREE.Vector3(0.18, -0.22, 0.28).applyQuaternion(chest);
      const arm = this.torchArm;
      reachFor(arm.upper, arm.fore, arm.hand, shoulder.add(offset));
      this.torchLight.position.copy(this.torchArm.hand.getWorldPosition(new THREE.Vector3()));
      this.torchLight.position.y += 0.55;
    }
    this.torchLight.intensity = p.torch ? 1.6 + Math.sin(p.time * 13.7) * 0.2 : 0;
  }

  // Where the surface cuts each leg, in world-cell offsets from the body.
  // These little waterlines follow the animated knees, rather than orbiting
  // the player's centre, and vanish once a jumping foot clears the surface.
  waterContacts() {
    if (this.waterDepth <= 0.001) return [];
    const contacts = [];
    for (const leg of this.legs) {
      const joints = [leg.thigh, leg.shin, leg.foot].map((b) => b.getWorldPosition(new THREE.Vector3()));
      for (let i = 0; i < joints.length - 1; i++) {
        const a = joints[i];
        const b = joints[i + 1];
        if (a.y < 0 || b.y > 0 || a.y === b.y) continue;
        const at = a.clone().lerp(b, a.y / (a.y - b.y));
        contacts.push({ x: at.x * SCALE / ASPECT, y: at.z * SCALE * TILT });
        break;
      }
    }
    return contacts;
  }

  // Jumping: picks the clip for the kind of jump at take-off and plays it in
  // step with the gathering, the flight and any trick, then lets its
  // landing run on over whatever comes next.
  jumping(p, w) {
    const up = p.windUp >= 0 || p.air > 0;
    if (up && (!this.jump || this.jump.launchId !== p.launchId)) {
      // A lift/knockback may arrive without a normal jump capture, including
      // an older peer's state. The standing loop also covers forced flight.
      const kind = p.jumpKind === 'stand' || CAPTURES[p.jumpKind] ? p.jumpKind : 'stand';
      let key = kind;
      if (MIRRORED.includes(key)) {
        // Off whichever foot is down now.
        const [l, r] = this.feet.map((f) => f.getWorldPosition(new THREE.Vector3()).y);
        if ((l < r ? 'L' : 'R') !== CAPTURES[key].off) key += 'M';
      }
      this.jump = { kind, key, trick: null, launchId: p.launchId };
      // Unused one-shot clips still advance with the mixer; replay anticipation
      // for each standing jump instead of blending in its clamped final pose.
      if (kind === 'stand') this.actions.jumpStart.reset().play();
      this.turnFrom = null;
      // Springing straight off again cuts the last landing short.
      if (this.oneShot && this.jumpKeys.includes(this.oneShot.key)) this.oneShot = null;
    }
    if (!up) {
      if (this.jump) this.land(this.jump, p);
      this.jump = null;
      this.turnLeft = 0;
      return;
    }
    const j = this.jump;
    for (const k in w) w[k] = 0;
    if (p.trick && !j.trick) {
      j.trick = p.trick;
      // A turn already under way is finished off during the trick.
      this.turnLeft = this.turned;
      this.turnFrom = null;
    }
    if (j.trick) {
      // The trick runs from where it starts in its capture to the landing,
      // over the time left in the air.
      const c = CAPTURES[j.trick];
      const from = c.takeoff - TRICK_FROM[j.trick];
      const span = c.land - from;
      const u = Math.min(1, Math.max(p.trickT / p.trickFlight, (p.trickT * SLOWEST) / span));
      this.hold(j.trick, from + u * span, w);
      if (j.trick === 'spin') this.turnFrom ??= from;
      return;
    }
    if (j.kind === 'stand') {
      if (p.windUp >= 0) w.jumpStart = 1;
      else w.jumpLoop = 1;
      return;
    }
    const c = CAPTURES[j.kind];
    let t;
    if (p.windUp >= 0) t = c.takeoff - PRE[j.kind] * (1 - p.windUp / KINDS[j.kind].windUp);
    else t = c.takeoff + Math.min(1, p.jumpT / p.flight) * (c.land - c.takeoff);
    this.hold(j.key, Math.max(0, t), w);
    if (j.kind === 'spin') this.turnFrom ??= Math.max(0, c.takeoff - PRE.spin);
  }

  // Plays clip `key` alone this frame, at moment `t`.
  hold(key, t, w) {
    w[key] = 1;
    this.held[key] = t;
  }

  // Touching down: the rest of the clip plays out from the moment of
  // landing, and a stride picks up again on the foot that landed.
  land(j, p) {
    // A swing under way, such as a plunge driven into the ground, plays out
    // through the landing.
    if (this.oneShot?.swing) return;
    if (!j.trick && j.kind === 'stand') {
      this.start('jumpLand', 1.4);
      return;
    }
    const key = j.trick ?? j.key;
    const base = j.trick ?? j.kind;
    const c = CAPTURES[base];
    const stay = LAND_FOR[base];
    this.start(key, 1, c.land, stay === undefined ? Infinity : c.land + stay);
    if ((p.groundSpeed ?? p.speed) > 0.6) {
      const onto = key.endsWith('M') ? (c.onto === 'L' ? 'R' : 'L') : c.onto;
      this.phase = onto === 'L' ? 0 : 0.5;
    }
  }

  // How far round a spinning jump has turned, by the capture's own timing,
  // scaled so the turn ends exactly where it began.
  spinTurn(p) {
    if (this.turnLeft > 0 && p.trick) {
      // Finishing a turn cut short by a trick, quickly at first.
      const k = 1 - (1 - Math.min(1, p.trickT / 0.35)) ** 2;
      return this.turnLeft + (Math.PI * 2 - this.turnLeft) * k;
    }
    if (this.turnFrom === null || this.weights.spin < 0.01) return 0;
    const c = CAPTURES.spin;
    const at = (t) => {
      const f = Math.max(0, Math.min(c.turn.length - 1, t * c.fps));
      const i = Math.min(c.turn.length - 2, Math.floor(f));
      return c.turn[i] + (c.turn[i + 1] - c.turn[i]) * (f - i);
    };
    const from = at(this.turnFrom);
    return Math.max(0, Math.min(1, (at(this.actions.spin.time) - from) / (1 - from))) * Math.PI * 2;
  }

  // Moves a swing's clip on to match the blade: through the wind-up and the
  // cut in step with the swing, then recovering at its own pace once the
  // swing has struck or another has taken over. It never runs backwards.
  followSwing(dt, cb) {
    const shot = this.oneShot;
    const stage = cb.move === shot.swing ? cb.swingStage : null;
    let at;
    if (stage?.part === 'wind') at = shot.from + (CUT[0] - shot.from) * stage.u;
    else if (stage?.part === 'cut') {
      // A swing straight into its cut still raises the blade first.
      const start = stage.windUp ? CUT[0] : shot.from;
      at = start + (CUT[1] - start) * stage.u;
    } else at = Math.max(shot.at + dt * shot.rate, stage ? CUT[1] : 0);
    shot.at = Math.min(shot.until, Math.max(shot.at, at));
    this.held[shot.key] = shot.at;
  }

  // Walking one way while held facing another, turns the legs to the way
  // they are going, stepping backwards once that is behind the chest. Turned
  // freely, the chest soon swings round to the way the legs go, so the legs
  // never lead it by more than they already did.
  strafe(dt, p, moving) {
    const h = p.heading;
    const surge = p.surge ?? 0;
    const vx = (p.vx ?? 0) + Math.sin(h) * surge;
    const vz = (p.vz ?? 0) + Math.cos(h) * surge;
    const held = p.facing != null || Boolean(p.ranged?.aiming);
    let to = 0;
    if (moving > 0.2 && p.air === 0 && Math.hypot(vx, vz) > 0.3) {
      const d = angleTo(h, Math.atan2(vx, vz));
      const flip = this.backpedal ? Math.abs(d) < FORWARD_AT : held && Math.abs(d) > BACKPEDAL_AT;
      if (flip) this.backpedal = !this.backpedal;
      to = this.backpedal ? angleTo(0, d + Math.PI) : d;
      if (!held && !this.backpedal) to = Math.max(-Math.abs(this.legYaw), Math.min(Math.abs(this.legYaw), to));
    } else this.backpedal = false;
    this.legYaw += angleTo(this.legYaw, to) * (1 - Math.exp(-12 * dt));
  }

  // Lays the swing over the stride from the waist up, each slot with its
  // own weight as one swing fades into the next. The pose the mixer made
  // already holds any whole-body share of the swing.
  layerSwing() {
    let rest = 1;
    for (const k of ATTACK_SLOTS) rest -= this.layer[k] + this.weights[k];
    let sum = Math.max(0, rest);
    const hips = this.bones[HIPS];
    const q = new THREE.Quaternion();
    const turn = new THREE.Quaternion();
    const lean = new THREE.Quaternion();
    for (const k of ATTACK_SLOTS) {
      if (this.layer[k] < 1e-3) continue;
      sum += this.layer[k];
      const share = this.layer[k] / sum;
      const t = this.actions[k].time;
      for (const { bone: b, track } of this.upper) {
        q.fromArray(track.evaluate(t));
        if (b.name === WAIST && this.swingHips) {
          // The stride keeps its own hips, so the waist takes up the turn
          // and lean the swing gives its hips.
          turn.copy(hips.quaternion).slerp(lean.fromArray(this.swingHips.evaluate(t)), HIPS_KEEP);
          q.premultiply(turn).premultiply(turn.copy(hips.quaternion).invert());
        }
        b.quaternion.slerp(q, share);
      }
    }
  }

  // Turns the body from the waist up back round over legs turned to the
  // way they walk, so the chest and the blade face where they are aimed.
  twistBack() {
    if (Math.abs(this.legYaw) < 1e-4) return;
    const q = new THREE.Quaternion();
    for (const [name, part] of TWIST) {
      const b = this.bones[name];
      q.setFromAxisAngle(UP, -this.legYaw * part);
      setWorldQuaternion(b, q.multiply(b.getWorldQuaternion(new THREE.Quaternion())));
    }
  }

  // Evens out the hips' rise and fall while striding. The body is moved
  // towards a running average of its height, and each planted foot is put
  // back where it was by bending or straightening its knee.
  steady(dt, moving) {
    const hips = this.bones[bone('DEF-hips')];
    const v = new THREE.Vector3();
    const y = hips.getWorldPosition(v).y;
    this.level = this.level === undefined ? y : this.level + (y - this.level) * (1 - Math.exp(-dt * 3));
    if (moving < 0.01) return;
    const planted = this.legs.map((l) => {
      const at = l.foot.getWorldPosition(new THREE.Vector3());
      // Wading lowers the whole body; judge contact from the lake bed.
      return at.y + this.waterDepth < FOOT_FLOOR + 0.035 ? at : null;
    });
    const shift = (this.level + (y - this.level) * BOB_KEEP - y) * moving;
    this.model.position.y += shift;
    this.model.updateMatrixWorld(true);
    this.legs.forEach((l, i) => {
      if (planted[i]) reachFor(l.thigh, l.shin, l.foot, planted[i]);
    });
  }

  // Starts a one-shot clip at a given playback rate, from the beginning or
  // from `from` seconds in, to its end or to `until`.
  start(key, rate, from = 0, until = Infinity) {
    const a = this.actions[key];
    a.reset();
    a.timeScale = rate;
    a.time = from;
    a.play();
    this.oneShot = { key, rate, t: 0, from, until: Math.min(until, a.getClip().duration) };
  }

  // Views the model from the camera pitch `look` (see camera.js pitchLook):
  // ground depth stays as it is and height rises `look.rise` rows a metre.
  setLook(look) {
    this.up = look.up;
    this.rowsPerUnit = look.rowsPerUnit;
    this.camera.position.set(0, look.sin * 20, look.cos * 20);
    this.camera.lookAt(0, 0, 0);
    // A pose rendered at the old angle is never read back.
    this.posePending = false;
  }

  // Where a point on the model ends up on screen, in cells from the feet.
  toScreen(v) {
    return [(v.x * SCALE) / ASPECT, (-v.y * this.up + v.z * TILT) * SCALE];
  }

  // The sword's base and tip on screen, in cells from the feet, if drawn.
  swordLine() {
    const held = this.armory.held;
    if (!held || held.userData.tip.y <= held.userData.base.y) return null;
    const base = held.localToWorld(held.userData.base.clone());
    const tip = held.localToWorld(held.userData.tip.clone());
    return { base: this.toScreen(base), tip: this.toScreen(tip) };
  }

  // Hand coordinates locate the ASCII torch, its glow and its throw origin.
  torchPose() {
    const hand = this.torchArm.hand.getWorldPosition(new THREE.Vector3());
    return { x: hand.x * SCALE / ASPECT, y: hand.z * SCALE * TILT, h: hand.y * SCALE * this.up };
  }

  // Submit this frame's pose before the CPU draws the terrain. Flushing
  // starts the GPU now, so its work can overlap the rest of this frame.
  renderPose(x, y) {
    const cx0 = Math.floor(x) - (COLS >> 1);
    const cy0 = Math.floor(y - (this.renderLift ?? 0)) - FEET_ROW;
    const widthM = (COLS * ASPECT) / SCALE;
    const heightM = ROWS / this.rowsPerUnit;
    // Keep projection anchored to the ground while the image window follows
    // the airborne body; its cells still land at their exact world positions.
    const fx = (x - cx0) / COLS;
    const fy = (y - cy0) / ROWS;
    const cam = this.camera;
    cam.left = -fx * widthM;
    cam.right = (1 - fx) * widthM;
    cam.top = fy * heightM;
    cam.bottom = -(1 - fy) * heightM;
    cam.updateProjectionMatrix();

    this.renderer.clippingPlanes = this.waterDepth > 0.001 ? this.waterClipping : [];
    this.renderer.render(this.scene, cam);
    const gl = this.renderer.getContext();
    if (gl.getBufferSubData) {
      // Queue the GPU-to-buffer copy too. Reading straight into a JS array
      // here would wait for the GPU before any terrain work could begin.
      if (!this.pixelBuffer || !gl.isBuffer(this.pixelBuffer)) {
        this.pixelBuffer = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, this.pixels.byteLength, gl.STREAM_READ);
      } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffer);
      gl.readPixels(0, 0, COLS * SX, ROWS * SY, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    gl.flush();
    this.renderedX = x;
    this.renderedY = y;
    this.posePending = true;
  }

  // Read the same frame's pose and turn it into cells. A standalone caller
  // still gets a fresh render; no previous-frame image or animation is used.
  rasterise(view, x, y) {
    if (!this.posePending || this.renderedX !== x || this.renderedY !== y) this.renderPose(x, y);
    this.posePending = false;
    const cx0 = Math.floor(x) - (COLS >> 1);
    const cy0 = Math.floor(y - (this.renderLift ?? 0)) - FEET_ROW;
    const w = COLS * SX;
    const h = ROWS * SY;
    const gl = this.renderer.getContext();
    if (gl.getBufferSubData) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    } else gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
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
          // WebGL rows run bottom-up.
          const row = h - 1 - (cy * SY + j);
          for (let i = 0; i < SX; i++) {
            const o = (row * w + cx * SX + i) * 4;
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
        const sx = cx0 + cx - view.x0;
        const sy = cy0 + cy - view.y0;
        const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
        if (hits < N - 4) {
          // The silhouette, picked out with a cold moonlit rim.
          const o = outline(mx, my, hits / N);
          const t = Math.min(1, 0.35 + o.rim * 0.6);
          const k = 0.9;
          cells.push({ sx, sy, g: o.g, r: r * k + (RIM[0] - r * k) * t, gg: g * k + (RIM[1] - g * k) * t,
            b: b * k + (RIM[2] - b * k) * t, br: 4, bgG: 5, bb: 8 });
          continue;
        }
        // Heavier characters and a lifted colour than anything around it, so
        // the player stands out from the ground and props.
        const ch = RAMP[Math.min(RAMP.length - 1, 4 + Math.floor(lum * 2.4 * (RAMP.length - 4)))];
        const k = 1.45;
        cells.push({ sx, sy, g: ch, r: Math.min(255, 40 + r * k), gg: Math.min(255, 36 + g * k), b: Math.min(255, 30 + b * k),
          br: 3 + r * 0.05, bgG: 3 + g * 0.05, bb: 5 + b * 0.06 });
      }
    }
    this.cells = cells;
    this.top = top === Infinity ? null : cy0 + top;
    this.base = Math.floor(y) - view.y0;
    return cells;
  }

  // Draws the cells from the last rasterise through a writer (see cells.js).
  draw(r, write) {
    for (const c of this.cells) write(r, c.sx, c.sy, c.g, c.r, c.gg, c.b, this.base, c.br, c.bgG, c.bb);
  }
}

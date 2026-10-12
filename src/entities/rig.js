// The wanderer's skeleton. Joints are posed in 3D (metres, y up) from a few
// animation parameters, turned to face the current heading and then
// projected onto the screen with a slight top-down tilt. Working in 3D means
// every heading in between the four compass directions comes for free, limbs
// can bend at the knee and elbow, and parts can be depth-sorted so the far arm
// really does pass behind the body.
//
// World axes: x to the right of the screen, y up, z towards the camera (down
// the screen). Heading 0 faces the camera.

// Rows per metre: how tall the figure stands on screen.
export const SCALE = 13;
// How far a step towards the camera moves a point down the screen, relative
// to a step upwards moving it up. Gives the scene its three-quarter view.
export const TILT = 0.35;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Pitch: tips +y towards +z (a forward lean).
export function rotX(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

// Roll: tips +y towards -x.
export function rotZ(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

// Yaw: turns +z towards +x.
export function rotY(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

// Direction of a limb that hangs straight down, swung forward by `pitch`
// and out to the side by `roll`.
export function limb(pitch, roll = 0) {
  const cp = Math.cos(pitch);
  return [Math.sin(roll) * cp, -Math.cos(roll) * cp, Math.sin(pitch)];
}

// Screen position (row units, relative to the feet) and depth of a world point.
export function project(p) {
  return [p[0] * SCALE, (-p[1] + p[2] * TILT) * SCALE, p[2]];
}

import { SWORD_SIDE } from './combat.js';

const THIGH = 0.45;
const SHIN = 0.44;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Two-bone reach: where the elbow goes for the hand to land on `target`,
// bending towards `pole`. Returns [elbow, wrist].
function reach(shoulder, target, upper, fore, pole) {
  const d = sub(target, shoulder);
  const dist = Math.min(Math.hypot(d[0], d[1], d[2]), upper + fore - 1e-4);
  const dir = norm(d);
  const along = (upper * upper + dist * dist - fore * fore) / (2 * dist);
  const up = Math.sqrt(Math.max(0, upper * upper - along * along));
  const bend = norm(sub(pole, mul(dir, dot(pole, dir))));
  const elbow = add(shoulder, add(mul(dir, along), mul(bend, up)));
  return [elbow, add(shoulder, mul(dir, dist))];
}

// A triangle wave with softened corners: the thigh angle over the walk
// cycle, in -1..1, in step with sin().
const SOFT = 0.96;
const SWEEP = (a) => Math.asin(SOFT * Math.sin(a)) / Math.asin(SOFT);

// How far the body travels over one full walk cycle (two steps), in metres,
// for a given amount of running. A planted foot sweeps back through the
// whole stride angle, so this is what keeps the feet from sliding.
export function strideCycle(run) {
  const swing = 0.42 + 0.3 * run;
  return 1.25 * 4 * (THIGH + SHIN) * Math.sin(swing);
}

// Builds the posed skeleton. `st` holds:
//   heading  radians, 0 faces the camera
//   phase    walk cycle angle
//   walk     0..1, how much the figure is striding
//   run      0..1, how much of that stride is a run
//   time     seconds, drives breathing
export function buildRig(st) {
  const { heading, phase, walk, run, time } = st;
  // The sword's pose, when it is out, leans and turns the whole body.
  const cb = st.combat;
  const fight = cb ? cb.active : 0;
  const sp = cb?.pose;
  const crouchAll = (st.crouch ?? 0) + (sp ? sp.crouch * fight : 0);
  const lean = 0.06 * walk + 0.22 * run + (st.lean ?? 0) + crouchAll * 0.45 + (sp ? sp.lean * fight : 0) +
    (st.kneel ?? 0) * 0.18;
  // Shoulders counter-rotate against the hips as the legs swing.
  const twist = Math.sin(phase) * 0.14 * walk * (1 - fight * 0.6) + (sp ? SWORD_SIDE * sp.twist * fight : 0);
  const breath = Math.sin(time * 2.2) * 0.5 + 0.5;

  // Standing still the warrior plants their feet apart and shifts their
  // weight slowly from one to the other.
  const still = 1 - walk;
  const shift = Math.sin(time * 0.9) * 0.02 * still;
  const pelvis = [Math.sin(phase) * 0.015 * walk + shift, 1.0, 0];

  const legs = [];
  for (const s of [-1, 1]) {
    const lp = phase + (s > 0 ? 0 : Math.PI);
    // Crouching swings the thighs forward and folds the knees; planting the
    // feet below then lowers the hips by itself.
    const crouch = crouchAll;
    // Kneeling brings one foot forward and lowers the other knee to the
    // ground behind it.
    const kn = st.kneel ?? 0;
    // The thigh sweeps back at an even pace while the foot is planted, so
    // the foot keeps up with the ground instead of skating, and swings
    // forward again while it is lifted. cos(lp) > 0 is the swing.
    const swingT = Math.cos(lp);
    const thigh = SWEEP(lp) * (0.42 + 0.3 * run) * walk + crouch * 0.85 + kn * (s > 0 ? 1.45 : -0.05);
    // The knee folds through the swing and gives a little under the weight
    // mid-stance, but is straight as the foot lands and pushes off, so both
    // feet meet the ground level when the weight changes over.
    const knee = walk * ((0.55 + 0.6 * run) * Math.max(0, swingT) + (0.12 + 0.25 * run) * Math.max(0, -swingT)) +
      crouch * 1.6 + kn * (s > 0 ? 1.45 : 1.65);
    const shin = thigh - knee;
    const hip = add(pelvis, rotY([s * 0.1, -0.04, 0], -twist * 0.6));
    // Lean the legs out into a wide stance, and back under the weight.
    const roll = s * (0.02 + 0.07 * still) - shift * 1.5;
    const kneeP = add(hip, mul(limb(thigh, roll), THIGH));
    const ankle = add(kneeP, mul(limb(shin, roll), SHIN));
    const toe = add(ankle, mul(limb(Math.PI / 2 + Math.min(0, shin) * 0.8), 0.15));
    // Pick the swinging foot up clear of the ground so it never touches
    // down before its time.
    const clear = walk * (0.09 + 0.08 * run) * Math.sqrt(Math.max(0, swingT));
    ankle[1] += clear;
    toe[1] += clear;
    legs.push({ s, hip, knee: kneeP, ankle, toe });
  }

  // Plant the feet: raise or lower the hips so the lowest foot rests on the
  // ground. A stride with the legs apart then naturally dips the body and
  // passing through upright lifts it, which is the bob of a real walk.
  let lowest = Infinity;
  for (const l of legs) lowest = Math.min(lowest, l.ankle[1] - 0.065, l.toe[1] - 0.05, l.knee[1] - 0.07);
  const lift = -lowest + (st.air ?? 0);
  pelvis[1] += lift;
  for (const l of legs) {
    for (const k of ['hip', 'knee', 'ankle', 'toe']) l[k][1] += lift;
  }

  // Everything above the hips hangs off the torso frame.
  // Banking tilts everything above the hips into a turn.
  const bank = st.bank ?? 0;
  const torso = (p) => add(pelvis, rotY(rotZ(rotX(p, lean), bank), twist));
  const turn = (d) => rotY(rotZ(rotX(d, lean * 0.5), bank), twist);

  const arms = [];
  for (const s of [-1, 1]) {
    const lp = phase + (s > 0 ? 0 : Math.PI);
    // Each arm swings with the opposite leg.
    // `reach` raises both arms forward, e.g. to balance in the air.
    const swing = -Math.sin(lp) * (0.45 + 0.35 * run) * walk + (st.reach ?? 0);
    const elbow = 0.22 + 0.15 * walk + 1.1 * run + 0.3 * Math.max(0, swing);
    const shoulder = torso([s * 0.2, 0.46 + breath * 0.008, 0]);
    // Arms hang a little away from the armour, more so when at rest.
    const elbowP = add(shoulder, mul(turn(limb(swing, s * (0.16 + 0.06 * still))), UPPER_ARM));
    const wrist = add(elbowP, mul(turn(limb(swing + elbow, s * 0.08)), FOREARM));
    const hand = add(wrist, mul(turn(limb(swing + elbow, s * 0.05)), 0.06));
    arms.push({ s, shoulder, elbow: elbowP, wrist, hand });
  }

  // Kneeling, the forearm rests across the raised knee.
  const kn = st.kneel ?? 0;
  if (kn > 0.01) {
    const arm = arms.find((a) => a.s > 0);
    const knee = legs.find((l) => l.s > 0).knee;
    const [elbow, wrist] = reach(arm.shoulder, add(knee, [-0.04, 0.06, 0.1]), UPPER_ARM, FOREARM, [1, -0.3, -0.2]);
    arm.elbow = lerp3(arm.elbow, elbow, kn);
    arm.wrist = lerp3(arm.wrist, wrist, kn);
    arm.hand = lerp3(arm.hand, add(wrist, [-0.05, -0.02, 0.02]), kn);
  }

  // With the sword out the sword arm reaches for its pose, and the other
  // hand joins the grip when the move calls for two hands.
  let sword = null;
  if (cb && fight > 0.01) {
    const side = (p) => [p[0] * SWORD_SIDE, p[1], p[2]];
    const blade = norm(turn(side(sp.blade)));
    const grip = torso(side(sp.hand));
    const blend = (arm, target, pole, k) => {
      const [elbow, wrist] = reach(arm.shoulder, target, UPPER_ARM, FOREARM, pole);
      arm.elbow = lerp3(arm.elbow, elbow, k);
      arm.wrist = lerp3(arm.wrist, wrist, k);
      arm.hand = lerp3(arm.hand, add(wrist, mul(blade, 0.06)), k);
    };
    const main = arms.find((a) => a.s === SWORD_SIDE);
    const off = arms.find((a) => a.s !== SWORD_SIDE);
    blend(main, grip, [SWORD_SIDE, -0.6, -0.5], fight);
    if (sp.off > 0.01) blend(off, sub(grip, mul(blade, 0.13)), [-SWORD_SIDE, -0.6, -0.4], sp.off * fight);
    if (cb.inHand) {
      const hilt = add(main.wrist, mul(blade, 0.03));
      const guard = add(hilt, mul(blade, 0.08));
      // The crossguard lies square to the blade, as flat as it can.
      let bar = cross(blade, [0, 1, 0]);
      if (Math.hypot(...bar) < 0.2) bar = cross(blade, [0, 0, 1]);
      bar = mul(norm(bar), 0.12);
      sword = {
        pommel: sub(hilt, mul(blade, 0.2)),
        guard,
        tip: add(guard, mul(blade, 1.02)),
        barA: add(guard, bar),
        barB: sub(guard, bar),
      };
    }
  }

  const rig = {
    heading,
    pelvis,
    waist: torso([0, 0.08, 0]),
    chest: torso([0, 0.36 + breath * 0.01, 0]),
    neck: torso([0, 0.52, 0]),
    head: torso([0, 0.64, 0.01]),
    legs,
    arms,
    torso,
    sword,
    // How open the eyes are, 0..1.
    eyes: st.blink === undefined ? 1 : 1 - st.blink,
    // How far the knees reach ahead of and behind the hips, so cloth hanging
    // from the waist can be pushed out of their way.
    kneeFwd: Math.max(0, ...legs.map((l) => l.knee[2])),
    kneeBack: Math.max(0, ...legs.map((l) => -l.knee[2])),
    // Points on the head, which can turn and nod on its own.
    // The neck turns against the shoulders' swing, so the head stays
    // pointed where the warrior is going rather than wagging with each step.
    headAt: (p) => torso(add([0, 0.64, 0.01], rotY(rotX(p, (st.nod ?? 0) + kn * 0.3), (st.look ?? 0) - twist * 0.85))),
  };
  return toWorld(rig, heading);
}

// Turns every joint from the body's frame to face `heading`.
function toWorld(rig, heading) {
  const w = (p) => rotY(p, heading);
  const out = {
    heading,
    pelvis: w(rig.pelvis),
    waist: w(rig.waist),
    chest: w(rig.chest),
    neck: w(rig.neck),
    head: w(rig.head),
    legs: rig.legs.map((l) => ({ s: l.s, hip: w(l.hip), knee: w(l.knee), ankle: w(l.ankle), toe: w(l.toe) })),
    arms: rig.arms.map((a) => ({
      s: a.s, shoulder: w(a.shoulder), elbow: w(a.elbow), wrist: w(a.wrist), hand: w(a.hand),
    })),
    // Places a point given in the torso's own frame, or the head's.
    at: (p) => w(rig.torso(p)),
    headAt: (p) => w(rig.headAt(p)),
    eyes: rig.eyes,
    sword: rig.sword && Object.fromEntries(Object.entries(rig.sword).map(([k, v]) => [k, w(v)])),
    kneeFwd: rig.kneeFwd,
    kneeBack: rig.kneeBack,
    // How much of the body's width faces the camera (1 front or back, 0 side).
    facing: Math.abs(Math.cos(heading)),
  };
  return out;
}

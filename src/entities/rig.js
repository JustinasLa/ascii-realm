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
export const TILT = 0.5;

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
import { GAITS } from './mocap.js';

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

// Walking and running are played back from motion capture (see mocap.js):
// one recorded gait cycle of each, blended by how much the figure is
// running. The recordings move forward at a steady speed, so a planted
// foot slides back through them at exactly that speed and stays put on the
// ground; the player advances the cycle by distance actually covered (over
// the cycle's stride length), which keeps it that way at any speed.
//
// The cycles start at a left-heel strike and the right side is the left
// mirrored half a cycle later. The actor's left is the body's +x side.
const WALK = GAITS.walk;
const RUN = GAITS.run;
const SAMPLES = WALK.pelvis.length;

const smooth = (t) => t * t * (3 - 2 * t);
const frac = (x) => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;
const mirror = (p) => [-p[0], p[1], p[2]];

// A track sampled `u` of the way round its loop, linearly interpolated.
function sample(track, u) {
  const f = frac(u) * SAMPLES;
  const i = Math.floor(f);
  const t = f - i;
  const a = track[i];
  const b = track[(i + 1) % SAMPLES];
  return Array.isArray(a) ? a.map((v, k) => v + (b[k] - v) * t) : a + (b - a) * t;
}

// The same track from both recordings, blended by `run`.
function gaitTrack(name, u, run) {
  const w = sample(WALK[name], u);
  const r = sample(RUN[name], u);
  return Array.isArray(w) ? w.map((v, k) => v + (r[k] - v) * run) : w + (r - w) * run;
}

// A foot's track, `u` of the way through its own cycle. A walking foot is
// down for longer than a running one, so before blending, each recording is
// time-warped so its touchdown and lift-off fall where the blended gait's
// do; otherwise a half-walk, half-run would mix a planted foot with a lifted
// one.
function footTrack(name, u, run) {
  const beta = dutyFactor(run);
  const warp = (b) => (u < beta ? (u / beta) * b : b + ((u - beta) / (1 - beta)) * (1 - b));
  const w = sample(WALK[name], warp(WALK.beta));
  const r = sample(RUN[name], warp(RUN.beta));
  return w.map((v, k) => v + (r[k] - v) * run);
}

// How far the body travels over one full gait cycle (two steps), in metres.
export function strideCycle(run) {
  return mix(WALK.stride, RUN.stride, run);
}

// The fraction of the cycle each foot spends on the ground.
const dutyFactor = (run) => mix(WALK.beta, RUN.beta, run);

// Where in the cycle a walk phase is (0 at a left-heel strike), and how far
// a given foot is through its own cycle (0 as it touches down).
const cycleAt = (phase) => frac((phase - Math.PI / 2) / (Math.PI * 2));
const footU = (phase, s) => frac(cycleAt(phase) - (s > 0 ? 0 : 0.5));

// The left foot's footprint in the body frame, `u` of the way through its
// cycle: where the ankle came down, sliding back as the body passes.
function printAt(u, run) {
  const a = footTrack('ankle', 0, run);
  return [a[0], a[2] - strideCycle(run) * u];
}

// Where each foot is in its cycle for a given walk phase: how far through
// (`u`, 0 at touchdown), whether it is on the ground, and where its
// footprint would be in the body's frame if nothing pinned it.
export function gaitPlan(phase, run) {
  const beta = dutyFactor(run);
  return [-1, 1].map((s) => {
    const u = footU(phase, s);
    const p = printAt(Math.min(u, beta), run);
    return { s, u, grounded: u < beta, print: [s > 0 ? p[0] : -p[0], p[1]] };
  });
}

// The torso's lean, roll and twist at this point in the cycle.
function gaitTorso(phase, run) {
  const u = cycleAt(phase);
  return { lean: gaitTrack('lean', u, run), bank: gaitTrack('bank', u, run), twist: gaitTrack('twist', u, run) };
}

// The arm's upper and lower bone directions, in the torso's frame.
function gaitArm(phase, run, s) {
  const u = frac(cycleAt(phase) - (s > 0 ? 0 : 0.5));
  const upper = gaitTrack('upper', u, run);
  const fore = gaitTrack('fore', u, run);
  return s > 0 ? [upper, fore] : [mirror(upper), mirror(fore)];
}

// Legs (and hips) for walking and running from the recordings. Knees are
// solved to join each recorded hip to its recorded ankle, so the legs keep
// the game's proportions. `st.locks` may pin a foot where it really is in
// the world, as [x, z] in the body frame: `print` for a planted foot,
// `lift` for where a lifted one left the ground. The recorded foot is
// shifted to match, the shift easing away through the swing.
//
// Returns the pelvis and legs in the body's frame, and how many feet are on
// the ground.
function mocapLegs(st, phase, run, crouch) {
  const beta = dutyFactor(run);
  const cyc = cycleAt(phase);
  const down = [0, -crouch * 0.35 + (st.air ?? 0), 0];
  const hipL = add(gaitTrack('hip', cyc, run), down);
  const hipR = add(mirror(gaitTrack('hip', frac(cyc - 0.5), run)), down);
  const pelvis = add(lerp3(hipL, hipR, 0.5), [0, 0.04, 0]);

  let grounded = 0;
  const legs = [-1, 1].map((s, j) => {
    const u = footU(phase, s);
    const side = (p) => (s > 0 ? p : mirror(p));
    let ankle = side(footTrack('ankle', u, run));
    let toe = side(footTrack('toe', u, run));
    ankle[1] += st.air ?? 0;
    toe[1] += st.air ?? 0;

    const lock = st.locks?.[j];
    const planted = u < beta;
    const p = printAt(Math.min(u, beta), run);
    const ownPrint = [s > 0 ? p[0] : -p[0], p[1]];
    let shift = [0, 0];
    if (planted && lock?.print) {
      shift = [lock.print[0] - ownPrint[0], lock.print[1] - ownPrint[1]];
    } else if (!planted && lock?.lift) {
      const fade = 1 - smooth((u - beta) / (1 - beta));
      shift = [(lock.lift[0] - ownPrint[0]) * fade, (lock.lift[1] - ownPrint[1]) * fade];
    }
    ankle = add(ankle, [shift[0], 0, shift[1]]);
    toe = add(toe, [shift[0], 0, shift[1]]);

    const hip = s > 0 ? hipL : hipR;
    const [knee, reached] = reach(hip, ankle, THIGH, SHIN, [s * 0.12, 0.05, 1]);
    const foot = sub(toe, ankle);
    let contact = null;
    if (planted) {
      grounded++;
      contact = [ownPrint[0] + shift[0], 0, ownPrint[1] + shift[1]];
    }
    return { s, hip, knee, ankle: reached, toe: add(reached, foot), contact };
  });
  return { pelvis, legs, grounded };
}

// Builds the posed skeleton. `st` holds:
//   heading  radians, 0 faces the camera
//   phase    walk cycle angle
//   walk     0..1, how much the figure is striding
//   run      0..1, how much of that stride is a run
//   time     seconds, drives breathing
export function buildRig(st) {
  const { phase, walk, run, time } = st;
  // A spinning slash turns the whole body round on top of the heading.
  const heading = st.heading + (st.combat?.spin ?? 0);
  // The sword's pose, when it is out, leans and turns the whole body.
  const cb = st.combat;
  const fight = cb ? cb.active : 0;
  const sp = cb?.pose;
  // Stooping to pick something up, only while standing still and free.
  const pickup = !st.moving && !(st.air > 0) && !(st.windUp >= 0) && !cb?.busy
    ? Math.max(0, Math.min(1, st.pickupPose ?? 0)) : 0;
  const kneel = (st.kneel ?? 0) * (1 - pickup);
  const crouchAll = (st.crouch ?? 0) + (sp ? sp.crouch * fight : 0) + pickup * 0.6;
  // Striding, the torso's lean, roll and counter-twist come from the
  // recordings.
  const g = walk > 0.001 ? gaitTorso(phase, run) : { lean: 0, bank: 0, twist: 0 };
  const lean = g.lean * walk + (st.lean ?? 0) + crouchAll * 0.45 +
    (sp ? sp.lean * fight : 0) + kneel * 0.18;
  const twist = g.twist * walk * (1 - fight * 0.6) + (sp ? SWORD_SIDE * sp.twist * fight : 0);
  const breath = Math.sin(time * 2.2) * 0.5 + 0.5;

  // Standing still the warrior plants their feet apart and shifts their
  // weight slowly from one to the other.
  const still = 1 - walk;
  const shift = Math.sin(time * 0.9) * 0.02 * still;
  const pelvis = [shift, 1.0, 0];

  const legs = [];
  for (const s of [-1, 1]) {
    const lp = phase + (s > 0 ? 0 : Math.PI);
    // Crouching swings the thighs forward and folds the knees; planting the
    // feet below then lowers the hips by itself.
    const crouch = crouchAll;
    // Kneeling brings one foot forward and lowers the other knee to the
    // ground behind it.
    const kn = kneel;
    // The thigh sweeps back at an even pace while the foot is planted, so
    // the foot keeps up with the ground instead of skating, and swings
    // forward again while it is lifted. cos(lp) > 0 is the swing.
    const swingT = Math.cos(lp);
    // Sprinting drives the knee up high on the way through.
    const drive = run * walk * 0.3 * Math.max(0, swingT);
    // Skidding to a halt, one foot is thrust out ahead and the other leg
    // folds beneath.
    const br = st.brace ?? 0;
    // The knee is never locked straight. While the foot is planted it gives
    // under the weight, most at mid-stance, and the thigh tips forward to
    // match so the foot stays put while the knee bends over it.
    const stance = walk * (0.25 + 0.35 * run) * Math.max(0, -swingT) ** 1.5;
    // It starts to fold before the back foot even leaves the ground, peaks
    // early in the swing (heel kicked up behind when running) and opens out
    // again to reach for the next step, landing only slightly bent.
    const fold = walk * (0.8 + 1.0 * run) * Math.max(0, Math.cos(lp + 0.1)) ** 1.2;
    const ease = walk * (0.16 + 0.14 * run);
    const thigh = SWEEP(lp) * (0.42 + 0.36 * run) * walk + drive + stance * 0.5 + crouch * 0.85 +
      kn * (s > 0 ? 1.45 : -0.05) + br * (s > 0 ? 0.75 : -0.15);
    const knee = ease + stance + fold + crouch * 1.6 + kn * (s > 0 ? 1.45 : 1.65) + br * (s > 0 ? 0.15 : 1.0);
    const shin = thigh - knee;
    // The hip on the swinging side drops a little, as it does in a real
    // stride.
    const drop = 0.022 * walk * Math.max(0, swingT);
    const hip = add(pelvis, rotY([s * 0.09, -0.04 - drop, 0], -twist * 0.6));
    // Lean the legs out into a wide stance, and back under the weight.
    const roll = s * (0.02 + 0.07 * still) - shift * 1.5;
    const kneeP = add(hip, mul(limb(thigh, roll), THIGH));
    const ankle = add(kneeP, mul(limb(shin, roll), SHIN));
    // The foot rolls onto its toes as it pushes off and hangs toe-down
    // through the swing, then flattens to land.
    const point = walk * (0.35 + 0.25 * run) * Math.max(0, Math.cos(lp + 0.6));
    const toe = add(ankle, mul(limb(Math.PI / 2 + Math.min(0, shin) * 0.8 - point), 0.15));
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
  // A sprint is a run of bounds: between footfalls both feet leave the
  // ground for a moment.
  const flight = run * walk * 0.07 * Math.max(0, -Math.cos(2 * phase));
  // The player smooths the bob with a spring (see Player.update), which
  // softens the corners where the weight changes from foot to foot. The
  // body may lag above the planted foot, but never sinks below it.
  const gait = -lowest + flight;
  const lift = Math.max(-lowest, st.bob ?? gait) + (st.air ?? 0);
  pelvis[1] += lift;
  for (const l of legs) {
    for (const k of ['hip', 'knee', 'ankle', 'toe']) l[k][1] += lift;
  }

  // While striding, the legs are placed by their footprints instead, blended
  // in as the warrior gets going so starting and stopping stay smooth.
  // `grounded` counts the feet on the ground, and each leg's `contact` is
  // its footprint, which stays put on the ground for as long as it is down.
  let grounded = 2;
  if (walk > 0.001) {
    const p = mocapLegs(st, phase, run, crouchAll);
    for (let i = 0; i < 3; i++) pelvis[i] += (p.pelvis[i] - pelvis[i]) * walk;
    legs.forEach((l, j) => {
      for (const k of ['hip', 'knee', 'ankle', 'toe']) l[k] = lerp3(l[k], p.legs[j][k], walk);
      l.contact = p.legs[j].contact;
    });
    grounded = p.grounded;
  }

  // Everything above the hips hangs off the torso frame. Banking tilts it
  // into a turn, on top of the stride's own roll.
  const bank = (st.bank ?? 0) + g.bank * walk;
  const torso = (p) => add(pelvis, rotY(rotZ(rotX(p, lean), bank), twist));
  const turn = (d) => rotY(rotZ(rotX(d, lean * 0.5), bank), twist);

  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = torso([s * 0.175, 0.46 + breath * 0.008, 0]);
    // At rest the arms hang a little away from the body, elbows soft.
    let upper = limb(0, s * (0.16 + 0.06 * still));
    let fore = limb(0.18, s * 0.08);
    // Striding, they swing as recorded.
    if (walk > 0.001) {
      const [u, f] = gaitArm(phase, run, s);
      upper = norm(lerp3(upper, u, walk));
      fore = norm(lerp3(fore, f, walk));
    }
    // `reach` raises both arms forward, e.g. to balance in the air.
    const r = st.reach ?? 0;
    upper = rotX(upper, -r);
    fore = rotX(fore, -r);
    const elbowP = add(shoulder, mul(turn(upper), UPPER_ARM));
    const wrist = add(elbowP, mul(turn(fore), FOREARM));
    const hand = add(wrist, mul(turn(fore), 0.06));
    arms.push({ s, shoulder, elbow: elbowP, wrist, hand });
  }

  // Kneeling, the forearm rests across the raised knee.
  const kn = kneel;
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
      bar = mul(norm(bar), 0.08);
      sword = {
        // A charged blade glows, ready to be unleashed.
        glow: cb.charged,
        pommel: sub(hilt, mul(blade, 0.1)),
        guard,
        tip: add(guard, mul(blade, 0.72)),
        barA: add(guard, bar),
        barB: sub(guard, bar),
      };
    }
  }

  // Keep the free hand raised and clear of the body while carrying a flame.
  if (st.torch) {
    const arm = arms.find(a => a.s !== SWORD_SIDE);
    const target = torso([arm.s * 0.38, 0.28, 0.25]);
    const [elbow, wrist] = reach(arm.shoulder, target, UPPER_ARM, FOREARM, [arm.s, -0.5, -0.3]);
    arm.elbow = elbow;
    arm.wrist = wrist;
    arm.hand = add(wrist, [0, 0.02, 0]);
  }

  // The free hand leaves its guard to gather from the ground. Doing this
  // after posing the sword keeps the blade attached to its own hand.
  if (pickup > 0) {
    const arm = arms.find((a) => a.s !== SWORD_SIDE);
    const target = [arm.s * 0.18, 0.13, 0.38];
    const [elbow, wrist] = reach(arm.shoulder, target, UPPER_ARM, FOREARM, [arm.s, -0.3, -0.2]);
    arm.elbow = lerp3(arm.elbow, elbow, pickup);
    arm.wrist = lerp3(arm.wrist, wrist, pickup);
    arm.hand = lerp3(arm.hand, add(wrist, [0, -0.04, 0.02]), pickup);
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
    grounded,
    // How high the legs alone would hold the body this frame, before the
    // player's spring smooths it.
    gait,
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
    legs: rig.legs.map((l) => ({
      s: l.s, hip: w(l.hip), knee: w(l.knee), ankle: w(l.ankle), toe: w(l.toe), contact: l.contact && w(l.contact),
    })),
    grounded: rig.grounded,
    arms: rig.arms.map((a) => ({
      s: a.s, shoulder: w(a.shoulder), elbow: w(a.elbow), wrist: w(a.wrist), hand: w(a.hand),
    })),
    // Places a point given in the torso's own frame, or the head's.
    at: (p) => w(rig.torso(p)),
    headAt: (p) => w(rig.headAt(p)),
    eyes: rig.eyes,
    sword: rig.sword &&
      Object.fromEntries(Object.entries(rig.sword).map(([k, v]) => [k, Array.isArray(v) ? w(v) : v])),
    gait: rig.gait,
    kneeFwd: rig.kneeFwd,
    kneeBack: rig.kneeBack,
    // How much of the body's width faces the camera (1 front or back, 0 side).
    facing: Math.abs(Math.cos(heading)),
  };
  return out;
}

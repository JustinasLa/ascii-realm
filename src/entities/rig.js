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
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Pitch: tips +y towards +z (a forward lean).
export function rotX(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
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

const THIGH = 0.45;
const SHIN = 0.44;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;

// Builds the posed skeleton. `st` holds:
//   heading  radians, 0 faces the camera
//   phase    walk cycle angle
//   walk     0..1, how much the figure is striding
//   run      0..1, how much of that stride is a run
//   time     seconds, drives breathing
export function buildRig(st) {
  const { heading, phase, walk, run, time } = st;
  const lean = 0.06 * walk + 0.22 * run;
  // Shoulders counter-rotate against the hips as the legs swing.
  const twist = Math.sin(phase) * 0.14 * walk;
  const breath = Math.sin(time * 2.2) * 0.5 + 0.5;

  const pelvis = [Math.sin(phase) * 0.015 * walk, 1.0, 0];

  const legs = [];
  for (const s of [-1, 1]) {
    const lp = phase + (s > 0 ? 0 : Math.PI);
    const thigh = Math.sin(lp) * (0.42 + 0.3 * run) * walk;
    // The knee folds while the leg swings forward and straightens to land.
    const knee = walk * (0.12 + 0.25 * run + (0.55 + 0.6 * run) * Math.max(0, Math.cos(lp)));
    const shin = thigh - knee;
    const hip = add(pelvis, rotY([s * 0.1, -0.04, 0], -twist * 0.6));
    const kneeP = add(hip, mul(limb(thigh, s * 0.02), THIGH));
    const ankle = add(kneeP, mul(limb(shin, s * 0.02), SHIN));
    const toe = add(ankle, mul(limb(Math.PI / 2 + Math.min(0, shin) * 0.8), 0.15));
    legs.push({ s, hip, knee: kneeP, ankle, toe });
  }

  // Everything above the hips hangs off the torso frame.
  const torso = (p) => add(pelvis, rotY(rotX(p, lean), twist));
  const turn = (d) => rotY(rotX(d, lean * 0.5), twist);

  const arms = [];
  for (const s of [-1, 1]) {
    const lp = phase + (s > 0 ? 0 : Math.PI);
    // Each arm swings with the opposite leg.
    const swing = -Math.sin(lp) * (0.45 + 0.35 * run) * walk;
    const elbow = 0.22 + 0.15 * walk + 1.1 * run + 0.3 * Math.max(0, swing);
    const shoulder = torso([s * 0.2, 0.46 + breath * 0.008, 0]);
    const elbowP = add(shoulder, mul(turn(limb(swing, s * 0.16)), UPPER_ARM));
    const wrist = add(elbowP, mul(turn(limb(swing + elbow, s * 0.08)), FOREARM));
    const hand = add(wrist, mul(turn(limb(swing + elbow, s * 0.05)), 0.06));
    arms.push({ s, shoulder, elbow: elbowP, wrist, hand });
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
    // Points on the head, which can turn and nod on its own.
    headAt: (p) => torso(add([0, 0.64, 0.01], rotY(rotX(p, st.nod ?? 0), st.look ?? 0))),
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
    // How much of the body's width faces the camera (1 front or back, 0 side).
    facing: Math.abs(Math.cos(heading)),
  };
  return out;
}

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
import { getWeapon } from './weapons.js';

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
  const length = Math.hypot(...d);
  const dist = Math.max(Math.abs(upper - fore) + 1e-4, Math.min(length, upper + fore - 1e-4));
  const dir = length > 1e-6 ? mul(d, 1 / length) : [0, -1, 0];
  const along = (upper * upper + dist * dist - fore * fore) / (2 * dist);
  const up = Math.sqrt(Math.max(0, upper * upper - along * along));
  let bend = sub(pole, mul(dir, dot(pole, dir)));
  if (Math.hypot(...bend) < 1e-6) bend = cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1]);
  bend = norm(bend);
  const elbow = add(shoulder, add(mul(dir, along), mul(bend, up)));
  return [elbow, add(shoulder, mul(dir, dist))];
}

// Every weapon's sprite uses this frame: x across the blade, y along it,
// and z through its thickness. Keeping the axes in 3D makes broad axe heads,
// shields and curved bows turn with the figure instead of becoming billboards.
function weaponFrame(definition, grip, direction, forward, carried = false, acrossHint = null) {
  const blade = Math.hypot(...direction) > 1e-6 ? norm(direction) : [0, 1, 0];
  // Back-mounted gear lies flat on the torso; a drawn bow bends towards
  // the archer so its string and arrow share the forward shooting plane.
  const hint = acrossHint ?? (definition.type === 'bow' ? forward : null);
  let across = hint ? sub(hint, mul(blade, dot(hint, blade))) : cross(blade, [0, 1, 0]);
  if (Math.hypot(...across) < 0.2) across = cross(blade, forward);
  if (Math.hypot(...across) < 1e-6) across = cross(blade, [1, 0, 0]);
  across = norm(across);
  const normal = norm(cross(across, blade));
  const geometry = definition.rig ?? {};
  const guard = add(grip, mul(blade, geometry.gripOffset ?? 0.08));
  const halfBar = geometry.guardWidth ?? 0.12;
  return {
    definition,
    kind: definition.type ?? definition.id,
    spriteParts: definition.spriteParts,
    placement: definition.sheath?.mount ?? 'back',
    carried,
    grip,
    pommel: sub(grip, mul(blade, geometry.gripLength ?? 0.2)),
    guard,
    tip: add(guard, mul(blade, definition.reach ?? 1.02)),
    barA: add(guard, mul(across, halfBar)),
    barB: sub(guard, mul(across, halfBar)),
    blade,
    across,
    side: across,
    normal,
    width: halfBar,
  };
}

// Positions within a weapon's sprite frame, also used by the bow's nocked
// arrow and the shield carried by the opposite arm.
const weaponAt = (frame, p) => add(frame.guard,
  add(mul(frame.across, p[0]), add(mul(frame.blade, p[1]), mul(frame.normal, p[2]))));

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
  const { phase, walk, run, time } = st;
  const heading = st.heading + (st.combatSpin ?? 0);
  // A weapon's pose, when it is out, leans and turns the whole body.
  const cb = st.combat;
  const equipped = cb?.weapon ?? st.weapon;
  const definition = typeof equipped === 'string' ? getWeapon(equipped) : equipped ?? getWeapon();
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
  // Walking, the weight rolls over onto whichever leg is planted.
  const sway = -Math.cos(phase) * 0.028 * walk * (1 - run * 0.6);
  const pelvis = [sway + shift, 1.0, 0];

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
    // The hip on the swinging side drops a little, as it does in a real
    // stride.
    const drop = 0.022 * walk * Math.max(0, swingT);
    const hip = add(pelvis, rotY([s * 0.1, -0.04 - drop, 0], -twist * 0.6));
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
  // The chest leans a touch the other way to the hip sway, to balance.
  const bank = (st.bank ?? 0) + sway * 1.2;
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

  const side = (p) => [p[0] * SWORD_SIDE, p[1], p[2]];
  const bodyDirection = (p) => norm(sub(torso(p), pelvis));
  const forward = bodyDirection([0, 0, 1]);
  const main = arms.find((a) => a.s === SWORD_SIDE);
  const off = arms.find((a) => a.s !== SWORD_SIDE);
  let weapon = null;
  const blend = (arm, target, pole, k, handDirection) => {
    const [elbow, wrist] = reach(arm.shoulder, target, UPPER_ARM, FOREARM, pole);
    arm.elbow = lerp3(arm.elbow, elbow, k);
    arm.wrist = lerp3(arm.wrist, wrist, k);
    arm.hand = lerp3(arm.hand, add(wrist, mul(handDirection, 0.06)), k);
  };

  // One-handed weapons leave the opposite arm free; long shafts and the
  // greatsword can bring it to a second grip. A bow uses that hand to draw
  // the string instead, and a shield keeps it clear of the sword grip.
  if (cb && sp && fight > 0.01) {
    const blade = norm(turn(side(sp.blade)));
    const grip = torso(side(sp.hand));
    blend(main, grip, [SWORD_SIDE, -0.6, -0.5], fight, blade);
    if (definition.hands === 2 && definition.type !== 'bow' && sp.off > 0.01) {
      const offGrip = definition.rig?.offGrip ?? 0.13;
      blend(off, sub(grip, mul(blade, offGrip)), [-SWORD_SIDE, -0.6, -0.4], sp.off * fight, blade);
    }
    if (cb.inHand) {
      weapon = weaponFrame(definition, add(main.wrist, mul(blade, 0.03)), blade, forward);
      if (definition.type === 'bow') {
        // The bow arm extends along the shot, while the drawing hand comes
        // back beside the cheek. Its elbow bends behind the shoulder rather
        // than reaching down across the chest as it would for a sword grip.
        const chord = definition.spriteParts.find((part) => part.material === 'string');
        const endpoints = chord ? [chord.a, chord.b].sort((a, b) => a[1] - b[1])
          : [[-0.21, -definition.reach * 0.92, 0], [-0.21, definition.reach, 0]];
        const stave = definition.spriteParts.filter((part) => part.material === 'wood');
        const charge = Math.max(0, Math.min(1, cb.bowDraw ?? cb.charge ?? 0));
        const cheek = torso([-SWORD_SIDE * 0.06, 0.55, -0.06]);
        const bodyUp = bodyDirection([0, 1, 0]);
        const mainBase = { ...main };
        const offBase = { ...off };
        const arrowLength = 0.78;
        const aimedDirection = (point, fallback) => {
          if (typeof st.bowAimDirection !== 'function') return fallback;
          // The player's solver uses physical world axes relative to the
          // feet, including jump height. Only yaw is undone on its answer;
          // torso twist must not steer an arrow away from the cursor.
          const direction = st.bowAimDirection(rotY(point, heading));
          if (!Array.isArray(direction) || direction.length !== 3 ||
            !direction.every(Number.isFinite) || Math.hypot(...direction) < 1e-6) return fallback;
          return norm(rotY(direction, -heading));
        };
        const aimBow = (aim) => {
          Object.assign(main, mainBase);
          Object.assign(off, offBase);
          let up = sub(bodyUp, mul(aim, dot(bodyUp, aim)));
          if (Math.hypot(...up) < 1e-4) up = sub(forward, mul(aim, dot(forward, aim)));
          if (Math.hypot(...up) < 1e-4) up = cross(aim, [1, 0, 0]);
          up = norm(up);

          // Intersect the aiming ray with the bow shoulder's reach sphere,
          // so the extended arm keeps both of its original bone lengths.
          const rayStart = sub(cheek, mul(up, 0.03));
          const offset = sub(rayStart, main.shoulder);
          const along = dot(offset, aim);
          const armReach = UPPER_ARM + FOREARM - 0.001;
          const span = Math.max(0.21, -along + Math.sqrt(Math.max(0,
            along * along + armReach * armReach - dot(offset, offset))));
          const target = add(rayStart, mul(aim, span));
          blend(main, target, bodyDirection([SWORD_SIDE, -0.35, -0.2]), fight, up);
          const bow = weaponFrame(definition, add(main.wrist, mul(up, 0.03)), up, aim);
          const restGap = Math.abs(endpoints[0][0]);
          const rest = sub(bow.grip, mul(aim, restGap));
          const nock = lerp3(rest, cheek, charge);
          blend(off, sub(nock, mul(aim, 0.06)), bodyDirection([-SWORD_SIDE * 0.5, 0, -1]), fight, aim);
          bow.upper = weaponAt(bow, endpoints[1]);
          bow.lower = weaponAt(bow, endpoints[0]);
          bow.upperMid = weaponAt(bow, stave.at(-1)?.a ?? [-0.06, definition.reach * 0.58, 0]);
          bow.lowerMid = weaponAt(bow, stave[0]?.b ?? [-0.06, -definition.reach * 0.52, 0]);
          bow.string = off.hand;
          bow.aim = aim;
          bow.draw = charge;
          bow.drawDistance = Math.hypot(...sub(bow.grip, bow.string));
          bow.arrow = { tail: bow.string, tip: add(bow.string, mul(aim, arrowLength)) };
          return bow;
        };

        // The launch point is the posed arrowhead. Recompute the direction
        // there until moving that point no longer changes the ballistic aim.
        // This also keeps the held arrow parallel to its released velocity.
        let aim = aimedDirection(weapon.grip, forward);
        let previousError = Infinity;
        let relaxation = 1;
        for (let i = 0; i < 64; i++) {
          weapon = aimBow(aim);
          const next = aimedDirection(weapon.arrow.tip, aim);
          const error = Math.hypot(...sub(next, aim));
          if (error < 1e-7) break;
          // Close ground targets can move from one side of the arrowhead
          // to the other after a full update. Damping that oscillation
          // converges to the same shot instead of alternating directions.
          if (relaxation === 1 && error >= previousError * 0.5) relaxation = 0.25;
          else if (relaxation < 1 && error >= previousError * 0.95) relaxation = Math.max(1 / 32, relaxation * 0.5);
          aim = norm(lerp3(aim, next, relaxation));
          previousError = error;
        }
        weapon = aimBow(aim);
      }
    }
  }

  // Sheath anchors follow the torso even while the hands are occupied.
  // Explicit points retain the greatsword's familiar diagonal scabbard;
  // every other weapon uses the same frame at its back, hip or quiver mount.
  const sheath = definition.sheath ?? { mount: 'back', hand: [0.17, 0.66, -0.16], blade: [-0.32, -0.95, -0.02] };
  const sheathGrip = torso(side(sheath.hand));
  const sheathDirection = sheath.guard && sheath.tip
    ? bodyDirection(side(sub(sheath.tip, sheath.guard)))
    : bodyDirection(side(sheath.blade));
  const sheathedWeapon = weaponFrame(definition, sheathGrip, sheathDirection, forward, !cb?.inHand, bodyDirection([1, 0, 0]));
  sheathedWeapon.placement = sheath.mount;
  if (sheath.guard) sheathedWeapon.guard = torso(side(sheath.guard));
  if (sheath.tip) sheathedWeapon.tip = torso(side(sheath.tip));
  else sheathedWeapon.tip = add(sheathedWeapon.guard, mul(sheathedWeapon.blade, definition.reach));
  if (sheath.pommel) sheathedWeapon.pommel = torso(side(sheath.pommel));
  sheathedWeapon.barA = add(sheathedWeapon.guard, mul(sheathedWeapon.across, sheathedWeapon.width));
  sheathedWeapon.barB = sub(sheathedWeapon.guard, mul(sheathedWeapon.across, sheathedWeapon.width));

  let shield = null;
  if (definition.type === 'sword-shield') {
    const block = Math.max(cb?.blocking ? 1 : 0, Math.max(0, Math.min(1, sp?.shield ?? 0)));
    if (fight > 0.01) {
      const target = torso([-SWORD_SIDE * (0.24 - block * 0.08), 0.12 + block * 0.24, 0.14 + block * 0.28]);
      blend(off, target, [-SWORD_SIDE, -0.4, -0.2], fight, forward);
    }
    const up = bodyDirection([0, 1, 0]);
    const across = bodyDirection([1, 0, 0]);
    const center = add(off.wrist, mul(forward, 0.08));
    const topHeight = 0.19;
    const bottomHeight = 0.29;
    const halfWidth = 0.19;
    shield = {
      definition,
      spriteParts: definition.shieldParts,
      center,
      guard: center,
      top: add(center, mul(up, topHeight)),
      bottom: sub(center, mul(up, bottomHeight)),
      left: sub(center, mul(across, halfWidth)),
      right: add(center, mul(across, halfWidth)),
      boss: add(center, mul(forward, 0.025)),
      up,
      blade: up,
      across,
      side: across,
      normal: forward,
      raised: block,
      blocking: !!cb?.blocking,
      parrying: !!cb?.parrying,
    };
  }

  let quiver = null;
  if (definition.type === 'bow' || definition.quiver) {
    const data = definition.quiver ?? {};
    const mount = data.mount ?? [0.23, 0.44, -0.18];
    const length = data.length ?? 0.55;
    const count = data.arrowCount ?? 3;
    const top = torso(mount);
    const bottom = torso(add(mount, [0, -length, -0.025]));
    const arrows = [];
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) * 0.5) * 0.045;
      const tip = torso(add(mount, [spread * 0.2, -length + 0.05, -0.02]));
      const tail = torso(add(mount, [spread, 0.18 + (i % 2) * 0.035, -0.01]));
      arrows.push({ tip, tail });
    }
    quiver = {
      top, bottom, arrows, radius: data.radius ?? 0.075,
      side: bodyDirection([1, 0, 0]), normal: forward,
    };
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
    weapon,
    sheathedWeapon,
    shield,
    quiver,
    // Blade endpoints remain available under the original name for trails.
    sword: weapon,
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
  const equipment = (frame, keys) => {
    if (!frame) return null;
    const out = { ...frame };
    for (const key of keys) if (frame[key]) out[key] = w(frame[key]);
    if (frame.arrow) out.arrow = { tip: w(frame.arrow.tip), tail: w(frame.arrow.tail) };
    return out;
  };
  const weaponKeys = ['grip', 'pommel', 'guard', 'tip', 'barA', 'barB', 'blade', 'across', 'side', 'normal',
    'upper', 'lower', 'upperMid', 'lowerMid', 'string', 'aim'];
  const weapon = equipment(rig.weapon, weaponKeys);
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
    weapon,
    sword: weapon,
    sheathedWeapon: equipment(rig.sheathedWeapon, weaponKeys),
    shield: equipment(rig.shield, ['center', 'guard', 'top', 'bottom', 'left', 'right', 'boss', 'up', 'blade', 'across', 'side', 'normal']),
    quiver: rig.quiver && {
      ...rig.quiver,
      top: w(rig.quiver.top),
      bottom: w(rig.quiver.bottom),
      side: w(rig.quiver.side),
      normal: w(rig.quiver.normal),
      arrows: rig.quiver.arrows.map((arrow) => ({ tip: w(arrow.tip), tail: w(arrow.tail) })),
    },
    kneeFwd: rig.kneeFwd,
    kneeBack: rig.kneeBack,
    // How much of the body's width faces the camera (1 front or back, 0 side).
    facing: Math.abs(Math.cos(heading)),
  };
  return out;
}

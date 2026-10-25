// The sword: drawing it from the hip, holding a guard, the swings and
// sheathing it again. The first strike draws the sword; it is put away after
// SHEATHE_AFTER seconds of calm while standing. This only decides where the
// sword hand and blade should be; the rig bends the arms to match (see rig.js).
//
// Which swing comes out depends on what the warrior is doing:
//   standing or walking  a combo: forehand, then a backhand or a rising
//                        uppercut, then an overhead chop into the ground;
//   sprinting            a lunging thrust that carries them forward;
//   in the air           a plunge, blade down, that slams in on landing;
//   holding the button   a charge, then a full spinning slash on release.
//
// Poses are given in the torso's frame (metres from the hips, y up, z
// forward) with x pointing out to the sword side, so the same numbers work
// whichever hand holds the sword.

// The sword hand is the one on the body's -x side, under the hilt.
export const SWORD_SIDE = -1;

// hand: where the sword hand grips. blade: which way the blade points.
// twist: turns the chest towards the sword side. lean, crouch: as in the rig.
// off: how firmly the other hand joins the grip, 0..1.
const KEYS = {
  rest: { hand: [0.26, 0.05, 0.05], blade: [0.1, -0.4, 0.9] },
  // Drawing: a cross draw from the scabbard on the off-hand hip, then the
  // blade swept clear in front of the body.
  hilt: { hand: [-0.13, 0.06, 0.16], blade: [-0.25, -0.75, -0.6], twist: -0.35, crouch: 0.08 },
  free: { hand: [0.3, 0.42, 0.34], blade: [0.55, 0.65, 0.5], twist: 0.25 },
  guard: { hand: [0.12, 0.24, 0.3], blade: [-0.55, 0.5, 0.67], twist: 0.3, crouch: 0.14, off: 1 },
  carry: { hand: [0.27, 0.12, 0.1], blade: [0.15, -0.35, 0.92] },
  // Sprinting with the sword out: held low, the blade streaming behind.
  sprint: { hand: [0.3, 0.12, -0.12], blade: [0.3, -0.2, -0.93] },
  // Forehand: from high on the sword side, sweeping across the body.
  a0: { hand: [0.44, 0.62, -0.04], blade: [0.6, 0.45, -0.66], twist: 0.55, crouch: 0.1 },
  a1: { hand: [0.16, 0.45, 0.5], blade: [0.15, 0.08, 1], twist: 0, lean: 0.1, crouch: 0.15 },
  a2: { hand: [-0.28, 0.32, 0.32], blade: [-0.88, -0.08, 0.45], twist: -0.5, lean: 0.15, crouch: 0.2 },
  // Backhand: straight back the other way.
  b1: { hand: [0.06, 0.42, 0.52], blade: [-0.05, 0.12, 1], twist: 0, lean: 0.1, crouch: 0.15 },
  b2: { hand: [0.46, 0.44, 0.14], blade: [0.92, 0.1, 0.3], twist: 0.5, lean: 0.1, crouch: 0.2 },
  // Uppercut: from low on the far side, rising high on the sword side.
  d0: { hand: [-0.18, 0.08, 0.3], blade: [-0.6, -0.55, 0.58], twist: -0.45, crouch: 0.4, off: 0.6 },
  d1: { hand: [0.08, 0.4, 0.48], blade: [0.05, 0.6, 0.8], twist: 0, crouch: 0.15, off: 0.6 },
  d2: { hand: [0.32, 0.85, 0.2], blade: [0.45, 0.85, -0.25], twist: 0.4, lean: -0.15, off: 0.4 },
  // Overhead: both hands, up behind the head and down into the ground.
  c0: { hand: [0.1, 0.96, -0.02], blade: [0, 0.3, -0.95], twist: 0.1, lean: -0.12, off: 1 },
  c1: { hand: [0.08, 0.74, 0.4], blade: [0, 0.75, 0.62], lean: 0.1, off: 1 },
  c2: { hand: [0.05, 0.22, 0.52], blade: [0, -0.6, 0.8], lean: 0.38, crouch: 0.5, off: 1 },
  // Thrust: drawn back at the hip, then driven straight out ahead.
  t0: { hand: [0.3, 0.32, -0.18], blade: [0.05, 0.08, 1], twist: 0.6, crouch: 0.25, off: 0.5 },
  t1: { hand: [0.04, 0.42, 0.66], blade: [-0.04, 0.04, 1], twist: -0.2, lean: 0.4, crouch: 0.35, off: 0.3 },
  // Plunge: raised overhead in both hands, then driven point-down.
  p0: { hand: [0.05, 0.92, 0.1], blade: [0, 1, 0.1], lean: -0.15, off: 1 },
  p1: { hand: [0.03, 0.34, 0.3], blade: [0, -1, 0.12], lean: 0.25, crouch: 0.3, off: 1 },
  // Charging a spin: wound right back, blade low behind on the sword side.
  charge: { hand: [0.36, 0.2, -0.26], blade: [0.62, -0.25, -0.74], twist: 0.75, crouch: 0.35, off: 0.5 },
  // Spinning: held straight out to the side while the body turns.
  spin: { hand: [0.42, 0.42, 0.22], blade: [0.97, 0.02, 0.22], twist: 0.2, crouch: 0.25 },
};

// Each step eases towards a key over its duration. `rate` is how hard the
// pose chases the key (per second); `trail` marks the cutting part of a
// swing; `grab`/`release` move the sword between back and hand; `impact`
// fires a slam as the blade lands; `lunge` throws the warrior forward;
// `untilLanded` holds the step for as long as the warrior is in the air;
// `spin` turns the whole body that many times round over the step.
const MOVES = {
  draw: [
    { key: 'hilt', time: 0.14, rate: 30 },
    { key: 'free', time: 0.12, rate: 26, grab: true },
    { key: 'guard', time: 0.14, rate: 20 },
  ],
  sheathe: [
    { key: 'free', time: 0.16, rate: 22 },
    { key: 'hilt', time: 0.16, rate: 26 },
    { key: 'rest', time: 0.2, rate: 14, release: true },
  ],
  a: [
    { key: 'a0', time: 0.11, rate: 34 },
    { key: 'a1', time: 0.05, rate: 60, trail: true },
    { key: 'a2', time: 0.08, rate: 50, trail: true },
    { key: 'a2', time: 0.24, rate: 20, combo: true },
  ],
  b: [
    { key: 'b1', time: 0.06, rate: 55, trail: true },
    { key: 'b2', time: 0.08, rate: 50, trail: true },
    { key: 'b2', time: 0.24, rate: 20, combo: true },
  ],
  d: [
    { key: 'd0', time: 0.1, rate: 36 },
    { key: 'd1', time: 0.05, rate: 60, trail: true },
    { key: 'd2', time: 0.08, rate: 50, trail: true },
    { key: 'd2', time: 0.24, rate: 18, combo: true },
  ],
  c: [
    { key: 'c0', time: 0.18, rate: 28 },
    { key: 'c1', time: 0.06, rate: 55, trail: true },
    { key: 'c2', time: 0.07, rate: 60, trail: true, impact: 1 },
    { key: 'c2', time: 0.34, rate: 14 },
  ],
  thrust: [
    { key: 't0', time: 0.08, rate: 40 },
    { key: 't1', time: 0.1, rate: 60, trail: true, lunge: 6 },
    { key: 't1', time: 0.26, rate: 16 },
  ],
  plunge: [
    { key: 'p0', time: 0.1, rate: 40 },
    { key: 'p1', time: 0.06, rate: 50, trail: true, untilLanded: true },
    { key: 'p1', time: 0.04, rate: 40, impact: 1.3 },
    { key: 'p1', time: 0.3, rate: 14 },
  ],
  spin: [
    { key: 'spin', time: 0.05, rate: 50 },
    { key: 'spin', time: 0.36, rate: 40, trail: true, spin: 1 },
    { key: 'guard', time: 0.22, rate: 14 },
  ],
};
// After the forehand comes either the backhand or the uppercut, at random,
// then always the overhead chop.
const NEXT = { a: () => (Math.random() < 0.5 ? 'b' : 'd'), b: () => 'c', d: () => 'c', c: () => 'a' };
const SWINGS = 'abcd';

// Seconds the sword stays out after the last swing before it is put away.
export const SHEATHE_AFTER = 5;
// Seconds the button must be held to charge a spin.
const CHARGE_TIME = 0.5;

export class Combat {
  constructor() {
    this.inHand = false;
    this.move = null;
    this.step = 0;
    this.t = 0;
    this.queued = null;
    this.lastSwing = '';
    this.calm = 0;
    this.trailing = false;
    this.swingEmitted = false;
    // Seconds spent winding up a spin, and the extra turn of the body while
    // it spins, in radians.
    this.charge = 0;
    this.spin = 0;
    // The pose actually shown, chasing the current key.
    this.pose = { hand: [...KEYS.rest.hand], blade: [...KEYS.rest.blade], twist: 0, lean: 0, crouch: 0, off: 0 };
    // How much the arms follow the sword rather than swinging freely.
    this.active = 0;
    this.events = [];
  }

  get busy() {
    return this.move !== null;
  }

  get charged() {
    return this.charge >= CHARGE_TIME;
  }

  // How far through the swing under way the blade is: winding up, cutting
  // or recovering, with how far through that part (0..1), and whether the
  // swing winds up at all. Animations follow this so the cut they show
  // lands when the blade really strikes. Null outside a swing.
  get swingStage() {
    const steps = MOVES[this.move];
    const first = steps?.findIndex((s) => s.trail) ?? -1;
    if (first < 0) return null;
    const last = steps.findLastIndex((s) => s.trail);
    const span = (from, to) => steps.slice(from, to).reduce((sum, s) => sum + s.time, 0);
    const part = this.step < first ? 'wind' : this.step <= last ? 'cut' : 'recover';
    const [from, to] = { wind: [0, first], cut: [first, last + 1], recover: [last + 1, steps.length] }[part];
    const u = Math.min(1, (span(from, this.step) + this.t) / (span(from, to) || 1));
    return { part, u, windUp: first > 0 };
  }

  // Swing (drawing the sword first if needed), or queue the next swing of
  // the combo if one is already under way. `ctx` says whether the warrior
  // is sprinting or in the air, which picks a different attack.
  // Whether a press now would start or queue an attack, so stamina is only
  // spent on presses that do something.
  get canAcceptAttack() {
    if (!this.move) return true;
    if (this.queued) return false;
    return SWINGS.includes(this.move) || this.move === 'draw';
  }

  attack(ctx = {}) {
    if (!this.canAcceptAttack) return false;
    if (!this.move) {
      if (ctx.air) {
        // No time to draw properly mid-air: the sword is simply in hand.
        if (!this.inHand) this.events.push({ type: 'draw' });
        this.inHand = true;
        this.start('plunge');
      } else if (!this.inHand) {
        this.start('draw');
        this.queued = ctx.running ? 'thrust' : 'a';
      } else if (ctx.running) {
        this.start('thrust');
      } else {
        this.start(this.calm < 0.6 && this.lastSwing ? NEXT[this.lastSwing]() : 'a');
      }
      return true;
    }
    if (SWINGS.includes(this.move)) this.queued = NEXT[this.move]();
    else if (this.move === 'draw') this.queued ??= ctx.running ? 'thrust' : 'a';
    return true;
  }

  // Taking the weapon away also cancels any accepted follow-up, charge or
  // impact still to come.
  cancel() {
    this.move = null;
    this.step = 0;
    this.t = 0;
    this.queued = null;
    this.lastSwing = '';
    this.calm = 0;
    this.charge = 0;
    this.spin = 0;
    this.trailing = false;
    this.inHand = false;
    this.active = 0;
    this.events.length = 0;
  }

  toggle() {
    if (this.move) return;
    this.start(this.inHand ? 'sheathe' : 'draw');
  }

  start(move) {
    this.move = move;
    this.step = 0;
    this.t = 0;
    this.charge = 0;
    this.swingEmitted = false;
    if (SWINGS.includes(move)) this.lastSwing = move;
    this.enterStep();
  }

  // A cutting motion sounds once when its first cutting step begins,
  // even if a long frame immediately completes that step.
  enterStep() {
    const s = MOVES[this.move]?.[this.step];
    if (!s?.trail || this.swingEmitted) return;
    this.swingEmitted = true;
    this.events.push({ type: 'swing', speed: Math.max(0.2, Math.min(2, s.rate / 50)), move: this.move });
  }

  // ctx: moving, running, air (the warrior's state) and held (whether the
  // attack button is still down).
  update(dt, ctx = {}) {
    this.trailing = false;
    let used = dt;
    let target;
    let rate = 12;
    if (this.move) {
      const steps = MOVES[this.move];
      const s = steps[this.step];
      this.enterStep();
      target = KEYS[s.key];
      rate = s.rate;
      this.trailing = !!s.trail;
      // A queued swing cuts the recovery of the last one short.
      if (s.combo && this.queued) {
        used = 0;
        this.t = s.time;
      } else if (!(s.untilLanded && ctx.air)) {
        used = Math.min(dt, s.time - this.t);
        this.t += used;
      }
      if (s.spin) this.spin = Math.min(1, this.t / s.time) * Math.PI * 2 * s.spin;
      if (this.t >= s.time) {
        if (s.grab && !this.inHand) {
          this.inHand = true;
          this.events.push({ type: 'draw' });
        }
        if (s.release && this.inHand) {
          this.inHand = false;
          this.events.push({ type: 'sheathe' });
        }
        if (s.impact) this.events.push({ type: 'slam', strength: s.impact });
        if (s.lunge) this.events.push({ type: 'lunge', speed: s.lunge });
        if (s.spin) {
          this.spin = 0;
          this.events.push({ type: 'whirl' });
        }
        this.t = 0;
        this.step++;
        // Hold a finished swing only until the next one is asked for.
        const done = this.step >= steps.length;
        const cut = this.queued && (done || steps[this.step].combo);
        if (done || cut) {
          const next = this.queued;
          this.queued = null;
          this.move = null;
          if (next) this.start(next);
        } else this.enterStep();
      }
      this.calm = 0;
    } else if (this.inHand) {
      // Keeping the button held after a swing winds up a spin; letting go
      // once it is charged unleashes it.
      if (ctx.held && !ctx.air) {
        this.charge += dt;
        target = KEYS.charge;
        rate = 16;
        this.calm = 0;
      } else {
        if (!ctx.held && this.charged) {
          this.start('spin');
          return this.update(dt, ctx);
        }
        // A jump pauses a held charge; only releasing the button fires it.
        if (!ctx.held) this.charge = 0;
        target = ctx.running ? KEYS.sprint : ctx.moving ? KEYS.carry : KEYS.guard;
        this.calm = ctx.held ? 0 : this.calm + dt;
        if (this.calm > SHEATHE_AFTER && !ctx.moving) this.start('sheathe');
      }
    } else {
      target = KEYS.rest;
      this.calm += dt;
    }

    const k = 1 - Math.exp(-rate * used);
    const p = this.pose;
    for (let i = 0; i < 3; i++) {
      p.hand[i] += (target.hand[i] - p.hand[i]) * k;
      p.blade[i] += (target.blade[i] - p.blade[i]) * k;
    }
    const len = Math.hypot(...p.blade) || 1;
    for (let i = 0; i < 3; i++) p.blade[i] /= len;
    p.twist += ((target.twist ?? 0) - p.twist) * k;
    p.lean += ((target.lean ?? 0) - p.lean) * k;
    p.crouch += ((target.crouch ?? 0) - p.crouch) * k;
    p.off += ((target.off ?? 0) - p.off) * k;

    const want = this.inHand || this.move ? 1 : 0;
    this.active += (want - this.active) * (1 - Math.exp(-14 * used));

    // Ease each pose only for its share of the frame, then carry the rest
    // into the next step, queued swing or idle time. Airborne plunge holds
    // consume the frame without advancing their timer.
    if (used < dt) this.update(dt - used, ctx);
  }
}

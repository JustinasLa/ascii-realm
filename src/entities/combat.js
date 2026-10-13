// The greatsword: drawing it from the back, holding a guard, a three-hit
// combo and sheathing it again. This only decides where the sword hand and
// blade should be; the rig bends the arms to match (see rig.js).
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
  hilt: { hand: [0.17, 0.66, -0.16], blade: [-0.32, -0.95, -0.02], twist: 0.2 },
  free: { hand: [0.36, 0.86, 0.12], blade: [0.3, 0.4, -0.86], twist: 0.1 },
  guard: { hand: [0.12, 0.24, 0.3], blade: [-0.55, 0.5, 0.67], twist: 0.3, crouch: 0.14, off: 1 },
  carry: { hand: [0.27, 0.12, 0.1], blade: [0.15, -0.35, 0.92] },
  // Forehand: from high on the sword side, sweeping across the body.
  a0: { hand: [0.44, 0.62, -0.04], blade: [0.6, 0.45, -0.66], twist: 0.55, crouch: 0.1 },
  a1: { hand: [0.16, 0.45, 0.5], blade: [0.15, 0.08, 1], twist: 0, lean: 0.1, crouch: 0.15 },
  a2: { hand: [-0.28, 0.32, 0.32], blade: [-0.88, -0.08, 0.45], twist: -0.5, lean: 0.15, crouch: 0.2 },
  // Backhand: straight back the other way.
  b1: { hand: [0.06, 0.42, 0.52], blade: [-0.05, 0.12, 1], twist: 0, lean: 0.1, crouch: 0.15 },
  b2: { hand: [0.46, 0.44, 0.14], blade: [0.92, 0.1, 0.3], twist: 0.5, lean: 0.1, crouch: 0.2 },
  // Overhead: both hands, up behind the head and down into the ground.
  c0: { hand: [0.1, 0.96, -0.02], blade: [0, 0.3, -0.95], twist: 0.1, lean: -0.12, off: 1 },
  c1: { hand: [0.08, 0.74, 0.4], blade: [0, 0.75, 0.62], lean: 0.1, off: 1 },
  c2: { hand: [0.05, 0.22, 0.52], blade: [0, -0.6, 0.8], lean: 0.38, crouch: 0.5, off: 1 },
};

// Each step eases towards a key over its duration. `rate` is how hard the
// pose chases the key (per second); `trail` marks the cutting part of a
// swing; `grab`/`release` move the sword between back and hand; `impact`
// fires an event as the blade lands.
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
  c: [
    { key: 'c0', time: 0.18, rate: 28 },
    { key: 'c1', time: 0.06, rate: 55, trail: true },
    { key: 'c2', time: 0.07, rate: 60, trail: true, impact: true },
    { key: 'c2', time: 0.34, rate: 14 },
  ],
};
const NEXT = { a: 'b', b: 'c', c: 'a' };

// Seconds the sword stays out after the last swing before it is put away.
const SHEATHE_AFTER = 5;

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
    this.struck = false;
    // The pose actually shown, chasing the current key.
    this.pose = { hand: [...KEYS.rest.hand], blade: [...KEYS.rest.blade], twist: 0, lean: 0, crouch: 0, off: 0 };
    // How much the arms follow the sword rather than swinging freely.
    this.active = 0;
    this.events = [];
  }

  get busy() {
    return this.move !== null;
  }

  // Swing (drawing the sword first if needed), or queue the next swing of
  // the combo if one is already under way.
  attack() {
    if (!this.move) {
      if (!this.inHand) {
        this.start('draw');
        this.queued = 'a';
      } else {
        this.start(this.calm < 0.6 && this.lastSwing ? NEXT[this.lastSwing] : 'a');
      }
      return;
    }
    if (MOVES[this.move] && 'abc'.includes(this.move)) this.queued = NEXT[this.move];
    else if (this.move === 'draw') this.queued = 'a';
  }

  toggle() {
    if (this.move) return;
    this.start(this.inHand ? 'sheathe' : 'draw');
  }

  start(move) {
    this.move = move;
    this.step = 0;
    this.t = 0;
    this.struck = false;
    if ('abc'.includes(move)) this.lastSwing = move;
  }

  update(dt, moving) {
    this.trailing = false;
    let target;
    let rate = 12;
    if (this.move) {
      const steps = MOVES[this.move];
      const s = steps[this.step];
      target = KEYS[s.key];
      rate = s.rate;
      this.trailing = !!s.trail;
      // The cutting phase can span several steps, but each swing hits once.
      if (s.trail && !this.struck) {
        this.events.push({ type: 'strike', swing: this.move });
        this.struck = true;
      }
      this.t += dt;
      // A queued swing cuts the recovery of the last one short.
      if (s.combo && this.queued) this.t = s.time;
      if (this.t >= s.time) {
        if (s.grab) this.inHand = true;
        if (s.release) this.inHand = false;
        if (s.impact) this.events.push({ type: 'slam' });
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
        }
      }
      this.calm = 0;
    } else if (this.inHand) {
      target = moving ? KEYS.carry : KEYS.guard;
      this.calm += dt;
      if (this.calm > SHEATHE_AFTER && !moving) this.start('sheathe');
    } else {
      target = KEYS.rest;
      this.calm += dt;
    }

    const k = 1 - Math.exp(-rate * dt);
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
    this.active += (want - this.active) * (1 - Math.exp(-14 * dt));
  }
}

import { isBow, isThrown } from './loadout.js';

// Presses of a throwing weapon shorter than this jab instead of throwing.
export const TAP = 0.22;
// Seconds to draw a bow fully; looser draws fly shorter and slower.
export const FULL_DRAW = 0.7;
// A bow released sooner than this has not been drawn at all.
const MIN_DRAW = 0.18;

// Holding the attack button with a bow, spear or javelin: how long it has
// been held, whether the outlaw is taking aim, and what a release does.
export class Ranged {
  constructor() {
    this.held = 0;
    this.aiming = false;
  }

  // How far the bow is drawn, 0..1.
  get draw() {
    return Math.min(1, this.held / FULL_DRAW);
  }

  // `pressed` is whether the attack button is down this frame. Returns what
  // letting go just did: null, { action: 'jab' }, or a 'shoot'/'throw' with
  // how far it was drawn.
  update(dt, pressed, weapon) {
    if (!isBow(weapon) && !isThrown(weapon)) {
      this.reset();
      return null;
    }
    if (pressed) {
      this.held += Math.max(0, dt);
      this.aiming = isBow(weapon) || this.held >= TAP;
      return null;
    }
    const held = this.held;
    this.reset();
    if (held <= 0) return null;
    if (isThrown(weapon)) return held < TAP ? { action: 'jab' } : { action: 'throw', draw: Math.min(1, held / FULL_DRAW) };
    return held < MIN_DRAW ? null : { action: 'shoot', draw: Math.min(1, held / FULL_DRAW) };
  }

  reset() {
    this.held = 0;
    this.aiming = false;
  }
}

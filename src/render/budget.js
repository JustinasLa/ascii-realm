import { gridSize } from '../core/layout.js';
import { ASPECT } from '../world/world.js';

// CSS cell size and backing pixels are independent budgets. A DPR-3 phone
// should not shade nine physical pixels per CSS pixel for tiny ASCII glyphs.
// The requested cell size is the player's zoom and is kept as asked; only a
// hard ceiling on the cell count enlarges cells, on unusually large screens.
// `pixelScale` lets the frame budget trade backing resolution for speed.
export const CELL_CEILING = { mobile: 40_000, desktop: 2_500_000 };

// `cellLimit` replaces the device's ceiling, for the phone pacing below.
export function renderSize(width, height, dpr, requestedCell, mobile, pixelScale = 1, cellLimit) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const pixels = (mobile ? 1_200_000 : 2_500_000) * pixelScale;
  const ratio = Math.min(dpr || 1, mobile ? 1.5 : 2, Math.sqrt(pixels / (width * height)));
  const limit = cellLimit ?? (mobile ? CELL_CEILING.mobile : CELL_CEILING.desktop);
  let cell = Math.max(requestedCell, Math.sqrt(width * height / (ASPECT * limit)));
  // Include the scrolling border in the CPU budget, including very wide views.
  const cells = () => { const { cols, rows } = gridSize(width, height, cell); return cols * rows; };
  while (cells() > limit) cell *= 1.01;
  // Never drop below the renderer's smallest legible glyph (2x3 device
  // pixels), which it would otherwise meet by enlarging cells, undoing zoom.
  const legible = Math.min(dpr || 1, Math.max(ratio, 2 / (cell * ASPECT), 3 / cell));
  return { dpr: legible, cell };
}

// Under sustained load on the graphics card the backing resolution drops,
// never the zoom; it climbs back once frames keep pace again. Only a frame
// that arrives late although its own work was quick is waiting on the GPU:
// slow work on the CPU (many cells when zoomed out) is not helped by fewer
// pixels, and dropping them for it only blurs every character. Each change
// redraws every character at a new size, so changes are rare. "Late" is
// measured against the frame cap's own period, so a phone held at an even
// 30 frames a second is not mistaken for one waiting on its GPU. A stall
// (a resume, a long pause in the browser) says nothing about either.
export class FrameQuality {
  constructor() {
    this.maximum = 1;
    this.minimum = 0.3;
    this.scale = this.maximum;
    // How much of the recent time the GPU held frames back, 0..1.
    this.average = 0;
    this.slow = 0;
    this.fast = 0;
  }

  sample(workMs, dt, periodMs = 1000 / 60) {
    const interval = dt * 1000;
    if (interval > STALL_MS) return false;
    const gpuBound = interval > periodMs * 1.44 && workMs < interval * 0.6;
    this.average += ((gpuBound ? 1 : 0) - this.average) * (1 - Math.exp(-dt * 2));
    this.slow = this.average > 0.7 ? this.slow + dt : Math.max(0, this.slow - dt * 2);
    this.fast = this.average < 0.1 ? this.fast + dt : 0;
    const before = this.scale;
    if (this.slow > 2) {
      this.scale = Math.max(this.minimum, this.scale * 0.8);
      this.slow = 0;
    } else if (this.fast > 6 && this.scale < this.maximum) {
      this.scale = Math.min(this.maximum, this.scale * 1.25);
      this.fast = 0;
    }
    return this.scale !== before;
  }
}

// Frames further apart than this are a stall, not a measure of the load.
const STALL_MS = 250;

// Cap high-refresh phones at 60 renders/sec (or the phone pacing's steady
// 30) while preserving elapsed time. Deadlines retain their phase on
// 90/120/144Hz displays, rather than falling to a divisor of the display
// rate. Resume starts a fresh simulation step. The simulation step is
// clamped, so `rawMs` keeps the real time since the previous frame for
// everything that measures frames.
export class FrameClock {
  constructor(hz = 60) {
    this.setRate(hz);
    this.reset();
  }

  setRate(hz) {
    this.hz = hz;
    this.period = 1000 / hz;
    if (this.last != null) this.next = this.last + this.period;
  }

  reset() {
    this.next = null;
    this.last = null;
    this.rawMs = this.period;
  }

  step(now) {
    if (this.next !== null && now < this.next - 0.5) return null;
    this.rawMs = this.last === null ? this.period : Math.max(0, now - this.last);
    const dt = this.last === null ? 1 / this.hz : Math.min(this.rawMs / 1000, Math.max(0.05, 1.5 * this.period / 1000));
    this.last = now;
    this.next = this.next === null || now - this.next > this.period ? now + this.period : this.next + this.period;
    return dt;
  }
}

// Phones prefer an even 30 frames a second to a 60 that keeps missing: the
// pacing drops the cap to 30 when the frame's own work no longer fits in a
// 60th of a second, and returns once it fits with room to spare. A phone
// that cannot hold even 30 draws fewer, larger cells as a last resort; the
// zoom stays the player's and only the hard ceiling moves, as with large
// screens. One change at a time, each after a sustained spell, and none in
// the first seconds after loading, whose frames build the world.
//
// A graphics card that cannot keep pace even at the lowest backing
// resolution (`starved`) also gets the even 30: fewer frames queued behind
// it arrive more evenly. Its own time per frame cannot be measured under the
// cap, so that 30 holds until the page is reloaded.
export const PHONE_PACING = { fastHz: 60, steadyHz: 30, fitMs: 13, refitMs: 9, overMs: 30,
  downAfter: 2, upAfter: 8, cellsAfter: 6, reducedCells: 12_000, settleAfter: 3 };

export class FramePacer {
  constructor({ enabled = () => true, ...tuning } = {}) {
    Object.assign(this, PHONE_PACING, tuning);
    this.enabled = enabled;
    this.reset();
  }

  reset() {
    this.rate = this.fastHz;
    this.cellCeiling = CELL_CEILING.mobile;
    // Work per rendered frame, smoothed over about a second.
    this.work = null;
    // Seconds sampled since the reset, and whether 30 was chosen for the GPU.
    this.warm = 0;
    this.held = false;
    this.slow = 0;
    this.fast = 0;
    this.over = 0;
  }

  get reduced() { return this.cellCeiling < CELL_CEILING.mobile; }

  // Work is measured per rendered frame and does not depend on the cap, so
  // the thresholds compare like with like at either rate.
  sample(workMs, rawMs, starved = false) {
    const change = { rate: false, cells: false };
    if (!this.enabled() || !(rawMs > 0) || rawMs > STALL_MS) return change;
    const dt = rawMs / 1000;
    this.warm += dt;
    if (this.warm < this.settleAfter) return change;
    this.work = this.work === null ? workMs : this.work + (workMs - this.work) * (1 - Math.exp(-dt));
    if (this.rate === this.fastHz) {
      this.slow = this.work > this.fitMs || starved ? this.slow + dt : 0;
      if (this.slow >= this.downAfter) {
        this.held = this.work <= this.fitMs;
        this.rate = this.steadyHz;
        this.slow = this.fast = this.over = 0;
        change.rate = true;
      }
      return change;
    }
    this.fast = this.work < this.refitMs ? this.fast + dt : 0;
    this.over = this.work > this.overMs ? this.over + dt : 0;
    // Cells come back before the rate rises.
    if (this.fast >= this.upAfter && this.reduced) {
      this.fast = this.over = 0;
      this.cellCeiling = CELL_CEILING.mobile;
      change.cells = true;
    } else if (this.fast >= this.upAfter && !this.held) {
      this.fast = this.over = 0;
      this.rate = this.fastHz;
      change.rate = true;
    } else if (this.over >= this.cellsAfter && !this.reduced) {
      this.over = 0;
      this.cellCeiling = this.reducedCells;
      change.cells = true;
    }
    return change;
  }
}

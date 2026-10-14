import { ASPECT } from '../world/world.js';

// CSS cell size and backing pixels are independent budgets. A DPR-3 phone
// should not shade nine physical pixels per CSS pixel for tiny ASCII glyphs.
// The requested cell size is the player's zoom and is kept as asked; only a
// hard ceiling on the cell count enlarges cells, on unusually large screens.
// `pixelScale` lets the frame budget trade backing resolution for speed.
export const CELL_CEILING = { mobile: 40_000, desktop: 120_000 };

export function renderSize(width, height, dpr, requestedCell, mobile, pixelScale = 1) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const pixels = (mobile ? 1_200_000 : 2_500_000) * pixelScale;
  const ratio = Math.min(dpr || 1, mobile ? 1.5 : 2, Math.sqrt(pixels / (width * height)));
  const limit = mobile ? CELL_CEILING.mobile : CELL_CEILING.desktop;
  let cell = Math.max(requestedCell, Math.sqrt(width * height / (ASPECT * limit)));
  // Include the scrolling border in the CPU budget, including very wide views.
  while ((Math.ceil(width / (cell * ASPECT)) + 1) * (Math.ceil(height / cell) + 1) > limit) cell *= 1.01;
  // Never drop below the renderer's smallest legible glyph (2x3 device
  // pixels), which it would otherwise meet by enlarging cells, undoing zoom.
  const legible = Math.min(dpr || 1, Math.max(ratio, 2 / (cell * ASPECT), 3 / cell));
  return { dpr: legible, cell };
}

// Under sustained load the backing resolution drops, never the zoom; it
// climbs back slowly once frames are cheap again.
export class FrameQuality {
  constructor() {
    this.maximum = 1;
    this.minimum = 0.3;
    this.scale = this.maximum;
    this.average = 0;
    this.slow = 0;
    this.fast = 0;
  }

  sample(workMs, dt) {
    this.average += (workMs - this.average) * (1 - Math.exp(-dt * 3));
    this.slow = this.average > 12 ? this.slow + dt : Math.max(0, this.slow - dt * 2);
    this.fast = this.average < 6 ? this.fast + dt : 0;
    const before = this.scale;
    if (this.slow > 1.5) {
      this.scale = Math.max(this.minimum, this.scale * 0.8);
      this.slow = 0;
    } else if (this.fast > 8) {
      this.scale = Math.min(this.maximum, this.scale * 1.1);
      this.fast = 0;
    }
    return this.scale !== before;
  }
}

// Cap high-refresh phones at 60 renders/sec while preserving elapsed time.
// Deadlines retain their phase on 90/120/144Hz displays, rather than falling
// to a divisor of the display rate. Resume starts a fresh simulation step.
export class FrameClock {
  constructor() { this.reset(); }
  reset() { this.next = null; this.last = null; }
  step(now) {
    if (this.next !== null && now < this.next - 0.5) return null;
    const dt = this.last === null ? 1 / 60 : Math.max(0, Math.min((now - this.last) / 1000, 0.05));
    this.last = now;
    this.next = this.next === null || now - this.next > 1000 / 60 ? now + 1000 / 60 : this.next + 1000 / 60;
    return dt;
  }
}

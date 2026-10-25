import { gridSize } from '../core/layout.js';
import { ASPECT } from '../world/world.js';

// CSS cell size and backing pixels are independent budgets. A DPR-3 phone
// should not shade nine physical pixels per CSS pixel for tiny ASCII glyphs.
// The requested cell size is the player's zoom and is kept as asked; only a
// hard ceiling on the cell count enlarges cells, on unusually large screens.
// `pixelScale` lets the frame budget trade backing resolution for speed.
export const CELL_CEILING = { mobile: 40_000, desktop: 2_500_000 };

export function renderSize(width, height, dpr, requestedCell, mobile, pixelScale = 1) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const pixels = (mobile ? 1_200_000 : 2_500_000) * pixelScale;
  const ratio = Math.min(dpr || 1, mobile ? 1.5 : 2, Math.sqrt(pixels / (width * height)));
  const limit = mobile ? CELL_CEILING.mobile : CELL_CEILING.desktop;
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
// redraws every character at a new size, so changes are rare.
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

  sample(workMs, dt) {
    const interval = dt * 1000;
    const gpuBound = interval > 24 && workMs < interval * 0.6;
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

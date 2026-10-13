import { ASPECT } from '../world/world.js';

// CSS cell size and backing pixels are independent budgets. A DPR-3 phone
// should not shade nine physical pixels per CSS pixel for tiny ASCII glyphs.
export function renderSize(width, height, dpr, requestedCell, mobile, cellLimit) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const pixels = mobile ? 1_200_000 : 2_500_000;
  const ratio = Math.min(dpr || 1, mobile ? 1.5 : 2, Math.sqrt(pixels / (width * height)));
  const limit = cellLimit ?? (mobile ? 14_000 : 42_000);
  let cell = Math.max(requestedCell, Math.sqrt(width * height / (ASPECT * limit)));
  // Include the scrolling border in the CPU budget, including very wide views.
  while ((Math.ceil(width / (cell * ASPECT)) + 1) * (Math.ceil(height / cell) + 1) > limit) cell *= 1.01;
  return { dpr: ratio, cell };
}

export class FrameQuality {
  constructor(mobile) {
    this.maximum = mobile ? 14_000 : 42_000;
    this.minimum = mobile ? 3_500 : 8_000;
    this.limit = this.maximum;
    this.average = 0;
    this.slow = 0;
    this.fast = 0;
  }

  sample(workMs, dt) {
    this.average += (workMs - this.average) * (1 - Math.exp(-dt * 3));
    this.slow = this.average > 12 ? this.slow + dt : Math.max(0, this.slow - dt * 2);
    this.fast = this.average < 6 ? this.fast + dt : 0;
    const before = this.limit;
    if (this.slow > 1.5) {
      this.limit = Math.max(this.minimum, Math.floor(this.limit * 0.8));
      this.slow = 0;
    } else if (this.fast > 8) {
      this.limit = Math.min(this.maximum, Math.ceil(this.limit * 1.1));
      this.fast = 0;
    }
    return this.limit !== before;
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

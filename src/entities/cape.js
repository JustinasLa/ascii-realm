// The warrior's cape, simulated as a short chain of points (verlet
// integration with distance constraints) hanging from between the shoulders.
// Positions are in metres relative to the warrior's feet, in world axes (x
// right, y up, z towards the camera), so when the warrior moves the free
// points are left behind and the cape streams out.

const POINTS = 7;
const LENGTH = 1.12;
const SEG = LENGTH / (POINTS - 1);
const GRAVITY = 9.8;
const DRAG = 0.9;
const STEP = 1 / 120;

export class Cape {
  constructor() {
    this.pts = null;
    this.prev = null;
    this.acc = 0;
  }

  // Hangs the cape straight down behind the shoulders at rest.
  settle(anchor, back) {
    this.pts = [];
    for (let i = 0; i < POINTS; i++) {
      this.pts.push([anchor[0] + back[0] * 0.04 * i, anchor[1] - SEG * i, anchor[2] + back[1] * 0.04 * i]);
    }
    this.prev = this.pts.map((p) => p.slice());
  }

  // anchor: top of the cape. back: unit vector (x, z) out of the warrior's
  // back. moved: how far the warrior travelled this frame, in metres.
  // wind: a sideways push, in m/s^2.
  update(dt, anchor, back, moved, wind) {
    if (!this.pts) this.settle(anchor, back);
    const { pts, prev } = this;

    // The warrior moved; in their frame of reference the cloth moved back.
    for (let i = 1; i < POINTS; i++) {
      pts[i][0] -= moved[0];
      pts[i][2] -= moved[2];
      prev[i][0] -= moved[0];
      prev[i][2] -= moved[2];
    }

    // Fixed steps keep the cloth stable whatever the frame rate.
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(anchor, back, wind);
    }
  }

  step(anchor, back, wind) {
    const { pts, prev } = this;
    const dt2 = STEP * STEP;
    for (let i = 1; i < POINTS; i++) {
      const p = pts[i];
      const q = prev[i];
      // Lower points catch more wind.
      const gust = (i / POINTS) * dt2;
      const nx = p[0] + (p[0] - q[0]) * DRAG + wind[0] * gust;
      const ny = p[1] + (p[1] - q[1]) * DRAG - GRAVITY * dt2;
      const nz = p[2] + (p[2] - q[2]) * DRAG + wind[2] * gust;
      q[0] = p[0];
      q[1] = p[1];
      q[2] = p[2];
      p[0] = nx;
      p[1] = ny;
      p[2] = nz;
    }

    pts[0][0] = anchor[0];
    pts[0][1] = anchor[1];
    pts[0][2] = anchor[2];
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 1; i < POINTS; i++) {
        const a = pts[i - 1];
        const p = pts[i];
        // Keep each link its proper length, pulling from the top down.
        const dx = p[0] - a[0];
        const dy = p[1] - a[1];
        const dz = p[2] - a[2];
        const len = Math.hypot(dx, dy, dz) || 1e-6;
        const k = SEG / len;
        p[0] = a[0] + dx * k;
        p[1] = a[1] + dy * k;
        p[2] = a[2] + dz * k;

        // The cloth cannot pass through the warrior's back or the ground.
        const behind = (p[0] - anchor[0]) * back[0] + (p[2] - anchor[2]) * back[1];
        const min = 0.03 + 0.012 * i;
        if (behind < min) {
          p[0] += back[0] * (min - behind);
          p[2] += back[1] * (min - behind);
        }
        if (p[1] < 0.04) p[1] = 0.04;
      }
    }
  }
}

export const CAPE_POINTS = POINTS;

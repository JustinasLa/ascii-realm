import { SCALE, TILT } from '../entities/rig.js';

const COS = Math.sqrt(1 - TILT * TILT);

// The developer camera pitch, in degrees above the horizon (see
// docs/terrain.md): the usual angle, the range and the step of the keys.
export const PITCH = { base: 30, min: 25, max: 45, step: 5 };

// The camera at its usual pitch. Ground depth always stays SCALE·TILT rows a
// metre; the pitch only sets how far a metre of height rises (`rise` rows;
// `up` is the same as a fraction of SCALE, `scale` relative to the usual).
export const BASE_LOOK = Object.freeze({ deg: PITCH.base, sin: TILT, cos: COS, up: COS, rise: SCALE * COS,
  rowsPerUnit: SCALE, scale: 1 });

const LOOKS = new Map([[PITCH.base, BASE_LOOK]]);

// The camera at `deg` degrees, rounded and kept in range, the same object
// for the same pitch; anything that is not a number is the usual pitch,
// BASE_LOOK itself.
export function pitchLook(deg) {
  if (deg === null || deg === undefined || deg === '') return BASE_LOOK;
  const d = Math.round(Number(deg));
  if (!Number.isFinite(d)) return BASE_LOOK;
  const c = Math.min(PITCH.max, Math.max(PITCH.min, d));
  if (!LOOKS.has(c)) {
    const a = (c * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const up = (TILT * cos) / sin;
    LOOKS.set(c, Object.freeze({ deg: c, sin, cos, up, rise: SCALE * up, rowsPerUnit: (SCALE * TILT) / sin, scale: up / COS }));
  }
  return LOOKS.get(c);
}

export class Camera {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.quake = 0;
    this.time = 0;
    // How far below the screen centre the target sits, as a fraction of the
    // view height. Applied when the view is built, so a change shows at once.
    this.bias = 0;
    // How far right of the screen centre it sits, as a fraction of the width.
    this.biasX = 0;
    // The camera's pitch (see pitchLook).
    this.look = BASE_LOOK;
  }

  // Jolts the view, e.g. when a heavy blow lands; `amount` is in rows.
  shake(amount) {
    this.quake = Math.max(this.quake, amount);
  }

  // Eases toward the target; `stiffness` is roughly how many times per second
  // the remaining distance halves.
  follow(tx, ty, dt, stiffness = 6) {
    this.time += dt;
    this.quake *= Math.exp(-9 * dt);
    const k = 1 - Math.exp(-stiffness * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  // Works out which world cell lands in the top-left grid slot and how far
  // (in device px) the grid must be scrolled to place the camera target
  // exactly in the middle of the screen, or `bias` of the height below it
  // and `biasX` of the width right of it.
  view(renderer) {
    const halfW = renderer.canvas.width / renderer.cellW / 2;
    const halfH = renderer.canvas.height / renderer.cellH / 2;
    // A fast, decaying wobble while the view is shaken.
    const jx = (Math.sin(this.time * 71) * this.quake) / 0.6;
    const jy = Math.sin(this.time * 53 + 1) * this.quake;
    const left = this.x + jx - halfW * (1 + 2 * this.biasX);
    const top = this.y + jy - halfH * (1 + 2 * this.bias);
    const x0 = Math.floor(left);
    const y0 = Math.floor(top);
    return {
      x0,
      y0,
      offX: (left - x0) * renderer.cellW,
      offY: (top - y0) * renderer.cellH,
      cols: renderer.cols,
      rows: renderer.rows,
    };
  }

  // The world row at the middle of the screen, which `bias` moves above the
  // target.
  centreY(view) {
    return this.y - this.bias * view.rows;
  }
}

// The view shifted so whatever stands on ground lifted `rows` (see
// relief.js) is drawn that much higher; unlifted, the view itself.
export function liftView(view, rows) {
  return rows ? { ...view, y0: view.y0 + rows } : view;
}

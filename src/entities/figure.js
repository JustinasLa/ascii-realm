import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';

// The wanderer is not a hand-drawn sprite: it is a handful of simple shapes
// (capsules, ellipses, trapezoids) that are rasterised into character cells
// every frame. That way the walk cycle can be animated smoothly and the figure
// glides between cells instead of snapping.
//
// Shapes live in "row units": one unit is one cell tall, the feet are at the
// origin and up is negative y.

const RAMP = [...' .:-=+*#%@'].map(glyph);
const EDGE_TOP = glyph("'");
const EDGE_BOTTOM = glyph('.');
const EDGE_SIDE = glyph(':');

const COLORS = {
  cloak: [74, 86, 102],
  sleeve: [62, 72, 88],
  hood: [66, 78, 94],
  face: [128, 104, 88],
  pants: [58, 54, 56],
  boots: [44, 34, 30],
  belt: [104, 72, 44],
  pack: [116, 86, 56],
  hand: [150, 120, 100],
};

function capsule(ax, ay, bx, by, rad, color) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  return {
    color,
    y0: Math.min(ay, by) - rad,
    y1: Math.max(ay, by) + rad,
    test(x, y) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = x - (ax + dx * t);
      const py = y - (ay + dy * t);
      if (px * px + py * py > rad * rad) return NaN;
      return px / rad;
    },
  };
}

function ellipse(cx, cy, rx, ry, color) {
  return {
    color,
    y0: cy - ry,
    y1: cy + ry,
    test(x, y) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      return dx * dx + dy * dy <= 1 ? dx : NaN;
    },
  };
}

// Trapezoid between rows y0 (top) and y1 (bottom); the centre may drift so a
// cloak can lean into the walk.
function trapezoid(y0, y1, cx0, cx1, half0, half1, color) {
  return {
    color,
    y0,
    y1,
    test(x, y) {
      if (y < y0 || y > y1) return NaN;
      const t = (y - y0) / (y1 - y0);
      const cx = cx0 + (cx1 - cx0) * t;
      const half = half0 + (half1 - half0) * t;
      const nx = (x - cx) / half;
      return Math.abs(nx) <= 1 ? nx : NaN;
    },
  };
}

// Builds the list of shapes, back to front, for the current pose.
function pose({ facing, phase, amp, bob }) {
  const parts = [];
  const C = COLORS;
  const s = Math.sin(phase) * amp;
  const top = -bob;

  if (facing === 'down' || facing === 'up') {
    const liftL = Math.max(0, s) * 0.9;
    const liftR = Math.max(0, -s) * 0.9;
    for (const [side, lift] of [[-1, liftL], [1, liftR]]) {
      parts.push(capsule(side * 0.85, -4.6 + top, side * 0.9, -1.2 - lift, 0.62, C.pants));
      parts.push(capsule(side * 0.9, -1.1 - lift, side * 0.95, -0.45 - lift, 0.7, C.boots));
    }
    parts.push(trapezoid(-11 + top, -4.1 + top, 0, 0, 1.9, 2.7, C.cloak));
    parts.push(trapezoid(-7.3 + top, -6.7 + top, 0, 0, 2.35, 2.45, C.belt));
    if (facing === 'up') {
      parts.push(trapezoid(-10.4 + top, -7.4 + top, 0, 0, 1.45, 1.55, C.pack));
    }
    for (const side of [-1, 1]) {
      const swing = side * s * 0.7;
      parts.push(capsule(side * 2.15, -10.3 + top, side * 2.5, -6.8 + top + swing, 0.68, C.sleeve));
      parts.push(ellipse(side * 2.55, -6.3 + top + swing, 0.55, 0.55, C.hand));
    }
    parts.push(ellipse(0, -12.3 + top, 1.75, 1.95, C.hood));
    if (facing === 'down') parts.push(ellipse(0, -12.0 + top, 0.95, 1.1, C.face));
  } else {
    const dir = facing === 'right' ? 1 : -1;
    const stride = 1.5;
    const legs = [
      { foot: -s * stride, lift: Math.max(0, -Math.cos(phase)) * 0.6 * amp, shade: 0.75 },
      { foot: s * stride, lift: Math.max(0, Math.cos(phase)) * 0.6 * amp, shade: 1 },
    ];
    const tint = (c, k) => c.map((v) => v * k);

    // Far side first so the near leg and arm overlap it.
    const far = legs[0];
    parts.push(capsule(0, -4.6 + top, far.foot * dir, -1.2 - far.lift, 0.62, tint(C.pants, far.shade)));
    parts.push(capsule(far.foot * dir, -1.0 - far.lift, far.foot * dir + dir * 0.6, -0.45 - far.lift, 0.6,
      tint(C.boots, far.shade)));
    parts.push(capsule(0, -10.2 + top, s * 1.4 * dir, -6.8 + top, 0.6, tint(C.sleeve, 0.75)));

    const lean = dir * 0.3 * amp;
    parts.push(trapezoid(-10.2 + top, -7.2 + top, -dir * 1.9 + lean, -dir * 1.7 + lean, 0.75, 0.85, C.pack));
    parts.push(trapezoid(-11 + top, -4.1 + top, lean, -lean * 1.5, 1.35, 1.95, C.cloak));
    parts.push(trapezoid(-7.3 + top, -6.7 + top, lean * 0.4, lean * 0.4, 1.5, 1.6, C.belt));

    const near = legs[1];
    parts.push(capsule(0, -4.6 + top, near.foot * dir, -1.2 - near.lift, 0.62, C.pants));
    parts.push(capsule(near.foot * dir, -1.0 - near.lift, near.foot * dir + dir * 0.6, -0.45 - near.lift, 0.6,
      C.boots));
    parts.push(capsule(lean, -10.2 + top, -s * 1.4 * dir, -6.8 + top, 0.62, C.sleeve));
    parts.push(ellipse(-s * 1.45 * dir, -6.3 + top, 0.5, 0.5, C.hand));

    parts.push(ellipse(lean + dir * 0.1, -12.3 + top, 1.55, 1.95, C.hood));
    parts.push(ellipse(lean + dir * 0.95, -12.0 + top, 0.55, 1.0, C.face));
  }
  return parts;
}

const SUB_X = [0.25, 0.75];
const SUB_Y = [1 / 6, 3 / 6, 5 / 6];

// Darkens the ground in a soft ellipse under the feet.
export function drawShadow(r, view, x, y) {
  const { fg, bg, cols } = r;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  for (let cy = fy - 1; cy <= fy + 1; cy++) {
    const sy = cy - view.y0;
    if (sy < 0 || sy >= view.rows) continue;
    for (let cx = fx - 5; cx <= fx + 5; cx++) {
      const sx = cx - view.x0;
      if (sx < 0 || sx >= view.cols) continue;
      const dx = ((cx + 0.5 - x) * ASPECT) / 2.6;
      const dy = (cy + 0.5 - y) / 1.1;
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const k = 0.35 + 0.65 * d;
      const o = (sy * cols + sx) * 4;
      for (let c = 0; c < 3; c++) {
        fg[o + c] *= k;
        bg[o + c] *= k;
      }
    }
  }
}

// Rasterises the figure with its feet at world position (state.x, state.y).
export function drawFigure(r, view, state) {
  const parts = pose(state);
  const { fg, cols } = r;
  const fx = Math.floor(state.x);
  const fy = Math.floor(state.y);

  for (let cy = fy - 16; cy <= fy + 1; cy++) {
    const sy = cy - view.y0;
    if (sy < 0 || sy >= view.rows) continue;
    for (let cx = fx - 6; cx <= fx + 6; cx++) {
      const sx = cx - view.x0;
      if (sx < 0 || sx >= view.cols) continue;

      let hits = 0;
      let lum = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let my = 0;
      let mx = 0;
      for (const oy of SUB_Y) {
        for (const ox of SUB_X) {
          const px = (cx + ox - state.x) * ASPECT;
          const py = cy + oy - state.y;
          let nx = NaN;
          let part = null;
          for (let i = parts.length - 1; i >= 0; i--) {
            const v = parts[i].test(px, py);
            if (v === v) {
              nx = v;
              part = parts[i];
              break;
            }
          }
          if (!part) continue;

          // Moonlight from the upper left, plus a cool rim on the lit edge.
          const t = (py - part.y0) / (part.y1 - part.y0);
          let l = 0.78 - 0.32 * nx - 0.22 * t;
          if (nx < -0.72) l += 0.25;
          hits++;
          lum += l;
          cr += part.color[0] * l;
          cg += part.color[1] * l;
          cb += part.color[2] * l;
          mx += ox - 0.5;
          my += oy - 0.5;
        }
      }
      if (!hits) continue;

      const o = (sy * cols + sx) * 4;
      const k = 1.35 / hits;
      let g;
      if (hits <= 2) {
        // Mostly empty cell: a light glyph hugging the covered side.
        if (Math.abs(my) >= Math.abs(mx)) g = my < 0 ? EDGE_TOP : EDGE_BOTTOM;
        else g = EDGE_SIDE;
      } else {
        const b = Math.max(0, Math.min(0.999, (lum / hits - 0.25) / 0.85));
        g = RAMP[2 + Math.floor(b * 8)];
      }
      fg[o] = cr * k;
      fg[o + 1] = cg * k;
      fg[o + 2] = cb * k;
      fg[o + 3] = g;
    }
  }
}

import { hash2 } from '../core/rng.js';
import { FINE } from '../render/cells.js';
import { dg } from '../render/glyphs.js';
import { MOON, VIEW_C, VIEW_S } from './surface-light.js';
import { ASPECT } from './world.js';

// Pale caps: a small clump of one to three rounded mushrooms with pale,
// moon-shaded caps over teal undersides, for clustering around tree roots.
// They are shaped like a boulder (see props.js): a sampler with the bounds
// the boulder bakes need, so the same bakes draw them in small letters on
// a dark silhouette. They cast no light. The teal gills and stems keep a
// steady tone of their own (UNDERSIDE_K), so they read as faintly lit at
// night without lighting anything around them.

// The three silhouettes, in row units: cap half-width rx, cap height ch,
// stem height sh, stem half-width sw, and how far the stem may lean.
export const PALE_CAP_FORMS = Object.freeze({
  dome: Object.freeze({ weight: 0.4, rx: [3.0, 4.0], ch: [1.6, 2.1], sh: [1.2, 1.7], sw: [0.75, 0.95], lean: 0.04 }),
  bell: Object.freeze({ weight: 0.35, rx: [1.9, 2.5], ch: [2.2, 2.8], sh: [2.0, 2.7], sw: [0.55, 0.7], lean: 0.14 }),
  button: Object.freeze({ weight: 0.25, rx: [1.1, 1.5], ch: [1.1, 1.4], sh: [0.8, 1.1], sw: [0.45, 0.6], lean: 0.02 }),
});

// The teal underside's fixed brightness, in place of the moon's shading.
// Set it to null and the gills and stems shade like any other surface.
export const UNDERSIDE_K = 1.05;

const CAP_TONES = [[226, 222, 204], [214, 214, 200], [208, 220, 206]];
const UNDERSIDE = [80, 187, 155];
const UNDERSIDE_FOOT = [20, 68, 66];
const PEBBLE = [150, 162, 142];
const LITTER = [[64, 106, 78], [138, 98, 58]];
// The cap's dark backing, as a share of its colour: low, so the pale
// letters carry the form on a near-black silhouette.
const CAP_BACK = 0.14;
// The band of gills under the rim, seen from the camera's southern tilt; a
// small cap's band is narrower, so some of its stem still shows.
const GILL_BAND = 0.55;
const GILL_SHARE = 0.4;

const LIGHT = (() => {
  const n = Math.hypot(...MOON);
  return MOON.map((x) => x / n);
})();

// The same heavy terminal lettering as the meadow's glowcaps: a steady
// heavy to light ramp over the cap, upright strokes for the gills, and the
// glowcap's pedestal letters for the stem.
const letters = (s) => [...s].map((ch) => dg(`mushrooms.ascii.${ch.charCodeAt(0)}`));
const CAP_RAMP = ['Q@#B', '8&$N', 'O%0D', 'Sdbq', 'oec:'].map(letters);
const GILL_RAMP = letters('|{(}[]');
const STEM_RAMP = [letters('r*;j+,'), letters('w%Xb')];

const FORM_NAMES = Object.keys(PALE_CAP_FORMS);

// The main cap's form for a draw in [0, 1), by cumulative weight.
export function pickForm(r) {
  let sum = 0;
  for (const name of FORM_NAMES) {
    sum += PALE_CAP_FORMS[name].weight;
    if (r < sum) return name;
  }
  return FORM_NAMES[FORM_NAMES.length - 1];
}

function drawCap(rand, form) {
  const f = PALE_CAP_FORMS[form];
  const at = ([lo, hi]) => lo + rand() * (hi - lo);
  const rx = at(f.rx), ch = at(f.ch), sh = at(f.sh), sw = at(f.sw);
  const lean = (rand() - 0.5) * 2 * f.lean;
  const tilt = (rand() - 0.5) * 0.3;
  return { form, rx, ch, sh, sw, lean, tilt, ox: 0, oy: -0.5, front: false };
}

// The cap's half-width at height v (0 at the rim, 1 at the crown), as a
// share of rx, or 0 outside the cap.
function capWidth(form, v) {
  if (v > 1) return 0;
  if (form === 'dome') return v < 0 ? 0 : Math.sqrt(1 - v ** 1.6);
  if (form === 'bell') return v < 0 ? 0 : (1 - v ** 1.4) ** 0.6;
  return v < -0.25 ? 0 : Math.sqrt(1 - v * v);
}

const teal = (t) => UNDERSIDE_FOOT.map((f, i) => f + (UNDERSIDE[i] - f) * t);

// A clump of pale caps for a builder prop. Every random draw is made here,
// in a fixed order, before anything is sampled.
export function paleCaps(rand, seed) {
  const main = drawCap(rand, pickForm(rand()));
  const caps = [main];
  const count = rand() < 0.3 ? 0 : rand() < 0.6 ? 1 : 2;
  let firstSide = 0;
  for (let i = 0; i < count; i++) {
    const sat = drawCap(rand, rand() < 0.6 ? 'button' : 'bell');
    const factor = 0.45 + rand() * 0.25;
    sat.rx *= factor; sat.ch *= factor; sat.sh *= factor; sat.sw *= factor;
    // A satellite always stays smaller than the cap it grows beside.
    const fit = Math.min(1, 0.8 * (main.sh + main.ch) / (sat.sh + sat.ch), 0.85 * main.rx / sat.rx);
    sat.rx *= fit; sat.ch *= fit; sat.sh *= fit; sat.sw *= fit;
    let side = rand() < 0.5 ? -1 : 1;
    if (i === 1) side = -firstSide;
    firstSide = side;
    sat.ox = side * (main.rx * 0.75 + sat.rx * 0.6 + rand() * 0.8);
    // A front satellite stands half a row nearer and is drawn over the main
    // cap; nothing stands below the bake's bottom row.
    sat.front = rand() < 0.5;
    sat.oy = sat.front ? 0 : -0.5;
    caps.push(sat);
  }
  const tone = CAP_TONES[Math.floor(rand() * CAP_TONES.length)];
  for (const cap of caps) {
    cap.cx = cap.ox + cap.lean * (cap.sh + cap.ch * 0.5) + cap.tilt * cap.rx * 0.3;
    cap.reach = Math.max(Math.abs(cap.cx) + cap.rx, Math.abs(cap.ox) + Math.abs(cap.lean) * cap.sh + cap.sw * 1.25);
  }
  const order = [...caps.filter((c) => c.front), main, ...caps.filter((c) => c !== main && !c.front)];
  const b = Math.max(...caps.map((c) => c.reach));
  const normals = { on: false };
  const shaded = (u, v, px, py, s) => {
    if (!normals.on) return s;
    // The surface's normal, bumped a little per small cell, turned into the
    // world's frame (see surface-light.js), so torches rake across it.
    const fx = Math.floor(px * FINE / ASPECT), fy = Math.floor(py * FINE);
    const bx = u + (hash2(fx, fy, seed + 61) - 0.5) * 0.2;
    const by = v + (hash2(fy, fx, seed + 62) - 0.5) * 0.2;
    const bz = Math.sqrt(Math.max(0, 1 - u * u - v * v));
    const wy = VIEW_C * by + VIEW_S * bz;
    const wz = Math.max(0, VIEW_C * bz - VIEW_S * by);
    const k = Math.sqrt(bx * bx + wy * wy + wz * wz) || 1;
    s.nx = bx / k; s.ny = wy / k; s.nz = wz / k;
    return s;
  };
  const hit = (cap, px, py) => {
    const h = cap.oy - py;
    if (h < 0) return null;
    const { rx, ch, sh } = cap;
    const u = (px - cap.cx) / rx;
    const v = (h - sh) / ch;
    const hw = capWidth(cap.form, v);
    // A zero width is above or below the cap, not a line up its middle.
    if (hw > 0 && Math.abs(u) <= hw) {
      // The cap's normal on a sphere fitted to its outline, in the screen's
      // frame: x right, y down the screen, z toward the viewer.
      const a = u / hw;
      const ring = Math.sqrt(Math.max(0, 1 - v * v));
      const nx = a * ring, ny = -v, nz = Math.sqrt(Math.max(0, 1 - a * a)) * ring;
      const grain = (hash2(Math.floor(px * 2.2), Math.floor(py * 1.6), seed + 17) - 0.5) * 0.08;
      const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const l = Math.max(0, Math.min(1, (lit - 0.35) * 1.4 + 0.5 + grain));
      const level = Math.min(4, Math.floor((1 - l) * 5));
      const row = CAP_RAMP[level];
      const g = row[Math.floor(hash2(Math.floor(px * FINE / ASPECT), Math.floor(py * FINE), seed + 23) * row.length)];
      return shaded(nx, ny, px, py, { m: 'cap', l, c: tone, back: CAP_BACK, g });
    }
    if (h >= sh - Math.min(GILL_BAND, sh * GILL_SHARE) && h < sh) {
      if (Math.abs(u) > 0.92) return null;
      const g = GILL_RAMP[Math.floor(hash2(Math.floor(px * FINE / ASPECT), Math.floor(py * FINE), seed + 29) * GILL_RAMP.length)];
      return shaded(u, 0, px, py, { m: 'gill', l: 0.8, c: teal(0.9), k: UNDERSIDE_K, back: 0.4, g });
    }
    if (h >= sh) return null;
    const du = (px - (cap.ox + cap.lean * h)) / (cap.sw * (1 + 0.25 * (1 - h / sh)));
    if (Math.abs(du) > 1) return null;
    // Brightest just under the gills, darkening to the ground.
    const t = 0.35 + 0.65 * (h / sh);
    const ramp = STEM_RAMP[t > 0.65 ? 1 : 0];
    const g = ramp[Math.floor(hash2(Math.floor(px * FINE / ASPECT), Math.floor(py * FINE), seed + 31) * ramp.length)];
    return shaded(du, 0, px, py, { m: 'gill', l: t, c: teal(t), k: UNDERSIDE_K, back: 0.4 * t, g });
  };
  const sample = (px, py) => {
    if (py > 0) return null;
    for (const cap of order) {
      const s = hit(cap, px, py);
      if (s) return s;
    }
    return null;
  };
  // Moss, leaves and a pebble at the foot, as a clump of mushrooms has.
  const extras = [];
  const foot = Math.ceil(b / ASPECT);
  for (let i = 2 + Math.floor(rand() * 3); i > 0; i--) {
    const side = rand() < 0.5 ? -1 : 1;
    const dx = side * (Math.floor(foot * (0.6 + rand() * 0.4)) + 1);
    const dy = rand() < 0.6 ? 0 : 1;
    const name = rand() < 0.5 ? `moss.${Math.floor(rand() * 4)}` : rand() < 0.6 ? `leaflet.${Math.floor(rand() * 8)}`
      : `tuft.${Math.floor(rand() * 4)}`;
    extras.push({ dx, dy, g: dg(name), c: LITTER[rand() < 0.5 ? 0 : 1] });
  }
  const light = 0.6 + rand() * 0.3;
  extras.push({ dx: (rand() < 0.5 ? -1 : 1) * (foot + 1), dy: rand() < 0.5 ? 0 : 1,
    g: dg(`pebble.${Math.floor(rand() * 8)}`), c: PEBBLE.map((x) => x * light) });
  return { sample, normals, b, caps, w: Math.ceil((b + 0.6) / ASPECT) + 1,
    top: -Math.ceil(Math.max(...caps.map((c) => c.sh + c.ch - c.oy))) - 1,
    extras, shadow: { rx: b * 1.1, ry: 0.7, ox: b * 0.3 } };
}

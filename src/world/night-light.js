import { WEATHER_EFFECTS } from './weather.js';
import { canopyStamp, GAIN, hasStamp, LAYER_UNIT, stampStrength } from './canopy.js';
import { MAX_GRASS_HEIGHT, SIDE_PAD } from './grass.js';
import { WATER } from './world.js';

// How much of the night's light reaches the ground, cell by cell, this
// frame. Trees' crowns keep it off the ground under and around them (see
// canopy.js): each layer of leaves over a cell takes away a fixed share.
// The map is fixed to world cells, not the screen, so walking and zooming
// never move a shadow. The ground, the grass and flowers rooted in it and a
// rock's ground cells are all darkened by it, before any warm light (a
// torch, a fire, a spell) is added: leaves block the moon, not your torch.

// The share of a shadow that is the sky's own light, there under any
// cloud; the rest is the moon's and fades as clouds cover it.
export const SKY_SHARE = 0.5;
// A newly baked footprint fades in over this many frames (frames rather
// than time, so a frozen clock still settles).
export const FADE_FRAMES = 24;
// Footprints baked in one frame, and the work (cells times leaf masses)
// after which no more are started that frame, so walking into a wood or
// zooming out never stalls a frame; the rest wait and fade in once baked.
// Most crowns are over BAKE_WORK alone, so it is mostly one a frame.
export const MAX_BAKES_PER_FRAME = 3;
export const BAKE_WORK = 16000;
// The map's margin around the view: blades lean in from roots beside it,
// the grass's reflections read roots above it and blades rise from roots
// below it.
export const PAD_X = SIDE_PAD;
export const PAD_TOP = MAX_GRASS_HEIGHT + 2;
export const PAD_BOTTOM = MAX_GRASS_HEIGHT + 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How much of a shadow the weather leaves: cloud covers the moon, so only
// the sky's share stays, and lightning lights everything for its flash.
export function skyFactor(weather) {
  if (!weather) return 1;
  const profile = WEATHER_EFFECTS[weather.preset] ?? {};
  const intensity = weather.intensity ?? 0;
  const cloud = ((profile.shade ?? 0) + 0.5 * (profile.haze ?? 0)) * intensity;
  const moonlight = clamp01(1 - 4 * cloud);
  return (SKY_SHARE + (1 - SKY_SHARE) * moonlight) * (1 - clamp01(weather.flash ?? 0));
}

export class NightLight {
  constructor() {
    this.enabled = true;
    // Whether any tree shades the map this frame.
    this.active = false;
    // The map: world cells x0.. and rows y0.., w by h, in leaf layers.
    this.x0 = 0;
    this.y0 = 0;
    this.w = 0;
    this.h = 0;
    this.layers = new Float32Array(0);
    // The box (map cells, end exclusive) the trees touched this frame.
    this.dirty = { x0: 0, y0: 0, x1: 0, y1: 0 };
    // Frames each baked footprint has been shown, for its fade.
    this.shown = new WeakMap();
    // Footprints baked this frame, their work and the time it took (ms).
    this.bakes = 0;
    this.work = 0;
    this.bakeMs = 0;
    // Footprints baked since the map was made, so a benchmark can check it
    // timed the frame of every one.
    this.baked = 0;
  }

  // Builds the map for this frame's view from the trees in `props`.
  // env: { weather, seed }.
  prepare(view, props, env = {}) {
    const d = this.dirty;
    for (let y = d.y0; y < d.y1; y++) this.layers.fill(0, y * this.w + d.x0, y * this.w + d.x1);
    d.x0 = d.y0 = d.x1 = d.y1 = 0;
    this.active = false;
    this.bakes = this.work = this.bakeMs = 0;
    if (!this.enabled) return;
    this.x0 = view.x0 - PAD_X;
    this.y0 = view.y0 - PAD_TOP;
    this.w = view.cols + 2 * PAD_X;
    this.h = view.rows + PAD_TOP + PAD_BOTTOM;
    if (this.layers.length < this.w * this.h) this.layers = new Float32Array(this.w * this.h);
    const sky = skyFactor(env.weather);
    if (sky <= 0) return;
    const seed = env.seed ?? 1;
    let x0 = this.w, y0 = this.h, x1 = 0, y1 = 0;
    for (const prop of props) {
      if (prop.kind !== 'tree') continue;
      const strength = stampStrength(prop);
      if (strength <= 0) continue;
      const baking = !hasStamp(prop);
      if (baking && (this.bakes >= MAX_BAKES_PER_FRAME || this.work >= BAKE_WORK)) continue;
      const started = baking ? performance.now() : 0;
      const stamp = canopyStamp(prop, seed);
      if (baking) {
        this.bakeMs += performance.now() - started;
        this.bakes++;
        this.baked++;
        this.work += stamp?.work ?? 0;
      }
      if (!stamp) continue;
      const frames = Math.min(FADE_FRAMES, (this.shown.get(prop) ?? 0) + 1);
      this.shown.set(prop, frames);
      const s = strength * sky * frames / FADE_FRAMES / LAYER_UNIT;
      // The stamp's cells that fall on the map.
      const ox = Math.floor(prop.x) + stamp.x0 - this.x0;
      const oy = Math.floor(prop.y) + stamp.y0 - this.y0;
      const sx0 = Math.max(0, -ox), sx1 = Math.min(stamp.w, this.w - ox);
      const sy0 = Math.max(0, -oy), sy1 = Math.min(stamp.h, this.h - oy);
      if (sx0 >= sx1 || sy0 >= sy1) continue;
      const { layers: src, w: sw } = stamp;
      const layers = this.layers, w = this.w;
      for (let y = sy0; y < sy1; y++) {
        const from = y * sw, to = (y + oy) * w + ox;
        for (let x = sx0; x < sx1; x++) {
          const v = src[from + x];
          if (v) layers[to + x] += v * s;
        }
      }
      x0 = Math.min(x0, ox + sx0);
      x1 = Math.max(x1, ox + sx1);
      y0 = Math.min(y0, oy + sy0);
      y1 = Math.max(y1, oy + sy1);
    }
    if (x0 >= x1) return;
    Object.assign(d, { x0, y0, x1, y1 });
    this.active = true;
  }

  // Whether the trees touched world row wy this frame.
  rowShaded(wy) {
    const y = wy - this.y0;
    return this.active && y >= this.dirty.y0 && y < this.dirty.y1;
  }

  // The share of the night's light that reaches world cell (wx, wy).
  gainAt(wx, wy) {
    const x = wx - this.x0, y = wy - this.y0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 1;
    const v = this.layers[y * this.w + x];
    return v > 0 ? GAIN[v < 255 / LAYER_UNIT ? (v * LAYER_UNIT) | 0 : 255] : 1;
  }

  // Darkens the ground already drawn on screen, all but the water, which
  // shows the sky.
  shadeGround(r, view) {
    if (!this.active) return;
    const d = this.dirty;
    const sx0 = Math.max(0, d.x0 - PAD_X), sx1 = Math.min(view.cols, d.x1 - PAD_X);
    const sy0 = Math.max(0, d.y0 - PAD_TOP), sy1 = Math.min(view.rows, d.y1 - PAD_TOP);
    const { fg, bg, ov, mask } = r;
    for (let sy = sy0; sy < sy1; sy++) {
      const row = (sy + PAD_TOP) * this.w + PAD_X;
      for (let sx = sx0; sx < sx1; sx++) {
        const v = this.layers[row + sx];
        if (!(v > 0)) continue;
        const cell = sy * r.cols + sx;
        if (mask[cell] === WATER) continue;
        const k = GAIN[v < 255 / LAYER_UNIT ? (v * LAYER_UNIT) | 0 : 255];
        const o = cell * 4;
        fg[o] *= k; fg[o + 1] *= k; fg[o + 2] *= k;
        bg[o] *= k; bg[o + 1] *= k; bg[o + 2] *= k;
        ov[o] *= k; ov[o + 1] *= k; ov[o + 2] *= k;
      }
    }
  }
}

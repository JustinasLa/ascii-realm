import { WEATHER_EFFECTS } from './weather.js';
import { canopyStamp, GAIN, hasStamp, LAYER_UNIT, stampStrength } from './canopy.js';
import { MAX_GRASS_HEIGHT, SIDE_PAD } from './grass.js';
import {
  columnStamp, drawColumn, drawMotes, MOTE_GAP, patchStamp, SHAFT_RISE, SHAFT_TIERS, shaftAt, shaftsNear,
} from './moon-shafts.js';
import { moonTint, PEAK_LIFT, TINT } from './moon-tint.js';
import { ASPECT, WATER } from './world.js';

// How much of the night's light reaches the ground, cell by cell, this
// frame. Trees' crowns keep it off the ground under and around them (see
// canopy.js): each layer of leaves over a cell takes away a fixed share.
// The map is fixed to world cells, not the screen, so walking and zooming
// never move a shadow. The ground, the grass and flowers rooted in it and a
// rock's ground cells are all darkened by it, before any warm light (a
// torch, a fire, a spell) is added: leaves block the moon, not your torch.
// Where a moonbeam lands (see moon-shafts.js) the map lets more light
// through than the open sky: a second map, `lift`, holds how much, and the
// leaves dim a beam like any moonlight. Each ground cell takes both at once.

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
// Of those, moonbeams baked in one frame: a beam's patch and column cost
// more than most crowns, and one coming into view can always wait a frame.
export const MAX_BEAM_BAKES = 1;
// The map's margin around the view: blades lean in from roots beside it,
// the grass's reflections read roots above it and blades rise from roots
// below it.
export const PAD_X = SIDE_PAD;
export const PAD_TOP = MAX_GRASS_HEIGHT + 2;
export const PAD_BOTTOM = MAX_GRASS_HEIGHT + 2;

// Beams are picked from a window wider than the map, so most of them fade
// in and out beyond the view's edge, and one whose column leans into the
// view from below or from the right is found too.
export const SHAFT_MARGIN_X = 24;
export const SHAFT_MARGIN_Y = 8;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The share of the moon itself that cloud leaves uncovered.
export function moonlightOf(weather) {
  if (!weather) return 1;
  const profile = WEATHER_EFFECTS[weather.preset] ?? {};
  const intensity = weather.intensity ?? 0;
  const cloud = ((profile.shade ?? 0) + 0.5 * (profile.haze ?? 0)) * intensity;
  return clamp01(1 - 4 * cloud);
}

// How much of a shadow the weather leaves: cloud covers the moon, so only
// the sky's share stays, and lightning lights everything for its flash.
export function skyFactor(weather) {
  if (!weather) return 1;
  return (SKY_SHARE + (1 - SKY_SHARE) * moonlightOf(weather)) * (1 - clamp01(weather.flash ?? 0));
}

// How strong a beam is: the moon's share, all washed out by a flash.
export function beamFactor(weather) {
  return moonlightOf(weather) * (1 - clamp01(weather?.flash ?? 0));
}

const MAX_MOTES = Math.floor(SHAFT_RISE / MOTE_GAP);

export class NightLight {
  constructor() {
    this.enabled = true;
    // Whether moonbeams are drawn, and the tier they are drawn at (see
    // SHAFT_TIERS); null takes the device's, given to prepare.
    this.shafts = true;
    this.tier = null;
    // Whether any tree shades the map this frame, or any beam lights it.
    this.active = false;
    // The map: world cells x0.. and rows y0.., w by h, in leaf layers, and
    // the extra light beams let through (0 .. PEAK_LIFT).
    this.x0 = 0;
    this.y0 = 0;
    this.w = 0;
    this.h = 0;
    this.layers = new Float32Array(0);
    this.lift = new Float32Array(0);
    // The boxes (map cells, end exclusive) the trees and the beams touched
    // this frame.
    this.dirty = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.lit = { x0: 0, y0: 0, x1: 0, y1: 0 };
    // Frames each baked footprint has been shown, for its fade.
    this.shown = new WeakMap();
    // The beams being shown or fading out, by slot: { shaft, frames, out,
    // mix (how much of its column shows), motes, s (this frame's strength) },
    // and this frame's ones with any light, nearest the view first.
    this.beams = new Map();
    this.visible = [];
    // The map boxes (end exclusive) this frame's beams lit, one each.
    this.boxes = [];
    this.world = null;
    this.seed = null;
    this.tierName = null;
    // Footprints baked this frame, their work and the time it took (ms).
    this.bakes = 0;
    this.work = 0;
    this.bakeMs = 0;
    // Footprints baked since the map was made, so a benchmark can check it
    // timed the frame of every one.
    this.baked = 0;
  }

  // Builds the map for this frame's view from the trees in `props` and the
  // world's beams. env: { weather, seed, world, tier }; with no world there
  // are no beams.
  prepare(view, props, env = {}) {
    const d = this.dirty, l = this.lit;
    for (let y = d.y0; y < d.y1; y++) this.layers.fill(0, y * this.w + d.x0, y * this.w + d.x1);
    for (let y = l.y0; y < l.y1; y++) this.lift.fill(0, y * this.w + l.x0, y * this.w + l.x1);
    d.x0 = d.y0 = d.x1 = d.y1 = 0;
    l.x0 = l.y0 = l.x1 = l.y1 = 0;
    this.active = false;
    this.visible.length = 0;
    this.boxes.length = 0;
    this.bakes = this.work = this.bakeMs = 0;
    if (!this.enabled) return;
    this.x0 = view.x0 - PAD_X;
    this.y0 = view.y0 - PAD_TOP;
    this.w = view.cols + 2 * PAD_X;
    this.h = view.rows + PAD_TOP + PAD_BOTTOM;
    if (this.layers.length < this.w * this.h) {
      this.layers = new Float32Array(this.w * this.h);
      this.lift = new Float32Array(this.w * this.h);
    }
    const seed = env.seed ?? 1;
    const sky = skyFactor(env.weather);
    if (sky > 0) this.shadeTrees(props, sky, seed);
    if (this.shafts && env.world) this.lightBeams(view, env, seed);
    else this.beams.clear();
    this.active = d.x1 > d.x0 || l.x1 > l.x0;
  }

  shadeTrees(props, sky, seed) {
    let x0 = this.w, y0 = this.h, x1 = 0, y1 = 0;
    for (const prop of props) {
      if (prop.kind !== 'tree') continue;
      const strength = stampStrength(prop);
      if (strength <= 0) continue;
      const baking = !hasStamp(prop);
      if (baking && !this.canBake()) continue;
      const started = baking ? performance.now() : 0;
      const stamp = canopyStamp(prop, seed);
      if (baking) this.countBake(started, stamp?.work ?? 0);
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
    if (x0 < x1) Object.assign(this.dirty, { x0, y0, x1, y1 });
  }

  // Whether this frame's budget lets another footprint or patch be baked:
  // always the first.
  canBake() {
    return this.bakes < MAX_BAKES_PER_FRAME && this.work < BAKE_WORK;
  }

  countBake(started, work) {
    this.bakeMs += performance.now() - started;
    this.bakes++;
    this.baked++;
    this.work += work;
  }

  // Picks the beams to show, nearest the view's middle first, at most the
  // tier's count, fades them in and out, and lays their patches on the map.
  // A beam no longer picked fades out; past the tier's count of those, the
  // faintest go at once.
  lightBeams(view, env, seed) {
    const { world } = env;
    if (world !== this.world || seed !== this.seed) {
      this.beams.clear();
      this.world = world;
      this.seed = seed;
    }
    const name = this.tier ?? env.tier;
    const tier = SHAFT_TIERS[name] ?? SHAFT_TIERS.desktop;
    this.tierName = SHAFT_TIERS[name] ? name : 'desktop';
    const x0 = view.x0 - PAD_X - SHAFT_MARGIN_X, x1 = view.x0 + view.cols + PAD_X + SHAFT_MARGIN_X;
    const y0 = view.y0 - PAD_TOP - SHAFT_MARGIN_Y, y1 = view.y0 + view.rows + PAD_BOTTOM + SHAFT_MARGIN_Y;
    const mx = view.x0 + view.cols / 2, my = view.y0 + view.rows / 2;
    const near = shaftsNear(x0, y0, x1, y1, seed, world, tier.column);
    const far = (s) => ((s.cx - mx) * ASPECT) ** 2 + (s.cy - my) ** 2;
    near.sort((a, b) => far(a) - far(b) || (a.key < b.key ? -1 : 1));
    const beams = this.beams;
    let beamBakes = 0;
    for (const beam of beams.values()) beam.out = true;
    for (let k = 0; k < near.length && k < tier.max; k++) {
      const shaft = near[k];
      let beam = beams.get(shaft.key);
      if (!beam) {
        if (!shaft.stamp) {
          if (!this.canBake() || beamBakes >= MAX_BEAM_BAKES) continue;
          beamBakes++;
          const started = performance.now();
          this.countBake(started, patchStamp(shaft, seed).work + columnStamp(shaft, seed).work);
        }
        beam = { shaft, frames: 0, out: false, mix: tier.column ? 1 : 0, motes: Math.min(MAX_MOTES, tier.motes), s: 0 };
        beams.set(shaft.key, beam);
      }
      beam.out = false;
      beam.frames = Math.min(FADE_FRAMES, beam.frames + 1);
    }
    const leaving = [];
    for (const beam of beams.values()) {
      if (!beam.out) continue;
      if (--beam.frames <= 0) beams.delete(beam.shaft.key);
      else leaving.push(beam);
    }
    if (leaving.length > tier.max) {
      leaving.sort((a, b) => b.frames - a.frames);
      for (const beam of leaving.slice(tier.max)) beams.delete(beam.shaft.key);
    }
    const light = tier.intensity * beamFactor(env.weather);
    const mixStep = 1 / FADE_FRAMES, target = tier.column ? 1 : 0;
    let lx0 = this.w, ly0 = this.h, lx1 = 0, ly1 = 0;
    for (const beam of beams.values()) {
      beam.mix = target > beam.mix ? Math.min(target, beam.mix + mixStep) : Math.max(target, beam.mix - mixStep);
      beam.s = light * beam.frames / FADE_FRAMES;
      if (!(beam.s > 0)) continue;
      this.visible.push(beam);
      const { shaft } = beam, stamp = shaft.stamp;
      const ox = Math.floor(shaft.cx) + stamp.x0 - this.x0;
      const oy = Math.floor(shaft.cy) + stamp.y0 - this.y0;
      const sx0 = Math.max(0, -ox), sx1 = Math.min(stamp.w, this.w - ox);
      const sy0 = Math.max(0, -oy), sy1 = Math.min(stamp.h, this.h - oy);
      if (sx0 >= sx1 || sy0 >= sy1) continue;
      const f = beam.s * PEAK_LIFT / 255;
      const { lift: src, w: sw } = stamp;
      const lift = this.lift, w = this.w;
      // Where beams overlap, the brighter one: no cell is lit twice.
      for (let y = sy0; y < sy1; y++) {
        const from = y * sw, to = (y + oy) * w + ox;
        for (let x = sx0; x < sx1; x++) {
          const v = src[from + x] * f;
          if (v > lift[to + x]) lift[to + x] = v;
        }
      }
      this.boxes.push({ x0: ox + sx0, y0: oy + sy0, x1: ox + sx1, y1: oy + sy1 });
      lx0 = Math.min(lx0, ox + sx0);
      lx1 = Math.max(lx1, ox + sx1);
      ly0 = Math.min(ly0, oy + sy0);
      ly1 = Math.max(ly1, oy + sy1);
    }
    if (lx0 < lx1) Object.assign(this.lit, { x0: lx0, y0: ly0, x1: lx1, y1: ly1 });
    this.visible.sort((a, b) => far(a.shaft) - far(b.shaft) || (a.shaft.key < b.shaft.key ? -1 : 1));
  }

  // The beam in slot (i, j) of the world last prepared, for debugging.
  debugShaftAt(i, j) {
    return this.world ? shaftAt(i, j, this.seed, this.world) : null;
  }

  // Whether the trees or a beam touched world row wy this frame.
  rowShaded(wy) {
    const y = wy - this.y0;
    return this.active && ((y >= this.dirty.y0 && y < this.dirty.y1) || (y >= this.lit.y0 && y < this.lit.y1));
  }

  // The share of the night's light that reaches world cell (wx, wy): above
  // 1 in a moonbeam.
  gainAt(wx, wy) {
    const x = wx - this.x0, y = wy - this.y0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 1;
    const i = y * this.w + x;
    const v = this.layers[i], lift = this.lift[i];
    const gain = v > 0 ? GAIN[v < 255 / LAYER_UNIT ? (v * LAYER_UNIT) | 0 : 255] : 1;
    return lift > 0 ? gain * (1 + lift) : gain;
  }

  // How far world cell (wx, wy)'s colours turn toward the moonlight: up to
  // TINT at a beam's heart.
  tintAt(wx, wy) {
    const x = wx - this.x0, y = wy - this.y0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return TINT * this.lift[y * this.w + x] / PEAK_LIFT;
  }

  // Darkens the ground already drawn on screen under the trees and lights
  // it in the beams, each cell once, all but the water, which shows the sky:
  // the trees' box first, then each beam's, but for the cells already done.
  shadeGround(r, view) {
    if (!this.active) return;
    this.shadeBox(r, view, this.dirty, 0);
    for (let b = 0; b < this.boxes.length; b++) this.shadeBox(r, view, this.boxes[b], b + 1);
  }

  // Shades the cells of map box `box` on screen, skipping those in the
  // trees' box and in the first `done - 1` beams' boxes when done > 0.
  shadeBox(r, view, box, done) {
    const sx0 = Math.max(0, box.x0 - PAD_X), sx1 = Math.min(view.cols, box.x1 - PAD_X);
    const sy0 = Math.max(0, box.y0 - PAD_TOP), sy1 = Math.min(view.rows, box.y1 - PAD_TOP);
    const { fg, bg, ov, mask } = r;
    const { layers, lift, dirty, boxes } = this;
    for (let sy = sy0; sy < sy1; sy++) {
      const my = sy + PAD_TOP;
      const row = my * this.w + PAD_X;
      const inDirty = done > 0 && my >= dirty.y0 && my < dirty.y1;
      for (let sx = sx0; sx < sx1; sx++) {
        const v = layers[row + sx], up = lift[row + sx];
        if (!(v > 0) && !(up > 0)) continue;
        if (done > 0) {
          const mx = sx + PAD_X;
          if (inDirty && mx >= dirty.x0 && mx < dirty.x1) continue;
          let seen = false;
          for (let b = 0; b < done - 1 && !seen; b++) {
            const e = boxes[b];
            seen = mx >= e.x0 && mx < e.x1 && my >= e.y0 && my < e.y1;
          }
          if (seen) continue;
        }
        const cell = sy * r.cols + sx;
        if (mask[cell] === WATER) continue;
        let k = v > 0 ? GAIN[v < 255 / LAYER_UNIT ? (v * LAYER_UNIT) | 0 : 255] : 1;
        if (up > 0) k *= 1 + up;
        const o = cell * 4;
        fg[o] *= k; fg[o + 1] *= k; fg[o + 2] *= k;
        bg[o] *= k; bg[o + 1] *= k; bg[o + 2] *= k;
        ov[o] *= k; ov[o + 1] *= k; ov[o + 2] *= k;
        if (up > 0) {
          const t = TINT * up / PEAK_LIFT;
          moonTint(fg, o, t);
          moonTint(bg, o, t);
          moonTint(ov, o, t);
        }
      }
    }
  }

  // The beams' columns of lit air and their motes, over everything drawn
  // so far but the warm light, the weather and what flies.
  drawShafts(r, view, time) {
    if (!this.active) return;
    for (const beam of this.visible) {
      const k = beam.s * beam.mix;
      if (!(k > 0)) continue;
      drawColumn(r, view, beam.shaft, k, this.seed);
      if (beam.motes) drawMotes(r, view, beam.shaft, beam.motes, k, time, this.seed);
    }
  }
}

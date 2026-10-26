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
// Nearest the view's middle first (`far`, set each frame), then by slot.
const nearest = (a, b) => a.far - b.far || (a.key < b.key ? -1 : 1);
const nearestBeam = (a, b) => nearest(a.shaft, b.shaft);
// Whether world box b (end exclusive) reaches into the view.
const overlaps = (b, view) =>
  b.x0 < view.x0 + view.cols && b.x1 > view.x0 && b.y0 < view.y0 + view.rows && b.y1 > view.y0;

export class NightLight {
  constructor() {
    this.enabled = true;
    // Whether moonbeams are drawn, and the tier they are drawn at (see
    // SHAFT_TIERS); null takes the device's, given to prepare.
    this.shafts = true;
    this.tier = null;
    // Whether any tree shades the map this frame, or any beam lights it;
    // and, apart from that, whether any beam's column of air (and its
    // motes) reaches into the view, though its patch may lie beyond the map.
    this.active = false;
    this.columns = false;
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
    // The map boxes (end exclusive) this frame's beams lit, one each (kept
    // and reused frame to frame, the first `boxCount` of them this frame's).
    this.boxes = [];
    this.boxCount = 0;
    // The tint lightAt found, and lists reused frame to frame.
    this.tint = 0;
    this.near = [];
    this.leaving = [];
    // The window and the world `near` was found for, nearest first: while
    // they hold (the view at rest) and no slot there waited for its ground,
    // the list is used again rather than looked up and sorted afresh.
    this.query = { x0: 0, y0: 0, x1: 0, y1: 0, columns: false, world: null, seed: null, done: false };
    // What the beams' map was last laid from: the map's place and size, and
    // each beam's shaft and strength in turn. While all of it holds (the view
    // and the beams at rest) the map is kept as it is, not laid again.
    this.laid = [];
    this.laidX0 = 0;
    this.laidY0 = 0;
    this.laidW = 0;
    this.laidH = 0;
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
    d.x0 = d.y0 = d.x1 = d.y1 = 0;
    this.active = false;
    this.columns = false;
    this.visible.length = 0;
    this.bakes = this.work = this.bakeMs = 0;
    if (!this.enabled) {
      this.clearLift();
      return;
    }
    this.x0 = view.x0 - PAD_X;
    this.y0 = view.y0 - PAD_TOP;
    this.w = view.cols + 2 * PAD_X;
    this.h = view.rows + PAD_TOP + PAD_BOTTOM;
    if (this.layers.length < this.w * this.h) {
      this.layers = new Float32Array(this.w * this.h);
      this.lift = new Float32Array(this.w * this.h);
      this.clearLift();
    }
    const seed = env.seed ?? 1;
    const sky = skyFactor(env.weather);
    if (sky > 0) this.shadeTrees(props, sky, seed);
    if (this.shafts && env.world) this.lightBeams(view, env, seed);
    else {
      this.beams.clear();
      this.clearLift();
    }
    this.active = d.x1 > d.x0 || l.x1 > l.x0;
  }

  // Empties the beams' map where it was last laid.
  clearLift() {
    const l = this.lit, w = this.laidW;
    for (let y = l.y0; y < l.y1; y++) this.lift.fill(0, y * w + l.x0, y * w + l.x1);
    l.x0 = l.y0 = l.x1 = l.y1 = 0;
    this.boxCount = 0;
    this.laid.length = 0;
  }

  // Whether this frame's beams would lay the map exactly as it lies.
  stillLaid() {
    const { laid, visible } = this;
    if (laid.length !== visible.length * 2 || this.laidX0 !== this.x0 || this.laidY0 !== this.y0 ||
      this.laidW !== this.w || this.laidH !== this.h) return false;
    for (let b = 0; b < visible.length; b++) {
      if (laid[b * 2] !== visible[b].shaft || laid[b * 2 + 1] !== visible[b].s) return false;
    }
    return true;
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
    const near = this.near, q = this.query;
    if (!(q.done && q.x0 === x0 && q.y0 === y0 && q.x1 === x1 && q.y1 === y1 && q.columns === tier.column &&
      q.world === world && q.seed === seed)) {
      near.length = 0;
      shaftsNear(x0, y0, x1, y1, seed, world, tier.column, near);
      for (const shaft of near) shaft.far = ((shaft.cx - mx) * ASPECT) ** 2 + (shaft.cy - my) ** 2;
      near.sort(nearest);
      Object.assign(q, { x0, y0, x1, y1, columns: tier.column, world, seed, done: !near.pending });
    }
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
    const leaving = this.leaving;
    leaving.length = 0;
    for (const beam of beams.values()) {
      if (!beam.out) continue;
      if (--beam.frames <= 0) beams.delete(beam.shaft.key);
      else leaving.push(beam);
    }
    if (leaving.length > tier.max) {
      leaving.sort((a, b) => b.frames - a.frames);
      for (let k = tier.max; k < leaving.length; k++) beams.delete(leaving[k].shaft.key);
    }
    const light = tier.intensity * beamFactor(env.weather);
    const mixStep = 1 / FADE_FRAMES, target = tier.column ? 1 : 0;
    for (const beam of beams.values()) {
      beam.mix = target > beam.mix ? Math.min(target, beam.mix + mixStep) : Math.max(target, beam.mix - mixStep);
      beam.s = light * beam.frames / FADE_FRAMES;
      if (!(beam.s > 0)) continue;
      this.visible.push(beam);
      if (beam.mix > 0 && overlaps(beam.shaft.reach, view)) this.columns = true;
    }
    if (!this.stillLaid()) this.layBeams();
    this.visible.sort(nearestBeam);
  }

  // Lays this frame's beams' patches on the map afresh.
  layBeams() {
    this.clearLift();
    const { laid } = this;
    let lx0 = this.w, ly0 = this.h, lx1 = 0, ly1 = 0;
    for (const beam of this.visible) {
      laid.push(beam.shaft, beam.s);
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
      const box = this.boxes[this.boxCount] ??= { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.boxCount++;
      box.x0 = ox + sx0;
      box.y0 = oy + sy0;
      box.x1 = ox + sx1;
      box.y1 = oy + sy1;
      lx0 = Math.min(lx0, ox + sx0);
      lx1 = Math.max(lx1, ox + sx1);
      ly0 = Math.min(ly0, oy + sy0);
      ly1 = Math.max(ly1, oy + sy1);
    }
    if (lx0 < lx1) {
      const l = this.lit;
      l.x0 = lx0;
      l.y0 = ly0;
      l.x1 = lx1;
      l.y1 = ly1;
    }
    this.laidX0 = this.x0;
    this.laidY0 = this.y0;
    this.laidW = this.w;
    this.laidH = this.h;
  }

  // The beam in slot (i, j) of the world last prepared, for debugging.
  debugShaftAt(i, j) {
    return this.world ? shaftAt(i, j, this.seed, this.world) : null;
  }

  // Whether the trees or a beam touched world row wy this frame: a row
  // between two beams' patches, with no tree's shade, is left alone.
  rowShaded(wy) {
    if (!this.active) return false;
    const y = wy - this.y0;
    if (y >= this.dirty.y0 && y < this.dirty.y1) return true;
    if (y < this.lit.y0 || y >= this.lit.y1) return false;
    for (let b = 0; b < this.boxCount; b++) if (y >= this.boxes[b].y0 && y < this.boxes[b].y1) return true;
    return false;
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

  // gainAt and tintAt in one look: returns the gain at world cell (wx, wy)
  // and leaves its tint in `tint`.
  lightAt(wx, wy) {
    const x = wx - this.x0, y = wy - this.y0;
    this.tint = 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 1;
    const i = y * this.w + x;
    const v = this.layers[i], lift = this.lift[i];
    const gain = v > 0 ? GAIN[v < 255 / LAYER_UNIT ? (v * LAYER_UNIT) | 0 : 255] : 1;
    if (!(lift > 0)) return gain;
    this.tint = TINT * lift / PEAK_LIFT;
    return gain * (1 + lift);
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
    for (let b = 0; b < this.boxCount; b++) this.shadeBox(r, view, this.boxes[b], b + 1);
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
        const gain = v > 0 ? GAIN[v < 255 / LAYER_UNIT ? (v * LAYER_UNIT) | 0 : 255] : 1;
        const o = cell * 4;
        // `ov`'s colours are never shown, only its layer flag: the shade
        // keeps it in step as it always has, the beams leave it be.
        if (gain !== 1) { ov[o] *= gain; ov[o + 1] *= gain; ov[o + 2] *= gain; }
        const k = up > 0 ? gain * (1 + up) : gain;
        fg[o] *= k; fg[o + 1] *= k; fg[o + 2] *= k;
        bg[o] *= k; bg[o + 1] *= k; bg[o + 2] *= k;
        if (up > 0) {
          const t = TINT * up / PEAK_LIFT;
          moonTint(fg, o, t);
          moonTint(bg, o, t);
        }
      }
    }
  }

  // The beams' columns of lit air and their motes, over everything drawn
  // so far but the warm light, the weather and what flies. A column is
  // drawn wherever it meets the view, whether or not its patch does.
  drawShafts(r, view, time) {
    if (!this.columns) return;
    for (const beam of this.visible) {
      const k = beam.s * beam.mix;
      if (!(k > 0) || !overlaps(beam.shaft.reach, view)) continue;
      drawColumn(r, view, beam.shaft, k, this.seed);
      if (beam.motes) drawMotes(r, view, beam.shaft, beam.motes, k, time, this.seed);
    }
  }
}

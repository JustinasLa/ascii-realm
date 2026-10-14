import { valueNoise, valueNoiseRow } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { LAYER, STROKE_STEPS, dg, flatGlyph, hasGlyph, over, strokeGlyph } from '../render/glyphs.js';
import { FRONDS, PLACES } from '../render/glyph-packs/flora.js';
import {
  BLUEBELL, BUTTERCUP, CATTAIL, CLOCK, CLOVER, CORNFLOWER, DAISY, DANDELION, DEW, FERN, FORGET_ME_NOT,
  FOXGLOVE, LUPIN, PALETTES, POPPY, THISTLE, YARROW, extraAt,
} from './grass-roots.js';
import { ASPECT, CHUNK_SIZE, WATER } from './world.js';

// Terrain grows blades up to five cells high; drawn blades are longer than
// that profile, so they read as separate character stalks, and a flower can top one.
const MAX_PROFILE = 5;
const BLADE_LENGTH = 1.3;
export const MAX_GRASS_HEIGHT = 8;
const SIDE_PAD = 12;
const SOLE_RADIUS = SCALE * 0.1;
const HOLD = 0.25;
const LIFE = 2;
const MAX_BENDS = 1024;
const MAX_TRACKS = 8192;
const TRACK_MEMORY = 45;
// The body parts the meadow around it: an ellipse on the ground plane,
// in aspect-corrected cells across and rows deep.
const BODY_RADIUS = 4.8;
const BODY_DEPTH = 3;
const PART_LIFE = 2.2;
const PART_SPRING = 2.6;
const MAX_PARTS = 4096;
const MAT = [51, 77, 53];
const MATTED = [flatGlyph(2, 2), flatGlyph(1, 2), flatGlyph(2, 1)];
// Tips catch the moonlight and pale toward this.
const TIP = [74, 96, 85];
const L = (name) => over(dg(name));
// Whatever a stalk carries comes in a glyph for each place its tip can end
// across the cell (see PLACES in the flora pack).
const P = (name) => PLACES.map((_, k) => over(dg(`${name}@${k}`)));
const place = (x) => {
  const f = x - Math.floor(x);
  return f < 0.36 ? 0 : f > 0.64 ? 2 : 1;
};
// Flower stalks share the grass's heading characters.
const STROKE0 = strokeGlyph(0, 0, 0);
const THIN = Array.from({ length: STROKE_STEPS * STROKE_STEPS * 3 }, (_, k) =>
  dg(`flora.stem.${Math.floor(k / STROKE_STEPS) % STROKE_STEPS}.${k % STROKE_STEPS}`));

// Wild flowers as they look by moonlight: still clearly white, gold, red,
// blue or pink, but a little greyed and cooled. A head is a petal glyph
// with an eye of another colour layered into it; a spike runs florets up
// over the top of its own stalk and tapers in the cell above.
// Heads also come smaller (named `.s`): buds and young flowers.
const bud = (name) => hasGlyph(`${name}.s@0`) ? P(`${name}.s`) : P(name);
const flower = (petals, colour, eyes = null, eye = null, extra = {}) =>
  ({ petals: petals.map(P), buds: petals.map(bud), colour, eyes: eyes && eyes.map(P),
    budEyes: eyes && eyes.map(bud), eye, ...extra });
const SPECIES = [];
SPECIES[DAISY] = flower(['flora.daisy.0', 'flora.daisy.1'], [226, 230, 222],
  ['flora.daisy.eye', 'flora.daisy.eye.1'], [236, 192, 72]);
SPECIES[BUTTERCUP] = flower(['flora.buttercup'], [240, 204, 62], ['flora.buttercup.gloss'], [255, 246, 190]);
SPECIES[POPPY] = flower(['flora.poppy'], [222, 58, 52], ['flora.poppy.eye'], [34, 16, 26]);
SPECIES[CORNFLOWER] = flower(['flora.cornflower'], [112, 158, 255], ['flora.cornflower.eye'], [84, 60, 168]);
SPECIES[CLOVER] = flower(['flora.clover'], [206, 112, 176], ['flora.clover.tips'], [246, 200, 226]);
SPECIES[DANDELION] = flower(['flora.dandelion'], [244, 206, 60], ['flora.dandelion.eye'], [214, 146, 40]);
SPECIES[CLOCK] = flower(['flora.clock'], [214, 220, 226], ['flora.clock.core'], [110, 100, 80]);
SPECIES[YARROW] = flower(['flora.yarrow'], [228, 224, 206]);
SPECIES[FORGET_ME_NOT] = flower(['flora.myosotis.0', 'flora.myosotis.1'], [124, 176, 250],
  ['flora.myosotis.eye.0', 'flora.myosotis.eye.1'], [246, 226, 120]);
SPECIES[BLUEBELL] = flower(['flora.bluebell.0', 'flora.bluebell.1'], [132, 120, 240]);
SPECIES[LUPIN] = flower(['flora.lupin.tip'], [146, 110, 236], ['flora.lupin.banner.tip'], [240, 234, 250],
  { spike: ['flora.lupin.mid.0', 'flora.lupin.mid.1'].map(P),
    shades: [[146, 110, 236], [226, 124, 194], [228, 224, 216], [124, 134, 244]] });
SPECIES[FOXGLOVE] = flower(['flora.foxglove.tip'], [226, 104, 194], ['flora.foxglove.throat'], [80, 26, 68],
  { spike: ['flora.foxglove.mid.0', 'flora.foxglove.mid.1'].map(P) });
// A thistle's spiny bulb is green; its brush is layered on in purple.
SPECIES[THISTLE] = flower(['flora.thistle.bulb'], [94, 118, 88], ['flora.thistle.brush'], [198, 102, 218]);
const FALLEN = L('flora.fallen');
// Grass seed heads, in pale moonlit straw, and the reeds' cattails.
const SEEDS = ['flora.seed.oat.0', 'flora.seed.oat.1', 'flora.seed.timothy', 'flora.seed.plume.0',
  'flora.seed.plume.1', 'flora.seed.rye'].map(P);
const STRAW = [156, 150, 114];
const CATTAIL_HEAD = P('flora.cattail');
const CATTAIL_BROWN = [150, 104, 64];
const DEWDROPS = [0, 1, 2, 3].map((i) => L(`flora.dew.${i}`));
const DEW_LIGHT = [196, 220, 240];
const FROND = FRONDS.map((_, i) => dg(`flora.frond.${i}`));
const FROND_TIP = FRONDS.map((_, i) => dg(`flora.frond.tip.${i}`));
const FERN_GREEN = [52, 124, 76];
// Where the last drawn blade ended: the cell just beyond its tip, and the
// column of each row it crossed (none when it lay down), so a flower spike
// or a dew drop can be layered over the blade itself.
let tipX = 0;
let tipY = 0;
let tipAt = 0.5;
let bladeRows = 0;
const ROW_X = new Int16Array(16);
const ROW_P = new Uint8Array(16);
const TONE = [0, 0, 0];
const STALK = [0, 0, 0];

// A smooth, sine-like wave with period 1 made of two parabolas. Cheaper
// than Math.sin, which matters when it runs for every blade every frame.
const ripple = (p) => {
  const f = p - Math.floor(p);
  return f < 0.5 ? 16 * f * (0.5 - f) : 16 * (f - 0.5) * (f - 1);
};

const step = (v, steps) => v <= 0 ? 0 : v >= 1 ? steps - 1 : (v * steps) | 0;

function drawBlade(r, view, write, x, y, height, lean, flat, light, tone, phase = 0, thin = false) {
  // `flat` is the already eased contact pressure shared by the whole tuft.
  // A blade swings about its root, so a strong lean lowers it rather than
  // stretching it sideways, and pressure swings it the rest of the way down.
  const side = lean < 0 ? -1 : 1;
  const across = Math.abs(lean) * ASPECT;
  let rise;
  let reach;
  if (flat) {
    const angle = Math.atan2(across, height);
    const swing = angle + (1.5 - angle) * flat;
    rise = Math.cos(swing) * height;
    reach = Math.sin(swing) * height / ASPECT * side;
  } else {
    const k = height / Math.sqrt(height * height + across * across);
    rise = height * k;
    reach = lean * k;
  }
  const base = y - view.y0;
  const sx = x - view.x0;
  const dim = 1 - flat * 0.25;
  if (rise >= 0.75 && Math.abs(reach) <= rise * 1.8) {
    // Upright: one heading character per crossed cell. The physical curve
    // still controls the stalk's footprint and bends its tip more than its
    // base; a blade ending low in its last row gets a small tip character.
    const rows = Math.max(1, Math.ceil(rise - 0.25));
    const tip = rise - rows + 1 < 0.7 ? 2 : 1;
    const tr = tone[0];
    const tg = tone[1];
    const tb = tone[2];
    const lit = light * dim;
    // Blades bowing toward the moon, up and to the left, catch more of its
    // light along their upper edge.
    const moon = 0.8 + (reach < 0 ? Math.min(0.6, -reach * 0.15) : 0);
    let bottom = 0.5;
    for (let j = 0; j < rows; j++) {
      const v = (j + 1) / rows;
      const top = 0.5 + reach * v * (0.7 + v * 0.3);
      // Shade along the blade with a per-blade offset, so rows of equally
      // tall blades do not line up into horizontal bands of brightness.
      const u = Math.min(1, (j + 0.5) / rows + phase);
      const l = lit * (0.66 + u * 0.6);
      const pale = u > 0.6 ? Math.min(1, (u - 0.6) * moon) : 0;
      const cr = (tr + (TIP[0] - tr) * pale) * l;
      const cg = (tg + (TIP[1] - tg) * pale) * l;
      const cb = (tb + (TIP[2] - tb) * pale) * l;
      // A steeply leaning segment crosses into the next column: give each
      // column it passes through its own part, so the blade has no gaps.
      const from = Math.floor(Math.min(bottom, top) + 0.25);
      const to = Math.floor(Math.max(bottom, top) - 0.25);
      ROW_X[j] = sx + Math.floor((bottom + top) / 2);
      if (thin) ROW_P[j] = place((bottom + top) / 2);
      if (to <= from) {
        const col = Math.floor((bottom + top) / 2);
        const g = strokeGlyph(step(bottom - col, STROKE_STEPS), step(top - col, STROKE_STEPS), j === rows - 1 ? tip : 0);
        write(r, sx + col, base - j, thin ? THIN[g - STROKE0] : g, cr, cg, cb, base);
      } else {
        const end = top > bottom ? to : from;
        for (let col = from; col <= to; col++) {
          const g = strokeGlyph(step(bottom - col, STROKE_STEPS), step(top - col, STROKE_STEPS),
            j === rows - 1 && col === end ? tip : 0);
          write(r, sx + col, base - j, thin ? THIN[g - STROKE0] : g, cr, cg, cb, base);
        }
      }
      bottom = top;
    }
    tipX = sx + Math.floor(bottom);
    tipY = base - rows;
    tipAt = bottom;
    bladeRows = rows;
    return;
  }
  // Lying down: the blade crosses columns rather than rows, a little above
  // the bottom of the root's cell, rising towards a tip that lifts off.
  const cols = Math.max(1, Math.round(Math.abs(reach)));
  const mat = flat * 0.5;
  for (let k = 0; k < cols; k++) {
    const h0 = 0.3 + rise * k / cols;
    const h1 = 0.3 + rise * (k + 1) / cols;
    const row = Math.floor((h0 + h1) / 2);
    const a = step(1 - (h0 - row), 3);
    const b = step(1 - (h1 - row), 3);
    const l = light * (0.4 + (k + 0.5) / cols * 0.4) * dim;
    write(r, sx + side * k, base - row, side > 0 ? flatGlyph(a, b) : flatGlyph(b, a),
      (tone[0] + (MAT[0] - tone[0]) * mat) * l,
      (tone[1] + (MAT[1] - tone[1]) * mat) * l,
      (tone[2] + (MAT[2] - tone[2]) * mat) * l, base);
  }
  tipX = sx + side * cols;
  tipY = base - Math.floor(0.3 + rise);
  tipAt = 0.5;
  bladeRows = 0;
}

// A wild flower on the tip of the blade just drawn. A trampled one leaves
// only a few petals on the mat.
function drawFlower(r, paint, species, base, glow, flat, variation) {
  const v = (variation * 64) & 1;
  let [cr, cg, cb] = species.colour;
  if (species.shades) [cr, cg, cb] = species.shades[(variation * 97) & 3];
  if (flat > 0.6) {
    paint(r, tipX, tipY, FALLEN, cr * glow * 0.6, cg * glow * 0.6, cb * glow * 0.6, base);
    return;
  }
  if (species.spike && bladeRows > 1) {
    // Florets run up the top of the stalk, opening first at the bottom:
    // the lower ones a touch darker in the stalk's own shade.
    const from = Math.max(1, bladeRows - 3);
    for (let j = from; j < bladeRows; j++) {
      const l = glow * (0.72 + (j - from) * 0.1);
      paint(r, ROW_X[j], base - j, species.spike[(j + v) & 1][ROW_P[j]], cr * l, cg * l, cb * l, base);
    }
  }
  // About one head in four is a bud or a young flower, a size smaller.
  const young = ((variation * 1009) % 1) < 0.27;
  const petals = young ? species.buds : species.petals;
  paint(r, tipX, tipY, petals[v % petals.length][place(tipAt)], cr * glow, cg * glow, cb * glow, base);
  if (species.eyes) {
    const [er, eg, eb] = species.eye;
    const eyes = young ? species.budEyes : species.eyes;
    paint(r, tipX, tipY, eyes[v % eyes.length][place(tipAt)], er * glow, eg * glow, eb * glow, base);
  }
}

// A fern in a damp hollow: a few pinnate fronds arching out from the root
// and nodding with the wind, drawn segment by segment along each frond.
function drawFern(r, view, paint, x, y, height, lean, flat, light, variation) {
  const base = y - view.y0;
  const count = 3 + Math.floor(variation * 2.99);
  const length = height >= 4 ? 4 : 3;
  const sway = Math.max(-0.5, Math.min(0.5, lean * 0.07));
  for (let f = 0; f < count; f++) {
    const spread = (f / (count - 1) - 0.5) * 2;
    // Outer fronds arch over further; trampled ones lie down.
    let angle = spread * (1.05 + flat * 0.4) + (variation - 0.5) * 0.3;
    const droop = spread * (0.5 + flat * 0.3);
    const reach = Math.abs(spread) < 0.4 ? length : length - 1;
    let px = x - view.x0 + 0.5;
    let py = base + 0.7;
    const l = light * (0.8 + (spread < 0 ? 0.2 : 0) - Math.abs(spread) * 0.08);
    for (let k = 0; k < reach; k++) {
      const u = (k + 1) / reach;
      const a = Math.max(-1.45, Math.min(1.45, angle + droop * u * u + sway * u));
      const sx = Math.sin(a);
      const sy = Math.cos(a);
      const stepLength = 1 / Math.max(Math.abs(sy), Math.abs(sx) / ASPECT);
      const nx = px + sx / ASPECT * stepLength;
      const ny = py - sy * stepLength;
      const cell = Math.round((a / 1.25) * 3) + 3;
      const glyph = (k === reach - 1 ? FROND_TIP : FROND)[Math.max(0, Math.min(6, cell))];
      const shade = l * (0.7 + u * 0.35);
      paint(r, Math.floor((px + nx) / 2), Math.floor((py + ny) / 2), glyph,
        FERN_GREEN[0] * shade, FERN_GREEN[1] * shade, FERN_GREEN[2] * shade, base);
      px = nx;
      py = ny;
    }
  }
  tipX = 0;
  tipY = 0;
  tipAt = 0.5;
  bladeRows = 0;
}

// Wind arrives in gusts: broad patches of stronger wind drift across the
// field with a quicker ripple running through them, so waves of bending
// (and of light caught by the bent blades) sweep visibly over the meadow.
// Upper segments of a rooted blade follow the same gust as its base.
export function grassWind(x, y, t, seed, rnd, rowNoise) {
  const nx = x * ASPECT;
  const sample = rowNoise ? rowNoise(nx * 0.025 - t * 0.3) :
    valueNoise(nx * 0.025 - t * 0.3, y * 0.045 + t * 0.03, seed + 900);
  const n = Math.max(0, Math.min(1, (sample - 0.5) / 0.3));
  const gust = n * n * (3 - 2 * n);
  const wave = ripple(nx * 0.025 + y * 0.011 - t * 0.33);
  return 0.25 + wave * 0.25 + gust * (2.6 + wave * 0.8) + ripple(t * 0.41 + rnd * 6.4) * 0.12;
}

export class Grass {
  constructor() {
    this.bends = new Map();
    this.previous = null;
    this.previousSword = null;
    this.tracks = new Map();
    this.previousFeet = new Map();
    this.parts = new Map();
    this.touched = [];
    this.prepared = null;
    this.field = null;
  }

  bendAt(x, y, t) {
    return this.effectAt(x, y, t, 'lean');
  }

  pressAt(x, y, t) {
    return this.effectAt(x, y, t, 'press');
  }

  effectAt(x, y, t, field) {
    const bend = this.bends.get(`${x},${y}`);
    // A short hold followed by a smooth, critically damped spring-back.
    const age = bend ? Math.max(0, t - bend.t - HOLD) : 0;
    const transient = bend && t - bend.t < LIFE ? (1 + age * 5) * Math.exp(-age * 5) : 0;
    const track = this.tracks.get(`${x},${y}`);
    const lasting = this.trackRecovery(track, t);
    return (track?.press || 0) * lasting > (bend?.press || 0) * transient ?
      (track[field] || 0) * lasting : (bend?.[field] || 0) * transient;
  }

  // Body parting springs back smoothly, without the footprint's hold.
  partRecovery(part, t) {
    const age = t - part.t;
    return age < PART_LIFE ? (1 + age * PART_SPRING) * Math.exp(-age * PART_SPRING) : 0;
  }

  trackRecovery(track, t) {
    if (!track) return 0;
    const u = Math.max(0, Math.min(1, (t - track.until) / track.recover));
    return 1 - u * u * (3 - 2 * u);
  }

  update(world, player, t) {
    this.prepared = null;
    for (const [key, bend] of this.bends) {
      if (t - bend.t >= LIFE) this.bends.delete(key);
    }
    for (const [key, track] of this.tracks) {
      if (t - track.t > TRACK_MEMORY) this.tracks.delete(key);
    }
    for (const [key, part] of this.parts) {
      if (t - part.t >= PART_LIFE) this.parts.delete(key);
    }
    this.part(world, player, t);
    const prev = this.previous;
    this.previous = { x: player.x, y: player.y, air: player.air, t };
    // A sword wake follows the animated blade's swept ground footprint,
    // including the strip between frames. Idle/drawn swords produce no wake.
    const sword = player.swordSweep;
    const lastSword = this.previousSword;
    this.previousSword = sword;
    if (sword && player.air < 0.25 && (!lastSword || sword.t !== lastSword.t)) {
      this.disturb(world, sword.hx, sword.hy, sword.tx, sword.ty, 2.4, t, 0, 1);
      if (lastSword && sword.t - lastSword.t < 0.12 &&
        Math.hypot((sword.hx - lastSword.hx) * ASPECT, sword.hy - lastSword.hy) < 8) {
        const push = Math.sign(sword.tx - lastSword.tx);
        for (let i = 0; i <= 4; i++) {
          const u = i / 4;
          this.disturb(world,
            lastSword.hx + (lastSword.tx - lastSword.hx) * u,
            lastSword.hy + (lastSword.ty - lastSword.hy) * u,
            sword.hx + (sword.tx - sword.hx) * u,
            sword.hy + (sword.ty - sword.hy) * u, 2.4, t, push, 1);
        }
      }
    }
    // Only grounded boot soles touch grass. Sweep each planted sole, not the
    // character's centre, so the untouched ground between/beside steps stays up.
    const elapsed = prev ? Math.max(0, t - prev.t) : 0;
    const continuous = prev && !prev.air && !player.air && Math.hypot((player.x - prev.x) * ASPECT / SCALE,
      (player.y - prev.y) / (SCALE * TILT)) <= 3.5 * Math.min(elapsed, 0.1) + 0.05;
    const oldFeet = this.previousFeet;
    this.previousFeet = new Map();
    for (const foot of player.feet || []) {
      this.previousFeet.set(foot.id, foot);
      if (player.air > 0 || !foot.grounded) continue;
      const old = oldFeet.get(foot.id);
      const from = continuous && old?.grounded && old.plant === foot.plant ? old : null;
      const direction = continuous ? Math.sign(player.x - prev.x) : 0;
      this.trample(world, foot, from, t, direction);
    }
  }

  // Blades lean away from the body and sink beneath it, leaving a darker
  // hollow the figure stands out against. Entries are refreshed while the
  // body is near, so walking leaves a parted wake that slowly stands back up.
  part(world, player, t) {
    if (player.air > 0.3) return;
    this.prepared = null;
    this.contactRoots(world, player.x, player.y, player.x, player.y, BODY_RADIUS,
      BODY_RADIUS / BODY_DEPTH, (x, y, rnd, side, weight) => {
        const key = `${x},${y}`;
        const old = this.parts.get(key);
        if (old && old.sink * this.partRecovery(old, t) > weight * weight) return;
        const lean = (Math.sign(side) || (rnd < 0.5 ? -1 : 1)) * weight * 3.2;
        this.parts.delete(key);
        this.parts.set(key, { x, y, lean, sink: weight * weight, t });
        if (this.parts.size > MAX_PARTS) this.parts.delete(this.parts.keys().next().value);
      });
  }

  trample(world, foot, from, t, direction) {
    this.prepared = null;
    const stamp = (ax, ay, bx, by) => this.contactRoots(world, ax, ay, bx, by,
      SOLE_RADIUS, 1 / TILT, (x, y, rnd, side, weight) => {
        const key = `${x},${y}`;
        const old = this.tracks.get(key);
        const lastPlant = old?.plants[foot.id];
        const fresh = lastPlant?.id !== foot.plant;
        const added = fresh ? weight : Math.max(0, weight - lastPlant.weight);
        const wear = Math.min(10, (fresh && old ? old.wear * Math.exp(-(t - old.passAt) / 30) : old?.wear || 0) + added);
        const pressure = Math.max(old ? old.press * this.trackRecovery(old, t) : 0, 0.75 + weight * 0.25);
        const plants = old?.plants || {};
        plants[foot.id] = { id: foot.plant, weight: fresh ? weight : Math.max(weight, lastPlant.weight) };
        const lean = (direction || Math.sign(side) || (rnd < 0.5 ? -1 : 1)) * pressure;
        this.tracks.delete(key);
        this.tracks.set(key, { x, y, press: pressure, lean, wear, plants, t,
          passAt: added > 0 ? t : old.passAt, until: t + 2 + wear * 1.15, recover: 1.7 + wear * 0.4 });
        if (this.tracks.size > MAX_TRACKS) this.tracks.delete(this.tracks.keys().next().value);
      });
    stamp(foot.hx, foot.hy, foot.tx, foot.ty);
    if (from) {
      // Corresponding points cover the thin strip swept by a sliding sole.
      for (let i = 0; i <= 2; i++) {
        const u = i / 2;
        stamp(from.hx + (from.tx - from.hx) * u, from.hy + (from.ty - from.hy) * u,
          foot.hx + (foot.tx - foot.hx) * u, foot.hy + (foot.ty - foot.hy) * u);
      }
    }
  }

  disturb(world, ax, ay, bx, by, radius, t, push, strength) {
    this.prepared = null;
    this.contactRoots(world, ax, ay, bx, by, radius, 1, (x, y, rnd, side, weight) => {
      const press = weight * strength;
      const lean = ((Math.sign(side) || (rnd < 0.5 ? -1 : 1)) + push) * press;
      const key = `${x},${y}`;
      const old = this.bends.get(key);
      if (old?.t === t && old.press > press) return;
      this.bends.delete(key);
      this.bends.set(key, { x, y, lean, press, t });
      if (this.bends.size > MAX_BENDS) this.bends.delete(this.bends.keys().next().value);
    });
  }

  contactRoots(world, ax, ay, bx, by, radius, yScale, visit) {
    const dx = (bx - ax) * ASPECT;
    const dy = (by - ay) * yScale;
    const length2 = dx * dx + dy * dy;
    for (let y = Math.floor(Math.min(ay, by) - radius / yScale);
      y <= Math.ceil(Math.max(ay, by) + radius / yScale); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - radius / ASPECT);
        x <= Math.ceil(Math.max(ax, bx) + radius / ASPECT); x++) {
        const { c, i } = world.locate(x, y);
        // Bare gaps have no stalk to part or trample into a visible mat.
        if (!c.grassHeight[i] || c.blades?.present?.[i] === 0) continue;
        const px = (x + 0.5 - ax) * ASPECT;
        const py = (y + 0.5 - ay) * yScale;
        const u = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
        const side = px - u * dx;
        const distance2 = side * side + (py - u * dy) ** 2;
        if (distance2 >= radius * radius) continue;
        visit(x, y, c.rnd[i], side, Math.sqrt(1 - distance2 / (radius * radius)));
      }
    }
  }

  drawTracks(r, view, t) {
    for (const track of this.tracks.values()) {
      const sx = track.x - view.x0;
      const sy = track.y - view.y0;
      if (sx < 0 || sy < 0 || sx >= view.cols || sy >= view.rows) continue;
      const pressure = track.press * this.trackRecovery(track, t);
      if (pressure < 0.1) continue;
      const o = (sy * r.cols + sx) * 4;
      const mat = 1 - (1 - pressure) ** 3;
      const texture = Math.abs(track.x * 7 + track.y * 13) % MATTED.length;
      for (let c = 0; c < 3; c++) {
        r.fg[o + c] += (MAT[c] * 0.5 - r.fg[o + c]) * mat * 0.55;
        r.ov[o + c] += (MAT[c] * 0.5 - r.ov[o + c]) * mat * 0.55;
        // The compressed bed is dark; exposed, horizontal leaf surfaces
        // catch the moonlight and make the walked route easy to read.
        r.bg[o + c] *= 1 - mat * 0.3;
      }
      if (pressure > 0.45) r.setGlyph(o / 4, MATTED[texture]);
    }
  }

  // Resolve the small set of contacts once per frame. Blades and their
  // overhanging strokes then use array reads instead of constructing strings
  // and looking up Maps for every segment, twice (scene and reflection).
  prepare(view, t) {
    const pad = SIDE_PAD + MAX_GRASS_HEIGHT;
    const x0 = view.x0 - pad;
    const y0 = view.y0 - pad;
    const cols = view.cols + pad * 2;
    const rows = view.rows + pad * 2;
    const prev = this.prepared;
    if (prev && prev.t === t && prev.x0 === x0 && prev.y0 === y0 &&
      prev.cols === cols && prev.rows === rows) return;
    const length = cols * rows;
    if (!this.field || this.field.press.length < length) {
      this.field = { press: new Float64Array(length), lean: new Float64Array(length),
        tracks: new Float64Array(length), part: new Float64Array(length), sink: new Float64Array(length) };
    }
    if (!this.field.matted || this.field.matted.length < rows + 1) this.field.matted = new Int32Array(rows + 1);
    const { press, lean, tracks, part, sink, matted } = this.field;
    // Contacts only ever touch a few of these cells: clear just those.
    const touched = this.touched;
    for (const i of touched) {
      press[i] = 0;
      lean[i] = 0;
      tracks[i] = 0;
      part[i] = 0;
      sink[i] = 0;
    }
    touched.length = 0;
    for (const entry of this.parts.values()) {
      const x = entry.x - x0;
      const y = entry.y - y0;
      const recovery = this.partRecovery(entry, t);
      if (x < 0 || x >= cols || y < 0 || y >= rows || recovery < 0.02) continue;
      part[y * cols + x] = entry.lean * recovery;
      sink[y * cols + x] = entry.sink * recovery;
      touched.push(y * cols + x);
    }
    for (const bend of this.bends.values()) {
      const x = bend.x - x0;
      const y = bend.y - y0;
      if (x < 0 || x >= cols || y < 0 || y >= rows || t - bend.t >= LIFE) continue;
      const age = Math.max(0, t - bend.t - HOLD);
      const recovery = (1 + age * 5) * Math.exp(-age * 5);
      const i = y * cols + x;
      press[i] = bend.press * recovery;
      lean[i] = bend.lean * recovery;
      touched.push(i);
    }
    matted.fill(0, 0, rows + 1);
    for (const track of this.tracks.values()) {
      const x = track.x - x0;
      const y = track.y - y0;
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const i = y * cols + x;
      const recovery = this.trackRecovery(track, t);
      tracks[i] = track.press * recovery;
      touched.push(i);
      if (tracks[i] > 0.45) matted[y + 1] = 1;
      if (tracks[i] > press[i]) {
        press[i] = tracks[i];
        lean[i] = track.lean * recovery;
      }
    }
    // Running count of rows holding a matted footprint, so a row of roots
    // can tell in O(1) whether any of its strokes might cross one.
    for (let y = 0; y < rows; y++) matted[y + 1] += matted[y];
    this.prepared = { x0, y0, cols, rows, t };
  }

  drawRow(r, world, view, t, y, write = putCell) {
    // A reflected row with no water anywhere below it can skip every root.
    if (write.visible && !write.visible(r, -SIDE_PAD, y - view.y0 - MAX_GRASS_HEIGHT,
      view.cols + SIDE_PAD, y - view.y0, y - view.y0)) return;
    this.prepare(view, t);
    const field = this.field;
    const grid = this.prepared;
    const cy = Math.floor(y / CHUNK_SIZE);
    // Overhanging ASCII strokes must not paint an upright stalk back across
    // a matted footprint. This uses the existing, world-anchored sole marks
    // and is shared by the normal and reflected views.
    const top = Math.max(0, y - grid.y0 - MAX_GRASS_HEIGHT);
    const bottom = Math.min(grid.rows, y - grid.y0 + 1);
    const crossed = bottom > top && field.matted[bottom] > field.matted[top];
    const paint = !crossed ? write : (renderer, sx, sy, ch, cr, cg, cb, base) => {
      const wx = sx + view.x0;
      const wy = sy + view.y0;
      const pressure = field.tracks[(wy - grid.y0) * grid.cols + wx - grid.x0] || 0;
      if (pressure > 0.45) {
        // Flowers and seed heads do not stand back up through a mat.
        if (ch & LAYER) return;
        ch = MATTED[Math.abs(wx * 7 + wy * 13) % MATTED.length];
        const blend = pressure * 0.6;
        cr += (MAT[0] * 0.5 - cr) * blend;
        cg += (MAT[1] * 0.5 - cg) * blend;
        cb += (MAT[2] * 0.5 - cb) * blend;
      }
      write(renderer, sx, sy, ch, cr, cg, cb, base);
    };
    const left = view.x0 - SIDE_PAD;
    const right = view.x0 + view.cols + SIDE_PAD;
    const windNoise = valueNoiseRow(y * 0.045 + t * 0.03, world.seed + 900);
    for (let cx = Math.floor(left / CHUNK_SIZE); cx <= Math.floor((right - 1) / CHUNK_SIZE); cx++) {
      const chunk = world.chunk(cx, cy);
      const row = y - cy * CHUNK_SIZE;
      const blades = chunk.blades;
      const first = blades ? blades.rows[row] : row * CHUNK_SIZE;
      const last = blades ? blades.rows[row + 1] : (row + 1) * CHUNK_SIZE;
      for (let root = first; root < last; root++) {
        const i = blades ? blades.indices[root] : root;
        const x = cx * CHUNK_SIZE + i % CHUNK_SIZE;
        if (x < left || x >= right) continue;
        const rnd = chunk.rnd[i];
        const style = chunk.grassStyle[i];
        if (!blades) {
          const density = (chunk.grassDensity?.[i] ?? 0.26) * (style === 1 ? 0.72 : style === 4 ? 0.85 : 1);
          if (chunk.grassHeight[i] < 2 || rnd < 1 - density) continue;
        }
        const height = blades ? blades.heights[root] : Math.min(MAX_PROFILE,
          Math.floor(chunk.grassHeight[i] + hash2(x, y, world.seed + 1101)));
        const base = y - view.y0;
        const fi = (y - grid.y0) * grid.cols + x - grid.x0;
        const press = field.press[fi];
        const sink = field.sink[fi];
        // Blades lying down reach further sideways than upright ones lean
        // (at most seven columns, plus a flower cluster's petal).
        const span = press > 0.3 || sink > 0.3 ? SIDE_PAD : 9;
        if (write.visible ? !write.visible(r, x - view.x0 - span, base - MAX_GRASS_HEIGHT,
          x - view.x0 + span, base, base) : x - view.x0 + span < 0 || x - view.x0 - span >= view.cols ||
          base - Math.ceil(height * BLADE_LENGTH * 1.08) - 1 >= view.rows) continue;
        const variation = blades ? blades.variations[root] : hash2(x, y, world.seed + 1217);
        const bend = field.lean[fi];
        const wind = grassWind(x, y, t, world.seed, rnd, windNoise);
        // Each blade has its own resting angle, so neighbours cross and fan.
        const jitter = (rnd * 7919) % 1;
        // Few stand quite upright; most lean ten to thirty degrees.
        const tilt = (variation - 0.5) * 2;
        // Contact overrides the resting angle: a parted blade leans away.
        const bent = Math.max(press, sink * 0.55);
        const curve = (Math.sign(tilt) * (0.3 + Math.abs(tilt) * 0.7) * (style === 2 ? 4.4 : 3.6) +
          (jitter - 0.5) * 2) * (1 - Math.max(press, sink));
        const flat = 1 - (1 - Math.min(1, bent)) ** 3;
        const lean = Math.max(-7, Math.min(7, (wind * Math.min(1.3, height * 0.35) * (1 - flat) +
          curve + bend * (1.4 + height * 0.45) + field.part[fi]) * BLADE_LENGTH));
        // Gusts lay blades over to show their lit sides; the parted hollow
        // under a figure stays in shadow.
        const light = (0.62 + chunk.shade[i] * 0.6 + Math.max(0, wind - 0.6) * 0.1) *
          (0.82 + variation * 0.36) * (1 - sink * 0.8);
        let tone = PALETTES[style];
        if (blades) {
          const k = root * 3;
          TONE[0] = blades.tones[k];
          TONE[1] = blades.tones[k + 1];
          TONE[2] = blades.tones[k + 2];
          tone = TONE;
        }
        const length = height * BLADE_LENGTH * (0.78 + jitter * 0.3);
        const extra = blades ? blades.extras[root] :
          extraAt(x, y, world.seed, style, height, chunk.elev?.[i] ?? 0.55, chunk.shade[i], variation);
        const flower = blades ? blades.flowers[root] : 0;
        if (extra === FERN) {
          drawFern(r, view, paint, x, y, height, lean, flat, light, variation);
          continue;
        }
        // Most roots are tufts: a second, shorter blade crosses the first
        // (a flower's stalk stands alone). Ripples break reflections up too
        // much for it to show there. It is drawn first so the main blade's
        // tip, and whatever flowers on it, stay on top.
        if ((style === 1 || jitter > 0.5) && !write.visible && !flower) {
          const fan = Math.max(-7, Math.min(7, lean + (variation < 0.5 ? 4 : -4) * (1 - press * 0.7)));
          drawBlade(r, view, paint, x, y, Math.max(2, length * (0.75 + jitter * 0.2)), fan, flat, light * 0.85,
            tone, (jitter - 0.5) * 0.4);
        }
        if (flower) {
          // A flower's own stalk is thin, darker and a little yellower.
          STALK[0] = tone[0] * 0.95 + 6;
          STALK[1] = tone[1] * 0.85;
          STALK[2] = tone[2] * 0.6;
          drawBlade(r, view, paint, x, y, length, lean, flat, light, STALK, (variation - 0.5) * 0.4, true);
        } else {
          drawBlade(r, view, paint, x, y, length, lean, flat, light, tone, (variation - 0.5) * 0.4);
        }
        if (flower) {
          const glow = (0.78 + chunk.shade[i] * 0.35 + variation * 0.2) * (1 - sink * 0.45) * (1 - flat * 0.4);
          drawFlower(r, paint, SPECIES[flower], base, glow, flat, variation);
        } else if (extra && flat < 0.5) {
          if (extra === DEW) {
            // A drop on the blade's middle glints now and then as the
            // blade turns in the wind.
            const glint = ripple(t * 0.23 + variation * 7.1 + rnd * 3);
            if (bladeRows > 1 && glint > 0.5) {
              const j = bladeRows >> 1;
              const g = (glint - 0.5) * 2 * (1 - sink);
              paint(r, ROW_X[j], base - j, DEWDROPS[(variation * 40) & 3],
                DEW_LIGHT[0] * g, DEW_LIGHT[1] * g, DEW_LIGHT[2] * g, base);
            }
          } else if (extra === CATTAIL) {
            const l = light * 0.9;
            paint(r, tipX, tipY, CATTAIL_HEAD[place(tipAt)], CATTAIL_BROWN[0] * l, CATTAIL_BROWN[1] * l, CATTAIL_BROWN[2] * l, base);
          } else {
            const l = light * (0.85 + variation * 0.3);
            paint(r, tipX, tipY, SEEDS[extra - 1][place(tipAt)], (STRAW[0] * 0.7 + tone[0] * 0.3) * l,
              (STRAW[1] * 0.7 + tone[1] * 0.3) * l, (STRAW[2] * 0.7 + tone[2] * 0.3) * l, base);
          }
        }
      }
    }
  }

  drawReflections(r, world, view, t, write, drawables = []) {
    if (!r.mask.includes(WATER)) return;
    this.drawRows(r, world, view, t, view.y0 - MAX_GRASS_HEIGHT - 1,
      view.y0 + view.rows, drawables, write);
  }

  // Interleave root rows with the existing small list of sorted sprites.
  // This avoids allocating and sorting a drawable for every meadow blade.
  drawLayered(r, world, view, t, drawables) {
    this.drawRows(r, world, view, t, view.y0,
      view.y0 + view.rows + MAX_GRASS_HEIGHT, drawables, putCell);
  }

  drawRows(r, world, view, t, first, last, drawables, write) {
    let i = 0;
    for (let y = first; y < last; y++) {
      while (i < drawables.length && drawables[i].y <= y + 0.5) drawables[i++].draw();
      this.drawRow(r, world, view, t, y, write);
    }
    while (i < drawables.length) drawables[i++].draw();
  }
}

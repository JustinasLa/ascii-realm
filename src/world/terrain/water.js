// Open water, built up in layers like a painting of a night lake:
//
//   the bed     - rippled sand, stones and weed, seen faintly through the
//                 shallows and fading out as the water deepens;
//   the surface - a broad slow swell drawn as long streaks and joined wave
//                 crests, with fine wavelets and glints riding over it, and
//                 caustics netting the shallow bed;
//   the edge    - lacy foam that laps in and out against the bank;
//   life        - lily pad colonies with blooms in calm shallow bays, pond
//                 skaters, bubbles off the weed, drifting leaves and fish
//                 rising in rings out in the deep.
//   the current - on rivers, long pale foam streaks carried downstream at
//                 the water's own speed, riffles over fast shallows, and
//                 the froth, V-wake and eddy a midstream stone leaves.
//
// Calm gaps are cached ground. Only scattered swell bands, the shoreline
// and surface life are reshaded, with fixed detail decided once per chunk.

import { fbm, valueNoise, valueNoiseRow } from '../../core/noise.js';
import { hash2 } from '../../core/rng.js';
import { GLYPH_COUNT, dg, family } from '../../render/glyphs.js';
import { FOAM } from '../../render/palette.js';
import { ACROSS, WIDTH, screenOrientation, toCells } from '../rivers.js';
import { ASPECT, WATER, WATER_LEVEL } from '../world.js';
import { emit } from './cell.js';
import { GLOSS_SUBMERGED, GLOSS_WET, glossByte, normalByte } from '../surface-light.js';

const N = 64;
const TAU = Math.PI * 2;
// Rings and pads lie flat on the water, so the view squashes them.
const FLAT = 0.5;
const PAD_FLAT = 0.62;

const LINE = family('water.line.');
const WAVE = family('water.wave.');
const DASH = family('water.dash.');
const CHOP = family('water.chop.');
const GLINT = family('water.glint.');
const SAND = family('water.sand.');
const STONES = family('water.stones.');
// The bed's stone glyphs: only a cell that ends up showing one is lit as a
// stone (see stoneLight).
export const STONE_GLYPH = new Uint8Array(GLYPH_COUNT);
for (const g of STONES) STONE_GLYPH[g] = 1;
const WEED = family('water.weed.');
const CAUSTIC = family('water.caustic.');
const PAD = family('water.pad.');
const PADS = family('water.pads.');
const PAD_FILL = family('water.padfill.');
const PAD_RIM = Array.from({ length: 8 }, (_, h) => [dg(`water.padrim.${h}.0`), dg(`water.padrim.${h}.1`)]);
const BLOOM = family('water.bloom.');
const SLIT = family('water.slit.');
const RING = family('water.ring.');
const PLOP = dg('water.plop');
const FOAM_CH = family('water.foam.');
const FROTH = family('water.froth.');
const BUBBLES = family('water.bubbles.');
const SKATER = family('water.skater.');
const LEAF = Array.from({ length: 8 }, (_, k) => dg(`leaf.${k}`));
const STREAK = Array.from({ length: 4 }, (_, o) => family(`water.streak.${o}.`));
const RIFFLE = family('water.riffle.');
const EDDY = family('water.eddy.');
const VEE = family('water.vee.');

// Glyphs that float on the surface and hide what the water would mirror,
// and how strongly each surface glyph catches the moon (where glitter and
// moonlight gather). Both are indexed by glyph.
export const FLOATING = new Uint8Array(GLYPH_COUNT);
for (const g of [...PAD, ...PADS, ...PAD_FILL, ...PAD_RIM.flat(), ...FOAM_CH, ...STREAK.flat(), ...VEE]) FLOATING[g] = 1;
export const SHEEN = new Float32Array(GLYPH_COUNT);
for (const g of WAVE) SHEEN[g] = 1;
for (const g of LINE) SHEEN[g] = 0.8;
for (const g of DASH) SHEEN[g] = 0.55;
for (const g of GLINT) SHEEN[g] = 0.55;
for (const g of CHOP) SHEEN[g] = 0.35;

// Colours, 0-255. The water deepens from a faintly teal navy at the bank
// to near black; moonlit crests are pale steel blue.
const BG_SHALLOW = [16, 23, 42];
const BG_DEEP = [5, 6, 19];
const TROUGH_COL = [50, 64, 112];
const CREST_COL = [146, 172, 220];
const GLINT_COL = [214, 226, 246];
const CAUSTIC_COL = [62, 96, 120];
const SAND_COL = [56, 66, 84];
const STONE_COL = [74, 82, 104];
const WEED_COL = [34, 74, 66];
const PAD_COL = [52, 98, 76];
const PAD_LIT = [92, 140, 106];
// Older pads yellow toward olive.
const PAD_OLD = [84, 94, 54];
const BLOOM_PINK = [226, 168, 204];
const BLOOM_WHITE = [214, 222, 238];
const LEAF_COL = [118, 86, 52];
const RING_COL = [150, 176, 216];

// Kinds of static cell.
const BED = 1;
const FLOAT = 2;

// River water slower than this (m/s) is drawn as calm as a lake.
const STILL = 0.04;
// Lanes of foam across a river, in layout units.
const LANE = 0.8;
// Seconds between the leaves drifting down one lane.
const LEAF_EVERY = 5;
// What a midstream stone does to the water around it.
const PILLOW = 1;
const EDDY_WAKE = 2;
const VEE_WAKE = 3;

const cache = new WeakMap();

function moving(s, i) {
  return !!((s.river && s.river[i]) || s.surface[i] || s.kind[i] === FLOAT || s.depth[i] < 0.23 || s.life[i] || s.rise[i] !== Infinity);
}

export function animated(chunk, i, wx, wy, seed) {
  return moving(statics(chunk, seed), i);
}

// Fractional part, for the repeating timers below.
const fract = (x) => x - Math.floor(x);

// Everything about a water cell that does not change from frame to frame,
// computed for a whole chunk at once and rebuilt when the chunk is edited.
let last = null;
function statics(chunk, seed) {
  const version = chunk.version ?? 0;
  // Cells arrive in runs from one chunk, so remember the last one.
  if (last?.chunk === chunk && last.version === version && last.seed === seed) return last;
  let s = cache.get(chunk);
  if (s?.version === version && s.seed === seed) return (last = s);
  const n = N * N;
  s = {
    chunk, version, seed,
    depth: new Float32Array(n),
    surface: new Uint8Array(n),
    // Sine and cosine of each cell's phase in the moving swell, wavelets
    // and lapping, so a frame only has to rotate them by the time.
    phase: new Float32Array(n * 8),
    kind: new Uint8Array(n),
    glyph: new Uint16Array(n),
    layer: new Uint16Array(n),
    col: new Uint8Array(n * 3),
    lcol: new Uint8Array(n * 3),
    bg: new Uint8Array(n * 3),
    // A nearby fish rise: distance from its middle (Infinity for none),
    // the heading of this cell from it, its period and phase.
    rise: new Float32Array(n).fill(Infinity),
    riseHeading: new Uint8Array(n),
    risePeriod: new Float32Array(n),
    risePhase: new Float32Array(n),
    // 1 bubbles rise here now and then; 2 a pond skater rests here.
    life: new Uint8Array(n),
    // A bed stone's normal, gloss and how clearly light reaches it through
    // the water, as the renderer keeps them (see surface-light.js).
    bedLit: new Uint8Array(n * 4),
    river: null,
  };
  if (chunk.flow) riverStatics(s, chunk, seed);
  const pads = new Map();
  const rises = new Map();
  for (let ly = 0; ly < N; ly++) {
    for (let lx = 0; lx < N; lx++) {
      const i = ly * N + lx;
      if (chunk.type[i] !== WATER) continue;
      const wx = chunk.cx * N + lx;
      const wy = chunk.cy * N + ly;
      const d = Math.max(0, Math.min(1, (WATER_LEVEL - chunk.elev[i]) * 12));
      s.depth[i] = d;
      const h = chunk.rnd[i];
      const xs = wx * ASPECT;
      const ph = s.phase;
      for (const [k, a] of [[0, xs * 0.4 + wy * 1.3], [2, xs * 1.7 + wy * 0.55 + h * 3],
        [4, wy * 1.9 + xs * 0.3], [6, xs * 0.5 + h * 2]]) {
        ph[i * 8 + k] = Math.sin(a);
        ph[i * 8 + k + 1] = Math.cos(a);
      }
      // Ground colour: deepening away from the bank, softly mottled.
      const m = 0.92 + (chunk.shade[i] ?? 0.5) * 0.16;
      const deep = d ** 0.7;
      for (let c = 0; c < 3; c++) s.bg[i * 3 + c] = (BG_SHALLOW[c] + (BG_DEEP[c] - BG_SHALLOW[c]) * deep) * m;

      // Long, irregular bands of ripples with quiet water between them.
      // World coordinates keep the bands joined across chunk boundaries.
      s.surface[i] = valueNoise(xs * 0.05, wy * 0.32, seed + 1601) > 0.6 ? 1 : 0;

      const river = s.river?.[i];
      if (!river && d > 0.06 && d < 0.95 && placePad(s, i, wx, wy, seed, pads)) continue;

      // The bed shows through the shallows, fading with depth.
      if (d > 0.03 && d < 0.5) {
        const see = (1 - d / 0.5) ** 1.3;
        const weed = valueNoise(xs * 0.07, wy * 0.11, seed + 1302);
        const stones = valueNoise(xs * 0.12, wy * 0.2, seed + 1301);
        const pick = hash2(wx, wy, seed + 1303);
        let g = 0;
        let col = SAND_COL;
        let k = see;
        // Weed only takes root where the water is slow.
        if (weed > 0.6 && d > 0.12 && (!river || s.rSpeed[i] < 0.15)) {
          g = WEED[Math.floor(pick * WEED.length)];
          col = WEED_COL;
          k *= 0.7 + (weed - 0.6) * 1.5;
          if (pick < 0.08 && !river) s.life[i] = 1;
        } else if (stones > (river ? 0.7 : 0.6) || pick < (river ? 0.1 : 0.06)) {
          // River beds are gravelly.
          g = STONES[Math.floor(pick * 97) % STONES.length];
          col = STONE_COL;
          bedNormal(s, i, wx, wy, xs, stones, d, see, seed);
        } else if (pick < 0.55) {
          g = SAND[Math.floor(pick * 31) % SAND.length];
          k *= 0.75;
        }
        if (g) {
          s.kind[i] = BED;
          s.glyph[i] = g;
          for (let c = 0; c < 3; c++) s.col[i * 3 + c] = s.bg[i * 3 + c] + (col[c] - s.bg[i * 3 + c]) * k;
        }
        // Pond skaters keep to calm, shallow water.
        if (d > 0.1 && d < 0.35 && h < 0.006 && !river) s.life[i] = 2;
      }
      // Fish rise only in a river's slow, deep pools.
      if (d > 0.3 && (!river || s.rSpeed[i] < 0.12)) placeRise(s, i, wx, wy, seed, rises);
    }
  }
  cache.set(chunk, s);
  return (last = s);
}

// A bed stone faces the way the stony bed slopes, tipped further by a
// little jitter so neighbouring pebbles turn different ways.
const BED_SLOPE = 6;
const BED_TILT = 1;
// Light reaching a stone through the water fades with depth as the stone's
// own colour does, but never below this share.
const CLEAR_MIN = 0.45;
const WET_GLOSS = glossByte(GLOSS_WET);
const SUBMERGED_GLOSS = glossByte(GLOSS_SUBMERGED);
function bedNormal(s, i, wx, wy, xs, h, d, see, seed) {
  const hx = valueNoise((xs + 1) * 0.12, wy * 0.2, seed + 1301) - h;
  const hy = valueNoise(xs * 0.12, (wy + 1) * 0.2, seed + 1301) - h;
  const nx = -hx * BED_SLOPE + (hash2(wx, wy, seed + 1304) - 0.5) * BED_TILT;
  const ny = -hy * BED_SLOPE + (hash2(wy, wx, seed + 1305) - 0.5) * BED_TILT;
  const k = Math.hypot(nx, ny, 1);
  const o = i * 4;
  s.bedLit[o] = normalByte(nx / k);
  s.bedLit[o + 1] = normalByte(ny / k);
  // A stone breaking the surface is wet; one under it glossy but dimmed.
  s.bedLit[o + 2] = d < 0.12 ? WET_GLOSS : SUBMERGED_GLOSS;
  s.bedLit[o + 3] = Math.round(255 * (CLEAR_MIN + (1 - CLEAR_MIN) * see));
}

// Tells the renderer how a bed cell faces the light: as its stone, if the
// glyph it ended up showing is the stone, else not at all (sand, weed, or
// foam or a wavelet over the stone, which take light evenly).
function stoneLight(out, o, s, i) {
  const lit = out.cellLit;
  if (!lit) return;
  const g = out.fg[o + 3] | ((out.bg[o + 3] & 15) << 8);
  if (!STONE_GLYPH[g]) {
    lit[o + 2] = 0;
    return;
  }
  const b = i * 4;
  lit[o] = s.bedLit[b];
  lit[o + 1] = s.bedLit[b + 1];
  lit[o + 2] = s.bedLit[b + 2];
  lit[o + 3] = s.bedLit[b + 3];
}

// What the current needs to draw a river cell, fixed per cell: which way
// its foam lies on screen, its lane across the river, the travel time of
// the water along its own line, how much of that one cell spans, its speed
// and place across the stream, and any stone it flows past. The way, pace
// and travel time are those of the water's own line through the middle of
// the cell, exactly as world.flowAt gives them there, so the foam and the
// leaves keep to the current that carries bodies and splashes.
const FLOW = { x: 0, y: 0, speed: 0, tau: 0 };
function riverStatics(s, chunk, seed) {
  const n = N * N;
  const f = chunk.flow;
  s.river = new Uint8Array(n);
  s.rOrient = new Uint8Array(n);
  s.rLane = new Int32Array(n);
  s.rPeriod = new Float32Array(n);
  s.rLen = new Float32Array(n);
  s.rDensity = new Float32Array(n);
  s.rTau = new Float32Array(n);
  s.rSpan = new Float32Array(n);
  s.rSpeed = new Float32Array(n);
  s.rAcross = new Float32Array(n);
  s.rOuter = new Float32Array(n);
  s.rWake = new Uint8Array(n);
  s.rWakeGlyph = new Uint16Array(n);
  s.rWakeK = new Float32Array(n);
  const stones = chunk.riverStones ?? [];
  for (let i = 0; i < n; i++) {
    if (chunk.type[i] !== WATER || !f.river[i]) continue;
    const wx = chunk.cx * N + (i & 63);
    const wy = chunk.cy * N + (i >> 6);
    chunk.rivers.lineAt(wx + 0.5, wy + 0.5, FLOW);
    if (FLOW.speed < STILL) continue;
    s.river[i] = 1;
    const q = f.across[i] / ACROSS;
    const half = f.width[i] / WIDTH;
    const bend = f.bend[i] / 255;
    // Lanes of foam lie along the current, each with its own run of
    // streaks; every cell of a lane times them by its own water.
    const across = Math.floor(q * half / LANE);
    const lane = across + 64 + f.river[i] * 131;
    const h = hash2(lane, f.river[i], seed + 1700);
    s.rOrient[i] = screenOrientation(FLOW.x, FLOW.y);
    s.rLane[i] = lane;
    s.rPeriod[i] = 1.6 + h * 1.4;
    s.rLen[i] = 0.3 + hash2(lane, 7, seed + 1703) * 0.2;
    // Foam gathers mid-channel and breaks up on bends.
    s.rDensity[i] = (0.8 - 0.3 * Math.abs(q)) * (1 - 0.5 * bend);
    s.rTau[i] = FLOW.tau;
    s.rSpeed[i] = FLOW.speed;
    s.rAcross[i] = q;
    // The water's travel time across this one cell, along the flow.
    const c = toCells(FLOW.x, FLOW.y);
    s.rSpan[i] = 1 / Math.max(Math.abs(c.cols), Math.abs(c.rows), 1e-6) / FLOW.speed;
    // The outer bank of a bend froths; the inner bank stays quiet.
    const secondary = f.secondary[i] / 127;
    s.rOuter[i] = Math.sign(secondary) === Math.sign(q) && Math.abs(q) > 0.55 ? Math.abs(secondary) : 0;
    // Water piles up in front of a stone, opens into a V behind it and
    // curls into a calm eddy in its lee.
    const lx = toCellsLayout(FLOW.x, FLOW.y);
    for (const stone of stones) {
      const ox = (wx + 0.5 - stone.x) * ASPECT;
      const oy = wy + 0.5 - stone.y;
      const along = ox * lx.x + oy * lx.y;
      const side = oy * lx.x - ox * lx.y;
      const r = stone.r;
      if (along < -2.2 * r || along > 4.5 * r || Math.abs(side) > 2.5 * r) continue;
      if (along < -0.5 * r && along > -1.9 * r && Math.abs(side) < r) {
        s.rWake[i] = PILLOW;
        s.rWakeK[i] = 1 - Math.abs(side) / r * 0.5;
      } else if (along > 0.4 * r && along < 2.2 * r && Math.abs(side) < 0.75 * r) {
        s.rWake[i] = EDDY_WAKE;
        s.rWakeGlyph[i] = EDDY[Math.floor(hash2(wx, wy, seed + 1704) * EDDY.length)];
        s.rDensity[i] = 0;
      } else if (along > 0.3 * r) {
        // The arms spread from the stone's sides at about 20 degrees.
        const arm = 0.85 * r + along * 0.36;
        if (Math.abs(Math.abs(side) - arm) < 0.55) {
          const sign = Math.sign(side) || 1;
          const ax = lx.x + -lx.y * sign * 0.36;
          const ay = lx.y + lx.x * sign * 0.36;
          s.rWake[i] = VEE_WAKE;
          s.rWakeGlyph[i] = VEE[layoutOrientation(ax, ay)];
          s.rWakeK[i] = Math.max(0, 1 - along / (4.5 * r));
        }
      }
    }
  }
}

// A ground direction as a unit step in layout space, and the screen
// direction (as for foam) of a layout step.
function toCellsLayout(gx, gy) {
  const c = toCells(gx, gy);
  const x = c.cols * ASPECT;
  const l = Math.hypot(x, c.rows) || 1;
  return { x: x / l, y: c.rows / l };
}

function layoutOrientation(x, y) {
  let a = Math.atan2(y, x);
  if (a < 0) a += Math.PI;
  return [0, 3, 2, 1][Math.round(a / (Math.PI / 4)) % 4];
}

// Each frame's rotations of the swell, wavelet and lapping phases.
let clock = NaN;
const turn = new Float32Array(8);
function tick(t) {
  clock = t;
  for (const [k, a] of [[0, t * 1.2], [2, -t * 2.1], [4, t * 1.3], [6, t * 1.8]]) {
    turn[k] = Math.sin(a);
    turn[k + 1] = Math.cos(a);
  }
}

// Lily pads grow in colonies, scattered on a jittered grid so neighbours
// never stack exactly; a few are big enough to span several cells.
const PAD_GX = 5;
const PAD_GY = 3;
function padAt(gx, gy, seed, pads) {
  const key = gx * 100003 + gy;
  if (pads.has(key)) return pads.get(key);
  let pad = null;
  const x = (gx + 0.15 + 0.7 * hash2(gx, gy, seed + 1202)) * PAD_GX;
  const y = (gy + 0.15 + 0.7 * hash2(gx, gy, seed + 1203)) * PAD_GY;
  const colony = valueNoise(x * ASPECT * 0.035, y * 0.06, seed + 1204);
  if (colony > 0.5 && hash2(gx, gy, seed + 1201) < (colony - 0.5) * 4) {
    const d = (WATER_LEVEL - fbm(x * ASPECT * 0.011, y * 0.011, seed, 5)) * 12;
    if (d > 0.08 && d < 0.85) {
      const size = hash2(gx, gy, seed + 1205);
      const bloom = hash2(gx, gy, seed + 1206);
      pad = {
        x, y,
        r: 0.5 + size * size * 1.5,
        notch: hash2(gx, gy, seed + 1207) * TAU,
        tone: 0.8 + hash2(gx, gy, seed + 1208) * 0.35,
        bloom: bloom < 0.3 ? BLOOM[bloom < 0.16 ? 0 : bloom < 0.24 ? 1 : 2] : 0,
        white: hash2(gx, gy, seed + 1209) < 0.4,
        small: size,
        age: hash2(gx, gy, seed + 1210) * 0.6,
      };
    }
  }
  pads.set(key, pad);
  return pad;
}

function placePad(s, i, wx, wy, seed, pads) {
  const gx0 = Math.floor(wx / PAD_GX);
  const gy0 = Math.floor(wy / PAD_GY);
  let best = null;
  let bestQ = 1.35;
  let bx = 0;
  let by = 0;
  for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) {
    for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
      const pad = padAt(gx, gy, seed, pads);
      if (!pad) continue;
      const dx = (wx + 0.5 - pad.x) * ASPECT;
      const dy = wy + 0.5 - pad.y;
      const q = Math.hypot(dx, dy / PAD_FLAT) / pad.r;
      if (q < bestQ) { best = pad; bestQ = q; bx = dx; by = dy; }
    }
  }
  if (!best) return false;
  const centre = Math.floor(best.x) === wx && Math.floor(best.y) === wy;
  let g;
  let lit = 0.9;
  let slit = false;
  if (best.r < 0.8) {
    // A small pad sits whole in the cell holding its middle.
    if (!centre) return false;
    g = best.r < 0.6 ? PADS[Math.floor(best.small * 1e3) % PADS.length] : PAD[Math.floor(best.small * 1e4) % PAD.length];
  } else {
    const a = Math.atan2(by, bx);
    // The notch: a slit from the middle out to the rim.
    let off = Math.abs(a - best.notch) % TAU;
    if (off > Math.PI) off = TAU - off;
    slit = off < 0.4 && bestQ > 0.2;
    const heading = ((Math.round(a / (TAU / 8)) % 8) + 8) % 8;
    // How far the rim lies beyond this cell's middle, against how far the
    // cell itself reaches that way (it is 0.6 wide and 1 tall).
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const r = Math.hypot(bx, by);
    const margin = best.r / Math.sqrt(c * c + (sn * sn) / (PAD_FLAT * PAD_FLAT)) - r;
    const reach = Math.abs(c) * 0.3 + Math.abs(sn) * 0.5;
    if (centre || margin > reach) g = PAD_FILL[Math.floor(hash2(wx, wy, seed + 1211) * 8)];
    else if (margin > 0.04) g = PAD_RIM[heading][0];
    else if (margin > -0.2) g = PAD_RIM[heading][1];
    else return false;
    // The rim facing the moon (upper left) is lit; the far rim is in shade.
    if (g !== PAD_RIM[heading][0] && g !== PAD_RIM[heading][1]) lit = 0.88;
    else lit = 0.8 + 0.32 * Math.max(0, Math.cos(a + 2.36));
  }
  s.kind[i] = FLOAT;
  s.glyph[i] = g;
  const k = best.tone * lit;
  for (let c = 0; c < 3; c++) {
    const base = PAD_COL[c] + (PAD_OLD[c] - PAD_COL[c]) * best.age;
    s.col[i * 3 + c] = (base + (PAD_LIT[c] - base) * (lit - 0.82) * 3.5) * k;
  }
  if (slit) {
    s.layer[i] = SLIT[((Math.round(best.notch / (TAU / 8)) % 8) + 8) % 8];
    for (let c = 0; c < 3; c++) s.lcol[i * 3 + c] = s.bg[i * 3 + c];
  } else if (centre && best.bloom) {
    s.layer[i] = best.bloom;
    const b = best.white ? BLOOM_WHITE : BLOOM_PINK;
    for (let c = 0; c < 3; c++) s.lcol[i * 3 + c] = b[c] * 0.86;
  }
  return true;
}

// Now and then a fish rises in deep water and a ring spreads from it.
const RISE_GX = 22;
const RISE_GY = 12;
const RISE_REACH = 3.6;
function riseAt(gx, gy, seed, rises) {
  const key = gx * 100003 + gy;
  if (rises.has(key)) return rises.get(key);
  let rise = null;
  if (hash2(gx, gy, seed + 1401) < 0.55) {
    rise = {
      x: (gx + 0.2 + 0.6 * hash2(gx, gy, seed + 1402)) * RISE_GX,
      y: (gy + 0.2 + 0.6 * hash2(gx, gy, seed + 1403)) * RISE_GY,
      period: 6 + hash2(gx, gy, seed + 1404) * 12,
      phase: hash2(gx, gy, seed + 1405) * 100,
    };
  }
  rises.set(key, rise);
  return rise;
}

function placeRise(s, i, wx, wy, seed, rises) {
  const gx0 = Math.floor(wx / RISE_GX);
  const gy0 = Math.floor(wy / RISE_GY);
  for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) {
    for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
      const rise = riseAt(gx, gy, seed, rises);
      if (!rise) continue;
      const dx = (wx + 0.5 - rise.x) * ASPECT;
      const dy = (wy + 0.5 - rise.y) / FLAT;
      const dist = Math.hypot(dx, dy);
      if (dist >= RISE_REACH || dist >= s.rise[i]) continue;
      s.rise[i] = dist;
      // The ring's outward normal; on the squashed ellipse it tips toward
      // the vertical.
      const a = Math.atan2(dy / FLAT, dx);
      s.riseHeading[i] = ((Math.round(a / (TAU / 8)) % 8) + 8) % 8;
      s.risePeriod[i] = rise.period;
      s.risePhase[i] = rise.phase;
    }
  }
}

let swellRow;
let swellY, swellTime, swellSeed;

export function shade(out, o, chunk, i, wx, wy, seed, t, wind = 0) {
  const s = statics(chunk, seed);
  const i3 = i * 3;
  const p8 = i * 8;
  const ph = s.phase;
  let bgR = s.bg[i3];
  let bgG = s.bg[i3 + 1];
  let bgB = s.bg[i3 + 2];
  const kind = s.kind[i];
  const rnd = chunk.rnd[i];

  // No wave, shore foam or nearby life: preserve the bed and skip the
  // animated noise, trigonometry and drifting-leaf lookups entirely.
  if (!moving(s, i)) {
    emit(out, o, s.glyph[i], s.col[i3], s.col[i3 + 1], s.col[i3 + 2], bgR, bgG, bgB);
    if (kind === BED) stoneLight(out, o, s, i);
    return;
  }
  if (t !== clock) tick(t);
  if (s.river && s.river[i]) {
    shadeRiver(out, o, s, chunk, i, wx, wy, seed, t, bgR, bgG, bgB);
    return;
  }

  // Floating pads ride the swell with a slow sheen and keep their blooms.
  if (kind === FLOAT) {
    const k = 0.94 + 0.08 * Math.sin(t * 0.7 + rnd * 40);
    emit(out, o, s.glyph[i], s.col[i3] * k, s.col[i3 + 1] * k, s.col[i3 + 2] * k, bgR, bgG, bgB,
      s.layer[i], s.lcol[i3], s.lcol[i3 + 1], s.lcol[i3 + 2]);
    return;
  }

  const d = s.depth[i];
  const xs = wx * ASPECT;
  // Broad swell: long horizontal bands that drift slowly, plus a diagonal
  // roll; wind adds a quicker chop in gusty patches.
  const drift = xs * 0.09 + t * (0.25 + wind * 0.4);
  if (swellY !== wy || swellTime !== t || swellSeed !== seed) {
    swellY = wy; swellTime = t; swellSeed = seed;
    swellRow = valueNoiseRow(wy * 0.7 - t * 0.05, seed + 300);
  }
  let v = swellRow(drift) +
    (ph[p8] * turn[1] + ph[p8 + 1] * turn[0]) * 0.12;
  if (wind > 0.02) v += wind * Math.sin(xs * 0.7 + wy * 0.9 + t * 2.7) * 0.14;
  // Fine wavelets over the swell, in [-1, 1].
  const fine = (ph[p8 + 2] * turn[3] + ph[p8 + 3] * turn[2]) * (ph[p8 + 4] * turn[5] + ph[p8 + 5] * turn[4]);
  const chop = fine + wind * 0.6;
  // Streaks keep one height along their length so neighbours join.
  const row = (((Math.floor(drift) * 13 + wy * 7) % 3) + 3) % 3;

  let g = 0;
  let k = 0;
  let cr = 0;
  let cg = 0;
  let cb = 0;
  let lg = 0;
  let lr = 0;
  let lgG = 0;
  let lb = 0;
  // Only the swell bands carry marks. Troughs stay clear, so crests read as
  // separate waves instead of a carpet of fine chop.
  const lv = v < 0.2 ? 0 : v > 0.9 ? 1 : (v - 0.2) / 0.7;
  k = 0.72 + lv * 0.28;
  cr = (TROUGH_COL[0] + (CREST_COL[0] - TROUGH_COL[0]) * lv * lv) * k;
  cg = (TROUGH_COL[1] + (CREST_COL[1] - TROUGH_COL[1]) * lv * lv) * k;
  cb = (TROUGH_COL[2] + (CREST_COL[2] - TROUGH_COL[2]) * lv * lv) * k;
  if (s.surface[i] && v > 0.72) {
    g = WAVE[row * 2 + (wx & 1)];
  } else if (s.surface[i] && v > 0.6) {
    g = LINE[row];
  } else if (s.surface[i] && v > 0.48 && chop > 0.25) {
    g = chop > 0.45 ? CHOP[Math.floor(rnd * 6)] : DASH[row + (rnd < 0.5 ? 0 : 3)];
  }
  // Fine wavelets ride over the long swell marks, and where they peak on
  // a lit swell they flash.
  if (s.surface[i] && fine > 0.6 && v > 0.55) {
    lg = GLINT[Math.floor(rnd * 4)];
    const f = (fine - 0.6) * 2.5 * (0.5 + lv * 0.5);
    lr = GLINT_COL[0] * f; lgG = GLINT_COL[1] * f; lb = GLINT_COL[2] * f;
  } else if (s.surface[i] && chop > 0.4 && v > 0.48) {
    lg = CHOP[Math.floor(rnd * 6 + 3) % 6];
    lr = TROUGH_COL[0] * 0.8; lgG = TROUGH_COL[1] * 0.8; lb = TROUGH_COL[2] * 0.8;
  }
  // Out in the dark deep the surface quietens.
  if (d > 0.6) { const q = 1.3 - d * 0.5; cr *= q; cg *= q; cb *= q; }
  // The swell's broad back holds a little moonlight in the water itself.
  const sheen = s.surface[i] && v > 0.45 ? (v - 0.45) * 1.4 : 0;
  bgR += 5 * sheen; bgG += 8 * sheen; bgB += 16 * sheen;

  // The bed lies under the surface glyph; in the shallows a net of
  // caustics plays over it when no wavelet does.
  if (kind === BED) {
    if (g && !lg) { lg = g; lr = cr; lgG = cg; lb = cb; }
    else if (!g && d < 0.32 && fine > -0.1) {
      lg = CAUSTIC[Math.floor(rnd * 4 + t * 0.6 + fine) & 3];
      k = (0.35 + fine * 0.65) * (1 - d / 0.32);
      lr = bgR + (CAUSTIC_COL[0] - bgR) * k; lgG = bgG + (CAUSTIC_COL[1] - bgG) * k; lb = bgB + (CAUSTIC_COL[2] - bgB) * k;
    }
    g = s.glyph[i];
    cr = s.col[i3]; cg = s.col[i3 + 1]; cb = s.col[i3 + 2];
  }

  // Lacy foam laps in and out at the bank, leaving froth as it draws back.
  if (d < 0.23) {
    const lap = ph[p8 + 6] * turn[7] + ph[p8 + 7] * turn[6];
    const reach = 0.07 + 0.07 * (0.5 + 0.5 * lap);
    if (d < reach) {
      const f = (0.5 + 0.5 * (1 - d / reach)) * (0.7 + 0.3 * Math.max(0, lap));
      g = FOAM_CH[(Math.floor(rnd * 6 + t * 0.5) % 6)];
      cr = FOAM[0] * f; cg = FOAM[1] * f; cb = FOAM[2] * f;
      if (fine > 0.5) { lg = GLINT[Math.floor(rnd * 4)]; lr = GLINT_COL[0] * f; lgG = GLINT_COL[1] * f; lb = GLINT_COL[2] * f; }
      else lg = 0;
    } else if (d < reach + 0.08 && rnd > 0.25) {
      const f = 0.45 * (1 - (d - reach) / 0.08);
      lg = FROTH[Math.floor(rnd * 4)];
      lr = FOAM[0] * f + bgR; lgG = FOAM[1] * f + bgG; lb = FOAM[2] * f + bgB;
    }
  }

  // Life on the surface, layered over the water.
  const dist = s.rise[i];
  if (dist !== Infinity) {
    const period = s.risePeriod[i];
    const age = fract((t + s.risePhase[i]) / period) * period;
    if (age < 2.2) {
      const fade = (1 - age / 2.2) ** 1.5;
      const radius = 0.25 + age * 1.5;
      let rg = 0;
      if (Math.abs(dist - radius) < 0.42) rg = RING[s.riseHeading[i]];
      else if (age < 0.5 && dist < 0.5) rg = PLOP;
      if (rg) {
        lg = rg;
        lr = bgR + (RING_COL[0] - bgR) * fade; lgG = bgG + (RING_COL[1] - bgG) * fade; lb = bgB + (RING_COL[2] - bgB) * fade;
      }
    }
  }
  const life = s.life[i];
  if (life === 1) {
    const p = fract(t * 0.23 + rnd * 7);
    if (p < 0.12) {
      lg = BUBBLES[Math.floor(p * 33)];
      const f = 1 - p * 5;
      lr = 90 * f + bgR; lgG = 120 * f + bgG; lb = 150 * f + bgB;
    }
  } else if (life === 2 && fract(t * 0.07 + rnd * 13) < 0.7) {
    lg = SKATER[Math.floor(t * 0.4 + rnd * 9) & 1];
    lr = 120; lgG = 128; lb = 140;
  }
  // Leaves drift across, each row at its own pace.
  if (d > 0.1) {
    const lane = hash2(0, wy, seed + 1501);
    const fx = Math.floor(wx - t * (0.12 + lane * 0.2 + wind * 0.8));
    const leaf = hash2(fx, wy, seed + 1502);
    if (leaf < 0.0035) {
      lg = LEAF[Math.floor(leaf * 2286) & 7];
      const f = 0.55 + leaf * 100;
      lr = LEAF_COL[0] * f; lgG = LEAF_COL[1] * f; lb = LEAF_COL[2] * f;
    }
  }

  emit(out, o, g, cr, cg, cb, bgR, bgG, bgB, lg, lr, lgG, lb);
  if (kind === BED) stoneLight(out, o, s, i);
}

// A river cell. Foam is laid out along each lane by the time the water took
// to get there, so it travels at the water's own speed: stretched out in the
// narrows, bunched in slow pools, slower by the banks. Nothing here calls
// noise; a frame costs a hash or two per cell.
function shadeRiver(out, o, s, chunk, i, wx, wy, seed, t, bgR, bgG, bgB) {
  const i3 = i * 3;
  const p8 = i * 8;
  const ph = s.phase;
  const d = s.depth[i];
  const rnd = chunk.rnd[i];
  const speed = s.rSpeed[i];
  const fast = Math.min(1, speed / 0.6);
  const q = Math.abs(s.rAcross[i]);
  const lane = s.rLane[i];
  const tau = s.rTau[i];
  const period = s.rPeriod[i];
  const p = (tau - t) / period;
  const cycle = Math.floor(p);
  const fr = p - cycle;
  const len = s.rLen[i];
  // A faint sheen on fast water.
  bgR += 3 * fast; bgG += 5 * fast; bgB += 9 * fast;

  let g = 0, cr = 0, cg = 0, cb = 0;
  let lg = 0, lr = 0, lgG = 0, lb = 0;
  const wake = s.rWake[i];
  if (fr < len && hash2(lane, cycle, seed + 1701) < s.rDensity[i]) {
    // A streak of foam, heaviest at its head downstream.
    const k = fr > len * 0.62 ? 2 : fr > len * 0.25 ? 1 : 0;
    g = STREAK[s.rOrient[i]][k];
    const b = (0.8 + 0.14 * k) * (1 - 0.3 * q) * (0.85 + 0.15 * fast);
    cr = (CREST_COL[0] + (GLINT_COL[0] - CREST_COL[0]) * k * 0.25) * b;
    cg = (CREST_COL[1] + (GLINT_COL[1] - CREST_COL[1]) * k * 0.25) * b;
    cb = (CREST_COL[2] + (GLINT_COL[2] - CREST_COL[2]) * k * 0.25) * b;
  } else if (wake !== EDDY_WAKE) {
    // Between the streaks, dimmer wavelets ride the same water.
    const p2 = p * 2.6 + 0.37;
    const c2 = Math.floor(p2);
    if (p2 - c2 < 0.35 && hash2(lane, c2, seed + 1702) < 0.5 * (1 - q)) {
      g = STREAK[s.rOrient[i]][0];
      cr = TROUGH_COL[0] * 1.15; cg = TROUGH_COL[1] * 1.15; cb = TROUGH_COL[2] * 1.15;
    } else if (d < 0.35 && speed > 0.3 && fract(p * 2.3 + rnd) < 0.3) {
      // Broken chop where fast water runs shallow.
      g = RIFFLE[(cycle + lane) & 3];
      const b = 0.55 + 0.3 * fast;
      cr = (TROUGH_COL[0] + (CREST_COL[0] - TROUGH_COL[0]) * 0.5) * b;
      cg = (TROUGH_COL[1] + (CREST_COL[1] - TROUGH_COL[1]) * 0.5) * b;
      cb = (TROUGH_COL[2] + (CREST_COL[2] - TROUGH_COL[2]) * 0.5) * b;
    }
  }
  // Froth heaps on the outer bank of a bend.
  const outer = s.rOuter[i];
  if (outer && fract(p * 1.7 + rnd * 3) < outer * 0.6) {
    lg = FROTH[Math.floor(rnd * 4)];
    const f = 0.5 + 0.3 * outer;
    lr = FOAM[0] * f; lgG = FOAM[1] * f; lb = FOAM[2] * f;
  }
  if (wake === PILLOW) {
    lg = FROTH[Math.floor(rnd * 4 + t * 3) & 3];
    const f = 0.55 + 0.35 * s.rWakeK[i];
    lr = FOAM[0] * f; lgG = FOAM[1] * f; lb = FOAM[2] * f;
  } else if (wake === VEE_WAKE && fract((tau - t) / 0.9 + rnd * 0.3) < 0.75) {
    g = s.rWakeGlyph[i];
    const f = (0.45 + 0.4 * s.rWakeK[i]) * (0.85 + 0.15 * Math.sin(t * 5 + rnd * 20));
    cr = CREST_COL[0] * f; cg = CREST_COL[1] * f; cb = CREST_COL[2] * f;
  } else if (wake === EDDY_WAKE && fract(t * 0.35 + rnd) < 0.55) {
    // The eddy turns slowly in the stone's lee.
    g = EDDY[(Math.floor(t * 1.5 + rnd * 3) % 3 + 3) % 3];
    cr = TROUGH_COL[0] * 1.3; cg = TROUGH_COL[1] * 1.3; cb = TROUGH_COL[2] * 1.3;
  }

  // The bed shows beneath the moving surface.
  if (s.kind[i] === BED) {
    if (g && !lg) { lg = g; lr = cr; lgG = cg; lb = cb; }
    g = s.glyph[i];
    cr = s.col[i3]; cg = s.col[i3 + 1]; cb = s.col[i3 + 2];
  }

  // Lacy foam at the banks, as on the lakes.
  if (d < 0.23) {
    const lap = ph[p8 + 6] * turn[7] + ph[p8 + 7] * turn[6];
    const reach = 0.07 + 0.07 * (0.5 + 0.5 * lap);
    if (d < reach) {
      const f = (0.5 + 0.5 * (1 - d / reach)) * (0.7 + 0.3 * Math.max(0, lap));
      g = FOAM_CH[(Math.floor(rnd * 6 + t * 0.5) % 6)];
      cr = FOAM[0] * f; cg = FOAM[1] * f; cb = FOAM[2] * f;
    }
  }

  // Fish rise in the slow pools.
  const dist = s.rise[i];
  if (dist !== Infinity) {
    const period2 = s.risePeriod[i];
    const age = fract((t + s.risePhase[i]) / period2) * period2;
    if (age < 2.2 && Math.abs(dist - (0.25 + age * 1.5)) < 0.42) {
      const fade = (1 - age / 2.2) ** 1.5;
      lg = RING[s.riseHeading[i]];
      lr = bgR + (RING_COL[0] - bgR) * fade; lgG = bgG + (RING_COL[1] - bgG) * fade; lb = bgB + (RING_COL[2] - bgB) * fade;
    }
  }

  // Leaves ride the current down their lane, one cell at a time.
  if (d > 0.1) {
    const lq = (tau - t) / LEAF_EVERY;
    const slot = Math.floor(lq);
    if ((lq - slot) * LEAF_EVERY < s.rSpan[i] && hash2(lane, slot, seed + 1502) < 0.05) {
      lg = LEAF[Math.floor(hash2(lane, slot, seed + 1503) * 8)];
      const f = 0.6 + 0.3 * hash2(lane, slot, seed + 1504);
      lr = LEAF_COL[0] * f; lgG = LEAF_COL[1] * f; lb = LEAF_COL[2] * f;
    }
  }

  emit(out, o, g, cr, cg, cb, bgR, bgG, bgB, lg, lr, lgG, lb);
  if (s.kind[i] === BED) stoneLight(out, o, s, i);
}

// Whether a river cell shows a stone breaking the surface (2), one just
// under it (1), or none (0): the wet stone the light catches.
export function bedStone(chunk, i, seed) {
  const s = statics(chunk, seed);
  if (s.kind[i] !== BED || !STONES.includes(s.glyph[i])) return 0;
  return s.depth[i] < 0.12 ? 2 : 1;
}

// Rivers: seeded streams that rise at an upland spring and run downhill
// until they reach a lake, or settle in a small pond where the land stops
// falling. The world is endless and built in chunks, so each river is
// traced once as a polyline for a whole region, and every chunk it crosses
// is carved from that shared line. Nothing depends on the order chunks are
// loaded in.
//
// Two spaces are used, and every conversion between them goes through
// toGround and toCells:
//   layout space - cells with x scaled by ASPECT, so distances are the same
//                  on screen in every direction. River geometry (points,
//                  widths, curvature) lives here, as the lakes' noise does.
//   ground       - metres, as bodies walk. A metre spans SCALE / ASPECT
//                  columns across the screen but only SCALE * TILT rows down
//                  it. Flow directions, speeds and travel times use these.

import { fbm, valueNoise } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { ASPECT, LAND_LIFT, SHORE, SHORE_LEVEL, WATER, WATER_LEVEL } from './world.js';

// Each region of the world may hold one river.
export const REGION = 200;
const RIVER_CHANCE = 0.8;
const SPRING_TRIES = 6;
const SPRING_RISE = 0.1;
const STEP = 2;
// No river is longer than this, so every river touching a point rises
// within two regions of it.
const MAX_LENGTH = REGION * 1.5;
const MIN_LENGTH = 80;
// The furthest a step may climb above the lowest ground the river has
// reached, on the real terrain: enough to cut through the finest ripples
// of the land, never enough to climb a hill.
export const UPHILL_TOL = 0.012;
const STALL_STEPS = 25;
// How hard the slow meander swings the course from side to side.
const MEANDER = 0.3;
// Half-width in layout units: narrow at the spring, broader downstream.
const HALF_MIN = 1.1;
const HALF_MAX = 6;
// Layout units downstream over which a river broadens to its full width.
const WIDEN = 180;
// Depth below the water line along the middle, narrow to wide. The widest
// reaches are as deep as the deepest lake.
const CHANNEL_NARROW = 0.03;
const CHANNEL_WIDE = 0.065;
// The sandy bank beyond the water's edge, and the damp valley floor
// beyond it (layout units), rising gently from the bank so the lush bank
// grass thins out without a hard edge.
const BANK = 1.5;
const VALLEY = 10;
const VALLEY_RISE = 0.0035;
// How far from a river's middle line it changes the land.
const reachOf = (half) => half + BANK + VALLEY + 1;
// Surface speeds in metres a second.
export const BASE_SPEED = 0.55;
const MIN_SPEED = 0.12;
const MAX_SPEED = 1;
// What a body standing in the current is carried at (see carryTarget).
export const CURRENT_CARRY = 0.35;
export const MIN_CARRY = 0.06;
export const CARRY_RATE = 4.5;
// Water this deep or more covers a body's feet entirely.
const IMMERSED = 0.4;
// Spawn and its ruins stay dry: any river whose valley would reach this
// box of cells around spawn is left out of the world.
export const KEEP_OUT = Object.freeze({ left: 190, right: 190, up: 120, down: 48 });
const CACHE = 256;
// A cell's place across its river is stored in steps of 1 / ACROSS, out to
// BANK_FLOW half-widths from the middle (onto the bank).
export const ACROSS = 80;
const BANK_FLOW = 1.55;
const CHUNK = 64;
const MOUTH = 1.5;
const POND = 2.5;
const STONE_EVERY = 6;

const smoothstep = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};
const chunkKey = (cx, cy) => `${cx},${cy}`;

// A step in layout space as metres on the ground, and metres on the ground
// as columns and rows.
export const toGround = (dLx, dLy) => ({ x: dLx / SCALE, y: dLy / (SCALE * TILT) });
export const toCells = (gx, gy) => ({ cols: gx * SCALE / ASPECT, rows: gy * SCALE * TILT });
const toLayout = (gx, gy) => ({ x: gx * SCALE, y: gy * SCALE * TILT });

// A river's half-width in metres, from its layout half-width and the ground
// direction of its current: measured square across the river as drawn.
export function groundHalfWidth(gx, gy, half) {
  const l = toLayout(gx, gy);
  const len = Math.hypot(l.x, l.y);
  if (!(len > 0)) return 0;
  const g = toGround(-l.y / len * half, l.x / len * half);
  return Math.hypot(g.x, g.y);
}

// The screen direction of a ground direction, 0 to 3: along the rows, up
// to the right, down the screen, and down to the right.
export function screenOrientation(gx, gy) {
  const l = toLayout(gx, gy);
  let a = Math.atan2(l.y, l.x);
  if (a < 0) a += Math.PI;
  const o = Math.round(a / (Math.PI / 4)) % 4;
  return [0, 3, 2, 1][o];
}

// The terrain's elevation before lakes are shelved, at a layout point.
// Chunks sample it at cell corners, so `cellElevation` reads exactly what
// a chunk would. Rivers steer by a smoother three-octave version with
// fewer pits.
function elevation(lx, ly, seed, octaves) {
  return fbm(lx * 0.011, ly * 0.011, seed, octaves) + LAND_LIFT;
}

export function cellElevation(lx, ly, seed) {
  return elevation(Math.floor(lx / ASPECT) * ASPECT, Math.floor(ly), seed, 5);
}

// How fast the water moves across a river, as a share of the middle: the
// shallows by the banks are slower.
export const crossSpeed = (q) => Math.max(0.15, (1 - Math.min(1, q * q)) ** 0.35);

// A body's share of being in the water: none when its feet are clear of
// the surface, such as mid-jump.
export const immersion = (depth, lift = 0) => Math.max(0, Math.min(1, (depth - Math.max(0, lift)) / IMMERSED));

// The carry a body in the current drifts at, in metres a second: about a
// quarter of a walk at the middle of an ordinary reach, scaled by how fast
// the water runs and how deep the body stands in it.
export function carryTarget(flow, share) {
  if (!(flow.speed > 0.04) || !(share > 0)) return { x: 0, y: 0 };
  const k = Math.max(CURRENT_CARRY * flow.speed / BASE_SPEED, MIN_CARRY) * share;
  return { x: flow.x * k, y: flow.y * k };
}

// Whether a step would bring a river back alongside its own earlier
// course, where it would loop into itself.
const AVOID = 18;
function crowded(points, x, y) {
  for (let i = 0; i < points.length - 2 * AVOID / STEP * 2; i += 2) {
    if ((points[i] - x) ** 2 + (points[i + 1] - y) ** 2 < AVOID * AVOID) return true;
  }
  return false;
}

// Follows the land down from a spring, one step at a time. The smooth
// three-octave terrain steers, with momentum and a slow meander; every step
// is then checked on the five-octave terrain the chunks are built from. A
// step that would climb more than UPHILL_TOL above the lowest ground yet
// reached is turned toward the real downhill side, up to 60 degrees, and
// if no turn descends the river pools there. It also pools where the land
// has stopped falling for a while, and ends on reaching a lake.
export function walk(sx, sy, riverSeed, elev) {
  const gradient = (x, y, octaves) => {
    const h = 1.5;
    return [(elev(x + h, y, octaves) - elev(x - h, y, octaves)) / (2 * h),
      (elev(x, y + h, octaves) - elev(x, y - h, octaves)) / (2 * h)];
  };
  const unit = (x, y) => {
    const l = Math.hypot(x, y);
    return l > 1e-12 ? [x / l, y / l] : null;
  };
  let [gx, gy] = gradient(sx, sy, 3);
  let dir = unit(-gx, -gy) ?? [1, 0];
  const points = [sx, sy];
  const heights = [elev(sx, sy, 5)];
  let x = sx;
  let y = sy;
  let low = heights[0];
  let since = 0;
  let length = 0;
  let end = 'pond';
  while (length < MAX_LENGTH) {
    [gx, gy] = gradient(x, y, 3);
    const down = unit(-gx, -gy) ?? dir;
    const meander = (valueNoise(length * 0.02, 0.5, riverSeed) - 0.5) * MEANDER;
    const want = unit(0.75 * dir[0] + 0.35 * down[0] - meander * dir[1],
      0.75 * dir[1] + 0.35 * down[1] + meander * dir[0]) ?? dir;
    const [fx, fy] = gradient(x, y, 5);
    const side = Math.sign(want[0] * -fy - want[1] * -fx) || 1;
    let step = null;
    let height = 0;
    for (const turn of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
      const a = (turn * side * Math.PI) / 180;
      const cx = want[0] * Math.cos(a) - want[1] * Math.sin(a);
      const cy = want[0] * Math.sin(a) + want[1] * Math.cos(a);
      const nx = x + cx * STEP;
      const ny = y + cy * STEP;
      const e = elev(nx, ny, 5);
      if (e <= low + UPHILL_TOL && !crowded(points, nx, ny)) { step = [cx, cy]; height = e; break; }
    }
    if (!step) break;
    dir = step;
    x += step[0] * STEP;
    y += step[1] * STEP;
    length += STEP;
    points.push(x, y);
    heights.push(height);
    if (height < WATER_LEVEL) { end = 'lake'; break; }
    if (height < low - 1e-5) { low = height; since = 0; } else if (++since >= STALL_STEPS) break;
  }
  return { points, heights, end, length };
}

// What the current carries a body at, metres a second on the ground: the
// carry of the water under its feet and under either side of its body
// (`reach` cells away), averaged over the samples that are in the current,
// as flowing water pushes on every block a body touches.
const SAMPLE = {};
export function currentAt(world, x, y, share, reach = 1) {
  let sx = 0, sy = 0, count = 0;
  if (share > 0 && world.flowAt) {
    for (const dx of [0, -reach, reach]) {
      const flow = world.flowAt(x + dx, y, SAMPLE);
      if (!(flow.speed > 0.04)) continue;
      const c = carryTarget(flow, share);
      sx += c.x; sy += c.y; count++;
    }
  }
  return count ? { x: sx / count, y: sy / count } : { x: 0, y: 0 };
}

// Eases a body's carry (metres a second, east and south) toward what the
// current gives it, as water drag would. Off the ground (`airborne`) the
// carry is kept as it is: no new push, and no jolt on landing.
export function easeCarry(carry, target, dt, airborne = false) {
  if (airborne) return carry;
  const k = 1 - Math.exp(-CARRY_RATE * dt);
  carry.x += (target.x - carry.x) * k;
  carry.y += (target.y - carry.y) * k;
  if (!target.x && !target.y && Math.hypot(carry.x, carry.y) < 1e-3) { carry.x = 0; carry.y = 0; }
  return carry;
}

export class RiverNetwork {
  constructor(seed, spawn, { enabled = true } = {}) {
    this.seed = seed;
    this.spawn = spawn;
    this.enabled = enabled;
    this.regions = new Map();
    this.chunkSegments = new Map();
    // Keep-out box in layout space.
    this.keep = {
      x0: (spawn.x - KEEP_OUT.left) * ASPECT, x1: (spawn.x + KEEP_OUT.right) * ASPECT,
      y0: spawn.y - KEEP_OUT.up, y1: spawn.y + KEEP_OUT.down,
    };
  }

  // The river rising in a region, or null. Cached, least recently used out.
  region(rx, ry) {
    const key = chunkKey(rx, ry);
    if (this.regions.has(key)) {
      const river = this.regions.get(key);
      this.regions.delete(key);
      this.regions.set(key, river);
      return river;
    }
    const river = this.enabled ? this.trace(rx, ry) : null;
    this.regions.set(key, river);
    if (this.regions.size > CACHE) {
      this.regions.delete(this.regions.keys().next().value);
      this.chunkSegments.clear();
    }
    return river;
  }

  // Every river whose source region lies within two regions of a layout
  // point: no river is longer than that reach, so none is missed.
  riversNear(lx, ly) {
    const rx = Math.floor(lx / REGION);
    const ry = Math.floor(ly / REGION);
    const out = [];
    for (let y = ry - 2; y <= ry + 2; y++) {
      for (let x = rx - 2; x <= rx + 2; x++) {
        const river = this.region(x, y);
        if (river) out.push(river);
      }
    }
    return out;
  }

  // Traces the river of one region, or returns null. Of a few high
  // springs, the one whose water runs furthest downhill wins (one reaching
  // a lake before one that pools).
  trace(rx, ry, elev = (lx, ly, octaves) => octaves === 5 ? cellElevation(lx, ly, this.seed)
    : elevation(lx, ly, this.seed, octaves)) {
    const rand = mulberry32(Math.floor(hash2(rx, ry, this.seed + 4101) * 2 ** 32));
    if (rand() >= RIVER_CHANCE) return null;
    const springs = [];
    for (let k = 0; k < SPRING_TRIES; k++) {
      springs.push([(rx + 0.1 + rand() * 0.8) * REGION, (ry + 0.1 + rand() * 0.8) * REGION]);
    }
    const riverSeed = Math.floor(rand() * 2 ** 31);
    let best = null;
    for (const [sx, sy] of springs) {
      if (elev(sx, sy, 3) < WATER_LEVEL + SPRING_RISE || elev(sx, sy, 5) < WATER_LEVEL) continue;
      const path = walk(sx, sy, riverSeed, elev);
      const score = path.length * (path.end === 'lake' ? 1.5 : 1);
      if (!best || score > best.score) best = { ...path, score };
    }
    if (!best || best.length < MIN_LENGTH) return null;
    return this.build(rx, ry, best.points, best.heights, best.end, riverSeed);
  }

  // Widths, depths, speeds and travel times along a traced line.
  build(rx, ry, raw, heights, end, riverSeed) {
    let n = raw.length / 2;
    const halfAt = (s) => Math.max(HALF_MIN, Math.min(HALF_MAX,
      (1.3 + 4.2 * smoothstep(s / WIDEN)) * (0.7 + 0.6 * valueNoise(s * 0.015, 7.5, riverSeed + 1))));
    const lastHalf = halfAt((n - 1) * STEP);
    // A river entering a lake runs on into it a little way, slowing to a
    // stop, so the lake itself stays calm.
    const mouthFrom = end === 'lake' ? n - 1 : n;
    const pts = raw.slice();
    if (end === 'lake') {
      const dx = (raw[2 * n - 2] - raw[2 * n - 4]) / STEP;
      const dy = (raw[2 * n - 1] - raw[2 * n - 3]) / STEP;
      const extra = Math.ceil((MOUTH * 2 * lastHalf) / STEP);
      for (let k = 1; k <= extra; k++) pts.push(raw[2 * n - 2] + dx * STEP * k, raw[2 * n - 1] + dy * STEP * k);
      n += extra;
    }
    const points = Float32Array.from(pts);
    const half = new Float32Array(n);
    const depth = new Float32Array(n);
    const dir = new Float32Array(n * 2);
    const curve = new Float32Array(n);
    const speed = new Float32Array(n);
    const s = new Float32Array(n);
    const tau = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      half[i] = i < mouthFrom ? halfAt(i * STEP) : lastHalf;
      depth[i] = CHANNEL_NARROW + (CHANNEL_WIDE - CHANNEL_NARROW) * smoothstep((half[i] - HALF_MIN) / 3);
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = points[2 * b] - points[2 * a];
      const dy = points[2 * b + 1] - points[2 * a + 1];
      const l = Math.hypot(dx, dy) || 1;
      dir[2 * i] = dx / l;
      dir[2 * i + 1] = dy / l;
    }
    let meanHalf = 0;
    for (let i = 0; i < mouthFrom; i++) meanHalf += half[i];
    meanHalf /= Math.max(1, mouthFrom);
    for (let i = 0; i < n; i++) {
      // Signed curvature over a few steps: positive turns left.
      const a = Math.max(0, i - 2);
      const b = Math.min(n - 1, i + 2);
      const cross = dir[2 * a] * dir[2 * b + 1] - dir[2 * a + 1] * dir[2 * b];
      const dot = dir[2 * a] * dir[2 * b] + dir[2 * a + 1] * dir[2 * b + 1];
      curve[i] = b > a ? Math.atan2(cross, dot) / ((b - a) * STEP) : 0;
      const bend = Math.min(1, Math.abs(curve[i]) * half[i] * 2);
      let v = BASE_SPEED * (meanHalf / half[i]) * (1 - 0.45 * bend);
      v = Math.max(MIN_SPEED, Math.min(MAX_SPEED, v));
      if (i >= mouthFrom) v *= 1 - (i - mouthFrom + 1) / (n - mouthFrom);
      speed[i] = v;
      if (i > 0) {
        const g = toGround(points[2 * i] - points[2 * i - 2], points[2 * i + 1] - points[2 * i - 1]);
        const ds = Math.hypot(g.x, g.y);
        s[i] = s[i - 1] + ds;
        tau[i] = tau[i - 1] + ds / Math.max(0.05, (speed[i] + speed[i - 1]) / 2);
      }
    }
    // Stones stand out of the wider reaches, never in the mouth.
    const stones = [];
    for (let i = STONE_EVERY; i < mouthFrom - STONE_EVERY; i += STONE_EVERY) {
      const pick = hash2(i, rx * 977 + ry, riverSeed + 3);
      if (half[i] < 2 || pick >= 0.22) continue;
      const q = (hash2(i, 1, riverSeed + 4) - 0.5) * 0.9;
      const lx = points[2 * i] - dir[2 * i + 1] * q * half[i];
      const ly = points[2 * i + 1] + dir[2 * i] * q * half[i];
      stones.push({ x: Math.floor(lx / ASPECT) + 0.5, y: Math.floor(ly) + 0.5,
        r: 0.9 + hash2(i, 2, riverSeed + 5) * 0.7, index: i, seed: Math.floor(hash2(i, 3, riverSeed + 6) * 2 ** 31) });
    }
    const river = {
      id: 1 + ((((rx * 92821) ^ (ry * 68917)) >>> 0) % 65535),
      rx, ry, points, heights: Float32Array.from(heights), half, depth, dir, curve, speed, s, tau,
      stones, end, mouthFrom, meanHalf, length: (mouthFrom - 1) * STEP,
      pond: null, bbox: null, chunks: new Map(),
    };
    if (end === 'pond') {
      const r = POND * lastHalf;
      const i = n - 1;
      river.pond = { x: points[2 * i] + dir[2 * i] * r * 0.8, y: points[2 * i + 1] + dir[2 * i + 1] * r * 0.8,
        dx: dir[2 * i], dy: dir[2 * i + 1], along: r * 1.3, across: r, depth: depth[i] };
    }
    // Its reach: the valley around the line, and the pond.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (lx, ly, r) => {
      x0 = Math.min(x0, lx - r); x1 = Math.max(x1, lx + r);
      y0 = Math.min(y0, ly - r); y1 = Math.max(y1, ly + r);
    };
    for (let i = 0; i < n; i++) grow(points[2 * i], points[2 * i + 1], reachOf(half[i]));
    if (river.pond) grow(river.pond.x, river.pond.y, reachOf(river.pond.along));
    river.bbox = { x0, y0, x1, y1 };
    if (this.touchesKeepOut(river)) return null;
    // Each segment is listed under every chunk its reach overlaps.
    for (let i = 0; i < n - 1; i++) {
      const r = reachOf(Math.max(half[i], half[i + 1]));
      const ax = points[2 * i], ay = points[2 * i + 1], bx = points[2 * i + 2], by = points[2 * i + 3];
      const cx0 = Math.floor((Math.min(ax, bx) - r) / ASPECT / CHUNK);
      const cx1 = Math.floor((Math.max(ax, bx) + r) / ASPECT / CHUNK);
      const cy0 = Math.floor((Math.min(ay, by) - r) / CHUNK);
      const cy1 = Math.floor((Math.max(ay, by) + r) / CHUNK);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = chunkKey(cx, cy);
          if (!river.chunks.has(key)) river.chunks.set(key, []);
          river.chunks.get(key).push(i);
        }
      }
    }
    if (river.pond) {
      const p = river.pond;
      const r = reachOf(p.along);
      for (let cy = Math.floor((p.y - r) / CHUNK); cy <= Math.floor((p.y + r) / CHUNK); cy++) {
        for (let cx = Math.floor((p.x - r) / ASPECT / CHUNK); cx <= Math.floor((p.x + r) / ASPECT / CHUNK); cx++) {
          const key = chunkKey(cx, cy);
          if (!river.chunks.has(key)) river.chunks.set(key, []);
        }
      }
    }
    return river;
  }

  touchesKeepOut(river) {
    const k = this.keep;
    const b = river.bbox;
    if (b.x1 < k.x0 || b.x0 > k.x1 || b.y1 < k.y0 || b.y0 > k.y1) return false;
    const near = (lx, ly, r) => {
      const dx = Math.max(k.x0 - lx, 0, lx - k.x1);
      const dy = Math.max(k.y0 - ly, 0, ly - k.y1);
      return dx * dx + dy * dy <= r * r;
    };
    const n = river.half.length;
    for (let i = 0; i < n; i++) {
      if (near(river.points[2 * i], river.points[2 * i + 1], reachOf(river.half[i]))) return true;
    }
    const p = river.pond;
    return !!p && near(p.x, p.y, reachOf(p.along));
  }

  // The rivers that reach a chunk, each with the segments that do.
  segmentsFor(cx, cy) {
    const key = chunkKey(cx, cy);
    let list = this.chunkSegments.get(key);
    if (list) return list;
    list = [];
    for (const river of this.riversNear((cx + 0.5) * CHUNK * ASPECT, (cy + 0.5) * CHUNK)) {
      const segments = river.chunks.get(key);
      if (segments) list.push({ river, segments });
    }
    this.chunkSegments.set(key, list);
    if (this.chunkSegments.size > CACHE * 4) this.chunkSegments.delete(this.chunkSegments.keys().next().value);
    return list;
  }

  // Whether any river reaches a chunk.
  reaches(cx, cy) {
    return this.enabled && this.segmentsFor(cx, cy).length > 0;
  }

  // The stones standing in rivers whose base lies in a chunk.
  stonesIn(cx, cy) {
    const out = [];
    for (const { river } of this.enabled ? this.segmentsFor(cx, cy) : []) {
      for (const stone of river.stones) {
        if (Math.floor(stone.x / CHUNK) === cx && Math.floor(stone.y / CHUNK) === cy) out.push({ ...stone, river: river.id });
      }
    }
    return out;
  }

  // Stones within `margin` cells of a chunk, for the wakes they leave.
  stonesNear(cx, cy, margin = 12) {
    const out = [];
    const x0 = cx * CHUNK - margin, x1 = (cx + 1) * CHUNK + margin;
    const y0 = cy * CHUNK - margin, y1 = (cy + 1) * CHUNK + margin;
    for (const { river } of this.enabled ? this.segmentsFor(cx, cy) : []) {
      for (const stone of river.stones) {
        if (stone.x >= x0 && stone.x < x1 && stone.y >= y0 && stone.y < y1) out.push(stone);
      }
    }
    return out;
  }

  // Where a layout point lies against one river: across the nearest
  // segment (q in half-widths, signed, + on the left bank), and how far
  // along. Infinity when no segment is near.
  locate(river, segments, lx, ly, out) {
    out.q = Infinity;
    const p = river.points;
    for (const i of segments) {
      const ax = p[2 * i], ay = p[2 * i + 1];
      const ex = p[2 * i + 2] - ax, ey = p[2 * i + 3] - ay;
      const len2 = ex * ex + ey * ey;
      const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (ly - ay) * ey) / len2));
      const dx = lx - ax - ex * t;
      const dy = ly - ay - ey * t;
      const half = river.half[i] + (river.half[i + 1] - river.half[i]) * t;
      const q = Math.hypot(dx, dy) / half;
      if (q < Math.abs(out.q)) {
        out.q = (ex * dy - ey * dx) < 0 ? q : -q;
        out.i = i;
        out.t = t;
        out.half = half;
      }
    }
    return out;
  }

  // Carves the rivers into one chunk's freshly generated terrain. Lowers
  // the ground into a channel, a sandy bank and a damp valley floor, and
  // returns the flow of each river cell, or null if no river reaches it.
  // `facing`, when given, is filled with how squarely each bank cell faces
  // the viewer across the water (0 behind the river on screen, 1 in front
  // of it), so the grass grown there can stay low enough not to hide it.
  carve(cx, cy, type, elev, facing = null) {
    if (!this.enabled) return null;
    const rivers = this.segmentsFor(cx, cy);
    if (!rivers.length) return null;
    const n = CHUNK * CHUNK;
    let flow = null;
    const at = { q: Infinity, i: 0, t: 0, half: 1 };
    const bankElev = (WATER_LEVEL + SHORE_LEVEL) / 2;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const k = ly * CHUNK + lx;
        const px = (cx * CHUNK + lx + 0.5) * ASPECT;
        const py = cy * CHUNK + ly + 0.5;
        // The river nearest its own middle wins where two meet.
        let best = null;
        let bq = Infinity, bi = 0, bt = 0, bh = 1;
        let pondQ = Infinity;
        let pondRiver = null;
        for (const { river, segments } of rivers) {
          if (segments.length) {
            this.locate(river, segments, px, py, at);
            if (Math.abs(at.q) < Math.abs(bq)) { best = river; bq = at.q; bi = at.i; bt = at.t; bh = at.half; }
          }
          const pond = river.pond;
          if (pond) {
            const dx = px - pond.x;
            const dy = py - pond.y;
            const u = (dx * pond.dx + dy * pond.dy) / pond.along;
            const v = (dy * pond.dx - dx * pond.dy) / pond.across;
            const r = Math.hypot(u, v);
            if (r < pondQ) { pondQ = r; pondRiver = river; }
          }
        }
        const q = Math.abs(bq);
        const e = elev[k];
        if (q < 1 || pondQ < 1) {
          // The water: deep in the middle, shallowing to the banks.
          let bed = Infinity;
          if (q < 1) {
            const d = best.depth[bi] + (best.depth[bi + 1] - best.depth[bi]) * bt;
            bed = WATER_LEVEL - d * Math.max(0.08, 1 - q * q) ** 0.9;
          }
          if (pondQ < 1) bed = Math.min(bed, WATER_LEVEL - pondRiver.pond.depth * Math.max(0.08, 1 - pondQ * pondQ) ** 0.7);
          type[k] = WATER;
          elev[k] = Math.min(e, bed);
          if (q < 1) {
            if (!flow) flow = emptyFlow(n);
            writeFlow(flow, k, best, bq, bi, bt, bh, best.id);
          }
          continue;
        }
        // The current is laid out a little way onto the bank as well, not as
        // water, so it blends smoothly right up to the water's edge.
        if (q < BANK_FLOW) {
          if (!flow) flow = emptyFlow(n);
          writeFlow(flow, k, best, bq, bi, bt, bh, 0);
        }
        // How far the cell lies beyond the water's edge.
        const fromPond = pondRiver ? (pondQ - 1) * pondRiver.pond.across : Infinity;
        const edge = Math.min((q - 1) * bh, fromPond);
        if (e < WATER_LEVEL) continue;
        if (facing && edge < BANK + VALLEY) {
          // Which way the bank lies from the water, down the screen being in
          // front: the near bank's grass would grow up over the water.
          let down;
          if (fromPond < (q - 1) * bh) {
            const p = pondRiver.pond;
            down = (py - p.y) / (Math.hypot(px - p.x, py - p.y) || 1);
          } else {
            down = -Math.sign(bq) * (best.dir[2 * bi] + (best.dir[2 * bi + 2] - best.dir[2 * bi]) * bt);
          }
          facing[k] = smoothstep(0.5 + down);
        }
        if (edge < BANK) {
          type[k] = SHORE;
          elev[k] = Math.min(e, bankElev);
        } else if (edge < BANK + VALLEY) {
          elev[k] = Math.min(e, SHORE_LEVEL + 0.002 + (edge - BANK) * VALLEY_RISE);
        }
      }
    }
    return flow;
  }

  // The nearest point of each river's line within `radius` layout units of
  // a cell, nearest first; `dist` is measured from the water's edge.
  near(x, y, radius) {
    const lx = x * ASPECT;
    const out = [];
    for (const river of this.riversNear(lx, y)) {
      const b = river.bbox;
      if (lx < b.x0 - radius || lx > b.x1 + radius || y < b.y0 - radius || y > b.y1 + radius) continue;
      const p = river.points;
      let best = null;
      for (let i = 0; i < river.half.length - 1; i++) {
        const ax = p[2 * i], ay = p[2 * i + 1];
        const ex = p[2 * i + 2] - ax, ey = p[2 * i + 3] - ay;
        const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
        const px = ax + ex * t;
        const py = ay + ey * t;
        const half = river.half[i] + (river.half[i + 1] - river.half[i]) * t;
        const dist = Math.max(0, Math.hypot(lx - px, y - py) - half);
        if (dist <= radius && (!best || dist < best.dist)) {
          best = { river, index: i, s: river.s[i] + (river.s[i + 1] - river.s[i]) * t,
            x: px / ASPECT, y: py, dir: { x: river.dir[2 * i], y: river.dir[2 * i + 1] }, dist,
            speed: river.speed[i] + (river.speed[i + 1] - river.speed[i]) * t };
        }
      }
      if (best) out.push(best);
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  // A point on a river's middle `s` metres from its spring.
  pointAt(river, s) {
    const n = river.s.length;
    let i = 0;
    while (i < n - 2 && river.s[i + 1] < s) i++;
    const span = river.s[i + 1] - river.s[i];
    const t = Math.max(0, Math.min(1, span > 0 ? (s - river.s[i]) / span : 0));
    const p = river.points;
    const lerp = (a, k = 1, o = 0) => a[k * i + o] + (a[k * (i + 1) + o] - a[k * i + o]) * t;
    return { x: lerp(p, 2, 0) / ASPECT, y: lerp(p, 2, 1), dir: { x: river.dir[2 * i], y: river.dir[2 * i + 1] },
      halfWidth: lerp(river.half), speed: lerp(river.speed) };
  }
}

// A chunk's flow, one entry per cell: the current's heading on the ground
// (256 steps), the surface speed down the river's middle line there (0-1
// m/s in 255 steps; slower off the middle by crossSpeed), where the cell lies
// across the river (half-widths, + on the left bank), how sharply the river
// bends there, the outward flow on a bend, the river's half-width (layout
// units, 60 to one) and the time the water down the middle took to get
// there from the spring. Water off the middle runs slower by crossSpeed, so
// along its own line it took that time divided by crossSpeed(across).
function emptyFlow(n) {
  return {
    heading: new Uint8Array(n),
    speed: new Uint8Array(n),
    across: new Int8Array(n),
    bend: new Uint8Array(n),
    secondary: new Int8Array(n),
    width: new Uint8Array(n),
    tau: new Float32Array(n),
    river: new Uint16Array(n),
  };
}

function writeFlow(flow, k, river, q, i, t, half, id) {
  const dx = river.dir[2 * i] + (river.dir[2 * i + 2] - river.dir[2 * i]) * t;
  const dy = river.dir[2 * i + 1] + (river.dir[2 * i + 3] - river.dir[2 * i + 1]) * t;
  const g = toGround(dx, dy);
  const heading = Math.atan2(g.y, g.x);
  flow.heading[k] = Math.round(((heading / (Math.PI * 2)) % 1 + 1) % 1 * 256) & 255;
  const centre = river.speed[i] + (river.speed[i + 1] - river.speed[i]) * t;
  flow.speed[k] = Math.round(Math.min(1, centre) * 255);
  flow.across[k] = Math.round(Math.max(-BANK_FLOW, Math.min(BANK_FLOW, q)) * ACROSS);
  const curve = river.curve[i] + (river.curve[i + 1] - river.curve[i]) * t;
  const bend = Math.min(1, Math.abs(curve) * half * 2);
  flow.bend[k] = Math.round(bend * 255);
  // The surface on a bend sets toward the outer bank, which lies right of a
  // left turn.
  flow.secondary[k] = Math.round(-Math.sign(curve) * bend * 127);
  flow.width[k] = Math.min(255, Math.round(half * 60));
  flow.tau[k] = river.tau[i] + (river.tau[i + 1] - river.tau[i]) * t;
  flow.river[k] = id;
}

// Decodes one cell's flow into `out`: a unit ground direction and the
// speed of the water in that cell.
export function readFlow(flow, k, out) {
  const a = (flow.heading[k] / 256) * Math.PI * 2;
  out.x = Math.cos(a);
  out.y = Math.sin(a);
  out.speed = flow.speed[k] / 255 * crossSpeed(flow.across[k] / ACROSS);
  return out;
}

export const RIVER_CHUNK = CHUNK;

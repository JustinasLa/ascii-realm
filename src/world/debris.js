import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { FINE, putCell } from '../render/cells.js';
import { family } from '../render/glyphs.js';
import { bakePiece, pieceModel } from './debris-art.js';
import { BASE_SPEED, RIVER_CHUNK, addBump, immersion, screenOrientation, toCells, toGround } from './rivers.js';
import { FLOATING } from './terrain/water.js';
import { WEATHER_EFFECTS } from './weather.js';
import { ASPECT, WATER } from './world.js';

// Driftwood and flotsam: now and then, while the player is near a running
// river, a log, a leafy branch, a mat of leaves, a clump of reeds or, rarely,
// a broken crate board or barrel stave comes down the current. Pieces are
// local and cosmetic: nothing is saved, and they never touch the world.
//
// A piece is a rod dragged at both ends by the surface current (world.flowAt)
// at each end, so it follows the water, swings round on bends and turns to
// lie along the flow. Its hull bumps and slides along the banks and the
// stones standing in the river, sometimes snags for a few seconds, bobs
// slowly, and sinks once it comes to rest in a lake. The drift is this
// game's own: a piece eases toward the full speed of the water, as light
// floating things do, at a rate set by how heavy it is.
//
// Anyone wading shoves the pieces they walk into, and the pieces knock
// back. Each meeting trades an impulse shared by mass, as two floating
// things jostle: a light mat flies off faster than the walker, a heavy log
// only gives way, struck off its middle it turns, and the walker feels a
// small slide (their `bump`, which settles like the river's carry). Bodies
// are never stopped and nobody is hurt. Pieces knock each other the same
// way. Every push a meeting gives a piece is made only as far as its hull
// stays off the banks and stones, and a piece shoved into the slack water
// by a bank edges back into the current after a moment.
//
// Positions are cells (x columns, y rows); velocities and sizes are ground
// metres, as flowAt gives them; stones and banks are met in layout space;
// bodies and pieces meet each other in ground metres.

export const EVERY = [20, 60];
export const NEAR = 40;
export const MIN_SPEED = 0.15;
export const AFTER_STORM = 180;
export const CAP = 4;
export const CAP_STORM = 6;
export const RETRY = 3;
const SPAWN_UP = [1, 25];
const SPAWN_STEP = 0.5;
const SPAWN_MARGIN = { cols: 12, rows: 6 };
export const SIM_MARGIN = { cols: 64, rows: 32 };
export const LIFETIME = 300;
const ALIGN = 0.6;
const ALIGN_KICK = 0.35;
const SECONDARY = 0.25;
const RESTITUTION = 0.15;
const SLIDE = 0.7;
export const RING_SPEED = 0.05;
const SNAG_BEND = 0.35;
const SNAG_CHANCE = { bank: 0.35, stone: 0.25 };
const SNAG_TIME = { bank: [2, 6], stone: [1.5, 4] };
const SNAG_REST = 20;
const KNOCK_REST = 0.4;
const WEDGED = 8;
const APPEAR_TIME = 1.5;
export const BEACH_TIME = 10;
const MAX_STEP = 1 / 30;
const MAX_PUSH = 0.03;
const PROBE_PUSH = 0.006;
const STONE_PUSH = 0.1;
const LAND_REACH = 4;
// Steps a frame is cut into at most.
const MAX_SUB = 8;
// Meetings with wading bodies and between pieces.
export const DEFAULT_WADE = Object.freeze({ radius: 0.13, mass: 6 });
const BODY_RESTITUTION = 0.3;
const PIECE_RESTITUTION = 0.2;
const BODY_PUSH = 0.04;
export const SPIN_KICK = 2.5;
export const SPIN_MAX = 4;
// The share of a knock's impulse that reaches a body: its legs brace.
export const FOOTING = 0.25;
export const BODY_RING = 0.1;
export const HIT_REST = 0.4;
export const SNAG_FREE = 0.25;
const MAX_BODY_SPEED = 8;
// A body further than this from where it was last frame was put there
// (metres): it did not walk into anything on the way.
const LEAP = 2;
const WET = 0.02;
// Back into the current: past this share of the half-width from the middle,
// a while after its last shove, a piece edges in at this pace (m/s), easing
// off over the last tenth.
export const RETURN_TO = 0.5;
export const RETURN_SPEED = 0.05;
export const RETURN_WAIT = 1.5;
const RETURN_EASE = 0.1;

// Kinds: how often each comes down, its length and half-thickness in metres,
// how quickly it takes up the water's speed (heavy logs lag), how long it
// takes to sink at rest in a lake, its bob between two drafts, and the
// density of its wet wood or leaves (kg/m³). Logs, branches and reeds are
// solid rods; a mat, a board and a stave are slabs `slab` metres thick.
export const KINDS = Object.freeze({
  log: { weight: 35, length: [0.3, 0.55], radius: [0.06, 0.09], drag: 0.8, sink: 20, symmetric: true, draft: [0.4, 0.6],
    density: 650 },
  branch: { weight: 25, length: [0.2, 0.4], radius: [0.03, 0.03], drag: 1.5, sink: 12, draft: [0.3, 0.45], density: 550 },
  mat: { weight: 20, length: [0.12, 0.25], radius: [0.06, 0.1], drag: 2.5, sink: 6, draft: [0.3, 0.45], density: 300,
    slab: 0.03 },
  reeds: { weight: 15, length: [0.15, 0.28], radius: [0.03, 0.03], drag: 2, sink: 8, draft: [0.3, 0.45], density: 250 },
  crate: { weight: 3, length: [0.18, 0.26], radius: [0.05, 0.05], drag: 1.2, sink: 15, draft: [0.4, 0.6], density: 500,
    slab: 0.02 },
  stave: { weight: 2, length: [0.2, 0.28], radius: [0.04, 0.04], drag: 1.2, sink: 15, draft: [0.4, 0.6], density: 600,
    slab: 0.025 },
});
// What a kind too long for the reach gives way to.
const SMALLER = ['log', 'branch', 'reeds', 'mat'];
// Baked headings: a log looks the same either way round.
export const BUCKETS = { symmetric: 16, other: 24 };
const BAKES_PER_FRAME = 1;
// The bob rises in a third of its cycle and sinks in the rest.
const RISE_TIME = 1.2;

const FOAM = family('water.foam.');
const VEE = family('water.vee.');
const CREST = [146, 172, 220];
const UNDER = [26, 40, 70];
const WATER_INK = [0, 0, 0];

// The slow rise and fall of a floating piece: it rises to its shallowest
// draft at `speed`, then sinks at half that to its deepest, and keeps going
// the way it was between the two. Returns the new draft and direction.
export function bobStep(draft, goingDown, min, max, speed, dt) {
  if (draft <= min) goingDown = true;
  else if (draft >= max) goingDown = false;
  return { draft: draft + (goingDown ? speed / 2 : -speed) * dt, goingDown };
}

// Whether the weather is a storm that washes debris into the rivers.
export function stormy(weather) {
  const kind = WEATHER_EFFECTS[weather?.preset]?.kind;
  return (kind === 'rain' || kind === 'hail' || kind === 'sleet') && weather.intensity >= 0.6;
}

// Which baked heading a piece is drawn at.
export function orientationBucket(piece) {
  const n = piece.symmetric ? BUCKETS.symmetric : BUCKETS.other;
  const span = piece.symmetric ? Math.PI : Math.PI * 2;
  return ((Math.round(piece.angle / span * n) % n) + n) % n;
}

const bucketAngle = (piece, b) => b * (piece.symmetric ? Math.PI : Math.PI * 2) / (piece.symmetric ? BUCKETS.symmetric : BUCKETS.other);

// Whether every chunk a piece of `reach` metres around a point could sample
// has been generated, so nothing the debris does makes the world build land.
export function footprintLoaded(world, x, y, reach) {
  const c = toCells(reach, reach);
  const x0 = Math.floor((x - c.cols - 2) / RIVER_CHUNK), x1 = Math.floor((x + c.cols + 2) / RIVER_CHUNK);
  const y0 = Math.floor((y - c.rows - 2) / RIVER_CHUNK), y1 = Math.floor((y + c.rows + 2) / RIVER_CHUNK);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) if (!world.loaded(cx, cy)) return false;
  }
  return true;
}

// A piece's mass in kilograms, from its kind and size in metres.
export function pieceMass(kind, length, radius) {
  const k = KINDS[kind];
  const volume = k.slab ? length * 2 * radius * k.slab : Math.PI * radius * radius * length;
  return k.density * volume;
}

// How a body meets floating debris: the half-width of its legs in the water
// and its footing, metres and kilograms.
export function bodyProfile(body) {
  return body.wade ?? body.kind?.wade ?? DEFAULT_WADE;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The closest point on the segment from (ax, ay) to (bx, by) to the point
// (px, py), and how far along the segment it lies (0 to 1).
export function segmentPoint(px, py, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const len2 = ex * ex + ey * ey;
  const t = len2 > 0 ? clamp01(((px - ax) * ex + (py - ay) * ey) / len2) : 0;
  return { x: ax + ex * t, y: ay + ey * t, t };
}

// The closest points between the segments a0-a1 and b0-b1: (ax, ay) on the
// first, s along it, and (bx, by) on the second, t along it. Lying side by
// side, they meet in the middle of where they overlap.
export function segmentSegment(a0x, a0y, a1x, a1y, b0x, b0y, b1x, b1y) {
  const d1x = a1x - a0x, d1y = a1y - a0y, d2x = b1x - b0x, d2y = b1y - b0y;
  const rx = a0x - b0x, ry = a0y - b0y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
  let s = 0, t = 0;
  if (a <= 1e-12 && e > 1e-12) t = clamp01(f / e);
  else if (a > 1e-12) {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-12) s = clamp01(-c / a);
    else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 1e-12 * a * e ? clamp01((b * f - c * e) / denom) : (clamp01(-c / a) + clamp01((b - c) / a)) / 2;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  return { ax: a0x + d1x * s, ay: a0y + d1y * s, s, bx: b0x + d2x * t, by: b0y + d2y * t, t };
}

// The impulse (kg m/s) two things meeting at `vn` m/s along their normal
// trade, from their inverse masses and, for each, its lever (the arm of the
// contact square to the normal, metres) and inverse moment of inertia.
export function impulse(vn, restitution, invA, invB, leverA = 0, invIA = 0, leverB = 0, invIB = 0) {
  const k = invA + invB + leverA * leverA * invIA + leverB * leverB * invIB;
  return k > 0 ? (1 + restitution) * Math.max(0, vn) / k : 0;
}

// A snagged piece is held: nothing it meets moves it until it is freed.
const invMass = (piece) => piece.snag ? 0 : 1 / piece.mass;
const invInertia = (piece) => piece.snag ? 0 : 12 / (piece.mass * piece.length * piece.length);
const kick = (spin, d) => Math.max(-SPIN_MAX, Math.min(SPIN_MAX, spin + Math.max(-SPIN_KICK, Math.min(SPIN_KICK, d))));

const inZone = (view, x, y, m) => x >= view.x0 - m.cols && x < view.x0 + view.cols + m.cols &&
  y >= view.y0 - m.rows && y < view.y0 + view.rows + m.rows;

// The first point upstream of the player's reach, along the river's middle,
// that lies off the screen but inside the simulated area, on loaded river
// water running fast enough. A river short enough to lie on the screen up
// to its spring gives the point furthest up it instead, marked `inView`, and
// the piece washes out of the spring there. Null if there is none.
export function spawnPoint(world, view, hit) {
  let spring = null;
  for (let d = SPAWN_UP[0]; d <= SPAWN_UP[1] && hit.s - d >= 0; d += SPAWN_STEP) {
    const p = world.rivers.pointAt(hit.river, hit.s - d);
    if (!inZone(view, p.x, p.y, SIM_MARGIN) || !footprintLoaded(world, p.x, p.y, KINDS.log.length[1])) continue;
    const flow = world.flowAt(p.x, p.y, {});
    if (!flow.river || flow.speed < MIN_SPEED) continue;
    const point = { x: p.x, y: p.y, flow, inView: inZone(view, p.x, p.y, SPAWN_MARGIN) };
    if (!point.inView) return point;
    spring = point;
  }
  return spring;
}

const AT = {};
const MID_RETURN = Object.freeze({ x: 0, y: 0 });
const END = [{}, {}];
const MID = {};

export class Debris {
  constructor({ random = Math.random, enabled = true, season = 'summer', world = null } = {}) {
    this.random = random;
    this.world = world;
    this.view = null;
    this.hit = null;
    this.enabled = enabled;
    this.season = season;
    this.list = [];
    this.timer = this.interval();
    this.storm = 0;
    this.nextId = 1;
    this.bakesLeft = BAKES_PER_FRAME;
    this.stones = new Map();
    // Where each body stood last frame, to tell how it moved.
    this.lastAt = new WeakMap();
    // Splashes of knocks against bodies, for the sound.
    this.events = [];
    this.lastShove = null;
    this.returnSpeed = RETURN_SPEED;
  }

  interval() {
    return EVERY[0] + this.random() * (EVERY[1] - EVERY[0]);
  }

  get boosted() {
    return this.storm > 0;
  }

  get cap() {
    return this.boosted ? CAP_STORM : CAP;
  }

  // Runs the spawner and moves every piece. `splashes` takes the ripple
  // rings of knocks; `weather` speeds the spawner up in and after storms;
  // `bodies` (the player, monsters) shove what they wade into.
  update(dt, world, view, player, weather = null, splashes = null, bodies = []) {
    this.bakesLeft = BAKES_PER_FRAME;
    if (!this.enabled || !world.rivers) return;
    this.world = world;
    this.splashes = splashes;
    this.storm = stormy(weather) ? AFTER_STORM : Math.max(0, this.storm - dt);
    const hit = world.rivers.near(player.x, player.y, NEAR)[0];
    this.view = view;
    this.hit = hit ?? null;
    if (hit && hit.speed >= MIN_SPEED) {
      this.timer -= dt * (this.boosted ? 2 : 1);
      if (this.timer <= 0) {
        if (this.list.length >= this.cap) this.timer = this.interval();
        else this.timer = this.spawn(null, null, view, hit) ? this.interval() : RETRY;
      }
    }
    this.advance(this.list, dt, world, view, this.wading(bodies, dt, world));
    this.list = this.list.filter((p) => !p.gone);
  }

  // The bodies standing in the water this frame, each with where it stood
  // at the start of the frame and how fast it went (ground m/s). A body put
  // down far from where it was, or seen for the first time, went nowhere.
  wading(bodies, dt, world) {
    const out = [];
    for (const body of bodies) {
      const was = this.lastAt.get(body);
      this.lastAt.set(body, { x: body.x, y: body.y });
      if (body.alive === false || body.state === 'rise' || body.state === 'dead') continue;
      const depth = world.waterDepthAt?.(body.x, body.y) ?? 0;
      if (!(depth > WET) || !(immersion(depth, body.air ?? 0) > 0)) continue;
      let from = was ?? body;
      let g = toGround((body.x - from.x) * ASPECT, body.y - from.y);
      if (Math.hypot(g.x, g.y) > LEAP || !(dt > 0)) {
        from = body;
        g = { x: 0, y: 0 };
      }
      let vx = dt > 0 ? g.x / dt : 0, vy = dt > 0 ? g.y / dt : 0;
      const v = Math.hypot(vx, vy);
      if (v > MAX_BODY_SPEED) { vx *= MAX_BODY_SPEED / v; vy *= MAX_BODY_SPEED / v; }
      out.push({ body, wade: bodyProfile(body), x0: from.x, y0: from.y, x1: body.x, y1: body.y, x: from.x, y: from.y, vx, vy });
    }
    return out;
  }

  // Sets a new piece adrift: of `kind` (or one picked by weight), at `at`
  // ({ x, y, angle }) or at the next spawn point upstream. Returns it, or
  // null when no point is found or nothing fits the reach.
  spawn(kind = null, at = null, view = null, hit = null) {
    const world = this.world;
    let x, y, flow, inView = false;
    if (at) {
      ({ x, y } = at);
      flow = world.flowAt(x, y, {});
    } else {
      view ??= this.view;
      hit ??= this.hit;
      if (!view || !hit) return null;
      const p = spawnPoint(world, view, hit);
      if (!p) return null;
      ({ x, y, flow, inView } = p);
    }
    kind ??= this.pick();
    // Nothing longer than the reach is wide.
    const room = at ? Infinity : 1.2 * flow.halfWidth;
    const order = [kind, ...SMALLER.slice(Math.max(0, SMALLER.indexOf(kind) + 1))];
    const fits = order.find((k) => KINDS[k].length[0] <= room);
    if (!fits) return null;
    const k = KINDS[fits];
    const r = this.random;
    const length = Math.min(room, k.length[0] + r() * (k.length[1] - k.length[0]));
    const radius = k.radius[0] + r() * (k.radius[1] - k.radius[0]);
    const heading = flow.speed > 0 ? Math.atan2(flow.y, flow.x) : 0;
    const piece = {
      id: this.nextId++, kind: fits, x, y,
      vx: flow.x * flow.speed, vy: flow.y * flow.speed,
      angle: at?.angle ?? heading + (r() - 0.5) * (40 * Math.PI / 180), spin: 0,
      length, radius, drag: k.drag, symmetric: !!k.symmetric, bias: r() < 0.5 ? -1 : 1,
      draft: k.draft[0] + r() * (k.draft[1] - k.draft[0]), goingDown: r() < 0.5,
      snag: null, lastSnag: -Infinity, knock: 0, touching: false,
      sinking: 0, beached: 0, age: 0, slow: 0, aligned: 0, fade: 1, appear: 1, life: 1, gone: false,
      seed: Math.floor(r() * 2 ** 31), river: flow.river,
      model: null, bakes: new Map(), shown: -1,
      mass: pieceMass(fits, length, radius), pushed: -Infinity, hits: new WeakMap(),
    };
    if (inView) piece.appear = piece.fade = 0;
    piece.model = pieceModel(piece, this.season);
    // Its first heading is baked within the frame's budget like any other;
    // till then there is nothing of it to draw.
    this.bake(piece, orientationBucket(piece));
    this.list.push(piece);
    return piece;
  }

  pick() {
    let total = 0;
    for (const k of Object.values(KINDS)) total += k.weight;
    let roll = this.random() * total;
    for (const [name, k] of Object.entries(KINDS)) {
      roll -= k.weight;
      if (roll < 0) return name;
    }
    return 'mat';
  }

  // Bakes one heading of a piece, if this frame still has a bake to spare.
  bake(piece, bucket) {
    if (piece.bakes.has(bucket)) return true;
    if (this.bakesLeft <= 0) return false;
    this.bakesLeft--;
    piece.bakes.set(bucket, bakePiece(piece.model, bucketAngle(piece, bucket)));
    return true;
  }

  // The bake to draw a piece with: its own heading's once baked, else the
  // nearest heading baked so far.
  bakeFor(piece) {
    const want = orientationBucket(piece);
    if (this.bake(piece, want)) return piece.bakes.get(want);
    const n = piece.symmetric ? BUCKETS.symmetric : BUCKETS.other;
    let best = null, gap = Infinity;
    for (const [b, baked] of piece.bakes) {
      const d = Math.min((b - want + n) % n, (want - b + n) % n);
      if (d < gap) { gap = d; best = baked; }
    }
    return best;
  }

  remove(piece) {
    piece.gone = true;
    piece.bakes.clear();
  }

  // Moves one piece on by a frame, meeting nothing but the banks and stones.
  step(piece, dt, world, view) {
    this.advance([piece], dt, world, view, []);
  }

  // Moves pieces on by a frame. Long frames are taken in short steps shared
  // by every piece and every body near one, none moving any of them more
  // than half a cell, so a piece cannot jump a narrow spit of bank nor a body
  // walk through a piece unmet. Each step moves every piece, then settles
  // every meeting of a body and a piece, or of two pieces, at that moment.
  advance(pieces, dt, world, view, wading) {
    const live = [];
    for (const piece of pieces) {
      if (!inZone(view, piece.x, piece.y, SIM_MARGIN) || !footprintLoaded(world, piece.x, piece.y, piece.length)) {
        this.remove(piece);
      } else live.push(piece);
    }
    if (!live.length) return;
    const near = wading.filter((w) => live.some((p) => this.within(p, w)));
    let fastest = 0;
    for (const p of live) fastest = Math.max(fastest, Math.hypot(p.vx, p.vy) + 1);
    for (const w of near) fastest = Math.max(fastest, Math.hypot(w.vx, w.vy) + 1);
    const c = toCells(fastest, fastest);
    const steps = Math.min(MAX_SUB, Math.max(Math.ceil(dt / MAX_STEP), Math.ceil(dt * Math.max(c.cols, c.rows) / 0.5)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const piece of live) if (!piece.gone) this.move(piece, h, world, KINDS[piece.kind]);
      const t = (i + 1) / steps;
      for (const w of near) {
        w.x = w.x0 + (w.x1 - w.x0) * t;
        w.y = w.y0 + (w.y1 - w.y0) * t;
        for (const piece of live) if (!piece.gone) this.meetBody(piece, w, world);
      }
      for (let a = 0; a < live.length; a++) {
        for (let b = a + 1; b < live.length; b++) {
          if (!live[a].gone && !live[b].gone) this.meetPiece(live[a], live[b], world);
        }
      }
    }
    for (const piece of live) if (!piece.gone) this.settle(piece, dt);
  }

  // Whether a body's way this frame passes anywhere near a piece.
  within(piece, w) {
    const reach = toCells(piece.length / 2 + piece.radius + w.wade.radius + 0.1, piece.length / 2 + piece.radius +
      w.wade.radius + 0.1);
    return Math.max(w.x0, w.x1) > piece.x - reach.cols - 2 && Math.min(w.x0, w.x1) < piece.x + reach.cols + 2 &&
      Math.max(w.y0, w.y1) > piece.y - reach.rows - 2 && Math.min(w.y0, w.y1) < piece.y + reach.rows + 2;
  }

  // A piece's bob, age and fade over a frame.
  settle(piece, dt) {
    const k = KINDS[piece.kind];
    const bob = bobStep(piece.draft, piece.goingDown, k.draft[0], k.draft[1], (k.draft[1] - k.draft[0]) / RISE_TIME, dt);
    piece.draft = Math.max(k.draft[0] - 0.02, Math.min(0.85, bob.draft));
    piece.goingDown = bob.goingDown;
    piece.age += dt;
    piece.knock = Math.max(0, piece.knock - dt);
    // Fading in where it was set adrift in sight, and out when old.
    piece.appear = Math.min(1, piece.appear + dt / APPEAR_TIME);
    if (piece.age > LIFETIME) piece.life -= dt;
    piece.fade = Math.min(piece.appear, piece.life, 1 - piece.beached / BEACH_TIME);
    if (piece.life <= 0) this.remove(piece);
  }

  // The current an end of a piece feels: the water's own velocity, plus a
  // share of the outward set on a bend (+ toward the left bank).
  current(world, x, y, out) {
    const f = world.flowAt(x, y, AT);
    const set = SECONDARY * f.secondary * f.speed;
    out.x = f.x * f.speed + f.y * set;
    out.y = f.y * f.speed - f.x * set;
    out.speed = f.speed;
    out.river = f.river;
    return out;
  }

  move(piece, h, world, k) {
    const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle);
    const half = toCells(ax * piece.length / 2, ay * piece.length / 2);
    const ends = [[piece.x - half.cols, piece.y - half.rows], [piece.x + half.cols, piece.y + half.rows]];
    // An end resting on the bank feels the water under the middle instead.
    let w0 = this.current(world, ends[0][0], ends[0][1], END[0]);
    let w1 = this.current(world, ends[1][0], ends[1][1], END[1]);
    if (!w0.river || !w1.river) {
      const wc = this.current(world, piece.x, piece.y, MID);
      if (!w0.river) w0 = wc;
      if (!w1.river) w1 = wc;
    }
    const wx = (w0.x + w1.x) / 2, wy = (w0.y + w1.y) / 2;
    const ease = 1 - Math.exp(-piece.drag * h);
    const onWater = world.typeAt(piece.x, piece.y) === WATER;
    if (!onWater) {
      // Stranded on land: it stops and fades away.
      piece.vx = piece.vy = piece.spin = 0;
      piece.beached += h;
      if (piece.beached >= BEACH_TIME) this.remove(piece);
      return;
    }
    if (piece.snag) {
      this.swing(piece, h, ends, [w0, w1], ease, world);
      return;
    }
    piece.vx += (wx - piece.vx) * ease;
    piece.vy += (wy - piece.vy) * ease;
    // Turning: the end in faster water runs ahead, the piece turns to lie
    // along the flow, and one lying square across it is nudged off balance.
    const flowSpeed = Math.hypot(wx, wy);
    const share = Math.min(1, flowSpeed / BASE_SPEED);
    let target = (ax * (w1.y - w0.y) - ay * (w1.x - w0.x)) / piece.length;
    if (flowSpeed > 1e-3) {
      const delta = Math.atan2(wy, wx) - piece.angle;
      target += ALIGN * Math.sin((piece.symmetric ? 2 : 1) * delta) * share;
      if (Math.abs(Math.cos(delta)) < Math.sin(10 * Math.PI / 180)) target += ALIGN_KICK * piece.bias * share;
    }
    piece.spin += (target - piece.spin) * ease;
    piece.angle += piece.spin * h;
    const back = this.returnFrom(piece, world);
    const d = toCells((piece.vx + back.x) * h, (piece.vy + back.y) * h);
    piece.x += d.cols;
    piece.y += d.rows;
    this.collide(piece, h, world);
    // Coming to rest on still water, it soaks up and sinks.
    const still = world.flowAt(piece.x, piece.y, AT).speed === 0;
    const v = Math.hypot(piece.vx, piece.vy);
    if (still && v < 0.02) {
      piece.sinking += h / k.sink;
      if (piece.sinking >= 1) {
        this.splashes?.ring(piece.x, piece.y, 0.3, 0, true);
        this.remove(piece);
      }
    } else if (!still) {
      // Wedged fast in running water: eased off toward the middle and
      // turned to lie along the current, so it works itself free.
      piece.slow = v < 0.02 ? piece.slow + h : 0;
      if (piece.slow > WEDGED) {
        const f = world.flowAt(piece.x, piece.y, AT);
        const s = -Math.sign(f.across) || 1;
        const m = toCells(f.y * s * 0.1 * h, -f.x * s * 0.1 * h);
        piece.x += m.cols;
        piece.y += m.rows;
        const delta = Math.atan2(f.y, f.x) - piece.angle;
        piece.angle += Math.sin((piece.symmetric ? 2 : 1) * delta) * h;
      }
    }
  }

  // A piece shoved out toward a bank works its way back into the current:
  // past RETURN_TO of the half-width, a while after its last shove, it
  // edges in toward the middle at this (ground m/s), easing off as it
  // comes, on top of its drift. This is the game's own stand-in for the
  // eddies that keep floating things off a straight bank; it is too weak to
  // stop the set toward the outer bank of a bend.
  returnFrom(piece, world) {
    if (!(piece.age - piece.pushed > RETURN_WAIT)) return MID_RETURN;
    const f = world.flowAt(piece.x, piece.y, AT);
    const out = Math.abs(f.across) - RETURN_TO;
    if (!f.river || !(f.halfWidth > 0) || !(out > 0)) return MID_RETURN;
    const s = -Math.sign(f.across) * this.returnSpeed * Math.min(1, out / RETURN_EASE);
    return { x: f.y * s, y: -f.x * s };
  }

  // A snagged piece turns about its caught end until it trails downstream.
  // All along it still meets the banks and stones: a turn that would drive
  // its hull further into them is undone, and it knocks back off them instead.
  swing(piece, h, ends, w, ease, world) {
    const pin = piece.snag.end;
    const before = { x: piece.x, y: piece.y, angle: piece.angle, against: this.penetration(piece, world) };
    const free = 1 - pin;
    const g = toGround((ends[free][0] - piece.snag.x) * ASPECT, ends[free][1] - piece.snag.y);
    const len = Math.hypot(g.x, g.y) || piece.length;
    // The free end is dragged by the water, along the circle round the pin.
    const tx = -g.y / len, ty = g.x / len;
    const along = (w[free].x * tx + w[free].y * ty);
    piece.spin += (along / len - piece.spin) * ease;
    const a = Math.atan2(g.y, g.x) + piece.spin * h;
    piece.angle = pin === 0 ? a : a + Math.PI;
    const c = toCells(Math.cos(a) * piece.length / 2, Math.sin(a) * piece.length / 2);
    piece.x = piece.snag.x + c.cols;
    piece.y = piece.snag.y + c.rows;
    piece.vx = piece.vy = 0;
    if (this.penetration(piece, world) > before.against + 1e-9) {
      const hit = Math.abs(piece.spin) * len;
      piece.x = before.x; piece.y = before.y; piece.angle = before.angle;
      piece.spin *= -RESTITUTION;
      if (hit > RING_SPEED && piece.knock <= 0) {
        piece.knock = KNOCK_REST;
        this.splashes?.ring(ends[free][0], ends[free][1], 0.25 + 3 * hit, 0, true);
      }
    }
    const flowHeading = Math.atan2(w[free].y, w[free].x);
    const trails = Math.cos(flowHeading - a) > Math.cos(15 * Math.PI / 180);
    piece.snag.aligned = trails ? piece.snag.aligned + h : 0;
    if (piece.age >= piece.snag.until || piece.snag.aligned >= 1) {
      piece.lastSnag = piece.age;
      piece.snag = null;
    }
  }

  // How far a piece's whole hull reaches into what it can hit (layout
  // units): each probe's depth into the land, and its capsule's into each
  // stone. A snagged piece's caught end, which lies against whatever caught
  // it and only turns about it, is left out. The same probes at every
  // heading, so a turn alone does not change their number.
  penetration(piece, world) {
    const stations = Math.max(2, Math.ceil(toCells(piece.length, 0).cols) + 1);
    const caught = !piece.snag ? -1 : piece.snag.end ? stations - 1 : 0;
    let depth = 0;
    this.probes(piece, (px, py, i) => {
      if (i !== caught) depth += this.landDepth(world, px, py);
    }, stations);
    // A stone counts as far as the hull reaches deeper into it than the
    // caught end does.
    const pin = piece.snag && { ...piece, x: piece.snag.x, y: piece.snag.y, length: 0 };
    for (const stone of this.stonesNear(world, piece.x, piece.y)) {
      const held = pin ? Math.max(0, this.stoneOverlap(pin, stone).overlap) : 0;
      depth += Math.max(0, this.stoneOverlap(piece, stone).overlap - held);
    }
    return depth;
  }

  // Moves a piece by a meeting's push (ground metres) only as far as its
  // hull stays as clear of the banks and stones as it was: the push is
  // halved till it does, or dropped. Returns the share of it made.
  shift(piece, world, gx, gy) {
    const x = piece.x, y = piece.y;
    const before = this.penetration(piece, world);
    const m = toCells(gx, gy);
    for (let share = 1; share >= 0.25; share /= 2) {
      piece.x = x + m.cols * share;
      piece.y = y + m.rows * share;
      if (this.penetration(piece, world) <= before + 1e-9) return share;
    }
    piece.x = x;
    piece.y = y;
    return 0;
  }

  unsnag(piece) {
    piece.lastSnag = piece.age;
    piece.snag = null;
  }

  // A wading body against a piece's hull: the piece is pushed clear of its
  // legs by its share of the overlap and, met coming on, takes an impulse
  // shared by mass that sends it off and turns it, while the body is
  // slid back a little. A hard enough shove frees a snagged piece.
  meetBody(piece, w, world) {
    const rb = w.wade.radius;
    const b = toGround((w.x - piece.x) * ASPECT, w.y - piece.y);
    const reach = piece.length / 2 + piece.radius + rb;
    if (Math.abs(b.x) > reach || Math.abs(b.y) > reach) return;
    const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle), half = piece.length / 2;
    const c = segmentPoint(b.x, b.y, -ax * half, -ay * half, ax * half, ay * half);
    let nx = c.x - b.x, ny = c.y - b.y;
    const d = Math.hypot(nx, ny);
    const overlap = rb + piece.radius - d;
    if (overlap <= 0) return;
    if (d < 1e-4) {
      // Square onto the axis, on the side the body comes from.
      const s = Math.sign(w.vx * -ay + w.vy * ax) || 1;
      nx = -ay * s; ny = ax * s;
    } else { nx /= d; ny /= d; }
    const pvx = piece.vx - piece.spin * c.y, pvy = piece.vy + piece.spin * c.x;
    const vn = (w.vx - pvx) * nx + (w.vy - pvy) * ny;
    if (piece.snag && vn > SNAG_FREE) this.unsnag(piece);
    const inv = invMass(piece), invBody = 1 / w.wade.mass;
    if (inv > 0) {
      const push = Math.min(BODY_PUSH, overlap * inv / (inv + invBody));
      this.shift(piece, world, nx * push, ny * push);
    }
    piece.pushed = piece.age;
    if (!(vn > 0)) return;
    const lever = c.x * ny - c.y * nx;
    const invI = invInertia(piece);
    const j = impulse(vn, BODY_RESTITUTION, inv, invBody, lever, invI);
    piece.vx += j * inv * nx;
    piece.vy += j * inv * ny;
    piece.spin = kick(piece.spin, lever * j * invI);
    addBump(w.body, -FOOTING * j * invBody * nx, -FOOTING * j * invBody * ny);
    this.lastShove = { body: w.body, piece, vn, dv: j * inv };
    const at = toCells(c.x - nx * piece.radius, c.y - ny * piece.radius);
    this.knocked(piece, w.body, piece.x + at.cols, piece.y + at.rows, vn, BODY_RING, true);
  }

  // Two pieces' hulls against each other: pushed apart by their shares of
  // the overlap, and met coming on, an impulse shared by mass. A held piece
  // gives way to nothing short of a shove that frees it.
  meetPiece(a, b, world) {
    const o = toGround((b.x - a.x) * ASPECT, b.y - a.y);
    const reach = (a.length + b.length) / 2 + a.radius + b.radius;
    if (Math.abs(o.x) > reach || Math.abs(o.y) > reach) return;
    const ha = a.length / 2, hb = b.length / 2;
    const aax = Math.cos(a.angle), aay = Math.sin(a.angle), bbx = Math.cos(b.angle), bby = Math.sin(b.angle);
    const q = segmentSegment(-aax * ha, -aay * ha, aax * ha, aay * ha,
      o.x - bbx * hb, o.y - bby * hb, o.x + bbx * hb, o.y + bby * hb);
    let nx = q.bx - q.ax, ny = q.by - q.ay;
    const d = Math.hypot(nx, ny);
    const overlap = a.radius + b.radius - d;
    if (overlap <= 0) return;
    if (d < 1e-4) {
      const s = Math.sign(o.x * -aay + o.y * aax) || 1;
      nx = -aay * s; ny = aax * s;
    } else { nx /= d; ny /= d; }
    const rbx = q.bx - o.x, rby = q.by - o.y;
    const vax = a.vx - a.spin * q.ay, vay = a.vy + a.spin * q.ax;
    const vbx = b.vx - b.spin * rby, vby = b.vy + b.spin * rbx;
    const vn = (vax - vbx) * nx + (vay - vby) * ny;
    if (a.snag && vn > SNAG_FREE) this.unsnag(a);
    if (b.snag && vn > SNAG_FREE) this.unsnag(b);
    const wa = invMass(a), wb = invMass(b);
    if (!(wa + wb > 0)) return;
    const pa = Math.min(BODY_PUSH, overlap * wa / (wa + wb)), pb = Math.min(BODY_PUSH, overlap * wb / (wa + wb));
    if (pa > 0) this.shift(a, world, -nx * pa, -ny * pa);
    if (pb > 0) this.shift(b, world, nx * pb, ny * pb);
    a.pushed = a.age;
    b.pushed = b.age;
    if (!(vn > 0)) return;
    const la = q.ax * ny - q.ay * nx, lb = rbx * ny - rby * nx;
    const ia = invInertia(a), ib = invInertia(b);
    const j = impulse(vn, PIECE_RESTITUTION, wa, wb, la, ia, lb, ib);
    a.vx -= j * wa * nx; a.vy -= j * wa * ny;
    b.vx += j * wb * nx; b.vy += j * wb * ny;
    a.spin = kick(a.spin, -la * j * ia);
    b.spin = kick(b.spin, lb * j * ib);
    const at = toCells(q.ax + nx * a.radius, q.ay + ny * a.radius);
    if (this.knocked(a, b, a.x + at.cols, a.y + at.rows, vn, RING_SPEED, false)) {
      b.draft = Math.min(0.85, b.draft + 0.1);
      b.goingDown = true;
    }
  }

  // A knock at a point (cells) at `vn` m/s: above `ring`, and not straight
  // after the last between the same two, it cuts a ring of ripples, dips the
  // piece, and with `sound` splashes. Returns whether it did.
  knocked(piece, other, x, y, vn, ring, sound) {
    if (!(vn > ring) || (piece.hits.get(other) ?? -Infinity) > piece.age) return false;
    piece.hits.set(other, piece.age + HIT_REST);
    this.splashes?.ring(x, y, 0.2 + 2 * vn, 0, true);
    if (this.splashes) this.splashes.world ??= this.world;
    piece.draft = Math.min(0.85, piece.draft + 0.1);
    piece.goingDown = true;
    if (sound) this.events.push({ type: 'splash', x, y, strength: Math.min(0.8, 0.15 + 0.4 * vn * Math.sqrt(piece.mass)) });
    return true;
  }

  // How far a point (cells) lies inside the land: the layout distance to the
  // nearest water cell, searched ring by ring out to LAND_REACH cells.
  landDepth(world, x, y) {
    if (world.typeAt(x, y) === WATER) return 0;
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = LAND_REACH + 1;
    for (let r = 1; r <= LAND_REACH && best > (r - 1) * ASPECT; r++) {
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r || world.typeAt(cx + i + 0.5, cy + j + 0.5) !== WATER) continue;
          const dx = Math.max(cx + i - x, 0, x - (cx + i + 1)) * ASPECT;
          const dy = Math.max(cy + j - y, 0, y - (cy + j + 1));
          best = Math.min(best, Math.hypot(dx, dy));
        }
      }
    }
    return best;
  }

  // Probes along the hull no more than a cell apart along its axis (or at
  // `stations` evenly), on its middle and both sides, each handed to
  // `fn(x, y, station)` (cells).
  probes(piece, fn, stations = 0) {
    const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle);
    const g = toCells(ax, ay);
    const lenCells = Math.hypot(g.cols * piece.length, g.rows * piece.length);
    stations ||= Math.max(2, Math.ceil(lenCells) + 1);
    const side = toCells(-ay * piece.radius, ax * piece.radius);
    for (let i = 0; i < stations; i++) {
      const t = i / (stations - 1) - 0.5;
      for (const sgn of [0, -1, 1]) {
        fn(piece.x + g.cols * piece.length * t + side.cols * sgn, piece.y + g.rows * piece.length * t + side.rows * sgn, i);
      }
    }
  }

  // The hull's capsule against a stone's circle, in layout space: how far
  // it reaches in, and the closest point of its axis.
  stoneOverlap(piece, stone) {
    const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle);
    const g = toCells(ax, ay);
    const side = toCells(-ay * piece.radius, ax * piece.radius);
    const sx = stone.x * ASPECT, sy = stone.y;
    const lx = piece.x * ASPECT, ly = piece.y;
    const ex = g.cols * ASPECT * piece.length, ey = g.rows * piece.length;
    const len2 = ex * ex + ey * ey || 1;
    const t = Math.max(-0.5, Math.min(0.5, ((sx - lx) * ex + (sy - ly) * ey) / len2));
    const cx = lx + ex * t, cy = ly + ey * t;
    const dist = Math.hypot(cx - sx, cy - sy);
    return { overlap: stone.r + Math.hypot(side.cols * ASPECT, side.rows) - dist, cx, cy, dist };
  }

  // The hull against the banks and the stones in the river.
  collide(piece, h, world) {
    const centre = world.flowAt(piece.x, piece.y, AT);
    // Square across the current, toward its left bank.
    const river = centre.river && centre.halfWidth > 0;
    const lx = centre.y, ly = -centre.x;
    let touched = false;
    let pushX = 0, pushY = 0, count = 0, contactX = 0, contactY = 0;
    this.probes(piece, (px, py) => {
      if (world.typeAt(px, py) === WATER) return;
      const o = toGround((piece.x - px) * ASPECT, piece.y - py);
      if (river) {
        // Away from the bank the probe lies on, toward the middle.
        const q = centre.across - (o.x * lx + o.y * ly) / centre.halfWidth;
        const s = q > 0 ? -1 : 1;
        pushX += lx * s; pushY += ly * s;
      } else {
        // Off the current: back toward the piece's middle.
        const l = Math.hypot(o.x, o.y) || 1;
        pushX += o.x / l; pushY += o.y / l;
      }
      contactX += px; contactY += py; count++;
    });
    const net = Math.hypot(pushX, pushY);
    if (count && net > 1e-6) {
      touched = true;
      // Held from both sides at once, it is pushed only by the difference.
      this.contact(piece, pushX / net, pushY / net, contactX / count, contactY / count, Math.min(MAX_PUSH, PROBE_PUSH * net), h,
        'bank', centre);
    }
    // Stones: the hull's capsule against each stone's circle, in layout space.
    for (const stone of this.stonesNear(world, piece.x, piece.y)) {
      const sx = stone.x * ASPECT, sy = stone.y;
      const { overlap, cx, cy, dist } = this.stoneOverlap(piece, stone);
      if (overlap <= 0) continue;
      touched = true;
      const o = toGround((cx - sx) / (dist || 1), (cy - sy) / (dist || 1));
      const l = Math.hypot(o.x, o.y) || 1;
      const push = Math.min(STONE_PUSH, toGround(overlap, 0).x);
      this.contact(piece, o.x / l, o.y / l, sx / ASPECT + (cx - sx) / ASPECT * stone.r / (dist || 1),
        sy + (cy - sy) * stone.r / (dist || 1), push, h, 'stone', centre);
    }
    piece.touching = touched;
  }

  stonesNear(world, x, y) {
    const cx = Math.floor(x / RIVER_CHUNK), cy = Math.floor(y / RIVER_CHUNK);
    const key = `${cx},${cy}`;
    let stones = this.stones.get(key);
    if (!stones) {
      stones = world.rivers.stonesNear(cx, cy);
      this.stones.set(key, stones);
      if (this.stones.size > 16) this.stones.delete(this.stones.keys().next().value);
    }
    return stones;
  }

  // One contact along normal (nx, ny) (ground, away from what was hit) at a
  // point (cells): pushed clear, its speed into it taken away with a little
  // bounce, sliding on along it, turned about it, and knocked hard enough it
  // cuts a ring of ripples, dips, and may snag.
  contact(piece, nx, ny, x, y, push, h, what, flow) {
    const m = toCells(nx * push, ny * push);
    piece.x += m.cols;
    piece.y += m.rows;
    const vn = piece.vx * nx + piece.vy * ny;
    if (vn < 0) {
      const tx = piece.vx - vn * nx, ty = piece.vy - vn * ny;
      const slide = SLIDE ** h;
      const j = -(1 + RESTITUTION) * vn;
      piece.vx = tx * slide - RESTITUTION * vn * nx;
      piece.vy = ty * slide - RESTITUTION * vn * ny;
      // The impulse turns the rod about its middle.
      const r = toGround((x - piece.x) * ASPECT, y - piece.y);
      piece.spin += (r.x * ny * j - r.y * nx * j) / (piece.length * piece.length / 12) * 0.02;
      if (-vn > RING_SPEED && piece.knock <= 0) {
        piece.knock = KNOCK_REST;
        this.splashes?.ring(x, y, 0.25 + 3 * -vn, 0, true);
        if (this.splashes) this.splashes.world ??= this.world;
        piece.draft = Math.min(0.85, piece.draft + 0.1);
        piece.goingDown = true;
        this.maybeSnag(piece, nx, ny, x, y, what, flow);
      }
    }
  }

  maybeSnag(piece, nx, ny, x, y, what, flow) {
    if (piece.snag || piece.age - piece.lastSnag <= SNAG_REST) return;
    if (what === 'bank') {
      if (!(flow.bend >= SNAG_BEND)) return;
      // Only on the outer bank: the one the water sets toward.
      const sx = flow.y * flow.secondary, sy = -flow.x * flow.secondary;
      if (-(nx * sx + ny * sy) <= 0) return;
    }
    if (this.random() >= SNAG_CHANCE[what]) return;
    const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle);
    const r = toGround((x - piece.x) * ASPECT, y - piece.y);
    const end = r.x * ax + r.y * ay < 0 ? 0 : 1;
    const half = toCells(ax * piece.length / 2, ay * piece.length / 2);
    const [lo, hi] = SNAG_TIME[what];
    piece.snag = { end, until: piece.age + lo + this.random() * (hi - lo), aligned: 0,
      x: piece.x + (end ? half.cols : -half.cols), y: piece.y + (end ? half.rows : -half.rows) };
    piece.vx = piece.vy = 0;
  }

  // The pieces worth drawing in a view.
  visible(view) {
    return this.list.filter((p) => inZone(view, p.x, p.y, { cols: 16, rows: 10 }));
  }

  // How far down a piece rides: its bob, deeper as it sinks.
  drawDraft(piece) {
    return Math.min(1, piece.draft + piece.sinking * (1 - piece.draft));
  }

  // Whether a cell of a piece shows at its fade. Fading in or out, a piece
  // comes and goes cell by cell, the same cells first each time, so at no
  // fade nothing of it is drawn and the water behind shows through.
  shows(piece, x, y, salt = 0) {
    return hash2(x, y, piece.id * 7 + salt) < piece.fade;
  }

  // A piece in small letters on the fine grid: what is above the water on
  // a dark backdrop with its outline of nothing, growing from none at the
  // waterline; what is under it dim and seen through the water.
  draw(r, view, piece) {
    const baked = this.bakeFor(piece);
    if (!baked || piece.fade <= 0) return;
    const draft = this.drawDraft(piece);
    const sinkRows = draft * piece.model.top * SCALE;
    const fade = piece.fade;
    if (!r.fine) {
      const bx = Math.floor(piece.x) - view.x0;
      const by = Math.floor(piece.y + sinkRows) - view.y0;
      for (const c of baked.cells) {
        if ((c.h ?? 1) < draft || !this.shows(piece, c.dx, c.dy)) continue;
        putCell(r, bx + c.dx, by + c.dy, c.g, c.r * fade, c.gg * fade, c.b * fade, by, c.br, c.bgG, c.bb);
      }
      return;
    }
    const fx0 = Math.floor(piece.x * FINE) - view.x0 * FINE;
    const fy0 = Math.round((piece.y + sinkRows) * FINE) - view.y0 * FINE - 1;
    let lastH = 1;
    for (const c of baked.fine) {
      const h = c.h ?? lastH;
      lastH = h;
      if (!this.shows(piece, c.dx, c.dy)) continue;
      const fx = fx0 + c.dx, fy = fy0 + c.dy;
      if (h < draft) {
        // Under the surface: dim, toward the colour of the water above it,
        // more so as it fades, and no backdrop.
        const w = 0.35 * fade;
        const under = this.waterColour(r, fx, fy);
        r.fineAt(fx, fy, c.g, c.r * w + under[0] * (1 - w), c.gg * w + under[1] * (1 - w),
          c.b * w + under[2] * (1 - w), undefined, undefined, undefined, 0);
        continue;
      }
      const halo = Math.round(15 * Math.max(0, Math.min(1, (h - draft) / 0.5)) * fade);
      r.fineAt(fx, fy, c.g, c.r * fade, c.gg * fade, c.b * fade,
        c.br === undefined ? undefined : c.br * fade, c.bgG === undefined ? undefined : c.bgG * fade,
        c.bb === undefined ? undefined : c.bb * fade, halo);
    }
  }

  // The colour of the water's own letter in the cell under a small cell.
  waterColour(r, fx, fy) {
    const x = Math.floor(fx / FINE), y = Math.floor(fy / FINE);
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return UNDER;
    const i = (y * r.cols + x) * 4;
    if (!r.fg[i + 3]) return UNDER;
    WATER_INK[0] = r.fg[i]; WATER_INK[1] = r.fg[i + 1]; WATER_INK[2] = r.fg[i + 2];
    return WATER_INK;
  }

  // Its mirror image in the water, each cell about its own waterline.
  reflect(r, view, piece, mirror) {
    const baked = this.bakeFor(piece);
    if (!baked) return;
    const draft = this.drawDraft(piece);
    const sink = draft * piece.model.top * SCALE;
    const bx = Math.floor(piece.x) - view.x0;
    const y = piece.y - view.y0;
    let lastH = 1, lastDepth = 0;
    for (const c of baked.cells) {
      const h = c.h ?? lastH;
      const depth = c.depth ?? lastDepth;
      lastH = h; lastDepth = depth;
      if (h < draft || !this.shows(piece, c.dx, c.dy, 1)) continue;
      mirror(r, bx + c.dx, Math.floor(y + sink + c.dy), c.g, c.r * piece.fade, c.gg * piece.fade, c.b * piece.fade,
        Math.floor(y + depth));
    }
  }

  // Foam hugging each piece's waterline, heavier on its upstream side, and a
  // V of ripples spreading downstream of it as the water runs past. A piece
  // drifting with the current throws almost none; a snagged one, plenty.
  drawSurface(r, view, time) {
    const world = this.world;
    if (!world) return;
    for (const piece of this.list) {
      if (!inZone(view, piece.x, piece.y, { cols: 16, rows: 10 })) continue;
      const f = world.flowAt(piece.x, piece.y, AT);
      const rx = f.x * f.speed - piece.vx, ry = f.y * f.speed - piece.vy;
      const rel = Math.hypot(rx, ry);
      const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle);
      const reach = piece.length / 2 + 0.12;
      const c = toCells(reach, reach);
      const weight = (0.15 + 2 * rel) * piece.fade;
      const tick = Math.floor(time * 3);
      for (let wy = Math.floor(piece.y - c.rows - 1); wy <= Math.ceil(piece.y + c.rows + 1); wy++) {
        for (let wx = Math.floor(piece.x - c.cols - 1); wx <= Math.ceil(piece.x + c.cols + 1); wx++) {
          const sx = wx - view.x0, sy = wy - view.y0;
          if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) continue;
          const cell = sy * r.cols + sx;
          if (r.mask[cell] !== WATER || FLOATING[r.glyphAt(cell)]) continue;
          const o = toGround((wx + 0.5 - piece.x) * ASPECT, wy + 0.5 - piece.y);
          const along = Math.max(-piece.length / 2, Math.min(piece.length / 2, o.x * ax + o.y * ay));
          const dist = Math.hypot(o.x - ax * along, o.y - ay * along);
          if (dist < piece.radius * 0.6 || dist > piece.radius + 0.07) continue;
          const upstream = rel > 1e-3 && (o.x * rx + o.y * ry) < 0 ? 1.6 : 1;
          if (hash2(wx, wy, tick + piece.id * 31) >= Math.min(0.85, weight * 0.5 * upstream)) continue;
          const k = 0.55 + 0.3 * Math.min(1, rel * 3);
          r.layerAt(cell, FOAM[Math.floor(hash2(wx, wy, piece.id) * FOAM.length)], CREST[0] * k, CREST[1] * k,
            CREST[2] * k);
        }
      }
      if (rel > 0.08) this.drawWake(r, view, piece, rx / rel, ry / rel, rel, time);
    }
  }

  drawWake(r, view, piece, dx, dy, rel, time) {
    const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle);
    // How wide the piece stands across the water running past it.
    const across = Math.abs(ax * -dy + ay * dx) * piece.length / 2 + piece.radius;
    const length = Math.min(6, 1 + 12 * rel);
    const steps = Math.ceil(length * 2);
    for (let i = 1; i <= steps; i++) {
      const along = i / steps * length / (SCALE * TILT);
      for (const s of [-1, 1]) {
        const out = across + along * 0.36;
        const gx = dx * along - dy * s * out, gy = dy * along + dx * s * out;
        const c = toCells(gx, gy);
        const wx = Math.floor(piece.x + c.cols), wy = Math.floor(piece.y + c.rows);
        const sx = wx - view.x0, sy = wy - view.y0;
        if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) continue;
        const cell = sy * r.cols + sx;
        if (r.mask[cell] !== WATER || FLOATING[r.glyphAt(cell)]) continue;
        if (((i + Math.floor(time * 6)) & 3) === 3 || !this.shows(piece, i, s, 2)) continue;
        const k = (0.75 - 0.4 * i / steps) * Math.min(1, rel * 4);
        const g = VEE[screenOrientation(dx - dy * s * 0.36, dy + dx * s * 0.36)];
        r.layerAt(cell, g, CREST[0] * k, CREST[1] * k, CREST[2] * k);
      }
    }
  }
}

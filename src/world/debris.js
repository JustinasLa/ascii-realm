import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { FINE, putCell } from '../render/cells.js';
import { family } from '../render/glyphs.js';
import { bakePiece, pieceModel } from './debris-art.js';
import { BASE_SPEED, RIVER_CHUNK, screenOrientation, toCells, toGround } from './rivers.js';
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
// Positions are cells (x columns, y rows); velocities and sizes are ground
// metres, as flowAt gives them; stones and banks are met in layout space.

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

// Kinds: how often each comes down, its length and half-thickness in metres,
// how quickly it takes up the water's speed (heavy logs lag), how long it
// takes to sink at rest in a lake, and its bob between two drafts.
export const KINDS = Object.freeze({
  log: { weight: 35, length: [0.3, 0.55], radius: [0.06, 0.09], drag: 0.8, sink: 20, symmetric: true, draft: [0.4, 0.6] },
  branch: { weight: 25, length: [0.2, 0.4], radius: [0.03, 0.03], drag: 1.5, sink: 12, draft: [0.3, 0.45] },
  mat: { weight: 20, length: [0.12, 0.25], radius: [0.06, 0.1], drag: 2.5, sink: 6, draft: [0.3, 0.45] },
  reeds: { weight: 15, length: [0.15, 0.28], radius: [0.03, 0.03], drag: 2, sink: 8, draft: [0.3, 0.45] },
  crate: { weight: 3, length: [0.18, 0.26], radius: [0.05, 0.05], drag: 1.2, sink: 15, draft: [0.4, 0.6] },
  stave: { weight: 2, length: [0.2, 0.28], radius: [0.04, 0.04], drag: 1.2, sink: 15, draft: [0.4, 0.6] },
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
  // rings of knocks; `weather` speeds the spawner up in and after storms.
  update(dt, world, view, player, weather = null, splashes = null) {
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
    for (const piece of this.list) this.step(piece, dt, world, view);
    this.list = this.list.filter((p) => !p.gone);
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

  step(piece, dt, world, view) {
    if (!inZone(view, piece.x, piece.y, SIM_MARGIN) || !footprintLoaded(world, piece.x, piece.y, piece.length)) {
      this.remove(piece);
      return;
    }
    const k = KINDS[piece.kind];
    // Long frames are taken in short steps, none moving a piece more than
    // half a cell, so it cannot jump a narrow spit of bank.
    const speed = Math.hypot(piece.vx, piece.vy) + 1;
    const c = toCells(speed, speed);
    const steps = Math.min(8, Math.max(Math.ceil(dt / MAX_STEP), Math.ceil(dt * Math.max(c.cols, c.rows) / 0.5)));
    const h = dt / steps;
    for (let i = 0; i < steps && !piece.gone; i++) this.move(piece, h, world, k);
    if (piece.gone) return;
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
    const d = toCells(piece.vx * h, piece.vy * h);
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

  // A snagged piece turns about its caught end until it trails downstream.
  // Its free half still meets the banks and stones: a turn that would drive
  // it further into them is undone, and it knocks back off them instead.
  swing(piece, h, ends, w, ease, world) {
    const pin = piece.snag.end;
    const before = { x: piece.x, y: piece.y, angle: piece.angle, against: this.embedded(this.freeHalf(piece), world) };
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
    if (this.embedded(this.freeHalf(piece), world) > before.against + 1e-9) {
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

  // The half of a snagged piece away from its caught end, which lies against
  // whatever caught it.
  freeHalf(piece) {
    const s = piece.snag.end ? -1 : 1;
    const q = toCells(Math.cos(piece.angle) * piece.length / 4, Math.sin(piece.angle) * piece.length / 4);
    return { x: piece.x + s * q.cols, y: piece.y + s * q.rows, angle: piece.angle, length: piece.length / 2,
      radius: piece.radius };
  }

  // Probes along the hull no more than a cell apart along its axis, on
  // its middle and both sides, each handed to `fn(x, y)` (cells).
  probes(piece, fn) {
    const ax = Math.cos(piece.angle), ay = Math.sin(piece.angle);
    const g = toCells(ax, ay);
    const lenCells = Math.hypot(g.cols * piece.length, g.rows * piece.length);
    const stations = Math.max(2, Math.ceil(lenCells) + 1);
    const side = toCells(-ay * piece.radius, ax * piece.radius);
    for (let i = 0; i < stations; i++) {
      const t = i / (stations - 1) - 0.5;
      for (const sgn of [0, -1, 1]) {
        fn(piece.x + g.cols * piece.length * t + side.cols * sgn, piece.y + g.rows * piece.length * t + side.rows * sgn);
      }
    }
  }

  // How deep a piece's hull lies in what it can hit: its probes off the
  // water, and how far its capsule reaches into each stone (layout units).
  embedded(piece, world) {
    let depth = 0;
    this.probes(piece, (px, py) => {
      if (world.typeAt(px, py) !== WATER) depth++;
    });
    for (const stone of this.stonesNear(world, piece.x, piece.y)) depth += Math.max(0, this.stoneOverlap(piece, stone).overlap);
    return depth;
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

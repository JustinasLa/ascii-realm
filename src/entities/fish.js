import { hash2, mulberry32 } from '../core/rng.js';
import { CHUNK_SIZE, WATER } from '../world/world.js';
import { LOUDNESS, REGION, RING, lakeAt } from './animals.js';
import { inView } from './birds.js';
import { toCells, toMetres } from './monsters.js';

// Fish: small schools in the still, deeper water of lakes, never in a
// river's current. A leader cruises from spot to spot and pauses, and the
// rest follow it. The player coming near, wading in, or a shaft or a loud
// noise in the water sends the school darting apart, each fish its own
// way, sometimes breaking the surface in a ring; then they glide to a stop
// and drift back together. Positions are in cells, distances and speeds in
// metres, swim depth in metres below the surface.

const freeze = (o) => Object.freeze(o);

export const FISH = freeze({
  id: 'fish', name: 'Fish', role: 'ambient', locomotion: 'water',
  length: 0.38,
  school: freeze({ size: freeze([3, 5]), spacing: 0.35, follow: 1.2 }),
  // The least water a fish keeps to, metres, and the fastest it calls still,
  // metres a second.
  minDepth: 0.15, still: 0.12,
  // Swim depth, metres; cruise, metres a second; metres to each new spot;
  // seconds of a pause there.
  swim: freeze({ depth: freeze([0.08, 0.3]), cruise: 0.45, wander: freeze([1, 5]), pause: freeze([1, 4]) }),
  // Metres: the player near, running, or wading; a noise; a shaft landing.
  senses: freeze({ flee: 4, fleeRunning: 7, wade: 6, noise: 12, shot: 4 }),
  // A dart's speed, metres a second, and seconds; the spread, radians,
  // between the school's lines at most, and the widest any line strays from
  // straight away, so none darts back toward the threat; the chance it
  // breaks the surface; the seconds it holds still after.
  dart: freeze({ speed: freeze([2.6, 3.6]), time: freeze([0.35, 0.7]), spread: 1.2, fan: 1.25, ring: 0.3, regroup: freeze([3, 6]) }),
  // The chance of a school in a region with enough lake.
  chance: 0.7,
  clips: freeze({ swim: 'Armature|Swim' }),
  lengths: freeze({ swim: 1.2917 }),
  // The speed the swim clip moves the fish at its own pace: one tail beat a
  // loop, times the body length, times 0.7 (a tuning heuristic for how far a
  // beat carries a fish, not a measured rule).
  swimSpeed: (0.7 * 0.38) / 1.2917,
  rates: freeze([0.6, 2.6]),
});

export const MAX_SCHOOLS = 2;
// Seconds a scared school stays off cruising.
const SCARED = 6;
// Seconds a dart takes to glide to a stop.
const GLIDE = 0.6;
// A home is searched for this far round its seeded point, cells.
const SEARCH = { cols: 20, rows: 6 };
// Metres a fish keeps from anything that is not open lake water.
const MARGIN = 0.6;
const OUT = {};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const between = (random, [a, b]) => a + random() * (b - a);
const metres = (dx, dy) => Math.hypot(...toMetres(dx, dy));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const RING_OFFSETS = Array.from({ length: 6 }, (_, i) => toCells(Math.sin((i * Math.PI) / 3) * MARGIN, Math.cos((i * Math.PI) / 3) * MARGIN));
// Cells either way of a point that qualifies() reads: its ring of water
// round the point, plus the half cell the current blends over at each.
export const REACH = freeze({
  cols: Math.max(...RING_OFFSETS.map(([dx]) => Math.abs(dx))) + 0.5,
  rows: Math.max(...RING_OFFSETS.map(([, dy]) => Math.abs(dy))) + 0.5,
});

// Whether every chunk the checks below read is already generated: the
// point's own cell and the four cells the world's current blends between,
// half a cell either way, so a point near a chunk's edge never generates
// the next one.
function loadedAround(world, x, y) {
  if (!world.loaded) return false;
  for (let cy = Math.floor((y - 0.5) / CHUNK_SIZE); cy <= Math.floor((y + 0.5) / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor((x - 0.5) / CHUNK_SIZE); cx <= Math.floor((x + 0.5) / CHUNK_SIZE); cx++) {
      if (!world.loaded(cx, cy)) return false;
    }
  }
  return true;
}

// Whether a point is loaded lake water deep and still enough for a fish:
// no river line within a cell, and no current.
export function openWater(world, x, y) {
  if (!loadedAround(world, x, y)) return false;
  if (world.typeAt(x, y) !== WATER || world.waterDepthAt(x, y) < FISH.minDepth) return false;
  if (!lakeAt(world, x, y) || world.rivers?.near?.(x, y, 1)?.length) return false;
  return (world.flowAt?.(x, y, OUT)?.speed ?? 0) < FISH.still;
}

// A cell a fish may be at: open water, with open water all round it too.
export function qualifies(world, x, y) {
  if (!openWater(world, x, y)) return false;
  for (const [dx, dy] of RING_OFFSETS) if (!openWater(world, x + dx, y + dy)) return false;
  return true;
}

// The school a region holds, the same every time for a seed and region:
// rolled only where at least three of its nine samples are lake (not
// river). Null for none.
export function schoolOf(seed, rx, ry, world) {
  let lake = 0;
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      if (lakeAt(world, (rx + (i + 0.5) / 3) * REGION.cols, (ry + (j + 0.5) / 3) * REGION.rows)) lake++;
    }
  }
  if (lake < 3) return null;
  const random = mulberry32(Math.floor(hash2(rx, ry, seed + 7717) * 2 ** 32));
  if (random() >= FISH.chance) return null;
  const [lo, hi] = FISH.school.size;
  const size = lo + Math.floor(random() * (hi - lo + 1));
  const start = { x: (rx + 0.2 + random() * 0.6) * REGION.cols, y: (ry + 0.2 + random() * 0.6) * REGION.rows };
  return { key: `${rx},${ry}`, start, size, seed: Math.floor(random() * 2 ** 31) };
}

// The school's home: the qualifying cell nearest its seeded start. Undefined
// while any chunk the search reads has not loaded, the search box plus the
// reach of qualifies() round each cell in it (ask again later), so the
// answer never depends on which chunks loaded first; null if the region
// has none.
export function homeWater(world, roll) {
  const { start } = roll;
  const x0 = Math.floor(start.x) + 0.5;
  const y0 = Math.floor(start.y) + 0.5;
  const cols = SEARCH.cols + REACH.cols;
  const rows = SEARCH.rows + REACH.rows;
  for (let cy = Math.floor((y0 - rows) / CHUNK_SIZE); cy <= Math.floor((y0 + rows) / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor((x0 - cols) / CHUNK_SIZE); cx <= Math.floor((x0 + cols) / CHUNK_SIZE); cx++) {
      if (!world.loaded?.(cx, cy)) return undefined;
    }
  }
  const spots = [];
  for (let dy = -SEARCH.rows; dy <= SEARCH.rows; dy++) {
    for (let dx = -SEARCH.cols; dx <= SEARCH.cols; dx += 2) spots.push([dx, dy, metres(dx, dy)]);
  }
  spots.sort((a, b) => a[2] - b[2]);
  for (const [dx, dy] of spots) {
    const x = Math.floor(start.x + dx) + 0.5;
    const y = Math.floor(start.y + dy) + 0.5;
    if (qualifies(world, x, y)) return { x, y };
  }
  return null;
}

let nextId = 1;

export class Fish {
  constructor(x, y, { school = null, heading = 0, seed = 1 } = {}) {
    this.id = nextId++;
    this.kind = FISH;
    this.school = school;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = 0;
    this.random = mulberry32(seed);
    this.swim = between(this.random, FISH.swim.depth);
    this.swimTo = this.swim;
    // 'cruise', 'pause', 'follow', 'dart' or 'settle'.
    this.state = 'pause';
    this.stateTime = 0;
    this.duration = between(this.random, FISH.swim.pause);
    this.target = null;
    this.clip = 'swim';
    this.clipTime = this.random() * FISH.lengths.swim;
    this.rate = FISH.rates[0];
    this.events = [];
  }

  get alive() {
    return true;
  }

  setState(state, duration = 0) {
    this.state = state;
    this.stateTime = 0;
    this.duration = duration;
  }

  offsetTo(x, y) {
    const [mx, mz] = toMetres(x - this.x, y - this.y);
    return { mx, mz, distance: Math.hypot(mx, mz), bearing: Math.atan2(mx, mz) };
  }

  turnTowards(bearing, rate, dt) {
    const d = wrap(bearing - this.heading);
    const step = rate * dt;
    this.heading = wrap(this.heading + clamp(d, -step, step));
  }

  // Moves by a few metres: never off open lake water. Blocked straight
  // ahead it tries 35 and 70 degrees either way, else it stops.
  step(world, mx, mz) {
    for (const turn of [0, 0.61, -0.61, 1.22, -1.22]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const [dx, dy] = toCells(mx * c + mz * s, -mx * s + mz * c);
      if (qualifies(world, this.x + dx, this.y + dy)) {
        this.x += dx;
        this.y += dy;
        if (turn) this.heading = wrap(this.heading + turn * 0.5);
        return true;
      }
    }
    return false;
  }

  // A spot a few metres off reached by a straight line on open water.
  pickTarget(world) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const dist = between(this.random, FISH.swim.wander);
      const [mx, mz] = [Math.sin(angle) * dist, Math.cos(angle) * dist];
      let clear = true;
      for (let d = 0.3; d <= dist && clear; d += 0.3) {
        const [dx, dy] = toCells(Math.sin(angle) * d, Math.cos(angle) * d);
        clear = qualifies(world, this.x + dx, this.y + dy);
      }
      const [dx, dy] = toCells(mx, mz);
      if (clear && qualifies(world, this.x + dx, this.y + dy)) return { x: this.x + dx, y: this.y + dy };
    }
    return null;
  }

  // Darts off on its own line away from a threat.
  dart(away) {
    const d = FISH.dart;
    this.heading = wrap(away);
    this.speed = between(this.random, d.speed);
    this.setState('dart', between(this.random, d.time));
    if (this.swim < 0.15 && this.random() < d.ring) this.events.push({ type: 'dart', x: this.x, y: this.y, ring: true });
    else this.events.push({ type: 'dart', x: this.x, y: this.y, ring: false });
  }

  update(dt, world, school, depthAt) {
    this.stateTime += dt;
    const leader = school.leader;
    let want = 0;
    if (this.state === 'dart') {
      want = this.speed;
      if (this.stateTime >= this.duration) this.setState('settle', between(this.random, FISH.dart.regroup));
    } else if (this.state === 'settle') {
      want = 0;
      if (this.stateTime >= this.duration + GLIDE) {
        if (this === leader) this.setState('pause', between(this.random, FISH.swim.pause));
        else this.setState('follow');
      }
    } else if (this === leader) {
      if (this.state === 'cruise' && this.target) {
        const { distance, bearing } = this.offsetTo(this.target.x, this.target.y);
        this.turnTowards(bearing, 2.5, dt);
        want = FISH.swim.cruise * Math.min(1, distance / 0.6 + 0.2);
        if (distance < 0.15) this.setState('pause', between(this.random, FISH.swim.pause));
      } else if (this.state !== 'pause' || this.stateTime >= this.duration) {
        this.target = school.scaredUntil > school.time ? null : this.pickTarget(world);
        if (this.target) this.setState('cruise');
        else this.setState('pause', 1);
      }
    } else {
      // Behind the leader and to one side of it, by its place in the school.
      if (this.state !== 'follow') this.setState('follow');
      const i = school.members.indexOf(this);
      const side = ((i % 2) * 2 - 1) * Math.ceil(i / 2) * FISH.school.spacing;
      const back = FISH.school.follow * (0.5 + 0.25 * Math.ceil(i / 2));
      const h = leader.heading;
      const [dx, dy] = toCells(-Math.sin(h) * back + Math.cos(h) * side, -Math.cos(h) * back - Math.sin(h) * side);
      const { distance, bearing } = this.offsetTo(leader.x + dx, leader.y + dy);
      if (distance > 0.1) this.turnTowards(bearing, 3, dt);
      want = Math.min(FISH.swim.cruise * 2, distance * 1.5);
    }
    // Speed eases toward what it wants; a dart's stop takes a moment.
    const k = this.state === 'settle' ? 1 - Math.exp(-dt * (3 / GLIDE)) : 1 - Math.exp(-dt * 4);
    this.speed += (want - this.speed) * (this.state === 'dart' ? 1 : k);
    if (this.speed > 0.005 && !this.step(world, Math.sin(this.heading) * this.speed * dt, Math.cos(this.heading) * this.speed * dt)) {
      this.speed = 0;
    }
    // Its depth wanders, never too near the bed.
    if (Math.abs(this.swimTo - this.swim) < 0.01) this.swimTo = between(this.random, FISH.swim.depth);
    const floor = Math.max(0.04, depthAt(this.x, this.y) - 0.05);
    this.swim = Math.min(floor, this.swim + clamp(this.swimTo - this.swim, -0.05 * dt, 0.05 * dt));
    this.rate = this.state === 'dart' ? FISH.rates[1]
      : this.speed < 0.05 ? FISH.rates[0] : clamp(this.speed / FISH.swimSpeed, ...FISH.rates);
    this.clipTime += dt * this.rate;
  }
}

export class Fishes {
  constructor({ seed = 1, cap = 8, enabled = true } = {}) {
    this.seed = seed;
    this.cap = cap;
    this.enabled = enabled;
    this.list = [];
    this.schools = new Map();
    this.rolls = new Map();
    this.released = new Map();
    this.random = mulberry32((seed * 3253) ^ 0xf15);
    this.time = 0;
    this.scanIn = 0;
    this.events = [];
    this.noises = [];
    this.debugGroups = 0;
    this.focus = null;
  }

  // A region's school with its home water, kept once final (the newest
  // 64); while its chunks are not loaded the answer waits.
  rollOf(world, rx, ry) {
    const key = `${rx},${ry}`;
    if (this.rolls.has(key)) return this.rolls.get(key);
    const roll = schoolOf(this.seed, rx, ry, world);
    let final = roll;
    if (roll) {
      const home = homeWater(world, roll);
      if (home === undefined) return null;
      final = home ? { ...roll, home } : null;
    }
    this.rolls.set(key, final);
    if (this.rolls.size > 64) this.rolls.delete(this.rolls.keys().next().value);
    return final;
  }

  fits(size) {
    return this.schools.size < MAX_SCHOOLS && this.list.length + size <= this.cap;
  }

  place(key, spots, { seed = 1, heading = 0 } = {}) {
    const school = { key, home: { x: spots[0][0], y: spots[0][1] }, members: [], leader: null, scaredUntil: -Infinity, time: this.time };
    spots.forEach(([x, y], i) => {
      const fish = new Fish(x, y, { school, seed: seed + i * 389, heading });
      school.members.push(fish);
      this.list.push(fish);
    });
    school.leader = school.members[0];
    this.schools.set(key, school);
    return school;
  }

  // The places round a home a school's fish start at, on open water.
  spots(world, home, count, random) {
    const spots = [];
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 6; t++) {
        const angle = random() * Math.PI * 2;
        const r = i ? FISH.school.spacing * (1 + random()) * Math.sqrt(i + t) : 0;
        const [dx, dy] = toCells(Math.sin(angle) * r, Math.cos(angle) * r);
        if (!qualifies(world, home.x + dx, home.y + dy)) continue;
        spots.push([home.x + dx, home.y + dy]);
        break;
      }
    }
    return spots;
  }

  // Places a school at once on the open water nearest a point (within six
  // metres), and keeps it however far the player goes (for debugging and
  // screenshots).
  spawn({ x, y, count = 4, world }) {
    let home = null;
    for (let r = 0; r <= 6 && !home; r += 0.25) {
      for (let i = 0; i < 16 && !home; i++) {
        const [dx, dy] = toCells(Math.sin((i * Math.PI) / 8) * r, Math.cos((i * Math.PI) / 8) * r);
        if (qualifies(world, x + dx, y + dy)) home = { x: x + dx, y: y + dy };
      }
    }
    if (!home) return null;
    const spots = this.spots(world, home, count, this.random);
    return this.place(`debug:${++this.debugGroups}`, spots, { seed: Math.floor(this.random() * 2 ** 31),
      heading: this.random() * Math.PI * 2 });
  }

  // Lets every scare go, for a quiet scene.
  calm() {
    for (const school of this.schools.values()) {
      school.scaredUntil = -Infinity;
      for (const f of school.members) {
        f.setState(f === school.leader ? 'pause' : 'follow', 1);
        f.speed = 0;
      }
    }
  }

  release(school) {
    this.schools.delete(school.key);
    this.list = this.list.filter((f) => f.school !== school);
    this.released.set(school.key, this.time);
  }

  activate(world, player, view) {
    const [cols, rows] = toCells(RING.far, RING.far);
    for (let ry = Math.floor((player.y - rows) / REGION.rows); ry <= Math.floor((player.y + rows) / REGION.rows); ry++) {
      for (let rx = Math.floor((player.x - cols) / REGION.cols); rx <= Math.floor((player.x + cols) / REGION.cols); rx++) {
        const key = `${rx},${ry}`;
        if (this.schools.has(key)) continue;
        if (this.time - (this.released.get(key) ?? -Infinity) < RING.cooldown) continue;
        const roll = this.rollOf(world, rx, ry);
        if (!roll || !this.fits(roll.size)) continue;
        const d = metres(roll.home.x - player.x, roll.home.y - player.y);
        if (d < RING.near || d > RING.far || inView(view, roll.home.x, roll.home.y)) continue;
        const spots = this.spots(world, roll.home, roll.size, mulberry32(roll.seed));
        if (spots.length < roll.size) continue;
        this.place(key, spots, { seed: roll.seed, heading: (roll.seed % 628) / 100 });
      }
    }
  }

  // A noise: water dulls it, so only a near one scares fish.
  hear(e) {
    if (!this.enabled) return;
    let loud = 0;
    if (e.type === 'strike') loud = LOUDNESS.strike;
    else if (e.type === 'slam' || e.type === 'land') loud = (e.strength ?? 1) > 0.5 ? LOUDNESS[e.type] : 0;
    else if (e.type === 'spell') loud = e.stage === 'impact' ? LOUDNESS.impact : 0;
    else if (e.type === 'lightning') loud = LOUDNESS.lightning;
    if (!loud) return;
    const at = Number.isFinite(e.x) && Number.isFinite(e.y) ? { x: e.x, y: e.y } : this.focus;
    if (at) this.noises.push({ at, loud: Math.min(loud, FISH.senses.noise) });
  }

  // A shaft landing in the water startles the fish near it.
  landed(x, y) {
    if (this.enabled) this.noises.push({ at: { x, y }, loud: FISH.senses.shot });
  }

  // Sends the whole school darting apart from a point, each fish on its own
  // line fanned round its way away: the bigger the school, the closer its
  // lines, so the outermost still head away.
  scatter(school, from) {
    school.scaredUntil = school.time + SCARED;
    const n = school.members.length;
    const { spread, fan } = FISH.dart;
    const step = n > 1 ? Math.min(spread, (2 * fan) / (n - 1)) : 0;
    school.members.forEach((f, i) => {
      const away = f.offsetTo(from.x, from.y).bearing + Math.PI;
      f.dart(away + (i - (n - 1) / 2) * step + (f.random() - 0.5) * 0.16);
    });
  }

  update(dt, world, { player, peers = [], view = null }) {
    this.time += dt;
    this.focus = { x: player.x, y: player.y };
    if (!this.enabled || !this.cap) {
      this.list = [];
      this.schools.clear();
      this.noises.length = 0;
      return;
    }
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = 0.5;
      for (const school of [...this.schools.values()]) {
        if (school.key.startsWith('debug:')) continue;
        if (school.members.every((f) => metres(f.x - player.x, f.y - player.y) > RING.release)) this.release(school);
      }
      this.activate(world, player, view);
    }
    const s = FISH.senses;
    const people = [player, ...peers.map((p) => p.player ?? p)];
    const depthAt = (x, y) => world.waterDepthAt(x, y);
    for (const school of this.schools.values()) {
      school.time = this.time;
      const calm = !school.members.some((f) => f.state === 'dart');
      let from = null;
      for (const p of people) {
        const pace = Math.max(p.groundSpeed ?? 0, p.speed ?? 0);
        const range = Math.max(pace > (p.walkSpeed ?? 2) * 1.3 ? s.fleeRunning : s.flee, (p.waterDepth ?? 0) > 0 ? s.wade : 0);
        if (school.members.some((f) => metres(p.x - f.x, p.y - f.y) < range)) from = p;
      }
      for (const { at, loud } of this.noises) {
        if (school.members.some((f) => metres(at.x - f.x, at.y - f.y) < loud)) from = at;
      }
      if (from && calm && school.members.every((f) => f.state !== 'settle' || f.stateTime > 1)) this.scatter(school, from);
      for (const f of school.members) {
        f.update(dt, world, school, depthAt);
        for (const e of f.events) this.events.push({ ...e, fish: f });
        f.events.length = 0;
      }
    }
    this.noises.length = 0;
  }
}

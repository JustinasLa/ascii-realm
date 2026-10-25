import { hash2, mulberry32 } from '../core/rng.js';
import { SHORE, WATER } from '../world/world.js';
import { LOUDNESS, REGION, RING, ready, regionHabitat } from './animals.js';
import { standable, toCells, toMetres } from './monsters.js';

// Wild birds: flocks of wood pigeons feeding on the ground in meadows and at
// the forest edge. They never walk; now and then one flutters a few metres
// to a new spot. A threat or a loud noise puts the whole flock up, the alarm
// rippling through it in a quarter of a second: each bird takes off, climbs
// flapping, and the flock wheels away together to land a few dozen metres
// off. Positions are in cells, distances and speeds in metres, altitude in
// metres above the ground, and headings as for every other figure.

const freeze = (o) => Object.freeze(o);

export const BIRD = freeze({
  id: 'pigeon', name: 'Wood Pigeon', role: 'ambient', locomotion: 'air',
  // Nose to tail, metres, as a grown wood pigeon; the model is scaled to it.
  length: 0.42,
  flock: freeze({ size: freeze([3, 6]), spacing: 0.5, cohesion: 3 }),
  // The chance of a flock in a region of each habitat.
  habitat: freeze({ meadow: 0.35, edge: 0.25, woodland: 0.08 }),
  // Metres: a threat is watched within `notice` (half that if it stands
  // still) and flown from within `flee`, or `fleeRunning` from a runner.
  senses: freeze({ notice: 9, flee: 6, fleeRunning: 10, noise: 30, shot: 6 }),
  // Seconds between one bird rising and each of the others following.
  contagion: freeze({ delay: freeze([0.03, 0.25]) }),
  // Seconds of a feeding bout; metres of a flutter; seconds between them.
  feed: freeze({ bout: freeze([6, 16]), flutter: freeze([0.6, 3.5]), flutterEvery: freeze([8, 20]) }),
  flight: freeze({
    // Metres a second climbing; the cruise, whose flap rate follows it.
    climb: 2.4, cruise: 8.0,
    // Cruise height, metres; turn, radians a second; metres from where the
    // flock rose to where it lands.
    altitude: freeze([4, 7]), turn: 2.2, land: freeze([25, 45]),
    // The flock's pull on each bird: apart, along and together; neighbours
    // within `near` metres count.
    sep: 0.6, align: 1.2, cohere: 0.8, near: 4,
  }),
  // Seconds after landing when the flock is jumpy no more: until then its
  // senses are halved.
  rest: 20,
  clips: freeze({ idle: 'Standing_Idle', takeoff: 'Takeoff', flap: 'Flapping', glide: 'Gliding', land: 'Landing' }),
  // Each clip's length, seconds, pinned against the model by a test; the
  // share of the takeoff when the feet leave the ground, and of the landing
  // when they touch it.
  lengths: freeze({ idle: 5, takeoff: 2, flap: 0.4667, glide: 3.5, land: 2 }),
  liftAt: 0.3, touchAt: 0.7,
  // How fast the takeoff and a flutter play.
  takeoffRate: 1.6, flutterRate: 1.4,
  rates: freeze([0.8, 1.6]),
});

// At most this many flocks are about at once.
export const MAX_FLOCKS = 2;
// A flutter's top, metres, and its seconds in the air.
const HOP = 0.6;
const HOP_TIME = 1;
// The flock comes down from this height to land, metres.
const APPROACH = 1.2;
// Spawns stay this far outside the view, in cells.
const VIEW_MARGIN = freeze({ cols: 8, rows: 4 });

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const between = (random, [a, b]) => a + random() * (b - a);
const metres = (dx, dy) => Math.hypot(...toMetres(dx, dy));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Whether a cell lies on screen or just off it.
export function inView(view, x, y) {
  return Boolean(view) && x > view.x0 - VIEW_MARGIN.cols && x < view.x0 + view.cols + VIEW_MARGIN.cols
    && y > view.y0 - VIEW_MARGIN.rows && y < view.y0 + view.rows + VIEW_MARGIN.rows;
}

// Open, dry ground a bird may stand on: loaded, clear of props, off the
// water and the shore.
export function perch(world, x, y) {
  if (!ready(world, x, y) || !standable(world, x, y)) return false;
  const type = world.typeAt(x, y);
  return type !== WATER && type !== SHORE;
}

// The flock a region holds, the same every time for a seed and region: its
// home, size and members' places round it (metres). Null for none.
export function flockOf(seed, rx, ry, habitat) {
  if (habitat === 'water') return null;
  const random = mulberry32(Math.floor(hash2(rx, ry, seed + 5303) * 2 ** 32));
  if (random() >= (BIRD.habitat[habitat] ?? 0)) return null;
  const [lo, hi] = BIRD.flock.size;
  const size = lo + Math.floor(random() * (hi - lo + 1));
  const home = { x: (rx + 0.2 + random() * 0.6) * REGION.cols, y: (ry + 0.2 + random() * 0.6) * REGION.rows };
  const places = [];
  for (let i = 0; i < size; i++) {
    const spots = [];
    for (let t = 0; t < 4; t++) {
      const angle = random() * Math.PI * 2;
      const r = i === 0 && t === 0 ? 0 : BIRD.flock.spacing * (1.2 + random()) * Math.sqrt(i + t);
      spots.push([Math.sin(angle) * r, Math.cos(angle) * r]);
    }
    places.push(spots);
  }
  return { key: `${rx},${ry}`, home, size, places, seed: Math.floor(random() * 2 ** 31) };
}

let nextId = 1;

export class Bird {
  constructor(x, y, { flock = null, heading = 0, seed = 1 } = {}) {
    this.id = nextId++;
    this.kind = BIRD;
    this.flock = flock;
    this.x = x;
    this.y = y;
    // Metres above the ground, and its climb, metres a second.
    this.alt = 0;
    this.va = 0;
    this.heading = heading;
    this.pitch = 0;
    // Its velocity over the ground, metres a second.
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.groundSpeed = 0;
    // 'feed', 'alert', 'flutter', 'takeoff', 'fly' or 'land'.
    this.state = 'feed';
    this.stateTime = 0;
    this.random = mulberry32(seed);
    this.duration = between(this.random, BIRD.feed.bout);
    // The clip it plays, seconds into it, and how fast.
    this.clip = 'idle';
    this.clipTime = this.random() * BIRD.lengths.idle;
    this.rate = 1;
    this.target = null;
    this.threat = null;
    // A take-off passed on by a flock mate, due in this many seconds.
    this.takeoffIn = null;
    // Where a flutter or a landing starts and ends, and its own cruise height.
    this.from = null;
    this.cruiseAlt = between(this.random, BIRD.flight.altitude) + (this.random() - 0.5) * 2;
    this.events = [];
  }

  get alive() {
    return true;
  }

  get airborne() {
    return this.alt >= 0.3;
  }

  get grounded() {
    return this.state === 'feed' || this.state === 'alert' || this.state === 'flutter';
  }

  setState(state, duration = 0) {
    this.state = state;
    this.stateTime = 0;
    this.duration = duration;
  }

  play(clip, rate = 1, at = 0) {
    if (this.clip !== clip) this.clipTime = at;
    this.clip = clip;
    this.rate = rate;
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

  // Turns toward something it has noticed and stands watching it.
  alert(at) {
    if (this.state === 'feed') this.setState('alert', 3);
    if (this.state === 'alert') {
      this.threat = { x: at.x, y: at.y };
      this.duration = Math.max(this.duration, this.stateTime + 3);
    }
  }

  // Leaves the ground, heading away from the threat on the flock's line.
  takeoff(heading) {
    this.setState('takeoff');
    this.play('takeoff', BIRD.takeoffRate);
    this.heading = heading + (this.random() - 0.5) * 0.7;
    this.takeoffIn = null;
    this.events.push({ type: 'takeoff', x: this.x, y: this.y });
  }

  // A short hop to a spot a few metres off, wings and all.
  flutter(to) {
    this.setState('flutter', HOP_TIME);
    this.from = { x: this.x, y: this.y };
    this.target = to;
    this.heading = this.offsetTo(to.x, to.y).bearing;
    this.play('takeoff', BIRD.flutterRate, BIRD.liftAt * BIRD.lengths.takeoff);
  }

  // Comes down to its own spot by the landing place.
  land(spot) {
    this.setState('land');
    this.from = { x: this.x, y: this.y, alt: this.alt };
    this.target = spot;
    this.play('land', 1);
  }

  update(dt, world, flock) {
    this.stateTime += dt;
    this.clipTime += dt * this.rate;
    const x0 = this.x;
    const y0 = this.y;
    if (this.takeoffIn !== null) {
      this.takeoffIn -= dt;
      if (this.takeoffIn <= 0 && this.grounded) this.takeoff(flock.heading);
    }
    if (this.state === 'feed' || this.state === 'alert') this.stand(dt);
    else if (this.state === 'flutter') this.hop(dt);
    else if (this.state === 'takeoff') this.rise(dt, flock);
    else if (this.state === 'fly') this.fly(dt, flock);
    else this.descend(dt);
    const [mx, mz] = toMetres(this.x - x0, this.y - y0);
    this.groundSpeed = dt > 0 ? Math.hypot(mx, mz) / dt : 0;
  }

  // On the ground it stays put: feeding, or watching what it noticed.
  stand(dt) {
    this.alt = 0;
    this.va = 0;
    this.speed = 0;
    this.pitch = 0;
    this.play('idle', 1, this.clipTime);
    if (this.state === 'alert') {
      if (this.threat) this.turnTowards(this.offsetTo(this.threat.x, this.threat.y).bearing, 4, dt);
      if (this.stateTime >= this.duration) {
        this.setState('feed', between(this.random, BIRD.feed.bout));
        this.threat = null;
      }
    } else if (this.stateTime >= this.duration) this.setState('feed', between(this.random, BIRD.feed.bout));
  }

  // A flutter: up off the feet, across and down, in one second.
  hop(dt) {
    const t = Math.min(1, this.stateTime / HOP_TIME);
    const { from, target } = this;
    this.x = from.x + (target.x - from.x) * t;
    this.y = from.y + (target.y - from.y) * t;
    const alt = HOP * Math.sin(Math.PI * t);
    this.va = dt > 0 ? (alt - this.alt) / dt : 0;
    this.alt = alt;
    this.speed = metres(target.x - from.x, target.y - from.y) / HOP_TIME;
    if (this.va < -1e-6 && this.clip !== 'land') {
      // Coming down, it plays the landing so its feet reach for the ground
      // just as they touch it.
      this.play('land', BIRD.flutterRate, BIRD.touchAt * BIRD.lengths.land - (HOP_TIME / 2) * BIRD.flutterRate);
    }
    if (t >= 1) {
      this.alt = 0;
      this.va = 0;
      this.speed = 0;
      this.setState('feed', between(this.random, BIRD.feed.bout));
      this.play('idle', 1, this.random() * BIRD.lengths.idle);
    }
  }

  // Beating up off the ground, it leaves it at the clip's lift-off moment
  // and climbs away, gathering speed.
  rise(dt, flock) {
    const f = BIRD.flight;
    const lift = (BIRD.liftAt * BIRD.lengths.takeoff) / BIRD.takeoffRate;
    if (this.stateTime >= lift) {
      this.va = f.climb;
      this.speed = Math.min(f.cruise * 0.7, this.speed + dt * 4);
    }
    this.alt += this.va * dt;
    this.turnTowards(flock.heading, f.turn, dt);
    this.vx = Math.sin(this.heading) * this.speed;
    this.vz = Math.cos(this.heading) * this.speed;
    this.move(dt);
    this.pitch = Math.atan2(this.va, Math.max(1, this.speed));
    if (this.alt >= 1.5 || this.stateTime >= BIRD.lengths.takeoff / BIRD.takeoffRate) this.setState('fly');
  }

  // In the air: each bird keeps its place along the flock's path, held
  // apart from, along with and toward its neighbours.
  fly(dt, flock) {
    const f = BIRD.flight;
    const path = flock.path;
    const [px, pz] = toMetres(path.to.x - path.from.x, path.to.y - path.from.y);
    const length = Math.hypot(px, pz) || 1;
    const ux = px / length;
    const uz = pz / length;
    const i = flock.members.indexOf(this);
    // Its place: behind and beside the path's head, by its rank.
    const side = ((i % 2) * 2 - 1) * Math.ceil(i / 2) * 0.9;
    const back = Math.ceil(i / 2) * 0.8;
    const head = Math.min(path.t, length);
    const [cx, cy] = toCells((head - back) * ux + side * uz, (head - back) * uz - side * ux);
    const [tx, tz] = toMetres(path.from.x + cx - this.x, path.from.y + cy - this.y);
    let dx = ux * flock.speed + tx * 1.2;
    let dz = uz * flock.speed + tz * 1.2;
    let ax = 0;
    let az = 0;
    let n = 0;
    for (const mate of flock.members) {
      if (mate === this || !mate.airborne) continue;
      const { mx, mz, distance } = this.offsetTo(mate.x, mate.y);
      if (distance > f.near) continue;
      n++;
      ax += mate.vx;
      az += mate.vz;
      if (distance < f.sep && distance > 1e-6) {
        dx -= (mx / distance) * (f.sep - distance) * 6;
        dz -= (mz / distance) * (f.sep - distance) * 6;
      } else {
        dx += mx * f.cohere * 0.1;
        dz += mz * f.cohere * 0.1;
      }
    }
    if (n) {
      dx += (ax / n - this.vx) * f.align * 0.3;
      dz += (az / n - this.vz) * f.align * 0.3;
    }
    const top = f.cruise * 1.3;
    const want = Math.hypot(dx, dz);
    if (want > top) {
      dx *= top / want;
      dz *= top / want;
    }
    const k = 1 - Math.exp(-dt * 3);
    this.vx += (dx - this.vx) * k;
    this.vz += (dz - this.vz) * k;
    this.speed = Math.hypot(this.vx, this.vz);
    if (this.speed > 0.1) this.turnTowards(Math.atan2(this.vx, this.vz), f.turn * 2, dt);
    // Down toward the landing, else up to its own cruise height.
    const left = length - head;
    const goal = flock.landing ? Math.min(this.cruiseAlt, APPROACH + Math.max(0, left - 6) * 0.35) : this.cruiseAlt;
    this.va += (clamp((goal - this.alt) * 1.2, -f.climb * 1.2, f.climb) - this.va) * k;
    this.alt = Math.max(0.3, this.alt + this.va * dt);
    this.move(dt);
    this.pitch = Math.atan2(this.va, Math.max(1, this.speed));
    this.play(this.va > 0.4 || this.speed < f.cruise * 0.85 ? 'flap' : 'glide',
      clamp(this.speed / f.cruise, ...BIRD.rates), this.clipTime);
  }

  // The landing clip is timed so it touches down at the clip's touch-down
  // moment, on its own spot, and stands there for the rest of it.
  descend(dt) {
    const touch = BIRD.touchAt * BIRD.lengths.land;
    const t = Math.min(1, this.stateTime / touch);
    const { from, target } = this;
    const ease = 1 - (1 - t) * (1 - t);
    this.x = from.x + (target.x - from.x) * ease;
    this.y = from.y + (target.y - from.y) * ease;
    const alt = from.alt * (1 - t) * (1 - t);
    this.va = dt > 0 ? (alt - this.alt) / dt : 0;
    this.alt = alt;
    this.speed = t < 1 ? (metres(target.x - from.x, target.y - from.y) / touch) * 2 * (1 - t) : 0;
    this.pitch = t < 1 ? Math.atan2(this.va, Math.max(1, this.speed)) * 0.5 : 0;
    if (t < 1) this.turnTowards(this.offsetTo(target.x, target.y).bearing, 3, dt);
    if (this.stateTime >= BIRD.lengths.land) {
      this.setState('feed', between(this.random, BIRD.feed.bout));
      this.play('idle', 1, this.random() * BIRD.lengths.idle);
    }
  }

  move(dt) {
    const [dx, dy] = toCells(this.vx * dt, this.vz * dt);
    this.x += dx;
    this.y += dy;
  }
}

export class Birds {
  constructor({ seed = 1, cap = 8, enabled = true, habitat } = {}) {
    this.seed = seed;
    this.cap = cap;
    this.enabled = enabled;
    this.habitat = habitat;
    this.list = [];
    this.flocks = new Map();
    this.rolls = new Map();
    this.released = new Map();
    this.random = mulberry32((seed * 7019) ^ 0xb1d5);
    this.time = 0;
    this.scanIn = 0;
    this.events = [];
    this.noises = [];
    this.debugGroups = 0;
    this.focus = null;
  }

  // A region's flock, rolled once and kept (the newest 64).
  rollOf(world, rx, ry) {
    const key = `${rx},${ry}`;
    if (this.rolls.has(key)) return this.rolls.get(key);
    const roll = flockOf(this.seed, rx, ry, regionHabitat(world, rx, ry, this.habitat));
    this.rolls.set(key, roll);
    if (this.rolls.size > 64) this.rolls.delete(this.rolls.keys().next().value);
    return roll;
  }

  fits(size) {
    return this.flocks.size < MAX_FLOCKS && this.list.length + size <= this.cap;
  }

  place(key, spots, { seed = 1, heading = 0 } = {}) {
    const flock = { key, home: { x: spots[0][0], y: spots[0][1] }, members: [], phase: 'ground', heading: 0,
      path: null, landing: null, speed: 0, restUntil: -Infinity, flutterIn: between(this.random, BIRD.feed.flutterEvery) };
    spots.forEach(([x, y], i) => {
      const bird = new Bird(x, y, { flock, seed: seed + i * 613, heading: heading + i * 2.4 });
      flock.members.push(bird);
      this.list.push(bird);
    });
    this.flocks.set(key, flock);
    return flock;
  }

  // Places a flock at once where asked, on the ground or already in the
  // air, and keeps it however far the player goes (for debugging and
  // screenshots).
  spawn({ x, y, count = 5, airborne = false, world = null, heading = null } = {}) {
    const spots = [];
    for (let i = 0; i < count; i++) {
      const angle = i * 2.4;
      const r = i ? BIRD.flock.spacing * (1 + 0.5 * Math.sqrt(i)) : 0;
      const [dx, dy] = toCells(Math.sin(angle) * r, Math.cos(angle) * r);
      if (airborne || !world || perch(world, x + dx, y + dy)) spots.push([x + dx, y + dy]);
    }
    if (!spots.length) return null;
    const flock = this.place(`debug:${++this.debugGroups}`, spots, { seed: Math.floor(this.random() * 2 ** 31),
      heading: this.random() * Math.PI * 2 });
    if (airborne) {
      const away = heading ?? this.random() * Math.PI * 2;
      this.lift(flock, away, world, { x, y });
      for (const b of flock.members) {
        b.setState('fly');
        b.alt = b.cruiseAlt * 0.6;
        b.speed = BIRD.flight.cruise * 0.8;
        b.heading = away;
        b.vx = Math.sin(away) * b.speed;
        b.vz = Math.cos(away) * b.speed;
        b.takeoffIn = null;
        b.play('glide', 1, b.random() * BIRD.lengths.glide);
      }
    }
    return flock;
  }

  // Settles every flock on the ground where it is, for a quiet scene.
  calm() {
    for (const flock of this.flocks.values()) {
      flock.phase = 'ground';
      flock.restUntil = -Infinity;
      flock.flutterIn = between(this.random, BIRD.feed.flutterEvery);
      for (const b of flock.members) {
        b.setState('feed', between(b.random, BIRD.feed.bout));
        b.alt = 0;
        b.va = 0;
        b.speed = 0;
        b.vx = 0;
        b.vz = 0;
        b.takeoffIn = null;
        b.threat = null;
        b.play('idle', 1, b.clipTime);
      }
    }
  }

  release(flock) {
    this.flocks.delete(flock.key);
    this.list = this.list.filter((b) => b.flock !== flock);
    this.released.set(flock.key, this.time);
  }

  // Brings in the flocks of the regions within reach whose homes lie in the
  // ring round the player, off screen, on loaded and open land.
  activate(world, player, view) {
    const [cols, rows] = toCells(RING.far, RING.far);
    for (let ry = Math.floor((player.y - rows) / REGION.rows); ry <= Math.floor((player.y + rows) / REGION.rows); ry++) {
      for (let rx = Math.floor((player.x - cols) / REGION.cols); rx <= Math.floor((player.x + cols) / REGION.cols); rx++) {
        const key = `${rx},${ry}`;
        if (this.flocks.has(key)) continue;
        if (this.time - (this.released.get(key) ?? -Infinity) < RING.cooldown) continue;
        const roll = this.rollOf(world, rx, ry);
        if (!roll || !this.fits(roll.size)) continue;
        const d = metres(roll.home.x - player.x, roll.home.y - player.y);
        if (d < RING.near || d > RING.far || inView(view, roll.home.x, roll.home.y)) continue;
        const spots = [];
        for (const tries of roll.places) {
          for (const [mx, mz] of tries) {
            const [dx, dy] = toCells(mx, mz);
            const x = roll.home.x + dx;
            const y = roll.home.y + dy;
            if (inView(view, x, y) || !perch(world, x, y)) continue;
            spots.push([x, y]);
            break;
          }
        }
        if (spots.length < roll.size) continue;
        this.place(key, spots, { seed: roll.seed, heading: (roll.seed % 628) / 100 });
      }
    }
  }

  // A noise: birds near enough take off from it, those a little further
  // off look up toward it.
  hear(e) {
    if (!this.enabled) return;
    let loud = 0;
    if (e.type === 'strike') loud = LOUDNESS.strike;
    else if (e.type === 'slam' || e.type === 'whirl' || e.type === 'land') loud = (e.strength ?? 1) > 0.5 ? LOUDNESS[e.type] : 0;
    else if ((e.type === 'death' || e.type === 'hurt') && (e.monster || e.animal)) loud = LOUDNESS[e.type];
    else if (e.type === 'spell') loud = e.stage === 'cast' ? LOUDNESS.cast : e.stage === 'impact' ? LOUDNESS.impact : 0;
    else if (e.type === 'lightning') loud = LOUDNESS.lightning;
    else if (e.type === 'step') loud = (e.strength ?? 0) > 0.6 ? LOUDNESS.step : 0;
    if (!loud) return;
    const at = Number.isFinite(e.x) && Number.isFinite(e.y) ? { x: e.x, y: e.y } : this.focus;
    if (!at) return;
    this.noises.push({ at, loud });
  }

  // An arrow, spear or javelin landing near a flock puts it up.
  landed(x, y) {
    if (this.enabled) this.noises.push({ at: { x, y }, loud: BIRD.senses.shot });
  }

  // How keen a flock's senses are: halved while it rests after a flight.
  keen(flock) {
    return this.time < flock.restUntil ? 0.5 : 1;
  }

  // Puts the flock up from a point: the first bird rises at once, the rest
  // follow within a quarter of a second, and a landing place is picked.
  rise(flock, from, world, first = null) {
    if (flock.phase !== 'ground') return;
    const lead = first ?? flock.members[0];
    const away = lead.offsetTo(from.x, from.y).bearing + Math.PI;
    this.lift(flock, away, world, lead);
    for (const b of flock.members) {
      if (b === lead) b.takeoff(away);
      else b.takeoffIn = between(b.random, BIRD.contagion.delay);
    }
  }

  // Sets a flock's line of flight and the open ground it makes for, 25 to
  // 45 metres off and within 60 degrees of straight away; with none in
  // reach it flies off and away.
  lift(flock, away, world, at) {
    const f = BIRD.flight;
    flock.phase = 'air';
    flock.heading = wrap(away);
    flock.speed = f.cruise;
    let best = null;
    let score = -Infinity;
    for (let i = 0; i <= 6; i++) {
      const h = away + ((i - 3) / 3) * (Math.PI / 3);
      for (const r of [f.land[0], (f.land[0] + f.land[1]) / 2, f.land[1]]) {
        const [dx, dy] = toCells(Math.sin(h) * r, Math.cos(h) * r);
        const x = at.x + dx;
        const y = at.y + dy;
        if (!world || !perch(world, x, y)) continue;
        const s = Math.cos(h - away) - Math.abs(r - 35) * 0.002;
        if (s > score) {
          score = s;
          best = { x, y };
        }
      }
    }
    flock.landing = best;
    const [dx, dy] = toCells(Math.sin(away) * 90, Math.cos(away) * 90);
    flock.path = { from: { x: at.x, y: at.y }, to: best ?? { x: at.x + dx, y: at.y + dy }, t: 0 };
  }

  // The flock's flight: the path's head moves on at cruise, slowing toward
  // the landing; near it each bird comes down to its own spot.
  steer(flock, dt, world) {
    if (flock.phase === 'ground') return;
    const path = flock.path;
    const length = metres(path.to.x - path.from.x, path.to.y - path.from.y);
    const left = length - path.t;
    flock.speed = flock.landing ? Math.max(3, BIRD.flight.cruise * Math.min(1, left / 15)) : BIRD.flight.cruise;
    if (flock.members.some((b) => b.state === 'fly' || b.state === 'land')) path.t += flock.speed * dt;
    if (flock.landing && left < 6) {
      flock.phase = 'landing';
      flock.members.forEach((b, i) => {
        if (b.state !== 'fly') return;
        b.land(this.spotFor(flock, i, world));
      });
    }
    if (flock.members.every((b) => b.state === 'feed' || b.state === 'alert')) {
      flock.phase = 'ground';
      flock.restUntil = this.time + BIRD.rest;
      flock.flutterIn = between(this.random, BIRD.feed.flutterEvery);
    }
  }

  // A bird's own place round the landing spot, spaced from its mates.
  spotFor(flock, i, world) {
    const { x, y } = flock.landing;
    if (!i) return { x, y };
    const angle = i * 2.4 + flock.heading;
    const r = Math.min(2, BIRD.flock.spacing * 1.4 * Math.sqrt(i));
    const [dx, dy] = toCells(Math.sin(angle) * r, Math.cos(angle) * r);
    return perch(world, x + dx, y + dy) ? { x: x + dx, y: y + dy } : { x, y };
  }

  // Every so often one bird of a feeding flock flutters to a new spot by
  // its mates, never two at once.
  fidget(flock, dt, world) {
    if (flock.phase !== 'ground' || flock.members.some((b) => b.state === 'flutter')) return;
    flock.flutterIn -= dt;
    if (flock.flutterIn > 0) return;
    flock.flutterIn = between(this.random, BIRD.feed.flutterEvery);
    const feeding = flock.members.filter((b) => b.state === 'feed');
    if (!feeding.length) return;
    const bird = feeding[Math.floor(this.random() * feeding.length)];
    let cx = 0;
    let cy = 0;
    for (const b of flock.members) {
      cx += b.x / flock.members.length;
      cy += b.y / flock.members.length;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const toward = bird.offsetTo(cx, cy);
      const angle = attempt ? this.random() * Math.PI * 2 : toward.bearing;
      const dist = between(this.random, BIRD.feed.flutter);
      const [dx, dy] = toCells(Math.sin(angle) * dist, Math.cos(angle) * dist);
      const to = { x: bird.x + dx, y: bird.y + dy };
      if (!perch(world, to.x, to.y)) continue;
      if (flock.members.some((b) => b !== bird && metres(b.x - to.x, b.y - to.y) < BIRD.flock.spacing)) continue;
      bird.flutter(to);
      return;
    }
  }

  update(dt, world, { player, peers = [], monsters = [], predators = [], view = null }) {
    this.time += dt;
    this.focus = { x: player.x, y: player.y };
    if (!this.enabled || !this.cap) {
      this.list = [];
      this.flocks.clear();
      this.noises.length = 0;
      return;
    }
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = 0.5;
      for (const flock of [...this.flocks.values()]) {
        if (flock.key.startsWith('debug:')) continue;
        if (flock.members.every((b) => metres(b.x - player.x, b.y - player.y) > RING.release)) this.release(flock);
      }
      this.activate(world, player, view);
    }
    const walker = (p, pace) => ({ x: p.x, y: p.y, moving: pace > 0.3, running: pace > (p.walkSpeed ?? 2) * 1.3 });
    const threats = [walker(player, player.groundSpeed ?? 0)];
    for (const peer of peers) {
      const p = peer.player ?? peer;
      threats.push(walker(p, Math.max(p.groundSpeed ?? 0, p.speed ?? 0)));
    }
    for (const m of [...monsters, ...predators]) {
      const speed = m.groundSpeed ?? m.speed ?? 0;
      threats.push({ x: m.x, y: m.y, moving: speed > 0.3, running: speed > 2.5 });
    }
    const s = BIRD.senses;
    for (const flock of this.flocks.values()) {
      if (flock.phase !== 'ground') continue;
      const keen = this.keen(flock);
      for (const { at, loud } of this.noises) {
        const r = Math.min(loud, s.noise) * keen;
        let near = null;
        for (const b of flock.members) {
          const d = metres(at.x - b.x, at.y - b.y);
          if (d < r && (!near || d < near.d)) near = { b, d };
          else if (d < r * 2) b.alert(at);
        }
        if (near) this.rise(flock, at, world, near.b);
      }
      for (const b of flock.members) {
        if (flock.phase !== 'ground' || !b.grounded) continue;
        for (const t of threats) {
          const d = metres(t.x - b.x, t.y - b.y);
          if (d < (t.running ? s.fleeRunning : s.flee) * keen) {
            this.rise(flock, t, world, b);
            break;
          }
          if (d < s.notice * keen * (t.moving ? 1 : 0.5)) b.alert(t);
        }
      }
    }
    this.noises.length = 0;
    for (const flock of this.flocks.values()) {
      this.fidget(flock, dt, world);
      this.steer(flock, dt, world);
      for (const b of flock.members) {
        b.update(dt, world, flock);
        for (const e of b.events) this.events.push({ ...e, bird: b });
        b.events.length = 0;
      }
    }
  }
}

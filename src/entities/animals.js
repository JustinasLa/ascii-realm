import { fbm } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { DEADWOOD_REACH_X, DEADWOOD_REACH_Y } from '../world/deadwood.js';
import { currentAt, easeCarry, immersion, toCells as flowCells } from '../world/rivers.js';
import { ASPECT, CHUNK_SIZE, LAND_LIFT, MAX_WATER_DEPTH, SHORE, SHORE_LEVEL, WATER } from '../world/world.js';
import { standable, toCells, toMetres } from './monsters.js';

// Wildlife: deer herds and rabbit groups that belong to the land. The world
// is cut into regions; from the seed each region holds a deer herd, a rabbit
// group or nothing, by its habitat. A herd is placed off screen when its
// region comes within range of the player and let go again once they have
// left, so coming back finds it at home again. Animals stroll, graze and
// watch; a threat or a loud noise sends deer bolting together in a ripple
// through the herd, and rabbits scattering each their own way.
// Positions are in cells, distances and speeds in ground metres, and
// headings as for monsters (0 faces down the screen).

const freeze = (o) => Object.freeze(o);

export const KINDS = freeze({
  deer: freeze({
    id: 'deer', name: 'Deer', role: 'prey', locomotion: 'ground',
    // Hit points, used once animals can be hunted.
    health: 40,
    // Height at the withers, metres; the stag leads a herd and stands taller.
    height: 1.0, stagHeight: 1.15, radius: 0.55,
    // Metres a second, matched to the clips' own ground speeds so the hooves
    // stay planted: the gallop is half again as quick as the player's run.
    walkSpeed: 1.1, trotSpeed: 1.45, fleeSpeed: 5.8,
    // The rates the clips may play at, as a share of their own pace.
    rates: freeze([0.75, 1.65]),
    turn: freeze({ calm: 2.5, flee: 7 }),
    wander: freeze({ idle: [3, 9], dist: [3, 8] }),
    graze: freeze({ share: 0.6, bout: [6, 14], look: [2, 5] }),
    herd: freeze({ size: [2, 4], stagChance: 0.35, cohesion: 6, spacing: 1.2 }),
    senses: freeze({ notice: 10, bolt: 5, boltRunning: 9, noise: 30 }),
    flee: freeze({ min: 4, max: 7, safe: 30, calm: 10 }),
    contagion: freeze({ radius: 15, delay: [0.1, 0.4] }),
    // Wades a stream while fleeing, never strolls in.
    water: 'wade',
    // The chance of a herd in a region of each habitat.
    habitat: freeze({ meadow: 0.25, edge: 0.3, woodland: 0.12 }),
    fears: freeze(['player', 'monster']),
    clips: freeze({ idle: 'Idle', look: 'Idle_2', headLow: 'Idle_Headlow', graze: 'Eating', walk: 'Walk',
      run: 'Gallop', leap: 'Gallop_Jump', hitL: 'Idle_HitReact_Left', hitR: 'Idle_HitReact_Right', death: 'Death' }),
  }),
  rabbit: freeze({
    id: 'rabbit', name: 'Rabbit', role: 'prey', locomotion: 'ground',
    health: 3, height: 0.3, radius: 0.18,
    // It gets about in short lopes, and runs flat out when it flees, its
    // legs a blur at four bounds a second.
    walkSpeed: 1.2, fleeSpeed: 4.0,
    rates: freeze([0.75, 3.2]),
    turn: freeze({ calm: 4, flee: 12 }),
    wander: freeze({ idle: [2, 6], dist: [0.6, 2.5] }),
    graze: freeze({ share: 0.45, bout: [3, 8], look: [1.5, 4] }),
    herd: freeze({ size: [2, 3], stagChance: 0, cohesion: 4, spacing: 0.6 }),
    senses: freeze({ notice: 7, bolt: 3.5, boltRunning: 6, noise: 18 }),
    flee: freeze({ min: 2, max: 4, safe: 16, calm: 6, zigzag: [0.4, 0.8], jitter: 0.9, freeze: [2, 4] }),
    contagion: freeze({ radius: 6, delay: [0.05, 0.25] }),
    // The spread, in radians, between group members' lines of flight.
    scatter: 1.05,
    water: 'never',
    habitat: freeze({ meadow: 0.35, edge: 0.12, woodland: 0 }),
    fears: freeze(['player', 'monster']),
    clips: freeze({ idle: 'Basic', alert: 'Guard', alertLoop: 'Guarding', graze: 'Sitting.000', groom: 'Sitting.001',
      run: 'Running', hop: 'Jump', death: 'Dying.000', dead: 'Dead' }),
  }),
});

// A region: 8 chunks across and 2 down, about 24 by 20 metres.
export const REGION = freeze({ cols: CHUNK_SIZE * 8, rows: CHUNK_SIZE * 2 });
// Herds appear between these distances from the player, metres, and are let
// go beyond the last; a region let go rests this long, seconds.
export const RING = freeze({ near: 12, far: 48, release: 64, cooldown: 30 });
// At most this many animals live at once, whatever the kind caps.
export const MAX_ANIMALS = 10;
// Spawns stay this far outside the view, in cells.
const VIEW_MARGIN = { cols: 8, rows: 4 };
// How loud each noise is: the distance, metres, it can be heard at.
export const LOUDNESS = freeze({ strike: 20, slam: 30, whirl: 30, land: 30, death: 20, hurt: 20, cast: 30, impact: 40,
  lightning: 60, step: 10 });

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const between = (random, [a, b]) => a + random() * (b - a);
const metres = (dx, dy) => Math.hypot(...toMetres(dx, dy));

// The forest field the trees are placed by: trees grow above 0.44.
export const forestAt = (seed, x, y) => fbm(x * ASPECT * 0.01, y * 0.01, seed + 500, 3);

// Lakes and shores, straight from the terrain's own noise, and river
// channels from the seeded river lines: neither needs a chunk.
export function wetAt(world, x, y) {
  if (fbm(x * ASPECT * 0.011, y * 0.011, world.seed, 5) + LAND_LIFT < SHORE_LEVEL) return true;
  return Boolean(world.rivers?.near?.(x, y, 1)?.length);
}

// The habitat at a cell: 'water', 'woodland', 'edge' or 'meadow'. It depends
// on the seed only, never on which chunks happen to be loaded.
export function habitatAt(world, x, y) {
  if (wetAt(world, x, y)) return 'water';
  const forest = forestAt(world.seed, x, y);
  return forest > 0.54 ? 'woodland' : forest > 0.42 ? 'edge' : 'meadow';
}

export const regionOf = (x, y) => ({ rx: Math.floor(x / REGION.cols), ry: Math.floor(y / REGION.rows) });

// A region's habitat from a 3 by 3 grid of samples: the commonest kind of
// land, or 'water' where more than four samples are wet.
export function regionHabitat(world, rx, ry, habitat = habitatAt) {
  const counts = { water: 0, woodland: 0, edge: 0, meadow: 0 };
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      counts[habitat(world, (rx + (i + 0.5) / 3) * REGION.cols, (ry + (j + 0.5) / 3) * REGION.rows)]++;
    }
  }
  if (counts.water > 4) return 'water';
  return ['meadow', 'edge', 'woodland'].reduce((best, h) => (counts[h] > counts[best] ? h : best), 'meadow');
}

// The group a region holds, the same every time for a seed and region: its
// kind, home, size, members' places round the home (metres) and whether a
// stag leads it. Null for none.
export function herdOf(seed, rx, ry, habitat) {
  if (habitat === 'water') return null;
  const random = mulberry32(Math.floor(hash2(rx, ry, seed + 4409) * 2 ** 32));
  let kind = null;
  if (random() < KINDS.deer.habitat[habitat]) kind = KINDS.deer;
  else if (random() < KINDS.rabbit.habitat[habitat]) kind = KINDS.rabbit;
  if (!kind) return null;
  const [lo, hi] = kind.herd.size;
  const size = lo + Math.floor(random() * (hi - lo + 1));
  const home = { x: (rx + 0.2 + random() * 0.6) * REGION.cols, y: (ry + 0.2 + random() * 0.6) * REGION.rows };
  const stag = random() < kind.herd.stagChance;
  const places = [];
  for (let i = 0; i < size; i++) {
    const spots = [];
    for (let t = 0; t < 4; t++) {
      const angle = random() * Math.PI * 2;
      const r = i === 0 && t === 0 ? 0 : kind.herd.spacing * (1 + random()) * (0.5 + 0.5 * Math.sqrt(i + t));
      spots.push([Math.sin(angle) * r, Math.cos(angle) * r]);
    }
    places.push(spots);
  }
  return { key: `${rx},${ry}`, kind, home, size, stag, places, seed: Math.floor(random() * 2 ** 31) };
}

// The world's prop query also reads the chunk to the west of a range, as the
// last jittered column of a chunk's props can put bases this many cells
// into the next one.
const PROP_SPILL = 11;

// Whether every chunk a footing check could touch is already generated, so
// moving or spawning never generates land: the three cells standable()
// tests, each against every prop whose footprint could reach it, exactly
// the chunks the world's walkability query reads.
export function ready(world, x, y) {
  if (!world.loaded) return false;
  const w = Math.max(world.propFootW ?? 0, DEADWOOD_REACH_X);
  const h = Math.max(world.propFootH ?? 0, DEADWOOD_REACH_Y);
  for (let cy = Math.floor((y - h) / CHUNK_SIZE); cy <= Math.floor((y + h) / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor((x - 1 - w - PROP_SPILL) / CHUNK_SIZE); cx <= Math.floor((x + 1 + w) / CHUNK_SIZE); cx++) {
      if (!world.loaded(cx, cy)?.props) return false;
    }
  }
  return true;
}

// Whether an animal of a kind may stand at a cell: loaded, clear of props,
// and dry unless it is a deer fleeing through a stream.
export function footing(world, kind, x, y, fleeing = false) {
  if (!ready(world, x, y) || !standable(world, x, y)) return false;
  const type = world.typeAt(x, y);
  if (kind.water === 'never') return type !== WATER && type !== SHORE;
  return type !== WATER || (fleeing && world.waterDepthAt(x, y) < MAX_WATER_DEPTH * 0.8 + 1e-9);
}

let nextId = 1;

export class Animal {
  constructor(kind, x, y, { variant = null, heading = 0, herd = null, seed = 1 } = {}) {
    this.id = nextId++;
    this.kind = kind;
    this.variant = variant;
    this.x = x;
    this.y = y;
    this.heading = heading;
    // The speed it wants, and the ground it actually covered, metres a second.
    this.speed = 0;
    this.groundSpeed = 0;
    // 'idle', 'wander', 'graze', 'alert', 'flee', 'wade' (finishing a
    // crossing once the flight is over), 'calm' or 'freeze'.
    this.state = 'idle';
    this.stateTime = 0;
    this.random = mulberry32(seed);
    this.duration = between(this.random, kind.wander.idle);
    this.target = null;
    // What it is watching or running from.
    this.threat = null;
    this.fleeFor = 0;
    this.nextTurn = 0;
    this.away = 0;
    this.blocked = 0;
    // A bolt passed on by a herd mate, due in this many seconds.
    this.boltIn = null;
    // Seconds left of jumpiness after a flight, when it notices less.
    this.wary = 0;
    this.headUp = false;
    this.nextLook = 0;
    this.looking = false;
    this.herd = herd;
    this.health = kind.health;
    this.maxHealth = kind.health;
    this.waterDepth = 0;
    this.speedScale = 1;
    this.carry = { x: 0, y: 0 };
    this.stride = 0;
    this.events = [];
  }

  setState(state, duration = 0) {
    this.state = state;
    this.stateTime = 0;
    this.duration = duration;
    this.headUp = false;
    this.looking = false;
  }

  offsetTo(x, y) {
    const [mx, mz] = toMetres(x - this.x, y - this.y);
    return { mx, mz, distance: Math.hypot(mx, mz), bearing: Math.atan2(mx, mz) };
  }

  turnTowards(bearing, rate, dt) {
    const d = wrap(bearing - this.heading);
    const step = rate * dt;
    this.heading = wrap(this.heading + Math.max(-step, Math.min(step, d)));
  }

  get calm() {
    return this.state === 'idle' || this.state === 'wander' || this.state === 'graze';
  }

  // Whether it may take to the water: in flight, or wading out after one.
  get inFlight() {
    return this.state === 'flee' || this.state === 'wade';
  }

  // The nearest open, dry ground within six metres, or null.
  nearestBank(world) {
    for (let r = 0.5; r <= 6; r += 0.5) {
      for (let i = 0; i < 16; i++) {
        const h = this.heading + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
        const [dx, dy] = toCells(Math.sin(h) * r, Math.cos(h) * r);
        if (footing(world, this.kind, this.x + dx, this.y + dy)) return { x: this.x + dx, y: this.y + dy };
      }
    }
    return null;
  }

  // Moves by a few cells: refused onto unloaded land, into props, and into
  // water unless it is a deer in flight. Blocked straight ahead it tries
  // side-steps of 35 and 70 degrees, and otherwise stops.
  step(world, dx, dy) {
    const fleeing = this.inFlight;
    const [mx, mz] = toMetres(dx, dy);
    for (const turn of [0, 0.61, -0.61, 1.22, -1.22]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const [cx, cy] = toCells(mx * c + mz * s, -mx * s + mz * c);
      if (footing(world, this.kind, this.x + cx, this.y + cy, fleeing)) {
        this.x += cx;
        this.y += cy;
        return true;
      }
    }
    return false;
  }

  // Strolls toward its own pick of place, or back toward its leader once it
  // has strayed: always somewhere loaded, dry and open.
  pickTarget(world) {
    const k = this.kind;
    const leader = this.herd?.leader;
    const follow = leader && leader !== this && metres(leader.x - this.x, leader.y - this.y) > k.herd.cohesion * 0.6;
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const dist = between(this.random, k.wander.dist);
      let [dx, dy] = toCells(Math.sin(angle) * dist, Math.cos(angle) * dist);
      if (follow) {
        const [lx, ly] = toCells(Math.sin(angle) * k.herd.spacing * 2, Math.cos(angle) * k.herd.spacing * 2);
        dx = leader.x + lx - this.x;
        dy = leader.y + ly - this.y;
      }
      if (footing(world, k, this.x + dx, this.y + dy)) return { x: this.x + dx, y: this.y + dy };
    }
    return null;
  }

  // Starts a flight from a point. A deer takes its herd's line of flight if
  // one is set; a rabbit spreads from its mates. The way is scored for
  // open, dry ground.
  bolt(world, from) {
    const k = this.kind;
    const herd = this.herd;
    this.threat = { x: from.x, y: from.y };
    let away = this.offsetTo(from.x, from.y).bearing + Math.PI;
    if (k.id === 'deer' && herd?.flight !== undefined && herd.flightFor > 0) away = herd.flight;
    else if (k.scatter) {
      const n = herd?.members.length ?? 1;
      const i = herd ? herd.members.indexOf(this) : 0;
      away += (i - (n - 1) / 2) * k.scatter + (this.random() - 0.5) * 0.3;
    }
    this.away = away;
    this.heading = this.bestHeading(world, away);
    if (k.id === 'deer' && herd && !(herd.flightFor > 0)) {
      herd.flight = this.heading;
      herd.flightFor = k.flee.min;
    }
    this.setState('flee', between(this.random, [k.flee.min, k.flee.max]));
    this.boltIn = null;
    this.nextTurn = k.flee.zigzag ? between(this.random, k.flee.zigzag) : Infinity;
    this.blocked = 0;
    this.events.push({ type: 'bolt', x: this.x, y: this.y, strength: 1 });
    // The alarm runs through the herd.
    for (const mate of herd?.members ?? []) {
      if (mate === this || mate.state === 'flee' || mate.boltIn !== null) continue;
      if (metres(mate.x - this.x, mate.y - this.y) > k.contagion.radius) continue;
      mate.boltIn = between(mate.random, k.contagion.delay);
      mate.threat = { x: from.x, y: from.y };
    }
  }

  // Of thirteen headings across the half turn away from the threat, the one
  // with open ground for two metres that runs most nearly away. Water is
  // out for rabbits; deer take a shallow crossing only when no dry way is
  // nearly as good.
  bestHeading(world, away) {
    let best = away;
    let bestScore = -Infinity;
    for (let i = 0; i <= 12; i++) {
      const h = away + ((i - 6) / 6) * (Math.PI / 2);
      let ok = true;
      let wet = false;
      for (const d of [0.5, 1, 1.5, 2]) {
        const [dx, dy] = toCells(Math.sin(h) * d, Math.cos(h) * d);
        if (!footing(world, this.kind, this.x + dx, this.y + dy, true)) { ok = false; break; }
        if (world.typeAt(this.x + dx, this.y + dy) === WATER) wet = true;
      }
      if (!ok) continue;
      const score = Math.cos(h - away) * (wet ? 0.7 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return best;
  }

  // Turns toward something it has noticed and stands watching it.
  alert(at) {
    if (this.state !== 'alert') {
      this.setState('alert', 4);
      this.events.push({ type: 'alert', x: this.x, y: this.y, strength: 0.5 });
    }
    this.threat = { x: at.x, y: at.y };
  }

  // One step of thought and movement. `threat` is the nearest thing it
  // fears ({ x, y, distance, running }) or null.
  update(dt, world, threat = null) {
    const k = this.kind;
    this.stateTime += dt;
    this.wary = Math.max(0, this.wary - dt);
    if (this.boltIn !== null) {
      this.boltIn -= dt;
      if (this.boltIn <= 0) this.bolt(world, this.threat);
    }
    if (threat && this.state !== 'flee' && this.boltIn === null) {
      const d = threat.distance;
      const notice = this.wary > 0 ? k.senses.notice / 2 : k.senses.notice;
      if (d < k.senses.bolt || (threat.running && d < k.senses.boltRunning)) this.bolt(world, threat);
      else if (this.state !== 'freeze' && (threat.moving ? d < notice : d < notice / 2)) {
        // Only one coming closer keeps it watching.
        if (this.state !== 'alert' || d < this.alertAt - 0.3) {
          this.alert(threat);
          this.stateTime = 0;
          this.alertAt = d;
        }
      }
    }
    let speed = 0;
    let face = null;
    let turn = k.turn.calm;
    // One left behind by its leader stops what it is doing to catch up.
    const leader = this.herd?.leader;
    if ((this.state === 'idle' || this.state === 'graze') && leader && leader !== this
      && metres(leader.x - this.x, leader.y - this.y) > k.herd.cohesion) {
      this.target = this.pickTarget(world);
      if (this.target) this.setState('wander', 12);
    }
    const s = this.state;
    if (s === 'idle') {
      if (k.id === 'deer' && !this.looking && this.stateTime > this.duration * 0.4 && this.random() < dt * 0.3) this.looking = true;
      if (this.stateTime >= this.duration) {
        if (this.random() < k.graze.share) {
          this.setState('graze', between(this.random, k.graze.bout));
          this.nextLook = between(this.random, k.graze.look);
        } else {
          this.target = this.pickTarget(world);
          if (this.target) this.setState('wander', 12);
          else this.setState('idle', between(this.random, k.wander.idle));
        }
      }
    } else if (s === 'graze') {
      // Now and then the head comes up for a look round.
      this.nextLook -= dt;
      if (this.nextLook <= 0) {
        this.headUp = !this.headUp;
        this.nextLook = this.headUp ? between(this.random, [1, 2]) : between(this.random, k.graze.look);
      }
      if (this.stateTime >= this.duration) this.setState('idle', between(this.random, k.wander.idle));
    } else if (s === 'wander') {
      const to = this.offsetTo(this.target.x, this.target.y);
      // A rabbit lopes a little way, sits a moment, then lopes on.
      const hopping = !k.scatter || this.stateTime % 1.1 < 0.7;
      if (to.distance < 0.3 || this.stateTime > this.duration) this.setState('idle', between(this.random, k.wander.idle));
      else {
        face = to.bearing;
        speed = hopping && Math.abs(wrap(to.bearing - this.heading)) < 0.8 ? k.walkSpeed : 0;
      }
    } else if (s === 'alert') {
      face = this.offsetTo(this.threat.x, this.threat.y).bearing;
      turn = k.turn.calm * 2;
      if (this.stateTime >= this.duration) this.setState('idle', between(this.random, k.wander.idle));
    } else if (s === 'flee') {
      const from = this.offsetTo(this.threat.x, this.threat.y);
      if (k.flee.zigzag && this.stateTime >= this.nextTurn) {
        // A rabbit jinks, though always still away.
        let h = this.away + (this.random() * 2 - 1) * k.flee.jitter;
        if (Math.cos(h - (from.bearing + Math.PI)) < 0.2) h = from.bearing + Math.PI;
        this.heading = this.bestHeading(world, h);
        this.nextTurn = this.stateTime + between(this.random, k.flee.zigzag);
      }
      speed = k.fleeSpeed;
      turn = k.turn.flee;
      const safe = threat ? threat.distance > k.flee.safe : from.distance > k.flee.safe;
      if (this.stateTime >= this.duration || (safe && this.stateTime >= k.flee.min)) {
        this.wary = k.flee.calm;
        if (world.typeAt(this.x, this.y) === WATER) {
          // Still in the stream: it wades on out to the nearest bank first.
          this.setState('wade');
          this.target = this.nearestBank(world);
        } else if (k.flee.freeze) this.setState('freeze', between(this.random, k.flee.freeze));
        else this.setState('calm', 3.5);
      }
    } else if (s === 'wade') {
      if (world.typeAt(this.x, this.y) !== WATER) this.setState('calm', 3.5);
      else {
        face = this.target ? this.offsetTo(this.target.x, this.target.y).bearing : this.away;
        speed = k.trotSpeed ?? k.walkSpeed;
        turn = k.turn.flee;
      }
    } else if (s === 'calm') {
      // Out of a gallop to a trot, then a walk, then a stand.
      speed = this.stateTime < 2 ? k.trotSpeed : k.walkSpeed;
      if (this.stateTime >= this.duration) this.setState('idle', between(this.random, k.wander.idle));
    } else if (s === 'freeze' && this.stateTime >= this.duration) this.setState('idle', between(this.random, k.wander.idle));

    if (face !== null) this.turnTowards(face, turn, dt);
    const depth = world.waterDepthAt(this.x, this.y);
    this.waterDepth += (depth - this.waterDepth) * (1 - Math.exp(-dt * 10));
    this.speedScale = 1 - 0.4 * Math.min(1, this.waterDepth / MAX_WATER_DEPTH);
    this.speed = speed;
    const startX = this.x;
    const startY = this.y;
    if (speed > 0) {
      const d = speed * this.speedScale * dt;
      const [dx, dy] = toCells(Math.sin(this.heading) * d, Math.cos(this.heading) * d);
      if (this.step(world, dx, dy)) this.blocked = 0;
      else if (++this.blocked >= 3 && this.state === 'flee') {
        this.heading = this.bestHeading(world, this.away);
        this.blocked = 0;
      } else if (this.blocked >= 3 && this.state === 'wade') {
        this.target = this.nearestBank(world);
        this.blocked = 0;
      } else if (this.state === 'wander') this.setState('idle', between(this.random, k.wander.idle));
    }
    this.separate(world, dt);
    if (depth > 0) this.drift(dt, world, depth);
    this.groundSpeed = metres(this.x - startX, this.y - startY) / Math.max(dt, 1e-3);
  }

  // Herd mates keep a little room between them.
  separate(world, dt) {
    for (const mate of this.herd?.members ?? []) {
      if (mate === this) continue;
      const { mx, mz, distance } = this.offsetTo(mate.x, mate.y);
      if (distance >= this.kind.herd.spacing * 0.8 || distance < 1e-6) continue;
      const push = (this.kind.herd.spacing * 0.8 - distance) * Math.min(1, dt * 2);
      const [dx, dy] = toCells((-mx / distance) * push, (-mz / distance) * push);
      if (footing(world, this.kind, this.x + dx, this.y + dy, this.inFlight)) {
        this.x += dx;
        this.y += dy;
      }
    }
  }

  // Wading, a river's current carries it downstream, as it does monsters.
  drift(dt, world, depth) {
    easeCarry(this.carry, currentAt(world, this.x, this.y, immersion(depth)), dt);
    if (!this.carry.x && !this.carry.y) return;
    const { cols, rows } = flowCells(this.carry.x * dt, this.carry.y * dt);
    for (const [dx, dy] of [[cols, rows], [cols, 0], [0, rows]]) {
      if (footing(world, this.kind, this.x + dx, this.y + dy, true)) {
        this.x += dx;
        this.y += dy;
        return;
      }
    }
  }
}

export class Animals {
  // `counts` caps how many of each kind live at once; `habitat` is how a
  // cell's habitat is read (the world's own by default).
  constructor({ seed = 1, counts = { deer: 8, rabbit: 6 }, enabled = true, habitat = habitatAt } = {}) {
    this.seed = seed;
    this.counts = { ...counts };
    this.enabled = enabled;
    this.habitat = habitat;
    this.list = [];
    this.herds = new Map();
    // When each region let go of its herd, for its rest.
    this.released = new Map();
    // Each region's group, once rolled.
    this.rolls = new Map();
    this.random = mulberry32((seed * 6007) ^ 0xdee5);
    this.time = 0;
    this.scanIn = 0;
    this.events = [];
    // Noises heard since the last step.
    this.noises = [];
    this.debugHerds = 0;
    this.focus = null;
  }

  // A region's group, rolled once and kept (the newest 64).
  rollOf(world, rx, ry) {
    const key = `${rx},${ry}`;
    if (this.rolls.has(key)) return this.rolls.get(key);
    const roll = herdOf(this.seed, rx, ry, regionHabitat(world, rx, ry, this.habitat));
    this.rolls.set(key, roll);
    if (this.rolls.size > 64) this.rolls.delete(this.rolls.keys().next().value);
    return roll;
  }

  count(kind) {
    return this.list.filter((a) => a.kind.id === kind).length;
  }

  // Whether a group of a kind and size fits under the caps.
  fits(kind, size) {
    return this.count(kind) + size <= (this.counts[kind] ?? 0) && this.list.length + size <= MAX_ANIMALS;
  }

  // Puts a herd into the world, its first member leading.
  place(key, kind, spots, { stag = false, seed = 1, heading = 0 } = {}) {
    const herd = { key, kind, home: { x: spots[0][0], y: spots[0][1] }, members: [], leader: null, flightFor: 0 };
    spots.forEach(([x, y], i) => {
      const variant = kind.id === 'deer' ? (stag && i === 0 ? 'stag' : 'hind') : null;
      const animal = new Animal(kind, x, y, { variant, herd, seed: seed + i * 977,
        heading: heading + (i * 2.4) % (Math.PI * 2) });
      herd.members.push(animal);
      this.list.push(animal);
    });
    herd.leader = herd.members[0];
    this.herds.set(key, herd);
    return herd;
  }

  // Places a herd at once where asked, ignoring habitat and the view, and
  // keeps it however far the player goes (for debugging and screenshots).
  spawn(kind, { x, y, count = 3, variant = null, world = null } = {}) {
    const k = KINDS[kind];
    const spots = [];
    for (let i = 0; i < count; i++) {
      const angle = i * 2.4;
      const r = i ? k.herd.spacing * (0.8 + 0.4 * Math.sqrt(i)) : 0;
      const [dx, dy] = toCells(Math.sin(angle) * r, Math.cos(angle) * r);
      const spot = [x + dx, y + dy];
      if (!world || footing(world, k, spot[0], spot[1])) spots.push(spot);
    }
    if (!spots.length) return null;
    return this.place(`debug:${++this.debugHerds}`, k, spots, { stag: variant === 'stag' || (kind === 'deer' && variant === null),
      seed: Math.floor(this.random() * 2 ** 31), heading: this.random() * Math.PI * 2 });
  }

  // Lets every alarm go, for a quiet scene.
  calm() {
    for (const a of this.list) {
      a.setState('idle', between(a.random, a.kind.wander.idle));
      a.boltIn = null;
      a.wary = 0;
    }
    for (const herd of this.herds.values()) herd.flightFor = 0;
  }

  // Lets go of a herd; its region rests before it can hold one again.
  release(herd) {
    this.herds.delete(herd.key);
    this.list = this.list.filter((a) => a.herd !== herd);
    this.released.set(herd.key, this.time);
  }

  // Whether a cell lies on screen or just off it.
  static inView(view, x, y) {
    return Boolean(view) && x > view.x0 - VIEW_MARGIN.cols && x < view.x0 + view.cols + VIEW_MARGIN.cols
      && y > view.y0 - VIEW_MARGIN.rows && y < view.y0 + view.rows + VIEW_MARGIN.rows;
  }

  // Brings in the herds of the regions within reach whose homes lie in the
  // ring round the player, off screen, on loaded and open land.
  activate(world, player, view) {
    const [cols, rows] = toCells(RING.far, RING.far);
    for (let ry = Math.floor((player.y - rows) / REGION.rows); ry <= Math.floor((player.y + rows) / REGION.rows); ry++) {
      for (let rx = Math.floor((player.x - cols) / REGION.cols); rx <= Math.floor((player.x + cols) / REGION.cols); rx++) {
        const key = `${rx},${ry}`;
        if (this.herds.has(key)) continue;
        if (this.time - (this.released.get(key) ?? -Infinity) < RING.cooldown) continue;
        const roll = this.rollOf(world, rx, ry);
        if (!roll || !this.fits(roll.kind.id, roll.size)) continue;
        const d = metres(roll.home.x - player.x, roll.home.y - player.y);
        if (d < RING.near || d > RING.far || Animals.inView(view, roll.home.x, roll.home.y)) continue;
        const spots = [];
        for (const tries of roll.places) {
          for (const [mx, mz] of tries) {
            const [dx, dy] = toCells(mx, mz);
            const x = roll.home.x + dx;
            const y = roll.home.y + dy;
            if (Animals.inView(view, x, y) || !footing(world, roll.kind, x, y)) continue;
            if (metres(x - player.x, y - player.y) < RING.near) continue;
            spots.push([x, y]);
            break;
          }
        }
        if (spots.length < roll.size) continue;
        this.place(key, roll.kind, spots, { stag: roll.stag, seed: roll.seed, heading: (roll.seed % 628) / 100 });
      }
    }
  }

  // A noise: animals near enough bolt from it, those a little further off
  // look up toward it.
  hear(e) {
    if (!this.enabled) return;
    let loud = 0;
    if (e.type === 'strike') loud = LOUDNESS.strike;
    else if (e.type === 'slam' || e.type === 'whirl' || e.type === 'land') loud = (e.strength ?? 1) > 0.5 ? LOUDNESS[e.type] : 0;
    else if ((e.type === 'death' || e.type === 'hurt') && e.monster) loud = LOUDNESS[e.type];
    else if (e.type === 'spell') loud = e.stage === 'cast' ? LOUDNESS.cast : e.stage === 'impact' ? LOUDNESS.impact : 0;
    else if (e.type === 'lightning') loud = LOUDNESS.lightning;
    else if (e.type === 'step') loud = (e.strength ?? 0) > 0.6 ? LOUDNESS.step : 0;
    if (!loud) return;
    const at = Number.isFinite(e.x) && Number.isFinite(e.y) ? { x: e.x, y: e.y } : this.focus;
    if (!at) return;
    this.noises.push({ at, loud });
  }

  // The things an animal of a kind fears, nearest first.
  nearestThreat(animal, threats) {
    let best = null;
    for (const t of threats) {
      if (!animal.kind.fears.includes(t.kind)) continue;
      const distance = metres(t.x - animal.x, t.y - animal.y);
      if (!best || distance < best.distance) best = { ...t, distance };
    }
    return best;
  }

  // One step: herds are brought in and let go round the player, noises
  // heard, and every animal thinks and moves. `peers` are friends' figures
  // and `monsters` the living monsters, all of which animals shy from.
  update(dt, world, { player, peers = [], monsters = [], view = null }) {
    this.time += dt;
    this.focus = { x: player.x, y: player.y };
    if (!this.enabled) {
      this.list = [];
      this.herds.clear();
      return;
    }
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = 0.5;
      for (const herd of [...this.herds.values()]) {
        if (herd.key.startsWith('debug:')) continue;
        if (herd.members.every((a) => metres(a.x - player.x, a.y - player.y) > RING.release)) this.release(herd);
      }
      this.activate(world, player, view);
    }
    const walker = (p, pace) => ({ kind: 'player', x: p.x, y: p.y, moving: pace > 0.3, running: pace > (p.walkSpeed ?? 2) * 1.3 });
    const threats = [walker(player, player.groundSpeed ?? 0)];
    // A friend's ground covered is not sent over the network, only the
    // pace they move at, so that is what their figure is judged by.
    for (const peer of peers) {
      const p = peer.player ?? peer;
      threats.push(walker(p, Math.max(p.groundSpeed ?? 0, p.speed ?? 0)));
    }
    for (const m of monsters) {
      const speed = m.groundSpeed ?? m.speed ?? 0;
      threats.push({ kind: 'monster', x: m.x, y: m.y, moving: speed > 0.3, running: speed > 2.5 });
    }
    for (const { at, loud } of this.noises) {
      for (const a of this.list) {
        const r = Math.min(loud, a.kind.senses.noise);
        const d = metres(at.x - a.x, at.y - a.y);
        if (d < r) {
          if (a.state !== 'flee') a.bolt(world, at);
        } else if (d < r * 2 && a.calm) a.alert(at);
      }
    }
    this.noises.length = 0;
    for (const herd of this.herds.values()) herd.flightFor -= dt;
    for (const a of this.list) {
      a.update(dt, world, this.nearestThreat(a, threats));
      for (const e of a.events) this.events.push({ ...e, animal: a });
      a.events.length = 0;
    }
  }
}

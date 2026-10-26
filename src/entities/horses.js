import { hash2, mulberry32 } from '../core/rng.js';
import { dryLand, toCells } from './monsters.js';

// Saddled horses with a rider sitting them, standing idle. This first look
// has no mounting and no travel: a horse stands where it was placed, breathes
// and swishes its tail, and every so often shifts its weight and paws the
// ground once with a hind hoof. A horse with nobody on it may also put its head down to graze; one
// being ridden never does.

export const HORSE = Object.freeze({
  id: 'horse',
  name: 'Horse',
  // Metres. The top of the back where the saddle sits; the withers stand
  // about 1.6 m, a riding horse of 15 to 16 hands.
  backHeight: 1.5,
  withers: 1.6,
  // Nose to rump and across the barrel, for the shadow and the fog.
  length: 2.4,
  width: 0.6,
  // The shadow's half length and half width, metres.
  shadow: [1.15, 0.36],
  clips: { idle: 'Idle', shift: 'Idle_2', graze: 'Eating' },
  // How long the clips played once last, seconds.
  lengths: { shift: 3.333, graze: 6 },
  // Seconds between weight shifts.
  fidget: [8, 20],
  // A riderless horse starts grazing at this chance a second.
  graze: { chance: 1 / 15 },
  // At most this many stand round the spawn (?horse=N).
  max: 4,
  // How far from where it was asked a horse may be placed on dry land, metres.
  reach: 6,
});

const between = (random, [lo, hi]) => lo + random() * (hi - lo);

// Offsets in metres within reach of a point, nearest first, on a half-metre grid.
const STEP = 0.5;
const OFFSETS = [];
for (let i = -HORSE.reach / STEP; i <= HORSE.reach / STEP; i++) {
  for (let j = -HORSE.reach / STEP; j <= HORSE.reach / STEP; j++) {
    if (Math.hypot(i, j) * STEP <= HORSE.reach) OFFSETS.push([i * STEP, j * STEP]);
  }
}
OFFSETS.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));

let nextId = 1;

export class Horse {
  constructor(x, y, { heading = -0.7, rider = true, seed = 1 } = {}) {
    this.id = nextId++;
    this.kind = HORSE;
    this.x = x;
    this.y = y;
    // atan2 of the way it faces across and toward the camera: 0 faces the
    // camera, a quarter turn faces right.
    this.heading = heading;
    // Who sits it: for now a stand-in in the outlaw's clothes.
    this.rider = rider ? { look: 'outlaw' } : null;
    this.seed = seed;
    this.random = mulberry32(seed);
    this.alive = true;
    this.speed = 0;
    this.groundSpeed = 0;
    // 'idle' or, with nobody on it, 'graze'.
    this.state = 'idle';
    this.play('idle');
    this.nextShift = between(this.random, HORSE.fidget);
  }

  // Starts a clip from its beginning; `plays` counts the starts, so a figure
  // can tell a fresh start from one under way.
  play(clip) {
    this.clip = clip;
    this.clipTime = 0;
    this.plays = (this.plays ?? 0) + 1;
  }

  update(dt) {
    this.clipTime += dt;
    if (this.clip !== 'idle') {
      if (this.clipTime < HORSE.lengths[this.clip]) return;
      this.state = 'idle';
      this.play('idle');
      this.nextShift = between(this.random, HORSE.fidget);
      return;
    }
    if (!this.rider && this.random() < HORSE.graze.chance * dt) {
      this.state = 'graze';
      this.play('graze');
      return;
    }
    this.nextShift -= dt;
    if (this.nextShift <= 0) this.play('shift');
  }
}

export class Horses {
  constructor({ seed = 1 } = {}) {
    this.seed = seed;
    this.random = mulberry32(Math.floor(hash2(seed, 219, 7411) * 2 ** 32));
    this.list = [];
  }

  // Stands a horse on the dry land nearest the point within reach; null if
  // there is none (out on a lake).
  spawn({ world, x, y, heading = -0.7, rider = true } = {}) {
    for (const [mx, mz] of OFFSETS) {
      const [dx, dy] = toCells(mx, mz);
      const cx = Math.floor(x + dx);
      const cy = Math.floor(y + dy);
      if (!dryLand(world, cx, cy)) continue;
      const horse = new Horse(cx + 0.5, cy + 0.5, { heading, rider, seed: Math.floor(this.random() * 2 ** 31) });
      this.list.push(horse);
      return horse;
    }
    return null;
  }

  remove(horse) {
    this.list = this.list.filter((h) => h !== horse);
  }

  update(dt) {
    for (const horse of this.list) horse.update(dt);
  }

  // ?horse=N (0 to 4) saddled horses near the spawn: the first 4 m east of
  // it, each next 3.5 m further south-east, each a quarter turn round from
  // the last.
  static fromParams(params, { world, seed, spawn }) {
    const horses = new Horses({ seed });
    const asked = Number(params.get('horse') ?? 0);
    const count = Number.isFinite(asked) ? Math.max(0, Math.min(HORSE.max, Math.floor(asked))) : 0;
    for (let i = 0; i < count; i++) {
      const along = (i * 3.5) / Math.SQRT2;
      const [dx, dy] = toCells(4 + along, along);
      horses.spawn({ world, x: spawn.x + dx, y: spawn.y + dy, heading: -0.7 + (i * Math.PI) / 2 });
    }
    return horses;
  }
}

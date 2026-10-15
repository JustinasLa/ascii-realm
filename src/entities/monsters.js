import { mulberry32 } from '../core/rng.js';
import { ASPECT, MAX_WATER_DEPTH, WATER } from '../world/world.js';
import { SCALE, TILT } from './rig.js';

// Monsters that hunt the player. Each kind shares one way of thinking and
// moving (chase, strike, reel from a cut, fall) and is set apart by its
// profile below. This is the behaviour only; the 3D figures that draw them
// live in monster-figures.js.

const freeze = (o) => Object.freeze(o);

export const KINDS = freeze({
  // Restless dead that climb out of the ground, run at the player and hack
  // at them with a rusted sword. Three cuts break one apart.
  skeleton: freeze({
    id: 'skeleton',
    name: 'Skeleton',
    health: 60,
    // Climbing out of the ground, in seconds; 0 for a monster that arrives
    // on its feet.
    rise: 1.6,
    // Ground speeds in metres per second. A sprinting player can outrun one.
    walkSpeed: 1.2,
    // Its run as a share of the player's.
    runShare: 0.8,
    maxRun: 4.6,
    // How close the player must come before it gives chase, and how far they
    // must get before it loses interest, in metres.
    notice: 32,
    forget: 48,
    // It swings once within this distance...
    reach: 1.35,
    // ...and the blow lands this far into the swing, if the player is still
    // within `hitRange` and in front of it.
    windUp: 0.5,
    swingTime: 1.05,
    hitRange: 1.9,
    hitArc: 1.25,
    damage: 12,
    cooldown: 0.45,
    // Reeling from a cut.
    stagger: 0.45,
    knockback: 0.55,
    // How long the body lies before sinking away, and how long that takes.
    linger: 24,
    sink: 2.5,
    // How close two monsters may stand, in metres.
    personalSpace: 0.85,
    // Hit and run: after this many blows it backs off this far for a while.
    // 0 never backs off.
    skirmishAfter: 0,
    // Below this share of its health it runs away for `flee` seconds.
    panic: 0,
    flee: 0,
    // Where it may appear, in metres from the player, and how many seconds
    // pass before the first and between the next.
    spawn: freeze({ near: 14, far: 26, first: 3, every: 9 }),
    // Its stride, in metres, walking and running.
    stride: freeze({ walk: 0.6, run: 0.95 }),
    // Sounds for its being hurt, dying, rising and noticing the player.
    sounds: freeze({ hurt: 'bone-hit', death: 'bone-collapse', rise: 'bone-rise' }),
  }),
  // Small, quick and cowardly: it darts in to stab with a dagger, skips back
  // out of reach and circles, and runs off squealing when wounded. Two cuts
  // finish one.
  goblin: freeze({
    id: 'goblin',
    name: 'Goblin',
    health: 35,
    rise: 0,
    walkSpeed: 1.5,
    runShare: 0.92,
    maxRun: 5.2,
    notice: 26,
    forget: 42,
    reach: 1.05,
    windUp: 0.24,
    swingTime: 0.55,
    hitRange: 1.5,
    hitArc: 1.1,
    damage: 6,
    cooldown: 0.2,
    stagger: 0.3,
    knockback: 0.85,
    linger: 18,
    sink: 2.5,
    personalSpace: 0.7,
    skirmishAfter: 1,
    backOff: 3.2,
    panic: 0.45,
    flee: 2.6,
    spawn: freeze({ near: 20, far: 28, first: 12, every: 14 }),
    stride: freeze({ walk: 0.4, run: 0.7 }),
    sounds: freeze({ hurt: 'goblin-hit', death: 'goblin-death', spot: 'goblin-spot' }),
  }),
});

// Offsets on screen to metres on the ground, and back. A metre across the
// screen spans SCALE / ASPECT cells; down the screen it is foreshortened by
// the camera's tilt.
export const toMetres = (dx, dy) => [dx * ASPECT / SCALE, dy / (SCALE * TILT)];
export const toCells = (mx, mz) => [mx * SCALE / ASPECT, mz * SCALE * TILT];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Whether a monster can stand at a point: clear of solid props, with room
// for its shoulders like the player. Like the player it wades through
// water, which never comes above the knee.
export function standable(world, x, y) {
  return world.isWalkable(x, y) && world.isWalkable(x - 1, y) && world.isWalkable(x + 1, y);
}

// Monsters appear on solid earth, not lake beds.
export function dryLand(world, x, y) {
  return world.typeAt(x, y) !== WATER && standable(world, x, y);
}

let nextId = 1;

export class Monster {
  constructor(x, y, { kind = KINDS.skeleton, heading = 0, risen = false } = {}) {
    this.id = nextId++;
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.health = kind.health;
    this.maxHealth = kind.health;
    // 'rise', 'idle', 'chase', 'attack', 'skirmish', 'flee', 'stagger' or
    // 'dead'.
    this.state = risen || !kind.rise ? 'idle' : 'rise';
    this.stateTime = 0;
    this.speed = 0;
    // The ground actually covered this frame, for the legs.
    this.groundSpeed = 0;
    this.cooldown = 0;
    this.struck = false;
    // Blows struck since it last backed off.
    this.blows = 0;
    // Which way it circles while backing off, and for how long.
    this.circle = 1;
    this.skirmishFor = 0;
    // Seconds since the last cut it took, for a flash of the body.
    this.hurt = Infinity;
    this.panicked = false;
    this.deadTime = 0;
    // How far the body has sunk into the ground, 0 to 1.
    this.sunk = 0;
    // Metres below the surface while wading, and how much the water slows
    // it, as for the player.
    this.waterDepth = 0;
    this.speedScale = 1;
    // Ground covered since the last footfall.
    this.stride = 0;
    this.events = [];
  }

  get alive() {
    return this.state !== 'dead';
  }

  // Ready to be removed once it has sunk away.
  get gone() {
    return this.state === 'dead' && this.sunk >= 1;
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  // Metres from this monster to a point, and the bearing to it.
  offsetTo(x, y) {
    const [mx, mz] = toMetres(x - this.x, y - this.y);
    return { mx, mz, distance: Math.hypot(mx, mz), bearing: Math.atan2(mx, mz) };
  }

  turnTowards(bearing, rate, dt) {
    const d = wrap(bearing - this.heading);
    const step = rate * dt;
    this.heading = wrap(this.heading + Math.max(-step, Math.min(step, d)));
  }

  // Its full run towards a player running at `runSpeed`.
  runFor(target) {
    return Math.min(this.kind.maxRun, (target?.runSpeed ?? 5) * this.kind.runShare);
  }

  // One step of thought and movement. `target` is the player; `others` the
  // rest of the monsters, so they spread around their prey.
  update(dt, world, target, others = [], random = Math.random) {
    const k = this.kind;
    this.stateTime += dt;
    this.hurt += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.groundSpeed = 0;
    const depth = world.waterDepthAt?.(this.x, this.y) ?? 0;
    this.waterDepth += (depth - this.waterDepth) * (1 - Math.exp(-12 * dt));
    if (Math.abs(depth - this.waterDepth) < 0.001) this.waterDepth = depth;
    this.speedScale = 1 - 0.38 * this.waterDepth / MAX_WATER_DEPTH;
    if (this.state === 'dead') {
      this.deadTime += dt;
      if (this.deadTime > k.linger) this.sunk = Math.min(1, (this.deadTime - k.linger) / k.sink);
      return;
    }
    const prey = target && target.alive !== false ? this.offsetTo(target.x, target.y) : null;
    let want = 0;
    switch (this.state) {
      case 'rise':
        if (prey) this.turnTowards(prey.bearing, 2, dt);
        if (this.stateTime >= k.rise) this.setState('idle');
        break;
      case 'idle':
        if (prey && prey.distance < k.notice) {
          this.setState('chase');
          if (k.sounds.spot) this.events.push({ type: 'spot', x: this.x, y: this.y, strength: 1 });
        }
        break;
      case 'chase': {
        if (!prey || prey.distance > k.forget) {
          this.setState('idle');
          break;
        }
        this.turnTowards(prey.bearing, 7, dt);
        if (prey.distance <= k.reach) {
          if (this.cooldown === 0 && (target.air ?? 0) < 0.5) {
            this.setState('attack');
            this.struck = false;
            this.events.push({ type: 'swing', move: 'a', speed: 0.8 * k.swingTime ** -0.5, strength: 0.8,
              x: this.x, y: this.y });
          }
          break;
        }
        // Slow to a walk when nearly within reach, so it does not overrun.
        want = prey.distance < k.reach + 1.2 ? k.walkSpeed * 1.5 : this.runFor(target);
        break;
      }
      case 'attack':
        // It tracks its prey while winding up, then commits to the blow.
        if (prey && this.stateTime < k.windUp * 0.7) this.turnTowards(prey.bearing, 5, dt);
        if (!this.struck && this.stateTime >= k.windUp) {
          this.struck = true;
          this.blows++;
          if (prey && this.canHit(prey, target)) {
            this.events.push({ type: 'hit-player', amount: k.damage, x: target.x, y: target.y });
          } else {
            this.events.push({ type: 'miss', x: this.x, y: this.y });
          }
        }
        // A little lunge into the blow.
        if (this.stateTime > k.windUp * 0.6 && this.stateTime < k.windUp * 1.1) want = 1.6;
        if (this.stateTime >= k.swingTime) {
          this.cooldown = k.cooldown;
          if (prey && k.skirmishAfter && this.blows >= k.skirmishAfter) {
            // Skip back out of reach and circle before the next rush.
            this.blows = 0;
            this.circle = random() < 0.5 ? -1 : 1;
            this.skirmishFor = 0.9 + random() * 0.8;
            this.setState('skirmish');
          } else this.setState(prey ? 'chase' : 'idle');
        }
        break;
      case 'skirmish':
        if (!prey) {
          this.setState('idle');
          break;
        }
        // Away while too close, then round the player at a distance.
        this.turnTowards(prey.distance < k.backOff ? prey.bearing + Math.PI - this.circle * 0.5
          : prey.bearing + this.circle * Math.PI / 2, 8, dt);
        want = this.runFor(target) * 0.75;
        if (this.stateTime >= this.skirmishFor) this.setState('chase');
        break;
      case 'flee':
        // Running for its life, then back for more.
        if (prey) this.turnTowards(prey.bearing + Math.PI, 6, dt);
        want = this.runFor(target);
        if (this.stateTime >= k.flee) this.setState(prey ? 'chase' : 'idle');
        break;
      case 'stagger':
        if (this.stateTime >= k.stagger) {
          if (k.panic && !this.panicked && this.health < k.health * k.panic) {
            this.panicked = true;
            this.setState('flee');
          } else this.setState(prey ? 'chase' : 'idle');
        }
        break;
    }
    want *= this.speedScale;
    const ease = 1 - Math.exp(-dt * (want > this.speed ? 6 : 10));
    this.speed += (want - this.speed) * ease;
    if (this.speed < 0.02 && want === 0) this.speed = 0;
    let mx = Math.sin(this.heading) * this.speed * dt;
    let mz = Math.cos(this.heading) * this.speed * dt;
    // Keep a little apart from one another and out of the player.
    for (const other of others) {
      if (other === this || !other.alive) continue;
      const o = this.offsetTo(other.x, other.y);
      const space = (k.personalSpace + other.kind.personalSpace) / 2;
      if (o.distance < space && o.distance > 1e-6) {
        const push = (space - o.distance) * 2 * dt;
        mx -= (o.mx / o.distance) * push;
        mz -= (o.mz / o.distance) * push;
      }
    }
    if (prey && prey.distance < 0.75 && prey.distance > 1e-6) {
      const push = (0.75 - prey.distance);
      mx -= (prey.mx / prey.distance) * push;
      mz -= (prey.mz / prey.distance) * push;
    }
    this.move(world, mx, mz);
    const covered = Math.hypot(...toMetres(this.x - this.lastX, this.y - this.lastY));
    this.groundSpeed = dt > 0 ? covered / dt : 0;
    // A footfall every stride, longer when running: a splash in the water.
    this.stride += covered;
    const length = k.stride.walk + (k.stride.run - k.stride.walk) * Math.min(1, this.groundSpeed / 4);
    if (this.stride >= length) {
      this.stride -= length;
      this.events.push({ type: 'step', x: this.x, y: this.y, strength: Math.min(1, this.groundSpeed / 5) });
    }
  }

  // Whether its blow lands: the player is close, in front of it, and not
  // high in the air.
  canHit(prey, target) {
    return prey.distance <= this.kind.hitRange
      && Math.abs(wrap(prey.bearing - this.heading)) <= this.kind.hitArc
      && (target.air ?? 0) < 0.6;
  }

  // Moves by metres; it will not walk through trees and rocks.
  // Blocked, it slides along the obstacle, or failing that veers around it,
  // keeping to the side it last went round. One caught inside something
  // (risen under a fallen trunk, say) may walk out.
  move(world, mx, mz) {
    this.lastX = this.x;
    this.lastY = this.y;
    if (!mx && !mz) return;
    const stuck = !standable(world, this.x, this.y);
    const go = (ax, az) => {
      const [dx, dy] = toCells(ax, az);
      if (!stuck && !standable(world, this.x + dx, this.y + dy)) return false;
      this.x += dx;
      this.y += dy;
      return true;
    };
    if (go(mx, mz)) return;
    // Sliding only counts if it keeps a fair share of the step; edging
    // along a face it is running straight into gets it nowhere.
    const step = Math.hypot(mx, mz);
    if (Math.abs(mx) > step * 0.4 && go(mx, 0)) return;
    if (Math.abs(mz) > step * 0.4 && go(0, mz)) return;
    const side = this.detour ?? 1;
    for (const turn of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
      const a = turn * side;
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (go(mx * c + mz * s, -mx * s + mz * c)) {
        this.detour = Math.sign(a);
        return;
      }
    }
  }

  // A cut from the player. Returns whether it struck home.
  takeHit(damage, fromX, fromY) {
    const k = this.kind;
    if (!this.alive || this.state === 'rise' && this.stateTime < k.rise * 0.5) return false;
    this.health = Math.max(0, this.health - damage);
    this.hurt = 0;
    const away = this.offsetTo(fromX, fromY);
    this.events.push({ type: 'hurt', amount: damage, x: this.x, y: this.y, strength: Math.min(1, damage / 25) });
    if (this.health <= 0) {
      // Facing the blow as it falls.
      this.heading = away.bearing;
      this.speed = 0;
      this.setState('dead');
      this.deadTime = 0;
      this.events.push({ type: 'death', x: this.x, y: this.y, strength: 1 });
      return true;
    }
    this.knock = { bearing: away.bearing + Math.PI, left: k.knockback };
    this.heading = away.bearing;
    this.speed = 0;
    this.setState('stagger');
    return true;
  }
}

// Every monster in the world: it brings new ones in a short way from the
// player, up to so many of each kind, turns the player's sword cuts into
// hits, and clears away the fallen. Events carry the monster they came from.
export class Monsters {
  // `counts` caps how many of each kind are about at once.
  constructor({ counts = { skeleton: 3, goblin: 2 }, seed = 1, first = null, every = null } = {}) {
    this.list = [];
    this.counts = { ...counts };
    this.random = mulberry32((seed * 7919) ^ 0x5eed);
    this.spawnIn = {};
    for (const id of Object.keys(this.counts)) this.spawnIn[id] = first ?? KINDS[id].spawn.first;
    this.every = every;
    this.events = [];
    this.kills = 0;
  }

  get living() {
    return this.list.filter((m) => m.alive);
  }

  of(kind) {
    return this.list.filter((m) => m.kind.id === kind);
  }

  // Brings a monster in somewhere on dry, open ground at the kind's distance
  // from the player, facing them. Returns it, or null if no place was found.
  spawnNear(world, player, kind = 'skeleton', { near, far, risen = false } = {}) {
    const k = KINDS[kind];
    near ??= k.spawn.near;
    far ??= k.spawn.far;
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const distance = near + this.random() * (far - near);
      const [dx, dy] = toCells(Math.sin(angle) * distance, Math.cos(angle) * distance);
      const x = player.x + dx;
      const y = player.y + dy;
      if (!dryLand(world, x, y)) continue;
      const monster = new Monster(x, y, { kind: k, heading: angle + Math.PI, risen });
      this.list.push(monster);
      if (monster.state === 'rise') this.events.push({ type: 'rise', x, y, strength: 0.7, monster });
      return monster;
    }
    return null;
  }

  update(dt, world, player) {
    for (const [kind, max] of Object.entries(this.counts)) {
      if (this.of(kind).filter((m) => m.alive).length >= max) continue;
      this.spawnIn[kind] -= dt;
      if (this.spawnIn[kind] <= 0) {
        this.spawnNear(world, player, kind);
        this.spawnIn[kind] = this.every ?? KINDS[kind].spawn.every;
      }
    }
    const living = this.living;
    for (const monster of this.list) {
      if (monster.knock) {
        const step = Math.min(monster.knock.left, dt * 4);
        monster.knock.left -= step;
        monster.move(world, Math.sin(monster.knock.bearing) * step, Math.cos(monster.knock.bearing) * step);
        if (monster.knock.left <= 0) monster.knock = null;
      }
      monster.update(dt, world, player, living, this.random);
      this.collect(monster);
    }
    this.list = this.list.filter((m) => !m.gone);
  }

  collect(monster) {
    for (const e of monster.events) this.events.push({ ...e, monster });
    monster.events.length = 0;
  }

  // A sword cut from the player (a 'strike' event, see player.js) hits every
  // monster within the weapon's reach in front of them, or all round for a
  // spinning slash. Returns the monsters hit.
  strike(event, player, damage) {
    const reach = (player.feel?.reach ?? 0.95) + 0.75;
    const all = event.swing === 'spin';
    const hit = [];
    for (const monster of this.list) {
      if (!monster.alive) continue;
      const [mx, mz] = toMetres(monster.x - player.x, monster.y - player.y);
      const distance = Math.hypot(mx, mz);
      if (distance > reach) continue;
      const off = Math.abs(wrap(Math.atan2(mx, mz) - player.heading));
      if (!all && distance > 0.5 && off > 1.25) continue;
      if (monster.takeHit(damage, player.x, player.y)) hit.push(monster);
    }
    for (const monster of hit) {
      if (!monster.alive) this.kills++;
      this.collect(monster);
    }
    return hit;
  }

  // Calls them all off, e.g. once the player has fallen.
  clear() {
    this.list.length = 0;
    for (const id of Object.keys(this.spawnIn)) this.spawnIn[id] = this.every ?? KINDS[id].spawn.every;
  }
}

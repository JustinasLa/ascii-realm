import { mulberry32 } from '../core/rng.js';
import { Projectiles } from '../world/projectiles.js';
import { currentAt, easeCarry, immersion, toCells as flowCells } from '../world/rivers.js';
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
    // How close two monsters may stand, and how far its body reaches out
    // from its middle (so how close the player can get, and how far off a
    // cut still finds it), in metres.
    personalSpace: 0.85,
    radius: 0.75,
    // How many cuts it takes before reeling from one; 1 reels from every cut.
    poise: 1,
    // Below this share of its health it is enraged: quicker, by `fury`, and
    // swinging again sooner. 0 never is.
    enrage: 0,
    fury: 1,
    // Whether its blows are ground smashes: they land this far ahead, in
    // metres, and catch anyone within `smashRadius` of that spot rather than
    // in front of it, shaking the ground.
    slam: false,
    // Hit and run: after this many blows it backs off this far for a while.
    // 0 never backs off.
    skirmishAfter: 0,
    // Below this share of its health it runs away for `flee` seconds.
    panic: 0,
    flee: 0,
    // Where it may appear, in metres from the player, and how many seconds
    // pass before the first and between the next.
    spawn: freeze({ near: 14, far: 26, first: 6, every: 18 }),
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
    radius: 0.6,
    poise: 1,
    enrage: 0,
    fury: 1,
    slam: false,
    skirmishAfter: 1,
    backOff: 3.2,
    panic: 0.45,
    flee: 2.6,
    spawn: freeze({ near: 20, far: 28, first: 20, every: 28 }),
    stride: freeze({ walk: 0.4, run: 0.7 }),
    sounds: freeze({ hurt: 'goblin-hit', death: 'goblin-death', spot: 'goblin-spot' }),
  }),
  // Huge, slow and hard to stop: a troll lumbers after the player, raises its
  // stone club high and brings it down in a smash that shakes the ground. It
  // shrugs off most cuts, reeling only from every third, and rages when
  // badly hurt. Outrun it, or step aside from the smash and cut back.
  troll: freeze({
    id: 'troll',
    name: 'Troll',
    health: 150,
    rise: 0,
    walkSpeed: 1.3,
    runShare: 0.5,
    maxRun: 2.8,
    notice: 30,
    forget: 46,
    reach: 2.1,
    windUp: 0.95,
    swingTime: 1.7,
    hitRange: 2.8,
    hitArc: 1.0,
    damage: 26,
    cooldown: 1.1,
    stagger: 0.55,
    knockback: 0.25,
    linger: 30,
    sink: 3.5,
    personalSpace: 1.4,
    radius: 1.15,
    poise: 3,
    enrage: 0.45,
    fury: 1.35,
    slam: true,
    smashAt: 1.65,
    smashRadius: 1.4,
    skirmishAfter: 0,
    panic: 0,
    flee: 0,
    spawn: freeze({ near: 24, far: 32, first: 60, every: 90 }),
    stride: freeze({ walk: 1.0, run: 1.4 }),
    sounds: freeze({ hurt: 'troll-hit', death: 'troll-death', spot: 'troll-roar', enrage: 'troll-roar' }),
  }),
  // A tall, light-footed archer who never comes to blows: it keeps its
  // distance, stands to draw and loose arrows that lead a moving target,
  // sidesteps between shots and backs away when the player closes in.
  // Arrows can be dodged by moving; two cuts bring one down.
  elf: freeze({
    id: 'elf',
    name: 'Elf',
    health: 40,
    rise: 0,
    walkSpeed: 1.6,
    runShare: 0.88,
    maxRun: 5,
    notice: 34,
    forget: 52,
    // It never closes to strike, so these only matter for the shape of
    // the profile.
    reach: 0,
    windUp: 0.3,
    swingTime: 0.6,
    hitRange: 0,
    hitArc: 0,
    damage: 0,
    cooldown: 0,
    stagger: 0.35,
    knockback: 0.6,
    linger: 20,
    sink: 2.5,
    personalSpace: 0.8,
    radius: 0.6,
    poise: 1,
    enrage: 0,
    fury: 1,
    slam: false,
    skirmishAfter: 0,
    panic: 0,
    flee: 0,
    // How it fights from afar: the range it keeps, in metres, how long it
    // draws, how soon it shoots again, its arrows' speed (m/s) and damage,
    // how far ahead of a moving player it aims (at most, in seconds of
    // their movement), and how often it may back away.
    ranged: freeze({ near: 3.5, far: 8, draw: 0.85, cooldown: 1.3, speed: 16, damage: 9, lead: 0.6, kiteEvery: 3 }),
    spawn: freeze({ near: 22, far: 30, first: 40, every: 45 }),
    stride: freeze({ walk: 0.7, run: 1.1 }),
    sounds: freeze({ hurt: 'elf-hit', death: 'elf-death', spot: 'elf-spot', shoot: 'elf-shoot' }),
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
    // Cuts taken since it last reeled, and whether it has flown into a rage.
    this.shrugged = 0;
    this.enraged = false;
    // An archer's sense of how its prey is moving, in cells a second, and
    // how long until it may back away again.
    this.preyVelocity = { x: 0, y: 0 };
    this.lastPrey = null;
    this.kiteIn = 0;
    this.deadTime = 0;
    // How far the body has sunk into the ground, 0 to 1.
    this.sunk = 0;
    // Metres below the surface while wading, and how much the water slows
    // it, as for the player.
    this.waterDepth = 0;
    this.speedScale = 1;
    // How fast a river's current carries it, metres a second (x east, y
    // south), as for the player.
    this.carry = { x: 0, y: 0 };
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

  // Its full run towards a player running at `runSpeed`, and quicker still
  // in a rage.
  runFor(target) {
    return Math.min(this.kind.maxRun, (target?.runSpeed ?? 5) * this.kind.runShare) * this.fury;
  }

  get fury() {
    return this.enraged ? this.kind.fury : 1;
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
    this.speedScale = (1 - 0.38 * this.waterDepth / MAX_WATER_DEPTH) * (this.magicSpeed ?? 1);
    if (this.state === 'dead') {
      this.deadTime += dt;
      if (this.deadTime > k.linger) this.sunk = Math.min(1, (this.deadTime - k.linger) / k.sink);
      return;
    }
    if (this.magicStunned) {
      this.speed = 0;
      if (this.state !== 'rise') this.drift(dt, world, depth);
      return;
    }
    const prey = target && target.alive !== false ? this.offsetTo(target.x, target.y) : null;
    if (prey && this.lastPrey && dt > 0) {
      const k2 = 1 - Math.exp(-dt * 6);
      this.preyVelocity.x += ((target.x - this.lastPrey.x) / dt - this.preyVelocity.x) * k2;
      this.preyVelocity.y += ((target.y - this.lastPrey.y) / dt - this.preyVelocity.y) * k2;
    }
    this.lastPrey = prey ? { x: target.x, y: target.y } : null;
    this.kiteIn = Math.max(0, this.kiteIn - dt);
    let want = 0;
    if (k.ranged && (this.state === 'chase' || this.state === 'aim' || this.state === 'kite')) {
      want = this.archer(dt, prey, target, random);
    } else switch (this.state) {
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
        want = prey.distance < k.reach + 1.2 ? k.walkSpeed * 1.5 * this.fury : this.runFor(target);
        break;
      }
      case 'attack':
        // It tracks its prey while winding up, then commits to the blow.
        if (prey && this.stateTime < k.windUp * 0.7) this.turnTowards(prey.bearing, 5, dt);
        if (!this.struck && this.stateTime >= k.windUp) {
          this.struck = true;
          this.blows++;
          let impact = null;
          if (k.slam) {
            const [dx, dy] = toCells(Math.sin(this.heading) * k.smashAt, Math.cos(this.heading) * k.smashAt);
            impact = { x: this.x + dx, y: this.y + dy };
            this.events.push({ type: 'slam', ...impact, strength: 1 });
          }
          if (prey && this.canHit(prey, target, impact)) {
            this.events.push({ type: 'hit-player', amount: Math.max(0, k.damage + (this.magicDamage ?? 0)), x: target.x, y: target.y });
          } else {
            this.events.push({ type: 'miss', x: this.x, y: this.y });
          }
        }
        // A little lunge into the blow.
        if (this.stateTime > k.windUp * 0.6 && this.stateTime < k.windUp * 1.1) want = 1.6;
        if (this.stateTime >= k.swingTime) {
          this.cooldown = k.cooldown / this.fury;
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
    if (prey && prey.distance < k.radius && prey.distance > 1e-6) {
      const push = (k.radius - prey.distance);
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
    if (this.state !== 'rise') this.drift(dt, world, depth);
  }

  // Wading, it is carried downstream by a river's current like the
  // player. It only slides: no detours, and it never counts as walking.
  drift(dt, world, depth) {
    easeCarry(this.carry, currentAt(world, this.x, this.y, immersion(depth)), dt);
    if (!this.carry.x && !this.carry.y) return;
    const { cols, rows } = flowCells(this.carry.x * dt, this.carry.y * dt);
    if (standable(world, this.x + cols, this.y + rows)) {
      this.x += cols;
      this.y += rows;
    } else if (standable(world, this.x + cols, this.y)) this.x += cols;
    else if (standable(world, this.x, this.y + rows)) this.y += rows;
  }

  // An archer keeps its distance: closing in from too far, backing away from
  // too near, and otherwise sidestepping until it can stand, draw and loose
  // an arrow where a moving player is about to be. Returns the speed it wants.
  archer(dt, prey, target, random) {
    const k = this.kind;
    const r = k.ranged;
    if (!prey || prey.distance > k.forget) {
      this.setState('idle');
      return 0;
    }
    if (this.state === 'aim') {
      this.turnTowards(prey.bearing, 9, dt);
      if (prey.distance < r.near * 0.5 && this.kiteIn === 0) return this.kite(random, target);
      if (this.stateTime < r.draw) return 0;
      const lead = Math.min(r.lead, prey.distance / r.speed);
      this.events.push({ type: 'shoot', x: this.x, y: this.y,
        damage: Math.max(0, r.damage + (this.magicDamage ?? 0)), speed: r.speed, strength: 1,
        target: { x: target.x + this.preyVelocity.x * lead, y: target.y + this.preyVelocity.y * lead } });
      this.cooldown = r.cooldown;
      this.setState('chase');
      return 0;
    }
    if (this.state === 'kite') {
      this.turnTowards(prey.bearing + Math.PI + this.circle * 0.5, 8, dt);
      if (this.stateTime >= this.skirmishFor) this.setState('chase');
      return this.runFor(target);
    }
    if (prey.distance < r.near && this.kiteIn === 0) return this.kite(random, target);
    if (prey.distance > r.far) {
      this.turnTowards(prey.bearing, 7, dt);
      return this.runFor(target);
    }
    if (this.cooldown === 0 && (target.air ?? 0) < 0.5) {
      // Feet planted to draw.
      this.speed = 0;
      this.setState('aim');
      return 0;
    }
    // Between shots, step across the player's line.
    this.turnTowards(prey.bearing + this.circle * Math.PI / 2, 6, dt);
    return k.walkSpeed;
  }

  // Turns tail for a moment, veering to one side.
  kite(random, target) {
    this.circle = random() < 0.5 ? -1 : 1;
    this.skirmishFor = 0.7 + random() * 0.5;
    this.kiteIn = this.kind.ranged.kiteEvery;
    this.setState('kite');
    return this.runFor(target);
  }

  // Whether its blow lands: the player is close, in front of it (or near
  // where a smash comes down), and not high in the air.
  canHit(prey, target, impact = null) {
    if (impact) {
      const [mx, mz] = toMetres(target.x - impact.x, target.y - impact.y);
      return Math.hypot(mx, mz) <= this.kind.smashRadius && (target.air ?? 0) < 0.6;
    }
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
    damage = this.magic?.incoming(damage) ?? damage;
    if (damage <= 0) return false;
    this.health = Math.max(0, this.health - damage);
    this.hurt = 0;
    const away = this.offsetTo(fromX, fromY);
    this.events.push({ type: 'hurt', amount: damage, x: this.x, y: this.y, strength: Math.min(1, damage / 25) });
    if (k.enrage && !this.enraged && this.health > 0 && this.health < k.health * k.enrage) {
      this.enraged = true;
      this.events.push({ type: 'enrage', x: this.x, y: this.y, strength: 1 });
    }
    if (this.health <= 0) {
      // Facing the blow as it falls.
      this.heading = away.bearing;
      this.speed = 0;
      this.setState('dead');
      this.deadTime = 0;
      this.events.push({ type: 'death', x: this.x, y: this.y, strength: 1 });
      return true;
    }
    // A heavy monster shrugs off most cuts, carrying on with what it was
    // doing, and reels only from every so many.
    this.shrugged++;
    if (this.shrugged < k.poise) return true;
    this.shrugged = 0;
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
  constructor({ counts = { skeleton: 2, goblin: 1, troll: 1, elf: 1 }, seed = 1, first = null, every = null } = {}) {
    this.list = [];
    this.counts = { ...counts };
    this.random = mulberry32((seed * 7919) ^ 0x5eed);
    this.spawnIn = {};
    for (const id of Object.keys(this.counts)) this.spawnIn[id] = first ?? KINDS[id].spawn.first;
    this.every = every;
    this.events = [];
    this.kills = 0;
    // Arrows loosed at the player, flying or stuck where they fell.
    this.arrows = new Projectiles();
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
    this.flyArrows(dt, world, player);
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
    for (const e of monster.events) {
      if (e.type === 'shoot') this.loose(monster, e);
      this.events.push({ ...e, monster });
    }
    monster.events.length = 0;
  }

  // An arrow from an archer's shoulder in an arc to the ground where it
  // aimed; one that cannot reach is not loosed.
  loose(monster, e) {
    const arrow = this.arrows.launch({ x: monster.x, y: monster.y, h: SCALE * 1.4, aimTarget: e.target,
      projectile: { kind: 'arrow', speed: e.speed }, damage: e.damage, weapon: monster.kind.id });
    if (arrow) arrow.shooter = monster;
    return arrow;
  }

  // Flies the arrows on and checks each one's path this frame against the
  // player's body: it strikes if it passes within a hand's breadth of them
  // at a height they stand at. Arrows that strike are spent; the rest fly
  // on, or stick where they land.
  flyArrows(dt, world, player) {
    const before = new Map(this.arrows.list.map((p) => [p, { x: p.x, y: p.y, h: p.h }]));
    const shooters = new Map(this.arrows.list.map((p) => [p.id, p.shooter ?? null]));
    this.arrows.update(dt, world);
    const spent = new Set();
    if (player && player.alive !== false) {
      for (const [p, from] of before) {
        const [ax, az] = toMetres(from.x - player.x, from.y - player.y);
        const [bx, bz] = toMetres(p.x - player.x, p.y - player.y);
        const dx = bx - ax;
        const dz = bz - az;
        const length2 = dx * dx + dz * dz;
        const t = length2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / length2)) : 0;
        const near = Math.hypot(ax + dx * t, az + dz * t);
        const height = (from.h + (p.h - from.h) * t) / SCALE - (player.air ?? 0);
        if (near > 0.45 || height < -0.2 || height > 1.9) continue;
        spent.add(p);
        this.events.push({ type: 'hit-player', arrow: true, amount: p.damage, x: player.x, y: player.y,
          monster: p.shooter });
      }
    }
    if (spent.size) {
      this.arrows.list = this.arrows.list.filter((p) => !spent.has(p));
      this.arrows.landed = this.arrows.landed.filter((p) => !spent.has(p));
    }
    const spentIds = new Set([...spent].map((p) => p.id));
    for (const impact of this.arrows.events) {
      if (spentIds.has(impact.id)) continue;
      this.events.push({ type: 'arrow-land', x: impact.x, y: impact.y, strength: 0.2,
        monster: shooters.get(impact.id) ?? null });
    }
    this.arrows.events.length = 0;
  }

  // A sword cut from the player (a 'strike' event, see player.js) hits every
  // monster within the weapon's reach in front of them, or all round for a
  // spinning slash. Returns the monsters hit.
  strike(event, player, damage) {
    const reach = player.feel?.reach ?? 0.95;
    const all = event.swing === 'spin';
    const hit = [];
    for (const monster of this.list) {
      if (!monster.alive) continue;
      const [mx, mz] = toMetres(monster.x - player.x, monster.y - player.y);
      const distance = Math.hypot(mx, mz);
      if (distance > reach + monster.kind.radius) continue;
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
    this.arrows.list.length = 0;
    for (const id of Object.keys(this.spawnIn)) this.spawnIn[id] = this.every ?? KINDS[id].spawn.every;
  }
}

import { mulberry32 } from '../core/rng.js';
import { ASPECT, MAX_WATER_DEPTH, WATER } from '../world/world.js';
import { SCALE, TILT } from './rig.js';

// Skeletons: restless dead that climb out of the ground, run at the player
// and hack at them with a rusted sword. Several sword cuts break one apart,
// and it collapses where it stood. This is the behaviour only; the 3D bones
// that draw it live in skeleton-figure.js.

export const SKELETON = Object.freeze({
  health: 60,
  // Climbing out of the ground, in seconds.
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
  // How long the bones lie before sinking away, and how long that takes.
  linger: 24,
  sink: 2.5,
  // How close two of them may stand, in metres.
  personalSpace: 0.85,
});

// Offsets on screen to metres on the ground, and back. A metre across the
// screen spans SCALE / ASPECT cells; down the screen it is foreshortened by
// the camera's tilt.
export const toMetres = (dx, dy) => [dx * ASPECT / SCALE, dy / (SCALE * TILT)];
export const toCells = (mx, mz) => [mx * SCALE / ASPECT, mz * SCALE * TILT];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Whether a skeleton can stand at a point: clear of solid props, with room
// for its shoulders like the player. Like the player it wades through
// water, which never comes above the knee.
export function standable(world, x, y) {
  return world.isWalkable(x, y) && world.isWalkable(x - 1, y) && world.isWalkable(x + 1, y);
}

// Skeletons climb out of earth, not lake beds.
export function dryLand(world, x, y) {
  return world.typeAt(x, y) !== WATER && standable(world, x, y);
}

let nextId = 1;

export class Skeleton {
  constructor(x, y, { heading = 0, risen = false } = {}) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.health = SKELETON.health;
    this.maxHealth = SKELETON.health;
    // 'rise', 'idle', 'chase', 'attack', 'stagger' or 'dead'.
    this.state = risen ? 'idle' : 'rise';
    this.stateTime = 0;
    this.speed = 0;
    // The ground actually covered this frame, for the legs.
    this.groundSpeed = 0;
    this.cooldown = 0;
    this.struck = false;
    // Seconds since the last cut it took, for a flash of the bones.
    this.hurt = Infinity;
    this.deadTime = 0;
    // How far the bones have sunk into the ground, 0 to 1.
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

  // Metres from this skeleton to a point, and the bearing to it.
  offsetTo(x, y) {
    const [mx, mz] = toMetres(x - this.x, y - this.y);
    return { mx, mz, distance: Math.hypot(mx, mz), bearing: Math.atan2(mx, mz) };
  }

  turnTowards(bearing, rate, dt) {
    const d = wrap(bearing - this.heading);
    const step = rate * dt;
    this.heading = wrap(this.heading + Math.max(-step, Math.min(step, d)));
  }

  // One step of thought and movement. `target` is the player; `others` the
  // rest of the skeletons, so they spread around their prey.
  update(dt, world, target, others = []) {
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
      if (this.deadTime > SKELETON.linger) this.sunk = Math.min(1, (this.deadTime - SKELETON.linger) / SKELETON.sink);
      return;
    }
    const prey = target && target.alive !== false ? this.offsetTo(target.x, target.y) : null;
    let want = 0;
    switch (this.state) {
      case 'rise':
        if (prey) this.turnTowards(prey.bearing, 2, dt);
        if (this.stateTime >= SKELETON.rise) this.setState('idle');
        break;
      case 'idle':
        if (prey && prey.distance < SKELETON.notice) this.setState('chase');
        break;
      case 'chase': {
        if (!prey || prey.distance > SKELETON.forget) {
          this.setState('idle');
          break;
        }
        this.turnTowards(prey.bearing, 7, dt);
        if (prey.distance <= SKELETON.reach) {
          if (this.cooldown === 0 && (target.air ?? 0) < 0.5) {
            this.setState('attack');
            this.struck = false;
            this.events.push({ type: 'swing', move: 'a', speed: 0.8, strength: 0.8, x: this.x, y: this.y });
          }
          break;
        }
        // Slow to a walk when nearly within reach, so it does not overrun.
        const run = Math.min(SKELETON.maxRun, (target.runSpeed ?? 5) * SKELETON.runShare);
        want = prey.distance < SKELETON.reach + 1.2 ? SKELETON.walkSpeed * 1.5 : run;
        break;
      }
      case 'attack':
        // It tracks its prey while winding up, then commits to the blow.
        if (prey && this.stateTime < SKELETON.windUp * 0.7) this.turnTowards(prey.bearing, 5, dt);
        if (!this.struck && this.stateTime >= SKELETON.windUp) {
          this.struck = true;
          if (prey && this.canHit(prey, target)) {
            this.events.push({ type: 'hit-player', amount: SKELETON.damage, x: target.x, y: target.y });
          } else {
            this.events.push({ type: 'miss', x: this.x, y: this.y });
          }
        }
        // A little lunge into the cut.
        if (this.stateTime > SKELETON.windUp * 0.6 && this.stateTime < SKELETON.windUp * 1.1) want = 1.6;
        if (this.stateTime >= SKELETON.swingTime) {
          this.cooldown = SKELETON.cooldown;
          this.setState(prey ? 'chase' : 'idle');
        }
        break;
      case 'stagger':
        if (this.stateTime >= SKELETON.stagger) this.setState(prey ? 'chase' : 'idle');
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
      if (o.distance < SKELETON.personalSpace && o.distance > 1e-6) {
        const push = (SKELETON.personalSpace - o.distance) * 2 * dt;
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
    const length = 0.6 + 0.35 * Math.min(1, this.groundSpeed / 4);
    if (this.stride >= length) {
      this.stride -= length;
      this.events.push({ type: 'step', x: this.x, y: this.y, strength: Math.min(1, this.groundSpeed / 5) });
    }
  }

  // Whether its blow lands: the player is close, in front of it, and not
  // high in the air.
  canHit(prey, target) {
    return prey.distance <= SKELETON.hitRange
      && Math.abs(wrap(prey.bearing - this.heading)) <= SKELETON.hitArc
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
    if (!this.alive || this.state === 'rise' && this.stateTime < SKELETON.rise * 0.5) return false;
    this.health = Math.max(0, this.health - damage);
    this.hurt = 0;
    const away = this.offsetTo(fromX, fromY);
    this.events.push({ type: 'bone-hit', amount: damage, x: this.x, y: this.y, strength: Math.min(1, damage / 25) });
    if (this.health <= 0) {
      // Facing the blow as it falls.
      this.heading = away.bearing;
      this.speed = 0;
      this.setState('dead');
      this.deadTime = 0;
      this.events.push({ type: 'bone-collapse', x: this.x, y: this.y, strength: 1 });
      return true;
    }
    this.knock = { bearing: away.bearing + Math.PI, left: SKELETON.knockback };
    this.heading = away.bearing;
    this.speed = 0;
    this.setState('stagger');
    return true;
  }
}

// Every skeleton in the world: it raises new ones a short way from the player,
// turns the player's sword cuts into hits, and clears away the fallen.
export class Skeletons {
  constructor({ max = 3, seed = 1, firstAfter = 3, respawn = 9 } = {}) {
    this.list = [];
    this.max = max;
    this.random = mulberry32((seed * 7919) ^ 0x5eed);
    this.spawnIn = firstAfter;
    this.respawn = respawn;
    this.events = [];
    this.kills = 0;
  }

  get living() {
    return this.list.filter((s) => s.alive);
  }

  // Raises a skeleton somewhere on dry, open ground 14-26 m from the player,
  // facing them. Returns it, or null if no place was found.
  spawnNear(world, player, { near = 14, far = 26, risen = false } = {}) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const distance = near + this.random() * (far - near);
      const [dx, dy] = toCells(Math.sin(angle) * distance, Math.cos(angle) * distance);
      const x = player.x + dx;
      const y = player.y + dy;
      if (!dryLand(world, x, y)) continue;
      const skeleton = new Skeleton(x, y, { heading: angle + Math.PI, risen });
      this.list.push(skeleton);
      this.events.push({ type: 'bone-rise', x, y, strength: 0.7, skeleton });
      return skeleton;
    }
    return null;
  }

  update(dt, world, player) {
    if (this.living.length < this.max) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        this.spawnNear(world, player);
        this.spawnIn = this.respawn;
      }
    }
    const living = this.living;
    for (const skeleton of this.list) {
      if (skeleton.knock) {
        const step = Math.min(skeleton.knock.left, dt * 4);
        skeleton.knock.left -= step;
        skeleton.move(world, Math.sin(skeleton.knock.bearing) * step, Math.cos(skeleton.knock.bearing) * step);
        if (skeleton.knock.left <= 0) skeleton.knock = null;
      }
      skeleton.update(dt, world, player, living);
      for (const e of skeleton.events) this.events.push({ ...e, skeleton });
      skeleton.events.length = 0;
    }
    this.list = this.list.filter((s) => !s.gone);
  }

  // A sword cut from the player (a 'strike' event, see player.js) hits every
  // skeleton within the weapon's reach in front of them, or all round for a
  // spinning slash. Returns the skeletons hit.
  strike(event, player, damage) {
    const reach = (player.feel?.reach ?? 0.95) + 0.75;
    const all = event.swing === 'spin';
    const hit = [];
    for (const skeleton of this.list) {
      if (!skeleton.alive) continue;
      const [mx, mz] = toMetres(skeleton.x - player.x, skeleton.y - player.y);
      const distance = Math.hypot(mx, mz);
      if (distance > reach) continue;
      const off = Math.abs(wrap(Math.atan2(mx, mz) - player.heading));
      if (!all && distance > 0.5 && off > 1.25) continue;
      if (skeleton.takeHit(damage, player.x, player.y)) hit.push(skeleton);
    }
    for (const skeleton of hit) {
      if (!skeleton.alive) this.kills++;
      for (const e of skeleton.events) this.events.push({ ...e, skeleton });
      skeleton.events.length = 0;
    }
    return hit;
  }

  // Calls them all off, e.g. once the player has fallen.
  clear() {
    this.list.length = 0;
    this.spawnIn = this.respawn;
  }
}

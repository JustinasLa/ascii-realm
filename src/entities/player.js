import { ASPECT } from '../world/world.js';
import { Cape } from './cape.js';
import { Combat } from './combat.js';
import { buildRig, project, SCALE, strideCycle, TILT } from './rig.js';

// Ground speeds in metres per second. On screen a metre sideways spans
// SCALE row units, but a metre up or down the screen is foreshortened by
// the camera tilt, exactly as the figure's own feet are, so a planted foot
// stays planted whichever way the warrior walks.
const WALK_SPEED = 1.8;
const RUN_SPEED = 4.6;
const toCols = SCALE / ASPECT;
const toRows = SCALE * TILT;
const TURN_RATE = 12; // how quickly the heading swings round, per second
const JUMP_SPEED = 3.6; // metres per second straight up
const FALL = 14; // gravity, metres per second squared
const WIND_UP = 0.1; // seconds spent crouching before leaving the ground

// Shortest signed angle from a to b.
function angleTo(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    // Radians; 0 faces the camera, +pi/2 faces right.
    this.heading = 0;
    this.phase = 0;
    this.walk = 0;
    this.run = 0;
    this.time = 0;
    this.cape = new Cape();
    this.combat = new Combat();
    // Recent blade positions in world cells, for the swing trail.
    this.trail = [];
    // Height above the ground in metres, rising speed, and the crouch used
    // to wind up a jump and soak up the landing.
    this.air = 0;
    this.vy = 0;
    this.crouch = 0;
    this.reach = 0;
    this.windUp = -1;
    this.landed = 0;
    // Things that happened this frame for the world to react to, such as
    // footfalls and landings: { type, x, y, strength }.
    this.events = [];
    // 0 standing .. 1 down on one knee, resting after a long wait.
    this.kneel = 0;
    // Sideways tilt into turns, in radians.
    this.bank = 0;
    // Forward tilt from speeding up or slowing down, and the speed it is
    // measured against (metres per second).
    this.lean = 0;
    this.speed = 0;
    // Seconds spent standing still, and where the head is turned.
    this.idle = 0;
    this.look = 0;
    this.nod = 0;
    // 0 open .. 1 shut, and when the next blink is due.
    this.blink = 0;
    this.nextBlink = 3;
  }

  attack() {
    this.combat.attack();
  }

  toggleSword() {
    this.combat.toggle();
  }

  // Starts a jump if standing on the ground.
  jump() {
    if (this.air > 0 || this.windUp >= 0) return;
    this.windUp = 0;
  }

  // Wind-up crouch, flight under gravity and a squash on landing.
  updateJump(dt) {
    if (this.windUp >= 0) {
      this.windUp += dt;
      if (this.windUp >= WIND_UP) {
        this.windUp = -1;
        this.vy = JUMP_SPEED;
        this.air = 0.001;
      }
    }
    if (this.air > 0) {
      this.vy -= FALL * dt;
      this.air += this.vy * dt;
      if (this.air <= 0) {
        this.air = 0;
        this.landed = Math.min(1, -this.vy / JUMP_SPEED);
        this.events.push({ type: 'land', x: this.x, y: this.y, strength: this.landed });
      }
    }
    this.landed = Math.max(0, this.landed - dt * 4);
    // Tuck the legs on the way up, reach for the ground on the way down.
    const flying = this.air > 0 ? 0.35 * Math.max(0, this.vy / JUMP_SPEED) : 0;
    const crouchTo = this.windUp >= 0 ? 0.55 : flying + this.landed * 0.6;
    this.crouch += (crouchTo - this.crouch) * (1 - Math.exp(-30 * dt));
    const reachTo = this.windUp >= 0 ? -0.5 : this.air > 0 ? 0.7 : this.landed * 0.3;
    this.reach += (reachTo - this.reach) * (1 - Math.exp(-18 * dt));
  }

  update(dt, world, move, running) {
    this.time += dt;
    const fromX = this.x;
    const fromY = this.y;
    const len = Math.hypot(move.x, move.y);
    const moving = len > 0;
    const ease = (rate) => 1 - Math.exp(-rate * dt);

    if (moving) {
      // Speed up into a run gradually rather than in one jump.
      const speed = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * this.run;
      this.tryMove(world, (move.x / len) * speed * toCols * dt, 0);
      this.tryMove(world, 0, (move.y / len) * speed * toRows * dt);

      // Turn smoothly through the in-between headings rather than snapping.
      const target = Math.atan2(move.x, move.y);
      const turned = angleTo(this.heading, target) * ease(TURN_RATE);
      this.heading += turned;
      // Lean into the turn like a runner rounding a bend, harder at speed.
      const bankTo = Math.max(-0.35, Math.min(0.35, (-turned / dt) * 0.04 * (0.4 + this.run)));
      this.bank += (bankTo - this.bank) * ease(10);
    }

    // The legs are driven by the ground actually covered, so the stride
    // always matches the speed and stops when the way is blocked.
    const metres = Math.hypot(((this.x - fromX) * ASPECT) / SCALE, (this.y - fromY) / toRows);
    const going = moving && metres > 0.15 * dt;

    // Pitch forward when setting off or speeding up, and rock back on the
    // heels when pulling up, then settle.
    const speedNow = metres / Math.max(dt, 1e-3);
    const accel = (speedNow - this.speed) / Math.max(dt, 1e-3);
    this.speed += (speedNow - this.speed) * ease(8);
    const leanTo = Math.max(-0.22, Math.min(0.22, accel * 0.025));
    this.lean += (leanTo - this.lean) * ease(6);
    if (going) {
      const stride = Math.floor(this.phase / Math.PI);
      this.phase += (metres / strideCycle(this.run)) * Math.PI * 2;
      // A foot comes down every half cycle.
      if (this.air === 0 && Math.floor(this.phase / Math.PI) !== stride) {
        this.events.push({ type: 'step', x: this.x, y: this.y, strength: 0.3 + 0.7 * this.run });
      }
    }

    if (!moving) this.bank += -this.bank * ease(8);

    // Ease the stride in and out so starting and stopping is not abrupt.
    this.walk += ((going ? 1 : 0) - this.walk) * ease(10);
    this.run += ((moving && running ? 1 : 0) - this.run) * ease(5);
    // Settle into a neutral stance once stopped.
    if (!moving && this.walk < 0.02) this.phase = 0;

    this.updateJump(dt);

    // After standing a while the warrior glances around, scanning one side
    // then the other, with the occasional downward look.
    this.idle = moving || this.air > 0 ? 0 : this.idle + dt;
    // Left alone long enough with the sword away, the warrior kneels to
    // rest, and springs up again the moment there is something to do.
    const rest = this.idle > 12 && !this.combat.inHand && !this.combat.busy;
    this.kneel += ((rest ? 1 : 0) - this.kneel) * ease(rest ? 2.2 : 9);
    const glance = Math.min(1, Math.max(0, (this.idle - 3) / 1.5)) * (1 - this.kneel);
    const lookTo = glance * (Math.sin(this.idle * 0.55) * 0.75 + Math.sin(this.idle * 1.3) * 0.15);
    const nodTo = glance * Math.max(0, Math.sin(this.idle * 0.31 + 1)) * 0.25;
    this.look += (lookTo - this.look) * ease(4);
    this.nod += (nodTo - this.nod) * ease(3);

    // Breathe out a puff of vapour every few seconds, faster when running.
    this.nextBreath = (this.nextBreath ?? 2) - dt * (1 + this.run * 2.5);
    if (this.nextBreath < 0) {
      this.nextBreath = 3 + Math.random();
      this.events.push({ type: 'breath' });
    }

    // Blink every few seconds: shut quickly, open a little slower.
    this.nextBlink -= dt;
    if (this.nextBlink < 0) {
      const t = -this.nextBlink;
      this.blink = t < 0.06 ? t / 0.06 : Math.max(0, 1 - (t - 0.06) / 0.12);
      if (t > 0.18) this.nextBlink = 2.5 + Math.random() * 4;
    }

    this.combat.update(dt, moving);
    for (const e of this.combat.events) {
      // The overhead chop lands a stride ahead, in the direction faced.
      const reach = 0.95 * SCALE;
      this.events.push({
        type: 'slam',
        x: this.x + (Math.sin(this.heading) * reach) / ASPECT,
        y: this.y + Math.cos(this.heading) * reach * TILT,
        strength: 1,
      });
    }
    this.combat.events.length = 0;

    const rig = buildRig(this);
    this.recordTrail(rig);
    // Breath leaves through the visor, wherever the head happens to be.
    for (const e of this.events) {
      if (e.type !== 'breath') continue;
      const m = project(rig.headAt([0, -0.03, 0.17]));
      e.x = this.x + m[0] / ASPECT;
      e.y = this.y;
      e.h = -m[1];
      e.dx = Math.sin(this.heading);
      e.dy = Math.cos(this.heading);
    }

    const moved = [((this.x - fromX) * ASPECT) / SCALE, 0, (this.y - fromY) / toRows];
    const t = this.time;
    const wind = [2.2 + Math.sin(t * 0.7) * 1.6, 0, Math.sin(t * 0.43) * 1.2];
    this.cape.update(dt, ...this.capeMount(rig), moved, wind);
  }

  // Remembers where the blade is while it cuts, in world cells.
  recordTrail(rig) {
    const keep = this.time - 0.16;
    this.trail = this.trail.filter((p) => p.t > keep);
    if (!this.combat.trailing || !rig.sword) return;
    const h = project(rig.sword.guard);
    const tip = project(rig.sword.tip);
    this.trail.push({
      t: this.time,
      hx: this.x + h[0] / ASPECT,
      hy: this.y + h[1],
      tx: this.x + tip[0] / ASPECT,
      ty: this.y + tip[1],
    });
  }

  // Where the cape hangs from, and which way is out of the warrior's back.
  capeMount(rig = buildRig(this)) {
    return [rig.at([0, 0.47, -0.12]), [-Math.sin(this.heading), -Math.cos(this.heading)]];
  }

  // Lets the cape fall still, e.g. after the pose was changed by hand.
  settleCape() {
    this.cape.settle(...this.capeMount());
  }

  // Moves along one axis at a time so the player slides along shorelines.
  tryMove(world, dx, dy) {
    const nx = this.x + dx;
    const ny = this.y + dy;
    if (world.isWalkable(nx, ny) && world.isWalkable(nx - 1.2, ny) && world.isWalkable(nx + 1.2, ny)) {
      this.x = nx;
      this.y = ny;
    }
  }
}

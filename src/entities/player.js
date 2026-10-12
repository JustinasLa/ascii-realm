import { ASPECT } from '../world/world.js';
import { Cape } from './cape.js';
import { Combat } from './combat.js';
import { buildRig, project, SCALE } from './rig.js';

const WALK_SPEED = 8; // rows per second; columns are scaled by ASPECT
const RUN_SPEED = 15;
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
      const speed = running ? RUN_SPEED : WALK_SPEED;
      // Columns are narrower than rows, so horizontal motion needs more of
      // them per second to look like the same on-screen speed.
      const vx = (move.x / len) * speed / ASPECT;
      const vy = (move.y / len) * speed;
      this.tryMove(world, vx * dt, 0);
      this.tryMove(world, 0, vy * dt);

      // Turn smoothly through the in-between headings rather than snapping.
      const target = Math.atan2(move.x, move.y);
      this.heading += angleTo(this.heading, target) * ease(TURN_RATE);
      const stride = Math.floor(this.phase / Math.PI);
      this.phase += dt * (8 + 5 * this.run);
      // A foot comes down every half cycle.
      if (this.air === 0 && Math.floor(this.phase / Math.PI) !== stride) {
        this.events.push({ type: 'step', x: this.x, y: this.y, strength: 0.3 + 0.7 * this.run });
      }
    }

    // Ease the stride in and out so starting and stopping is not abrupt.
    this.walk += ((moving ? 1 : 0) - this.walk) * ease(10);
    this.run += ((moving && running ? 1 : 0) - this.run) * ease(6);
    // Settle into a neutral stance once stopped.
    if (!moving && this.walk < 0.02) this.phase = 0;

    this.updateJump(dt);

    // After standing a while the warrior glances around, scanning one side
    // then the other, with the occasional downward look.
    this.idle = moving || this.air > 0 ? 0 : this.idle + dt;
    const glance = Math.min(1, Math.max(0, (this.idle - 3) / 1.5));
    const lookTo = glance * (Math.sin(this.idle * 0.55) * 0.75 + Math.sin(this.idle * 1.3) * 0.15);
    const nodTo = glance * Math.max(0, Math.sin(this.idle * 0.31 + 1)) * 0.25;
    this.look += (lookTo - this.look) * ease(4);
    this.nod += (nodTo - this.nod) * ease(3);

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
        y: this.y + Math.cos(this.heading) * reach * 0.35,
        strength: 1,
      });
    }
    this.combat.events.length = 0;

    const rig = buildRig(this);
    this.recordTrail(rig);

    const moved = [((this.x - fromX) * ASPECT) / SCALE, 0, (this.y - fromY) / SCALE];
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

import { ASPECT } from '../world/world.js';
import { Cape } from './cape.js';
import { buildRig, SCALE } from './rig.js';

const WALK_SPEED = 8; // rows per second; columns are scaled by ASPECT
const RUN_SPEED = 15;
const TURN_RATE = 12; // how quickly the heading swings round, per second

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
      this.phase += dt * (8 + 5 * this.run);
    }

    // Ease the stride in and out so starting and stopping is not abrupt.
    this.walk += ((moving ? 1 : 0) - this.walk) * ease(10);
    this.run += ((moving && running ? 1 : 0) - this.run) * ease(6);
    // Settle into a neutral stance once stopped.
    if (!moving && this.walk < 0.02) this.phase = 0;

    const moved = [((this.x - fromX) * ASPECT) / SCALE, 0, (this.y - fromY) / SCALE];
    const t = this.time;
    const wind = [2.2 + Math.sin(t * 0.7) * 1.6, 0, Math.sin(t * 0.43) * 1.2];
    this.cape.update(dt, ...this.capeMount(), moved, wind);
  }

  // Where the cape hangs from, and which way is out of the warrior's back.
  capeMount() {
    const rig = buildRig(this);
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

import { ASPECT } from '../world/world.js';

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
  }

  update(dt, world, move, running) {
    this.time += dt;
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

import { ASPECT } from '../world/world.js';

const WALK_SPEED = 8; // rows per second; columns are scaled by ASPECT
const RUN_SPEED = 15;

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.facing = 'down';
    this.phase = 0;
    this.amp = 0;
    this.bob = 0;
    this.time = 0;
  }

  update(dt, world, move, running) {
    this.time += dt;
    const len = Math.hypot(move.x, move.y);
    const moving = len > 0;

    if (moving) {
      const speed = running ? RUN_SPEED : WALK_SPEED;
      // Columns are narrower than rows, so horizontal motion needs more of
      // them per second to look like the same on-screen speed.
      const vx = (move.x / len) * speed / ASPECT;
      const vy = (move.y / len) * speed;
      this.tryMove(world, vx * dt, 0);
      this.tryMove(world, 0, vy * dt);

      if (move.x !== 0) this.facing = move.x > 0 ? 'right' : 'left';
      else this.facing = move.y > 0 ? 'down' : 'up';
      this.phase += dt * (running ? 13 : 9);
    }

    // Ease the stride in and out so starting and stopping is not abrupt.
    this.amp += ((moving ? 1 : 0) - this.amp) * (1 - Math.exp(-12 * dt));
    if (!moving && this.amp < 0.02) this.phase = 0;

    const step = Math.abs(Math.sin(this.phase)) * 0.35 * this.amp;
    const breathe = (Math.sin(this.time * 2.2) * 0.5 + 0.5) * 0.12 * (1 - this.amp);
    this.bob = step + breathe;
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

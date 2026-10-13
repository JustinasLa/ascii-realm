import { ASPECT } from '../world/world.js';
import { Cape } from './cape.js';
import { Combat } from './combat.js';
import { buildRig, gaitPlan, project, rotY, SCALE, strideCycle, TILT } from './rig.js';

// Ground speeds in metres per second. On screen a metre sideways spans
// SCALE row units, but a metre up or down the screen is foreshortened by
// the camera tilt, exactly as the figure's own feet are, so a planted foot
// stays planted whichever way the warrior walks.
const WALK_SPEED = 1.35;
const RUN_SPEED = 5.3;
const toCols = SCALE / ASPECT;
const toRows = SCALE * TILT;
const TURN_RATE = 12; // how quickly the heading swings round, per second
// How quickly the warrior gets up to speed or changes direction (per
// second). Lower at a sprint, so they carve round in arcs.
const GRIP = 11;
const SPRINT_GRIP = 5;
const JUMP_SPEED = 3.6; // metres per second straight up
const FALL = 14; // gravity, metres per second squared
const WIND_UP = 0.1; // seconds spent crouching before leaving the ground

// Moves `x` (with velocity `v`) towards `target` like a critically damped
// spring with natural frequency `w`, exactly for any time step.
function spring(x, v, target, w, dt) {
  const d = x - target;
  const e = Math.exp(-w * dt);
  const nx = (d + (v + w * d) * dt) * e;
  const nv = (v - w * (v + w * d) * dt) * e;
  return [target + nx, nv];
}

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
    this.walkV = 0;
    this.runV = 0;
    this.time = 0;
    this.cape = new Cape();
    // Ground speeds in metres per second; a 3D character sets these to suit
    // its animation clips.
    this.walkSpeed = WALK_SPEED;
    this.runSpeed = RUN_SPEED;
    this.combat = new Combat();
    // A lit torch occupies the free hand; T stows it or draws a fresh one.
    this.torch = true;
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
    // Extra speed along the heading from a lunge, in metres per second.
    this.surge = 0;
    // Pulling up hard from a sprint: seconds of skid left, the speed and
    // direction carried into it, and how far the body braces against it.
    this.skid = 0;
    this.skidSpeed = 0;
    this.skidHeading = 0;
    this.brace = 0;
    this.wasMoving = false;
    // Ground velocity in metres per second (x across the screen, z down it).
    this.vx = 0;
    this.vz = 0;
    // Where each foot is pinned in the world, in metres: the footprint of a
    // planted foot, or where a lifted one left the ground. Handed to the rig
    // as `locks` in the body's frame.
    this.anchors = [null, null];
    this.liftAnchors = [null, null];
    this.locks = [null, null];
    // The spring-smoothed height of the body above the planted foot, and
    // how fast it is moving.
    this.bob = undefined;
    this.bobV = 0;
  }

  // The attack depends on what the warrior is doing at the time.
  attack() {
    this.combat.attack({ running: this.run > 0.6 && this.speed > 3, air: this.air > 0 });
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
        this.events.push({ type: 'jump', x: this.x, y: this.y, strength: 1 });
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

  // `held`: whether the attack button is still down, to charge a spin.
  update(dt, world, move, running, held = false) {
    this.time += dt;
    const fromX = this.x;
    const fromY = this.y;
    const len = Math.hypot(move.x, move.y);
    const moving = len > 0;
    const ease = (rate) => 1 - Math.exp(-rate * dt);

    // Letting go mid-sprint does not stop the warrior dead: they skid to a
    // halt, braced, throwing up dirt.
    if (!moving && this.wasMoving && this.speed > 3.2 && this.air === 0) {
      this.skid = 0.42;
      this.skidSpeed = this.speed;
      this.skidHeading = this.heading;
    }
    this.wasMoving = moving;
    if (moving) this.skid = 0;
    if (this.skid > 0) {
      this.skid -= dt;
      this.skidSpeed *= Math.exp(-7 * dt);
      const v = this.skidSpeed * dt;
      this.tryMove(world, Math.sin(this.skidHeading) * v * toCols, 0);
      this.tryMove(world, 0, Math.cos(this.skidHeading) * v * toRows);
      if (Math.random() < dt * 30) {
        this.events.push({ type: 'skid', x: this.x, y: this.y, strength: this.skidSpeed / this.runSpeed });
      }
    }
    this.brace += ((this.skid > 0 ? 1 : 0) - this.brace) * ease(this.skid > 0 ? 18 : 6);

    // The warrior has momentum: velocity eases towards where the keys point
    // rather than jumping there, so changes of direction sweep round.
    const speed = this.walkSpeed + (this.runSpeed - this.walkSpeed) * this.run;
    const tx = moving && this.skid <= 0 ? (move.x / len) * speed : 0;
    const tz = moving && this.skid <= 0 ? (move.y / len) * speed : 0;
    const grip = ease(moving ? GRIP + (SPRINT_GRIP - GRIP) * this.run : 16);
    this.vx += (tx - this.vx) * grip;
    this.vz += (tz - this.vz) * grip;
    if (this.skid <= 0) {
      this.tryMove(world, this.vx * toCols * dt, 0);
      this.tryMove(world, 0, this.vz * toRows * dt);
    } else {
      this.vx = 0;
      this.vz = 0;
    }

    if (moving) {
      // Turn smoothly through the in-between headings rather than snapping,
      // following the way the body is actually travelling.
      const target = Math.hypot(this.vx, this.vz) > 0.3 ? Math.atan2(this.vx, this.vz) : Math.atan2(move.x, move.y);
      const turned = angleTo(this.heading, target) * ease(TURN_RATE - 4 * this.run);
      this.heading += turned;
      // Lean into the turn like a runner rounding a bend, harder at speed.
      const bankTo = Math.max(-0.35, Math.min(0.35, (-turned / dt) * 0.04 * (0.4 + this.run)));
      this.bank += (bankTo - this.bank) * ease(10);
    }

    // The legs are driven by the ground actually covered, so the stride
    // always matches the speed and stops when the way is blocked.
    const metres = Math.hypot(((this.x - fromX) * ASPECT) / SCALE, (this.y - fromY) / toRows);
    const going = moving && metres > 0.15 * dt;

    // A lunge carries the warrior on along their heading, fading fast.
    if (this.surge > 0.05) {
      const v = this.surge * dt;
      this.tryMove(world, Math.sin(this.heading) * v * toCols, 0);
      this.tryMove(world, 0, Math.cos(this.heading) * v * toRows);
      this.surge *= Math.exp(-6 * dt);
    }

    // Pitch forward a little when setting off or speeding up. Slowing down
    // does not rock the body back: it just settles upright.
    const speedNow = this.skid > 0 ? this.speed : metres / Math.max(dt, 1e-3);
    const accel = (speedNow - this.speed) / Math.max(dt, 1e-3);
    this.speed += (speedNow - this.speed) * ease(8);
    const leanTo = Math.max(0, Math.min(0.15, accel * 0.02));
    this.lean += (leanTo - this.lean) * ease(6);
    if (going) {
      const stride = Math.floor((this.phase - Math.PI / 2) / Math.PI);
      this.phase += (metres / strideCycle(this.run)) * Math.PI * 2;
      // Match each foot's heel strike in the gait, including every strike
      // crossed by a long frame. The model supplies its own footfalls.
      if (!this.modelTrail && this.air === 0 && this.windUp < 0 && !this.combat.busy && !this.combat.charge) {
        const last = Math.floor((this.phase - Math.PI / 2) / Math.PI);
        for (let k = stride + 1; k <= last; k++) {
          const j = k % 2 === 0 ? 1 : 0;
          // Reduce to one cycle so floating-point drift cannot sample the
          // instant before touchdown once the phase grows large.
          const touchdown = Math.PI / 2 + (j === 0 ? Math.PI : 0);
          const foot = gaitPlan(touchdown, this.run)[j].print;
          const at = rotY([foot[0], 0, foot[1]], this.heading);
          this.events.push({
            type: 'step',
            x: this.x + at[0] * toCols,
            y: this.y + at[2] * toRows,
            strength: 0.3 + 0.7 * this.run,
          });
        }
      }
    }

    if (!moving) this.bank += -this.bank * ease(8);

    // Ease the stride in and out so starting and stopping is not abrupt.
    // Critically damped springs: they ease in as well as out, so neither
    // setting off nor pulling up jolts the limbs in the first frame.
    [this.walk, this.walkV] = spring(this.walk, this.walkV, going ? 1 : 0, 11, dt);
    [this.run, this.runV] = spring(this.run, this.runV, moving && running ? 1 : 0, 6, dt);
    this.walk = Math.max(0, Math.min(1, this.walk));
    this.run = Math.max(0, Math.min(1, this.run));
    // The walk cycle is not reset on stopping: its effect fades out with
    // `walk`, and picking up where it left off keeps the feet pinned.

    this.updateJump(dt);

    // After standing a while the warrior glances around, scanning one side
    // then the other, with the occasional downward look.
    this.idle = moving || this.air > 0 || held ? 0 : this.idle + dt;
    // Left alone long enough with the sword away, the warrior kneels to
    // rest, and springs up again the moment there is something to do.
    const rest = this.idle > 12 && !this.torch && !this.combat.inHand && !this.combat.busy;
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

    // A plunge drives the warrior down out of the air.
    const cb = this.combat;
    if (cb.move === 'plunge' && cb.step >= 1 && this.air > 0) this.vy -= 30 * dt;

    cb.update(dt, { moving, running: moving && this.run > 0.5, air: this.air > 0, held });
    for (const e of cb.events) {
      if (e.type === 'slam') {
        // The blade lands a stride ahead, in the direction faced.
        const reach = 0.95 * SCALE;
        this.events.push({
          type: 'slam',
          x: this.x + (Math.sin(this.heading) * reach) / ASPECT,
          y: this.y + Math.cos(this.heading) * reach * TILT,
          strength: e.strength,
        });
      } else if (e.type === 'lunge') {
        this.surge = e.speed;
        this.events.push({ type: 'land', x: this.x, y: this.y, strength: 0.6 });
      } else if (e.type === 'whirl') {
        this.events.push({ type: 'whirl', x: this.x, y: this.y, strength: 1 });
      } else {
        this.events.push({ ...e, x: this.x, y: this.y, strength: e.strength ?? 1 });
      }
    }
    cb.events.length = 0;

    this.pinFeet();

    // Spring the body's bob towards where the legs put it: stiff enough to
    // follow every stride, soft enough to round off its corners.
    const want = buildRig({ ...this, bob: undefined, air: 0 }).gait;
    if (this.bob === undefined) this.bob = want;
    const sdt = Math.min(dt, 1 / 30);
    this.bobV += ((want - this.bob) * 260 - this.bobV * 20) * sdt;
    this.bob += this.bobV * sdt;

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
    // At speed the cloth flaps and billows in the rush of air.
    const rush = this.speed * (Math.sin(t * 13) * 0.35 + Math.sin(t * 7.3 + 1) * 0.25);
    const wind = [2.2 + Math.sin(t * 0.7) * 1.6 + Math.cos(this.heading) * rush, 0,
      Math.sin(t * 0.43) * 1.2 - Math.sin(this.heading) * rush];
    this.cape.update(dt, ...this.capeMount(rig), moved, wind);
  }

  // Keeps planted feet where they landed. A foot touching down is pinned
  // to the ground at its footprint; while it stays down the rig is told
  // where that is relative to the body, however the body has moved or
  // turned since. When it lifts, its swing starts from that same spot.
  pinFeet() {
    const heading = this.heading + this.combat.spin;
    const here = [(this.x * ASPECT) / SCALE, 0, this.y / toRows];
    const toWorld = (b) => {
      const w = rotY([b[0], 0, b[1]], heading);
      return [here[0] + w[0], here[2] + w[2]];
    };
    const toBody = (w) => {
      const b = rotY([w[0] - here[0], 0, w[1] - here[2]], -heading);
      return [b[0], b[2]];
    };
    if (this.walk <= 0.001) {
      this.anchors = [null, null];
      this.liftAnchors = [null, null];
      this.locks = [null, null];
      return;
    }
    gaitPlan(this.phase, this.run).forEach((g, j) => {
      if (g.grounded) {
        this.anchors[j] ??= toWorld(g.print);
        this.liftAnchors[j] = null;
        this.locks[j] = { print: toBody(this.anchors[j]) };
      } else {
        if (this.anchors[j]) this.liftAnchors[j] = this.anchors[j];
        this.anchors[j] = null;
        this.locks[j] = this.liftAnchors[j] ? { lift: toBody(this.liftAnchors[j]) } : null;
      }
    });
  }

  // Remembers where the blade is while it cuts, in world cells.
  recordTrail(rig) {
    const keep = this.time - 0.16;
    this.trail = this.trail.filter((p) => p.t > keep);
    // A 3D character records its own trail (see main.js).
    if (this.modelTrail || !this.combat.trailing || !rig.sword) return;
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

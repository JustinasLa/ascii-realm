import { ASPECT } from '../world/world.js';
import { solveBallisticShot } from '../core/ballistics.js';
import { Cape } from './cape.js';
import { Combat } from './combat.js';
import { buildRig, project, SCALE, strideCycle, TILT } from './rig.js';
import { MATERIAL_IDS, WEAPON_IDS } from './weapons.js';

// Ground speeds in metres per second. On screen a metre sideways spans
// SCALE row units, but a metre up or down the screen is foreshortened by
// the camera tilt, exactly as the figure's own feet are, so a planted foot
// stays planted whichever way the warrior walks.
const WALK_SPEED = 1.25;
const RUN_SPEED = 2.9;
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
  constructor(x, y, weaponId = 'greatsword', material = 'steel') {
    this.x = x;
    this.y = y;
    // Radians; 0 faces the camera, +pi/2 faces right.
    this.heading = 0;
    this.phase = 0;
    this.walk = 0;
    this.run = 0;
    this.time = 0;
    this.cape = new Cape();
    this.combat = new Combat(weaponId, material);
    this.moving = false;
    this.running = false;
    this.aimTarget = null;
    // A spinning attack turns the figure without changing the direction
    // used for movement and aiming after the attack.
    this.combatSpin = 0;
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

  combatContext(ctx = {}) {
    return { moving: this.moving, running: this.running, air: this.air, aimTarget: this.aimTarget, ...ctx };
  }

  setAimTarget(target) {
    this.aimTarget = target && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? { x: target.x, y: target.y } : null;
    this.combat.context = { ...this.combat.context, aimTarget: this.aimTarget && { ...this.aimTarget } };
    return this.aimTarget !== null;
  }

  // Live draw follows the cursor; a released shot keeps its own target
  // while it finishes, even if another pointer update arrives meanwhile.
  bowAimState() {
    const cb = this.combat;
    if (cb.weaponId !== 'bow') return null;
    // A queued draw can begin in the same frame the prior arrow launches.
    if (cb.bowShot) return cb.bowShot;
    const moveset = cb.moveset;
    const packet = (move) => moveset.moves[move]?.steps?.find((s) => s.event?.projectile?.kind === 'arrow')?.event.projectile;
    const active = packet(cb.move);
    const queued = !cb.charging && !active && packet(cb.queued);
    const shotContext = active ? cb.actionContext : queued ? cb.queuedContext : null;
    const spec = active || queued || packet(moveset.charged);
    const charge = active ? cb.actionCharge : cb.charging ? cb.charge : queued ? shotContext.charge ?? 0 : 0;
    return {
      target: shotContext ? shotContext.aimTarget : this.aimTarget,
      speed: (spec?.speed ?? 18) * (1 + 0.7 * charge),
      gravity: spec?.gravity ?? 5,
    };
  }

  getBowAimTarget() {
    const target = this.bowAimState()?.target;
    return target ? { ...target } : null;
  }

  // The rig supplies a yaw-rotated point in metres relative to the feet.
  // Return a direction in the same 3D axes; flight uses the same solver.
  bowAimDirection(origin) {
    const aim = this.bowAimState();
    if (!aim?.target || !Array.isArray(origin) || origin.length < 3 || !origin.every(Number.isFinite)) return null;
    return solveBallisticShot(
      [this.x / toCols + origin[0], origin[1], this.y / toRows + origin[2]],
      [aim.target.x / toCols, 0, aim.target.y / toRows], aim.speed, aim.gravity,
    )?.direction ?? null;
  }

  aimBowHeading() {
    if (this.combat.weaponId !== 'bow' || (!this.combat.inHand && !this.combat.charging)) return false;
    const target = this.getBowAimTarget();
    if (!target) return false;
    const x = (target.x - this.x) / toCols;
    const z = (target.y - this.y) / toRows;
    if (Math.hypot(x, z) > 1e-6) this.heading = Math.atan2(x, z);
    return true;
  }

  attack(ctx = {}) {
    if (ctx && Object.hasOwn(ctx, 'aimTarget')) this.setAimTarget(ctx.aimTarget);
    return this.combat.attack(this.combatContext(ctx));
  }

  release(ctx = {}) {
    if (ctx && Object.hasOwn(ctx, 'aimTarget')) this.setAimTarget(ctx.aimTarget);
    return this.combat.release(this.combatContext(ctx));
  }

  block(on = true) {
    return this.combat.block(on);
  }

  // Losing focus ends a held charge without turning it into a shot.
  cancelAction() {
    this.setAimTarget(null);
    if (this.combat.cancelAction) return this.combat.cancelAction();
    return this.combat.cancel();
  }

  equipWeapon(id, material = this.combat.material) {
    if (!this.combat.equip(id, material)) return false;
    this.trail.length = 0;
    this.combatSpin = 0;
    return true;
  }

  cycleWeapon(delta = 1) {
    const current = Math.max(0, WEAPON_IDS.indexOf(this.combat.weaponId));
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 1;
    const next = ((current + step) % WEAPON_IDS.length + WEAPON_IDS.length) % WEAPON_IDS.length;
    return this.equipWeapon(WEAPON_IDS[next]);
  }

  cycleMaterial(delta = 1) {
    const current = Math.max(0, MATERIAL_IDS.indexOf(this.combat.material));
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 1;
    const next = ((current + step) % MATERIAL_IDS.length + MATERIAL_IDS.length) % MATERIAL_IDS.length;
    return this.equipWeapon(this.combat.weaponId, MATERIAL_IDS[next]);
  }

  toggleSword() {
    return this.combat.toggle();
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

  update(dt, world, move, running, input = {}) {
    if (Object.hasOwn(input, 'aimTarget')) this.setAimTarget(input.aimTarget);
    if (input.cancelled) {
      this.cancelAction();
      input = { ...input, held: false, blocking: false, aimTarget: null };
    }
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
    const fromX = this.x;
    const fromY = this.y;
    const len = Math.hypot(move.x, move.y);
    const moving = len > 0;
    this.moving = moving;
    this.running = !!running;
    const ease = (rate) => 1 - Math.exp(-rate * dt);

    if (moving) {
      // Speed up into a run gradually rather than in one jump.
      const speed = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * this.run;
      this.tryMove(world, (move.x / len) * speed * toCols * dt, 0);
      this.tryMove(world, 0, (move.y / len) * speed * toRows * dt);
    }

    let bowAiming = this.aimBowHeading();
    if (moving && !bowAiming) {
      // Turn smoothly through the in-between headings rather than snapping.
      const target = Math.atan2(move.x, move.y);
      const turned = angleTo(this.heading, target) * ease(TURN_RATE);
      this.heading += turned;
      // Lean into the turn like a runner rounding a bend, harder at speed.
      const bankTo = Math.max(-0.35, Math.min(0.35, (-turned / dt) * 0.04 * (0.4 + this.run)));
      this.bank += (bankTo - this.bank) * ease(10);
    }

    this.updateJump(dt);
    this.combat.update(dt, this.combatContext(input));
    const motion = this.combat.motion ?? {};
    const forward = motion.forward ?? 0;
    if (Number.isFinite(forward) && forward !== 0) {
      this.tryMove(world, Math.sin(this.heading) * forward * toCols * dt, 0);
      this.tryMove(world, 0, Math.cos(this.heading) * forward * toRows * dt);
    }
    bowAiming = this.aimBowHeading() || bowAiming;
    const turn = motion.turn ?? 0;
    if (Number.isFinite(turn) && turn !== 0) {
      this.combatSpin = angleTo(0, this.combatSpin + turn * dt);
    } else {
      this.combatSpin *= Math.exp(-16 * dt);
      if (Math.abs(this.combatSpin) < 0.001) this.combatSpin = 0;
    }
    const travelling = moving || (Number.isFinite(forward) && forward !== 0);

    // The legs are driven by the ground actually covered, so the stride
    // always matches the speed and stops when the way is blocked.
    const metres = Math.hypot(((this.x - fromX) * ASPECT) / SCALE, (this.y - fromY) / toRows);
    const going = travelling && metres > 0.15 * dt;

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

    if (!moving || bowAiming) this.bank += -this.bank * ease(8);

    // Ease the stride in and out so starting and stopping is not abrupt.
    this.walk += ((going ? 1 : 0) - this.walk) * ease(10);
    this.run += ((moving && running ? 1 : 0) - this.run) * ease(5);
    // Settle into a neutral stance once stopped.
    if (!travelling && this.walk < 0.02) this.phase = 0;

    // After standing a while the warrior glances around, scanning one side
    // then the other, with the occasional downward look.
    this.idle = travelling || this.air > 0 || this.combat.busy || this.combat.blocking ? 0 : this.idle + dt;
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

    const rig = buildRig(this);
    for (const e of this.combat.events) {
      // Combat works in metres; the world consumes columns and rows. Keep
      // each action's type and metadata so a tree chop or projectile can
      // receive its own world response.
      const heading = this.heading + this.combatSpin;
      const dx = Math.sin(heading) * toCols;
      const dy = Math.cos(heading) * toRows;
      const reach = e.reach ?? this.combat.weapon.reach;
      const projectile = !!e.projectile || e.type === 'projectile';
      const impact = ['hit', 'slash', 'thrust', 'chop', 'slam', 'bash', 'backstab'].includes(e.type);
      const distance = projectile ? Math.min(reach, 0.45) : impact ? reach : 0;
      // Launch at the posed arrowhead, thrown spear tip or staff crystal.
      // Separate ground depth from height so flight starts on the rendered
      // weapon at every heading, including while jumping.
      const launchAt = projectile && rig.weapon
        ? e.projectile?.kind === 'arrow' ? rig.weapon.arrow?.tip ?? rig.weapon.grip : rig.weapon.tip
        : null;
      const launchHeight = e.projectile?.launchHeight;
      const x = this.x + (launchAt ? launchAt[0] * toCols : dx * distance);
      const y = this.y + (launchAt ? launchAt[2] * toRows : dy * distance);
      const h = launchHeight !== undefined ? (this.air + launchHeight) * SCALE
        : launchAt ? launchAt[1] * SCALE : (this.air + 0.75) * SCALE;
      const aimedShot = e.projectile?.kind === 'arrow' && e.aimTarget ? solveBallisticShot(
        [x / toCols, h / SCALE, y / toRows],
        [e.aimTarget.x / toCols, 0, e.aimTarget.y / toRows], e.projectile.speed, e.projectile.gravity,
      ) : null;
      const shotDx = aimedShot ? aimedShot.direction[0] * toCols : dx;
      const shotDy = aimedShot ? aimedShot.direction[2] * toRows : dy;
      this.events.push({
        ...e,
        originX: this.x,
        originY: this.y,
        x, y,
        dx: shotDx,
        dy: shotDy,
        dirX: shotDx,
        dirY: shotDy,
        heading: aimedShot ? Math.atan2(shotDx / toCols, shotDy / toRows) : heading,
        ...(projectile ? { h } : {}),
        ...(aimedShot ? { projectile: { ...e.projectile, velocity: [...aimedShot.velocity] } } : {}),
      });
    }
    this.combat.events.length = 0;

    this.recordTrail(rig);
    // Breath leaves through the visor, wherever the head happens to be.
    for (const e of this.events) {
      if (e.type !== 'breath') continue;
      const m = project(rig.headAt([0, -0.03, 0.17]));
      e.x = this.x + m[0] / ASPECT;
      e.y = this.y;
      e.h = -m[1];
      e.dx = Math.sin(rig.heading);
      e.dy = Math.cos(rig.heading);
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
      color: this.combat.weapon.trailColor,
      weapon: this.combat.weaponId,
      material: this.combat.material,
      kind: this.combat.weapon.trailKind ?? this.combat.weaponId,
    });
  }

  // Where the cape hangs from, and which way is out of the warrior's back.
  capeMount(rig = buildRig(this)) {
    return [rig.at([0, 0.47, -0.12]), [-Math.sin(rig.heading), -Math.cos(rig.heading)]];
  }

  // Lets the cape fall still, e.g. after the pose was changed by hand.
  settleCape() {
    this.cape.settle(...this.capeMount());
  }

  // Moves along one axis at a time so the player slides along shorelines.
  tryMove(world, dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    // Test the whole path, including a fast sprint lunge, so a long frame
    // cannot carry the warrior across an unwalkable strip of shoreline.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.5));
    for (let i = 0; i < steps; i++) {
      const nx = this.x + dx / steps;
      const ny = this.y + dy / steps;
      if (!world.isWalkable(nx, ny) || !world.isWalkable(nx - 1.2, ny) || !world.isWalkable(nx + 1.2, ny)) break;
      this.x = nx;
      this.y = ny;
    }
  }
}

import { getWeapon, MATERIAL_IDS, WEAPON_IDS } from './weapons.js';
import { getWeaponMoves } from './weapon-moves.js';

// The weapon hand is on the body's -x side. Poses are mirrored by the rig.
export const SWORD_SIDE = -1;

const SHEATHE_AFTER = 5;
const CHARGE_THRESHOLD = 0.2;
const PARRY_WINDOW = 0.18;
const STAMINA_REGEN = 22;
const REGEN_DELAY = 0.45;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const CURSOR_PROJECTILES = new Set(['arrow', 'spear', 'javelin']);

function copyAimTarget(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: value.x, y: value.y } : null;
}

function context(value, previous = {}) {
  const merged = typeof value === 'boolean'
    ? { ...previous, moving: value } : { ...previous, ...(value ?? {}) };
  if (Object.hasOwn(merged, 'aimTarget')) merged.aimTarget = copyAimTarget(merged.aimTarget);
  if (value && Object.hasOwn(value, 'grounded')) {
    merged.airborne = !value.grounded;
    if (value.grounded) merged.air = 0;
  } else if (value && Object.hasOwn(value, 'air')) {
    delete merged.grounded;
    merged.airborne = (value.air ?? 0) > 0;
  } else if (value && Object.hasOwn(value, 'airborne')) {
    delete merged.grounded;
    if (!value.airborne) merged.air = 0;
  }
  return merged;
}

function airborne(ctx) {
  if (typeof ctx.grounded === 'boolean') return !ctx.grounded;
  return !!ctx.airborne || (ctx.air ?? 0) > 0;
}

export class Combat {
  constructor(weapon = 'greatsword', material = 'steel') {
    if (weapon && typeof weapon === 'object') {
      material = weapon.material ?? material;
      weapon = weapon.id ?? weapon.weapon ?? 'greatsword';
    }
    this.weapon = getWeapon(weapon, material);
    this.maxStamina = 100;
    this.stamina = this.maxStamina;
    this.events = [];
    this.context = {};
    this.reset();
  }

  get weaponId() { return this.weapon.id; }
  get material() { return this.weapon.material; }
  get moveset() { return getWeaponMoves(this.weapon); }
  get busy() { return this.move !== null || this.blocking; }
  get charging() { return this.holding; }
  get parrying() { return this.blocking && this.parryRemaining > 0; }
  get moveName() { return this.move ? this.moveset.moves[this.move]?.name ?? this.move : null; }

  keyPose(key) {
    const pose = this.moveset.keys[key];
    const sheath = this.weapon.sheath;
    return key === 'hilt' && sheath
      ? { ...pose, hand: sheath.hand, blade: sheath.blade } : pose;
  }

  reset() {
    this.inHand = false;
    this.move = null;
    this.step = 0;
    this.t = 0;
    this.queued = null;
    this.queuedContext = null;
    this.lastSwing = '';
    this.calm = 0;
    this.trailing = false;
    this.active = 0;
    this.holding = false;
    this.holdTime = 0;
    this.charge = 0;
    this.bowDraw = null;
    this.bowShot = null;
    this.projectileShot = null;
    this.holdFallback = null;
    this.blocking = false;
    this.guardExhausted = false;
    this.parryRemaining = 0;
    this.regenDelay = 0;
    this.actionStamina = 0;
    this.actionCharge = 0;
    this.actionContext = {};
    this.motion = { forward: 0, turn: 0 };
    const rest = this.moveset.keys.rest;
    this.pose = { hand: [...rest.hand], blade: [...rest.blade], twist: 0, lean: 0, crouch: 0, off: 0, shield: 0 };
    this.events.length = 0;
  }

  // Switching mid-action would leave a hand holding the previous weapon's
  // pose. Selection succeeds only once that action has finished.
  equip(id, material = this.material) {
    if (this.busy || !WEAPON_IDS.includes(id) || !MATERIAL_IDS.includes(material)) return false;
    const regenDelay = this.regenDelay;
    this.weapon = getWeapon(id, material);
    this.context = {};
    this.reset();
    this.regenDelay = regenDelay;
    return true;
  }

  nextCombo(move = this.lastSwing) {
    const combo = this.moveset.combo;
    const index = combo.indexOf(move);
    return combo[(index + 1) % combo.length];
  }

  chooseAttack(ctx, combo = true) {
    if (airborne(ctx)) return this.moveset.air;
    if (ctx.running && ctx.moving !== false) return this.moveset.sprint;
    return combo && this.inHand && this.move !== 'draw' && this.calm < 0.6 && this.lastSwing
      ? this.nextCombo() : this.moveset.combo[0];
  }

  attack(ctx = {}) {
    const requested = context(ctx, this.context);
    this.context = requested;
    if (this.blocking) return false;
    const holding = ctx !== null && typeof ctx === 'object' && !!ctx.held;
    const comboMove = this.moveset.combo.includes(this.move);
    if (this.move && this.move !== 'draw' && !comboMove) return false;
    if (this.holding) return false;

    const sprinting = requested.running && requested.moving !== false;
    const next = comboMove && !sprinting && !airborne(requested)
      ? this.nextCombo(this.move) : this.chooseAttack(requested);
    if (holding) {
      this.holding = true;
      this.holdTime = 0;
      this.charge = 0;
      this.holdFallback = next;
    }
    const wanted = holding ? 'charge' : next;
    const cost = this.weapon.staminaCost * (this.moveset.moves[next].stamina ?? 1);
    if (!holding && !this.move && this.stamina + 1e-9 < cost) return false;
    if (this.move) {
      this.queued = wanted;
      this.queuedContext = context(requested);
      return true;
    }
    // A bow starts aiming straight away. Releasing a short press therefore
    // works even when it was previously carried in its quiver.
    if (!this.inHand && this.weaponId === 'bow' && holding) this.inHand = true;
    if (!this.inHand) {
      this.start('draw', requested);
      this.queued = wanted;
      this.queuedContext = context(requested);
      return true;
    }
    const started = this.start(wanted, requested);
    if (!started) this.holding = false;
    return started;
  }

  // A short press keeps the light combo; a deliberate hold releases the
  // weapon's charged move. This also replaces a pending charge during draw.
  release(ctx = {}) {
    if (!this.holding) return false;
    const requested = context(ctx, this.context);
    requested.held = false;
    this.context = requested;
    this.holding = false;
    const charged = this.holdTime >= CHARGE_THRESHOLD;
    const next = charged ? this.moveset.charged : this.holdFallback ?? this.chooseAttack(requested);
    // Freeze the release target separately from live pointer input. The
    // draw, shot and recovery may continue while the cursor moves again.
    const action = context({ ...requested, charge: charged ? this.charge : 0 });
    if (this.move === 'charge') {
      this.move = null;
      const started = this.start(next, action);
      if (!started) this.charge = 0;
      return started;
    }
    if (this.queued === 'charge') {
      this.queued = next;
      this.queuedContext = action;
      return true;
    }
    return this.start(next, action);
  }

  // Focus changes cancel held input without firing an arrow or cutting an
  // ordinary attack short. Full cancellation is also available to previews.
  cancelAction() {
    if (this.move === 'charge') {
      this.move = null;
      this.step = 0;
      this.t = 0;
    }
    if (this.queued === 'charge' || this.holding) {
      this.queued = null;
      this.queuedContext = null;
    }
    this.holding = false;
    this.holdTime = 0;
    this.charge = 0;
    this.blocking = false;
    this.guardExhausted = false;
    this.parryRemaining = 0;
    this.context.held = false;
    this.context.blocking = false;
  }

  cancel() {
    this.cancelAction();
    this.bowDraw = null;
    this.bowShot = null;
    this.projectileShot = null;
    this.move = null;
    this.queued = null;
    this.queuedContext = null;
    this.step = 0;
    this.t = 0;
    this.trailing = false;
    this.lastSwing = '';
    this.motion = { forward: 0, turn: 0 };
    this.events.length = 0;
  }

  toggle() {
    if (this.busy) return false;
    return this.start(this.inHand ? 'sheathe' : 'draw');
  }

  spendStamina(cost) {
    if (this.stamina + 1e-9 < cost) return false;
    this.stamina = Math.max(0, this.stamina - cost);
    this.regenDelay = REGEN_DELAY;
    return true;
  }

  recoverStamina(dt, idle) {
    const delayed = Math.min(dt, this.regenDelay);
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    if (idle) this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * (dt - delayed));
  }

  start(move, ctx = this.context) {
    if (!Object.hasOwn(this.moveset.moves, move)) return false;
    const definition = this.moveset.moves[move];
    if (!definition) return false;
    const cost = definition.kind === 'utility' ? 0 : this.weapon.staminaCost * (definition.stamina ?? 1);
    if (cost > 0 && !this.spendStamina(cost)) return false;
    this.move = move;
    this.step = 0;
    this.t = 0;
    this.calm = 0;
    this.actionStamina = cost;
    this.actionCharge = move === this.moveset.charged ? clamp(ctx.charge ?? this.charge, 0, 1) : 0;
    this.actionContext = context(ctx);
    if (this.moveset.combo.includes(move)) this.lastSwing = move;
    else if (definition.kind !== 'utility') this.lastSwing = '';
    return true;
  }

  block(on = true) {
    if (!on) {
      this.blocking = false;
      this.guardExhausted = false;
      this.parryRemaining = 0;
      return true;
    }
    if (this.weaponId !== 'sword-shield' || this.move || this.stamina <= 0 || this.guardExhausted) return false;
    if (this.blocking) return true;
    this.blocking = true;
    this.inHand = true;
    this.parryRemaining = PARRY_WINDOW;
    this.calm = 0;
    this.events.push(this.defenseEvent('block', { window: PARRY_WINDOW, parrying: true }));
    return true;
  }

  breakGuard() {
    this.blocking = false;
    this.parryRemaining = 0;
    this.guardExhausted = true;
  }

  defenseEvent(type, extra = {}) {
    return {
      type, kind: 'defense', weapon: this.weaponId, material: this.material,
      move: type, damage: 0, reach: this.weapon.reach, stamina: 0,
      strength: 0, charged: false, trailColor: this.weapon.trailColor, ...extra,
    };
  }

  // Enemy systems can use this result directly. Parry has a short opening
  // window; continued blocking absorbs three quarters of a frontal hit.
  defend(incoming, ctx = {}) {
    const damage = Number.isFinite(incoming) ? Math.max(0, incoming) : 0;
    const result = { damage, reducedDamage: damage, blocked: false, parried: false, stamina: 0 };
    if (!this.blocking || ctx.front === false || damage === 0) return result;
    const parried = this.parrying;
    const cost = parried ? 6 + damage * 0.15 : damage * 0.35;
    if (!this.spendStamina(cost)) {
      this.breakGuard();
      return result;
    }
    result.damage = result.reducedDamage = parried ? 0 : damage * 0.25;
    result.blocked = true;
    result.parried = parried;
    result.stamina = cost;
    this.events.push(this.defenseEvent(parried ? 'parry' : 'block', {
      incomingDamage: damage, reducedDamage: result.damage, stamina: cost, parried,
    }));
    return result;
  }

  impact(definition, packet) {
    const charge = this.actionCharge;
    const backstab = this.weaponId === 'dagger' && !!this.actionContext.behind;
    const baseReach = packet.projectile
      ? this.weapon.projectileRange ?? this.weapon.reach * 5
      : this.weapon.reach;
    const reach = baseReach * (definition.reach ?? 1) * (1 + charge * 0.4);
    const damage = this.weapon.damage * (definition.damage ?? 1) * (1 + charge * 0.6) * (backstab ? 3 : 1);
    const materialStrength = this.weaponId === 'axe' ? this.weapon.damage / getWeapon('axe', 'steel').damage : 1;
    const projectile = packet.projectile ? {
      ...packet.projectile,
      material: this.material,
      speed: packet.projectile.speed * (1 + charge * 0.7),
      range: reach,
      lifetime: reach / (packet.projectile.speed * (1 + charge * 0.7)) * 1.5,
      count: packet.count ?? 1,
    } : undefined;
    const aimedProjectile = CURSOR_PROJECTILES.has(projectile?.kind);
    const aimTarget = aimedProjectile ? copyAimTarget(this.actionContext.aimTarget) : null;
    this.events.push({
      type: backstab ? 'backstab' : packet.type,
      kind: definition.kind, weapon: this.weaponId, material: this.material,
      move: definition.name, damage, reach, stamina: this.actionStamina,
      charged: charge > 0, charge, backstab,
      strength: (definition.damage ?? 1) * (1 + charge * 0.6) * materialStrength,
      trailColor: this.weapon.trailColor,
      ...(projectile ? { projectile, count: projectile.count } : {}),
      ...(aimTarget ? { aimTarget } : {}),
    });
    if (aimedProjectile) {
      this.projectileShot = { kind: projectile.kind, target: copyAimTarget(aimTarget), speed: projectile.speed, gravity: projectile.gravity };
    }
    if (projectile?.kind === 'arrow') {
      this.bowShot = this.projectileShot;
      // A second queued draw has its own charge; this arrow retains the
      // draw captured when it was released.
      this.bowDraw = charge;
    }
    if (!this.holding) {
      // The launch frame still uses the drawn arrow's pose. Gameplay
      // charge ends now; the string relaxes on the following update.
      this.charge = 0;
    }
  }

  update(dt, ctx = {}) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.bowDraw = null;
    this.bowShot = null;
    this.projectileShot = null;
    this.context = context(ctx, this.context);
    const current = this.context;
    this.trailing = false;
    this.motion = { forward: 0, turn: 0 };
    if (typeof ctx === 'object' && ctx !== null && Object.hasOwn(ctx, 'blocking')) this.block(!!ctx.blocking);
    if (this.holding && typeof ctx === 'object' && ctx !== null && Object.hasOwn(ctx, 'held') && !ctx.held) this.release(current);
    if (this.holding) {
      this.holdTime += dt;
      this.charge = clamp(this.holdTime / this.moveset.chargeDuration, 0, 1);
    }

    let remaining = dt;
    if (this.blocking) {
      const guarded = Math.min(remaining, this.stamina / 7);
      this.parryRemaining = Math.max(0, this.parryRemaining - guarded);
      this.recoverStamina(guarded, false);
      if (guarded > 0) this.spendStamina(7 * guarded);
      remaining -= guarded;
      if (this.stamina <= 1e-9) {
        this.stamina = 0;
        this.breakGuard();
      }
    }
    let target = this.moveset.keys.rest;
    let rate = 12;
    // Consume every crossed step, preserving excess frame time. A held
    // charge or an airborne plunge is the only intentional waiting state.
    for (let transitions = 0; this.move && transitions < 64; transitions++) {
      const definition = this.moveset.moves[this.move];
      const s = definition.steps[this.step];
      target = this.keyPose(s.key);
      rate = s.rate * this.weapon.speed;
      this.trailing ||= !!s.trail;
      this.calm = 0;
      if (this.move === 'charge') {
        this.recoverStamina(remaining, false);
        remaining = 0;
        break;
      }

      const cut = s.combo && this.queued;
      const timeLeft = cut ? 0 : Math.max(0, s.time - this.t) / this.weapon.speed;
      const elapsed = Math.min(remaining, timeLeft);
      this.t += elapsed * this.weapon.speed;
      remaining -= elapsed;
      this.recoverStamina(elapsed, false);
      this.motion.forward += (s.forward ?? 0) * elapsed;
      this.motion.turn += (s.turn ?? 0) * elapsed;
      if (!cut && this.t + 1e-9 < s.time) break;
      if (s.waitForGround && airborne(current)) {
        this.t = s.time;
        this.recoverStamina(remaining, false);
        remaining = 0;
        break;
      }

      if (s.grab) this.inHand = true;
      if (s.release) this.inHand = false;
      if (s.event) this.impact(definition, s.event);
      this.t = 0;
      this.step++;
      const done = this.step >= definition.steps.length;
      if (done || (this.queued && definition.steps[this.step].combo)) {
        const next = this.queued;
        const nextContext = this.queuedContext ?? current;
        this.queued = null;
        this.queuedContext = null;
        this.move = null;
        if (next && !this.start(next, nextContext)) {
          this.holding = false;
          this.charge = 0;
        }
      }
      if (remaining <= 0 && this.move && this.moveset.moves[this.move].steps[this.step]?.time !== 0) break;
    }
    if (dt > 0) {
      this.motion.forward /= dt;
      this.motion.turn /= dt;
    }
    if (!this.move) {
      target = this.blocking ? this.moveset.keys.block
        : this.inHand ? this.moveset.keys[current.moving ? 'carry' : 'guard']
          : this.moveset.keys.rest;
      this.calm += remaining;
      this.recoverStamina(remaining, !this.blocking && !this.holding);
      if (this.inHand && !this.blocking && this.calm > SHEATHE_AFTER && !current.moving) this.start('sheathe');
    }

    const k = 1 - Math.exp(-rate * dt);
    const p = this.pose;
    for (let i = 0; i < 3; i++) {
      p.hand[i] += (target.hand[i] - p.hand[i]) * k;
      p.blade[i] += (target.blade[i] - p.blade[i]) * k;
    }
    const len = Math.hypot(...p.blade) || 1;
    for (let i = 0; i < 3; i++) p.blade[i] /= len;
    for (const name of ['twist', 'lean', 'crouch', 'off', 'shield']) {
      p[name] += ((target[name] ?? 0) - p[name]) * k;
    }
    const want = this.inHand || this.move || this.blocking ? 1 : 0;
    this.active += (want - this.active) * (1 - Math.exp(-14 * dt));
  }
}

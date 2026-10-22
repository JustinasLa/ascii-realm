// Health changes through damage and healing. Stamina pays for exertion and
// returns after a short rest, whether standing still or walking.
export const SPRINT_STAMINA_PER_SECOND = 18;
export const STAMINA_REGEN_PER_SECOND = 20;
export const STAMINA_REGEN_DELAY = 1.2;

const bounded = (value, max) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

export class Vitals {
  constructor() {
    this.maxHealth = 100;
    this.health = 100;
    this.maxStamina = 100;
    this.stamina = 100;
    this.regenDelay = 0;
  }

  clamp() {
    this.maxHealth = Number.isFinite(this.maxHealth) ? Math.max(0, this.maxHealth) : 100;
    this.maxStamina = Number.isFinite(this.maxStamina) ? Math.max(0, this.maxStamina) : 100;
    this.health = bounded(this.health, this.maxHealth);
    this.stamina = bounded(this.stamina, this.maxStamina);
  }

  update(dt, sprinting = false) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.clamp();
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - SPRINT_STAMINA_PER_SECOND * dt);
      this.regenDelay = STAMINA_REGEN_DELAY;
      return;
    }
    // Only the part of this frame after the rest delay regenerates stamina.
    const resting = Math.max(0, dt - this.regenDelay);
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    this.stamina = Math.min(this.maxStamina, this.stamina + resting * STAMINA_REGEN_PER_SECOND);
  }

  spendStamina(amount) {
    if (!Number.isFinite(amount) || amount < 0) return false;
    if (amount === 0) return true;
    this.clamp();
    if (this.stamina < amount) return false;
    this.stamina -= amount;
    this.regenDelay = STAMINA_REGEN_DELAY;
    return true;
  }

  takeDamage(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    this.clamp();
    const applied = Math.min(this.health, amount);
    this.health -= applied;
    return applied;
  }

  heal(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    this.clamp();
    const applied = Math.min(this.maxHealth - this.health, amount);
    this.health += applied;
    return applied;
  }

  restoreStamina(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    this.clamp();
    const applied = Math.min(this.maxStamina - this.stamina, amount);
    this.stamina += applied;
    return applied;
  }
}

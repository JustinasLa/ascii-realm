// The target: the creature the player last landed a blow on, shown by name
// and health in a fixed frame of the HUD. Only the player's own blows pick
// one (a sword cut, an arrow or thrown shaft, or one of their runes); wounds
// from monsters or other animals never do. It is kept while the creature is
// still about, near and recently struck, and shown "slain" for a moment
// after it dies.
import { toMetres } from '../entities/monsters.js';

export const TARGET = Object.freeze({
  // Metres from the player before the target is dropped.
  range: 20,
  // Seconds after the last landed blow before it is dropped.
  forget: 15,
  // Seconds a slain target stays in the frame.
  slainHold: 1.5,
});

// Monsters and animals both number from 1, so ids carry what they are.
// Only animal kinds have a role ('prey', ...).
export const targetId = (entity) => `${entity.kind?.role ? 'animal' : 'monster'}:${entity.id}`;

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

// Of the creatures one blow struck, the one it was meant for: the foe the
// aim assist turned to, if struck; else the one closest to straight ahead
// of the player, with ties going to the lower id (animals before monsters,
// then by number).
export function pickStruck(hits, player, preferred = null) {
  if (!hits?.length) return null;
  if (preferred && hits.includes(preferred)) return preferred;
  let best = null;
  for (const entity of hits) {
    const [mx, mz] = toMetres(entity.x - player.x, entity.y - player.y);
    const off = mx || mz ? Math.abs(wrap(Math.atan2(mx, mz) - (player.heading ?? 0))) : 0;
    const role = targetId(entity).split(':')[0];
    if (!best || off < best.off
      || off === best.off && (role < best.role || role === best.role && entity.id < best.entity.id)) {
      best = { entity, off, role };
    }
  }
  return best.entity;
}

export class TargetTracker {
  constructor(config = TARGET) {
    this.config = config;
    this.clear();
  }

  // `entity` becomes the target, replacing any other.
  mark(entity, time) {
    if (!entity) return;
    if (entity !== this.entity) this.diedAt = null;
    this.entity = entity;
    this.struck = time;
  }

  clear() {
    this.entity = null;
    this.struck = 0;
    this.diedAt = null;
  }

  // The frame's view of the target, or null once it is lost:
  // { id, name, health, maxHealth, note, slain }. `isPresent(id)` tells
  // whether the creature is still in the world.
  update(time, player, isPresent = () => true) {
    const entity = this.entity;
    if (!entity) return null;
    const id = targetId(entity);
    if (entity.gone || !isPresent(id)) return this.lose();
    const slain = entity.alive === false || !(entity.health > 0);
    if (slain) {
      this.diedAt ??= time;
      if (time - this.diedAt > this.config.slainHold) return this.lose();
    } else {
      const [mx, mz] = toMetres(entity.x - player.x, entity.y - player.y);
      if (Math.hypot(mx, mz) > this.config.range || time - this.struck > this.config.forget) return this.lose();
    }
    return { id, name: String(entity.kind?.name ?? 'Foe'), health: slain ? 0 : entity.health,
      maxHealth: entity.maxHealth, note: slain ? 'slain' : entity.enraged ? 'enraged' : '', slain };
  }

  lose() {
    this.clear();
    return null;
  }
}

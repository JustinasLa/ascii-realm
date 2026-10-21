// What spells do to the ground fog (see fog-wake.js). Fog is only ever
// pushed about, never burned off or conjured:
//
// - a spell in flight cuts through the fog like a small, fast walker,
//   shoving it aside and dragging a wake behind it;
// - a spell being cast, landing or pulsing throws the fog outward in a
//   ragged ring, wider for a wider effect;
// - a lasting zone or aura whirls the fog around itself for as long as it
//   lasts.

import { SCALE } from '../entities/rig.js';

// Rows of fog per metre of spell radius, across and down the screen
// averaged, since the ground is drawn squashed in depth.
export const ROWS_PER_METRE = SCALE * 0.75;
// How hard each kind of moment throws the fog, and the narrowest burst.
const BURSTS = { cast: 0.2, impact: 1, pulse: 0.45 };
const MIN_BURST = 0.7;
// Auras turn the fog gently; zones (rings of rain, vortices) turn it hard.
const AURA_WHIRL = 0.35;
// Spells in flight part a narrow channel.
export const MISSILE_SIZE = 0.4;

export class SpellFogStirs {
  constructor() {
    // Effects already turned into bursts, so each throws the fog once, and
    // the way each zone or aura turns.
    this.seen = new WeakSet();
    this.spins = new WeakMap();
  }

  // The fog walkers, bursts and whirls for this frame from one caster's
  // spells (a Spellcasting), at most `missiles` spells in flight.
  collect(casting, missiles = 8) {
    const walkers = [];
    const bursts = [];
    const whirls = [];
    for (const p of (casting?.projectiles ?? []).slice(0, missiles)) {
      walkers.push({ id: p, x: p.x, y: p.y, size: MISSILE_SIZE, lift: 0 });
    }
    for (const e of casting?.effects?.list ?? []) {
      const radius = Math.max(MIN_BURST, e.radius ?? 1) * ROWS_PER_METRE;
      if (e.stage === 'aura') {
        whirls.push({ x: e.x, y: e.y, radius, spin: this.spinOf(e), strength: AURA_WHIRL });
        continue;
      }
      if (this.seen.has(e) || !(e.stage in BURSTS)) continue;
      this.seen.add(e);
      bursts.push({ x: e.x, y: e.y, radius, strength: BURSTS[e.stage] });
    }
    for (const z of casting?.zones ?? []) {
      whirls.push({ x: z.x, y: z.y, radius: Math.max(MIN_BURST, z.radius ?? 1) * ROWS_PER_METRE,
        spin: this.spinOf(z), strength: 1 });
    }
    return { walkers, bursts, whirls };
  }

  // Each zone turns one way for its whole life, picked from where it began.
  spinOf(thing) {
    if (!this.spins.has(thing)) {
      this.spins.set(thing, Math.sin((thing.x ?? 0) * 12.9898 + (thing.y ?? 0) * 78.233) >= 0 ? 1 : -1);
    }
    return this.spins.get(thing);
  }
}

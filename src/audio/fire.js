import { firePulse } from '../core/fire.js';
import { loopNoise, noise, setParam } from './voices.js';
import { nextSoundVariant, varySound } from './variations.js';

// Only the closest few fires need voices. All sound uses the ambience bus.
export class FireAudio {
  constructor(engine) {
    this.engine = engine;
    this.context = null;
    this.voices = new Map();
    this.pops = new Set();
    this.disposed = false;
  }

  update(fires = [], time = 0) {
    if (this.disposed) return;
    const context = this.engine.context;
    if (context?.state !== 'running') { this.pause(); return; }
    if (context !== this.context) { this.pause(); this.context = context; }
    for (const pop of this.pops) if (pop.ended) this.pops.delete(pop);
    const nearby = fires.map(fire => ({ fire, spatial: this.engine.spatial(fire.x, fire.y) }))
      .filter(({ fire, spatial }) => spatial.gain > 0.12 && (fire.intensity ?? 1) > 0.01)
      .sort((a, b) => b.spatial.gain - a.spatial.gain).slice(0, 4);
    const ids = new Set(nearby.map(({ fire }) => fire.id));
    for (const [id, voice] of this.voices) {
      if (!ids.has(id)) { voice.bed.stop(); this.voices.delete(id); }
    }
    for (const { fire, spatial } of nearby) {
      let voice = this.voices.get(fire.id);
      if (!voice) {
        // Apply attenuation once and refresh it as the listener moves.
        const variant = nextSoundVariant(this.engine, 'fire:bed');
        const bed = loopNoise(this.engine, varySound(variant, { bus: 'ambience', cutoff: 720,
          filterType: 'lowpass', Q: 0.5, gain: 0 }));
        if (!bed) continue;
        voice = { bed, variant, nextPop: context.currentTime + 0.15 + Math.random() * 0.4 };
        this.voices.set(fire.id, voice);
      }
      const pulse = firePulse(fire, time);
      setParam(voice.bed.gain.gain, 0.075 * pulse * spatial.gain * voice.variant.level, context.currentTime, 0.12);
      setParam(voice.bed.filter.frequency, (560 + 330 * pulse) * voice.variant.color, context.currentTime, 0.12);
      setParam(voice.bed.pan?.pan, spatial.pan, context.currentTime, 0.12);
      if (context.currentTime >= voice.nextPop && this.pops.size < 16) {
        const strength = fire.intensity ?? 1;
        voice.nextPop = context.currentTime + (0.15 + Math.random() * 0.65) / (0.3 + strength * 0.7);
        const pop = noise(this.engine, varySound(nextSoundVariant(this.engine, 'fire:crackle'), {
          bus: 'ambience', x: fire.x, y: fire.y,
          cutoff: 1000 + Math.random() * 1800, filterType: 'bandpass', Q: 0.6,
          duration: 0.035 + Math.random() * 0.055, gain: (0.045 + Math.random() * 0.045) * strength,
          attack: 0.002, decay: 0.006, sustain: 0.12, release: 0.025 }));
        if (pop) this.pops.add(pop);
      }
    }
    // Extinguishing the last fire also clears already scheduled crackles.
    if (!nearby.length) {
      for (const pop of this.pops) pop.stop();
      this.pops.clear();
    }
  }

  react(event) {
    if (this.disposed || this.engine.context?.state !== 'running'
        || ![event.x, event.y, event.strength].every(Number.isFinite) || event.strength <= 0) return [];
    const weight = Math.min(1.5, event.strength);
    const variant = nextSoundVariant(this.engine, 'fire:contact');
    const whoosh = noise(this.engine, varySound(variant, { bus: 'sfx', x: event.x, y: event.y,
      cutoff: 550 + weight * 650, Q: 0.5, duration: 0.1 + weight * 0.12,
      gain: 0.028 + weight * 0.035, attack: 0.008, release: 0.08 }));
    const crackle = noise(this.engine, varySound(variant, { bus: 'sfx', x: event.x, y: event.y,
      cutoff: 1700, filterType: 'bandpass', Q: 0.8, duration: 0.05 + weight * 0.04,
      gain: weight * 0.04, attack: 0.002, release: 0.04 }));
    return [whoosh, crackle].filter(Boolean);
  }

  pause() {
    for (const voice of this.voices.values()) voice.bed.stop();
    for (const pop of this.pops) pop.stop();
    this.voices.clear();
    this.pops.clear();
    this.context = null;
  }

  dispose() { this.pause(); this.disposed = true; }
}

import { tone, noise, loopNoise, setParam } from './voices.js';
import { ASPECT } from '../world/world.js';
import { climateAmbience } from './climate.js';
import { nextSoundVariant, varySound } from './variations.js';

const clamp01 = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const between = (low, high) => low + Math.random() * (high - low);
// Each species has a different rhythm and pitch contour: rising peeps, a
// descending warble, and a two-part whistle. Offsets are deliberately uneven.
const BIRD_CALLS = [
  [[0, 0.085, 1700, 2450], [0.145, 0.065, 2250, 2750], [0.325, 0.11, 1900, 2600]],
  [[0, 0.18, 2400, 1450], [0.23, 0.095, 1700, 2200], [0.365, 0.14, 2200, 1350]],
  [[0, 0.14, 1450, 2100], [0.17, 0.09, 2100, 1850], [0.4, 0.23, 1850, 1200]],
];

// Driven by the game loop: the only persistent voices are quiet noise beds.
// Wildlife phrases are sparse notes scheduled against the audio clock.
export class Ambience {
  constructor(engine) {
    this.engine = engine;
    this.context = null;
    this.wind = null;
    this.leaves = null;
    this.water = null;
    this.notes = [];
    this.nextCricket = 0;
    this.nextShimmer = 0;
    this.nextBird = 0;
    this.nextOwl = 0;
    this.nextFrog = 0;
    this.nextAnimal = 0;
    this.nextInsect = 0;
    this.nextBuzz = 0;
    this.nextRustle = 0;
    this.disposed = false;
  }

  update({ time = 0, gust = 0, night = 0, water = null, fireflies = [],
    season = 'spring', weather = 'clear', weatherIntensity = 0.6 } = {}) {
    const context = this.engine.context;
    if (this.disposed || context?.state !== 'running') return;
    const now = context.currentTime;
    if (context !== this.context) {
      this._stopVoices();
      this.context = context;
      this.nextCricket = now + between(3, 7);
      this.nextShimmer = now + between(6, 12);
      this.nextBird = now + between(4, 8);
      this.nextOwl = now + between(9, 17);
      this.nextFrog = now + between(7, 12);
      this.nextAnimal = now + between(24, 40);
      this.nextInsect = now + between(9, 15);
      this.nextBuzz = now + between(15, 24);
      this.nextRustle = now + between(4, 8);
    }
    if (!this.wind) {
      this.windVariant = nextSoundVariant(this.engine, 'ambience:wind');
      this.wind = loopNoise(this.engine, varySound(this.windVariant,
        { bus: 'ambience', cutoff: 260, gain: 0, Q: 0.45 }));
    }
    if (!this.leaves) {
      this.leafVariant = nextSoundVariant(this.engine, 'ambience:leaves');
      this.leaves = loopNoise(this.engine, varySound(this.leafVariant, {
        bus: 'ambience', cutoff: 1000, filterType: 'bandpass', gain: 0, Q: 0.45,
      }));
    }
    if (!this.water && water) {
      // The route stays unpositioned; apply current spatial gain exactly once.
      this.waterVariant = nextSoundVariant(this.engine, 'ambience:water');
      this.water = loopNoise(this.engine, varySound(this.waterVariant,
        { bus: 'ambience', cutoff: 650, gain: 0, Q: 0.45 }));
    }
    for (let index = this.notes.length - 1; index >= 0; index--) {
      if (this.notes[index].end <= now) {
        this.notes[index].handle.stop();
        this.notes.splice(index, 1);
      }
    }

    const wind = clamp01(gust);
    const darkness = clamp01(night);
    const daylight = 1 - darkness;
    const clock = Number.isFinite(time) ? time : now;
    const climate = climateAmbience(season, weather, weatherIntensity);
    const turbulence = 0.89 + 0.08 * Math.sin(clock * 0.31) + 0.03 * Math.sin(clock * 0.83);
    if (this.wind) {
      setParam(this.wind.gain.gain, (0.009 + wind * 0.028) * turbulence * this.windVariant.level, now, 1.1);
      setParam(this.wind.filter.frequency, (120 + wind * 430 * turbulence) * this.windVariant.color, now, 1.3);
    }
    if (this.leaves) {
      setParam(this.leaves.gain.gain, (0.00035 + wind * wind * 0.0028) * turbulence
        * climate.leaves * this.leafVariant.level, now, 0.9);
      setParam(this.leaves.filter.frequency, (800 + wind * 550) * this.leafVariant.color, now, 1.1);
    }
    if (this.water) {
      let gain = 0;
      let pan = 0;
      if (water && Number.isFinite(water.x) && Number.isFinite(water.y)) {
        const spatial = this.engine.spatial(water.x, water.y);
        // Two gentle swells follow world time, like the visible shoreline.
        const lap = 0.74 + 0.17 * Math.sin(clock * 0.43) + 0.09 * Math.sin(clock * 0.91);
        gain = 0.048 * clamp01(water.strength) * spatial.gain * lap * climate.water * this.waterVariant.level;
        pan = spatial.pan;
      }
      setParam(this.water.gain.gain, gain, now, 0.65);
      setParam(this.water.pan?.pan, pan, now, 0.15);
    }

    this._wildlife(now, daylight, darkness, water, wind, climate);

    if (now >= this.nextCricket) {
      this.nextCricket = now + between(6, 12);
      if (darkness > 0.25 && climate.insects > 0) {
        this._beginCue('cricket', now, climate.insects);
        const pitch = between(2600, 3300);
        const position = this._position(15, 30);
        const spacing = between(0.1, 0.14);
        for (let chirp = 0; chirp < 2; chirp++) {
          const when = now + chirp * spacing;
          this._note({
            bus: 'ambience', ...position, frequency: pitch, endFrequency: pitch * 0.98,
            type: 'sine', cutoff: 2700, Q: 0.4, duration: 0.065, gain: 0.0045 * darkness,
            attack: 0.012, decay: 0.015, sustain: 0.25, release: 0.035, when,
          });
        }
      }
    }

    if (now >= this.nextShimmer) {
      // Check the actual rendered pulse, then choose the nearest bright source.
      // Only a rare nocturnal noise glint: no melody or pitched drone competing
      // with the score. The rendered pulse still determines its source.
      this.nextShimmer = now + 1.2;
      let nearest = null;
      let nearestGain = 0;
      let brightness = 0;
      for (const firefly of darkness > 0.4 ? (fireflies ?? []) : []) {
        if (!Number.isFinite(firefly.x) || !Number.isFinite(firefly.y)) continue;
        const pulse = Math.max(0, Math.sin(clock * 1.4 + firefly.phase));
        if (pulse < 0.8) continue;
        const spatial = this.engine.spatial(firefly.x, firefly.y);
        if (spatial.gain > nearestGain) {
          nearest = firefly;
          nearestGain = spatial.gain;
          brightness = pulse * pulse;
        }
      }
      if (nearest && nearestGain > 0.1) {
        this._beginCue('firefly', now);
        this.nextShimmer = now + between(11, 20);
        this._breath({
          x: nearest.x, y: nearest.y, cutoff: between(850, 1200),
          filterType: 'bandpass', Q: 1.6, duration: 1.8,
          gain: 0.0038 * brightness * darkness,
          attack: 0.4, decay: 0.45, sustain: 0.16, release: 0.8, when: now,
        });
        this._breath({
          x: nearest.x, y: nearest.y, cutoff: 380, Q: 0.5, duration: 1.5,
          gain: 0.0016 * brightness * darkness, attack: 0.45,
          decay: 0.35, sustain: 0.15, release: 0.65, when: now + 0.08,
        });
      }
    }
  }

  _note(options, end) {
    if (this.notes.length >= 48) return;
    options = this._vary(options);
    const handle = tone(this.engine, options);
    if (handle) this.notes.push({
      handle, end: end ?? (options.when ?? this.context.currentTime) + options.duration + 0.03,
    });
  }

  _breath(options) {
    if (this.notes.length >= 48) return;
    options = this._vary(options);
    const handle = noise(this.engine, { bus: 'ambience', ...options });
    if (handle) this.notes.push({
      handle, end: (options.when ?? this.context.currentTime) + options.duration + 0.03,
    });
  }

  _position(minimum, maximum) {
    const listener = this.engine.listener ?? { x: 0, y: 0 };
    const angle = between(0, Math.PI * 2);
    const distance = between(minimum, maximum);
    return {
      x: listener.x + Math.cos(angle) * distance / ASPECT,
      y: listener.y + Math.sin(angle) * distance,
    };
  }

  _beginCue(key, now, level = 1) {
    this.cueVariant = nextSoundVariant(this.engine, `ambience:${key}`);
    this.cueStart = now;
    this.cueLayer = 0;
    this.cueLevel = level;
  }

  _vary(options) {
    const varied = varySound(this.cueVariant, { ...options, gain: options.gain * this.cueLevel }, this.cueLayer++);
    return { ...varied, when: this.cueStart + ((options.when ?? this.cueStart) - this.cueStart) * this.cueVariant.timing };
  }

  _wildlife(now, daylight, darkness, water, wind, climate) {
    if (now >= this.nextBird) {
      this.nextBird = now + between(11, 22);
      if (daylight > 0.3) {
        this._beginCue('bird', now, climate.birds);
        const position = this._position(20, 38);
        const call = BIRD_CALLS[this.cueVariant.id % BIRD_CALLS.length];
        const pitch = between(0.9, 1.07);
        const pace = between(1, 1.25);
        for (const [offset, duration, start, finish] of call) {
          this._note({
            bus: 'ambience', ...position, frequency: start * pitch,
            endFrequency: finish * pitch, type: 'sine', duration: duration * pace,
            cutoff: 2200, Q: 0.45, gain: between(0.005, 0.008) * daylight,
            attack: 0.014, decay: duration * 0.3, sustain: 0.22, release: duration * 0.4,
            when: now + offset * pace,
          });
        }
        this._breath({
          ...position, cutoff: 1600, filterType: 'bandpass', Q: 0.6, duration: 0.48 * pace,
          gain: 0.0012 * daylight, attack: 0.065, decay: 0.13,
          sustain: 0.2, release: 0.2, when: now,
        });
      }
    }

    if (now >= this.nextOwl) {
      this.nextOwl = now + between(27, 45);
      if (darkness > 0.55) {
        this._beginCue('owl', now, climate.shelter);
        const position = this._position(28, 45);
        const pitch = between(235, 285);
        for (const [offset, duration, level] of [[0, 0.32, 0.65], [0.56, 0.72, 1]]) {
          this._note({
            bus: 'ambience', ...position, frequency: pitch, endFrequency: pitch * 0.93,
            type: 'sine', cutoff: 600, Q: 0.45, duration, gain: 0.008 * darkness * level,
            attack: 0.1, decay: duration * 0.2, sustain: 0.42,
            release: duration * 0.45, when: now + offset,
          });
          this._note({
            bus: 'ambience', ...position, frequency: pitch * 2.01,
            endFrequency: pitch * 1.87, type: 'sine', cutoff: 650, Q: 0.45, duration,
            gain: 0.001 * darkness * level, attack: 0.11, decay: duration * 0.2,
            sustain: 0.3, release: duration * 0.45, when: now + offset,
          });
        }
        this._breath({ ...position, cutoff: 470, Q: 0.45, duration: 1.35,
          gain: 0.0035 * darkness, attack: 0.23, decay: 0.35,
          sustain: 0.3, release: 0.65, when: now });
      }
    }

    if (now >= this.nextFrog) {
      this.nextFrog = now + between(16, 28);
      if (water && Number.isFinite(water.x) && Number.isFinite(water.y)
          && clamp01(water.strength) > 0.18 && darkness > 0.2 && climate.frogs > 0) {
        this._beginCue('frog', now, climate.frogs);
        // Use the actual lake location; the voice route attenuates it once.
        const position = { x: water.x, y: water.y };
        const level = clamp01(water.strength) * darkness;
        const pitch = between(140, 195);
        for (const offset of [0, between(0.4, 0.65)]) {
          this._note({ bus: 'ambience', ...position, frequency: pitch,
            endFrequency: pitch * 0.78, type: 'triangle', duration: 0.23,
            cutoff: 650, Q: 0.5, gain: 0.006 * level, attack: 0.04,
            decay: 0.06, sustain: 0.24, release: 0.12, when: now + offset });
          this._breath({ ...position, cutoff: 450, filterType: 'bandpass', Q: 0.55,
            duration: 0.2, gain: 0.0045 * level, attack: 0.045,
            decay: 0.055, sustain: 0.2, release: 0.09, when: now + offset });
        }
      }
    }

    if (now >= this.nextAnimal) {
      this._beginCue('deer', now, climate.shelter);
      this.nextAnimal = now + between(48, 78);
      const position = this._position(37, 52);
      // A soft, distant deer-like nasal contact call, with a breathy ending.
      const pitch = between(190, 250);
      this._note({ bus: 'ambience', ...position, frequency: pitch,
        endFrequency: pitch * 0.86, type: 'triangle', cutoff: 650, Q: 0.45,
        duration: 0.95, gain: 0.005, attack: 0.2, decay: 0.22,
        sustain: 0.24, release: 0.5, when: now });
      this._note({ bus: 'ambience', ...position, frequency: pitch * 2.6,
        endFrequency: pitch * 2.2, type: 'sine', cutoff: 750, Q: 0.4, duration: 0.7,
        gain: 0.0015, attack: 0.15, decay: 0.15, sustain: 0.2,
        release: 0.35, when: now + 0.04 });
      this._breath({ ...position, cutoff: 600, filterType: 'bandpass', Q: 0.45,
        duration: 0.85, gain: 0.0025, attack: 0.18, decay: 0.2,
        sustain: 0.25, release: 0.4, when: now + 0.12 });
    }

    if (now >= this.nextInsect) {
      this.nextInsect = now + between(19, 33);
      if (daylight > 0.4 && climate.insects > 0) {
        this._beginCue('insect', now, climate.insects);
        const position = this._position(16, 28);
        let offset = 0;
        for (let pulse = 0; pulse < 4; pulse++) {
          const duration = between(0.05, 0.085);
          this._breath({ ...position, cutoff: between(2300, 3100),
            filterType: 'bandpass', Q: 0.8, duration, gain: 0.005 * daylight,
            attack: 0.014, decay: 0.015, sustain: 0.16, release: 0.025, when: now + offset });
          offset += duration + between(0.035, 0.065);
        }
      }
    }

    if (now >= this.nextBuzz) {
      this.nextBuzz = now + between(26, 43);
      if (climate.insects > 0) {
        this._beginCue('buzz', now, climate.insects);
        const position = this._position(7, 15);
        const pitch = between(140, 200);
        this._note({ bus: 'ambience', ...position, frequency: pitch,
          endFrequency: pitch * 0.9, type: 'triangle', cutoff: 650, Q: 0.4,
          duration: 0.4, gain: 0.0018, attack: 0.1, decay: 0.1,
          sustain: 0.18, release: 0.18, when: now });
        this._breath({ ...position, cutoff: 1600, filterType: 'bandpass', Q: 0.6,
          duration: 0.06, gain: 0.002, attack: 0.012,
          decay: 0.01, sustain: 0.15, release: 0.035, when: now + 0.38 });
      }
    }

    if (now >= this.nextRustle) {
      this.nextRustle = now + between(9, 17);
      if (wind > 0.45) {
        this._beginCue('rustle', now, climate.leaves);
        const position = this._position(10, 22);
        this._breath({ ...position, cutoff: 1250, filterType: 'bandpass', Q: 0.45,
          duration: between(1.1, 1.8), gain: 0.0025 * wind,
          attack: 0.35, decay: 0.3, sustain: 0.2, release: 0.6, when: now });
      }
    }
  }

  _stopVoices() {
    this.wind?.stop();
    this.leaves?.stop();
    this.water?.stop();
    this.wind = null;
    this.leaves = null;
    this.water = null;
    for (const note of this.notes) note.handle.stop();
    this.notes.length = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._stopVoices();
    this.context = null;
  }

  pause() {
    this._stopVoices();
    this.context = null;
  }
}

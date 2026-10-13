import { tone, noise, loopNoise, setParam } from './voices.js';
import { ASPECT } from '../world/world.js';

const clamp01 = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const between = (low, high) => low + Math.random() * (high - low);
// Each species has a different rhythm and pitch contour: rising peeps, a
// descending warble, and a two-part whistle. Offsets are deliberately uneven.
const BIRD_CALLS = [
  [[0, 0.065, 2100, 3800], [0.105, 0.045, 3300, 4400], [0.245, 0.09, 2800, 4000]],
  [[0, 0.14, 3400, 1900], [0.17, 0.07, 2300, 3100], [0.265, 0.11, 3100, 1750]],
  [[0, 0.11, 1800, 3000], [0.125, 0.065, 3000, 2600], [0.32, 0.19, 2600, 1500]],
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

  update({ time = 0, gust = 0, night = 0, water = null, fireflies = [] } = {}) {
    const context = this.engine.context;
    if (this.disposed || context?.state !== 'running') return;
    const now = context.currentTime;
    if (context !== this.context) {
      this._stopVoices();
      this.context = context;
      this.nextCricket = now + 0.8;
      this.nextShimmer = now + 1.5;
      this.nextBird = now + between(1.8, 4.5);
      this.nextOwl = now + between(5, 10);
      this.nextFrog = now + between(3.5, 7);
      this.nextAnimal = now + between(16, 28);
      this.nextInsect = now + between(4, 8);
      this.nextBuzz = now + between(8, 14);
      this.nextRustle = now + between(1.5, 4);
    }
    if (!this.wind) {
      this.wind = loopNoise(this.engine, { bus: 'ambience', cutoff: 450, gain: 0 });
    }
    if (!this.leaves) {
      this.leaves = loopNoise(this.engine, {
        bus: 'ambience', cutoff: 2300, filterType: 'highpass', gain: 0,
      });
    }
    if (!this.water && water) {
      // The route stays unpositioned; apply current spatial gain exactly once.
      this.water = loopNoise(this.engine, { bus: 'ambience', cutoff: 900, gain: 0 });
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
    const turbulence = 0.88 + 0.08 * Math.sin(clock * 1.7) + 0.04 * Math.sin(clock * 4.3);
    if (this.wind) {
      setParam(this.wind.gain.gain, (0.013 + wind * 0.045) * turbulence, now, 0.5);
      setParam(this.wind.filter.frequency, 220 + wind * 850 * turbulence, now, 0.5);
    }
    if (this.leaves) {
      setParam(this.leaves.gain.gain, (0.0006 + wind * wind * 0.0045) * turbulence, now, 0.35);
      setParam(this.leaves.filter.frequency, 2700 - wind * 1100, now, 0.5);
    }
    if (this.water) {
      let gain = 0;
      let pan = 0;
      if (water && Number.isFinite(water.x) && Number.isFinite(water.y)) {
        const spatial = this.engine.spatial(water.x, water.y);
        // Two gentle swells follow world time, like the visible shoreline.
        const lap = 0.7 + 0.2 * Math.sin(clock * 0.7) + 0.1 * Math.sin(clock * 1.31);
        gain = 0.075 * clamp01(water.strength) * spatial.gain * lap;
        pan = spatial.pan;
      }
      setParam(this.water.gain.gain, gain, now, 0.3);
      setParam(this.water.pan?.pan, pan, now, 0.15);
    }

    this._wildlife(now, daylight, darkness, water, wind);

    if (now >= this.nextCricket) {
      this.nextCricket = now + 1.4 + Math.random() * 2.4;
      if (darkness > 0.08) {
        const pitch = 3500 + Math.random() * 900;
        const position = this._position(8, 20);
        for (let chirp = 0; chirp < 3; chirp++) {
          const when = now + chirp * 0.09;
          this._note({
            bus: 'ambience', ...position, frequency: pitch, endFrequency: pitch * 0.96,
            type: 'sine', duration: 0.045, gain: 0.008 * darkness,
            attack: 0.006, when,
          }, when + 0.065);
        }
      }
    }

    if (now >= this.nextShimmer) {
      // Check the actual rendered pulse, then choose the nearest bright source.
      // Scanning happens at most twice a second, never allocating per frame.
      this.nextShimmer = now + 0.55;
      let nearest = null;
      let nearestGain = 0;
      let brightness = 0;
      for (const firefly of fireflies ?? []) {
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
        this.nextShimmer = now + 2.8 + Math.random() * 2;
        const pitch = 1100 + ((nearest.phase % (Math.PI * 2)) / (Math.PI * 2)) * 550;
        this._note({
          bus: 'ambience', x: nearest.x, y: nearest.y,
          frequency: pitch, endFrequency: pitch * 1.5,
          type: 'sine', duration: 0.5, gain: 0.009 * brightness,
          attack: 0.08, when: now,
        }, now + 0.52);
        this._note({
          bus: 'ambience', x: nearest.x, y: nearest.y,
          frequency: pitch * 2, endFrequency: pitch * 2.01,
          type: 'sine', duration: 0.35, gain: 0.003 * brightness,
          attack: 0.06, when: now + 0.06,
        }, now + 0.43);
      }
    }
  }

  _note(options, end) {
    if (this.notes.length >= 48) return;
    const handle = tone(this.engine, options);
    if (handle) this.notes.push({
      handle, end: end ?? (options.when ?? this.context.currentTime) + options.duration + 0.03,
    });
  }

  _breath(options) {
    if (this.notes.length >= 48) return;
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

  _wildlife(now, daylight, darkness, water, wind) {
    if (now >= this.nextBird) {
      this.nextBird = now + between(5.5, 11);
      if (daylight > 0.3) {
        const position = this._position(10, 27);
        const call = BIRD_CALLS[Math.floor(Math.random() * BIRD_CALLS.length)];
        const pitch = between(0.88, 1.12);
        const pace = between(0.85, 1.25);
        for (const [offset, duration, start, finish] of call) {
          this._note({
            bus: 'ambience', ...position, frequency: start * pitch,
            endFrequency: finish * pitch, type: 'sine', duration: duration * pace,
            gain: between(0.008, 0.012) * daylight, attack: 0.008,
            when: now + offset * pace,
          });
        }
        this._breath({
          ...position, cutoff: 3200, filterType: 'highpass', duration: 0.32 * pace,
          gain: 0.0008 * daylight, attack: 0.025, when: now,
        });
      }
    }

    if (now >= this.nextOwl) {
      this.nextOwl = now + between(18, 33);
      if (darkness > 0.55) {
        const position = this._position(22, 40);
        const pitch = between(280, 340);
        for (const [offset, duration, level] of [[0, 0.19, 0.8], [0.36, 0.5, 1]]) {
          this._note({
            bus: 'ambience', ...position, frequency: pitch, endFrequency: pitch * 0.85,
            type: 'sine', duration, gain: 0.013 * darkness * level,
            attack: 0.06, when: now + offset,
          });
          this._note({
            bus: 'ambience', ...position, frequency: pitch * 2.01,
            endFrequency: pitch * 1.72, type: 'sine', duration,
            gain: 0.002 * darkness * level, attack: 0.055, when: now + offset,
          });
        }
        this._breath({ ...position, cutoff: 600, duration: 0.8,
          gain: 0.003 * darkness, attack: 0.12, when: now });
      }
    }

    if (now >= this.nextFrog) {
      this.nextFrog = now + between(8, 17);
      if (water && Number.isFinite(water.x) && Number.isFinite(water.y)
          && clamp01(water.strength) > 0.18 && darkness > 0.2) {
        // Use the actual lake location; the voice route attenuates it once.
        const position = { x: water.x, y: water.y };
        const level = clamp01(water.strength) * darkness;
        const pitch = between(150, 230);
        for (const offset of [0, between(0.28, 0.45)]) {
          this._note({ bus: 'ambience', ...position, frequency: pitch,
            endFrequency: pitch * 0.65, type: 'triangle', duration: 0.16,
            cutoff: 800, gain: 0.011 * level, attack: 0.025, when: now + offset });
          this._breath({ ...position, cutoff: 650, filterType: 'bandpass',
            duration: 0.13, gain: 0.006 * level, attack: 0.03, when: now + offset });
        }
      }
    }

    if (now >= this.nextAnimal) {
      this.nextAnimal = now + between(32, 57);
      const position = this._position(32, 48);
      // A soft, distant deer-like nasal contact call, with a breathy ending.
      const pitch = between(220, 290);
      this._note({ bus: 'ambience', ...position, frequency: pitch,
        endFrequency: pitch * 0.72, type: 'triangle', cutoff: 950,
        duration: 0.65, gain: 0.008, attack: 0.12, when: now });
      this._note({ bus: 'ambience', ...position, frequency: pitch * 2.6,
        endFrequency: pitch * 1.95, type: 'sine', duration: 0.45,
        gain: 0.0025, attack: 0.07, when: now + 0.04 });
      this._breath({ ...position, cutoff: 800, filterType: 'bandpass',
        duration: 0.55, gain: 0.003, attack: 0.08, when: now + 0.12 });
    }

    if (now >= this.nextInsect) {
      this.nextInsect = now + between(11, 21);
      if (daylight > 0.4) {
        const position = this._position(7, 17);
        let offset = 0;
        for (let pulse = 0; pulse < 5; pulse++) {
          const duration = between(0.035, 0.065);
          this._breath({ ...position, cutoff: between(4500, 6500),
            filterType: 'bandpass', duration, gain: 0.009 * daylight,
            attack: 0.008, when: now + offset });
          offset += duration + between(0.015, 0.04);
        }
      }
    }

    if (now >= this.nextBuzz) {
      this.nextBuzz = now + between(15, 28);
      const position = this._position(3, 9);
      const pitch = between(160, 240);
      this._note({ bus: 'ambience', ...position, frequency: pitch,
        endFrequency: pitch * 0.8, type: 'sawtooth', cutoff: 1100,
        duration: 0.24, gain: 0.0028, attack: 0.055, when: now });
      this._breath({ ...position, cutoff: 2600, filterType: 'highpass',
        duration: 0.025, gain: 0.004, attack: 0.002, when: now + 0.26 });
    }

    if (now >= this.nextRustle) {
      this.nextRustle = now + between(5, 10);
      if (wind > 0.45) {
        const position = this._position(5, 15);
        this._breath({ ...position, cutoff: 2300, filterType: 'highpass',
          duration: between(0.55, 1.1), gain: 0.004 * wind,
          attack: 0.2, when: now });
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

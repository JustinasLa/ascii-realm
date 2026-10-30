import { GRADE_DAWN, GRADE_DAY, GRADE_DUSK, GRADE_NIGHT } from '../render/palette.js';

// The world's time of day. A day is 24000 ticks: 0 is sunrise, 6000 noon,
// 12000 sunset and 18000 midnight. From the tick come the sun's and moon's
// place in the sky, how bright the day is, the stars, and the moon's phase,
// which moves on one of eight steps each day, starting full.
//
// Night is the game's own look, so the clock spends more real time in it:
// the night half of the ticks takes NIGHT_SHARE of each real-time cycle.
// Only how fast ticks pass changes; the curves of light are the same.

export const TICKS = 24000;
// Real seconds per day, the share of them spent in the night half, and the
// tick a fresh world starts at: the first of full dark, with 12.5 minutes of
// night before dawn.
export const DAY_SECONDS = 1800;
export const NIGHT_SHARE = 0.6;
export const START_TICK = 14000;
export const MOON_PHASES = 8;
// How bright the moon is in each phase, from full through new and back.
export const MOON_BRIGHTNESS = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];
export const NAMED_TIMES = { day: 1000, noon: 6000, sunset: 12000, dusk: 12800, night: 13000,
  midnight: 18000, sunrise: 23000, dawn: 23200 };
// The limits of ?daylen=, in seconds.
const SHORTEST = 20;
const LONGEST = 86400;

const frac = (v) => v - Math.floor(v);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;

// The fraction of a real-time cycle reached at a tick, and back: the day
// half [0, 1 - share) holds ticks 0-12000, the rest of the cycle the night.
export function tickAt(f, share = NIGHT_SHARE) {
  const day = 1 - share;
  return f < day ? f / day * 12000 : 12000 + (f - day) / share * 12000;
}

export function fractionAt(tick, share = NIGHT_SHARE) {
  const t = frac(tick / TICKS) * TICKS;
  return t < 12000 ? t / 12000 * (1 - share) : 1 - share + (t - 12000) / 12000 * share;
}

// The sun's angle around the sky, as a fraction of a turn from noon.
export function celestial(tick) {
  const d = frac(tick / TICKS - 0.25);
  return (2 * d + 0.5 - Math.cos(d * Math.PI) / 2) / 3;
}

// How light the day is, 0 at full night to 1 at full day, and how bright
// the stars are, 1 at full night.
export function daylightAt(tick) {
  return clamp01(Math.cos(celestial(tick) * Math.PI * 2) * 2 + 0.5);
}

export function starlightAt(tick) {
  return clamp01(1 - (Math.cos(celestial(tick) * Math.PI * 2) * 2 + 0.25)) ** 2;
}

// A time from the URL: a tick, a named time or a clock time (06:00 is
// sunrise). Anything else is null.
export function parseTime(value) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (Object.hasOwn(NAMED_TIMES, text)) return NAMED_TIMES[text];
  if (/^\d+$/.test(text)) return Number(text) < TICKS ? Number(text) : null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!hm || Number(hm[1]) > 23 || Number(hm[2]) > 59) return null;
  return ((Number(hm[1]) + 18) % 24) * 1000 + Number(hm[2]) * 1000 / 60;
}

// The clock's settings from the page's URL. Everyone in a lobby shares one
// clock, so a lobby ignores them.
export function clockOptions(params, { inLobby = false } = {}) {
  const options = { dayLength: DAY_SECONDS, start: START_TICK, moon: 0, cycle: true };
  if (inLobby) return options;
  const length = Number(params.get('daylen'));
  if (params.has('daylen') && length > 0) options.dayLength = Math.min(LONGEST, Math.max(SHORTEST, length));
  options.start = parseTime(params.get('time')) ?? START_TICK;
  const moon = Number(params.get('moon'));
  if (Number.isInteger(moon) && moon >= 0 && moon < MOON_PHASES) options.moon = moon;
  options.cycle = params.get('daycycle') !== '0';
  return options;
}

function emptySky() {
  return { tick: 0, day: 0, daylight: 0, night: 0, stars: 0, moon: 0, sun: 0, warm: 0, dawn: false,
    moonPhase: { index: 0, cos: 1, sin: 0, waxing: false }, moonLit: 1, moonBrightness: 1,
    grade: { gain: [1, 1, 1], sat: 1, edge: [0, 0, 0], vignette: 0 } };
}

// Fills a sky state (see docs/architecture.md) for a tick, a day and a moon
// phase. The grade is how the renderer lights the finished night scene: at
// full night it is exactly the night's own, which changes nothing.
export function skyAt(tick, day, phase, out = emptySky()) {
  const daylight = daylightAt(tick);
  const night = 1 - daylight;
  const warm = 4 * daylight * night;
  const dawn = tick >= 18000 || tick < 6000;
  Object.assign(out, { tick, day, daylight, night, warm, dawn, stars: starlightAt(tick),
    // The moon is gone before the sun shows, so they never share the sky.
    moon: smoothstep(0.4, 0.8, night), sun: smoothstep(0.6, 0.95, daylight) });
  const angle = phase * Math.PI * 2 / MOON_PHASES;
  const p = out.moonPhase;
  p.index = phase;
  p.cos = Math.cos(angle);
  p.sin = Math.sin(angle);
  p.waxing = phase > MOON_PHASES / 2;
  out.moonLit = (1 + p.cos) / 2;
  out.moonBrightness = MOON_BRIGHTNESS[phase];
  // Night to day by the daylight, then toward dawn or dusk by the warmth,
  // which is 0 where the two meet, so the switch never shows.
  const tw = dawn ? GRADE_DAWN : GRADE_DUSK;
  const g = out.grade;
  const n = GRADE_NIGHT, d = GRADE_DAY;
  for (let i = 0; i < 3; i++) {
    g.gain[i] = lerp(lerp(n.gain[i], d.gain[i], daylight), tw.gain[i], warm);
    // Rounded as the shader's colour literals are, so the night's edges are
    // drawn to the bit as they were.
    g.edge[i] = Math.round(lerp(lerp(n.edge[i], d.edge[i], daylight), tw.edge[i], warm) / 255 * 1e4) / 1e4;
  }
  g.sat = lerp(lerp(n.sat, d.sat, daylight), tw.sat, warm);
  g.vignette = lerp(lerp(n.vignette, d.vignette, daylight), tw.vignette, warm);
  return out;
}

// Full night with a full moon: how the sky looked before it had a clock.
export const NIGHT_SKY = skyAt(18000, 0, 0);
for (const part of [NIGHT_SKY.moonPhase, NIGHT_SKY.grade.gain, NIGHT_SKY.grade.edge, NIGHT_SKY.grade, NIGHT_SKY]) {
  Object.freeze(part);
}

const realmStart = fractionAt(START_TICK);

export class WorldClock {
  constructor({ dayLength = DAY_SECONDS, start = START_TICK, moon = 0, cycle = true, nightShare = NIGHT_SHARE } = {}) {
    Object.assign(this, { dayLength, moon, cycle, nightShare });
    this.f = fractionAt(start, nightShare);
    this.days = 0;
    // A lobby's clock follows the wall clock, the same for everyone in it.
    this.shared = false;
    this.held = false;
    this.state = emptySky();
  }

  // Solo, the clock moves by the world's own step, so whatever holds the
  // world holds the time of day. Shared, it is worked out from the wall
  // clock each frame, whatever one player's world does. A held clock (a
  // frozen debug frame) stays put either way.
  advance(dt, nowMs) {
    if (this.held) return;
    if (this.shared) {
      this.#follow(nowMs);
      return;
    }
    if (!this.cycle || !(dt > 0)) return;
    this.f += dt / this.dayLength;
    if (this.f >= 1) {
      const whole = Math.floor(this.f);
      this.days += whole;
      this.f -= whole;
    }
  }

  hold(on) { this.held = !!on; }

  set(time) {
    const tick = typeof time === 'number' ? time : parseTime(time);
    if (tick !== null && Number.isFinite(tick)) this.f = fractionAt(tick, this.nightShare);
  }

  // Joining a lobby jumps to its time; leaving carries on from there.
  share(nowMs) {
    this.shared = true;
    this.#follow(nowMs);
  }

  unshare() { this.shared = false; }

  #follow(nowMs) {
    const cycles = nowMs / 1000 / DAY_SECONDS + realmStart;
    this.days = Math.floor(cycles);
    this.f = cycles - this.days;
  }

  get tick() { return tickAt(this.f, this.nightShare); }
  get day() { return this.days; }
  // A lobby's moon is the same for everyone: no ?moon= offset.
  get phase() { return (this.days + (this.shared ? 0 : this.moon)) % MOON_PHASES; }

  sky(out = this.state) { return skyAt(this.tick, this.days, this.phase, out); }
}

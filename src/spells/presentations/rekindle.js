// Rekindle: tongues of flame lick up out of the ground around the caster's
// feet and climb the body, gathering into an ember at the chest that flares
// white-gold. Each heal blooms from that ember as rising sparks and a few
// licks of flame; while the burn lasts the caster smoulders, small flames
// flickering at the feet and embers drifting up past the shoulders.
// Authored in screen space (counter-rotated by the heading) so flames always
// rise up the screen. Pure function of the effect clock.
const TAU = Math.PI * 2;
// Cells per local metre (SCALE / ASPECT across, SCALE * TILT down).
const COLS = 13 / 0.6, ROWS = 6.5;
// Heights above the feet, in local metres (screen up is negative z).
const CHEST = 2.4, HEAD = 3.4;
const WHITE = [255, 248, 228], GOLD = [255, 220, 120], ORANGE = [255, 138, 40],
  RED = [214, 58, 20], EMBER = [124, 30, 10];
const STOPS = [EMBER, RED, ORANGE, GOLD, WHITE];

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (i, seed = 0) => { const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return v - Math.floor(v); };
// 0 = dying ember, 1 = white-hot.
const heat = t => {
  t = clamp01(t) * 4;
  const k = Math.min(3, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, i) => c + (STOPS[k + 1][i] - c) * f);
};
// A flame tongue's glyph by its height along the tongue (0 = root, 1 = tip).
const tongue = u => u < 0.25 ? '(' : u < 0.5 ? ')' : u < 0.8 ? '^' : "'";
const spark = u => u < 0.25 ? '*' : u < 0.55 ? '+' : u < 0.8 ? "'" : '.';

// Flames licking up from the ground: each tongue is a short column of glyphs
// that sways as it climbs and fades towards its tip.
function flames(plot, { count, spread, height, age, fade, seed, hot = 0.6 }) {
  const frame = Math.floor(age * 18);
  for (let k = 0; k < count; k++) {
    const side = (k / Math.max(1, count - 1) - 0.5) * 2, x0 = side * spread + (hash(k, seed) - 0.5) * 0.12;
    const tall = height * (0.55 + 0.45 * hash(k + frame * 3, seed + 1)), rows = Math.max(2, Math.round(tall * ROWS));
    for (let j = 0; j < rows; j++) {
      const u = j / rows, sway = Math.sin(age * 9 + k * 1.7 + u * 3) * 0.06 * u;
      // Tongues lean in towards the body as they rise.
      const x = x0 * (1 - u * 0.35) + sway;
      plot(x, -j / ROWS, tongue(u), heat(hot + 0.35 * (1 - u) - 0.25 * u), fade * (1 - u * 0.6));
    }
  }
}

// Sparks and embers rising with a slow sideways drift from a point.
function embers(plot, { count, x0, z0, rise, age, p, fade, seed, width = 0.5 }) {
  for (let i = 0; i < count; i++) {
    const u = (p * (1.2 + hash(i, seed + 2) * 0.6) + hash(i, seed + 3)) % 1;
    const x = x0 + (hash(i, seed + 4) - 0.5) * width + Math.sin(age * 4 + i * 2.3) * 0.08 * u;
    plot(x, z0 - u * rise, spark(u), heat(1 - u * 0.9), fade * (1 - u) * (0.6 + 0.4 * hash(i + Math.floor(age * 20), seed + 5)));
  }
}

// The cast: flames climb from the feet to the chest and the ember flares.
function kindle(plot, age, p, seed) {
  const fade = Math.min(1, (1 - p) * 3.5), climb = smooth(0, 0.55, p);
  flames(plot, { count: 7, spread: 0.55, height: 0.35 + climb * 0.9, age, fade: fade * smooth(0, 0.12, p), seed });
  // Ribbons of flame spiral up the body to the chest.
  for (let r = 0; r < 2; r++) {
    for (let j = 0; j < 14; j++) {
      const u = j / 14;
      if (u > climb) break;
      const a = u * TAU * 1.2 + r * Math.PI + age * 5, w = 0.42 * (1 - u * 0.5);
      plot(Math.sin(a) * w, -u * CHEST, Math.cos(a) > 0 ? '(' : ')', heat(0.45 + 0.5 * u), fade * (0.5 + 0.5 * u));
    }
  }
  // The ember at the chest gathers, then flares white-gold.
  const flare = smooth(0.45, 0.6, p) * (1 - smooth(0.6, 0.95, p));
  plot(0, -CHEST, flare > 0.4 ? '@' : climb > 0.6 ? '*' : '+', heat(0.6 + 0.4 * Math.max(flare, climb * 0.5)), fade * (0.4 + 0.6 * climb));
  if (flare > 0.05) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + hash(i, seed + 6) * 0.4, r = 0.25 + 0.45 * smooth(0.45, 0.8, p);
      plot(Math.sin(a) * r * 1.3, -CHEST + Math.cos(a) * r * 0.6, i & 1 ? "'" : '*', heat(0.9), flare * fade);
    }
  }
  embers(plot, { count: 8, x0: 0, z0: -CHEST, rise: 1.4, age, p, fade: fade * smooth(0.4, 0.6, p), seed });
}

// One heal: sparks bloom from the chest ember and a few flames lick upward.
function bloom(plot, age, p, seed) {
  const fade = Math.min(1, (1 - p) * 2.5);
  plot(0, -CHEST, p < 0.3 ? '@' : '*', heat(1 - p * 0.6), fade);
  embers(plot, { count: 14, x0: 0, z0: -CHEST + 0.3, rise: 1.6, age, p, fade, seed, width: 0.9 });
  // A short warm cross marks the heal itself.
  const cross = 1 - smooth(0.2, 0.6, p);
  if (cross > 0.02) {
    plot(-1 / COLS, -CHEST, '-', GOLD, cross * fade); plot(1 / COLS, -CHEST, '-', GOLD, cross * fade);
    plot(0, -CHEST - 1 / ROWS, '|', GOLD, cross * fade); plot(0, -CHEST + 1 / ROWS, '|', GOLD, cross * fade);
  }
  flames(plot, { count: 4, spread: 0.4, height: 0.5 * (1 - p), age, fade: fade * 0.8, seed: seed + 7, hot: 0.5 });
}

// The lingering burn: low flickers at the feet and embers past the shoulders.
function smoulder(plot, age, p, seed) {
  const fade = Math.min(1, (1 - p) * 3) * smooth(0, 0.1, p);
  flames(plot, { count: 5, spread: 0.5, height: 0.3, age, fade: fade * 0.75, seed, hot: 0.4 });
  embers(plot, { count: 10, x0: 0, z0: -1.2, rise: HEAD - 0.6, age, p: age * 0.6, fade, seed: seed + 8, width: 1 });
}

// Generic visuals: a short scatter of embers at the configured size.
function scatter(plot, effect, age, p, seed) {
  const R = Math.max(0.3, Math.min(3, effect.radius)), fade = Math.min(1, (1 - p) * 3);
  for (let i = 0; i < 14; i++) {
    const a = hash(i, seed + 9) * TAU, r = R * (0.2 + 0.8 * smooth(0, 0.7, p)) * (0.6 + 0.4 * hash(i, seed + 10));
    plot(Math.sin(a) * r, Math.cos(a) * r * 0.5 - p * 0.6, spark(p), heat(1 - p), fade * (0.5 + 0.5 * hash(i + Math.floor(age * 20), seed)));
  }
}

export default {
  id: 'rekindle', duration: 0.7,
  draw(effect, draw) {
    const p = clamp01(Number.isFinite(effect.progress) ? effect.progress : 0);
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
    const c = Math.cos(heading), s = Math.sin(heading);
    const seed = ((Number.isFinite(effect.x) ? effect.x * 0.37 : 0) + (Number.isFinite(effect.y) ? effect.y * 1.13 : 0)) % 97;
    // Undo the adapter's heading rotation so flames rise straight up the screen.
    const plot = (x, z, char, color, brightness) => {
      if (brightness > 0.01) draw(x * c - z * s, x * s + z * c, char, color, Math.min(1, brightness));
    };
    switch (effect.stage) {
      case 'impact': return bloom(plot, age, p, seed);
      case 'aura': return smoulder(plot, age, p, seed);
      case 'cast': return kindle(plot, age, p, seed);
      default: return scatter(plot, effect, age, p, seed);
    }
  },
  sounds: {
    // A charcoal breath gathers under a strained low hum; two tiny ember
    // fractures precede the chest's first restored, heavy beat.
    cast: [
      { kind: 'noise', duration: 0.92, gain: 0.075, cutoff: 520, filterType: 'bandpass', Q: 0.65, playbackRate: 0.67, attack: 0.23, decay: 0.2, sustain: 0.48, release: 0.4 },
      { kind: 'tone', type: 'triangle', frequency: 91, endFrequency: 113, duration: 0.86, gain: 0.045, cutoff: 290, filterType: 'lowpass', attack: 0.2, decay: 0.14, sustain: 0.55, release: 0.4 },
      { kind: 'noise', delay: 0.16, duration: 0.085, gain: 0.035, cutoff: 1780, filterType: 'bandpass', Q: 1.3, attack: 0.004, decay: 0.016, sustain: 0.12, release: 0.055 },
      { kind: 'noise', delay: 0.33, duration: 0.12, gain: 0.026, cutoff: 1220, filterType: 'bandpass', Q: 1.1, attack: 0.006, decay: 0.025, sustain: 0.18, release: 0.075 },
      { kind: 'tone', type: 'sine', delay: 0.4, frequency: 83, endFrequency: 49, duration: 0.43, gain: 0.08, attack: 0.018, decay: 0.075, sustain: 0.27, release: 0.28 },
    ],
    // Each heal answers with a subdued two-part heartbeat and a breath of
    // ash. Short enough to clear before the next one-second healing tick.
    impact: [
      { kind: 'tone', type: 'sine', frequency: 92, endFrequency: 53, duration: 0.31, gain: 0.065, attack: 0.012, decay: 0.06, sustain: 0.25, release: 0.2 },
      { kind: 'tone', type: 'triangle', delay: 0.15, frequency: 71, endFrequency: 47, duration: 0.3, gain: 0.038, cutoff: 190, filterType: 'lowpass', attack: 0.017, decay: 0.05, sustain: 0.23, release: 0.2 },
      { kind: 'noise', delay: 0.025, duration: 0.49, gain: 0.04, cutoff: 480, filterType: 'lowpass', playbackRate: 0.7, attack: 0.045, decay: 0.1, sustain: 0.34, release: 0.29 },
      { kind: 'noise', delay: 0.075, duration: 0.075, gain: 0.018, cutoff: 1430, filterType: 'bandpass', Q: 0.8, attack: 0.003, decay: 0.012, sustain: 0.1, release: 0.05 },
    ],
    // Repeated residual embers: faint breathing and one muffled coal crack.
    pulse: [
      { kind: 'noise', duration: 0.32, gain: 0.018, cutoff: 390, filterType: 'lowpass', playbackRate: 0.65, attack: 0.065, decay: 0.055, sustain: 0.3, release: 0.17 },
      { kind: 'tone', type: 'sine', delay: 0.035, frequency: 61, endFrequency: 52, duration: 0.28, gain: 0.012, attack: 0.045, decay: 0.045, sustain: 0.3, release: 0.16 },
      { kind: 'noise', delay: 0.12, duration: 0.065, gain: 0.009, cutoff: 930, filterType: 'bandpass', Q: 0.8, attack: 0.003, decay: 0.01, sustain: 0.12, release: 0.045 },
    ],
  },
};

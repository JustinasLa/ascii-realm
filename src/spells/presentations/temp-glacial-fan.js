// Glacial Fan: frost motes gather, five faceted ice blades sweep open left to
// right and are hurled one by one (matching the staggered gameplay volley),
// leaving drifting rime. Shots are slender shards with a shimmering frost wake;
// hits flash white, sprout a crystal starburst and shatter into tumbling chips.
const DURATION = 1.05;
// Deep frost -> glacier blue -> ice -> white-hot flash.
const RAMP = [[38, 84, 170], [56, 128, 210], [84, 178, 242], [124, 214, 255],
  [168, 234, 255], [212, 247, 255], [255, 255, 255]];
const tone = v => RAMP[Math.round(Math.min(1, Math.max(0, v)) * 6)];
const DENSE = '.:+*#@';
const dense = v => DENSE[Math.round(Math.min(1, Math.max(0, v)) * 5)];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = t => (t = clamp01(t)) * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeBack = t => { t = clamp01(t) - 1; return 1 + 2.4 * t * t * t + 1.4 * t * t; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// Heading only selects which slash reads best on screen; geometry stays local.
let hc = 1, hs = 0;
function slope(dx, dz) {
  const x = dx * hc + dz * hs, y = (dz * hc - dx * hs) * 0.5; // a metre down-screen is half as many pixels
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ay < ax * 0.42) return '-';
  if (ay > ax * 2.4) return '|';
  return (x > 0) === (y > 0) ? '\\' : '/';
}

// A faceted shard from (ox, oz) along `ang`: widest a third of the way out,
// pointed tip, bright spine, slope-aware edges and a sparse frosted fill.
// `from` hides the part nearest the base so a released blade thins away.
function shard(plot, ox, oz, ang, len, wid, b, heat, k, from = 0, fill = true) {
  if (b <= 0 || len <= 0.02) return;
  const ux = Math.sin(ang), uz = Math.cos(ang), nx = uz, nz = -ux;
  const spine = slope(ux, uz);
  for (let j = Math.ceil(from * k); j <= k; j++) {
    const t = j / k, cx = ox + ux * len * t, cz = oz + uz * len * t, v = b * (0.62 + 0.38 * t);
    if (j === k) { plot(cx, cz, '*', tone(heat + 0.5), b); break; }
    const w = wid * (t < 0.32 ? 0.45 + t * 1.72 : (1 - t) / 0.68), dw = wid * (t < 0.32 ? 1.72 : -1 / 0.68);
    plot(cx, cz, spine, tone(heat + 0.28), v);
    for (let side = -1; side <= 1; side += 2) {
      plot(cx + nx * w * side, cz + nz * w * side,
        slope(ux * len + nx * dw * side, uz * len + nz * dw * side), tone(heat), v * 0.82);
      if (fill && j % 2 === 0 && t > 0.15 && t < 0.75) {
        plot(cx + nx * w * 0.5 * side, cz + nz * w * 0.5 * side, ':', tone(heat - 0.2), v * 0.42);
      }
    }
  }
}

function cast(plot, p) {
  const t = p * DURATION, master = 1 - smooth((p - 0.8) / 0.2), fx = 0, fz = 0.3;
  // Five blades, matching the -45..45 degree volley that leaves left to right.
  for (let i = 0; i < 5; i++) {
    const ang = (i - 2) * Math.PI / 8, g0 = 0.06 + 0.03 * i, release = 0.21 + 0.11 * i;
    const grow = (t - g0) / 0.13;
    if (grow <= 0) continue;
    const len = 2.1 * easeBack(grow), tau = t - release, r0 = 0.32;
    const ux = Math.sin(ang), uz = Math.cos(ang);
    if (tau < 0) {
      // Freshly grown ice glows white, then cools; a glint runs up the spine.
      const heat = 0.32 + 0.6 * (1 - smooth((t - g0 - 0.08) / 0.16));
      shard(plot, ux * r0, uz * r0, ang, len, 0.2, master, heat, 10);
      const g = clamp01((t - g0 - 0.1) / Math.max(0.05, release - g0 - 0.1));
      if (g > 0 && g < 1) plot(ux * (r0 + len * g), uz * (r0 + len * g), '*', RAMP[6], master * Math.sin(g * Math.PI));
    } else if (tau < 0.24) {
      // Released: the blade accelerates outward, flashes and thins from its base.
      const d = 9 * tau * tau + 3 * tau, fade = 1 - smooth(tau / 0.24);
      shard(plot, ux * (r0 + d), uz * (r0 + d), ang, len, 0.2 * (1 - tau * 1.5), master * fade,
        0.85 - tau * 2, 10, smooth(tau / 0.2), false);
      if (tau < 0.12) plot(ux * r0, uz * r0, tau < 0.05 ? '@' : '*', RAMP[6], master * (1 - tau / 0.12));
    }
    // Rime shed by the release drifts on with drag and a little turbulence.
    if (tau > 0) {
      for (let m = 0; m < 6; m++) {
        const h = hash(i * 13 + m), h2 = hash(i * 29 + m * 3 + 1), life = 0.4 + 0.25 * h2;
        if (tau > life) continue;
        const along = r0 + 2.1 * (0.15 + 0.75 * h) + (0.6 + 1.4 * h2) * (1 - Math.exp(-3 * tau)) / 3;
        const side = (h2 - 0.5) * 0.36 + Math.sin(tau * 6 + m * 2.1) * 0.06 * (1 + tau * 4);
        const b = master * 0.75 * (1 - tau / life) ** 1.5 * smooth(tau / 0.05) * (0.75 + 0.25 * Math.sin(tau * 22 + m));
        plot(ux * along + uz * side, uz * along - ux * side, h > 0.6 ? '+' : h > 0.25 ? '.' : "'", tone(0.55 - tau), b);
      }
    }
  }
  // Anticipation: frost motes spiral into a crystal seed in front of the caster.
  if (t < 0.13) {
    const e = (t / 0.13) ** 2, b = master * smooth(t / 0.04) * (1 - smooth((t - 0.09) / 0.04));
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2 + (1 - e) * 1.8, r = 0.12 + (1 - e) * (0.8 + 0.4 * hash(k));
      plot(fx + Math.sin(a) * r, fz + Math.cos(a) * r, e < 0.4 ? '.' : e < 0.75 ? '+' : '*', tone(0.35 + 0.55 * e), b * (0.5 + 0.5 * e));
    }
  }
  const core = smooth(t / 0.12) * (1 - smooth((t - 0.2) / 0.2)) * master;
  if (core > 0.02) {
    plot(fx, fz, dense(core), tone(0.6 + core * 0.4), core);
    if (core > 0.45) for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + t * 3;
      plot(fx + Math.sin(a) * 0.14, fz + Math.cos(a) * 0.14, '+', tone(0.7), core * 0.6);
    }
  }
  // A bowed rime arc links the blade roots, sweeping in then melting away.
  for (let j = 0; j < 13; j++) {
    const a = -0.95 + j * 0.158, on = smooth((t - 0.06 - j * 0.008) / 0.06);
    const b = master * on * 0.55 * (1 - smooth((t - 0.55) / 0.3));
    if (b > 0) plot(Math.sin(a) * 0.3, Math.cos(a) * 0.3, slope(Math.cos(a), -Math.sin(a)), tone(0.3), b);
  }
}

function projectile(plot, p, age) {
  const fade = 1 - smooth((p - 0.78) / 0.22), grow = 0.6 + 0.4 * easeOut(age / 0.06);
  shard(plot, 0, -0.32 * grow, 0, 0.9 * grow, 0.12, fade, 0.45, 7, 0, false);
  // Frost wake: motes stream backwards, widening, each fading in and out of its cycle.
  for (let j = 0; j < 16; j++) {
    const h = hash(j + 3), c = (age * 3.2 + h) % 1, z = -0.38 - c * 1.1;
    const x = (h - 0.5) * 0.08 * (1 + c * 4) + Math.sin(age * 15 + j * 1.9) * 0.03 * c;
    plot(x, z, c < 0.35 ? ':' : c < 0.7 ? '.' : "'", tone(0.55 - c * 0.5), fade * Math.sin(c * Math.PI) * (0.85 - c * 0.45));
  }
}

function impact(plot, p, radius) {
  const R = radius, master = 1 - smooth((p - 0.75) / 0.25);
  // White flash: dense core with a cooling halo.
  const flash = 1 - smooth(p / 0.3);
  if (flash > 0) {
    plot(0, 0, '@', RAMP[6], flash);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3 + 0.3;
      plot(Math.sin(a) * 0.1 * R, Math.cos(a) * 0.1 * R, '#', tone(0.75 + flash * 0.25), flash * 0.85);
    }
  }
  // Crystal starburst biased along the shot's travel, then shattered into chips.
  for (let k = 0; k < 8; k++) {
    const h = hash(k + 41), a = k * Math.PI / 4 + (h - 0.5) * 0.4;
    const len = R * (0.45 + 0.5 * Math.max(0, Math.cos(a))) * (0.85 + 0.3 * h);
    const ux = Math.sin(a), uz = Math.cos(a);
    // The spikes crack from the root outward while their chips take over.
    const crack = smooth((p - 0.24) / 0.12);
    if (crack < 1) {
      shard(plot, ux * 0.12 * R, uz * 0.12 * R, a, len * easeBack(p / 0.12), 0.07 * R, master * (0.7 + 0.3 * flash) * (1 - crack),
        0.4 + flash * 0.6, 5, crack, false);
    }
    if (p < 0.24) continue;
    const tau = (p - 0.24) * 0.6; // seconds of chip flight at the default life
    for (let c = 0; c < 5; c++) {
      const hc2 = hash(k * 7 + c), s = 0.2 + 0.8 * c / 4, v = (1.2 + 2.4 * hc2) * R;
      const d = len * s + 0.12 * R + v * (1 - Math.exp(-4 * tau)) / 4, spread = (hc2 - 0.5) * 0.5 * tau;
      const spin = Math.floor(tau * (8 + 10 * hc2) + hc2 * 4) % 4;
      plot(Math.sin(a + spread) * d, Math.cos(a + spread) * d, '/-\\|'[spin], tone(0.62 - tau * 0.9),
        master * smooth(tau / 0.04) * (1 - smooth(tau / (0.35 + 0.1 * hc2))));
    }
  }
  // Expanding rime ring on the ground.
  const ring = R * (0.25 + 1.05 * easeOut(p / 0.8)), rb = master * 0.6 * (1 - p) ** 1.4 * smooth(p / 0.06);
  for (let k = 0; k < 22; k++) {
    const a = k / 22 * Math.PI * 2 + hash(k) * 0.15, r = ring * (0.94 + 0.12 * hash(k + 9));
    plot(Math.sin(a) * r, Math.cos(a) * r, hash(k + 5) > 0.5 ? '.' : ':', tone(0.4 - p * 0.3), rb);
  }
}

// Glacial Spikes: short crystals erupt in the gaps between the fan's blades.
function pulse(plot, p, radius) {
  const R = Math.max(0.4, radius), master = 1 - smooth((p - 0.55) / 0.45);
  for (let k = 0; k < 8; k++) {
    const a = (k - 3.5) * Math.PI / 8, h = hash(k + 71), rise = easeBack((p - k * 0.02) / 0.25);
    const base = R * 0.25, len = R * (0.22 + 0.13 * h) * rise;
    shard(plot, Math.sin(a) * base, Math.cos(a) * base, a, len, 0.06 * R, master,
      0.35 + 0.5 * (1 - smooth(p / 0.4)), 3, smooth((p - 0.6) / 0.4), false);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k - 4.5) * 0.36, r = R * (0.2 + 0.1 * easeOut(p));
    plot(Math.sin(a) * r, Math.cos(a) * r, '.', tone(0.3), master * 0.5 * smooth(p / 0.1));
  }
}

// Lingering frost (unused by the rune today): a slowly turning crown of shards.
function crown(plot, p, age, radius) {
  const R = Math.min(3, Math.max(0.6, radius)), b = smooth(p / 0.15) * (1 - smooth((p - 0.8) / 0.2));
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + age * 0.6;
    shard(plot, Math.sin(a) * R * 0.55, Math.cos(a) * R * 0.55, a, R * 0.35, 0.08 * R, b, 0.35, 3, 0, false);
  }
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2 - age * 0.4, r = R * (0.4 + 0.08 * Math.sin(age * 2 + k));
    plot(Math.sin(a) * r, Math.cos(a) * r, k % 2 ? '.' : ':', tone(0.3), b * (0.4 + 0.2 * Math.sin(age * 5 + k * 1.7)));
  }
}

export default {
  id: 'temp-glacial-fan',
  duration: DURATION,
  draw(effect, plot) {
    hc = Math.cos(effect.heading || 0); hs = Math.sin(effect.heading || 0);
    const p = effect.progress;
    if (effect.stage === 'cast') return cast(plot, p);
    if (effect.stage === 'projectile') return projectile(plot, p, effect.age);
    if (effect.stage === 'impact') return impact(plot, p, effect.radius);
    if (effect.stage === 'pulse') return pulse(plot, p, effect.radius);
    return crown(plot, p, effect.age, effect.radius);
  },
  sounds: {
    cast: [
      // Three shorter, closer swishes make the unfolding fan audibly accelerate.
      { kind: 'noise', delay: 0, duration: 0.22, gain: 0.065, cutoff: 1500, filterType: 'bandpass', attack: 0.055, release: 0.12 },
      { kind: 'noise', delay: 0.23, duration: 0.17, gain: 0.075, cutoff: 2400, filterType: 'bandpass', attack: 0.035, release: 0.1 },
      { kind: 'noise', delay: 0.38, duration: 0.12, gain: 0.085, cutoff: 3700, filterType: 'highpass', attack: 0.018, release: 0.085 },
      { kind: 'tone', type: 'triangle', frequency: 460, endFrequency: 920, delay: 0.02, duration: 0.44, gain: 0.025, attack: 0.06, release: 0.16 },
    ],
    impact: [
      { kind: 'noise', duration: 0.14, gain: 0.105, cutoff: 4600, filterType: 'highpass', attack: 0.002, release: 0.13 },
      { kind: 'tone', type: 'triangle', frequency: 622, endFrequency: 540, duration: 0.36, gain: 0.05, attack: 0.003, release: 0.3 },
      { kind: 'tone', type: 'sine', frequency: 932, endFrequency: 854, delay: 0.012, duration: 0.4, gain: 0.04, attack: 0.003, release: 0.32 },
      { kind: 'tone', type: 'triangle', frequency: 1480, endFrequency: 1250, delay: 0.026, duration: 0.3, gain: 0.028, attack: 0.002, release: 0.26 },
      { kind: 'noise', delay: 0.075, duration: 0.25, gain: 0.03, cutoff: 2600, filterType: 'bandpass', attack: 0.004, release: 0.23 },
    ],
    pulse: [{ kind: 'noise', duration: 0.055, gain: 0.018, cutoff: 3300, filterType: 'highpass', attack: 0.003, release: 0.045 }],
  },
};

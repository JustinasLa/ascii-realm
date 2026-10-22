import { hash2 } from '../core/rng.js';
import { valueNoise } from '../core/noise.js';
import { glyph } from '../render/glyphs.js';

const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
const mod = (x, n) => ((x % n) + n) % n;
const LIGHT = [-0.66, 0.8, -0.5].map(x => x / Math.hypot(0.66, 0.8, 0.5));
// Real letters, varying in occupied area as well as luminance, as in the reference.
const LETTERS = [".,`':-", 'i!~;:+=', 'zsvr*co+-', 'aduoQ0bce', 'B8ROQW%&', 'NMW@#8B'];

export function shadeArchitecture(hit, seed) {
  const { point: [x, h, z], normal: n, material: m } = hit;
  const grain = hash2(Math.floor(x * 5.7 + z * 2.3), Math.floor(h * 5.1 - z * 1.8), seed + 7);
  const erosion = valueNoise(x * 1.4 + z * 0.6, h * 1.4, seed + 31) - 0.5;
  const mineral = valueNoise(x * 0.35 + z * 0.2, h * 0.3, seed + 18) - 0.5;
  let light = Math.max(0, n.reduce((sum, v, i) => sum + v * LIGHT[i], 0));
  light = clamp(light * (m.shade ?? 1) + erosion * 0.09);
  let brightness = (32 + 290 * light ** 0.92) * (0.77 + 0.23 * clamp(h / 1.5));
  const along = Math.abs(n[0]) > 0.8 ? z : x;
  const course = Math.floor(h / 3.4);
  if (m.courses && !m.bevel && n[1] < 0.3 && (mod(h, 3.4) < 0.075
    || mod(along + (course % 2) * 2.6, 5.2) < 0.06)) {
    brightness *= 0.67; light *= 0.7;
  }
  if (m.arch && n[2] < -0.9) {
    const angle = Math.atan2(h - m.arch.h, x - m.arch.x);
    const distance = Math.hypot(x - m.arch.x, h - m.arch.h);
    if (Math.min(Math.abs(angle - m.arch.a), Math.abs(angle - m.arch.b)) * distance < 0.06) {
      brightness *= 0.55; light *= 0.6;
    }
  }
  if (m.shaft && mod(h - 3, 9.5) < 0.07) brightness *= 0.72;
  if (m.slits && n[2] < -0.9 && Math.abs(x - m.slits.x) < 0.34
    && m.slits.levels.some(level => Math.abs(h - level) < 1.9)) {
    brightness = 18; light = 0;
  }
  brightness = clamp(brightness * (0.94 + grain * 0.12 + mineral * 0.16) * (m.tone ?? 1), 14, 248);
  const tone = clamp(light + (grain - 0.5) * 0.12);
  const level = tone < 0.12 ? 0 : tone < 0.24 ? 1 : tone < 0.38 ? 2 : tone < 0.5 ? 3 : tone < 0.65 ? 4 : 5;
  const letters = LETTERS[level];
  return { m: 'plain', l: light, k: 1, g: glyph(letters[Math.floor(grain * letters.length)]),
    c: [brightness * 0.95, brightness * 0.98, brightness], back: 0.032 };
}

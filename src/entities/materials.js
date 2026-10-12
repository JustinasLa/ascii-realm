import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';

// What the warrior is made of. Each material has a base colour and a texture
// that picks the glyph for a fully covered cell from its lighting and from
// where on the part the cell lies (u along the part in rows, v across it in
// -1..1), so seams, rivets, rings and emblems stick to the body as it moves
// rather than to the grid.
//
// A texture is called as tex(l, u, v, s) and returns the glyph. It may also
// change s.c (the colour) and s.k (the brightness, roughly 0..1.2) to paint
// details in another colour, such as brass inlay on steel.

const G = (s) => [...s].map(glyph);

const PLATE = G(':;+=#%@');
const SEAM = G('-=');
const RIVET = glyph('o');
const SCRATCH = G('/\\');
const MAIL = G('.o08');
const CLOTH = G(" .:;i!|");
const LEATHER = G('-=+#');
const STITCH = glyph(':');
const BONE = G('.:o0O@');
const TRIM = G(':-==#');
const GLOW = G('*');
const STAR = glyph('*');
const BAR = { v: glyph('|'), h: glyph('-'), x: glyph('+'), d: glyph('<'), e: glyph('>') };

const BRASS = [196, 164, 100];
const BRIGHT_BRASS = [232, 200, 128];

const pick = (ramp, l) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(l * ramp.length)))];
const frac = (x) => x - Math.floor(x);

// Steel is never quite even: hammer marks and wear brighten and darken it in
// broad patches, and a few fine scratches catch the light.
function wear(u, v, s) {
  s.k *= 0.86 + 0.28 * valueNoise(u * 0.7 + 3.1, v * 2.2 + 7.7, 811);
}

// Plate armour: shaded steel cut into horizontal lames joined by rows of
// rivets, with a glint where the moon catches it squarely.
function plate(l, u, v, s) {
  wear(u, v, s);
  if (l > 0.97) return STAR;
  if (frac(u * 0.55) < 0.14) {
    // Rivets punctuate each seam.
    if (frac(v * 2.4 + 0.5) < 0.22) {
      s.k = 0.6 + l * 0.7;
      return RIVET;
    }
    return SEAM[l > 0.55 ? 1 : 0];
  }
  const h = hash2(Math.floor(u * 2.5), Math.floor(v * 6), 97);
  if (h > 0.965 && l > 0.45) {
    s.k *= 1.15;
    return SCRATCH[h > 0.982 ? 1 : 0];
  }
  return pick(PLATE, l);
}

// The breastplate: plate with a brass chevron inlaid down the middle and a
// raised ridge along the centre line.
function breastplate(l, u, v, s) {
  const av = Math.abs(v);
  // Two arms of a chevron, pointing down, repeated twice.
  const chevron = frac(u * 0.42 - av * 0.9);
  if (av < 0.75 && chevron < 0.11) {
    s.c = BRASS;
    s.k = 0.55 + l * 0.6;
    return v < 0 ? glyph('\\') : glyph('/');
  }
  if (av < 0.07) {
    s.k = 0.5 + l * 0.75;
    return BAR.v;
  }
  return plate(l, u, v, s);
}

// Mail: offset rows of rings.
function mail(l, u, v, s) {
  wear(u, v, s);
  const row = Math.floor(u * 1.3);
  if (l < 0.25) return MAIL[0];
  return (row + Math.floor(v * 3)) & 1 ? MAIL[l > 0.7 ? 3 : 2] : MAIL[1];
}

// Cloth: dark, with vertical folds that run down the part.
function cloth(l, u, v) {
  const fold = Math.sin(v * 5.5 + u * 0.12);
  if (fold > 0.82 && l > 0.3) return CLOTH[6];
  return pick(CLOTH, l * 0.85);
}

// The tabard bears the warrior's sigil in brass thread: a downward sword
// inside a diamond, with a hem of brass at the bottom.
function tabard(l, u, v, s) {
  const av = Math.abs(v);
  const thread = (g) => {
    s.c = BRIGHT_BRASS;
    s.k = 0.45 + l * 0.55;
    return g;
  };
  // Measured in rows from the belt.
  const y = u - 1.2;
  if (y > 0 && y < 4.6) {
    // The diamond's outline.
    const d = Math.abs(y - 2.3) / 2.3 + av / 0.62;
    if (Math.abs(d - 1) < 0.12) return thread(y < 2.3 === v < 0 ? glyph('/') : glyph('\\'));
    // Crossguard, then blade.
    if (Math.abs(y - 1.3) < 0.3 && av < 0.36) return thread(av < 0.08 ? BAR.x : BAR.h);
    if (y > 0.5 && y < 3.9 && av < 0.07) return thread(BAR.v);
  }
  return cloth(l, u, v);
}

// Leather with a line of stitching along each edge.
function leather(l, u, v) {
  if (Math.abs(v) > 0.72 && frac(u * 1.5) < 0.5) return STITCH;
  return pick(LEATHER, l);
}

// Horn, ringed with growth bands.
function horn(l, u, v, s) {
  if (frac(u * 1.6) < 0.2) {
    s.k *= 0.7;
    return glyph('=');
  }
  return pick(BONE, l);
}

export const MATERIALS = {
  plate: { color: [104, 112, 132], tex: plate },
  breastplate: { color: [108, 116, 136], tex: breastplate },
  darkPlate: { color: [68, 74, 92], tex: plate },
  mail: { color: [86, 92, 108], tex: mail },
  cloth: { color: [46, 50, 66], tex: cloth },
  crimson: { color: [138, 36, 42], tex: cloth },
  tabard: { color: [138, 36, 42], tex: tabard },
  // The cape's dark inner face, seen when it swings round towards the camera.
  lining: { color: [62, 22, 30], tex: cloth },
  leather: { color: [98, 68, 46], tex: leather },
  trim: { color: [184, 154, 96], tex: (l) => pick(TRIM, l) },
  horn: { color: [196, 186, 156], tex: horn },
  skin: { color: [150, 118, 96], tex: (l) => pick(BONE, l * 0.8) },
  // The dark slit of a visor.
  void: { color: [10, 10, 16], tex: () => 0 },
  // Lights that ignore the moon: they are drawn at full brightness.
  eye: { color: [150, 235, 255], tex: () => GLOW[0], emissive: true, claim: true },
  // Bare steel is drawn as a line along the blade. Like the eyes it claims
  // every cell it touches, as it is far thinner than a cell.
  blade: { color: [206, 214, 228], tex: null, claim: true },
};

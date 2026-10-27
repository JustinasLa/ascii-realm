import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';

// What the outlaw is made of. Each material has a base colour and a texture
// that picks the glyph for a fully covered cell from its lighting and from
// where on the part the cell lies (u along the part in rows, v across it in
// -1..1), so folds, lacing, stitching and grain stick to the body as it
// moves rather than to the grid.
//
// A texture is called as tex(l, u, v, s) and returns the glyph. It may also
// change s.c (the colour) and s.k (the brightness, roughly 0..1.2) to paint
// details in another colour, such as lacing on a jerkin.

const G = (s) => [...s].map(glyph);

const IRON = G(':;+=#%@');
const SCRATCH = G('/\\');
const WOOL = G(':;=+*#%');
const LEATHER = G('-=+#');
const STITCH = glyph(':');
const SKIN = G('.:o0O@');

const LACE = [70, 48, 30];

const pick = (ramp, l) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(l * ramp.length)))];
const frac = (x) => x - Math.floor(x);

// Iron fittings: unevenly worn, with the odd fine scratch catching the light.
function iron(l, u, v, s) {
  s.k *= 0.86 + 0.28 * valueNoise(u * 0.7 + 3.1, v * 2.2 + 7.7, 811);
  const h = hash2(Math.floor(u * 2.5), Math.floor(v * 6), 97);
  if (h > 0.965 && l > 0.45) {
    s.k *= 1.15;
    return SCRATCH[h > 0.982 ? 1 : 0];
  }
  return pick(IRON, l);
}

// Wool: shaded smoothly by the light, so the form of the body reads, with a
// few deep folds running down the wider pieces of cloth.
function wool(l, u, v, s) {
  if (Math.sin(v * 4.2 + u * 0.12) > 0.93 && l > 0.3) {
    s.k *= 0.65;
    return glyph('|');
  }
  return pick(WOOL, l);
}

// Close-fitting cloth on the limbs: shading only, nothing to break up the
// shape of a moving leg.
const fitted = (l) => pick(WOOL, l);

// Leather with a line of stitching along each edge.
function leather(l, u, v) {
  if (Math.abs(v) > 0.72 && frac(u * 1.5) < 0.5) return STITCH;
  return pick(LEATHER, l);
}

// A leather jerkin, laced up the front with a criss-cross of thong.
function jerkin(l, u, v, s) {
  if (Math.abs(v) < 0.12) {
    s.c = LACE;
    s.k = 0.45 + l * 0.6;
    return frac(u * 1.8) < 0.5 ? glyph('X') : glyph('x');
  }
  return leather(l, u, v);
}

// Boots of soft, creased leather.
function boot(l) {
  return pick(LEATHER, l);
}

// Wood: grain running along the piece, with the odd knot.
function wood(l, u, v) {
  if (hash2(Math.floor(u * 3), Math.floor(v * 2), 41) > 0.93) return glyph('o');
  return l > 0.55 ? glyph('|') : glyph(':');
}

// Feathers: a fan of barbs either side of the shaft.
function feather(l, u, v) {
  if (Math.abs(v) < 0.2) return glyph('|');
  return v < 0 ? glyph('\\') : glyph('/');
}

export const MATERIALS = {
  // Dark, undyed wool: charcoal, umber and slate, so the figure reads as a
  // shadow against the bright grass, picked out by its moonlit outline.
  tunic: { color: [92, 74, 60], tex: wool },
  hood: { color: [70, 68, 74], tex: wool },
  cloak: { color: [58, 56, 64], tex: wool },
  // The cloak's darker inner face, seen when it swings round to the camera.
  lining: { color: [34, 32, 38], tex: wool },
  hose: { color: [72, 72, 82], tex: fitted },
  sleeve: { color: [92, 74, 60], tex: fitted },
  // The undyed linen shirt beneath the tunic, and cropped hair.
  linen: { color: [150, 142, 124], tex: fitted },
  hair: { color: [52, 40, 32], tex: wool },
  // Worn leather: the belt, pouch, scabbard and grips, and the gloves and
  // boot cuffs, which a skin may colour apart from them.
  leather: { color: [86, 60, 42], tex: leather },
  glove: { color: [86, 60, 42], tex: leather },
  cuff: { color: [86, 60, 42], tex: leather },
  jerkin: { color: [108, 78, 52], tex: jerkin },
  bracer: { color: [90, 64, 42], tex: leather },
  boot: { color: [78, 56, 40], tex: boot },
  quiver: { color: [84, 58, 38], tex: leather },
  // Bow staves, arrow shafts and fletching, and iron fittings.
  wood: { color: [132, 98, 62], tex: wood },
  feather: { color: [210, 204, 190], tex: feather },
  iron: { color: [112, 116, 124], tex: iron },
  skin: { color: [150, 118, 96], tex: (l) => pick(SKIN, l * 0.8) },
  // The shadow inside the hood.
  void: { color: [10, 10, 16], tex: () => 0 },
  // A glint of eyes in that shadow. Lights ignore the moon and claim every
  // cell they touch, as they are far smaller than a cell.
  glint: { color: [214, 206, 170], tex: () => glyph('.'), emissive: true, claim: true },
  // Bare steel is drawn as a line along the blade; it too claims its cells.
  blade: { color: [206, 214, 228], tex: null, claim: true },
  // A blade charged for a spin burns a cold blue.
  bladeGlow: { color: [170, 230, 255], tex: null, claim: true, emissive: true },
};

import { glyph } from '../render/glyphs.js';
import { WEAPON_MATERIALS } from './weapons.js';

// What the warrior is made of. Each material has a base colour and a texture
// that picks the glyph for a fully covered cell from its lighting and from
// where on the part the cell lies (u along the part, v across it), so seams,
// rings and folds stick to the body as it moves rather than to the grid.

const G = (s) => [...s].map(glyph);

const PLATE = G(':;+=#%@');
const SEAM = G('-=');
const MAIL = G('.o08');
const CLOTH = G(" .:;i!|");
const LEATHER = G('-=+#');
const BONE = G('.:o0O@');
const TRIM = G(':-==#');
const WOOD = G('.:|+=#');
const GLOW = G('*');
const STAR = glyph('*');

const pick = (ramp, l) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(l * ramp.length)))];
const frac = (x) => x - Math.floor(x);

// Plate armour: shaded steel cut into horizontal lames, with a glint where
// the moon catches it squarely.
function plate(l, u) {
  if (l > 0.97) return STAR;
  if (frac(u * 0.55) < 0.14) return SEAM[l > 0.55 ? 1 : 0];
  return pick(PLATE, l);
}

// Mail: offset rows of rings.
function mail(l, u, v) {
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

export const MATERIALS = {
  plate: { color: [104, 112, 132], tex: plate },
  darkPlate: { color: [68, 74, 92], tex: plate },
  mail: { color: [86, 92, 108], tex: mail },
  cloth: { color: [46, 50, 66], tex: cloth },
  crimson: { color: [138, 36, 42], tex: cloth },
  leather: { color: [98, 68, 46], tex: (l) => pick(LEATHER, l) },
  wood: { color: [132, 98, 58], tex: (l, u, v) => pick(WOOD, l + Math.sin(u * 0.4 + v * 9) * 0.08) },
  string: { color: [188, 176, 142], tex: null, claim: true },
  arrow: { color: [156, 120, 76], tex: null, claim: true },
  trim: { color: [184, 154, 96], tex: (l) => pick(TRIM, l) },
  horn: { color: [196, 186, 156], tex: (l) => pick(BONE, l) },
  skin: { color: [150, 118, 96], tex: (l) => pick(BONE, l * 0.8) },
  // The dark slit of a visor.
  void: { color: [10, 10, 16], tex: () => 0 },
  // Lights that ignore the moon: they are drawn at full brightness.
  eye: { color: [150, 235, 255], tex: () => GLOW[0], emissive: true, claim: true },
  // Bare steel is drawn as a line along the blade. Like the eyes it claims
  // every cell it touches, as it is far thinner than a cell.
  blade: { color: [206, 214, 228], tex: null, claim: true },
};

// Weapon tiers tint the weapon's own metal, never the warrior's armour.
// Cache the small palette instead of rebuilding texture objects per frame.
const TINTED = new Set(['blade', 'metal', 'darkPlate', 'trim', 'eye']);
const weaponMaterials = new Map();
export function weaponMaterial(definition = {}, role) {
  const base = MATERIALS[role === 'metal' ? 'plate' : role] ?? MATERIALS.blade;
  if (!TINTED.has(role)) return base;
  const tier = typeof definition.material === 'string' ? definition.material : definition.material?.id;
  const color = definition.materialColor ?? WEAPON_MATERIALS[tier]?.color ?? MATERIALS.blade.color;
  const key = `${role}:${color.join(',')}`;
  if (!weaponMaterials.has(key)) {
    const tint = role === 'darkPlate' ? color.map((c) => c * 0.34) : color;
    weaponMaterials.set(key, { ...base, color: tint });
  }
  return weaponMaterials.get(key);
}

// Art data for the inventory pictures (see item-studio.js): the paints
// items are made of, and how each item's model is built.

const levels = (...sets) => sets.map((s) => [...s]);
const METAL = levels(':', ';', '+=', '=#', '#%', '%@', '@');

// Each paint: a ramp of letters from shadow to light ('bark' is the trees'),
// its colour, how the light level is read (floor, gain), and optionally a
// glint letter on the brightest spots, a share of the metal tint (`tinted`)
// or `edge` for parts drawn as strokes only.
export const PAINTS = {
  wood: { ramp: 'bark', colour: [132, 98, 62], floor: 0.25, gain: 1.3 },
  metal: { ramp: METAL, colour: [206, 214, 228], floor: 0.25, gain: 1.3, glint: '/', tinted: 1 },
  darkMetal: { ramp: METAL, colour: [112, 116, 124], floor: 0.25, gain: 1.3, tinted: 0.4 },
  trim: { ramp: METAL, colour: [112, 116, 124], floor: 0.25, gain: 1.3 },
  stone: { ramp: levels('.', ':', ';o', 'oO', '0O', '0@', '@'), colour: [150, 153, 162], floor: 0.25, gain: 1.3 },
  leather: { ramp: levels('-', '=', '=+', '+#', '#%'), colour: [86, 60, 42], floor: 0.25, gain: 1.3 },
  string: { ramp: levels('|'), colour: [216, 208, 184], floor: 0, gain: 1, edge: true },
  eye: { ramp: levels('.', '*', '**', '#*', '@*'), colour: [150, 200, 230], floor: 0.25, gain: 1.3 },
};

// The paint of each material a weapon's sprite parts name.
export const WEAPON_PAINTS = { blade: 'metal', darkPlate: 'darkMetal', trim: 'trim', leather: 'leather', wood: 'wood',
  string: 'string', eye: 'eye' };

// How each item's model is made: `from: 'weapon'` takes the sprite parts
// the hands carry. Items without one keep their outline.
export const ITEM_MODELS = {
  shortSword: { from: 'weapon' },
  greatsword: { from: 'weapon' },
  battleAxe: { from: 'weapon' },
  warHammer: { from: 'weapon' },
  spear: { from: 'weapon' },
  dagger: { from: 'weapon' },
  quarterstaff: { from: 'weapon' },
  longbow: { from: 'weapon' },
  stonePickaxe: { from: 'weapon' },
};

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
  stone: { ramp: levels('.', ':', ';o', 'oO', '0O', '0@', '@'), colour: [150, 153, 162], floor: 0.2, gain: 0.9 },
  leather: { ramp: levels('-', '=', '=+', '+#', '#%'), colour: [86, 60, 42], floor: 0.25, gain: 1.3 },
  string: { ramp: levels('|'), colour: [216, 208, 184], floor: 0, gain: 1, edge: true },
  gem: { ramp: levels('.', '*', '**', '#*', '@*'), colour: [150, 200, 230], floor: 0.25, gain: 1.3 },
  darkWood: { ramp: 'bark', colour: [58, 42, 28], floor: 0.25, gain: 1.3 },
  bone: { ramp: levels('.', ':', 'o', '0', 'O', '@'), colour: [228, 222, 200], floor: 0.25, gain: 1.3 },
  feather: { ramp: levels("'", '"', '~', '^'), colour: [230, 226, 214], floor: 0.25, gain: 1.3 },
};

// The paint of each material a weapon's sprite parts name.
export const WEAPON_PAINTS = { blade: 'metal', darkPlate: 'darkMetal', trim: 'trim', leather: 'leather', wood: 'wood',
  string: 'string', eye: 'gem' };
// The paint of an instrument piece by its colour; the body takes the
// recipe's `body` paint, else wood.
export const INSTRUMENT_PAINTS = { 0x3a2a1c: 'darkWood', 0x2a1e14: 'darkWood', 0x70747c: 'trim', 0xd8d0b8: 'string' };

// Parts are [kind, size, at, turn, paint, colour, scale] in metres and
// radians: box [w, h, d], cyl [rTop, rBottom, h, sides, start], cone
// [r, h], ball [rx, ry, rz], torus [R, r], lathe [[r, y], …], slab
// [[[x, y], …], depth], lump [r, rough, detail] (a knobbly stone), tube
// [[[x, y, z], …], r], or group [parts]. The colour is the paint's unless
// given; 'item' is the item's own.
const arrow = [
  ['cyl', [0.0045, 0.0045, 0.72], [0, 0.36, 0], 0, 'wood'],
  ['cone', [0.011, 0.05], [0, 0.745, 0], 0, 'metal'],
  ...[0, 2.09, 4.19].map((y) => ['slab', [[[0, 0], [0.016, 0.02], [0.016, 0.1], [0, 0.12]], 0.002], [0, 0.02, 0], [0, y, 0], 'feather']),
];
const fletched = (x, z) => ['group', [['cyl', [0.0045, 0.0045, 0.1], [0, 0.05, 0], 0, 'wood'],
  ...[0, 2.09, 4.19].map((y) => ['slab', [[[0, 0], [0.014, 0.015], [0.014, 0.07], [0, 0.085]], 0.002], [0, 0.015, 0], [0, y, 0], 'feather'])],
[x, 0.38, z], [0, 0, x * 2]];
// A knobbly stone (or `base`) with flecks of `paint` in the item's colour,
// or `colour`.
const ore = (paint, colour = 'item', base = ['lump', [0.05, 0.4, 0], [0, 0, 0], 0, 'stone', undefined, [1.2, 0.7, 1]]) => ({
  pose: 'flat', parts: [base, ...[[0.04, 0.012, 0.03], [-0.035, 0.018, 0.02], [0, 0.025, -0.02], [-0.01, 0.01, 0.045]]
    .map((at) => ['lump', [0.013, 0.4, 0], at, 0, paint, colour])] });
// A cast bar: a frustum with a narrower top; two stacked when there are more.
const bar = (at, y) => ['cyl', [0.8, 1, 1, 4, Math.PI / 4], at, [0, y, 0], 'metal', 'item', [0.07, 0.035, 0.03]];
const ingot = { pose: 'flat', parts: [bar([0, 0, 0], 0)], two: { parts: [bar([0, 0, -0.022], 0), bar([0.01, 0.036, 0.008], 0.3)] } };

// How each item's model is made: `from: 'weapon'` takes the sprite parts
// the hands carry, `from: 'instrument'` the shape the hand holds, turned so
// its `up` axis is up; other items list their parts. A `card` or `compact`
// (small box) version replaces the parts there, and `two` when a stack has
// more than one. `pose` is long (on the box diagonal, the default), upright
// or flat (seen from above). Items without one keep their outline.
export const ITEM_MODELS = {
  shortSword: { from: 'weapon' },
  greatsword: { from: 'weapon' },
  battleAxe: { from: 'weapon' },
  warHammer: { from: 'weapon' },
  spear: { from: 'weapon' },
  dagger: { from: 'weapon' },
  quarterstaff: { from: 'weapon' },
  javelin: { from: 'weapon' },
  longbow: { from: 'weapon' },
  stonePickaxe: { from: 'weapon' },
  arrow: { parts: arrow, card: { parts: [-0.1, 0, 0.1].map((z) => ['group', arrow, [0, 0, 0], [0, 0, z]]) },
    compact: { pose: 'upright', parts: [['cyl', [0.07, 0.06, 0.4], [0, 0.2, 0], 0, 'leather', [160, 124, 86]],
      ['tube', [[[0.07, 0.04, 0], [0.1, 0.2, 0.02], [0.07, 0.36, 0]], 0.008], [0, 0, 0], 0, 'leather'],
      fletched(-0.03, 0.02), fletched(-0.01, -0.03), fletched(0.015, 0.03), fletched(0.035, -0.01)] } },
  lute: { from: 'instrument', up: '-x', pose: 'upright' },
  celticHarp: { from: 'instrument', up: '-x', pose: 'upright' },
  dulcimer: { from: 'instrument', up: '-x', pose: 'upright' },
  kalimba: { from: 'instrument', up: '-x', pose: 'upright' },
  vielle: { from: 'instrument', up: '-x', pose: 'upright' },
  accordion: { from: 'instrument', up: '-x', pose: 'upright' },
  bagpipe: { from: 'instrument', up: '-x', pose: 'upright', body: 'leather' },
  flute: { from: 'instrument', up: '-x', body: 'bone' },
  trumpet: { from: 'instrument', up: '-x', body: 'metal' },
  ironIngot: ingot,
  copperIngot: ingot,
  steelIngot: ingot,
  bronzeIngot: ingot,
  alloyIngot: ingot,
  rawIron: ore('metal'),
  rawCopper: ore('metal'),
  rawTin: ore('metal'),
  // Coal is drawn lighter than its item colour, or it would vanish on black.
  coal: { pose: 'flat', parts: [['lump', [0.05, 0.4, 0], [0, 0, 0], 0, 'stone', [104, 102, 110], [1.2, 0.75, 1]]] },
  lapisLazuli: { pose: 'flat', parts: [['lump', [0.045, 0.2, 0], [0, 0, 0], 0, 'gem', 'item']] },
  unusableScrap: ore('stone', [150, 74, 40], ['lump', [0.05, 0.7, 1], [0, 0, 0], 0, 'darkMetal', 'item', [1.3, 0.6, 1]]),
};

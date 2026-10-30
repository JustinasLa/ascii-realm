// Art data for the inventory pictures (see item-studio.js): the paints
// items are made of, and how each item's model is built.

import { DEFAULT_PAINT } from '../character/skin.js';

const levels = (...sets) => sets.map((s) => [...s]);
const METAL = levels(':', ';', '+=', '=#', '#%', '%@', '@');
const STONE = { ramp: levels('.', ':', ';o', 'oO', '0O', '0@', '@'), colour: [150, 153, 162], floor: 0.2, gain: 0.9 };

// Each paint: a ramp of letters from shadow to light ('bark' is the trees'),
// its colour, how the light level is read (floor, gain), and optionally a
// glint letter on the brightest spots, a share of the metal tint (`tinted`),
// a `speckle` share of pale dots, or `edge` for parts drawn as strokes only.
export const PAINTS = {
  wood: { ramp: 'bark', colour: [132, 98, 62], floor: 0.25, gain: 1.3 },
  metal: { ramp: METAL, colour: [206, 214, 228], floor: 0.25, gain: 1.3, glint: '/', tinted: 1 },
  darkMetal: { ramp: METAL, colour: [112, 116, 124], floor: 0.25, gain: 1.3, tinted: 0.4 },
  trim: { ramp: METAL, colour: [112, 116, 124], floor: 0.25, gain: 1.3 },
  stone: STONE,
  granite: { ...STONE, speckle: 0.12 },
  leather: { ramp: levels('-', '=', '=+', '+#', '#%'), colour: [86, 60, 42], floor: 0.25, gain: 1.3 },
  string: { ramp: levels('|'), colour: [216, 208, 184], floor: 0, gain: 1, edge: true },
  gem: { ramp: levels('.', '*', '**', '#*', '@*'), colour: [150, 200, 230], floor: 0.25, gain: 1.3 },
  darkWood: { ramp: 'bark', colour: [58, 42, 28], floor: 0.25, gain: 1.3 },
  bone: { ramp: levels('.', ':', 'o', '0', 'O', '@'), colour: [228, 222, 200], floor: 0.25, gain: 1.3 },
  feather: { ramp: levels("'", '"', '~', '^'), colour: [230, 226, 214], floor: 0.25, gain: 1.3 },
  wool: { ramp: levels(':', ';', '=', '+', '*', '#', '%'), colour: [118, 116, 124], floor: 0.25, gain: 1.3 },
  fur: { ramp: levels("'", ',:', ';~', '~=', '=%', '%&'), colour: [150, 150, 142], floor: 0.25, gain: 1.3 },
  flesh: { ramp: levels(':', ';o', 'o%', '%&', '&@'), colour: [188, 70, 62], floor: 0.25, gain: 1.3 },
  endgrain: { ramp: levels('.', ':', 'o', 'oc', '0O', '@Q'), colour: [196, 150, 96], floor: 0.25, gain: 1.3 },
  glass: { ramp: levels('.', ':', "'", ';'), colour: [168, 186, 196], floor: 0.25, gain: 1.3 },
  liquid: { ramp: levels(':', '~', '~=', '=*', '*%'), colour: [200, 60, 90], floor: 0.25, gain: 1.3 },
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
// [[[x, y, z], …], r], shell [r, start, turn] (part of a sphere's skin), or
// group [parts]. A cyl given a `turn` under a full circle is an open strip. The colour is the paint's unless
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
// A loose rock of `paint` in the item's colour.
const rock = (paint, rough, detail = 1, scale = [1.2, 0.7, 1]) => ({ pose: 'flat',
  parts: [['lump', [0.05, rough, detail], [0, 0, 0], 0, paint, 'item', scale]] });
// A bottle: `fill` liquid in the item's colour, `glass` above it, then `top`.
const bottle = (fill, glass, top) => ({ pose: 'upright',
  parts: [['lathe', fill, [0, 0, 0], 0, 'liquid', 'item'], ['lathe', glass, [0, 0, 0], 0, 'glass'], top] });
// An outline's right half, mirrored to the left.
const mirror = (half) => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
const HIDE = [[0, -0.15], [0.06, -0.14], [0.14, -0.21], [0.12, -0.08], [0.11, 0.06], [0.17, 0.15], [0.06, 0.12]];
// A skin stretched flat, in `paint`, with `more` parts.
const skin = (outline, more = []) => ({ pose: 'flat',
  parts: [['slab', [mirror(outline), 0.01], [0, 0, 0], [-Math.PI / 2, 0, 0], 'fur', 'item'], ...more] });
const peg = (x, z) => ['cyl', [0.006, 0.004, 0.04, 6], [x, 0.01, z], 0, 'wood'];
const meat = (lump, bone) => ({ pose: 'flat', parts: [['lump', lump, [0, 0, 0], 0, 'flesh', 'item', [1.3, 0.55, 1]],
  ['box', [0.08, 0.006, 0.016], [0, 0.026, -0.01], [0, 0.3, 0], 'bone', [236, 226, 206]],
  ['cyl', [0.008, 0.008, bone], [0.04 + bone / 2, 0, 0], [0, 0, Math.PI / 2], 'bone'], ['ball', [0.013, 0.011, 0.011], [0.04 + bone, 0, 0], 0, 'bone']] });

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
  // Clothing is cut out of the mannequin by body region ([paint, colour]),
  // in the colours the outlaw wears it.
  leatherJerkin: { from: 'mannequin', pose: 'front', cut: { torso: ['leather', 'item'], upperArm: ['wool', DEFAULT_PAINT.tunic] },
    parts: [['box', [0.012, 0.3, 0.01], [0, 1.22, 0.125], 0, 'darkWood']] },
  // One glove and bracer, palm up, fingers down to the left.
  leatherBracers: { from: 'mannequin', pose: 'front', side: 'L', turn: [-Math.PI / 2, Math.PI, 0.5],
    cut: { forearm: ['leather', 'item'], hand: ['leather', 'item'] },
    parts: [0.53, 0.6, 0.67].map((x) => ['box', [0.006, 0.006, 0.08], [x, 1.39, 0], [0, 0.6, 0], 'darkWood']) },
  // One boot in profile, toe to the right, turned down in a cuff.
  ridingBoots: { from: 'mannequin', pose: 'front', side: 'L', turn: [0, Math.PI / 2, 0], cut: { shin: ['leather', 'item'], foot: ['leather', 'item'] },
    parts: [['cyl', [0.072, 0.066, 0.07, 16], [0.089, 0.45, -0.01], 0, 'leather', DEFAULT_PAINT.cuff]] },
  // The hood the outlaw wears: a cowl open at a face in shadow, a peak, a
  // tail and a short cape.
  outlawHood: { pose: 'front', parts: [['shell', [0.185, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7], [0, 0, 0], 0, 'wool', 'item'],
    ['ball', [0.15, 0.16, 0.13], [0, -0.01, 0], 0, 'wool', [26, 24, 28]],
    ['cone', [0.06, 0.12], [0, 0.18, -0.03], [-0.35, 0, 0], 'wool', 'item'],
    ['cone', [0.05, 0.32], [0, -0.14, -0.17], [Math.PI - 0.35, 0, 0], 'wool', 'item'],
    ['cyl', [0.11, 0.25, 0.16, 16], [0, -0.24, -0.01], 0, 'wool', 'item']] },
  // A cloak flaring to a ragged hem, with a collar and clasp; folded in a
  // small box.
  travelCloak: { pose: 'front', parts: [['cyl', [0.16, 0.34, 0.95, 16, -1.75, 3.5], [0, 0, 0], 0, 'wool', 'item'],
    ['torus', [0.15, 0.025], [0, 0.47, 0], [Math.PI / 2, 0, 0], 'wool', 'item'], ['ball', [0.025, 0.025, 0.02], [0, 0.45, 0.16], 0, 'trim'],
    ...[-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((a) => ['cone', [0.045, 0.08], [0.34 * Math.sin(a), -0.5, 0.34 * Math.cos(a)], [Math.PI, 0, 0], 'wool', 'item'])],
  compact: { pose: 'flat', parts: [...[0, 1, 2].map((i) => ['box', [0.3 - i * 0.03, 0.035, 0.2], [i * 0.01, i * 0.036, 0], [0, i * 0.08, 0], 'wool', 'item']),
    ['ball', [0.025, 0.02, 0.025], [0.02, 0.09, 0.06], 0, 'trim']] } },
  // The board, iron rim and boss the off arm carries, with plank seams.
  woodenBuckler: { pose: 'upright', parts: [['cyl', [0.16, 0.16, 0.025, 20], [0, 0, 0], [Math.PI / 2, 0, 0], 'wood'],
    ['torus', [0.16, 0.012], [0, 0, 0], 0, 'trim'], ['ball', [0.04, 0.04, 0.03], [0, 0, 0.0125], 0, 'trim'],
    ...[-0.107, -0.053, 0.053, 0.107].map((x) => ['box', [0.004, 2 * Math.sqrt(0.0256 - x * x) - 0.01, 0.002], [x, 0, 0.0135], 0, 'darkWood'])] },
  healingDraught: bottle([[0, 0], [0.045, 0.004], [0.065, 0.03], [0.07, 0.06], [0.058, 0.09]],
    [[0.058, 0.09], [0.04, 0.115], [0.02, 0.125], [0.018, 0.17], [0, 0.17]], ['cyl', [0.022, 0.018, 0.03], [0, 0.18, 0], 0, 'wood']),
  staminaTonic: bottle([[0, 0], [0.038, 0], [0.04, 0.01], [0.04, 0.11]], [[0.04, 0.11], [0.04, 0.13], [0.03, 0.15], [0.014, 0.165], [0.014, 0.2], [0, 0.2]],
    ['ball', [0.022, 0.014, 0.022], [0, 0.205, 0], 0, 'flesh', [150, 40, 40]]),
  bandage: { pose: 'flat', parts: [['cyl', [0.035, 0.035, 0.07], [0, 0, 0], [0, 0, Math.PI / 2], 'wool', 'item'],
    ['torus', [0.022, 0.003], [0.036, 0, 0], [0, Math.PI / 2, 0], 'wool', [170, 164, 140]], ['box', [0.07, 0.003, 0.12], [0, -0.034, 0.06], 0, 'wool', 'item']] },
  denars: { pose: 'flat', parts: [[0, 0, 0], [0.004, 0.005, 0.003], [-0.003, 0.01, -0.002], [0.002, 0.015, 0.001], [0.035, 0, 0.03]]
    .map((at) => ['cyl', [0.02, 0.02, 0.004, 16], at, 0, 'metal', 'item']) },
  oakLog: { pose: 'flat', parts: [['cyl', [0.06, 0.06, 0.3, 14], [0, 0, 0], [0, 0, Math.PI / 2], 'wood', 'item'],
    ...[-0.151, 0.151].map((x) => ['cyl', [0.056, 0.056, 0.004, 14], [x, 0, 0], [0, 0, Math.PI / 2], 'endgrain']),
    ['ball', [0.015, 0.012, 0.01], [0.05, 0.03, 0.05], 0, 'wood', 'item']] },
  granite: rock('granite', 0.3),
  basalt: rock('stone', 0.3),
  limestone: rock('stone', 0.25),
  flint: rock('stone', 0.45, 0, [1, 0.6, 0.8]),
  clay: rock('stone', 0.08, 1, [1.2, 0.6, 1]),
  stick: { parts: [['tube', [[[0, 0, 0], [0.012, 0.12, 0], [0, 0.25, 0.005], [0.01, 0.36, 0]], 0.007], [0, 0, 0], 0, 'wood', 'item'],
    ['tube', [[[0.006, 0.15, 0], [0.025, 0.19, 0], [0.045, 0.21, 0]], 0.004], [0, 0, 0], 0, 'wood', 'item']] },
  reed: { parts: [...[-0.012, 0, 0.012].map((x) => ['tube', [[[0, 0, 0], [x, 0.22, 0], [x * 2, 0.45, x]], 0.004], [0, 0, 0], 0, 'wood', 'item']),
    ['cyl', [0.012, 0.012, 0.08], [0, 0.4, 0], 0, 'wood', [120, 82, 50]]] },
  straw: { parts: [...[-1, 0, 1].flatMap((x) => [-1, 0, 1].map((z) => ['cyl', [0.003, 0.003, 0.4, 6], [x * 0.007, 0.2 + x * z * 0.01, z * 0.007], 0, 'wood', 'item'])),
    ['cyl', [0.016, 0.016, 0.02], [0, 0.22, 0], 0, 'wool', [150, 120, 70]]] },
  fibre: { pose: 'flat', parts: [[0.04, 0], [0.034, 0.8], [0.03, 1.7]].map(([r, y], i) => ['torus', [r, 0.003], [i * 0.006, i * 0.004, 0], [Math.PI / 2, y, 0], 'wool', 'item']) },
  berries: { pose: 'flat', parts: [...[[0, 0, 0], [0.022, 0, 0.006], [-0.02, 0, 0.01], [0.006, 0, 0.022], [0.01, 0, -0.02], [-0.012, 0.0, -0.015], [0, 0.018, 0]]
    .map((at) => ['ball', [0.012, 0.012, 0.012], at, 0, 'flesh', 'item']),
  ...[0.6, 2.4].map((y) => ['slab', [[[0, 0], [0.015, 0.02], [0, 0.05], [-0.015, 0.02]], 0.002], [0, 0, 0], [-1.3, y, 0], 'wood', [70, 120, 50]])] },
  mushroom: { pose: 'upright', parts: [['ball', [0.05, 0.03, 0.05], [0, 0.07, 0], 0, 'flesh', 'item'],
    ['lathe', [[0, 0], [0.018, 0], [0.015, 0.05], [0.02, 0.07], [0, 0.07]], [0, 0, 0], 0, 'bone'],
    ...[[0.02, 0.092, 0.015], [-0.025, 0.088, 0.01], [0, 0.095, -0.02], [0.005, 0.09, 0.03]].map((at) => ['ball', [0.008, 0.005, 0.008], at, 0, 'bone'])] },
  deerHide: skin(HIDE, [[-0.14, -0.21], [0.14, -0.21], [-0.17, 0.15], [0.17, 0.15]].map(([x, y]) => peg(x, -y))),
  wolfPelt: skin([...HIDE, [0.05, 0.22], [0.07, 0.3], [0.03, 0.27], [0, 0.32]]),
  rawVenison: meat([0.05, 0.3, 1], 0.04),
  rawRabbit: meat([0.032, 0.2, 1], 0.06),
  bone: { parts: [['cyl', [0.01, 0.01, 0.16], [0, 0, 0], 0, 'bone'], ...[-1, 1].flatMap((y) => [-1, 1].map((x) =>
    ['ball', [0.014, 0.014, 0.012], [x * 0.01, y * 0.08, 0], 0, 'bone']))] },
};

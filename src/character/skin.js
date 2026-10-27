// A character's skin: the colours painted onto the hooded outlaw and which
// of its outer layers are worn. Like a skin on a fixed player model it only
// repaints the outlaw's existing regions; the model, its proportions, its
// animations and its stride never change.
//
// The base layer is the skin tone, hair, linen shirt and hose. The outer
// layer is the hood, jerkin, tunic sleeves, bracers and gloves, boots and
// cloak. The hood, jerkin and cloak can be taken off, showing the base layer
// beneath. Each region takes a colour from a small curated palette of dark,
// undyed cloth and worn leather, so the figure still reads as a shadow
// against the grass.
//
// Plain frozen data and pure functions: the rigged model (`gear.js`) and the
// shape-built figure (`figure.js`) both paint from `skinPaint`.

export const SKIN_VERSION = 1;
export const BASE = Object.freeze(['tone', 'hair', 'shirt', 'hose']);
export const OUTER = Object.freeze(['hood', 'jerkin', 'sleeves', 'bracers', 'boots', 'cloak']);
export const REGIONS = Object.freeze([...BASE, ...OUTER]);
// The outer layers that can be taken off; all are worn by default.
export const LAYERS = Object.freeze(['hood', 'jerkin', 'cloak']);

const swatches = (list) => Object.freeze(list.map(([id, name, color]) =>
  Object.freeze({ id, name, color: Object.freeze(color) })));

const TONES = swatches([
  ['fair', 'Fair', [186, 152, 130]],
  ['weathered', 'Weathered', [150, 118, 96]],
  ['tan', 'Tan', [126, 92, 68]],
  ['deep', 'Deep', [90, 64, 50]],
  ['dark', 'Dark', [62, 44, 36]],
  // The green of orcs and goblins, the leafy tone of dryads and the red of
  // the Oseni.
  ['olive', 'Olive', [108, 120, 72]],
  ['fern', 'Fern', [90, 122, 70]],
  ['sage', 'Sage', [112, 136, 104]],
  ['ember', 'Ember', [156, 76, 62]],
  ['rust', 'Rust', [124, 62, 52]],
]);
const HAIRS = swatches([
  ['umber', 'Umber', [52, 40, 32]],
  ['black', 'Black', [30, 28, 30]],
  ['chestnut', 'Chestnut', [88, 54, 36]],
  ['auburn', 'Auburn', [106, 50, 34]],
  ['flax', 'Flax', [150, 128, 88]],
  ['grey', 'Grey', [124, 122, 120]],
  ['white', 'White', [184, 180, 172]],
]);
const SHIRTS = swatches([
  ['undyed', 'Undyed linen', [150, 142, 124]],
  ['oat', 'Oat', [132, 120, 96]],
  ['grey', 'Grey', [112, 110, 108]],
  ['dun', 'Dun', [118, 100, 78]],
]);
const WOOLS = swatches([
  ['ash', 'Ash', [70, 68, 74]],
  ['charcoal', 'Charcoal', [58, 56, 64]],
  ['umber', 'Umber', [92, 74, 60]],
  ['pewter', 'Pewter', [72, 72, 82]],
  ['lincoln', 'Lincoln green', [54, 70, 46]],
  ['moss', 'Moss', [72, 80, 54]],
  ['peat', 'Peat', [60, 50, 42]],
  ['night', 'Night', [38, 40, 50]],
  ['oxblood', 'Oxblood', [82, 44, 40]],
  ['heather', 'Heather', [80, 68, 82]],
]);
const LEATHERS = swatches([
  ['tan', 'Tan', [108, 78, 52]],
  ['saddle', 'Saddle', [90, 64, 42]],
  ['brown', 'Brown', [78, 56, 40]],
  ['dark', 'Dark', [56, 42, 34]],
  ['black', 'Black', [40, 36, 36]],
  ['russet', 'Russet', [100, 58, 40]],
  ['grey', 'Grey', [78, 74, 70]],
]);

// Each region's swatches, in the order a picker shows them.
export const PALETTES = Object.freeze({
  tone: TONES, hair: HAIRS, shirt: SHIRTS, hose: WOOLS,
  hood: WOOLS, jerkin: LEATHERS, sleeves: WOOLS, bracers: LEATHERS, boots: LEATHERS, cloak: WOOLS,
});
// Sets, not objects, so `__proto__` or `constructor` is never a swatch.
const IDS = new Map(REGIONS.map((region) => [region, new Set(PALETTES[region].map((s) => s.id))]));
const COLOR = new Map(REGIONS.map((region) => [region, new Map(PALETTES[region].map((s) => [s.id, s.color]))]));

const freeze = (skin) => Object.freeze({ ...skin, layers: Object.freeze({ ...skin.layers }) });

// Today's outlaw.
export const DEFAULT_SKIN = freeze({
  v: SKIN_VERSION,
  tone: 'weathered', hair: 'umber', shirt: 'undyed', hose: 'pewter',
  hood: 'ash', jerkin: 'tan', sleeves: 'umber', bracers: 'saddle', boots: 'brown', cloak: 'charcoal',
  layers: { hood: true, jerkin: true, cloak: true },
});

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key);

// A well-formed skin from anything: each region keeps its own value when it
// names a swatch of that region's palette and otherwise takes the default,
// and each layer keeps its own value when it is a boolean and is otherwise
// worn. Unknown keys are dropped. It never throws.
export function cleanSkin(raw) {
  if (!plain(raw)) return DEFAULT_SKIN;
  const skin = { v: SKIN_VERSION };
  for (const region of REGIONS) {
    const id = own(raw, region) ? raw[region] : undefined;
    skin[region] = typeof id === 'string' && IDS.get(region).has(id) ? id : DEFAULT_SKIN[region];
  }
  const layers = own(raw, 'layers') && plain(raw.layers) ? raw.layers : {};
  skin.layers = {};
  for (const layer of LAYERS) {
    const on = own(layers, layer) ? layers[layer] : undefined;
    skin.layers[layer] = typeof on === 'boolean' ? on : true;
  }
  return freeze(skin);
}

// Starting points: today's outlaw and five other undyed looks. Each sets the
// outfit only; the tone and hair stay the default.
const preset = (id, name, outfit) => Object.freeze({ id, name, skin: cleanSkin({ ...DEFAULT_SKIN, ...outfit }) });
export const PRESETS = Object.freeze([
  Object.freeze({ id: 'outlaw', name: 'Outlaw', skin: DEFAULT_SKIN }),
  preset('greenwood', 'Greenwood', { hood: 'lincoln', cloak: 'lincoln', sleeves: 'moss', hose: 'peat',
    jerkin: 'brown', bracers: 'brown', boots: 'dark' }),
  preset('nightrunner', 'Nightrunner', { hood: 'night', cloak: 'night', hose: 'night', sleeves: 'charcoal',
    jerkin: 'black', bracers: 'black', boots: 'black', shirt: 'grey' }),
  preset('drover', 'Drover', { cloak: 'peat', sleeves: 'umber', jerkin: 'russet', bracers: 'saddle',
    boots: 'brown', shirt: 'oat', layers: { hood: false } }),
  preset('pilgrim', 'Pilgrim', { hood: 'heather', cloak: 'heather', sleeves: 'peat', jerkin: 'grey',
    bracers: 'grey', boots: 'brown', shirt: 'dun' }),
  preset('reaver', 'Reaver', { hood: 'oxblood', sleeves: 'oxblood', cloak: 'charcoal', jerkin: 'dark',
    bracers: 'dark', boots: 'black', layers: { cloak: false } }),
]);

// A preset's skin, or the default for an unknown id.
export const presetSkin = (id) => PRESETS.find((p) => p.id === id)?.skin ?? DEFAULT_SKIN;

// Puts on a preset's outfit and layers, keeping the skin's own tone and hair.
export function wearPreset(skin, id) {
  const { tone, hair } = cleanSkin(skin);
  return cleanSkin({ ...presetSkin(id), tone, hair });
}

// The tone a race starts with, or null when the default suits it. The player
// may change it afterwards.
export const RACE_TONES = Object.freeze({ orc: 'olive', goblin: 'fern', dryad: 'sage', oseni: 'ember' });
export const toneForRace = (race) => (typeof race === 'string' && Object.hasOwn(RACE_TONES, race) ? RACE_TONES[race] : null);

// A short stable string naming every swatch and layer, for caches and for
// telling skins apart.
export const skinKey = (skin = DEFAULT_SKIN) => `${REGIONS.map((region) => skin[region]).join()}|${LAYERS.map((l) => (skin.layers[l] ? 1 : 0)).join('')}`;

// Brightness as the eye sees it (Rec. 709 luma), on 0..255 colour values.
export const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// No outer-layer colour may be brighter than this: 1.25 times today's hood,
// the lighter of today's hood and cloak.
export const OUTER_LIMIT = 1.25 * Math.max(luma(COLOR.get('hood').get('ash')), luma(COLOR.get('cloak').get('charcoal')));

// Today's leather gloves and boot cuffs and the cloak's dark inner face.
const LEATHER = Object.freeze([86, 60, 42]);
const LINING = Object.freeze([34, 32, 38]);

// The colour of each of the outlaw's materials for a skin, by the names both
// figures paint with. The gloves follow the bracers, the boot cuffs the boots
// and the lining the cloak; each keeps today's colour while its own region is
// at the default, so the default skin paints exactly as before.
const paints = new Map();
export function skinPaint(skin) {
  const key = skinKey(skin);
  let paint = paints.get(key);
  if (paint) return paint;
  const color = (region) => COLOR.get(region).get(skin[region]);
  const derived = (region, today, shade = (c) => c) =>
    (skin[region] === DEFAULT_SKIN[region] ? today : Object.freeze(shade(color(region))));
  paint = Object.freeze({
    skin: color('tone'), hair: color('hair'), linen: color('shirt'), hose: color('hose'),
    hood: color('hood'), jerkin: color('jerkin'), tunic: color('sleeves'), sleeve: color('sleeves'),
    bracer: color('bracers'), glove: derived('bracers', LEATHER), boot: color('boots'),
    cuff: derived('boots', LEATHER), cloak: color('cloak'),
    lining: derived('cloak', LINING, (c) => c.map((v) => Math.round(v * 0.6))),
  });
  if (paints.size >= 32) paints.clear();
  paints.set(key, paint);
  return paint;
}

export const DEFAULT_PAINT = skinPaint(DEFAULT_SKIN);

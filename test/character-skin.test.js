import assert from 'node:assert/strict';
import test from 'node:test';
import { RACES } from '../src/character/catalog.js';
import {
  BASE, cleanSkin, DEFAULT_PAINT, DEFAULT_SKIN, LAYERS, luma, OUTER, OUTER_LIMIT, PALETTES, PRESETS, presetSkin,
  RACE_TONES, REGIONS, SKIN_VERSION, skinKey, skinPaint, toneForRace, wearPreset,
} from '../src/character/skin.js';

// Today's outlaw, as the fixed colour tables painted it before skins.
const TODAY = {
  skin: [150, 118, 96], hair: [52, 40, 32], linen: [150, 142, 124], hose: [72, 72, 82],
  hood: [70, 68, 74], jerkin: [108, 78, 52], tunic: [92, 74, 60], sleeve: [92, 74, 60],
  bracer: [90, 64, 42], glove: [86, 60, 42], boot: [78, 56, 40], cuff: [86, 60, 42],
  cloak: [58, 56, 64], lining: [34, 32, 38],
};

const deepFrozen = (skin) => Object.isFrozen(skin) && Object.isFrozen(skin.layers);
// Another swatch of a region than the one it has.
const other = (region, skin = DEFAULT_SKIN) => PALETTES[region].find((s) => s.id !== skin[region]).id;

test('every palette has unique named swatches of 0..255 colours', () => {
  assert.deepEqual(REGIONS, [...BASE, ...OUTER]);
  for (const region of REGIONS) {
    const palette = PALETTES[region];
    assert.ok(palette.length >= 4, region);
    assert.equal(new Set(palette.map((s) => s.id)).size, palette.length, region);
    for (const swatch of palette) {
      assert.ok(/^[a-z]+$/.test(swatch.id) && swatch.name.length > 1, `${region}.${swatch.id}`);
      assert.equal(swatch.color.length, 3);
      for (const channel of swatch.color) assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255);
    }
    assert.ok(Object.isFrozen(palette) && palette.every((s) => Object.isFrozen(s) && Object.isFrozen(s.color)));
  }
});

test('the default skin is today\'s outlaw and paints today\'s colours', () => {
  assert.deepEqual(DEFAULT_SKIN, {
    v: 1, tone: 'weathered', hair: 'umber', shirt: 'undyed', hose: 'pewter',
    hood: 'ash', jerkin: 'tan', sleeves: 'umber', bracers: 'saddle', boots: 'brown', cloak: 'charcoal',
    layers: { hood: true, jerkin: true, cloak: true },
  });
  assert.ok(deepFrozen(DEFAULT_SKIN));
  assert.deepEqual(DEFAULT_PAINT, TODAY);
  assert.equal(DEFAULT_PAINT, skinPaint(DEFAULT_SKIN));
  assert.equal(skinPaint(cleanSkin({})), DEFAULT_PAINT, 'equal skins share one paint');
  assert.equal(PRESETS[0].skin, DEFAULT_SKIN);
  assert.equal(SKIN_VERSION, 1);
});

test('no outer-layer colour is brighter than 1.25 times today\'s hood', () => {
  assert.equal(OUTER_LIMIT, 1.25 * luma(TODAY.hood));
  assert.ok(luma(TODAY.hood) > luma(TODAY.cloak), 'the hood is the lighter of the two');
  assert.ok(Math.abs(OUTER_LIMIT - 86.07) < 0.01);
  const bright = (color) => luma(color) > OUTER_LIMIT;
  assert.equal(bright([120, 110, 100]), true, 'a pale swatch would fail');
  assert.equal(bright(TODAY.linen), true, 'the linen shirt is base layer, and lighter');
  for (const region of OUTER) {
    for (const swatch of PALETTES[region]) assert.equal(bright(swatch.color), false, `${region}.${swatch.id}`);
  }
  // The derived colours, for every swatch of the region they follow.
  for (const [region, names] of [['bracers', ['glove', 'bracer']], ['boots', ['cuff', 'boot']], ['cloak', ['lining', 'cloak']]]) {
    for (const swatch of PALETTES[region]) {
      const paint = skinPaint(cleanSkin({ [region]: swatch.id }));
      for (const name of names) assert.equal(bright(paint[name]), false, `${name} for ${swatch.id}`);
    }
  }
});

test('six presets start from today\'s outlaw and five other undyed looks', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ['outlaw', 'greenwood', 'nightrunner', 'drover', 'pilgrim', 'reaver']);
  assert.ok(PRESETS.every((p) => Object.isFrozen(p) && deepFrozen(p.skin) && p.name));
  for (const { id, skin } of PRESETS) {
    assert.equal(presetSkin(id), skin);
    assert.deepEqual(cleanSkin(skin), skin, `${id} is already clean`);
    assert.equal(skin.tone, DEFAULT_SKIN.tone);
    assert.equal(skin.hair, DEFAULT_SKIN.hair);
  }
  assert.equal(new Set(PRESETS.map((p) => skinKey(p.skin))).size, 6);
  assert.equal(presetSkin('drover').layers.hood, false);
  assert.equal(presetSkin('reaver').layers.cloak, false);
  assert.equal(presetSkin('greenwood').hood, 'lincoln');
  assert.equal(presetSkin('nope'), DEFAULT_SKIN);
  assert.equal(presetSkin('__proto__'), DEFAULT_SKIN);
});

test('wearing a preset keeps the tone and hair and takes its outfit and layers', () => {
  const mine = cleanSkin({ tone: 'fern', hair: 'flax', jerkin: 'black', layers: { jerkin: false } });
  const worn = wearPreset(mine, 'drover');
  assert.deepEqual(worn, { ...presetSkin('drover'), tone: 'fern', hair: 'flax' });
  assert.ok(deepFrozen(worn));
  assert.deepEqual(wearPreset(null, 'reaver'), presetSkin('reaver'));
  assert.deepEqual(wearPreset(mine, 'nope'), { ...DEFAULT_SKIN, tone: 'fern', hair: 'flax' });
});

test('changing one region or layer changes only its own colours', () => {
  const touches = {
    tone: ['skin'], hair: ['hair'], shirt: ['linen'], hose: ['hose'], hood: ['hood'], jerkin: ['jerkin'],
    sleeves: ['tunic', 'sleeve'], bracers: ['bracer', 'glove'], boots: ['boot', 'cuff'], cloak: ['cloak', 'lining'],
  };
  for (const region of REGIONS) {
    const paint = skinPaint(cleanSkin({ ...DEFAULT_SKIN, [region]: other(region) }));
    for (const name of Object.keys(TODAY)) {
      if (touches[region].includes(name)) assert.notDeepEqual(paint[name], TODAY[name], `${region} → ${name}`);
      else assert.deepEqual(paint[name], TODAY[name], `${region} leaves ${name}`);
    }
  }
  for (const layer of LAYERS) {
    const skin = cleanSkin({ ...DEFAULT_SKIN, layers: { [layer]: false } });
    assert.notEqual(skinKey(skin), skinKey(DEFAULT_SKIN));
    assert.deepEqual(skinPaint(skin), TODAY, `taking off the ${layer} repaints nothing`);
  }
});

test('derived colours follow their region once it leaves the default', () => {
  const paint = skinPaint(cleanSkin({ bracers: 'black', boots: 'dark', cloak: 'moss' }));
  assert.deepEqual(paint.glove, [40, 36, 36]);
  assert.deepEqual(paint.cuff, [56, 42, 34]);
  assert.deepEqual(paint.lining, [43, 48, 32], 'moss × 0.6, rounded');
  assert.ok(Object.isFrozen(paint) && Object.isFrozen(paint.lining));
});

test('cleanSkin repairs each field on its own and never throws', () => {
  for (const raw of [null, undefined, [], ['tone'], 'olive', 7, true, () => {}]) assert.equal(cleanSkin(raw), DEFAULT_SKIN);
  const kept = { tone: 'olive', hair: 'black', cloak: 'night' };
  for (const bad of ['nope', 7, null, { id: 'olive' }, ['olive'], '__proto__', 'constructor', 'toString', 'ash']) {
    const skin = cleanSkin({ ...kept, tone: bad });
    assert.equal(skin.tone, 'weathered', String(bad));
    assert.equal(skin.hair, 'black');
    assert.equal(skin.cloak, 'night');
  }
  assert.equal(cleanSkin({ hood: 'tan' }).hood, 'ash', 'a swatch of another palette');
  const tidy = cleanSkin({ ...kept, v: 9, preset: 'drover', extra: { a: 1 }, layers: { hood: false, wings: true } });
  assert.deepEqual(Object.keys(tidy), ['v', ...REGIONS, 'layers']);
  assert.equal(tidy.v, 1);
  assert.deepEqual(tidy.layers, { hood: false, jerkin: true, cloak: true });
  assert.ok(deepFrozen(tidy));
  assert.deepEqual(cleanSkin(tidy), tidy);
  assert.notEqual(cleanSkin(tidy), tidy, 'always a new skin');
});

test('layers must be plain and boolean, or they are worn', () => {
  for (const layers of [null, 'off', [false, false, false], 0, undefined]) {
    assert.deepEqual(cleanSkin({ layers }).layers, DEFAULT_SKIN.layers, String(layers));
  }
  assert.deepEqual(cleanSkin({ layers: { hood: 'false', jerkin: 0, cloak: null } }).layers, DEFAULT_SKIN.layers);
  assert.deepEqual(cleanSkin({ layers: { hood: false, jerkin: false, cloak: false } }).layers,
    { hood: false, jerkin: false, cloak: false });
});

test('only the skin\'s own properties count', () => {
  const inherited = cleanSkin(Object.create({ tone: 'olive', layers: { hood: false } }));
  assert.deepEqual(inherited, DEFAULT_SKIN);
  const layers = cleanSkin({ tone: 'olive', layers: Object.create({ hood: false }) });
  assert.equal(layers.tone, 'olive');
  assert.deepEqual(layers.layers, DEFAULT_SKIN.layers);
  const polluted = JSON.parse('{"__proto__": {"tone": "olive"}, "hair": "grey"}');
  assert.deepEqual(cleanSkin(polluted), { ...DEFAULT_SKIN, hair: 'grey' });
});

test('orcs, goblins and dryads start green and the Oseni red', () => {
  assert.deepEqual(RACE_TONES, { orc: 'olive', goblin: 'fern', dryad: 'sage', oseni: 'ember' });
  const decided = { human: null, elf: null, dwarf: null, orc: 'olive', goblin: 'fern', dryad: 'sage', oseni: 'ember' };
  for (const { id } of RACES) {
    assert.ok(Object.hasOwn(decided, id), `${id} needs a starting tone decided`);
    assert.equal(toneForRace(id), decided[id]);
  }
  for (const tone of Object.values(RACE_TONES)) assert.ok(PALETTES.tone.some((s) => s.id === tone));
  for (const race of ['troll', '', null, 3, 'toString', '__proto__']) assert.equal(toneForRace(race), null);
});

test('skin keys are stable and tell skins apart', () => {
  assert.equal(skinKey(DEFAULT_SKIN), 'weathered,umber,undyed,pewter,ash,tan,umber,saddle,brown,charcoal|111');
  assert.equal(skinKey(), skinKey(DEFAULT_SKIN));
  assert.equal(skinKey(presetSkin('reaver')).endsWith('|110'), true);
  assert.equal(skinKey(cleanSkin({ tone: 'olive' })), skinKey(cleanSkin({ tone: 'olive' })));
});

test('the paint cache stays small', () => {
  const skins = PALETTES.tone.flatMap((tone) => PALETTES.hair.map((hair) => cleanSkin({ tone: tone.id, hair: hair.id })));
  assert.ok(skins.length > 40);
  const first = skinPaint(skins[0]);
  for (const skin of skins) skinPaint(skin);
  const again = skinPaint(skins[0]);
  assert.notEqual(again, first, 'cleared once it passed 32 skins');
  assert.deepEqual(again, first);
  assert.equal(skinPaint(skins[0]), again);
});

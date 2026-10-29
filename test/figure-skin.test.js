import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanSkin, DEFAULT_SKIN, presetSkin, skinPaint } from '../src/character/skin.js';
import { dressFigure, drawFigure, skinMaterials } from '../src/entities/figure.js';
import { wears } from '../src/entities/loadout.js';
import { MATERIALS } from '../src/entities/materials.js';
import { Player } from '../src/entities/player.js';

const GREEN = cleanSkin({ tone: 'olive', hair: 'black', layers: { hood: false } });
const DARK = cleanSkin({ jerkin: 'black', bracers: 'black', boots: 'dark', layers: { cloak: false } });

function outlaw(skin, heading = 0.2) {
  const p = new Player(20.25, 30.5);
  p.heading = heading;
  p.equipment = { mainHand: { id: 'shortSword' } };
  if (skin !== undefined) p.skin = skin;
  p.settleCape();
  return p;
}
// The names of the materials a dressed figure uses, by looking them up.
function names(parts, mats) {
  const byMat = new Map(Object.entries(mats).map(([name, mat]) => [mat, name]));
  return parts.map((part) => byMat.get(part.mat) ?? null);
}
const count = (list, name) => list.filter((n) => n === name).length;

// A digest of every cell drawn, to compare whole figures.
function cells(p) {
  const out = [];
  drawFigure({}, { x0: 0, y0: 0, cols: 60, rows: 60 }, p, dressFigure(p), (r, x, y, g, cr, cg, cb, base, br, bg, bb) => {
    out.push([x, y, g, Math.round(cr * 100), Math.round(cg * 100), Math.round(cb * 100),
      br === undefined ? -1 : Math.round(br * 100), Math.round(bg * 100), Math.round(bb * 100)]);
  });
  let h = 0x811c9dc5;
  for (const c of out.flat()) {
    h ^= c & 0xffffffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return [out.length, h.toString(16), out[Math.floor(out.length / 2)]];
}

test('the default skin draws the figure exactly as before skins', () => {
  // Taken from the figure before skins existed, at five headings.
  const BEFORE = {
    0: [246, '97b65fa3', [18, 17, 11, 9764, 7052, 4701, 948, 768, 916]],
    0.2: [244, '78c3c8da', [21, 17, 29, 7170, 5179, 3452, 948, 768, 916]],
    1.6: [226, 'eb04fc62', [17, 18, 15, 7677, 7534, 8037, 400, 500, 825]],
    3.1: [256, 'c9ee45b', [20, 18, 92, 8743, 6491, 4107, 648, 636, 1012]],
    '-2': [235, '4f56735f', [24, 18, 10, 5078, 4903, 5604, 648, 636, 1012]],
  };
  for (const [heading, before] of Object.entries(BEFORE)) {
    assert.deepEqual(cells(outlaw(undefined, Number(heading))), before, `heading ${heading}`);
    assert.deepEqual(cells(outlaw(cleanSkin({}), Number(heading))), before, 'an equal skin draws the same');
  }
});

test('the default skin dresses in the shared materials themselves', () => {
  assert.equal(skinMaterials(DEFAULT_SKIN), MATERIALS);
  assert.equal(skinMaterials(), MATERIALS);
  assert.equal(skinMaterials(cleanSkin({ layers: { cloak: false } })), MATERIALS, 'layers change no colour');
  const parts = dressFigure(outlaw());
  const mats = new Set(Object.values(MATERIALS));
  assert.ok(parts.every((part) => mats.has(part.mat) || part.mat.color), 'only shared materials, or weapon tints');
  const bare = outlaw();
  bare.skin = undefined;
  assert.deepEqual(names(dressFigure(bare), MATERIALS), names(parts, MATERIALS));
});

test('a skin dresses in recoloured copies that keep the textures', () => {
  const mats = skinMaterials(DARK);
  assert.equal(skinMaterials(DARK), mats, 'cached per skin');
  assert.notEqual(skinMaterials(cleanSkin(DARK)), undefined);
  const paint = skinPaint(DARK);
  for (const name of ['jerkin', 'bracer', 'glove', 'boot', 'cuff']) {
    assert.notEqual(mats[name], MATERIALS[name], name);
    assert.deepEqual(mats[name].color, paint[name]);
    assert.equal(mats[name].tex, MATERIALS[name].tex, `${name} keeps its texture`);
  }
  for (const name of ['hood', 'cloak', 'lining', 'leather', 'quiver', 'iron', 'void', 'glint']) {
    assert.equal(mats[name], MATERIALS[name], `${name} unchanged`);
  }
  assert.deepEqual(MATERIALS.jerkin.color, [108, 78, 52], 'the shared table is never changed');
});

test('gloves and boot cuffs follow the skin; the belt and scabbard stay leather', () => {
  const mats = skinMaterials(DARK);
  const list = names(dressFigure(outlaw(DARK)), mats);
  assert.equal(count(list, 'glove'), 2);
  assert.equal(count(list, 'cuff'), 2);
  assert.ok(count(list, 'leather') >= 4, 'belt, pouch, scabbard, bow grip');
  assert.equal(mats.leather.color, MATERIALS.leather.color);
});

test('with the cloak off there is no cloak; with the jerkin off the linen shows', () => {
  const p = outlaw(DARK);
  const mats = skinMaterials(DARK);
  const list = names(dressFigure(p), mats);
  assert.equal(count(list, 'cloak') + count(list, 'lining'), 0);
  assert.ok(count(names(dressFigure(outlaw()), MATERIALS), 'cloak') > 0);
  const linen = cleanSkin({ layers: { jerkin: false } });
  const shirt = names(dressFigure(outlaw(linen)), skinMaterials(linen));
  assert.equal(count(shirt, 'jerkin') + count(shirt, 'tunic') + count(shirt, 'sleeve'), 0);
  assert.equal(count(shirt, 'linen'), 7, 'body, two skirt panels and four sleeves');
});

test('with the hood down the face, hair and eyes show in the skin\'s colours', () => {
  const mats = skinMaterials(GREEN);
  assert.deepEqual(mats.skin.color, [108, 120, 72]);
  assert.deepEqual(mats.hair.color, [30, 28, 30]);
  for (const heading of [0, Math.PI]) {
    const parts = dressFigure(outlaw(GREEN, heading));
    const list = names(parts, mats);
    assert.equal(count(list, 'hood'), 0);
    assert.equal(count(list, 'glint'), 0);
    assert.equal(count(list, 'skin'), 2, 'neck and head');
    assert.equal(count(list, 'hair'), 1);
    assert.equal(count(list, 'void'), 2, 'two eyes, no face shadow');
    // The hair caps the head: over the crown when the face is turned to the
    // camera, over the whole back of the head when turned away. The eyes
    // are in front only when the face is turned to the camera.
    const area = (i) => (parts[i].x1 - parts[i].x0) * (parts[i].y1 - parts[i].y0);
    const head = [list.indexOf('skin'), list.lastIndexOf('skin')].sort((a, b) => area(b) - area(a))[0];
    const hair = list.indexOf('hair');
    const eye = list.indexOf('void');
    assert.ok(parts[hair].y0 < parts[head].y0, 'the hair rises above the face');
    assert.equal(hair > head, heading !== 0, `hair sorting, heading ${heading}`);
    assert.equal(eye > head, heading === 0, `eyes, heading ${heading}`);
  }
  // The hood draws the face shadow, the jaw and a glint of eyes.
  const hooded = names(dressFigure(outlaw()), MATERIALS);
  assert.equal(count(hooded, 'void'), 1);
  assert.equal(count(hooded, 'skin'), 1);
  assert.equal(count(hooded, 'glint'), 2);
  assert.ok(count(hooded, 'hood') > 5);
  assert.equal(count(hooded, 'hair'), 0);
});

test('the bare head\'s eyes close with a blink', () => {
  const p = outlaw(GREEN);
  p.blink = 1;
  assert.equal(count(names(dressFigure(p), skinMaterials(GREEN)), 'void'), 0);
});

test('a skin changes the figure\'s colours but not its shape', () => {
  const plain = cells(outlaw());
  const reaver = presetSkin('reaver');
  const p = outlaw(reaver);
  const drawn = cells(p);
  assert.notDeepEqual(drawn, plain);
  const greenwood = outlaw(presetSkin('greenwood'));
  const shape = (o) => dressFigure(o).map((part) => [part.x0, part.y0, part.x1, part.y1].map((n) => n.toFixed(6)).join());
  assert.deepEqual(shape(greenwood), shape(outlaw()), 'same parts, same places');
  assert.equal(DEFAULT_SKIN.layers.hood, true);
});

test('the skin can take off the hood, jerkin and cloak, and nothing else', () => {
  for (const equipment of [undefined, {}]) {
    for (const slot of ['helm', 'chest', 'legs', 'feet', 'hands', 'cape']) assert.equal(wears(equipment, slot), true, slot);
    const bare = cleanSkin({ layers: { hood: false, jerkin: false, cloak: false } });
    assert.deepEqual(['helm', 'chest', 'legs', 'feet', 'hands', 'cape'].map((slot) => wears(equipment, slot, bare)),
      [false, false, true, true, true, false]);
    assert.equal(wears(equipment, 'chest', cleanSkin({ layers: { hood: false } })), true);
  }
  assert.equal(wears({}, 'offHand', DEFAULT_SKIN), false);
  assert.equal(wears({ feet: null }, 'feet'), true, 'boots are part of the outfit');
  assert.equal(wears({}, 'quiver'), false);
  assert.equal(wears({ offHand: { id: 'lute' } }, 'offHand', presetSkin('reaver')), true);
});

test('a new player wears today\'s outlaw and keeps their skin after a defeat', () => {
  const p = new Player(0, 0);
  assert.equal(p.skin, DEFAULT_SKIN);
  const skin = presetSkin('pilgrim');
  p.skin = skin;
  p.respawn(4, 5);
  assert.equal(p.skin, skin);
  assert.deepEqual([p.x, p.y], [4, 5]);
});

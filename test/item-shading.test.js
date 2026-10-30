import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { WEAPON_MATERIALS, weaponMaterial } from '../src/entities/weapons.js';
import { ITEMS } from '../src/inventory/items.js';
import { DOLL_BOXES } from '../src/ui/paper-doll.js';
import {
  ASPECT, GRIDS, SX, SY, artKey, artTint, cellsFromPixels, drawCells, gridOf, hash, poseAngle, rampChar, seedOf, shapeOf,
} from '../src/ui/item-shading.js';

test('the shading imports nothing: plain grids, pixels and ramps in, cells out', () => {
  const source = readFileSync(new URL('../src/ui/item-shading.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.doesNotMatch(source, /\bimport\(/);
});

test('every doll box has a grid shaped like the box at its desktop size, and cards are 1 : 2', () => {
  // The .equipment-slots rule at its 500 px frame: 8 columns, 8 px gaps,
  // rows 0.81 of a column.
  const column = (500 - 7 * 8) / 8;
  const row = column * 0.81;
  for (const box of Object.values(DOLL_BOXES)) {
    const grid = GRIDS[shapeOf(box)];
    assert.ok(grid, shapeOf(box));
    const width = box.width * column + (box.width - 1) * 8;
    const height = box.height * row + (box.height - 1) * 8;
    const aspect = (grid.cols * ASPECT) / grid.rows;
    assert.ok(Math.abs(aspect / (width / height) - 1) < 0.06, `${shapeOf(box)} aspect`);
    assert.ok(Math.abs((grid.cols * ASPECT * grid.font) / width - 1) < 0.03, `${shapeOf(box)} letters fill the box`);
  }
  const card = GRIDS.card;
  assert.ok(Math.abs((card.cols * ASPECT) / card.rows / 0.5 - 1) < 0.03);
  assert.equal(shapeOf(DOLL_BOXES.mainHand), '2x4');
  assert.equal(shapeOf(DOLL_BOXES.quiver), '1x1');
});

test('a box far from its desktop shape, as on phones, gets rows to match its own', () => {
  assert.equal(gridOf('2x2', 1.2), GRIDS['2x2'], 'the desktop shape');
  assert.equal(gridOf('2x2', 1.16), GRIDS['2x2'], 'a phone in landscape is close enough');
  assert.equal(gridOf('2x2', 0), GRIDS['2x2'], 'a hidden box');
  assert.equal(gridOf('2x2', NaN), GRIDS['2x2']);
  // A phone in portrait: 85 × 86 inside the padding.
  const portrait = gridOf('2x2', 85 / 86);
  assert.deepEqual(portrait, { ...GRIDS['2x2'], rows: 18 });
  assert.ok(Math.abs((portrait.cols * ASPECT) / portrait.rows / (85 / 86) - 1) < 0.03);
  assert.equal(gridOf('2x4', 85 / 182).rows, 39);
  assert.equal(gridOf('1x1', 29 / 38).cols, 14, 'the same letters across');
});

test('long items lie on the grid diagonal', () => {
  assert.ok(Math.abs((poseAngle(GRIDS.card) * 180) / Math.PI - 63.4) < 0.1);
  assert.ok(Math.abs((poseAngle(GRIDS['2x4']) * 180) / Math.PI - 59.9) < 0.1);
});

test('a stack takes its own colour, else its weapon tier; other items none', () => {
  const sword = ITEMS.shortSword;
  assert.deepEqual(artTint({ id: 'shortSword' }, sword, { colour: '#aa3322' }, weaponMaterial), [170, 51, 34]);
  assert.deepEqual(artTint({ id: 'shortSword' }, sword, { colour: 'AA3322' }, weaponMaterial), [170, 51, 34]);
  assert.equal(artTint({ id: 'shortSword', material: 'steel' }, sword, { colour: null }, weaponMaterial), WEAPON_MATERIALS.steel.color);
  assert.equal(artTint({ id: 'shortSword' }, sword, null, weaponMaterial), WEAPON_MATERIALS.iron.color, 'iron by default');
  assert.equal(artTint({ id: 'stonePickaxe' }, ITEMS.stonePickaxe, null, weaponMaterial), WEAPON_MATERIALS.stone.color);
  const forged = { id: 'shortSword', material: 'iron', forged: { metal: 'Red', colour: '113355' } };
  assert.deepEqual(artTint(forged, sword, null, weaponMaterial), [17, 51, 85]);
  assert.equal(artTint({ id: 'oakLog' }, ITEMS.oakLog, null, weaponMaterial), null);
  assert.equal(artTint({ id: 'arrow', material: 'bronze' }, ITEMS.arrow, null, weaponMaterial), WEAPON_MATERIALS.bronze.color, 'arrowheads take their stack\'s metal');
  assert.equal(artTint({ id: 'arrow' }, ITEMS.arrow, null, weaponMaterial), null);
  assert.deepEqual(artTint({ id: 'alloyIngot' }, ITEMS.alloyIngot, { colour: 'C2A583' }, weaponMaterial), [194, 165, 131], 'an alloy ingot is its alloy\'s colour');
});

test('a picture key tells tints, shapes and pixel ratios apart', () => {
  const iron = artKey('shortSword', '', WEAPON_MATERIALS.iron.color, '2x4', 1);
  assert.equal(iron, 'shortSword||a7b4c3|2x4|1');
  assert.notEqual(iron, artKey('shortSword', '', WEAPON_MATERIALS.steel.color, '2x4', 1));
  assert.notEqual(artKey('shortSword', '', [1, 2, 3], 'card', 1), artKey('shortSword', '', [1, 2, 4], 'card', 1));
  assert.notEqual(iron, artKey('shortSword', '', WEAPON_MATERIALS.iron.color, 'card', 1));
  assert.notEqual(iron, artKey('shortSword', '', WEAPON_MATERIALS.iron.color, '2x4', 2));
  assert.equal(iron, artKey('shortSword', '', [...WEAPON_MATERIALS.iron.color], '2x4', 1), 'equal tints share');
  assert.equal(artKey('oakLog', '', null, 'card', 1), 'oakLog|||card|1');
});

test('the hash is steady and spread over 0..1, and ramps pick by light', () => {
  const values = [];
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) values.push(hash(x, y, 7));
  assert.ok(values.every((v) => v >= 0 && v < 1));
  assert.ok(new Set(values).size > 390);
  assert.equal(hash(3, 4, 5), hash(3, 4, 5));
  assert.notEqual(seedOf('shortSword'), seedOf('greatsword'));
  const ramp = [['.'], ['a', 'b'], ['@']];
  assert.equal(rampChar(ramp, -1, 0), '.');
  assert.equal(rampChar(ramp, 0.5, 0), 'a');
  assert.equal(rampChar(ramp, 0.5, 0.9), 'b');
  assert.equal(rampChar(ramp, 2, 0), '@');
});

// A picture `cols` × `rows` cells, every sample from `sample(x, y, i, j)`:
// null for empty, else [r, g, b, paint].
function picture(cols, rows, sample) {
  const w = cols * SX;
  const h = rows * SY;
  const shade = new Uint8Array(w * h * 4);
  const ids = new Uint8Array(w * h * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) for (let j = 0; j < SY; j++) for (let i = 0; i < SX; i++) {
    const s = sample(x, y, i, j);
    if (!s) continue;
    const o = ((h - 1 - (y * SY + j)) * w + x * SX + i) * 4;
    shade.set([s[0], s[1], s[2], 255], o);
    ids[o] = s[3] * 8 + 4;
  }
  return { shade, ids, grid: { cols, rows } };
}

const PAINTS = [
  { ramp: [['.'], [':'], ['#'], ['@']], lum: 0.5, floor: 0, gain: 1 },
  { ramp: [['-'], ['=']], lum: 0.5, floor: 0, gain: 1, glint: '/' },
  { ramp: [['|']], lum: 1, floor: 0, gain: 1, edge: true },
];
const outline = (mx, my, cover) => ({ ch: my > 0 ? '_' : mx < 0 ? '|' : '/', rim: cover > 0.3 ? 1 : 0 });

test('full cells shade by light against their paint, part cells take an edge, and a few samples nothing', () => {
  const { shade, ids, grid } = picture(6, 1, (x, y, i, j) => {
    if (x === 0) return [255, 255, 255, 0]; // bright
    if (x === 1) return [10, 10, 10, 0]; // dark
    if (x === 2) return i === 0 && j < 2 ? [200, 200, 200, 0] : null; // two samples
    if (x === 3) return j >= SY - 2 ? [100, 100, 100, 0] : null; // the bottom third
    if (x === 4) return i === 0 ? [100, 100, 100, 0] : null; // the left quarter
    return [64, 64, 64, 1]; // another paint
  });
  const cells = cellsFromPixels({ shade, ids, grid, paints: PAINTS, outline, seed: 1 });
  assert.deepEqual(cells.map((c) => [c.x, c.ch]), [[0, '@'], [1, '.'], [3, '_'], [4, '|'], [5, '=']]);
  assert.deepEqual([cells[0].r, cells[0].g, cells[0].b], [255, 255, 255]);
  assert.equal(cells[1].r, 24 + 10 * 1.3, 'fills are lifted to read on black');
  // An edge facing the light is lifted towards white.
  assert.ok(Math.abs(cells[2].r - (85 + (255 - 85) * 0.35)) < 1e-9);
  assert.deepEqual(cellsFromPixels({ shade, ids, grid, paints: PAINTS, outline, seed: 1 }), cells, 'the same every time');
});

test('the majority paint picks the ramp; bright metal glints, and stroke paints are always edges', () => {
  const { shade, ids, grid } = picture(40, 2, (x, y, i, j) => (y === 1 ? [255, 255, 255, 2] : [255, 255, 255, i + j < 7 ? 1 : 0]));
  const cells = cellsFromPixels({ shade, ids, grid, paints: PAINTS, outline, seed: 3 });
  const top = cells.filter((c) => c.y === 0).map((c) => c.ch);
  assert.ok(top.includes('='), 'paint 1 holds most samples');
  assert.ok(top.includes('/'), 'with a glint here and there');
  assert.ok(top.every((ch) => ch === '=' || ch === '/'));
  assert.ok(cells.filter((c) => c.y === 1).every((c) => c.ch === '/' || c.ch === '|' || c.ch === '_'));
  const small = picture(1, 1, (x, y, i, j) => (i === 0 && j < 2 ? [99, 99, 99, 0] : null));
  assert.equal(cellsFromPixels({ ...small, grid: { cols: 1, rows: 1, minHits: 2 }, paints: PAINTS, outline }).length, 1,
    'small boxes keep thinner cells');
  const unknown = picture(1, 1, () => [255, 255, 255, 9]);
  assert.equal(cellsFromPixels({ ...unknown, paints: PAINTS, outline })[0].ch, '@', 'an unknown paint draws as the first');
});

test('a speckled paint has a share of pale dots', () => {
  const { shade, ids, grid } = picture(40, 4, () => [100, 100, 100, 0]);
  const plain = cellsFromPixels({ shade, ids, grid, paints: PAINTS, outline, seed: 5 });
  const cells = cellsFromPixels({ shade, ids, grid, paints: [{ ...PAINTS[0], speckle: 0.12 }], outline, seed: 5 });
  const dots = cells.filter((c) => c.ch === '.');
  assert.ok(dots.length > 8 && dots.length < 32, `${dots.length} of 160`);
  assert.ok(plain.every((c) => c.ch !== '.'));
  assert.ok(dots.every((c) => c.r > plain[0].r), 'paler than the stone round them');
});

test('cells are drawn on a dark silhouette, one fill colour per group of letters', () => {
  const calls = [];
  const ctx = {
    set fillStyle(v) { calls.push(['style', v]); },
    set font(v) { calls.push(['font', v]); },
    set textBaseline(v) { calls.push(['baseline', v]); },
    fillRect: (...a) => calls.push(['rect', ...a]),
    fillText: (...a) => calls.push(['text', ...a]),
  };
  drawCells(ctx, [{ x: 2, y: 3, ch: 'Q', r: 100, g: 50, b: 20 }, { x: 3, y: 3, ch: '@', r: 101, g: 50, b: 20 }], 10);
  assert.deepEqual(calls[0], ['style', 'rgb(3,4,7)']);
  assert.equal(calls.filter((c) => c[0] === 'rect').length, 12, 'one cell round both');
  assert.deepEqual(calls.find((c) => c[0] === 'rect'), ['rect', 6, 20, 6, 10]);
  assert.ok(calls.some((c) => c[0] === 'font' && c[1].startsWith('10px "Cascadia Mono"')));
  assert.deepEqual(calls.filter((c) => c[0] === 'style').map((c) => c[1]), ['rgb(3,4,7)', 'rgb(102,48,18)']);
  assert.deepEqual(calls.filter((c) => c[0] === 'text'), [['text', 'Q', 12, 30], ['text', '@', 18, 30]]);
});

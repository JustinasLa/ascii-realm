import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { INSTRUMENT_IDS } from '../src/audio/instruments.js';
import { dressFigure, drawFigure, instrumentFamily } from '../src/entities/figure.js';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';

const view = { x0: -30, y0: -30, cols: 60, rows: 60 };
const FAMILY = { lute: 'strings', celticHarp: 'strings', dulcimer: 'strings', vielle: 'strings',
  flute: 'wind', bagpipe: 'wind', accordion: 'wind', trumpet: 'brass', kalimba: 'tines' };

function render(player) {
  const cells = new Map();
  drawFigure({}, view, player, dressFigure(player), (r, x, y, ...appearance) => {
    cells.set(`${x + view.x0},${y + view.y0}`, appearance);
  });
  return cells;
}

// A friend as the lobby sends them: equipment only, no main-hand weapon.
function friend(offHand, heading = 0) {
  const player = new Player(0, 0);
  player.heading = heading;
  player.settleCape();
  const inventory = new Inventory({ starter: false });
  player.equipment = { ...inventory.equipment, offHand: offHand ? { id: offHand, count: 1 } : null };
  return player;
}

test('instruments sort into four families, and nothing else is one', () => {
  for (const id of INSTRUMENT_IDS) assert.equal(instrumentFamily(id), FAMILY[id], id);
  for (const id of ['woodenBuckler', undefined, null, 'nope', 'toString', 'shortSword']) assert.equal(instrumentFamily(id), null);
});

test('a friend holding each instrument is drawn holding its family shape, in its colour', () => {
  for (const id of INSTRUMENT_IDS) {
    const parts = dressFigure(friend(id)).filter((part) => part.mat?.family);
    assert.ok(parts.length >= 2, id);
    assert.ok(parts.every((part) => part.mat.family === FAMILY[id]), id);
    assert.ok(parts.some((part) => part.mat.color.join() === ITEMS[id].colour.join()), `${id} shows its own colour`);
  }
});

test('the instrument adds cells beside the off arm, facing south and east', () => {
  for (const id of ['lute', 'flute', 'trumpet', 'kalimba']) {
    for (const heading of [0, Math.PI / 2]) {
      const empty = render(friend(null, heading));
      const held = render(friend(id, heading));
      const added = [...held.keys()].filter((key) => !empty.has(key));
      assert.ok(added.length > 0, `${id} at ${heading}`);
      if (heading === 0) {
        assert.ok(added.every((key) => Number(key.split(',')[0]) > 0), `${id} hangs on the off-hand side`);
      }
    }
  }
});

// Every drawn cell of a friend with the buckler or an empty off hand, hashed,
// as drawn before instruments could be held (main at 1920eea).
const BEFORE = {
  'woodenBuckler:0.000': 'c099d132965e13c4', 'woodenBuckler:1.571': '64e3824f16ef7c04',
  'woodenBuckler:3.142': 'c3348a2be9dcb051', 'woodenBuckler:-1.571': 'b44e093e54d5489d',
  'null:0.000': 'f3526864a4359cce', 'null:1.571': 'f2acd618e34b3211',
  'null:3.142': '238a6d063b09f329', 'null:-1.571': 'cd8f03bc6bb20fdc',
};

test('the buckler and an empty off hand dress exactly as before, with no instrument parts', () => {
  for (const offHand of ['woodenBuckler', null]) {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const player = friend(offHand, heading);
      assert.equal(dressFigure(player).some((part) => part.mat?.family), false);
      const cells = [];
      drawFigure({}, view, player, dressFigure(player), (r, x, y, ...a) => cells.push([x, y,
        ...a.map((v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v))]));
      const hash = createHash('sha256').update(JSON.stringify(cells)).digest('hex').slice(0, 16);
      assert.equal(hash, BEFORE[`${offHand}:${heading.toFixed(3)}`], `${offHand} at ${heading}`);
    }
  }
});

test('a wading friend still holds their instrument', () => {
  const player = friend('lute');
  player.waterDepth = 0.3;
  assert.ok(dressFigure(player).some((part) => part.mat?.family === 'strings'));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSkin, DEFAULT_SKIN, presetSkin } from '../src/character/skin.js';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { CharacterPortrait } from '../src/ui/portrait.js';

function canvasFixture() {
  const context = {
    cells: [], clears: 0, transforms: [],
    setTransform(...values) { this.transforms.push(values); },
    clearRect() { this.clears++; this.cells = []; },
    fillText(glyph, x, y) { this.cells.push({ glyph, x, y, color: this.fillStyle }); },
  };
  const canvas = { style: {}, getContext(kind) { return kind === '2d' ? context : null; } };
  return { canvas, context };
}

function gearedPlayer() {
  const inventory = new Inventory();
  const player = new Player(137, -52);
  player.equipment = inventory.equipment;
  player.heading = 2.7;
  player.walk = 1;
  player.run = 1;
  player.phase = 2.2;
  player.time = 42;
  player.settleCape();
  return { player, inventory };
}

test('portrait renders colored glyphs on a transparent DPR-scaled canvas without DOM globals', () => {
  const { canvas, context } = canvasFixture();
  const portrait = new CharacterPortrait(canvas, { pixelRatio: 2 });
  const { player } = gearedPlayer();
  assert.equal(portrait.update(player), true);
  assert.equal(canvas.width, 518);
  assert.equal(canvas.height, 792);
  assert.equal(canvas.style.aspectRatio, '259.2 / 396');
  assert.equal(canvas.style.width, undefined, 'layout sizing remains controlled by CSS');
  assert.deepEqual(context.transforms[0], [2, 0, 0, 2, 0, 0]);
  assert.ok(context.cells.length > 80, 'a complete ASCII warrior is rendered');
  assert.ok(context.cells.every((cell) => cell.glyph.length === 1 && cell.glyph !== ' '));
  assert.ok(context.cells.every((cell) => /^rgb\(\d+, \d+, \d+\)$/.test(cell.color)));
  assert.ok(new Set(context.cells.map((cell) => cell.color)).size > 10,
    'equipment retains the renderer\'s varied material colors');
});

test('portrait never mutates the world player or its equipment and ignores animation changes', () => {
  const { canvas, context } = canvasFixture();
  const portrait = new CharacterPortrait(canvas, { pixelRatio: 1 });
  const { player } = gearedPlayer();
  player.combat.toggle();
  for (let i = 0; i < 30; i++) player.combat.update(1 / 60, false);
  const before = structuredClone(player);
  assert.equal(portrait.update(player), true);
  assert.deepEqual(structuredClone(player), before);
  assert.notEqual(portrait.preview, player);
  assert.notEqual(portrait.preview.equipment, player.equipment);
  assert.notEqual(portrait.preview.equipment.helm, player.equipment.helm);
  assert.equal(portrait.preview.combat.inHand, false, 'the portrait keeps its own sheathed pose');
  const rendered = structuredClone(context.cells);
  player.x += 40;
  player.y -= 12;
  player.heading = 0;
  player.time += 1;
  assert.equal(portrait.update(player), false);
  player.equipment = structuredClone(player.equipment);
  assert.equal(portrait.update(player), false, 'equivalent gear does not redraw');
  assert.deepEqual(context.cells, rendered);
  assert.equal(context.clears, 1);
});

test('the portrait follows the sword in hand while the clothes always stay on', () => {
  const { canvas, context } = canvasFixture();
  const portrait = new CharacterPortrait(canvas, { pixelRatio: 1 });
  const { player, inventory } = gearedPlayer();
  portrait.update(player);
  const equipped = structuredClone(context.cells);
  assert.equal(inventory.unequip('helm'), true);
  portrait.update(player);
  assert.deepEqual(context.cells, equipped, 'the hood is part of the character for now');
  assert.equal(inventory.unequip('mainHand'), true);
  assert.equal(portrait.update(player), true);
  assert.notDeepEqual(context.cells, equipped, 'taking off the sword changes the portrait');
  assert.equal(inventory.equip(inventory.slots.findIndex((stack) => stack?.id === 'shortSword')), true);
  assert.equal(inventory.equip(inventory.slots.findIndex((stack) => stack?.id === 'outlawHood')), true);
  assert.equal(portrait.update(player), true);
  assert.deepEqual(context.cells, equipped);
});

test('portrait dimensions and font can be configured without affecting the game player', () => {
  const { canvas, context } = canvasFixture();
  const portrait = new CharacterPortrait(canvas,
    { columns: 40, rows: 40, fontSize: 10, fontFamily: 'monospace', pixelRatio: 1 });
  portrait.update(gearedPlayer().player);
  assert.equal(canvas.width, 240);
  assert.equal(canvas.height, 400);
  assert.equal(context.font, '10px monospace');
  assert.equal(portrait.width, 240);
  assert.equal(portrait.height, 400);
  portrait.destroy();
  assert.equal(portrait.update(gearedPlayer().player), false);
  assert.equal(context.cells.length, 0);
});

test('the portrait wears the player\'s skin and redraws when it changes', () => {
  const { canvas, context } = canvasFixture();
  const portrait = new CharacterPortrait(canvas);
  const { player } = gearedPlayer();
  assert.equal(portrait.update(player), true);
  assert.equal(portrait.preview.skin, DEFAULT_SKIN);
  const plain = context.cells.map((cell) => cell.color).join();
  assert.equal(portrait.update(player), false, 'nothing changed');
  player.skin = presetSkin('reaver');
  assert.equal(portrait.update(player), true);
  assert.equal(portrait.preview.skin, player.skin);
  assert.notEqual(context.cells.map((cell) => cell.color).join(), plain);
  assert.equal(portrait.update(player), false, 'the same skin');
  player.skin = cleanSkin(player.skin);
  assert.equal(portrait.update(player), true, 'another skin object redraws');
  assert.equal(player.skin.hood, 'oxblood', 'the player\'s skin is untouched');
});

test('the portrait redraws when the sword in hand is swapped for a forged one', () => {
  const { canvas, context } = canvasFixture();
  const portrait = new CharacterPortrait(canvas, { pixelRatio: 1 });
  const { player, inventory } = gearedPlayer();
  portrait.update(player);
  const starter = structuredClone(context.cells);
  inventory.add('shortSword', 1, { forged: { metal: 'Blackiron', colour: 'A77C63', quality: 'rusted', hits: 10,
    stats: { attackDamage: 4 }, inputs: { a1: 4 } } });
  assert.equal(inventory.equip(inventory.slots.findIndex((stack) => stack?.forged)), true);
  assert.equal(portrait.update(player), true);
  assert.notDeepEqual(context.cells, starter, 'its guard and pommel take the alloy\'s colour');
  assert.equal(portrait.update(player), false);
});

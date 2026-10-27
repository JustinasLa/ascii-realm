import assert from 'node:assert/strict';
import test from 'node:test';
import { ROSTER_KEY } from '../src/character/roster.js';
import { cleanSkin, DEFAULT_SKIN } from '../src/character/skin.js';
import { loadGame } from './helpers/main-game.js';

const memory = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
};
const saved = JSON.stringify({ v: 1, rev: 1, active: 'c0001', characters: [
  { id: 'c0001', createdAt: 1, switchedAt: null, sheet: { name: 'Bryn' }, skin: { tone: 'sage' } }] });

test('start-up opens the creator only with ?creator', async () => {
  const plain = await loadGame(undefined, { phone: true, href: 'http://localhost/?debug' });
  assert.equal(plain.game.creator.isOpen, false, 'not yet for a first visit');
  assert.equal(plain.gateButton.hidden, false, 'the play card shows as before');

  const harness = await loadGame(undefined, { phone: true, href: 'http://localhost/?creator' });
  const { creator } = harness.window.game ?? {};
  assert.equal(creator, undefined, 'without ?debug nothing is exposed');
  assert.ok(harness.blocked(), 'gameplay is blocked');
  assert.equal(harness.gateButton.hidden, true, 'the play card waits for the creator');
});

test('?creator opens Welcome on a blank draft, and ?debug&creator=<page> a sample on that page', async () => {
  const blank = await loadGame(undefined, { href: 'http://localhost/?debug&creator' });
  const [options] = blank.game.creator.opened;
  assert.equal(options.start, 'welcome');
  assert.equal(options.draft, null);
  assert.equal(options.roster, blank.game.characters);
  const page = await loadGame(undefined, { href: 'http://localhost/?debug&creator=age' });
  const [sample] = page.game.creator.opened;
  assert.equal(sample.start, 'age');
  assert.equal(sample.draft.sheet.name, 'Arwen Vale');
  assert.equal(page.game.creator.outside.length, 8);
});

test('the creator previews skins, and closing restores the character\'s and starts play', async () => {
  const harness = await loadGame(undefined, { phone: true, href: 'http://localhost/?debug&creator',
    real: { localStorage: memory({ [ROSTER_KEY]: saved }) } });
  const { game } = harness;
  const olive = cleanSkin({ tone: 'olive' });
  game.creator.onPreview(olive);
  assert.equal(game.player.skin, olive);
  harness.setHidden(true);
  harness.setHidden(false);
  assert.equal(harness.gateButton.hidden, true, 'no resume card over the creator');
  game.inventoryScreen.isOpen = false;
  game.creator.close();
  assert.deepEqual(game.player.skin, cleanSkin({ tone: 'sage' }));
  assert.equal(harness.blocked(), false);
  assert.equal(harness.gateButton.hidden, false, 'the play card starts play on a phone');
  assert.equal(game.player.skin === DEFAULT_SKIN, false);
});

test('while the creator is open, nothing can hurt the player', async () => {
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug&creator' });
  const { game } = harness;
  const { player } = game;
  const casts = [];
  game.casting.cast = (...args) => casts.push(args);
  const health = player.vitals.health;
  assert.equal(player.takeDamage(30), 0, 'a blow, a spell or a burn lands on nothing');
  assert.equal(player.vitals.health, health);
  game.multiplayer.id = 'a1';
  game.multiplayer.players = [{ id: 'b2', state: { x: 1, y: 1, health: 100 } }];
  const spell = { id: 'firebolt', casterId: 'b2', targetId: 'a1', heading: 0, aim: null };
  game.multiplayer.onCast(spell);
  assert.equal(casts.length, 0, 'a friend\'s spell at the player is dropped');
  game.multiplayer.onCast({ ...spell, targetId: 'b2' });
  assert.equal(casts.length, 1, 'other spells still play');
  game.multiplayer.onCast({ ...spell, casterId: 'gone' });
  assert.equal(casts.length, 1);
  game.creator.close();
  game.multiplayer.onCast(spell);
  assert.equal(casts.length, 2);
  assert.equal(casts[1][1].target, player);
  assert.equal(player.takeDamage(30), 30);
  assert.equal(player.vitals.health, health - 30);
});

test('a lobby join waits for the creator to close', async () => {
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug&creator' });
  const { game } = harness;
  game.multiplayer.connect({ mode: 'join', code: 'ABC234' });
  game.multiplayer.connect({ mode: 'join', code: 'XYZ567' });
  assert.deepEqual(game.multiplayer.connects, [], 'nothing connects while creating');
  game.creator.close();
  assert.deepEqual(game.multiplayer.connects, [{ mode: 'join', code: 'XYZ567' }], 'the last join is made');
  game.multiplayer.connect({ mode: 'create' });
  assert.equal(game.multiplayer.connects.length, 2, 'once closed, joins go straight through');
  game.creator.close = () => {};
  const plain = await loadGame();
  plain.game.multiplayer.connect({ mode: 'create' });
  assert.equal(plain.game.multiplayer.connects.length, 1);
});

test('foes hold still and the own nameplate hides while the creator is open', async () => {
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug&creator' });
  const { game } = harness;
  const steps = [];
  game.monsters.update = (dt) => steps.push(['monsters', dt]);
  game.animals.update = (dt) => steps.push(['animals', dt]);
  game.model.top = 40;
  harness.frame();
  assert.deepEqual(steps, [['monsters', 0], ['animals', 0]]);
  assert.equal(game.nameplates.updates.at(-1).plates.length, 0);
  assert.equal(game.chat.mayOpen(), false, 'chat stays shut');
  game.creator.close();
  steps.length = 0;
  harness.frame();
  assert.ok(steps.every(([, dt]) => dt > 0));
  assert.equal(steps.length, 2);
  assert.equal(game.nameplates.updates.at(-1).plates.length, 1);
});

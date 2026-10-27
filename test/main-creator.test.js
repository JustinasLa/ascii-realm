import assert from 'node:assert/strict';
import test from 'node:test';
import { ROSTER_KEY } from '../src/character/roster.js';
import { sampleDraft } from '../src/character/creation.js';
import { cleanSkin, DEFAULT_SKIN } from '../src/character/skin.js';
import { Spellcasting } from '../src/spells/casting.js';
import { loadGame } from './helpers/main-game.js';

const memory = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
};
const saved = JSON.stringify({ v: 1, rev: 1, active: 'c0001', characters: [
  { id: 'c0001', createdAt: 1, switchedAt: null, sheet: { name: 'Bryn' }, skin: { tone: 'sage' } }] });

test('a first visit opens the creator instead of the play card', async () => {
  const harness = await loadGame(undefined, { phone: true, href: 'http://localhost/?debug', creator: true });
  assert.equal(harness.game.creator.opened.length, 1);
  assert.equal(harness.game.creator.opened[0].start, 'welcome');
  assert.ok(harness.blocked(), 'gameplay is blocked');
  assert.equal(harness.gateButton.hidden, true, 'the play card waits for the creator');

  const hidden = await loadGame(undefined, { phone: true, href: 'http://localhost/?creator' });
  assert.equal(hidden.window.game, undefined, 'without ?debug nothing is exposed');
  assert.ok(hidden.blocked());

  const skips = async (href, real = {}) => (await loadGame(undefined, { href, real, creator: true })).game.creator.opened.length;
  assert.equal(await skips('http://localhost/?debug&nocreator'), 0, '?nocreator plays at once');
  assert.equal(await skips('http://localhost/?debug&nogate'), 0, 'and so does ?nogate');
  assert.equal(await skips('http://localhost/?debug', { localStorage: memory({ [ROSTER_KEY]: saved }) }), 0, 'a character exists');
  assert.equal(await skips('http://localhost/?debug', { localStorage: memory({ [ROSTER_KEY]: JSON.stringify({ v: 99 }) }) }), 0,
    'a roster that cannot create plays as before');
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
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug&creator', real: { Spellcasting } });
  const { game } = harness;
  const { player, casting } = game;
  // A friend's rune that strikes its target at once.
  const strike = { id: 'strike', root: 'strike', variants: [{ id: 'rune', kind: 'rune', params: { mana: 1 } }],
    nodes: { strike: { steps: [{ op: 'mmodamage', args: { a: '20', ii: 'true' }, target: { op: 'target', args: {} } }] } } };
  casting.spells = new Map([[strike.id, strike]]);
  const casts = [];
  const cast = casting.cast.bind(casting);
  casting.cast = (...args) => { casts.push(args); return cast(...args); };
  game.multiplayer.id = 'a1';
  game.multiplayer.players = [{ id: 'b2', state: { x: player.x + 1, y: player.y, health: 100 } }];
  const spell = { id: 'strike', casterId: 'b2', targetId: 'a1', heading: 0, aim: null };
  const bite = () => {
    game.animals.events.push({ type: 'hit-player', amount: 5, x: player.x, y: player.y });
    harness.frame();
  };
  const health = player.vitals.health;
  game.multiplayer.onCast(spell);
  assert.equal(casts.length, 0, 'a friend\'s spell at the player is dropped');
  assert.equal(cast('strike', { caster: { spellPlayer: true, spellId: 'b2', x: 0, y: 0, health: 100 }, target: player, remote: true }).ok,
    true, 'and even one that lands');
  bite();
  assert.equal(game.animals.events.length, 0, 'the bite reached hurtPlayer');
  assert.equal(player.takeDamage(30), 0, 'like a bite or a burn');
  assert.equal(player.vitals.health, health, 'hurts nothing');
  game.multiplayer.onCast({ ...spell, targetId: 'b2' });
  assert.equal(casts.length, 1, 'other spells still play');
  game.multiplayer.onCast({ ...spell, casterId: 'gone' });
  assert.equal(casts.length, 1);

  game.creator.close();
  game.multiplayer.onCast(spell);
  assert.equal(casts[1][1].target, player);
  assert.equal(player.vitals.health, health - 20, 'once closed, a friend\'s spell lands');
  bite();
  assert.equal(player.vitals.health, health - 25, 'and so does a bite');
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

test('a waiting join is dropped when the new character could not be saved', async () => {
  const failing = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug', creator: true, real: { localStorage: failing } });
  const { game } = harness;
  const notes = [];
  game.hud.notify = (...args) => notes.push(args);
  game.multiplayer.connect({ mode: 'join', code: 'ABC234' });
  const made = game.characters.create(sampleDraft(game.characters, Date.now()));
  game.creator.close(made.character);
  assert.deepEqual(game.multiplayer.connects, [], 'a reload into the lobby\'s world would lose the character');
  assert.deepEqual(notes, [[game.characters.saveError],
    ['The lobby wasn\'t joined: it could reload the page and lose this character.']]);
  game.multiplayer.connect({ mode: 'join', code: 'ABC234' });
  assert.equal(game.multiplayer.connects.length, 1, 'asking again joins');
});

test('a waiting join is made after Create when the character is saved', async () => {
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug', creator: true, real: { localStorage: memory() } });
  const { game } = harness;
  game.multiplayer.connect({ mode: 'join', code: 'ABC234' });
  game.creator.close(game.characters.create(sampleDraft(game.characters, Date.now())).character);
  assert.deepEqual(game.multiplayer.connects, [{ mode: 'join', code: 'ABC234' }]);
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

test('while the creator is open, props in front of the outlaw that would hide it are left out', async () => {
  const bounds = { minX: -5, maxX: 5, minY: -30, maxY: 0 };
  const tree = { x: 1, y: 5, bounds };
  const far = { x: 60, y: 5, bounds };
  const behind = { x: 1, y: -3, bounds };
  const arch = { x: 1, y: 0, bounds, arch: true };
  const props = [tree, far, behind, { x: 1, y: 5 }, arch];
  let drawn = [];
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug', creator: true, real: {
    World: class {
      constructor() { this.spawn = { x: 0, y: 0 }; this.woodland = 'sparse'; }
      isWalkable() { return true; }
      typeAt() { return 0; }
      propsIn() { return props; }
      waterDepthAt() { return 0; }
      trim() {}
    },
    propDepthSlices: (p) => (p.arch ? [{ depth: -2, cells: [] }, { depth: 2, cells: [] }] : null),
    // Records the depths of what is drawn among the grass.
    Grass: class {
      constructor() { return new Proxy(this, { get: (target, key) => target[key] ?? (() => {}) }); }
      drawLayered(...args) { drawn = [...args[4].map((d) => d.y)].sort((a, b) => a - b); }
    },
  } });
  const { game } = harness;
  game.model.cells = [{ sx: 0, sy: -20 }, { sx: 4, sy: 0 }];
  harness.frame();
  assert.deepEqual({ ...game.player.foliageBounds }, { x: 2, y: -10, rx: 6, ry: 14 });
  assert.deepEqual(drawn, [-3, -2, 0, 5, 5], 'the tree and the arch\'s front go; the outlaw, and what stands behind, far off or unmeasured, stay');
  game.creator.close();
  harness.frame();
  assert.deepEqual(drawn, [-3, -2, 0, 2, 5, 5, 5], 'all of it comes back once play starts');
});

test('Create starts play in the same tap, and the camera comes back', async () => {
  const harness = await loadGame(undefined, { phone: true, width: 390, height: 844, href: 'http://localhost/?debug',
    creator: true, real: { localStorage: memory() } });
  const { game, audio, fullscreenRequests, cellHeight } = harness;
  const before = cellHeight();
  game.creator.onFrame({ cell: 9.7, bias: -0.25, biasX: 0 });
  assert.equal(cellHeight(), 9.7, 'reduced motion snaps the zoom');
  assert.equal(game.camera.bias, -0.25);
  assert.equal(game.player.heading, 0.3, 'a three-quarter view');
  game.creator.onFrame({ cell: 9, bias: 0, biasX: -0.25 });
  assert.equal(game.camera.biasX, -0.25);
  const notes = [];
  game.hud.notify = (...args) => notes.push(args);
  game.inventoryScreen.isOpen = false;
  const made = game.characters.create({ ...sampleDraft(game.characters, Date.now()), skin: cleanSkin({ tone: 'olive' }) });
  game.creator.close(made.character);
  assert.equal(audio.unlocks, 1, 'sound unlocks');
  assert.equal(fullscreenRequests.length, 1, 'the phone goes full screen');
  assert.equal(harness.gateButton.hidden, true, 'no play card after Create');
  assert.equal(harness.blocked(), false);
  assert.equal(game.player.skin.tone, 'olive');
  assert.equal(cellHeight(), before, 'the phone zoom comes back');
  assert.deepEqual([game.camera.bias, game.camera.biasX], [0.1, 0]);
  assert.deepEqual(notes, [], 'saved');
});

test('on a desktop the framing glides in and out, and a failed save is told', async () => {
  const failing = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug', creator: true, real: { localStorage: failing } });
  const { game, audio, fullscreenRequests, cellHeight, frame } = harness;
  harness.pinch(1.5);
  for (let i = 0; i < 120; i++) frame();
  const zoomed = cellHeight();
  game.creator.onFrame({ cell: 18, bias: 0, biasX: -0.17 });
  frame();
  assert.ok(game.camera.biasX < 0 && game.camera.biasX > -0.17, 'it glides');
  for (let i = 0; i < 120; i++) frame();
  assert.equal(game.camera.biasX, -0.17);
  assert.equal(cellHeight(), 18);
  const notes = [];
  game.hud.notify = (...args) => notes.push(args);
  const made = game.characters.create(sampleDraft(game.characters, Date.now()));
  game.creator.close(made.character);
  assert.equal(audio.unlocks, 1);
  assert.equal(fullscreenRequests.length, 0, 'a desktop stays windowed');
  assert.deepEqual(notes, [[game.characters.saveError]]);
  for (let i = 0; i < 120; i++) frame();
  assert.equal(game.camera.biasX, 0);
  assert.equal(cellHeight(), zoomed, 'the zoom from before');
});

test('a resize, a turn or a phone change while open refits the creator, and the pinch slots wait', async () => {
  const harness = await loadGame(undefined, { phone: true, width: 393, height: 852, href: 'http://localhost/?debug', creator: true });
  const { game, cellHeight } = harness;
  game.creator.onFrame({ cell: 10, bias: -0.25, biasX: 0 });
  harness.resizeTo(393, 800);
  assert.equal(game.creator.refits, 1);
  assert.equal(cellHeight(), 10, 'the phone default stays away');
  harness.rotate();
  assert.equal(game.creator.refits, 3, 'the turn and its resize');
  assert.equal(game.layout.zoomSlots.get('portrait'), null);
  assert.equal(game.camera.bias, -0.25, 'the creator keeps its framing');
  harness.setPhone(false);
  assert.equal(game.creator.refits, 4);
  game.creator.close();
  assert.equal(harness.gateButton.hidden, true, 'no card off a phone');
  harness.setPhone(true);
  assert.equal(game.creator.refits, 4, 'closed, nothing to refit');
});

test('the creator turns the outlaw: gliding on a desktop, at once with reduced motion', async () => {
  const harness = await loadGame(undefined, { href: 'http://localhost/?debug', creator: true });
  const { game, frame } = harness;
  game.creator.onFrame({ cell: 18, bias: 0, biasX: -0.17 });
  assert.equal(game.player.heading, 0.3);
  game.creator.onTurn(Math.PI / 4);
  frame();
  assert.ok(game.player.heading > 0.3 && game.player.heading < 0.3 + Math.PI / 4, 'it turns smoothly');
  for (let i = 0; i < 120; i++) frame();
  assert.ok(Math.abs(game.player.heading - (0.3 + Math.PI / 4)) < 1e-6);
  game.creator.onFrame({ cell: 18, bias: 0, biasX: -0.17 });
  assert.ok(Math.abs(game.player.heading - (0.3 + Math.PI / 4)) < 1e-6, 'a refit keeps the turn');
  game.creator.onTurn(2 * Math.PI);
  for (let i = 0; i < 240; i++) frame();
  assert.ok(game.player.heading > 2 * Math.PI, 'a long drag turns all the way round');
  game.creator.close();
  assert.ok(Math.abs(game.player.heading - (0.3 + Math.PI / 4)) < 1e-6, 'play starts facing the same way');
  const phone = await loadGame(undefined, { phone: true, href: 'http://localhost/?debug', creator: true });
  phone.game.creator.onFrame({ cell: 9.7, bias: -0.25, biasX: 0 });
  phone.game.creator.onTurn(-Math.PI / 4);
  assert.equal(phone.game.player.heading, 0.3 - Math.PI / 4, 'reduced motion snaps the turn');
});

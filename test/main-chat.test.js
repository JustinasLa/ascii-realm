import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCALE, TILT } from '../src/entities/rig.js';
import { loadGame } from './helpers/main-game.js';

const inLobby = (game) => {
  game.multiplayer.room = { code: 'ABC234' };
  game.inventoryScreen.isOpen = false;
};

test('chat opens only in a lobby with nothing else open, and blocks play until every panel is shut', async () => {
  const harness = await loadGame();
  const { game } = harness;
  const { chat } = game;
  game.inventoryScreen.isOpen = false;
  assert.equal(chat.scene, harness.canvas, 'a click or tap on the scene closes chat');
  assert.equal(chat.mayOpen(), false, 'solo');
  inLobby(game);
  assert.equal(chat.mayOpen(), true);
  assert.equal(chat.isCovered(), false);
  game.builder.enabled = true;
  assert.equal(chat.mayOpen(), false, 'the builder keeps its keys');
  assert.equal(chat.isCovered(), true, 'Escape closes the builder before the chat');
  game.builder.enabled = false;
  game.spellControls.menu = { isOpen: true };
  assert.equal(chat.isCovered(), true, 'and the rune wheel');
  assert.equal(chat.mayOpen(), false);
  game.spellControls.menu = { isOpen: false };
  game.inventoryScreen.isOpen = true;
  assert.equal(chat.mayOpen(), false);
  game.inventoryScreen.isOpen = false;

  chat.open();
  assert.equal(harness.blocked(), true, 'typing never moves or strikes');
  game.player.combat.charge = 1;
  chat.close();
  assert.equal(harness.blocked(), false);

  // The inventory and the phone menu close chat when they open, and play
  // stays blocked while any of them is still open.
  chat.open();
  game.inventoryScreen.isOpen = true;
  game.inventoryScreen.onToggle(true);
  assert.equal(chat.isOpen, false);
  assert.equal(harness.blocked(), true);
  chat.isOpen = true;
  game.inventoryScreen.isOpen = false;
  game.inventoryScreen.onToggle(false);
  assert.equal(harness.blocked(), true, 'closing the inventory leaves chat blocking');
  chat.isOpen = false;
  game.inventoryScreen.onToggle(false);
  assert.equal(harness.blocked(), false);
  chat.open();
  game.phoneMenu.setOpen(true);
  assert.equal(chat.isOpen, false);
  assert.equal(chat.mayOpen(), false);
  assert.equal(harness.blocked(), true);
  game.phoneMenu.setOpen(false);
  assert.equal(harness.blocked(), false);
});

test('lobby changes, relayed lines and notices reach the chat; frames fade it', async () => {
  const harness = await loadGame();
  const { game } = harness;
  const { chat, multiplayer } = game;
  multiplayer.onChange({ room: { code: 'ABC234' } });
  assert.equal(chat.available, true);
  multiplayer.onChange({ room: null });
  assert.equal(chat.available, false);
  multiplayer.players = [{ id: 'a1', color: 0 }];
  multiplayer.onChat({ text: 'hi' });
  assert.deepEqual(chat.received, [{ text: 'hi' }, multiplayer.players]);
  multiplayer.onChatNotice({ code: 'rate' });
  assert.deepEqual(chat.noticed, { code: 'rate' });
  multiplayer.onRoster({ left: 'self' });
  assert.deepEqual(chat.rostered, { left: 'self' });
  assert.deepEqual(chat.colorOf({ color: 1, tint: null }), [146, 198, 235], "a member without a name colour shows their automatic one");
  assert.deepEqual(chat.colorOf({ color: 1, tint: "#ff5555" }), [255, 85, 85]);
  const updates = chat.updates;
  harness.frame();
  assert.equal(chat.updates, updates + 1);
});

test('hiding the page, the play card and leaving phone mode put the chat away but keep the draft', async () => {
  const harness = await loadGame(undefined, { phone: true, href: 'http://localhost/?debug' });
  const { chat } = harness.game;
  assert.ok(chat.closes.some((options) => options.keepDraft), 'the start card shows on phones');
  chat.closes.length = 0;
  harness.setPhone(false);
  assert.deepEqual(chat.closes.map((options) => options.keepDraft), [true]);
});

test('the party frames measure friends in metres', async () => {
  const harness = await loadGame();
  const { game } = harness;
  let party;
  game.hud.setParty = (list) => { party = list; };
  game.multiplayer.room = { code: 'ABC234' };
  game.multiplayer.id = 'a1';
  game.multiplayer.players = [{ id: 'a1', name: 'Ash', state: {} },
    { id: 'b2', name: 'Bryn', state: { x: game.player.x, y: game.player.y + 10 * SCALE * TILT, health: 50 } }];
  harness.frame();
  assert.equal(party.length, 1);
  assert.equal(party[0].note, '10m');
});

test('relayed lines and roster changes reach the speech bubbles as well as the log', async () => {
  const { game } = await loadGame();
  const { bubbles, multiplayer } = game;
  multiplayer.id = 'a1';
  const said = { channel: 'rp', from: 'b2', text: 'hi' };
  multiplayer.onChat(said);
  assert.deepEqual(bubbles.received, [[said, 'a1']]);
  multiplayer.onRoster({ left: 'self' });
  assert.deepEqual(bubbles.rostered, [{ left: 'self' }]);
  assert.equal(bubbles.reducedMotion(), false, 'the bob follows the reduced-motion setting');
});

test('each frame with bubbles gives them every speaker in view, their nameplate row and whether a crown hides them', async () => {
  const parts = [{ y0: -20.5 }, { y0: -3 }];
  const harness = await loadGame(undefined, { real: { dressFigure: () => parts } });
  const { game } = harness;
  const { bubbles, player, remotePlayers } = game;
  harness.frame();
  assert.equal(bubbles.updates.length, 0, 'no work while nobody has spoken');
  const near = { player: { x: player.x + 10, y: player.y + 4.5 } };
  const far = { player: { x: player.x + 900, y: player.y } };
  remotePlayers.peers = new Map([['b2', near], ['c3', far]]);
  remotePlayers.visible = () => [near];
  const hidden = [];
  game.renderer.fineInFront = (x, y) => {
    hidden.push([x, y]);
    return x === Math.floor(near.player.x);
  };
  bubbles.size = 2;
  harness.frame();
  const { anchors, form } = bubbles.updates.at(-1);
  assert.equal(form, 'desktop');
  assert.deepEqual([...anchors.keys()], ['self', 'b2'], 'only speakers in view');
  const self = anchors.get('self');
  assert.equal(self.x, player.x);
  assert.equal(self.feetY, player.y);
  assert.equal(self.depth, player.y);
  assert.equal(self.covered, false);
  // The 3D character names itself at its own top row, unknown in this harness.
  assert.equal(self.nameRow, Infinity);
  const peer = anchors.get('b2');
  assert.deepEqual({ ...peer }, { x: near.player.x, feetY: near.player.y, depth: near.player.y,
    nameRow: Math.floor(near.player.y - 20.5) - 2, covered: true });
  const top = Math.floor(near.player.y - 20.5);
  assert.deepEqual(hidden, [[Math.floor(near.player.x), top + 1]], 'the head under the nameplate, first match wins');
  assert.ok(Number.isFinite(game.metrics.bubblesMs) && game.metrics.bubblesMs >= 0, 'the frame times the bubbles\' share');
  assert.ok(game.metrics.bubblesMs <= game.metrics.workMs);
});

test('phones give the bubbles their orientation', async () => {
  const harness = await loadGame(undefined, { phone: true, width: 400, height: 800, href: 'http://localhost/?debug&nogate' });
  const { bubbles } = harness.game;
  bubbles.size = 1;
  harness.frame();
  assert.equal(bubbles.updates.at(-1).form, 'portrait');
});

test('until the 3D character loads, the own bubble keeps above the shape-built figure\'s nameplate', async () => {
  const pending = () => new Promise(() => {});
  const harness = await loadGame(undefined, { real: { dressFigure: () => [{ y0: -23.4 }],
    ModelFigure: { load: pending, library: pending } } });
  const { bubbles, player } = harness.game;
  bubbles.size = 1;
  harness.frame();
  assert.equal(bubbles.updates.at(-1).anchors.get('self').nameRow, Math.floor(player.y - 23.4) - 2);
});

test('nameplates, party frames and the picker show each player\'s name colour and tag', async () => {
  const pending = () => new Promise(() => {});
  const harness = await loadGame(undefined, { real: { dressFigure: () => [{ y0: -20 }],
    ModelFigure: { load: pending, library: pending } } });
  const { game } = harness;
  const { multiplayer, tint, player, nameplates } = game;
  // Plain copies: the frame runs in a context of its own.
  const plates = () => JSON.parse(JSON.stringify(nameplates.updates.at(-1).plates));
  harness.frame();
  assert.deepEqual(plates(), [{ key: 'self', x: player.x, row: Math.floor(player.y - 20) - 2, depth: player.y,
    name: 'Kael', tag: null, colour: [212, 218, 228] }], 'solo on Auto, as before, two rows over the figure');
  assert.equal(tint.getName(), plates()[0].name);
  assert.deepEqual(tint.autoColour(), [212, 218, 228]);
  tint.onTint('#ffaa00');
  harness.frame();
  assert.deepEqual(plates()[0].colour, [255, 170, 0], 'your chosen colour shows solo too');

  const state = { x: player.x + 3, y: player.y, health: 50 };
  multiplayer.room = { code: 'ABC234' };
  multiplayer.id = 'a1';
  multiplayer.players = [{ id: 'a1', name: 'Ash', tag: 2, color: 1, tint: null, state },
    { id: 'b2', name: 'Bryn', tag: null, color: 0, tint: '#ff5555', state }];
  const bryn = { id: 'b2', player: { x: state.x, y: state.y + 4 }, figure: [], name: 'Bryn', tag: null,
    color: 0, tint: '#ff5555' };
  game.remotePlayers.visible = () => [bryn];
  let party = null;
  game.hud.setParty = (members) => { party = members; };
  const renders = tint.renders;
  multiplayer.onChange(multiplayer);
  assert.equal(tint.renders, renders + 1, 'the Auto swatch follows the lobby colour');
  assert.equal(tint.getName(), 'Ash (2)');
  assert.deepEqual(tint.autoColour(), [146, 198, 235]);
  harness.frame();
  assert.deepEqual(plates().map(({ key, name, tag, colour }) => [key, name, tag, colour]),
    [['self', 'Ash', 2, [146, 198, 235]], ['b2', 'Bryn', null, [255, 85, 85]]],
    'in a lobby your nameplate shows what the lobby shows; a friend\'s shows their choice');
  assert.equal(plates()[1].row, Math.floor(state.y + 4 - 20) - 2, 'a friend\'s two rows over their dressed figure');
  assert.equal(plates()[1].x, state.x);
  assert.deepEqual(plates().map((plate) => plate.depth), [player.y, state.y + 4], 'each ordered by their feet');
  assert.deepEqual(party.map((m) => [m.name, m.tag, m.colour]), [['Bryn', null, [255, 85, 85]]]);
  multiplayer.players[1] = { ...multiplayer.players[1], tint: null, tag: 3 };
  bryn.tag = 3;
  harness.frame();
  assert.deepEqual(party.map((m) => [m.name, m.tag, m.colour]), [['Bryn', 3, [169, 212, 174]]],
    'the tag goes to the frame on its own, to show whole after a long name');
  assert.equal(plates()[1].tag, 3);
});

test('names are never drawn into the scene, so its fog and dark edges never reach them', async () => {
  const harness = await loadGame();
  const { game } = harness;
  const puts = [];
  game.renderer.put = (...cell) => puts.push(cell);
  game.renderer.putBg = (...cell) => puts.push(cell);
  harness.frame();
  assert.equal(puts.length, 0);
  const { projection } = game.nameplates.updates.at(-1);
  assert.equal(projection, game.bubbles.updates.at(-1)?.projection ?? projection, 'the same projection as the bubbles');
});

test('the 3D character\'s nameplate shows in the name colour at its own top row, and not before it has one', async () => {
  const harness = await loadGame();
  const { game } = harness;
  harness.frame();
  assert.equal(game.nameplates.updates.at(-1).plates.length, 0, 'no top yet, no name');
  game.model.top = 40;
  game.tint.onTint('#55ffff');
  game.bubbles.size = 1;
  harness.frame();
  const [plate] = game.nameplates.updates.at(-1).plates;
  assert.deepEqual(JSON.parse(JSON.stringify(plate)),
    { key: 'self', x: game.player.x, row: 38, depth: game.player.y, name: 'Kael', tag: null, colour: [85, 255, 255] });
  assert.equal(game.bubbles.updates.at(-1).anchors.get('self').nameRow, plate.row, 'the bubble keeps above it');
  assert.equal(game.bubbles.updates.at(-1).projection, game.nameplates.updates.at(-1).projection);
  delete game.model.top;
});


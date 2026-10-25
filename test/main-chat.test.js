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
  assert.deepEqual(chat.colorOf({ color: 0 }), [1, 2, 3]);
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

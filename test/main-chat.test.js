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
  game.builder.enabled = true;
  assert.equal(chat.mayOpen(), false, 'the builder keeps its keys');
  game.builder.enabled = false;
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';

test('damage outside monster attacks delays passive healing for six seconds', async () => {
  const { game, frame } = await loadGame();
  game.player.takeDamage(20);
  frame();
  assert.equal(game.player.vitals.health, 80);
  for (let i = 0; i < 100; i++) frame(0.05);
  assert.equal(game.player.vitals.health, 80);
  for (let i = 0; i < 25; i++) frame(0.05);
  assert.ok(game.player.vitals.health > 80);
});

test('damage during the spell update suppresses healing in the same frame', async () => {
  const { game, frame } = await loadGame();
  game.casting.update = () => {
    game.player.takeDamage(20);
    game.casting.update = () => {};
  };
  frame();
  assert.equal(game.player.vitals.health, 80);
  for (let i = 0; i < 100; i++) frame(0.05);
  assert.equal(game.player.vitals.health, 80);
});

test('respawning does not sweep pickups along the teleport to spawn', async () => {
  const { game, frame } = await loadGame();
  const shaft = { kind: 'arrow', material: 'steel', x: 120, y: 0, depth: 0 };
  game.projectiles.landed.push(shaft);
  game.player.x = 240;
  game.player.vitals.health = 0;
  frame();
  assert.equal(game.player.x, 0);
  assert.deepEqual(game.projectiles.landed, [shaft]);
  assert.ok(!game.inventory.slots.some(stack => stack?.id === 'arrow'));
  game.player.x = 120;
  frame();
  assert.equal(game.projectiles.landed.length, 0, 'walking near the shaft still collects it');
});

test('joining another seed preserves the server actually selected in the lobby', async () => {
  const { game, navigatedTo } = await loadGame(undefined, { href: 'http://localhost/?debug&server=wss://old.example/lobby' });
  game.multiplayer.options = { server: 'wss://chosen.example/lobby' };
  game.multiplayer.onJoin({ seed: 42, code: 'ABC123' });
  const destination = new URL(navigatedTo());
  assert.equal(destination.searchParams.get('seed'), '42');
  assert.equal(destination.searchParams.get('room'), 'ABC123');
  assert.equal(destination.searchParams.get('server'), 'wss://chosen.example/lobby');
});

async function chargedBow() {
  const harness = await loadGame();
  const { game, frame, pointer } = harness;
  game.inventory.add('longbow');
  game.inventory.add('arrow', 4);
  game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === 'longbow'));
  frame();
  pointer('pointerdown');
  for (let i = 0; i < 15; i++) frame(0.05);
  assert.ok(game.player.ranged.draw > 0.9);
  return harness;
}

test('releasing a charged bow normally still fires and consumes one arrow', async () => {
  const { game, frame, pointer } = await chargedBow();
  pointer('pointerup');
  frame();
  assert.equal(game.projectiles.list.length, 1);
  assert.equal(game.inventory.slots.find(stack => stack?.id === 'arrow').count, 3);
});

for (const interruption of ['inventory', 'builder', 'freeze', 'blur', 'pointercancel', 'stun']) {
  test(`${interruption} cancels the drawn bow without shooting or replaying its release`, async () => {
    const { game, frame, pointer, blur } = await chargedBow();
    game.player.combat.charge = 0.8;
    game.player.combat.queued = 'a';
    if (interruption === 'inventory') game.inventoryScreen.onToggle(true);
    if (interruption === 'builder') game.builder.setEnabled(true);
    if (interruption === 'freeze') game.freeze = true;
    if (interruption === 'blur') blur();
    if (interruption === 'pointercancel') pointer('pointercancel', 0, 'pen');
    if (interruption === 'stun') game.player.magicStunned = true;
    frame();
    assert.equal(game.projectiles.list.length, 0);
    assert.equal(game.player.ranged.held, 0);
    assert.equal(game.player.combat.charge, 0);
    assert.equal(game.player.combat.queued, null);
    assert.equal(game.player.aimTarget, null);
    assert.equal(game.inventory.slots.find(stack => stack?.id === 'arrow').count, 4);
    game.inventoryScreen.onToggle(false);
    game.builder.setEnabled(false);
    game.freeze = false;
    game.player.magicStunned = false;
    pointer('pointerup');
    frame();
    assert.equal(game.projectiles.list.length, 0);
  });
}

for (const interruption of ['blur', 'pointercancel']) {
  test(`${interruption} discards pending mouse attacks and casts before the next frame`, async () => {
    const { game, frame, pointer, blur } = await loadGame();
    let casts = 0;
    game.casting.cast = () => { casts++; return { ok: true }; };
    pointer('pointerdown', 0, 'pen');
    pointer('pointerdown', 2, 'pen');
    if (interruption === 'blur') blur();
    else pointer('pointercancel', 0, 'pen');
    frame();
    assert.equal(game.player.combat.move, null);
    assert.equal(casts, 0);
  });
}

test('stunned players cannot cast or start drawing a ranged attack', async () => {
  const { game, frame, pointer, tap, hold } = await chargedBow();
  let casts = 0;
  game.casting.cast = () => { casts++; return { ok: true }; };
  game.player.magicStunned = true;
  tap('KeyR');
  hold('KeyJ');
  pointer('pointerdown', 2);
  frame();
  assert.equal(casts, 0);
  assert.equal(game.projectiles.list.length, 0);
  assert.equal(game.player.ranged.held, 0);
});

test('a phone never opens the scenery builder, even with ?builder', async () => {
  const { game, canvas } = await loadGame(undefined, { href: 'http://localhost/?debug&builder', phone: true });
  assert.equal(game.device.phone, true);
  assert.equal(game.builder.enabled, false);
  assert.equal(game.builder.allowed(), false);
  assert.equal(canvas.getAttribute('aria-label'), 'Game scene.');
});

test('a desktop still opens the builder with ?builder', async () => {
  const { game, canvas } = await loadGame(undefined, { href: 'http://localhost/?debug&builder' });
  assert.equal(game.device.phone, false);
  assert.equal(game.builder.enabled, true);
  assert.equal(game.builder.allowed(), true);
  assert.equal(canvas.getAttribute('aria-label'), 'Game scene. Press B to build scenery.');
});

test('becoming a phone leaves the builder; leaving phone mode closes the menu', async () => {
  const { game, canvas, setPhone, keydown } = await loadGame(undefined, { href: 'http://localhost/?debug&builder' });
  game.builder.panel.open = true;
  setPhone(true);
  assert.equal(game.builder.enabled, false);
  assert.equal(game.builder.panel.open, false);
  assert.equal(canvas.getAttribute('aria-label'), 'Game scene.');
  game.phoneMenu.setOpen(true);
  assert.equal(game.phoneMenu.open, true);
  assert.ok(keydown('w').defaultPrevented === false);
  setPhone(false);
  assert.equal(game.phoneMenu.open, false);
  assert.equal(canvas.getAttribute('aria-label'), 'Game scene. Press B to build scenery.');
});

test('the phone menu blocks gameplay while open and its Inventory row opens the inventory', async () => {
  const { game } = await loadGame(undefined, { phone: true });
  let opened = false;
  game.inventoryScreen.isOpen = false;
  game.inventoryScreen.setOpen = (open) => { opened = open; };
  game.player.combat.charge = 1;
  game.phoneMenu.setOpen(true);
  game.phoneMenu.onInventory();
  assert.equal(opened, true);
  assert.equal(game.player.combat.charge, 0, 'opening the menu cancels a charge');
  game.phoneMenu.setOpen(false);
});

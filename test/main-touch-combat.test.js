import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';
import { toCells } from '../src/entities/monsters.js';

const DEG = Math.PI / 180;
// Points made inside the game's sandbox, copied to compare by value.
const at = p => p && { x: p.x, y: p.y };
const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
// A risen skeleton `metres` from the outlaw at `angle` off their facing.
const foe = (metres, angle) => {
  const [x, y] = toCells(Math.sin(angle) * metres, Math.cos(angle) * metres);
  return { x, y, alive: true, state: 'chase', kind: { radius: 0.6 } };
};

test('a STRIKE tap turns to a skeleton inside the cone; J keeps the facing', async () => {
  const { game, frame, tap } = await loadGame(undefined, { coarse: true });
  const skeleton = foe(1.2, 20 * DEG);
  game.monsters.list.push(skeleton);
  tap('KeyJ');
  frame();
  assert.equal(game.player.facing, null, 'the keyboard strikes the way the body faces');

  const again = await loadGame(undefined, { coarse: true });
  again.game.monsters.list.push(skeleton);
  again.tap('TouchStrike');
  again.frame();
  assert.ok(Math.abs(again.game.player.facing - 20 * DEG) < 1e-6);
  assert.ok(again.game.player.combat.move, 'the first strike draws the sword');
});

test('a skeleton outside the cone leaves a STRIKE facing ahead', async () => {
  const { game, frame, tap } = await loadGame(undefined, { coarse: true });
  game.monsters.list.push(foe(1.2, 40 * DEG));
  tap('TouchStrike');
  frame();
  assert.equal(game.player.facing, null);
  assert.ok(game.player.combat.move);
});

test('a CAST tap aims an attack rune at the foe ahead; heals and R ignore it', async () => {
  const { game, frame, tap } = await loadGame(undefined, { coarse: true });
  const target = foe(12, -15 * DEG);
  game.monsters.list.push(target);
  const casts = [];
  game.casting.cast = (id, options) => { casts.push({ id, ...options }); return { ok: true }; };
  tap('TouchCast');
  frame();
  assert.deepEqual(at(casts[0].aim), { x: target.x, y: target.y });
  assert.ok(Math.abs(casts[0].heading + 15 * DEG) < 1e-6);
  assert.ok(Math.abs(game.player.facing + 15 * DEG) < 1e-6, 'the caster turns to the foe');

  tap('KeyR');
  frame();
  assert.notDeepEqual(at(casts[1].aim), { x: target.x, y: target.y }, 'R casts the way the body faces');
  game.casting.spells.get('test-rune').supportive = true;
  tap('TouchCast');
  frame();
  assert.notDeepEqual(at(casts[2].aim), { x: target.x, y: target.y }, 'a heal is never pulled at an enemy');
});

test('a failed touch cast says why', async () => {
  const { game, frame, tap } = await loadGame(undefined, { coarse: true });
  const notes = [];
  game.hud.notify = message => notes.push(message);
  game.casting.cast = () => ({ ok: false, reason: 'Not enough mana.' });
  tap('TouchCast');
  frame();
  assert.deepEqual(notes, ['Not enough mana.']);
});

test('a bow drawn on STRIKE fires at the assisted foe after the finger lifts', async () => {
  const { game, frame, hold, release } = await loadGame(undefined, { coarse: true });
  game.inventory.add('longbow');
  game.inventory.add('arrow', 4);
  game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === 'longbow'));
  frame();
  const target = foe(6, 25 * DEG);
  game.monsters.list.push(target);
  hold('TouchStrike');
  for (let i = 0; i < 15; i++) frame(0.05);
  assert.ok(near(game.player.aimTarget, target), 'the aim preview shows the foe');
  // The foe steps aside while the bow is drawn; the release aims afresh.
  target.x += 3;
  release('TouchStrike');
  frame();
  assert.equal(game.projectiles.list.length, 1);
  const shot = game.projectiles.list[0];
  assert.ok(near(shot.target, target), 'aimed where the foe stands at the release');
});

test('a mouse-drawn bow is not assisted', async () => {
  const { game, frame, pointer } = await loadGame(undefined, { coarse: true });
  game.inventory.add('longbow');
  game.inventory.add('arrow', 4);
  game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === 'longbow'));
  frame();
  const target = foe(6, 10 * DEG);
  game.monsters.list.push(target);
  pointer('pointerdown');
  for (let i = 0; i < 15; i++) frame(0.05);
  assert.ok(!near(game.player.aimTarget, target));
  pointer('pointerup');
  frame();
  assert.equal(game.projectiles.list.length, 1);
});

test('a spear jab from STRIKE turns to the foe; from the mouse it follows the cursor', async () => {
  for (const [source, expectFacing] of [['touch', true], ['mouse', false]]) {
    const { game, frame, hold, release, pointer } = await loadGame(undefined, { coarse: true });
    game.inventory.add('spear');
    game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === 'spear'));
    frame();
    game.monsters.list.push(foe(1.5, 20 * DEG));
    if (source === 'touch') hold('TouchStrike');
    else pointer('pointerdown');
    frame(0.02);
    if (source === 'touch') release('TouchStrike');
    else pointer('pointerup');
    frame(0.02);
    assert.equal(game.player.facing !== null && Math.abs(game.player.facing - 20 * DEG) < 1e-6, expectFacing, source);
  }
});

test('touch screens buzz on a landed cut and on a wound; desktops never do', async () => {
  for (const coarse of [true, false]) {
    const { game, frame, tap, vibrations } = await loadGame(undefined, { coarse });
    const skeleton = foe(1, 0);
    game.monsters.list.push(skeleton);
    game.monsters.strike = (event) => event.type === 'strike' ? [skeleton] : [];
    tap('TouchStrike');
    for (let i = 0; i < 40 && !vibrations.length; i++) frame(0.02);
    for (let i = 0; i < 10; i++) frame(0.02);
    game.player.takeDamage(10);
    frame();
    assert.deepEqual(vibrations, coarse ? [12, 30] : [], `coarse ${coarse}`);
  }
});

test('a rune that lands on another buzzes the caster', async () => {
  const { game, vibrations } = await loadGame(undefined, { coarse: true });
  // The stand-in casting system keeps the hook it was given.
  const { onDamage } = game.casting.options;
  assert.equal(typeof onDamage, 'function');
  onDamage(game.player, 10, { caster: game.player });
  onDamage({}, 0, { caster: game.player });
  onDamage({}, 10, { caster: {} });
  onDamage({}, 10, undefined);
  assert.deepEqual(vibrations, []);
  onDamage({}, 10, { caster: game.player });
  assert.deepEqual(vibrations, [12]);
});

test('holding CAST hands the finger to the rune wheel', async () => {
  const { game, touch } = await loadGame(undefined, { coarse: true });
  let opened = null;
  game.spellControls.openTouch = (id) => { opened = id; return true; };
  assert.equal(touch.castHold(7), true);
  assert.equal(opened, 7);
});

test('the contextual button follows what is in reach and its tap does that thing', async () => {
  const { game, frame, tap, touch } = await loadGame(undefined, { coarse: true });
  frame();
  assert.equal(touch.interactions.at(-1), null, 'hidden at spawn');
  let fire = { x: 2, y: 0 };
  game.fires.nearest = () => fire;
  let toggles = 0;
  game.fires.toggle = () => { toggles++; fire = null; return 'out'; };
  frame();
  assert.equal(touch.interactions.at(-1).label, 'DOUSE');
  tap('TouchInteract');
  frame();
  assert.equal(toggles, 1);
  assert.equal(touch.interactions.at(-1), null);
  tap('TouchInteract');
  frame();
  assert.equal(toggles, 1, 'a late tap never builds a campfire');

  // Ground items, once the game keeps a collection, come first.
  const notes = [];
  game.hud.notify = (message, kind) => notes.push([message, kind]);
  game.collection = { canCollect: () => true, interactionTarget: () => ({ item: { id: 'arrow' } }),
    interact: () => ({ ok: true, message: 'Picked up Arrow.' }) };
  frame();
  assert.equal(touch.interactions.at(-1).label, 'TAKE');
  tap('TouchInteract');
  frame();
  assert.deepEqual(notes, [['Picked up Arrow.', 'pickup']]);
  game.collection.interact = () => ({ ok: false });
  tap('TouchInteract');
  frame();
  assert.equal(notes.length, 1);

  // A glowcap in reach.
  game.collection = null;
  let released = 0;
  game.mushrooms.nearby = () => ({ cooldown: 0 });
  game.mushrooms.time = 1;
  game.mushrooms.interact = () => { released++; return true; };
  frame();
  assert.equal(touch.interactions.at(-1).label, 'SPORES');
  tap('TouchInteract');
  frame();
  assert.equal(released, 1);

  // Blocked play shows nothing.
  game.player.magicStunned = true;
  tap('TouchInteract');
  frame();
  assert.equal(touch.interactions.at(-1), null);
  assert.equal(released, 1);
});

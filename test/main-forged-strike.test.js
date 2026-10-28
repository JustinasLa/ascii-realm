import assert from 'node:assert/strict';
import test from 'node:test';
import { KINDS, Monster, Monsters, toCells } from '../src/entities/monsters.js';
import { loadGame } from './helpers/main-game.js';

const forged = (metal, attackDamage, colour) => ({
  metal, ...(colour ? { colour } : {}), quality: 'tempered', hits: 60, stats: { attackDamage, durability: 500 }, inputs: { ironIngot: 4 },
});

test('a forged short sword cuts for its own damage, and changing its metal puts the last one away', async () => {
  const { game, frame } = await loadGame(undefined, { href: 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0',
    real: { Monsters, KINDS } });
  game.world.loaded = () => ({ props: [] });
  game.world.isWalkable = () => true;
  game.world.typeAt = () => 1;
  const { inventory, player } = game;
  const wield = (extras) => {
    inventory.add('shortSword', 1, extras);
    assert.equal(inventory.equip(inventory.slots.findLastIndex((s) => s?.id === 'shortSword' && s.forged)), true);
  };
  const [dx, dy] = toCells(Math.sin(player.heading) * 0.8, Math.cos(player.heading) * 0.8);
  const skeleton = new Monster(player.x + dx, player.y + dy, { kind: KINDS.skeleton, risen: true });
  game.monsters.list.push(skeleton);
  const cut = () => {
    player.events.push({ type: 'strike', swing: 'cut', x: player.x, y: player.y, strength: 1 });
    frame();
  };
  assert.equal(skeleton.health, 60);
  wield({ material: 'iron', forged: forged('Iron', 3.5) });
  frame();
  cut();
  assert.equal(skeleton.health, 39, 'a forged Iron sword cuts for 21');
  let cancelled = 0;
  const cancel = player.cancelWeapon.bind(player);
  player.cancelWeapon = () => {
    cancelled++;
    cancel();
  };
  frame();
  assert.equal(cancelled, 0, 'the same sword stays in hand');
  wield({ forged: forged('Blackiron', 4.2, '5E6568') });
  frame();
  assert.equal(cancelled, 1, 'another metal puts the last swing away');
  cut();
  assert.ok(Math.abs(skeleton.health - (39 - 25.2)) < 1e-9, `an alloy sword cuts for 25.2 (${skeleton.health})`);
  assert.equal(inventory.unequip('mainHand'), true);
  frame();
  assert.equal(cancelled, 2, 'so does an empty hand');
});

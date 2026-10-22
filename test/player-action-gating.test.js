import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';

const meadow = { isWalkable: () => true };
const still = { x: 0, y: 0 };
const forward = { x: 1, y: 0 };

function advance(player, seconds, move = still, held = false) {
  const frames = Math.ceil(seconds * 60);
  for (let i = 0; i < frames; i++) player.update(seconds / frames, meadow, move, true, held);
}

test('stun stops running momentum and rejects movement, jumps and new melee attacks', () => {
  const player = new Player(0, 0);
  advance(player, 1, forward);
  const { x, y } = player;
  player.magicStunned = true;
  assert.equal(player.attack(), false);
  player.jump();
  assert.equal(player.windUp, -1);
  advance(player, 0.5, forward, true);
  assert.equal(player.x, x);
  assert.equal(player.y, y);
  assert.equal(player.combat.charge, 0);
  assert.equal(player.combat.move, null);

  player.magicStunned = false;
  advance(player, 0.2, forward);
  assert.ok(player.x > x, 'movement resumes after stun expires');
  assert.equal(player.attack(), true);
});

test('stun cancels an already charged spin without firing it', () => {
  const player = new Player(0, 0);
  player.combat.inHand = true;
  advance(player, 0.7, still, true);
  assert.equal(player.combat.charged, true);
  player.magicStunned = true;
  advance(player, 0.2, still, true);
  assert.equal(player.combat.move, null);
  assert.equal(player.combat.charge, 0);
  assert.equal(player.events.some(event => event.type === 'strike'), false);
});

test('stun still advances airborne physics and forced movement', () => {
  const player = new Player(0, 0);
  player.magicStunned = true;
  player.launch(4);
  player.surge = 2;
  advance(player, 0.2, forward);
  assert.ok(player.air > 0, 'external launch still rises');
  assert.ok(player.vy < 4, 'gravity still advances');
  assert.ok(player.y > 0, 'forced surge still moves the player');
  assert.equal(player.x, 0, 'movement input stays blocked');
  advance(player, 1, forward);
  assert.equal(player.air, 0);
  assert.ok(player.events.some(event => event.type === 'land'));
  assert.ok(player.time > 1);
});

test('drawn ranged weapons do not charge a melee spin, while swords still do', () => {
  for (const id of ['longbow', 'spear', 'javelin', 'shortSword']) {
    const player = new Player(0, 0);
    player.equipment = { mainHand: { id, material: 'iron' } };
    player.combat.inHand = true;
    advance(player, 1, still, true);
    player.update(1 / 60, meadow, still, false, false);
    assert.equal(player.combat.move, id === 'shortSword' ? 'spin' : null, id);
  }
});

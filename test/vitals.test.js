import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat } from '../src/entities/combat.js';
import { Player } from '../src/entities/player.js';
import {
  ATTACK_STAMINA_COST,
  SPRINT_RECOVERY_STAMINA,
  SPRINT_STAMINA_PER_SECOND,
  STAMINA_REGEN_DELAY,
  STAMINA_REGEN_PER_SECOND,
  Vitals,
} from '../src/entities/vitals.js';

const meadow = { isWalkable: () => true };
const wall = { isWalkable: () => false };
const forward = { x: 1, y: 0 };
const still = { x: 0, y: 0 };

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

function advance(player, seconds, move = still, running = false, world = meadow) {
  const steps = Math.ceil(seconds * 60);
  for (let i = 0; i < steps; i++) player.update(seconds / steps, world, move, running);
}

test('vitals start full and report only the health or stamina actually restored or lost', () => {
  const vitals = new Vitals();
  assert.equal(vitals.health, vitals.maxHealth);
  assert.equal(vitals.stamina, vitals.maxStamina);
  assert.equal(vitals.takeDamage(30), 30);
  assert.equal(vitals.heal(1000), 30);
  assert.equal(vitals.heal(1), 0);
  assert.equal(vitals.takeDamage(1000), vitals.maxHealth);
  assert.equal(vitals.health, 0);
  assert.equal(vitals.takeDamage(1), 0);
  assert.equal(vitals.spendStamina(40), true);
  assert.equal(vitals.restoreStamina(1000), 40);
  assert.equal(vitals.restoreStamina(1), 0);
  assert.equal(vitals.stamina, vitals.maxStamina);
});

test('insufficient stamina rejects the full cost and does not restart recovery', () => {
  const vitals = new Vitals();
  assert.equal(vitals.spendStamina(vitals.maxStamina - 5), true);
  vitals.update(STAMINA_REGEN_DELAY / 2);
  assert.equal(vitals.spendStamina(6), false);
  assert.equal(vitals.stamina, 5);
  vitals.update(STAMINA_REGEN_DELAY / 2 + 0.25);
  close(vitals.stamina, 5 + STAMINA_REGEN_PER_SECOND * 0.25);
});

test('recovery starts after the delay, including only the recovered part of a large frame', () => {
  const whole = new Vitals();
  const divided = new Vitals();
  whole.spendStamina(40);
  divided.spendStamina(40);
  const elapsed = STAMINA_REGEN_DELAY + 0.3;
  whole.update(elapsed);
  for (let i = 0; i < 3; i++) divided.update(elapsed / 3);
  close(whole.stamina, 60 + STAMINA_REGEN_PER_SECOND * 0.3);
  close(divided.stamina, whole.stamina);
  whole.update(100);
  assert.equal(whole.stamina, whole.maxStamina);
});

test('sprinting consumes stamina per second, clamps exhaustion and postpones recovery', () => {
  const vitals = new Vitals();
  vitals.update(0.5, true);
  close(vitals.stamina, vitals.maxStamina - SPRINT_STAMINA_PER_SECOND * 0.5);
  vitals.update(STAMINA_REGEN_DELAY);
  close(vitals.stamina, vitals.maxStamina - SPRINT_STAMINA_PER_SECOND * 0.5);
  vitals.update(0.25);
  close(vitals.stamina, vitals.maxStamina - SPRINT_STAMINA_PER_SECOND * 0.5 + STAMINA_REGEN_PER_SECOND * 0.25);
  vitals.update(100, true);
  assert.equal(vitals.stamina, 0);
  vitals.update(STAMINA_REGEN_DELAY);
  assert.equal(vitals.stamina, 0);
  vitals.update(0.25);
  close(vitals.stamina, STAMINA_REGEN_PER_SECOND * 0.25);
});

test('invalid amounts and elapsed times leave resource values and recovery timing intact', () => {
  const vitals = new Vitals();
  vitals.takeDamage(30);
  vitals.spendStamina(30);
  vitals.update(STAMINA_REGEN_DELAY / 2);
  for (const amount of [-1, NaN, Infinity, -Infinity, undefined, null, '10']) {
    assert.equal(vitals.takeDamage(amount), 0);
    assert.equal(vitals.heal(amount), 0);
    assert.equal(vitals.restoreStamina(amount), 0);
    assert.equal(vitals.spendStamina(amount), false);
  }
  assert.equal(vitals.spendStamina(0), true);
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, '1']) {
    vitals.update(dt, true);
  }
  assert.equal(vitals.health, 70);
  assert.equal(vitals.stamina, 70);
  vitals.update(STAMINA_REGEN_DELAY / 2 + 0.25);
  close(vitals.stamina, 70 + STAMINA_REGEN_PER_SECOND * 0.25);
});

test('combat accepts one queued swing and rejects duplicate inputs or attacks while sheathing', (t) => {
  // The second swing varies at random; take the first variation.
  t.mock.method(Math, 'random', () => 0);
  const combat = new Combat();
  assert.equal(combat.canAcceptAttack, true);
  assert.equal(combat.attack(), true);
  assert.equal(combat.move, 'draw');
  assert.equal(combat.queued, 'a');
  assert.equal(combat.canAcceptAttack, false);
  assert.equal(combat.attack(), false);
  assert.equal(combat.queued, 'a');
  for (let i = 0; i < 100 && combat.move !== 'a'; i++) combat.update(1 / 60, false);
  assert.equal(combat.move, 'a');
  assert.equal(combat.canAcceptAttack, true);
  assert.equal(combat.attack(), true);
  assert.equal(combat.queued, 'b');
  assert.equal(combat.canAcceptAttack, false);
  assert.equal(combat.attack(), false);
  assert.equal(combat.queued, 'b');
  for (let i = 0; i < 120 && combat.busy; i++) combat.update(1 / 60, false);
  assert.equal(combat.busy, false);
  combat.toggle();
  assert.equal(combat.move, 'sheathe');
  assert.equal(combat.canAcceptAttack, false);
  assert.equal(combat.attack(), false);
});

test('starting and queuing attacks each pay once; duplicate inputs and sheathing pay nothing', () => {
  const player = new Player(0, 0);
  const full = player.vitals.stamina;
  assert.equal(player.attack(), true);
  assert.equal(player.vitals.stamina, full - ATTACK_STAMINA_COST);
  assert.equal(player.attack(), false);
  assert.equal(player.vitals.stamina, full - ATTACK_STAMINA_COST);
  for (let i = 0; i < 100 && player.combat.move !== 'a'; i++) player.update(1 / 60, meadow, still, false);
  assert.equal(player.combat.move, 'a');
  assert.equal(player.vitals.stamina, full - ATTACK_STAMINA_COST);
  assert.equal(player.attack(), true);
  assert.equal(player.vitals.stamina, full - ATTACK_STAMINA_COST * 2);
  assert.equal(player.attack(), false);
  assert.equal(player.vitals.stamina, full - ATTACK_STAMINA_COST * 2);
  for (let i = 0; i < 120 && player.combat.busy; i++) player.update(1 / 60, meadow, still, false);
  assert.equal(player.combat.busy, false);
  player.toggleSword();
  const beforeSheathing = player.vitals.stamina;
  assert.equal(player.attack(), false);
  assert.equal(player.vitals.stamina, beforeSheathing);
});

test('an unaffordable attack never starts drawing the sword or occupies the combo queue', () => {
  const player = new Player(0, 0);
  player.vitals.spendStamina(player.vitals.maxStamina - ATTACK_STAMINA_COST + 1);
  const remaining = player.vitals.stamina;
  assert.equal(player.attack(), false);
  assert.equal(player.vitals.stamina, remaining);
  assert.equal(player.combat.move, null);
  assert.equal(player.combat.queued, null);
  player.restoreStamina(1);
  assert.equal(player.attack(), true);
  assert.equal(player.vitals.stamina, 0);
  for (let i = 0; i < 100 && player.combat.move !== 'a'; i++) player.update(1 / 60, meadow, still, false);
  assert.equal(player.combat.move, 'a');
  assert.equal(player.combat.canAcceptAttack, true);
  assert.equal(player.attack(), false);
  assert.equal(player.vitals.stamina, 0);
  assert.equal(player.combat.queued, null);
});

test('holding sprint while idle or blocked allows stamina to recover', () => {
  for (const [move, world] of [[still, meadow], [forward, wall]]) {
    const player = new Player(2, 3);
    player.vitals.spendStamina(50);
    advance(player, STAMINA_REGEN_DELAY + 0.5, move, true, world);
    close(player.vitals.stamina, 50 + STAMINA_REGEN_PER_SECOND * 0.5);
    assert.equal(player.x, 2);
    assert.equal(player.y, 3);
    assert.ok(player.run < 0.01);
  }
});

test('exhaustion returns a held sprint to walking until the recovery threshold is reached', () => {
  const player = new Player(0, 0);
  advance(player, 0.75, forward, true);
  assert.ok(player.run > 0.9);
  player.vitals.spendStamina(player.vitals.stamina);
  const startX = player.x;
  advance(player, STAMINA_REGEN_DELAY, forward, true);
  close(player.vitals.stamina, 0);
  assert.ok(player.run < 0.01, `exhausted run amount ${player.run}`);
  assert.ok(player.x > startX, 'the exhausted player should continue walking');
  advance(player, (SPRINT_RECOVERY_STAMINA - 5) / STAMINA_REGEN_PER_SECOND, forward, true);
  assert.ok(player.vitals.stamina > 0 && player.vitals.stamina < SPRINT_RECOVERY_STAMINA);
  assert.ok(player.run < 0.01, 'recovery below the threshold must not restart sprinting');
  let staminaBeforeSprint = player.vitals.stamina;
  for (let i = 0; i < 100 && player.run < 0.01; i++) {
    staminaBeforeSprint = player.vitals.stamina;
    player.update(0.01, meadow, forward, true);
  }
  assert.ok(player.run > 0.01, 'held sprint should resume after enough stamina recovers');
  assert.ok(staminaBeforeSprint >= SPRINT_RECOVERY_STAMINA - STAMINA_REGEN_PER_SECOND * 0.01);
});

test('player damage events carry the actual loss at the player position and omit zero damage', () => {
  const player = new Player(12, 34);
  assert.equal(player.takeDamage(35), 35);
  assert.deepEqual(player.events, [{ type: 'damage', amount: 35, x: 12, y: 34 }]);
  assert.equal(player.takeDamage(1000), 65);
  assert.deepEqual(player.events.at(-1), { type: 'damage', amount: 65, x: 12, y: 34 });
  const count = player.events.length;
  assert.equal(player.takeDamage(5), 0);
  assert.equal(player.takeDamage(NaN), 0);
  assert.equal(player.events.length, count);
  assert.equal(player.heal(20), 20);
  assert.equal(player.vitals.health, 20);
});

test('slowing the animation clock leaves stamina costs and recovery on elapsed real time', () => {
  const normal = new Player(0, 0);
  const slowed = new Player(0, 0);
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    normal.update(dt, meadow, forward, true);
    slowed.update(dt / 4, meadow, forward, true, false, dt);
  }
  close(normal.vitals.stamina, normal.vitals.maxStamina - SPRINT_STAMINA_PER_SECOND);
  close(slowed.vitals.stamina, normal.vitals.stamina);
  assert.ok(slowed.x < normal.x / 2, 'movement should still follow the slower animation clock');
  const restingFrames = Math.round((STAMINA_REGEN_DELAY + 0.5) / dt);
  for (let i = 0; i < restingFrames; i++) {
    normal.update(dt, meadow, still, false);
    slowed.update(dt / 4, meadow, still, false, false, dt);
  }
  close(normal.vitals.stamina, normal.vitals.maxStamina - SPRINT_STAMINA_PER_SECOND + STAMINA_REGEN_PER_SECOND * 0.5);
  close(slowed.vitals.stamina, normal.vitals.stamina);
});

test('unequipping cancels the swing, queued combo and blade trail without refunding stamina', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const player = new Player(0, 0);
  assert.equal(player.attack(), true);
  for (let i = 0; i < 100 && !player.combat.trailing; i++) player.update(1 / 60, meadow, still, false);
  assert.equal(player.combat.move, 'a');
  assert.equal(player.combat.inHand, true);
  assert.ok(player.trail.length > 0);
  assert.equal(player.attack(), true);
  assert.equal(player.combat.queued, 'b');
  const beforeCancel = player.vitals.stamina;
  player.cancelWeapon();
  assert.equal(player.vitals.stamina, beforeCancel);
  assert.equal(player.combat.busy, false);
  assert.equal(player.combat.queued, null);
  assert.equal(player.combat.inHand, false);
  assert.equal(player.combat.trailing, false);
  assert.equal(player.trail.length, 0);
  player.events.length = 0;
  advance(player, 1);
  assert.equal(player.combat.inHand, false);
  assert.equal(player.events.some((event) => event.type === 'slam'), false);
});

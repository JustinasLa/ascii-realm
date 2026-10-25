import assert from 'node:assert/strict';
import test from 'node:test';
import { toCells } from '../src/entities/monsters.js';
import { pickStruck, TARGET, TargetTracker, targetId } from '../src/core/target.js';

const player = { x: 0, y: 0, heading: 0 };
// A monster `metres` ahead of the player (or at an angle off its facing).
const monster = (id, metres = 1, angle = 0, extra = {}) => {
  const [x, y] = toCells(Math.sin(angle) * metres, Math.cos(angle) * metres);
  return { id, kind: { name: 'Goblin' }, alive: true, health: 35, maxHealth: 35, x, y, ...extra };
};
// Animals have no `enraged`, and die when their health runs out.
const deer = (id, metres = 1, angle = 0) => {
  const [x, y] = toCells(Math.sin(angle) * metres, Math.cos(angle) * metres);
  return { id, kind: { name: 'Deer', role: 'prey' }, health: 60, maxHealth: 60, x, y,
    get alive() { return this.health > 0; } };
};

test('ids say whether a creature is a monster or an animal', () => {
  assert.equal(targetId(monster(3)), 'monster:3');
  assert.equal(targetId(deer(3)), 'animal:3');
});

test('a marked creature shows by name and health until replaced', () => {
  const tracker = new TargetTracker();
  assert.equal(tracker.update(0, player), null);
  const goblin = monster(7);
  tracker.mark(goblin, 1);
  goblin.health = 22.4;
  assert.deepEqual(tracker.update(1, player), { id: 'monster:7', name: 'Goblin', health: 22.4, maxHealth: 35, note: '', slain: false });
  goblin.enraged = true;
  assert.equal(tracker.update(2, player).note, 'enraged');
  const rabbit = deer(2);
  tracker.mark(rabbit, 3);
  assert.equal(tracker.entity, rabbit);
  assert.equal(tracker.update(3, player).id, 'animal:2');
  tracker.mark(null, 4);
  assert.equal(tracker.entity, rabbit, 'nothing to mark leaves the target');
  tracker.clear();
  assert.equal(tracker.update(4, player), null);
});

test('a slain target is held for a moment, then cleared', () => {
  const tracker = new TargetTracker();
  const goblin = monster(1);
  tracker.mark(goblin, 0);
  goblin.alive = false;
  goblin.health = -4;
  assert.deepEqual(tracker.update(5, player), { id: 'monster:1', name: 'Goblin', health: 0, maxHealth: 35, note: 'slain', slain: true });
  assert.equal(tracker.update(5 + TARGET.slainHold - 0.01, player).slain, true);
  assert.equal(tracker.update(5 + TARGET.slainHold + 0.01, player), null);
  assert.equal(tracker.entity, null);
  // An animal is slain when its health runs out, even far away.
  const doe = deer(4, 30);
  tracker.mark(doe, 10);
  doe.health = 0;
  assert.equal(tracker.update(10, player).slain, true);
  // Marking another clears the hold.
  const other = monster(9);
  tracker.mark(other, 11);
  other.alive = false;
  assert.equal(tracker.update(20, player).slain, true, 'its own hold starts when it is seen dead');
});

test('a target that leaves the world is dropped at once', () => {
  const tracker = new TargetTracker();
  const goblin = monster(1);
  tracker.mark(goblin, 0);
  assert.ok(tracker.update(0, player, (id) => id === 'monster:1'));
  assert.equal(tracker.update(0, player, () => false), null);
  tracker.mark(goblin, 0);
  goblin.gone = true;
  assert.equal(tracker.update(0, player), null);
});

test('a target too far away or left alone too long is dropped', () => {
  const tracker = new TargetTracker();
  const goblin = monster(1, TARGET.range - 0.1);
  tracker.mark(goblin, 0);
  assert.ok(tracker.update(0, player));
  [goblin.x, goblin.y] = toCells(0, TARGET.range + 0.1);
  assert.equal(tracker.update(0, player), null);
  const troll = monster(2);
  tracker.mark(troll, 0);
  tracker.mark(troll, 14);
  assert.ok(tracker.update(14 + TARGET.forget - 0.01, player));
  assert.equal(tracker.update(14 + TARGET.forget + 0.01, player), null);
});

test('a nameless creature reads as a foe', () => {
  const tracker = new TargetTracker();
  tracker.mark({ id: 1, kind: {}, health: 5, maxHealth: 5, x: 0, y: 0 }, 0);
  assert.equal(tracker.update(0, player).name, 'Foe');
});

test('of several struck at once, the aimed-at one, else the one most ahead, is picked', () => {
  assert.equal(pickStruck([], player), null);
  assert.equal(pickStruck(null, player), null);
  const ahead = monster(5, 1, 0.1);
  const side = deer(1, 1, 0.9);
  assert.equal(pickStruck([side, ahead], player), ahead);
  assert.equal(pickStruck([side, ahead], player, side), side, 'the aim assist\'s foe wins when struck');
  assert.equal(pickStruck([side, ahead], player, monster(8)), ahead, 'one it missed does not');
  // Ties go to the lower id: animals before monsters, then by number.
  const left = monster(4, 1, -0.5);
  const right = monster(3, 1, 0.5);
  assert.equal(pickStruck([left, right], player), right);
  const doe = deer(6, 1, 0.5);
  assert.equal(pickStruck([right, doe], player), doe);
  assert.equal(pickStruck([doe, right], player), doe);
  // One standing on the player counts as straight ahead; a player with no
  // heading faces 0.
  const under = monster(2, 0);
  assert.equal(pickStruck([ahead, under], { x: 0, y: 0 }), under);
});

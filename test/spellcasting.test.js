import assert from 'node:assert/strict';
import test from 'node:test';
import { arithmetic } from '../src/spells/expression.js';
import { Spellcasting } from '../src/spells/casting.js';
import { practiceSpells } from '../src/spells/practice.js';
import { readSpellCast } from '../src/spells/protocol.js';
import { Player } from '../src/entities/player.js';
import { Monster, Monsters, toCells, toMetres } from '../src/entities/monsters.js';

export function scene(spells = practiceSpells, { wall = false, metres = 6 } = {}) {
  const player = new Player(0, 0);
  const monsters = new Monsters({ counts: {} });
  const foe = new Monster(...toCells(0, metres), { risen: true });
  monsters.list.push(foe);
  const world = { isWalkable(x, y) { const [, z] = toMetres(x, y); return !wall || Math.abs(z - 3) > 0.4; } };
  const ally = new Player(...toCells(3, 6));
  const casting = new Spellcasting({ player, monsters, world, spells, peers: () => [ally] });
  return { casting, player, monsters, foe, ally, world };
}

test('modifier arithmetic handles nested TF formulas without executing code', () => {
  assert.equal(arithmetic('max(1, min(400, <modifier.duration> * 20))', () => 6), 120);
  assert.equal(arithmetic('(<modifier.shield_power> + 3) / 4 - 1', () => 13), 3);
  assert.equal(arithmetic('globalThis.process.exit()'), 0);
  assert.equal(arithmetic('1 / 0'), 0);
});

test('fast projectiles hit once across a coarse frame and award a kill once', () => {
  const { casting, foe, monsters } = scene();
  foe.health = 12;
  assert.equal(casting.cast('practice-bolt', { heading: 0 }).ok, true);
  casting.update(0.5);
  assert.equal(foe.health, 0);
  assert.equal(monsters.kills, 1);
  assert.equal(casting.projectiles.length, 0);
  assert.ok(monsters.events.some(e => e.type === 'death'));
});

test('solid scenery stops a projectile before a target behind it', () => {
  const { casting, foe } = scene(practiceSpells, { wall: true });
  casting.cast('practice-bolt', { heading: 0 }); casting.update(0.5);
  assert.equal(foe.health, foe.maxHealth);
  assert.equal(casting.projectiles.length, 0);
});

test('a stronger hit during invulnerability does not let identical follow-up hits through', () => {
  const { casting, player, foe } = scene();
  foe.health = foe.maxHealth = 100;
  const spell = practiceSpells[0], ctx = casting.context(spell, spell.variants[0], player);
  for (const [amount, remaining] of [[10, 90], [15, 85], [15, 85], [12, 85], [20, 80]]) {
    casting.damage(foe, amount, ctx);
    assert.equal(foe.health, remaining);
  }
  casting.update(0.6);
  casting.damage(foe, 20, ctx);
  assert.equal(foe.health, 60, 'a new damage window applies the full hit');
});

test('recasts are limited by mana, not time; mana and silence reject without consuming resources', () => {
  const { casting, player } = scene();
  assert.equal(casting.cast('practice-bolt').ok, true);
  assert.equal(casting.mana, 96);
  assert.equal(casting.cast('practice-bolt').ok, true, 'an immediate recast only needs mana');
  assert.equal(casting.mana, 92);
  casting.state().mana = 3;
  assert.equal(casting.cast('practice-bolt').ok, false);
  casting.state().mana = 20;
  const ctx = casting.context(practiceSpells[0], practiceSpells[0].variants[0], player);
  casting.aura(player, { auraname: 'Silenced', d: '40' }, ctx);
  assert.equal(casting.cast('practice-bolt').ok, false);
  assert.equal(casting.mana, 20);
});

test('absorption takes damage before health and expires at its configured time', () => {
  const { casting, player } = scene();
  casting.cast('practice-shield');
  assert.equal(casting.state().shield, 10);
  assert.equal(player.takeDamage(12), 2);
  assert.equal(player.vitals.health, 98);
  casting.update(2); casting.update(1.1);
  assert.equal(casting.state().shield, 0);
});

test('a rejected weaker absorption potion preserves the stronger shield expiry', () => {
  const { casting, player } = scene();
  const spell = practiceSpells[1], ctx = casting.context(spell, spell.variants[0], player);
  casting.potion(player, { type: 'ABSORPTION', level: '5', duration: '60' }, ctx);
  player.takeDamage(5);
  casting.potion(player, { type: 'ABSORPTION', level: '1', duration: '20' }, ctx);
  assert.equal(casting.state().shield, 19);
  casting.update(1.1);
  assert.equal(player.takeDamage(10), 0, 'the weaker potion must not expire the stronger shield');
  assert.equal(player.vitals.health, 100);
  assert.equal(casting.state().shield, 9);
  casting.update(2);
  assert.equal(casting.state().shield, 0, 'the stronger potion still expires on schedule');
});

test('burn deals one pulse per second for its duration; reset cancels remaining pulses', () => {
  const { casting, foe } = scene();
  casting.cast('practice-burn', { target: foe }); casting.update(2);
  assert.equal(foe.health, 48);
  casting.reset(); casting.update(2);
  assert.equal(foe.health, 48);
  assert.equal(foe.magicSpeed, 1);
});

test('freeze prevents a player jumping and speed recovers after expiry', () => {
  const { casting, ally } = scene();
  casting.cast('practice-freeze', { target: ally }); casting.update(0.05);
  assert.equal(ally.magicSpeed, 0);
  ally.jump(); assert.equal(ally.windUp, -1);
  casting.update(2); casting.update(1.1);
  assert.equal(ally.magicSpeed, 1);
  ally.jump(); assert.notEqual(ally.windUp, -1);
});

test('channel validation rejects targets out of range before spending mana', () => {
  const spell = { id: 'close-heal', root: 'heal', variants: [{ id: 'rune', kind: 'rune', params: { mana: 6 } }],
    nodes: { heal: { targetConditions: ['isPlayer true', 'distance{d=<2} true'], steps: [{ op: 'heal', args: { a: '18' } }] } } };
  const { casting, ally } = scene([spell]); ally.vitals.health = 20;
  assert.equal(casting.cast(spell.id, { target: ally }).ok, false);
  assert.equal(casting.mana, 100);
  [ally.x, ally.y] = toCells(0, 1);
  assert.equal(casting.cast(spell.id, { target: ally }).ok, true);
  assert.equal(ally.vitals.health, 38);
  assert.equal(casting.mana, 94);
});

test('spell relay accepts allowlisted intent and rejects arbitrary actions or invalid coordinates', () => {
  assert.deepEqual(readSpellCast({ id: 'bolt', heading: 0, aim: { x: 1, y: 2 } }, ['bolt']),
    { id: 'bolt', heading: 0, aim: { x: 1, y: 2 }, targetId: null });
  assert.equal(readSpellCast({ id: 'delete-world', heading: 0 }, ['bolt']), null);
  assert.equal(readSpellCast({ id: 'bolt', heading: Infinity }, ['bolt']), null);
  assert.equal(readSpellCast({ id: 'bolt', heading: 0, aim: { x: NaN, y: 2 } }, ['bolt']), null);
});

test('fan projectile offsets spread shots instead of multiplying hits along one line', () => {
  const bolt = structuredClone(practiceSpells[0]);
  const base = bolt.nodes[bolt.root].steps[0];
  bolt.nodes[bolt.root].steps = [-45, 0, 45].map(ho => ({ ...base, args: { ...base.args, ho: String(ho) } }));
  const { casting, foe } = scene([bolt]);
  casting.cast(bolt.id, { heading: 0 }); casting.update(0.5);
  assert.equal(foe.health, 48);
});

test('deferred area effects keep the projectile position where the effect was created', () => {
  const spell = { id: 'trail', root: 'trail', variants: [{ id: 'rune', kind: 'rune' }], nodes: {
    trail: { steps: [{ op: 'projectile', args: { v: '5', mr: '20', hnp: 'false', hp: 'false', se: 'false', i: '4', ontick: 'pulse' }, target: { op: 'forward', args: { f: '20' } } }] },
    pulse: { steps: [{ op: 'skill', args: { s: 'blast', delay: '20' }, target: { op: 'entitiesnearorigin', args: { r: '2' } } }] },
    blast: { steps: [{ op: 'mmodamage', args: { a: '12' } }] },
  } };
  const { casting, foe } = scene([spell], { metres: 4 });
  casting.cast(spell.id, { heading: 0 }); casting.update(2); casting.update(0.5);
  assert.ok(foe.health < foe.maxHealth);
});

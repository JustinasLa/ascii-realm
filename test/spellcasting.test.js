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

test('modifier arithmetic handles nested rune formulas without executing code', () => {
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

test('vfx_ summons only pulse, while a defined summon spawns a short-lived helper', () => {
  const summoner = { id: 'summoner', name: 'Summoner', element: 'oseni', root: 'summon_root',
    variants: [{ id: 'rune', kind: 'rune', params: {}, root: 'summon_root', trigger: 'CAST' }],
    nodes: { summon_root: { steps: [{ op: 'summon', args: { type: 'VFX_Ward' } }, { op: 'summon', args: { type: 'Helper' } }] } },
    summons: { vfx_ward: [{ event: 'onspawn', op: 'heal', args: { amount: '5' } }], helper: [] } };
  const { casting } = scene([summoner]);
  assert.equal(casting.cast('summoner').ok, true);
  assert.equal(casting.summons.length, 1, 'only the defined, non-vfx summon spawns');
  assert.ok(casting.effects.list.some(e => e.stage === 'pulse' && e.shape === 'ward'), 'the vfx_ summon shows a ward pulse');
});

const graph = (id, steps, { trigger = 'CAST', ...extra } = {}) => ({ id, name: id, element: 'oseni', root: 'root',
  variants: [{ id: 'rune', kind: 'rune', params: {}, root: 'root', trigger }], nodes: { root: { steps } }, ...extra });
const mark = (name, value = '1') => ({ op: 'setvariable', args: { var: `caster.${name}`, value }, target: { op: 'self', args: {} } });

test('class abilities scale their parameters with level inside their bounds', () => {
  const { casting } = scene();
  casting.level = 3;
  const params = { mana: 4, damage: { base: 4, 'per-level': 2, max: 7 }, duration: { 'per-level': -1, min: 0 }, radius: {} };
  assert.deepEqual(casting.modifiers({ params }), { mana: 4, damage: 7, duration: 0, radius: 0 });
});

test('skill expressions resolve x and treat unknown placeholders as zero', () => {
  const { casting, player } = scene();
  const ctx = casting.context(practiceSpells[0], practiceSpells[0].variants[0], player);
  assert.equal(casting.resolve('x', { ...ctx, x: 4 }), 4);
  assert.equal(casting.resolve('x', ctx), 0);
  assert.equal(casting.resolve('unknown.placeholder', ctx), 0);
});

test('wait steps hold later steps until the caster lands, or briefly otherwise', () => {
  const spell = graph('waiter', [{ op: 'wait', args: { cond: 'onground' } }, mark('landed'), { op: 'wait', args: {} }, mark('paused')]);
  const { casting, player } = scene([spell]);
  assert.equal(casting.cast('waiter').ok, true);
  casting.update(0.4);
  assert.equal(casting.variable(player, 'landed'), undefined);
  casting.update(0.2);
  assert.equal(casting.variable(player, 'landed'), 1, 'a grounded caster waits half a second');
  assert.equal(casting.variable(player, 'paused'), undefined);
  casting.update(0.2);
  assert.equal(casting.variable(player, 'paused'), 1, 'other waits last a fifth of a second');
});

test('a summoned helper runs its spawn step at once and its timer steps on schedule', () => {
  const spell = graph('caller', [{ op: 'summon', args: { type: 'Helper' } }], { summons: { helper: [
    { event: 'onspawn', ...mark('spawned') },
    { event: 'ontimer:20', op: 'variableadd', args: { var: 'caster.pulses', amount: '1' } },
    { event: 'ontimer', op: 'variableadd', args: { var: 'caster.beats', amount: '1' } },
    { event: 'ondeath', ...mark('died') },
  ] } });
  const { casting } = scene([spell]);
  assert.equal(casting.cast('caller').ok, true);
  const [helper] = casting.summons;
  assert.equal(casting.variable(helper, 'spawned'), 1);
  casting.update(1.5); casting.update(1);
  assert.equal(casting.variable(helper, 'pulses'), 2, 'one pulse per 20-tick interval');
  assert.equal(casting.variable(helper, 'beats'), 2, 'timers without an interval run every second');
  assert.equal(casting.variable(helper, 'died'), undefined, 'other events wait for their trigger');
});

test('triggered abilities cast passively with the triggering damage amount', () => {
  const struck = graph('riposte', [mark('struck', '<skill.var.damage-amount>')], { trigger: 'ATTACK' });
  const hurt = graph('backlash', [mark('hurt', '<skill.var.damage-amount>')], { trigger: 'DAMAGED_BY_ENTITY' });
  const { casting, player, foe } = scene([struck, hurt, graph('plain', [mark('plain')])]);
  assert.equal(casting.cast('riposte').ok, false, 'a triggered ability cannot be cast by hand');
  casting.trigger('ATTACK', player, foe, 7);
  assert.equal(casting.variable(player, 'struck'), 7);
  assert.equal(casting.variable(player, 'hurt'), undefined);
  casting.trigger('DAMAGED', player, foe, 3);
  assert.equal(casting.variable(player, 'hurt'), 3);
  assert.equal(casting.variable(player, 'plain'), undefined, 'cast abilities never trigger');
});

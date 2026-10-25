import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import spell from '../../src/spells/definitions/ring-of-fire.js';
import { RING_LIFE, RING_RADIUS } from '../../src/spells/presentations/ring-of-fire.js';
import { oseni } from '../../src/spells/elements/oseni.js';
import { spellIds } from '../../src/spells/catalog.js';
import { Monster, toCells } from '../../src/entities/monsters.js';
import { runeScene } from '../../test-support/spells.js';

// A foe standing at `metres` east of the caster, with health to spare.
function foeAt(scene, metres, z = 0) {
  const foe = new Monster(...toCells(metres, z), { risen: true });
  foe.health = foe.maxHealth = 100;
  scene.monsters.list.push(foe);
  scene.casting.sync();
  return foe;
}
// Counts the ring's pulses on a foe from its health, before any burn tick.
const pulses = foe => (100 - foe.health) / 3;
function steps(scene, seconds, step) {
  for (let left = seconds; left > 1e-9;) { const dt = Math.min(step, left); scene.casting.update(dt); left -= dt; }
}

test('Ring of Fire is an authored Greater Oseni rune whose ring matches its drawn size', () => {
  assert.ok(oseni.includes(spell.id) && spellIds.includes(spell.id));
  assert.equal(oseni.at(-1), spell.id, 'appended after the other Oseni runes');
  assert.equal(spell.element, 'oseni');
  assert.equal(spell.supportive, false);
  assert.deepEqual(spell.variants[0].params, { cooldown: 20, mana: 8, damage: 3, duration: 6, burn_duration: 3, radius: 1.5 });
  assert.equal(RING_RADIUS, spell.variants[0].params.radius);
  assert.equal(RING_LIFE, (spell.variants[0].params.duration * 20 - 1) / 20);
  assert.match(spell.source.authored, /^ASCII Realm /);
  for (const file of ['definitions', 'presentations']) {
    const text = readFileSync(new URL(`../../src/spells/${file}/ring-of-fire.js`, import.meta.url), 'utf8');
    // Spelled apart so the outside names this game draws on never appear here either.
    const outside = new RegExp(['t f [-\\s]? m i n e c r a f t', 't f m c', 't l i b s'].map(n => n.replaceAll(' ', '')).join('|'), 'i');
    assert.doesNotMatch(text, outside);
  }
});

test('a cast spends 8 mana and lays a ring zone that follows the caster', () => {
  const { casting, player, cast } = runeScene(spell, { range: 1 });
  assert.equal(cast().ok, true);
  assert.equal(casting.mana, 92);
  assert.equal(casting.zones.length, 1);
  assert.equal(casting.zones[0].follow, player);
  assert.equal(casting.zones[0].radius, 1.5);
});

test('the ring pulses 3 damage every half second from its first update, exactly twelve times', () => {
  const scene = runeScene(spell, { range: 1 });
  const { foe, cast, advance, potion, casting } = scene;
  assert.equal(cast().ok, true);
  assert.equal(foe.health, 100, 'the first pulse lands on the next update');
  advance(0.05);
  assert.equal(foe.health, 97);
  assert.ok(potion(foe, 'fire'), 'and sets the foe burning');
  advance(0.5);
  assert.equal(foe.health, 94);
  const seen = new Set();
  for (let t = 0.55; t < 5.98; t += 0.05) { advance(0.05); seen.add(100 - foe.health); assert.ok(potion(foe, 'fire')); }
  assert.ok([...seen].every(lost => lost % 3 === 0), 'no burn tick lands while the foe stands in the flames');
  assert.equal(pulses(foe), 12);
  assert.equal(casting.zones.length, 0, 'the ring is gone by six seconds');
});

test('the twelve-pulse count holds for coarse, fine and boundary-landing steps', () => {
  // [seconds, step] legs; the boundary plans stop exactly on 5.5, 5.95 and 6.0 s.
  for (const plan of [[[6.2, 0.25]], [[6.2, 1 / 60]], [[5.5, 0.5], [0.45, 0.45], [0.05, 0.05], [0.2, 0.2]],
    [[5.95, 0.05], [0.05, 0.05], [0.2, 0.1]]]) {
    const scene = runeScene(spell, { range: 1 });
    assert.equal(scene.cast().ok, true);
    for (const [seconds, step] of plan) steps(scene, seconds, step);
    assert.equal(pulses(scene.foe), 12, `steps ${JSON.stringify(plan)}`);
    assert.equal(scene.casting.zones.length, 0);
  }
});

test('a foe that leaves the ring burns 1 a second for the rest of its three seconds', () => {
  const { foe, cast, advance, potion } = runeScene(spell, { range: 1 });
  assert.equal(cast().ok, true);
  advance(1.05);
  assert.equal(foe.health, 91, 'three pulses');
  [foe.x, foe.y] = toCells(0, 4);
  advance(0.9);
  assert.equal(foe.health, 91, 'no pulse reaches it out here, and the burn waits a second');
  advance(0.2);
  assert.equal(foe.health, 90);
  advance(1);
  assert.equal(foe.health, 89);
  advance(0.9);
  assert.equal(potion(foe, 'fire'), undefined, 'the burn is over three seconds after the last pulse');
  assert.equal(foe.health, 89);
});

test('foes whose body touches the band burn; a foe walking through is caught on the way', () => {
  const scene = runeScene(spell, { range: 6 });
  const near = foeAt(scene, 2.2), far = foeAt(scene, 2.3);
  assert.equal(scene.cast().ok, true);
  scene.advance(0.05);
  assert.equal(near.health, 97);
  assert.equal(far.health, 100);

  const walk = runeScene(spell, { range: 6 });
  const walker = foeAt(walk, -3);
  assert.equal(walk.cast().ok, true);
  const speed = walker.kind.walkSpeed * 2;
  for (let t = 0; t < 6 / speed; t += 0.05) { walker.x += toCells(speed * 0.05, 0)[0]; walk.casting.update(0.05); }
  assert.ok(100 - walker.health >= 6, 'at least two pulses as it crosses');
});

test('the ring follows the caster: a foe at the new spot burns, the old spot is left alone', () => {
  const scene = runeScene(spell, { range: 1 });
  const { casting, player, foe, cast, advance } = scene;
  const ahead = foeAt(scene, 4);
  assert.equal(cast().ok, true);
  advance(0.05);
  assert.equal(foe.health, 97);
  assert.equal(ahead.health, 100);
  player.x = toCells(4, 0)[0];
  advance(0.5);
  assert.equal(ahead.health, 97);
  assert.equal(foe.health, 97);
  const zone = casting.effects.list.find(e => e.stage === 'zone');
  assert.equal(casting.zones[0].x, player.x);
  assert.equal(zone.x, player.x);
  assert.equal(zone.y, player.y);
});

test('the flames never hurt the caster or a friend standing in them', () => {
  const { player, ally, cast, advance, potion } = runeScene(spell, { range: 1, allyInPath: true, allyRange: 1 });
  assert.equal(cast().ok, true);
  advance(6.5);
  assert.equal(player.vitals.health, 60);
  assert.equal(ally.vitals.health, 20);
  assert.equal(potion(ally, 'fire'), undefined);
  assert.equal(potion(player, 'fire'), undefined);
});

test('the rune recharges for twenty seconds: recasts are refused, cost nothing and say why', () => {
  const { casting, cast, advance } = runeScene(spell, { range: 1 });
  const notes = [];
  casting.notify = message => notes.push(message);
  assert.equal(cast().ok, true);
  for (const wait of [1, 5.1, 13.8]) {
    advance(wait);
    const mana = casting.mana;
    assert.equal(cast().ok, false, `refused at ${casting.time.toFixed(1)} s`);
    assert.equal(casting.mana, mana);
    assert.equal(notes.at(-1), 'Ring of Fire is still recharging.');
    assert.ok(casting.zones.length <= 1, 'rings never stack');
  }
  assert.equal(notes.length, 3);
  advance(0.2);
  assert.equal(cast().ok, true, 'ready again after twenty seconds');
  assert.equal(casting.zones.length, 1);
});

test('Ring of Fire cannot be cast while silenced or without mana', () => {
  const { casting, player, cast, castWithoutMana } = runeScene(spell, { range: 1 });
  assert.equal(castWithoutMana().ok, false);
  assert.equal(casting.zones.length, 0);
  casting.aura(player, { auraname: 'Silenced', d: '100' }, casting.context(spell, spell.variants[0], player));
  assert.equal(cast().ok, false);
  assert.equal(casting.mana, 100);
  assert.equal(casting.zones.length, 0);
});

test('when the ring ends it leaves a five-second scorch where the caster last stood', () => {
  const { casting, player, cast, advance } = runeScene(spell, { range: 1 });
  assert.equal(cast().ok, true);
  advance(3);
  player.x = toCells(2, 0)[0];
  advance(3);
  const scorches = casting.effects.list.filter(e => e.stage === 'pulse' && e.shape === 'scorch');
  assert.equal(scorches.length, 1);
  const [scorch] = scorches;
  assert.equal(scorch.life, 5);
  assert.equal(scorch.follow, null);
  assert.equal(scorch.radius, 1.5);
  assert.equal(scorch.x, player.x);
  const zone = casting.effects.list.find(e => e.stage === 'zone');
  assert.equal(zone, undefined, 'the ring itself has gone out');
  player.x = toCells(5, 0)[0];
  advance(1);
  assert.equal(scorch.x, toCells(2, 0)[0], 'the scorch stays put');
});

test('reset clears the ring at once; a fallen caster\'s ring goes out but burns run their course', () => {
  const scene = runeScene(spell, { range: 1 });
  assert.equal(scene.cast().ok, true);
  scene.advance(0.05);
  scene.casting.reset();
  assert.equal(scene.casting.zones.length, 0);
  assert.equal(scene.casting.effects.list.length, 0);
  const health = scene.foe.health;
  scene.advance(4);
  assert.equal(scene.foe.health, health);

  const dying = runeScene(spell, { range: 1 });
  assert.equal(dying.cast().ok, true);
  dying.advance(1.05);
  assert.equal(dying.foe.health, 91);
  dying.player.vitals.health = 0;
  dying.casting.update(0.025);
  assert.equal(dying.casting.zones.length, 0, 'the ring goes out in the update the caster falls');
  const before = dying.foe.health;
  const losses = [];
  for (let t = 0; t < 4; t += 0.05) { const h = dying.foe.health; dying.advance(0.05); if (h !== dying.foe.health) losses.push(h - dying.foe.health); }
  assert.ok(losses.every(lost => lost === 1), 'only burn ticks, no pulses');
  assert.ok(losses.length >= 2 && losses.length <= 3);
  assert.equal(dying.foe.health, before - losses.length);
});

test('burn ticks show flames that follow the burning foe', () => {
  const { casting, foe, cast, advance } = runeScene(spell, { range: 1 });
  assert.equal(cast().ok, true);
  advance(0.05);
  [foe.x, foe.y] = toCells(0, 4);
  advance(1.1);
  const burn = casting.effects.list.find(e => e.stage === 'impact' && e.shape === 'burn');
  assert.ok(burn, 'a burn impact');
  assert.equal(burn.follow, foe);
  assert.equal(burn.life, 1);
  foe.x += 10;
  advance(0.05);
  assert.equal(burn.x, foe.x);
});

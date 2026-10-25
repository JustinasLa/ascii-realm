import assert from 'node:assert/strict';
import test from 'node:test';
import { Spellcasting } from '../src/spells/casting.js';
import { practiceSpells } from '../src/spells/practice.js';
import { Player } from '../src/entities/player.js';
import { Monster, Monsters, toCells } from '../src/entities/monsters.js';

// Every blow a spell lands is reported, so the caster's phone can buzz.
function scene() {
  const player = new Player(0, 0);
  const monsters = new Monsters({ counts: {} });
  const foe = new Monster(...toCells(0, 6), { risen: true });
  monsters.list.push(foe);
  const blows = [];
  const casting = new Spellcasting({ player, monsters, world: { isWalkable: () => true }, spells: practiceSpells,
    onDamage: (target, amount, ctx) => blows.push({ target, amount, caster: ctx.caster }) });
  return { casting, player, foe, blows };
}

test('a spell that damages a monster reports the blow once', () => {
  const { casting, player, foe, blows } = scene();
  assert.equal(casting.cast('practice-bolt', { heading: 0 }).ok, true);
  casting.update(0.5);
  assert.equal(blows.length, 1);
  assert.equal(blows[0].target, foe);
  assert.equal(blows[0].caster, player);
  assert.ok(blows[0].amount > 0);
});

test('self-damage, heals and blows that miss are not reported', () => {
  const { casting, player, foe, blows } = scene();
  const spell = practiceSpells[0], ctx = casting.context(spell, spell.variants[0], player);
  casting.damage(player, 10, ctx);
  casting.damage(foe, 0, ctx);
  foe.state = 'rise';
  foe.stateTime = 0;
  casting.damage(foe, 10, ctx);
  assert.deepEqual(blows, [], 'a freshly rising skeleton cannot be hurt yet');
  const other = new Player(...toCells(2, 0));
  casting.damage(other, 10, { ...ctx, caster: foe });
  assert.equal(blows.length, 1, 'a blow on a player counts too; the game decides who buzzes');
  assert.equal(blows[0].target, other);
  // The default hook does nothing.
  new Spellcasting({ player, monsters: { list: [] }, world: {} }).onDamage(foe, 1, ctx);
});

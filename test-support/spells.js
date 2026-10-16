import { Spellcasting } from '../src/spells/casting.js';
import { Player } from '../src/entities/player.js';
import { Monster, Monsters, toCells } from '../src/entities/monsters.js';

export function runeScene(spell, { range = 4, allyRange = 4, allyInPath = false, wall = false } = {}) {
  const player = new Player(0, 0), ally = new Player(...toCells(allyInPath ? 0 : 16, allyRange));
  player.vitals.health = 60; ally.vitals.health = 20;
  const monsters = new Monsters({ counts: {} });
  const foe = new Monster(...toCells(0, range), { risen: true });
  foe.health = foe.maxHealth = 100;
  monsters.list.push(foe);
  const world = { isWalkable(x, y) { return !wall || y < toCells(0, 2)[1] || y > toCells(0, 2.6)[1]; } };
  const casting = new Spellcasting({ player, monsters, world, spells: [spell], peers: () => [ally] });
  casting.state(ally).mana = 20;
  const advance = seconds => { for (let left = seconds; left > 1e-8;) { const step = Math.min(left, 0.05); casting.update(step); left -= step; } };
  const cast = (options = {}) => casting.cast(spell.id, { target: spell.supportive ? ally : foe, heading: 0, ...options });
  const aura = (entity, name) => casting.hasAura(entity, name);
  const potion = (entity, name) => casting.state(entity).potions.get(name);
  return { casting, player, ally, monsters, foe, world, advance, cast, aura, potion };
}

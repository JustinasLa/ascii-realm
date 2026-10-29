import { ATTRIBUTES } from '../character/catalog.js';
import { denars } from '../inventory/wallet.js';

const SHORT = { strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA' };

// Shown as the HUD frame shows them; a number the game lacks is `--`.
const vital = (value, maximum) => Number.isFinite(value) && Number.isFinite(maximum)
  ? `${Math.round(value)}/${Math.round(maximum)}` : '--/--';
const tenths = (value) => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '--';

// The character sheet's stats strip: `{ key, label, value }` pairs in the
// reference's order, only for numbers the game has. `mana` is a source
// with mana and maxMana, `attributes` the six totals and `cents` the pouch.
export function sheetStats({ vitals, mana = null, attributes = null, weight, capacity, cents = null }) {
  const pairs = [{ key: 'hp', label: 'HP', value: vital(vitals.health, vitals.maxHealth) }];
  if (mana) pairs.push({ key: 'mp', label: 'MP', value: vital(mana.mana, mana.maxMana) });
  pairs.push({ key: 'stamina', label: 'stamina', value: vital(vitals.stamina, vitals.maxStamina) });
  if (attributes) {
    for (const key of ATTRIBUTES) pairs.push({ key, label: SHORT[key], value: tenths(attributes[key]) });
  }
  pairs.push({ key: 'weight', label: 'weight', value: `${tenths(weight)}/${tenths(capacity)} kg` });
  if (Number.isFinite(cents)) pairs.push({ key: 'pouch', label: 'pouch', value: `${denars(cents)}d` });
  return pairs;
}

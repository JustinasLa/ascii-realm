import { ITEMS } from '../inventory/items.js';
import { getWeapon } from './weapons.js';

// The outlaw's combat is tuned on the iron short sword; other weapons swing
// faster or slower relative to it.
const BASE = getWeapon('sword-shield', 'iron');
// Blows needed to fell a tree: an axe takes one, heavy blades and hammers two.
const CHOP = { axe: 3, greatsword: 2, hammer: 2 };

// The weapon in the main hand, with its material, or null when unarmed.
export function heldWeapon(equipment) {
  const stack = equipment?.mainHand;
  const item = stack && ITEMS[stack.id];
  if (!item?.weapon) return null;
  return getWeapon(item.weapon, stack.material ?? 'iron');
}

// How a weapon changes the shared swings: their speed, stamina cost, how
// far ahead a cut lands (metres) and its power against trees.
export function weaponFeel(weapon) {
  if (!weapon) return { tempo: 1, stamina: 15, reach: 0.95, chop: 1 };
  return {
    tempo: weapon.speed / BASE.speed,
    stamina: weapon.staminaCost * (15 / BASE.staminaCost),
    reach: Math.max(0.45, Math.min(1.6, 0.95 * weapon.reach / BASE.reach)),
    chop: CHOP[weapon.type] ?? 1,
  };
}

// Bows shoot; spears and javelins are thrown when held and released.
export const isBow = (weapon) => weapon?.type === 'bow';
export const isThrown = (weapon) => weapon?.type === 'spear' || weapon?.type === 'javelin';

// For now the outlaw's clothes are part of the character rather than items,
// so they are always worn; only the hands' gear follows the equipment.
const OUTFIT = new Set(['helm', 'chest', 'legs', 'hands', 'cape']);
export const wears = (equipment, slot) => equipment === undefined || OUTFIT.has(slot) || Boolean(equipment?.[slot]);

// A two-handed weapon in the main hand leaves no hand free for a torch.
export const needsBothHands = (equipment) => Boolean(ITEMS[equipment?.mainHand?.id]?.twoHanded);

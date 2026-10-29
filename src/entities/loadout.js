import { DEFAULT_SKIN } from '../character/skin.js';
import { ITEMS } from '../inventory/items.js';
import { getWeapon, weaponMaterial } from './weapons.js';

// The outlaw's combat is tuned on the iron short sword; other weapons swing
// faster or slower relative to it.
const BASE = getWeapon('sword-shield', 'iron');
// Blows needed to fell a tree: an axe takes one, heavy blades and hammers two.
const CHOP = { axe: 3, greatsword: 2, hammer: 2 };

// The weapon in the main hand, with its material, or null when unarmed. A
// forged weapon is its own metal; any other takes its tier, else iron.
export function heldWeapon(equipment) {
  const stack = equipment?.mainHand;
  const item = stack && ITEMS[stack.id];
  if (!item?.weapon) return null;
  return getWeapon(item.weapon, stack.forged ? weaponMaterial(stack, 'iron') : stack.material ?? item.material ?? 'iron');
}

// What a held stack is made of, so changing to another metal of the same
// weapon still counts as changing weapons.
export const heldKey = (stack) => stack.forged ? weaponMaterial(stack, 'iron').key : stack.material ?? '';

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
// so they are always worn; only the hands' gear follows the equipment. The
// skin can take off the hood, jerkin and cloak, showing what is beneath.
const OUTFIT = new Set(['helm', 'chest', 'legs', 'feet', 'hands', 'cape']);
const LAYER_OF = { helm: 'hood', chest: 'jerkin', cape: 'cloak' };
export const wears = (equipment, slot, skin = DEFAULT_SKIN) =>
  (equipment === undefined || OUTFIT.has(slot) || Boolean(equipment?.[slot]))
  && (!Object.hasOwn(LAYER_OF, slot) || skin.layers[LAYER_OF[slot]] !== false);

// A two-handed weapon in the main hand leaves no hand free for a torch.
export const needsBothHands = (equipment) => Boolean(ITEMS[equipment?.mainHand?.id]?.twoHanded);

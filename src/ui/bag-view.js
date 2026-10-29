import { ITEMS } from '../inventory/items.js';

// What kind of item a stack is, for the bag's filter tabs. The first four
// tabs always show; the rest only while the bag holds some.
export const BAG_TABS = Object.freeze([
  { id: 'all', label: 'All', fixed: true },
  { id: 'weapons', label: 'Weapons', fixed: true },
  { id: 'armor', label: 'Armor', fixed: true },
  { id: 'cloaks', label: 'Cloaks', fixed: true },
  { id: 'ammo', label: 'Ammo' },
  { id: 'consumables', label: 'Consumables' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'materials', label: 'Materials' },
].map((tab) => Object.freeze(tab)));

const ARMOR_SLOTS = ['helm', 'chest', 'legs', 'hands', 'feet', 'ring', 'ringLeft', 'ringRight', 'amulet'];

// Arrows, then cloaks, weapons (the pickaxe too), instruments, armour (the
// buckler with it), consumables, and everything else as materials.
export function itemKind(item) {
  const tags = item?.tags ?? [];
  const slot = item?.equipmentSlot;
  if (slot === 'quiver' || tags.includes('ammo')) return 'ammo';
  if (slot === 'cape') return 'cloaks';
  if (tags.includes('weapon')) return 'weapons';
  if (tags.includes('instrument')) return 'instruments';
  if (ARMOR_SLOTS.includes(slot) || tags.includes('shield')) return 'armor';
  if (item?.use) return 'consumables';
  return 'materials';
}

// The bag's count, its tabs with stack counts and the bag indices `filter`
// shows, in slot order. A filter whose tab isn't shown falls back to all.
export function bagView(slots, filter = 'all') {
  const kinds = slots.map((stack) => stack && ITEMS[stack.id] ? itemKind(ITEMS[stack.id]) : null);
  const count = (id) => kinds.filter((kind) => kind && (id === 'all' || kind === id)).length;
  const tabs = [];
  for (const { id, label, fixed } of BAG_TABS) {
    const n = count(id);
    if (fixed || n) tabs.push({ id, label, count: n });
  }
  const shown = tabs.some((tab) => tab.id === filter) ? filter : 'all';
  const visible = [];
  for (const [index, kind] of kinds.entries()) if (kind && (shown === 'all' || kind === shown)) visible.push(index);
  return { used: count('all'), total: slots.length, tabs, filter: shown, visible };
}

// A stack's material: a forged weapon's own (`own` is its described
// version, whose stats are capitalised), else its item's.
export function materialOf(item, own = null) {
  return own?.stats?.Material ?? own?.stats?.material ?? item?.stats?.Material ?? item?.stats?.material ?? null;
}

// The card's bottom-left word: `×30` for stackable items, else the gear's material.
export function cardLabel(stack, item, own = null) {
  if (item.stackLimit > 1) return `×${stack.count}`;
  return String(materialOf(item, own) ?? '').toLowerCase();
}

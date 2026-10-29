import { EQUIPMENT_SLOTS, ITEMS } from './items.js';

const SLOT_COUNT = 24;
const HOTBAR_COUNT = 9;
const WEIGHT_EPSILON = 1e-9;

const itemFor = (id) => typeof id === 'string' && Object.hasOwn(ITEMS, id) ? ITEMS[id] : null;
const validIndex = (index, length) => Number.isInteger(index) && index >= 0 && index < length;
const validCount = (count) => Number.isSafeInteger(count) && count > 0;

function validStack(stack) {
  const item = itemFor(stack?.id);
  return !!item && validCount(stack.count) && stack.count <= item.stackLimit;
}

// A stack's own properties beyond its item and count: a weapon's material, an
// alloy ingot's alloy id, or the inputs a scrap's failed mix consumed. Only
// stacks with the same properties merge.
const MATERIALS = ['stone', 'copper', 'bronze', 'iron', 'steel'];
const ALLOY_ID = /^a[1-9]\d{0,3}$/;
// Up to five item ids with whole counts of 1–5, kept in id order.
function inputsOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 5) return null;
  if (!entries.every(([id, n]) => Object.hasOwn(ITEMS, id) && Number.isSafeInteger(n) && n >= 1 && n <= 5)) return null;
  return Object.freeze(Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1))));
}
export function stackExtras(stack) {
  const extras = {};
  if (MATERIALS.includes(stack?.material)) extras.material = stack.material;
  if (typeof stack?.alloy === 'string' && ALLOY_ID.test(stack.alloy)) extras.alloy = stack.alloy;
  const inputs = inputsOf(stack?.inputs);
  if (inputs) extras.inputs = inputs;
  return extras;
}
const sameExtras = (stack, extras) => JSON.stringify(stackExtras(stack)) === JSON.stringify(stackExtras(extras));

// Fills existing stacks before empty slots. Callers can use a copy of the bag
// to plan a transfer without changing anything when it cannot fit in full.
function putInSlots(slots, id, count, extras = {}) {
  const item = ITEMS[id];
  let remaining = count;
  for (const stack of slots) {
    if (!stack || stack.id !== id || !validStack(stack) || !sameExtras(stack, extras)) continue;
    const amount = Math.min(remaining, item.stackLimit - stack.count);
    stack.count += amount;
    remaining -= amount;
    if (!remaining) return count;
  }
  for (let index = 0; index < SLOT_COUNT && remaining; index++) {
    if (slots[index] !== null) continue;
    const amount = Math.min(remaining, item.stackLimit);
    slots[index] = { id, count: amount, ...extras };
    remaining -= amount;
  }
  return count - remaining;
}

function restore(vitals, stat, amount) {
  if (!vitals || !Number.isFinite(amount) || amount <= 0) return 0;
  const method = stat === 'health' ? 'heal' : 'restoreStamina';
  if (typeof vitals[method] === 'function') {
    const restored = vitals[method](amount);
    return Number.isFinite(restored) && restored > 0 ? restored : 0;
  }
  // Plain state objects are also useful for consumers outside Player/Vitals.
  const maximum = stat === 'health' ? vitals.maxHealth : vitals.maxStamina;
  const current = vitals[stat];
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || current < 0 || current >= maximum) return 0;
  const restored = Math.min(amount, maximum - current);
  vitals[stat] = current + restored;
  return restored;
}

export class Inventory {
  constructor({ starter = true, capacity = 60 } = {}) {
    this.slots = Array(SLOT_COUNT).fill(null);
    this.equipment = Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
    this.hotbar = Array(HOTBAR_COUNT).fill(null);
    this.selectedHotbar = 0;
    this.capacity = Number.isFinite(capacity) && capacity >= 0 ? capacity : 60;
    this.events = [];
    if (!starter) return;

    for (const id of ['outlawHood', 'leatherJerkin', 'ridingBoots', 'leatherBracers', 'travelCloak', 'shortSword']) {
      if (this.add(id)) this.equip(this.slots.findIndex((stack) => stack?.id === id));
    }
    for (const [id, count] of [
      ['healingDraught', 3], ['staminaTonic', 3], ['bandage', 5],
      ['rawIron', 6], ['oakLog', 3], ['woodenBuckler', 1],
      // Every weapon to try, with arrows for the bow.
      ['longbow', 1], ['arrow', 30], ['spear', 1], ['javelin', 3], ['battleAxe', 1], ['dagger', 1],
      ['greatsword', 1], ['warHammer', 1], ['quarterstaff', 1],
    ]) this.add(id, count);
    for (const [index, id] of ['shortSword', 'healingDraught', 'staminaTonic', 'bandage',
      'longbow', 'spear', 'javelin', 'battleAxe', 'dagger'].entries()) {
      this.assignHotbar(index, id);
    }
    this.events.length = 0;
  }

  get weight() {
    let total = 0;
    for (const stack of [...this.slots, ...Object.values(this.equipment)]) {
      if (validStack(stack)) total += ITEMS[stack.id].weight * stack.count;
    }
    // Keep displayed weights stable when adding decimal kilogram amounts.
    return Math.round(total * 1e9) / 1e9;
  }

  // The world uses this before pulling a loose item toward the player. A
  // capacity check must not collect it, mutate stacks or emit pickup events.
  spaceFor(id, count = 1, extras = {}) {
    const item = itemFor(id);
    if (!item || !validCount(count) || !Number.isFinite(this.capacity) || this.capacity < 0) return 0;
    const availableWeight = Math.max(0, this.capacity - this.weight);
    const allowed = item.weight > 0
      ? Math.max(0, Math.floor((availableWeight + WEIGHT_EPSILON) / item.weight))
      : count;
    const amount = Math.min(count, allowed);
    if (!amount) return 0;
    const properties = stackExtras(extras);
    let space = 0;
    for (let index = 0; index < SLOT_COUNT && space < amount; index++) {
      const stack = this.slots[index];
      if (stack === null) space += item.stackLimit;
      else if (validStack(stack) && stack.id === id && sameExtras(stack, properties)) space += item.stackLimit - stack.count;
    }
    return Math.min(amount, space);
  }

  // `extras` are the stack's own properties, e.g. { material: 'steel' }.
  add(id, count = 1, extras = {}) {
    const amount = this.spaceFor(id, count, extras);
    if (!amount) return 0;
    const added = putInSlots(this.slots, id, amount, stackExtras(extras));
    if (added) this.events.push({ type: 'pickup', id, count: added });
    return added;
  }

  getItem(index) {
    if (!validIndex(index, SLOT_COUNT) || !validStack(this.slots[index])) return null;
    const stack = this.slots[index];
    return { item: ITEMS[stack.id], stack };
  }

  // Drops remove only the selected bag stack; equipment and ID-based hotbar
  // bindings are left intact so collecting the same item can restore a binding.
  remove(index, count = 1) {
    if (!validCount(count)) return null;
    const selected = this.getItem(index);
    if (!selected) return null;
    const removed = { id: selected.stack.id, count: Math.min(count, selected.stack.count), ...stackExtras(selected.stack) };
    selected.stack.count -= removed.count;
    if (!selected.stack.count) this.slots[index] = null;
    return removed;
  }

  move(from, to) {
    if (!validIndex(from, SLOT_COUNT) || !validIndex(to, SLOT_COUNT) || from === to) return false;
    const source = this.slots[from];
    const destination = this.slots[to];
    if (!validStack(source) || (destination !== null && !validStack(destination))) return false;
    if (destination?.id === source.id && sameExtras(source, destination)) {
      const amount = Math.min(source.count, ITEMS[source.id].stackLimit - destination.count);
      if (!amount) return false;
      destination.count += amount;
      source.count -= amount;
      if (!source.count) this.slots[from] = null;
    } else {
      this.slots[from] = destination;
      this.slots[to] = source;
    }
    return true;
  }

  equip(index) {
    const selected = this.getItem(index);
    const slot = selected?.item.equipmentSlot;
    if (!selected || !EQUIPMENT_SLOTS.includes(slot)) return false;
    const displaced = [slot];
    if (slot === 'mainHand' && selected.item.twoHanded) displaced.push('offHand');
    if (slot === 'offHand' && itemFor(this.equipment.mainHand?.id)?.twoHanded) displaced.push('mainHand');
    for (const previousSlot of displaced) {
      const previous = this.equipment[previousSlot];
      if (previous !== null && !validStack(previous)) return false;
    }

    const planned = this.slots.map((entry) => entry ? { ...entry } : null);
    planned[index].count--;
    if (!planned[index].count) planned[index] = null;
    for (const previousSlot of displaced) {
      const previous = this.equipment[previousSlot];
      if (!previous) continue;
      // Prefer the source slot for replaced gear. Any hand conflict can need
      // another slot, so finish planning both transfers before changing state.
      if (planned[index] === null) planned[index] = { ...previous };
      else if (putInSlots(planned, previous.id, previous.count, stackExtras(previous)) !== previous.count) return false;
    }

    this.slots.splice(0, SLOT_COUNT, ...planned);
    for (const previousSlot of displaced) this.equipment[previousSlot] = null;
    this.equipment[slot] = { id: selected.stack.id, count: 1, ...stackExtras(selected.stack) };
    return true;
  }

  unequip(slot) {
    if (!EQUIPMENT_SLOTS.includes(slot)) return false;
    const stack = this.equipment[slot];
    if (!validStack(stack)) return false;
    const planned = this.slots.map((entry) => entry ? { ...entry } : null);
    if (putInSlots(planned, stack.id, stack.count, stackExtras(stack)) !== stack.count) return false;
    this.slots.splice(0, SLOT_COUNT, ...planned);
    this.equipment[slot] = null;
    return true;
  }

  assignHotbar(index, id) {
    if (!validIndex(index, HOTBAR_COUNT)) return false;
    if (id !== null && (!itemFor(id) || !this.findCarried(id))) return false;
    this.hotbar[index] = id;
    return true;
  }

  selectHotbar(index) {
    if (!validIndex(index, HOTBAR_COUNT)) return false;
    this.selectedHotbar = index;
    return true;
  }

  cycleHotbar(delta) {
    if (!Number.isSafeInteger(delta)) return false;
    this.selectedHotbar = (this.selectedHotbar + delta % HOTBAR_COUNT + HOTBAR_COUNT) % HOTBAR_COUNT;
    return true;
  }

  findCarried(id) {
    for (const slot of EQUIPMENT_SLOTS) {
      const stack = this.equipment[slot];
      if (validStack(stack) && stack.id === id) return { stack, source: 'equipment', slot };
    }
    const index = this.slots.findIndex((stack) => validStack(stack) && stack.id === id);
    return index < 0 ? null : { stack: this.slots[index], source: 'inventory', index };
  }

  getHotbar(index = this.selectedHotbar) {
    if (!validIndex(index, HOTBAR_COUNT)) return null;
    const id = this.hotbar[index];
    const item = itemFor(id);
    const carried = item && this.findCarried(id);
    if (!carried) return null;
    let count = 0;
    for (const stack of [...this.slots, ...Object.values(this.equipment)]) {
      if (validStack(stack) && stack.id === id) count += stack.count;
    }
    return { item, count, ...carried, equipped: carried.source === 'equipment' };
  }

  useItem(index, vitals) {
    const selected = this.getItem(index);
    const effect = selected?.item.use;
    if (!effect) return false;
    const health = restore(vitals, 'health', effect.health);
    const stamina = restore(vitals, 'stamina', effect.stamina);
    if (health <= 0 && stamina <= 0) return false;
    selected.stack.count--;
    if (!selected.stack.count) this.slots[index] = null;
    return true;
  }

  useSelected(vitals) {
    const selected = this.getHotbar();
    return selected?.source === 'inventory' ? this.useItem(selected.index, vitals) : false;
  }
}

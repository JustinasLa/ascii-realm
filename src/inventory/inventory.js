import { readForged } from '../crafting/forged.js';
import { isMaterialId } from '../entities/weapons.js';
import { EQUIPMENT_SLOTS, ITEMS, STACK_SLOTS, fitsSlot, slotsFor } from './items.js';

const SLOT_COUNT = 24;
export const BAG_SLOTS = SLOT_COUNT;
const WEIGHT_EPSILON = 1e-9;

const itemFor = (id) => typeof id === 'string' && Object.hasOwn(ITEMS, id) ? ITEMS[id] : null;
const validIndex = (index, length) => Number.isInteger(index) && index >= 0 && index < length;
const validCount = (count) => Number.isSafeInteger(count) && count > 0;

function validStack(stack) {
  const item = itemFor(stack?.id);
  return !!item && validCount(stack.count) && stack.count <= item.stackLimit;
}

// A stack's own properties beyond its item and count: a weapon's material, an
// alloy ingot's alloy id, the inputs a scrap's failed mix consumed, or a
// smithed weapon's forging. Only stacks with the same properties merge.
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
  if (isMaterialId(stack?.material)) extras.material = stack.material;
  if (typeof stack?.alloy === 'string' && ALLOY_ID.test(stack.alloy)) extras.alloy = stack.alloy;
  const inputs = inputsOf(stack?.inputs);
  if (inputs) extras.inputs = inputs;
  const forged = readForged(stack?.forged);
  if (forged) extras.forged = forged;
  return extras;
}
// A stored stack as the bag holds it, or null when its item is unknown or its
// count isn't a whole number above zero. A count over the item's limit is cut
// to the limit and the stack marked `clamped`.
export function cleanStack(raw) {
  const item = itemFor(raw?.id);
  if (!item || !validCount(raw.count)) return null;
  const stack = { id: raw.id, count: Math.min(raw.count, item.stackLimit), ...stackExtras(raw) };
  return validStack(raw) ? stack : { ...stack, clamped: true };
}
// A stored stack as the bag holds it, without the clamp mark, or null.
function unmarked(raw) {
  const stack = raw ? cleanStack(raw) : null;
  if (stack) delete stack.clamped;
  return stack;
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

// Two worn slots trade what they hold when each piece fits the other's slot
// (ring ↔ ring). `def` looks an item up, so tests can pass ring definitions.
export function canSwap(equipment, a, b, def = itemFor) {
  if (a === b || !EQUIPMENT_SLOTS.includes(a) || !EQUIPMENT_SLOTS.includes(b) || !(equipment[a] || equipment[b])) return false;
  const fits = (stack, slot) => {
    const item = stack && def(stack.id);
    return !stack || !!item && validCount(stack.count) && stack.count <= item.stackLimit && fitsSlot(item, slot);
  };
  return fits(equipment[a], b) && fits(equipment[b], a);
}

export class Inventory {
  constructor({ starter = true, capacity = 60 } = {}) {
    this.slots = Array(SLOT_COUNT).fill(null);
    this.equipment = Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
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
    let space = this.quiverRoom(id, properties);
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
    const properties = stackExtras(extras);
    const topUp = Math.min(amount, this.quiverRoom(id, properties));
    if (topUp) this.equipment.quiver.count += topUp;
    const added = topUp + putInSlots(this.slots, id, amount - topUp, properties);
    if (added) this.events.push({ type: 'pickup', id, count: added });
    return added;
  }

  // Room in the quiver for more of the same arrows: pickups top it up first,
  // but never fill an empty quiver.
  quiverRoom(id, extras) {
    const quiver = this.equipment.quiver;
    return validStack(quiver) && quiver.id === id && sameExtras(quiver, extras) ? ITEMS[id].stackLimit - quiver.count : 0;
  }

  getItem(index) {
    if (!validIndex(index, SLOT_COUNT) || !validStack(this.slots[index])) return null;
    const stack = this.slots[index];
    return { item: ITEMS[stack.id], stack };
  }

  // Drops remove only the selected bag stack; equipment is left intact.
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

  // Where an item definition is equipped: `wanted` if it fits, else the first
  // free slot of its kind, else its first (a ring: left, right, then left).
  targetSlot(item, wanted) {
    const slots = slotsFor(item);
    if (wanted !== undefined) return slots.includes(wanted) ? wanted : null;
    return slots.find((slot) => !this.equipment[slot]) ?? slots[0] ?? null;
  }

  targetSlotFor(id, wanted) { return this.targetSlot(itemFor(id), wanted); }

  equip(index, wanted) {
    const selected = this.getItem(index);
    const slot = selected && this.targetSlot(selected.item, wanted);
    if (!slot) return false;
    if (STACK_SLOTS.includes(slot)) return this.fillStackSlot(index, slot);
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

  canSwapEquipped(a, b, def) { return canSwap(this.equipment, a, b, def); }

  swapEquipped(a, b, def) {
    if (!this.canSwapEquipped(a, b, def)) return false;
    [this.equipment[a], this.equipment[b]] = [this.equipment[b], this.equipment[a]];
    return true;
  }

  // A stack slot takes the whole bag stack: merged into the same stack up to
  // its limit, the rest left in the bag, or swapped with anything else.
  fillStackSlot(index, slot) {
    const stack = this.slots[index];
    const held = this.equipment[slot];
    if (held?.id !== stack.id || !sameExtras(held, stack)) {
      [this.slots[index], this.equipment[slot]] = [held, stack];
      return true;
    }
    const amount = Math.min(stack.count, ITEMS[stack.id].stackLimit - held.count);
    held.count += amount;
    stack.count -= amount;
    if (!stack.count) this.slots[index] = null;
    return amount > 0;
  }

  // Plain copies of the bag and worn gear, for a save: later play can't
  // change them.
  serialize() {
    const worn = EQUIPMENT_SLOTS.map((slot) => [slot, unmarked(this.equipment[slot])]);
    return { bag: this.slots.map(unmarked), worn: Object.fromEntries(worn) };
  }

  // Puts a saved bag and worn gear back, changing `slots` and `equipment` in
  // place so whatever holds them sees the change: `{ dropped }`, the items
  // that found no room. Bag stacks keep their places and stacks past the bag
  // find room as pickups do. Gear that no longer fits its slot is worn in
  // another free one or goes in the bag, and a two-handed weapon sends the
  // off hand there. The load may be over capacity; it makes no pickup sounds.
  restore({ bag, worn } = {}) {
    this.slots.fill(null);
    for (const slot of EQUIPMENT_SLOTS) this.equipment[slot] = null;
    const loose = [];
    (Array.isArray(bag) ? bag : []).forEach((raw, index) => {
      const stack = unmarked(raw);
      if (stack && index < SLOT_COUNT) this.slots[index] = stack;
      else if (stack) loose.push(stack);
    });
    for (const [wanted, raw] of Object.entries(worn ?? {})) {
      const stack = unmarked(raw);
      const item = stack && ITEMS[stack.id];
      const slot = item && (fitsSlot(item, wanted) && !this.equipment[wanted] ? wanted : this.targetSlot(item));
      if (!slot || this.equipment[slot]) {
        if (stack) loose.push(stack);
      } else if (STACK_SLOTS.includes(slot) || stack.count === 1) this.equipment[slot] = stack;
      else {
        this.equipment[slot] = { ...stack, count: 1 };
        loose.push({ ...stack, count: stack.count - 1 });
      }
    }
    if (itemFor(this.equipment.mainHand?.id)?.twoHanded && this.equipment.offHand) {
      loose.push(this.equipment.offHand);
      this.equipment.offHand = null;
    }
    let dropped = 0;
    for (const { id, count, ...extras } of loose) dropped += count - putInSlots(this.slots, id, count, extras);
    this.events.length = 0;
    return { dropped };
  }

  // Everything of an item carried, in the bag and worn.
  countOf(id) {
    return [...this.slots, ...Object.values(this.equipment)]
      .reduce((count, stack) => count + (validStack(stack) && stack.id === id ? stack.count : 0), 0);
  }

  // The stack the next shot draws from: the quiver first, then the first bag
  // stack. The quiver is never refilled on its own.
  nextAmmo(id) {
    const quiver = this.equipment.quiver;
    if (validStack(quiver) && quiver.id === id) return quiver;
    return this.slots.find((stack) => validStack(stack) && stack.id === id) ?? null;
  }

  // Takes one round for a shot, with its own properties, or null.
  takeAmmo(id) {
    const stack = this.nextAmmo(id);
    if (!stack || stack !== this.equipment.quiver) return stack && this.remove(this.slots.indexOf(stack), 1);
    if (!--stack.count) this.equipment.quiver = null;
    return { id, count: 1, ...stackExtras(stack) };
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
}

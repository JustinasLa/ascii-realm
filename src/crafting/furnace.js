import { stackExtras } from '../inventory/inventory.js';
import { ITEMS } from '../inventory/items.js';
import { ASPECT } from '../world/world.js';

// The furnace follows the classic rules: one item smelts in 10 s, and a fuel
// item is lit only when the burn has run out and the input can smelt into
// the output. A burn already started keeps ticking down regardless.
export const COOK_TIME = 10;
export const SMELTING = Object.freeze({ rawIron: 'ironIngot', rawCopper: 'copperIngot' });
// Seconds of burn per fuel item: coal smelts eight items, a log one and a half.
export const FUEL = Object.freeze({ coal: 80, oakLog: 15 });
// Kept per world seed as `ascii-realm-furnaces-<seed>`.
export const FURNACE_KEY = 'ascii-realm-furnaces';
export const SLOTS = Object.freeze(['input', 'fuel', 'output']);
const VERSION = 1;
const MAX_FURNACES = 32;
const SAVE_EVERY = 2;
const MAX_ID = 64;
const EPS = 1e-6;

const SLOT_NAMES = { input: 'The input', fuel: 'The fuel slot', output: 'The output' };
const OUTPUTS = new Set(Object.values(SMELTING));
const BURNS = new Set([0, ...Object.values(FUEL)]);
const result = (status, message, details = {}) => ({ ok: false, status, message, ...details });
const named = (id, count) => `${ITEMS[id].name}${count > 1 ? ` x${count}` : ''}`;
const round = (value) => Math.round(value * 1000) / 1000;
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID;
const between = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const plain = (stack) => !Object.keys(stackExtras(stack)).length;
// Why a bag stack can't go in: ores and gems don't smelt, nothing else
// belongs, nor does a stack with its own properties.
const refusal = (item, stack) => (plain(stack) && (item.tags.includes('ore') || item.tags.includes('gem'))
  ? 'Does not smelt' : 'Not for the furnace');
// Where a bag stack goes: the input if it smelts, else the fuel slot if it burns.
function slotFor(furnace, stack) {
  if (!plain(stack)) return null;
  return furnace.accepts('input', stack.id) ? 'input' : furnace.accepts('fuel', stack.id) ? 'fuel' : null;
}

function stackOf(data, allowed) {
  if (data === null) return null;
  const { id, count } = data ?? {};
  return allowed(id) && Number.isSafeInteger(count) && count >= 1 && count <= ITEMS[id].stackLimit
    ? { id, count } : undefined;
}

export class Furnace {
  constructor() {
    this.input = null;
    this.fuel = null;
    this.output = null;
    this.burn = 0;
    this.burnTotal = 0;
    this.cook = 0;
  }

  result() {
    return SMELTING[this.input?.id] ?? null;
  }

  canSmelt() {
    const made = this.result();
    return !!made && (!this.output || (this.output.id === made && this.output.count < ITEMS[made].stackLimit));
  }

  get lit() {
    return this.burn > EPS;
  }

  get idle() {
    return !this.input && !this.fuel && !this.output && !this.lit && this.cook <= EPS;
  }

  // Exact for any step, so the outcome never depends on the frame rate.
  // Returns whether any slot's contents changed.
  advance(dt) {
    let left = Number.isFinite(dt) && dt > 0 ? dt : 0;
    let changed = false;
    for (let guard = 0; left > EPS && guard < 400; guard++) {
      const can = this.canSmelt();
      if (!this.lit) {
        if (can && this.fuel) {
          this.burn = this.burnTotal = FUEL[this.fuel.id];
          if (!--this.fuel.count) this.fuel = null;
          changed = true;
          continue;
        }
        // Unlit, progress falls back twice as fast as it was made.
        this.cook = Math.max(0, this.cook - 2 * left);
        break;
      }
      let step;
      if (!can) {
        this.cook = 0;
        step = Math.min(left, this.burn);
      } else {
        step = Math.min(left, this.burn, COOK_TIME - this.cook);
        this.cook += step;
      }
      this.burn -= step;
      left -= step;
      if (can && this.cook >= COOK_TIME - EPS) {
        const made = this.result();
        if (!--this.input.count) this.input = null;
        if (this.output) this.output.count++;
        else this.output = { id: made, count: 1 };
        this.cook = 0;
        changed = true;
      }
    }
    if (this.burn <= EPS) this.burn = 0;
    return changed;
  }

  accepts(slot, id) {
    return slot === 'input' ? Object.hasOwn(SMELTING, id) : slot === 'fuel' && Object.hasOwn(FUEL, id);
  }

  room(slot, id) {
    if (!this.accepts(slot, id)) return 0;
    const current = this[slot];
    if (!current) return ITEMS[id].stackLimit;
    return current.id === id ? ITEMS[id].stackLimit - current.count : 0;
  }

  // Takes as much of `stack` as fits and returns how many it took.
  put(slot, stack) {
    const taken = Math.min(this.room(slot, stack.id), stack.count);
    if (!taken) return 0;
    if (this[slot]) this[slot].count += taken;
    else {
      // A new input item starts its smelting from nothing.
      if (slot === 'input') this.cook = 0;
      this[slot] = { id: stack.id, count: taken };
    }
    return taken;
  }

  take(slot, count) {
    const current = this[slot];
    if (!SLOTS.includes(slot) || !current) return null;
    const taken = Math.min(count, current.count);
    current.count -= taken;
    if (!current.count) this[slot] = null;
    return { id: current.id, count: taken };
  }

  toJSON() {
    const copy = (stack) => stack && { id: stack.id, count: stack.count };
    return {
      input: copy(this.input), fuel: copy(this.fuel), output: copy(this.output),
      burn: round(this.burn), burnTotal: this.burnTotal, cook: round(this.cook),
    };
  }

  // A saved state, or null when any field is out of bounds.
  static from(data) {
    if (!data || typeof data !== 'object') return null;
    const input = stackOf(data.input, (id) => Object.hasOwn(SMELTING, id));
    const fuel = stackOf(data.fuel, (id) => Object.hasOwn(FUEL, id));
    const output = stackOf(data.output, (id) => OUTPUTS.has(id));
    const { burn, burnTotal, cook } = data;
    if (input === undefined || fuel === undefined || output === undefined || !BURNS.has(burnTotal)
      || !between(burn, 0, burnTotal) || !between(cook, 0, COOK_TIME)) return null;
    return Object.assign(new Furnace(), { input, fuel, output, burn, burnTotal, cook });
  }
}

// Sends the whole bag stack at `index` in, to the input if it smelts or
// else as fuel, as far as that slot has room. A refusal changes nothing.
export function load(furnace, inventory, index) {
  const selected = inventory.getItem(index);
  if (!selected) return result('invalid', 'Select something in your bag.');
  const { item, stack } = selected;
  const slot = slotFor(furnace, stack);
  if (!slot) {
    const ore = refusal(item, stack) === 'Does not smelt';
    return result('refused', `${item.name} ${ore ? 'does not smelt' : "can't go in the furnace"}.`, { id: item.id });
  }
  const room = furnace.room(slot, item.id);
  if (!room) {
    const held = furnace[slot];
    return held.id === item.id
      ? result('full', `${SLOT_NAMES[slot]} is full.`, { id: item.id })
      : result('occupied', `${SLOT_NAMES[slot]} holds ${ITEMS[held.id].name}.`, { id: item.id });
  }
  const original = { ...stack };
  const removed = inventory.remove(index, room);
  const count = Math.min(room, original.count);
  if (!removed || removed.id !== original.id || removed.count !== count) {
    inventory.slots[index] = original;
    return result('invalid', 'That could not be moved.', { id: item.id });
  }
  furnace.put(slot, removed);
  const message = slot === 'input' ? `Put ${named(item.id, count)} in the furnace.` : `Added ${named(item.id, count)} as fuel.`;
  return result('loaded', message, { ok: true, id: item.id, count, slot });
}

// Takes a slot's contents back into the bag, as much as fits.
export function unload(furnace, slot, inventory) {
  const held = furnace[slot];
  if (!SLOTS.includes(slot) || !held) return result('empty', 'Nothing to take.');
  const added = inventory.add(held.id, held.count);
  if (!added) return result('full', 'Your bag is full.', { id: held.id });
  const rest = held.count - added;
  furnace.take(slot, added);
  const message = `Took ${named(held.id, added)}.${rest ? ' Your bag has no room for the rest.' : ''}`;
  return result('took', message, { ok: true, id: held.id, count: added, remaining: rest });
}

// What the furnace screen shows: slots, gauges, a status line and the bag's
// resources with where each would go.
export function furnaceScreenModel(furnace, inventory) {
  const slot = (stack) => stack && { id: stack.id, name: ITEMS[stack.id].name, count: stack.count };
  const flame = furnace.burnTotal ? furnace.burn / furnace.burnTotal : 0;
  const arrow = furnace.cook / COOK_TIME;
  const output = furnace.output;
  let detail;
  if (!furnace.result()) detail = 'nothing to smelt';
  else if (!furnace.canSmelt()) {
    detail = output.id === furnace.result() ? 'output full' : `output holds ${ITEMS[output.id].name}`;
  } else if (furnace.lit) detail = `smelting ${ITEMS[furnace.input.id].name}, ${Math.floor(arrow * 100)}%`;
  else detail = furnace.fuel ? 'lighting the fuel' : 'out of fuel';
  const status = furnace.lit
    ? `Burning, ${Math.ceil(furnace.burn)} s of fuel left · ${detail}`
    : detail[0].toUpperCase() + detail.slice(1);
  const bag = [];
  inventory.slots.forEach((stack, index) => {
    const item = inventory.getItem(index)?.item;
    if (!item?.tags.includes('resource')) return;
    const target = slotFor(furnace, stack);
    bag.push({
      index, id: item.id, name: item.name, count: stack.count, target, reason: target ? null : refusal(item, stack),
    });
  });
  return {
    input: slot(furnace.input), fuel: slot(furnace.fuel), output: slot(output),
    flame, arrow, lit: furnace.lit, status, bag,
  };
}

// How far from a furnace's footprint it can be used, in row units.
export const FURNACE_REACH = 3.5;

// The nearest furnace in reach of a player on the ground, measured from its
// footprint so this wide prop can be used from any side; null if none.
export function nearbyFurnace(world, player) {
  if (player.air > 0.3 || player.vitals?.health <= 0) return null;
  let best = null, bestGap = Infinity;
  // Search as far as the widest footprint in the world reaches, so a scaled
  // builder furnace in the next chunk is still found.
  const reachX = Math.max(world.propFootW ?? 0, 10) + FURNACE_REACH / ASPECT;
  const reachY = Math.max(world.propFootH ?? 0, 2) + FURNACE_REACH;
  for (const prop of world.propsIn(player.x - reachX, player.y - reachY, player.x + reachX, player.y + reachY)) {
    if (prop.kind !== 'furnace') continue;
    const gap = Math.hypot(Math.max(0, Math.abs(player.x - prop.x) - prop.footW) * ASPECT,
      Math.max(0, Math.abs(player.y - prop.y) - prop.footH));
    if (gap <= FURNACE_REACH && gap < bestGap) [best, bestGap] = [prop, gap];
  }
  return best;
}

// Every furnace's state in one world, kept by prop id. All of them work on
// game time, with the screen shut and the player far away.
export class Furnaces {
  constructor({ storage, seed } = {}) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
    }
    this.storage = storage;
    this.key = `${FURNACE_KEY}-${seed}`;
    this.states = new Map();
    this.sinceSave = 0;
    this.load();
  }

  // The furnace with this prop id, made empty on first use. At the cap the
  // oldest idle one makes way; when all are busy this one can't be used.
  get(id) {
    if (!validId(id)) throw new TypeError('A furnace id is a string of 1 to 64 characters.');
    if (this.states.has(id)) return this.states.get(id);
    if (this.states.size >= MAX_FURNACES) {
      const idle = [...this.states].find(([, furnace]) => furnace.idle);
      if (!idle) return null;
      this.states.delete(idle[0]);
    }
    const furnace = new Furnace();
    this.states.set(id, furnace);
    return furnace;
  }

  lit(id) {
    return !!this.states.get(id)?.lit;
  }

  update(dt) {
    let changed = false;
    let busy = false;
    for (const furnace of this.states.values()) {
      if (furnace.advance(dt)) changed = true;
      if (furnace.lit || furnace.cook > 0) busy = true;
    }
    this.sinceSave += Number.isFinite(dt) && dt > 0 ? dt : 0;
    // Contents are saved at once; gauges every few seconds while they move.
    if (changed || (busy && this.sinceSave >= SAVE_EVERY)) this.save();
  }

  // Bag moves through the store save at once, so a reload never loses them.
  putIn(id, inventory, index) {
    return this.saved(id, (furnace) => load(furnace, inventory, index));
  }

  takeOut(id, slot, inventory) {
    return this.saved(id, (furnace) => unload(furnace, slot, inventory));
  }

  saved(id, move) {
    const furnace = this.get(id);
    if (!furnace) return result('busy', "This furnace can't be used: too many furnaces are busy.");
    const done = move(furnace);
    if (done.ok) this.save();
    return done;
  }

  toJSON() {
    const furnaces = {};
    for (const [id, furnace] of this.states) if (!furnace.idle) furnaces[id] = furnace.toJSON();
    return { v: VERSION, furnaces };
  }

  save() {
    this.sinceSave = 0;
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.toJSON()));
    } catch {
      // Full or disabled storage keeps the furnaces for this visit.
    }
  }

  // A bad entry is dropped and the rest load; a bad file loads nothing.
  load() {
    let saved;
    try {
      saved = JSON.parse(this.storage?.getItem(this.key) ?? 'null');
    } catch {
      return;
    }
    if (saved?.v !== VERSION || !saved.furnaces || typeof saved.furnaces !== 'object') return;
    for (const [id, data] of Object.entries(saved.furnaces).slice(0, MAX_FURNACES)) {
      const furnace = validId(id) ? Furnace.from(data) : null;
      if (furnace) this.states.set(id, furnace);
    }
  }
}

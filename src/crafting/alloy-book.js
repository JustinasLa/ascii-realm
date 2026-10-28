import { stackExtras } from '../inventory/inventory.js';
import { ITEMS } from '../inventory/items.js';
import {
  AlloyForge, FIRE_GLOW, NAMING_TIME, listNames, mixOf, nameKey, recipeKey, statLines,
} from './alloys.js';
import { HIT_KINDS, INGREDIENTS, PALETTE, STAT_NAMES } from './ingredients.js';
import { Smithy } from './smithing.js';

// The alloy book (every mix fired so far, as its alloy or as scrap), each
// alloy forge's loaded contents and each weapon station's piece, kept per
// world seed as `ascii-realm-alloys-<seed>`.
export const ALLOY_KEY = 'ascii-realm-alloys';
const VERSION = 1;
const MAX_ALLOYS = 256;
const MAX_SCRAP = 1024;
// Forges and weapon stations together.
const MAX_STATIONS = 32;
const MAX_NAME = 24;
const MAX_ID = 64;
const LAST_ALLOY = 9999;
// Seconds of game time a deferred change (a hit) may wait before it is saved.
const SAVE_EVERY = 2;
const ALLOY_ID = /^a[1-9]\d{0,3}$/;
const NAME = /^[A-Za-z]+( [A-Za-z]+)*$/;

const result = (status, message, details = {}) => ({ ok: false, status, message, ...details });
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID;
const between = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
// A plain object whose keys are all in `table` and whose values all pass `check`.
const entriesOk = (value, table, check) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.entries(value).every(([key, amount]) => Object.hasOwn(table, key) && check(amount));
const sorted = (ids) => ids.every((id, index) => !index || ids[index - 1] < id);

export class AlloyBook {
  constructor({ storage, seed } = {}) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
    }
    this.storage = storage;
    this.key = `${ALLOY_KEY}-${seed}`;
    this.alloys = new Map();
    this.recipes = new Map();
    this.forges = new Map();
    this.benches = new Map();
    this.glows = new Map();
    this.next = 1;
    this.naming = null;
    this.time = 0;
    this.dirty = false;
    this.sinceSave = 0;
    // Goes up whenever an alloy is added or renamed, for screens that list them.
    this.version = 0;
    this.load();
  }

  get(id) {
    return this.alloys.get(id) ?? null;
  }

  // A recipe key's alloy, 'scrap', or null while nobody has fired it.
  result(key) {
    const known = this.recipes.get(key);
    return known === undefined ? null : known === 'scrap' ? 'scrap' : this.get(known);
  }

  // Whether another alloy than `except` has this name, whatever its case.
  taken(name, except = null) {
    return [...this.alloys.values()].some((alloy) => alloy.id !== except && nameKey(alloy.name) === nameKey(name));
  }

  // Keeps what forging a new mix gave and returns the new alloy, or null for
  // scrap. A failed roll makes the mix scrap for good; no free name leaves it unknown.
  record(key, plan) {
    if (plan.kind === 'scrap') {
      if (plan.keep) this.recipes.set(key, 'scrap');
      return null;
    }
    const alloy = { id: `a${this.next++}`, ...plan.alloy };
    this.alloys.set(alloy.id, alloy);
    this.recipes.set(key, alloy.id);
    this.naming = { id: alloy.id, until: this.time + NAMING_TIME };
    this.version++;
    return alloy;
  }

  // Why the naming window can't take a name now, or null.
  #closed() {
    if (!this.naming) return result('none', 'You have no alloy to name.');
    if (this.time <= this.naming.until) return null;
    this.naming = null;
    return result('timeout', 'Naming timed out.');
  }

  // Letters and underscores, shown as spaces; unused by any other alloy in any case.
  rename(text) {
    const closed = this.#closed();
    if (closed) return closed;
    const name = typeof text === 'string' && /^[A-Za-z_]+$/.test(text) ? text.replace(/_+/g, ' ').trim() : '';
    if (!name) return result('invalid', 'Name can only contain letters (A–Z) and underscores (_).');
    if (text.length > MAX_NAME) return result('long', 'That name is too long.');
    if (this.taken(name, this.naming.id)) return result('taken', 'An alloy with that name already exists.');
    this.get(this.naming.id).name = name;
    this.naming = null;
    this.version++;
    this.save();
    return result('named', `Named the new alloy ${name}.`, { ok: true, name });
  }

  keepName() {
    const closed = this.#closed();
    if (closed) return closed;
    const { name } = this.get(this.naming.id);
    this.naming = null;
    return result('kept', `Kept the name ${name}.`, { ok: true, name });
  }

  // The forge with this prop id, made empty on first use.
  forge(id) {
    return this.#station(this.forges, id, () => new AlloyForge());
  }

  // The weapon station with this prop id, made empty on first use.
  bench(id) {
    return this.#station(this.benches, id, () => new Smithy());
  }

  // Forges and weapon stations share one cap. At the cap the oldest idle one
  // of the same kind makes way, then of the other; when all are busy this one
  // can't be used.
  #station(map, id, make) {
    if (!validId(id)) throw new TypeError('A station id is a string of 1 to 64 characters.');
    if (map.has(id)) return map.get(id);
    if (this.forges.size + this.benches.size >= MAX_STATIONS) {
      const other = map === this.forges ? this.benches : this.forges;
      const idle = (stations) => [...stations].find(([, station]) => station.idle);
      const from = [map, other].find(idle);
      if (!from) return null;
      from.delete(idle(from)[0]);
    }
    const station = make();
    map.set(id, station);
    return station;
  }

  // Game time runs the naming window and the hearth glows. Returns the
  // timeout result when the naming window runs out in this step.
  update(dt) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.time += step;
    this.sinceSave += step;
    if (this.dirty && this.sinceSave >= SAVE_EVERY) this.save();
    for (const [id, until] of this.glows) if (this.time >= until) this.glows.delete(id);
    return this.naming && this.time > this.naming.until ? this.#closed() : null;
  }

  glow(id) {
    this.glows.set(id, this.time + FIRE_GLOW);
  }

  lit(id) {
    return this.glows.get(id) > this.time;
  }

  // Runs a move on one forge and saves at once when it worked.
  saved(id, move) {
    return this.#saved(this.forge(id), "This alloy forge can't be used: too many stations are busy.", move);
  }

  // Runs a move on one weapon station and saves at once when it worked, or
  // with `later` (hits, which come quickly) within SAVE_EVERY of game time.
  savedBench(id, move, { later = false } = {}) {
    return this.#saved(this.bench(id), "This weapon station can't be used: too many stations are busy.", move, later);
  }

  #saved(station, busy, move, later = false) {
    if (!station) return result('busy', busy);
    const done = move(station);
    if (done.ok && later) this.dirty = true;
    else if (done.ok) this.save();
    return done;
  }

  // Saves a deferred change now, as the page goes away.
  flush() {
    if (this.dirty) this.save();
  }

  // The naming window and the glows last only for this visit.
  toJSON() {
    const forges = {};
    const benches = {};
    for (const [id, forge] of this.forges) if (!forge.idle) forges[id] = forge.toJSON();
    for (const [id, bench] of this.benches) if (!bench.idle) benches[id] = bench.toJSON();
    return {
      v: VERSION,
      next: this.next,
      alloys: [...this.alloys.values()].map((alloy) => ({ ...alloy, catalysts: [...alloy.catalysts] })),
      scrap: [...this.recipes].filter(([, known]) => known === 'scrap').map(([key]) => key),
      forges,
      benches,
    };
  }

  save() {
    this.dirty = false;
    this.sinceSave = 0;
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.toJSON()));
    } catch {
      // Full or disabled storage keeps the book for this visit.
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
    if (saved?.v !== VERSION) return;
    for (const data of Array.isArray(saved.alloys) ? saved.alloys.slice(0, MAX_ALLOYS) : []) {
      const alloy = this.#alloyFrom(data);
      if (!alloy) continue;
      this.alloys.set(alloy.id, alloy);
      this.recipes.set(recipeKey(alloy.base, alloy.catalysts), alloy.id);
    }
    for (const key of Array.isArray(saved.scrap) ? saved.scrap.slice(0, MAX_SCRAP) : []) {
      if (this.#freeMix(key)) this.recipes.set(key, 'scrap');
    }
    const top = Math.max(0, ...[...this.alloys.keys()].map((id) => Number(id.slice(1))));
    this.next = Number.isSafeInteger(saved.next) && saved.next > top && saved.next <= LAST_ALLOY ? saved.next : top + 1;
    const forges = saved.forges && typeof saved.forges === 'object' ? Object.entries(saved.forges) : [];
    for (const [id, data] of forges.slice(0, MAX_STATIONS)) {
      const forge = validId(id) ? AlloyForge.from(data, this) : null;
      if (forge) this.forges.set(id, forge);
    }
    const benches = saved.benches && typeof saved.benches === 'object' ? Object.entries(saved.benches) : [];
    for (const [id, data] of benches.slice(0, MAX_STATIONS - this.forges.size)) {
      const bench = validId(id) ? Smithy.from(data, this) : null;
      if (bench) this.benches.set(id, bench);
    }
  }

  // Whether `key` names a mix the forge would take, written in its one form, and not yet in the book.
  #freeMix(key) {
    if (typeof key !== 'string' || key.split('|').length !== 2) return false;
    const [base, rest] = key.split('|');
    const catalysts = rest.split(',');
    return !!mixOf(base, catalysts) && recipeKey(base, catalysts) === key && !this.recipes.has(key);
  }

  #alloyFrom(data) {
    if (!data || typeof data !== 'object') return null;
    const { id, name, colour, base, catalysts, type, tier, stats, hits, xp } = data;
    const valid = typeof id === 'string' && ALLOY_ID.test(id) && !this.alloys.has(id)
      && typeof name === 'string' && name.length <= MAX_NAME && NAME.test(name) && !this.taken(name)
      && PALETTE.includes(colour)
      && Array.isArray(catalysts) && catalysts.length > 0 && this.#freeMix(recipeKey(base, catalysts))
      && sorted(catalysts)
      && type === INGREDIENTS[base].type && tier === INGREDIENTS[base].tier
      && entriesOk(stats, STAT_NAMES, (amount) => between(amount, -1e6, 1e6))
      && entriesOk(hits, HIT_KINDS, (count) => Number.isInteger(count) && count >= 1 && count <= 3)
      && (xp === null || between(xp, 0, 1e6));
    return valid
      ? { id, name, colour, base, catalysts: [...catalysts], type, tier, stats: { ...stats }, hits: { ...hits }, xp }
      : null;
  }
}

// What the bag shows for an alloy ingot or a scrap with its inputs, or null
// for anything else, which shows its item's own text.
export function describeStack(stack, book) {
  const { alloy: id, inputs } = stackExtras(stack);
  if (stack?.id === 'alloyIngot') {
    const alloy = book.get(id);
    if (!alloy) return { name: 'Unknown alloy', colour: null, description: ITEMS.alloyIngot.description, stats: null };
    const from = listNames([alloy.base, ...alloy.catalysts].map((ingredient) => ITEMS[ingredient].name));
    return {
      name: alloy.name,
      colour: `#${alloy.colour}`,
      description: `An ingot of ${alloy.name}, forged from ${from}.`,
      stats: { ...Object.fromEntries(statLines(alloy)), Tier: String(alloy.tier) },
    };
  }
  if (stack?.id !== 'unusableScrap' || !inputs) return null;
  const from = listNames(Object.entries(inputs).map(([input, n]) => `${ITEMS[input].name}${n > 1 ? ` x${n}` : ''}`));
  const description = `What is left of a failed alloy of ${from}.`;
  return { name: ITEMS.unusableScrap.name, colour: null, description, stats: null };
}

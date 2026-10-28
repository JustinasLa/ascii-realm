import { stackExtras } from '../inventory/inventory.js';
import { ITEMS } from '../inventory/items.js';
import {
  ALLOY_NAMES, BASE_BONUS, COMBINATIONS, INGREDIENTS, MAX_CATALYSTS, MAX_FACTOR, ODDS, PALETTE, STAT_NAMES,
  TYPE_NAMES,
} from './ingredients.js';

// Forging a new alloy at the alloy forge. Every draw goes through one `random`,
// in a fixed order: the discovery roll, the stat merge, the hits, the name, the
// XP and the colour, so a scripted source pins each outcome.

const round2 = (value) => Math.round(value * 100) / 100;
const has = (object, key) => Object.hasOwn(object, key);
// One upper-bound index, rounded, so the two end entries come up half as often.
const pick = (list, random) => Math.round(random() * (list.length - 1));

// Names are unique whatever their case, with spaces read as underscores.
export const nameKey = (name) => name.toLowerCase().replace(/ /g, '_');

// The base, then the catalysts in id order: the same mix in any loading order.
export const recipeKey = (base, catalysts) => `${base}|${[...catalysts].sort().join(',')}`;

export const totalValue = (base, catalysts, table = INGREDIENTS) =>
  [base, ...catalysts].reduce((value, id) => value + table[id].value, 0);

// The % chance that a new mix makes an alloy rather than scrap.
export function discoveryChance(base, catalysts, table = INGREDIENTS) {
  const bonus = has(BASE_BONUS, base) ? BASE_BONUS[base] : 0;
  return Math.min(ODDS.max, ODDS.base + ODDS.perRootValue * Math.sqrt(totalValue(base, catalysts, table)) + bonus);
}

// What a failed mix consumed, as { id: count } in id order.
export function scrapInputs(base, catalysts) {
  const inputs = {};
  for (const id of [base, ...catalysts].sort()) inputs[id] = (inputs[id] ?? 0) + 1;
  return inputs;
}

// Moves the base's stats toward the catalysts'. A catalyst stat the base has
// merges as the difference; one it lacks joins at (20 + 3·value)% and caps at
// MAX_FACTOR times itself. Losses are often softened or turned into gains.
function mergeStats(base, catalysts, value, random) {
  const start = INGREDIENTS[base].stats;
  const stats = { ...start };
  const max = Object.fromEntries(Object.entries(start).map(([stat, amount]) => [stat, amount * MAX_FACTOR]));
  const merge = [];
  for (const id of catalysts) {
    for (const [stat, amount] of Object.entries(INGREDIENTS[id].stats)) {
      if (has(start, stat)) merge.push([stat, amount - start[stat]]);
      else if (random() * 100 < 20 + 3 * INGREDIENTS[id].value) {
        merge.push([stat, amount]);
        max[stat] = amount * MAX_FACTOR;
      }
    }
  }
  const randomize = (change) => {
    let d = change;
    if (d < 0 && Math.floor(random() * 100) + value > 65) d = -d / 2;
    const multiplier = d > 0
      ? (Math.floor(random() * 100) + 10 + 2 * value) / 100
      : (Math.floor(random() * 100) - 2 * value) / 100;
    return round2(d * Math.min(1, Math.max(0, multiplier)));
  };
  for (const [stat, change] of merge) {
    if (change < 0 && Math.floor(random() * value) < 8 && has(stats, stat)) {
      stats[stat] = round2(stats[stat] + randomize(change));
    } else if (Math.floor(random() * 100) + value > 25) {
      stats[stat] = has(stats, stat) ? round2(stats[stat] + randomize(change)) : randomize(change);
    }
  }
  // Every stat has a cap, which only holds it down: a loss can still go below its start.
  for (const stat of Object.keys(stats)) stats[stat] = round2(Math.min(stats[stat], max[stat]));
  for (const stat of Object.keys(start)) {
    if (stats[stat] === start[stat]) stats[stat] = round2(stats[stat] * (0.9 + random() * 0.2));
  }
  return stats;
}

// 1–3 required strikes for each hit kind, the first input that names it deciding.
function generateHits(inputs, random) {
  const hits = {};
  for (const id of inputs) {
    for (const kind of Object.keys(INGREDIENTS[id].hits)) {
      if (!has(hits, kind)) hits[kind] = Math.floor(random() * 3) + 1;
    }
  }
  return hits;
}

// A free name from the base's list, then from the catalysts' lists; null when none is free.
function pickName(base, catalysts, taken, random) {
  const names = [...ALLOY_NAMES[INGREDIENTS[base].names]];
  const backups = catalysts.flatMap((id) => ALLOY_NAMES[INGREDIENTS[id].names]);
  let name = names[pick(names, random)];
  for (const list of [names, backups]) {
    while (taken(name) && list.length) {
      const index = pick(list, random);
      name = list[index];
      list.splice(index, 1);
    }
  }
  return taken(name) ? null : name;
}

// Crafting XP between the lowest and highest the inputs give; null without a base XP.
function craftXp(base, catalysts, random) {
  const { xp } = INGREDIENTS[base];
  if (xp === null) return null;
  let min = xp;
  let max = xp;
  for (const id of catalysts) {
    const other = INGREDIENTS[id].xp;
    if (other === null) continue;
    min = Math.min(min, other);
    max = Math.max(max, other);
  }
  return round2(min + random() * (max - min));
}

// Forges a mix nobody has fired before. Catalysts are in loading order.
//   { kind: 'scrap', keep: true }   the roll failed: the mix is scrap for good
//   { kind: 'scrap', keep: false }  no free name: scrap, and the mix stays unknown
//   { kind: 'alloy', alloy }        a new alloy, its catalysts sorted
export function forgeAlloy({ base, catalysts }, { random = Math.random, taken = () => false } = {}) {
  if (random() * 100 >= discoveryChance(base, catalysts)) return { kind: 'scrap', keep: true };
  const value = totalValue(base, catalysts);
  const stats = mergeStats(base, catalysts, value, random);
  const hits = generateHits([base, ...catalysts], random);
  const name = pickName(base, catalysts, taken, random);
  if (name === null) return { kind: 'scrap', keep: false };
  const xp = craftXp(base, catalysts, random);
  const colour = PALETTE[pick(PALETTE, random)];
  const { type, tier } = INGREDIENTS[base];
  return {
    kind: 'alloy',
    alloy: { name, colour, base, catalysts: [...catalysts].sort(), type, tier, stats, hits, xp },
  };
}

// Firing burns one Coal from the bag. A new alloy can be renamed for a minute
// of game time, and the hearth glows for a while after each firing.
export const FIRE_FUEL = 'coal';
export const NAMING_TIME = 60;
export const FIRE_GLOW = 10;

// Each refusal's message and the short reason a bag row shows, in the order they are checked.
const REFUSALS = {
  'not-ingredient': ['This item is not an ingredient.', 'Not an ingredient'],
  'wrong-base': ['This ingredient cannot be used as the base.', "Can't be the base"],
  exists: ['This ingredient is already part of the recipe.', 'Already in the mix'],
  capacity: ['The alloy forge cannot fit any more ingredients.', 'Forge is full'],
};
const result = (status, message, details = {}) => ({ ok: false, status, message, ...details });
const plain = (stack) => !Object.keys(stackExtras(stack)).length;
const isFuel = (stack) => stack?.id === FIRE_FUEL && plain(stack);

// The loaded mix: a base, then up to four catalysts in loading order, and the
// one result a full bag couldn't take.
export class AlloyForge {
  constructor() {
    this.base = null;
    this.catalysts = [];
    this.output = null;
  }

  get ingredients() {
    return this.base ? [this.base, ...this.catalysts] : [];
  }

  get idle() {
    return !this.base && !this.output;
  }

  status() {
    return `Base ${this.base ? 1 : 0}/1 · Catalysts ${this.catalysts.length}/${MAX_CATALYSTS}`;
  }

  // Why `stack` can't go in next, as { code, message, reason }, or null when it can.
  refusal(stack, table = INGREDIENTS) {
    const id = stack?.id;
    let code = null;
    if (!Object.hasOwn(table, id) || !plain(stack)) code = 'not-ingredient';
    else if (!this.base) code = table[id].base ? null : 'wrong-base';
    else if (this.ingredients.includes(id)) code = 'exists';
    else if (this.catalysts.length >= MAX_CATALYSTS) code = 'capacity';
    else if (!(COMBINATIONS[table[this.base].type] ?? []).includes(table[id].type)) code = 'incompatible';
    if (!code) return null;
    if (code !== 'incompatible') return { code, message: REFUSALS[code][0], reason: REFUSALS[code][1] };
    const [base, type] = [TYPE_NAMES[table[this.base].type], TYPE_NAMES[table[id].type]];
    const message = `A ${base} base cannot be mixed with a ${type} catalyst.`;
    return { code, message, reason: `Doesn't mix with ${base}` };
  }

  add(id) {
    if (this.base) this.catalysts.push(id);
    else this.base = id;
  }

  toJSON() {
    return { base: this.base, catalysts: [...this.catalysts], output: this.output && { ...this.output } };
  }

  // A saved state, or null when it breaks the loading rules or its output is unknown to `book`.
  static from(data, book) {
    if (!data || typeof data !== 'object') return null;
    const forge = mixOf(data.base, data.catalysts);
    const output = outputOf(data.output, book);
    if (!forge || output === undefined) return null;
    forge.output = output;
    return forge;
  }
}

// A forge holding this mix, or null when the loading rules refuse it.
export function mixOf(base, catalysts) {
  if (!Array.isArray(catalysts)) return null;
  const forge = new AlloyForge();
  if (base === null) return catalysts.length ? null : forge;
  for (const id of [base, ...catalysts]) {
    if (forge.refusal({ id })) return null;
    forge.add(id);
  }
  return forge;
}

function outputOf(data, book) {
  if (data === null) return null;
  const { alloy, inputs } = stackExtras(data);
  if (data?.count !== 1) return undefined;
  if (data.id === 'alloyIngot' && book.get(alloy)) return { id: data.id, count: 1, alloy };
  if (data.id === 'unusableScrap' && inputs) return { id: data.id, count: 1, inputs };
  return undefined;
}

// An alloy ingot's alloy name, or any other item's name.
export function stackName(stack, book) {
  if (stack.id !== 'alloyIngot') return ITEMS[stack.id].name;
  return book.get(stackExtras(stack).alloy)?.name ?? 'Unknown alloy';
}

// An alloy's stats in the table's order, as [name, text] pairs.
export const statLines = (alloy) => Object.keys(STAT_NAMES)
  .filter((stat) => Object.hasOwn(alloy.stats, stat)).map((stat) => [STAT_NAMES[stat], String(alloy.stats[stat])]);

// "Iron Ingot", "Iron Ingot and Raw Tin", "Iron Ingot, Copper Ingot and Raw Tin".
export const listNames = (names) => (names.length > 1
  ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

const coalCount = (inventory) => inventory.slots.reduce((sum, stack) => sum + (isFuel(stack) ? stack.count : 0), 0);

// Why the forge can't fire, checked before anything is taken, or null.
function fireRefusal(forge, inventory, book) {
  if (forge.output) return result('waiting', `Take the ${stackName(forge.output, book)} first.`);
  if (forge.ingredients.length < 2) return result('few', 'You need at least 2 ingredients to make an alloy.');
  if (!coalCount(inventory)) return result('fuel', `The alloy forge needs 1 ${ITEMS[FIRE_FUEL].name} to fire.`);
  return null;
}

// Moves one unit of the bag stack at `index` in, as the base or the next
// catalyst. A refusal changes nothing.
export function loadForge(forge, inventory, index) {
  const selected = inventory.getItem(index);
  if (!selected) return result('invalid', 'Select something in your bag.');
  const { item, stack } = selected;
  const refused = forge.refusal(stack);
  if (refused) return result('refused', refused.message, { id: item.id, code: refused.code });
  const original = { ...stack };
  const removed = inventory.remove(index, 1);
  if (removed?.id !== original.id || removed.count !== 1) {
    inventory.slots[index] = original;
    return result('invalid', 'That could not be moved.', { id: item.id });
  }
  forge.add(item.id);
  return result('loaded', `Added ${item.name}. ${forge.status()}`, { ok: true, id: item.id });
}

// Burns one Coal and turns the mix into its alloy or scrap, all at once: every
// check runs before the coal is taken, and nothing after it can fail. The result
// goes in the bag, or waits in the forge when the bag has no room.
export function fireForge(forge, inventory, book, propId, random = Math.random) {
  const refused = fireRefusal(forge, inventory, book);
  if (refused) return refused;
  const index = inventory.slots.findIndex(isFuel);
  const original = { ...inventory.slots[index] };
  const removed = inventory.remove(index, 1);
  if (removed?.id !== FIRE_FUEL || removed.count !== 1) {
    inventory.slots[index] = original;
    return result('invalid', 'That could not be moved.');
  }
  const { base, catalysts } = forge;
  const key = recipeKey(base, catalysts);
  const known = book.result(key);
  const alloy = known === null
    ? book.record(key, forgeAlloy({ base, catalysts }, { random, taken: (name) => book.taken(name) }))
    : known === 'scrap' ? null : known;
  const outcome = !alloy ? 'scrap' : known ? 'known' : 'new';
  const extras = alloy ? { alloy: alloy.id } : { inputs: scrapInputs(base, catalysts) };
  const id = alloy ? 'alloyIngot' : 'unusableScrap';
  forge.base = null;
  forge.catalysts = [];
  const waiting = !inventory.add(id, 1, extras);
  if (waiting) forge.output = { id, count: 1, ...extras };
  book.glow(propId);
  const said = outcome === 'scrap' ? 'The mix fails. You get Unusable Scrap.'
    : outcome === 'new' ? `You discovered ${alloy.name}!` : `The forge gives ${alloy.name}.`;
  const message = waiting ? `${said} Your bag is full: it waits in the forge.` : said;
  return result('fired', message, { ok: true, outcome, alloy, waiting });
}

// Gives the catalysts back, last loaded first, then the base, as far as the bag
// has room. The base stays while any catalyst does; the output is left alone.
export function emptyForge(forge, inventory) {
  if (!forge.base) return result('empty', 'The forge is empty.');
  const back = [];
  while (forge.catalysts.length && inventory.add(forge.catalysts.at(-1), 1)) back.push(forge.catalysts.pop());
  if (!forge.catalysts.length && inventory.add(forge.base, 1)) {
    back.push(forge.base);
    forge.base = null;
  }
  if (!back.length) return result('full', 'Your bag is full.');
  const names = back.map((id) => ITEMS[id].name).join(', ');
  const message = `Took back ${names}.${forge.base ? ' Your bag has no room for the rest.' : ''}`;
  return result('emptied', message, { ok: true, ids: back });
}

export function takeForge(forge, inventory, book) {
  const held = forge.output;
  if (!held) return result('empty', 'Nothing to take.');
  const { id, count, ...extras } = held;
  if (!inventory.add(id, count, extras)) return result('full', 'Your bag is full.', { id });
  forge.output = null;
  return result('took', `Took ${stackName(held, book)}.`, { ok: true, id });
}

// What the forge screen shows: the slots, the mix's known result, whether it
// can fire, the waiting output, the naming window, the known alloys and the
// bag stacks that are ingredients, alloy ingots or scrap.
export function forgeScreenModel(forge, inventory, book) {
  const slot = (id) => (id ? { id, name: ITEMS[id].name } : null);
  const mixed = forge.ingredients.length >= 2;
  const known = mixed ? book.result(recipeKey(forge.base, forge.catalysts)) : null;
  const blocked = fireRefusal(forge, inventory, book);
  const output = forge.output && {
    name: stackName(forge.output, book), colour: forge.output.alloy ? `#${book.get(forge.output.alloy).colour}` : null,
  };
  const naming = book.naming && {
    id: book.naming.id, name: book.get(book.naming.id).name,
    left: Math.max(0, Math.ceil(book.naming.until - book.time)),
  };
  const bag = [];
  inventory.slots.forEach((stack, index) => {
    const id = inventory.getItem(index)?.item.id;
    if (!Object.hasOwn(INGREDIENTS, id) && id !== 'alloyIngot' && id !== 'unusableScrap') return;
    const refused = forge.refusal(stack);
    const target = refused ? null : forge.base ? 'catalyst' : 'base';
    bag.push({ index, id, name: stackName(stack, book), count: stack.count, target, reason: refused?.reason ?? null });
  });
  return {
    base: slot(forge.base), catalysts: Array.from({ length: MAX_CATALYSTS }, (_, i) => slot(forge.catalysts[i])),
    status: forge.status(), result: !mixed ? null : known === 'scrap' ? 'Scrap' : known ? known.name : 'Unknown mix',
    fire: { ready: !blocked, reason: blocked?.message ?? null, coal: coalCount(inventory) },
    output, canEmpty: !!forge.base, naming,
    known: [...book.alloys.values()].map((alloy) => ({
      id: alloy.id, name: alloy.name, colour: `#${alloy.colour}`,
      recipe: [alloy.base, ...alloy.catalysts].map((id) => ITEMS[id].name).join(' + '), stats: statLines(alloy),
    })),
    bag,
  };
}

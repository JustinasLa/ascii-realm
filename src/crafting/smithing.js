import { INGOT_TIERS, getWeapon, weaponMaterial } from '../entities/weapons.js';
import { stackExtras } from '../inventory/inventory.js';
import { ITEMS } from '../inventory/items.js';
import { listNames, statLines } from './alloys.js';
import { QUALITIES } from './forged.js';
import { nearbyStation } from './furnace.js';
import { HIT_KINDS, INGREDIENTS, STAT_NAMES } from './ingredients.js';

// The weapon station's rules, as plain maths: what a piece needs, how its
// hits score, its quality, the craft roll and its clue, and the weapon made.
// A unit is a metal ingot's item id or an alloy id; `alloyOf(id)` is the
// alloy book's `get`.

// Recipe id = the weapon item it makes, in the screen's order.
export const RECIPES = Object.freeze({
  shortSword: Object.freeze({ name: 'Short Sword', metal: 4 }),
  dagger: Object.freeze({ name: 'Dagger', metal: 4 }),
  battleAxe: Object.freeze({ name: 'Battle Axe', metal: 4 }),
  warHammer: Object.freeze({ name: 'War Hammer', metal: 4 }),
  spear: Object.freeze({ name: 'Spear', metal: 4 }),
  greatsword: Object.freeze({ name: 'Greatsword', metal: 8 }),
});
// The hit buttons, keys 1–6.
export const HIT_ORDER = Object.freeze(Object.keys(HIT_KINDS));
export const CLUE_DC = 12;
// Added to the craft roll; +0 until characters have attributes.
export const CRAFT_MODIFIER = 0;
// Hits kept per kind, so saves stay bounded.
export const MAX_HITS = 999;
export const CLUE_PREFIX = 'Looking the piece over, ';
export const NO_CLUE = `${CLUE_PREFIX}you can't tell what went wrong with it.`;
export const nearbySmithy = (world, player) => nearbyStation(world, player, 'weapon-station');

const ALLOY_ID = /^a[1-9]\d{0,3}$/;
const STAT_ORDER = Object.keys(STAT_NAMES);
const round2 = (value) => Math.round(value * 100) / 100;
const dataOf = (unit, alloyOf) => (ALLOY_ID.test(unit) ? alloyOf(unit) : INGREDIENTS[unit]) ?? null;

// The hits one unit adds to the piece's needs.
export const unitHits = (unit, alloyOf) => dataOf(unit, alloyOf)?.hits ?? {};

// Every loaded unit adds its own hits.
export function neededHits(units, alloyOf) {
  const needed = {};
  for (const unit of units) {
    for (const [kind, n] of Object.entries(unitHits(unit, alloyOf))) needed[kind] = (needed[kind] ?? 0) + n;
  }
  return needed;
}

// A hit kind may be struck when the piece needs any hit of its family.
export const familyNeeded = (needed, kind) => Object.hasOwn(HIT_KINDS, kind)
  && Object.entries(needed).some(([other, n]) => n > 0 && HIT_KINDS[other]?.family === HIT_KINDS[kind].family);

// One kind's share done, rounded; 0 when the piece doesn't need it.
export const kindPercent = (done = 0, needed = 0) => (needed === 0 ? 0 : Math.round((100 * done) / needed));

// Every kind the piece needs or was struck with.
const kindsOf = (done, needed) => [...new Set([...Object.keys(needed), ...Object.keys(done)])]
  .filter((kind) => (needed[kind] ?? 0) > 0 || (done[kind] ?? 0) > 0);

export const isExact = (done, needed) => kindsOf(done, needed).every((kind) => (done[kind] ?? 0) === (needed[kind] ?? 0));

// The piece's Hits %: each kind scores its share up to 100, 200 less its share
// up to 200, and nothing beyond (an unneeded kind scores 0); the rounded mean.
// Only exact work reaches 100.
export function hitsPercent(done, needed) {
  const kinds = kindsOf(done, needed);
  if (!kinds.length) return 100;
  let sum = 0;
  for (const kind of kinds) {
    const p = kindPercent(done[kind], needed[kind]);
    if (p < 200) sum += p <= 100 ? p : 200 - p;
  }
  const percent = Math.round(sum / kinds.length);
  return percent >= 100 && !isExact(done, needed) ? 99 : percent;
}

export const qualityOf = (percent) => QUALITIES.findLast((quality) => quality.at <= percent);

// A d20 plus the modifier against CLUE_DC. A natural 20 always meets it and
// a natural 1 never does, whatever the modifier.
export function craftRoll(random = Math.random, modifier = CRAFT_MODIFIER) {
  const natural = 1 + Math.floor(random() * 20);
  const total = natural === 1 ? 1 : natural + modifier;
  const meets = natural === 20 || (natural !== 1 && total >= CLUE_DC);
  const text = natural === 20 ? 'Natural 20!' : natural === 1 ? 'Natural 1!'
    : `${natural} (${modifier >= 0 ? '+' : ''}${modifier}) = ${total}`;
  return { natural, modifier, total, meets, text };
}

// The clue a met roll gives: about the inexact kind closest to right (ties
// go to the smaller share off, then the kind id), only saying which way and
// roughly how far. Null when every kind is exact.
export function hitClue(done, needed) {
  const off = (kind) => Math.abs((done[kind] ?? 0) - (needed[kind] ?? 0));
  const share = (kind) => (needed[kind] ? off(kind) / needed[kind] : Infinity);
  const [kind] = kindsOf(done, needed).filter((k) => off(k) > 0)
    .sort((a, b) => off(a) - off(b) || share(a) - share(b) || (a < b ? -1 : 1));
  if (!kind) return null;
  const name = HIT_KINDS[kind]?.name ?? kind;
  if (!done[kind]) return `${CLUE_PREFIX}you sense it needed some ${name} work.`;
  if (!needed[kind]) return `${CLUE_PREFIX}you sense it took ${name} work it didn't need.`;
  const little = off(kind) === 1 || share(kind) <= 0.25;
  const far = share(kind) > 0.75;
  if (done[kind] < needed[kind]) return `${CLUE_PREFIX}you sense it needed ${little ? 'a little more' : far ? 'much more' : 'more'} ${name} work.`;
  return `${CLUE_PREFIX}you sense it took ${little ? 'a little too much' : far ? 'far too much' : 'too much'} ${name} work.`;
}

const countsOf = (units) => {
  const counts = new Map();
  for (const unit of units) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  return counts;
};

// The unit loaded most; a tie goes to the one loaded first.
export function majorityUnit(units) {
  let best = null;
  for (const [unit, n] of countsOf(units)) if (!best || n > best[1]) best = [unit, n];
  return best?.[0] ?? null;
}

// Each stat's mean over every unit, one missing it counting 0, to 2 places.
export function averageStats(units, alloyOf) {
  const sums = {};
  for (const unit of units) {
    for (const [stat, value] of Object.entries(dataOf(unit, alloyOf)?.stats ?? {})) sums[stat] = (sums[stat] ?? 0) + value;
  }
  return Object.fromEntries(STAT_ORDER.filter((stat) => Object.hasOwn(sums, stat))
    .map((stat) => [stat, round2(sums[stat] / units.length)]));
}

// The bag stack a finished piece makes: named and coloured for its main
// metal, with its quality, Hits %, averaged stats and inputs.
export function makeWeapon(recipe, units, percent, alloyOf) {
  const unit = majorityUnit(units);
  const alloy = ALLOY_ID.test(unit) ? alloyOf(unit) : null;
  const metal = alloy ? alloy.name : ITEMS[unit].name.replace(/ Ingot$/, '');
  const inputs = Object.fromEntries([...countsOf(units)].sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    id: recipe, count: 1, ...(alloy ? {} : { material: INGOT_TIERS[unit] }),
    forged: { metal, ...(alloy ? { colour: alloy.colour } : {}), quality: qualityOf(percent).id, hits: percent,
      stats: averageStats(units, alloyOf), inputs },
  };
}

// "Blackiron Dagger".
export const weaponName = (stack) => `${stack.forged.metal} ${ITEMS[stack.id].name}`;

// The weapon station: a piece in the making and the one weapon a full bag
// couldn't take. Every move below runs all its checks before it changes
// anything, and returns { ok, status, message, … } as the forge's moves do.

const result = (status, message, details = {}) => ({ ok: false, status, message, ...details });
const refusal = (code, message, reason) => ({ code, message, reason });
const NO_RECIPE = 'No recipe on this station. Select a recipe first.';
const LACKING = 'You have to add all the items before smithing.';
const alloyColour = (unit, book) => {
  const colour = ALLOY_ID.test(unit) ? book.get(unit)?.colour : null;
  return colour ? `#${colour}` : null;
};
// A unit's name: its alloy's, or its ingot's.
const unitName = (unit, book) => (ALLOY_ID.test(unit) ? book.get(unit)?.name ?? 'Unknown alloy' : ITEMS[unit].name);
// Puts one unit back in the bag as its ingot; 1 when it fit, else 0.
const giveBack = (inventory, unit) => (ALLOY_ID.test(unit) ? inventory.add('alloyIngot', 1, { alloy: unit }) : inventory.add(unit, 1));
// "Iron Ingot x2 and Blackiron", in the order given.
const namesOf = (units, book) => listNames([...countsOf(units)]
  .map(([unit, n]) => `${unitName(unit, book)}${n > 1 ? ` x${n}` : ''}`));

export class Smithy {
  constructor() {
    this.recipe = null;
    this.units = [];
    this.done = {};
    this.output = null;
  }

  get idle() {
    return !this.recipe && !this.output;
  }

  get need() {
    return this.recipe ? RECIPES[this.recipe].metal : 0;
  }

  get ready() {
    return !!this.recipe && this.units.length === this.need;
  }

  status() {
    return `Metal ${this.units.length}/${this.need}`;
  }

  // Why the piece can't be worked on now: a weapon waits, or no recipe is chosen.
  blocked() {
    if (this.output) return refusal('waiting', `Take the ${weaponName(this.output)} first.`, 'Take the weapon first');
    if (!this.recipe) return refusal('recipe', NO_RECIPE, 'Choose a piece first');
    return null;
  }

  // Why `unit` (an ingot's item id or an alloy id) can't go in next, or null.
  unitRefusal(unit, book) {
    const blocked = this.blocked();
    if (blocked) return blocked;
    const type = ALLOY_ID.test(unit) ? book.get(unit)?.type : INGREDIENTS[unit]?.type;
    if (!type) return refusal('material', 'That is not a material you can work.', "Can't be worked");
    if (type !== 'metal') return refusal('type', 'This recipe does not call for that material.', 'Not for this piece');
    if (this.units.length >= this.need) return refusal('full', 'The piece already has enough of that material.', 'Piece has enough');
    return null;
  }

  // The unit a bag stack would add: a plain ingredient's id or an alloy ingot's alloy id.
  static unitOf(stack) {
    const extras = Object.entries(stackExtras(stack));
    if (stack?.id === 'alloyIngot') return extras.length === 1 && extras[0][0] === 'alloy' ? extras[0][1] : null;
    return Object.hasOwn(INGREDIENTS, stack?.id) && !extras.length ? stack.id : null;
  }

  refusal(stack, book) {
    return this.unitRefusal(Smithy.unitOf(stack) ?? '', book);
  }

  // Why the piece can't be hit or finished yet: it needs all its metal first.
  finishRefusal() {
    const blocked = this.blocked();
    if (blocked || this.ready) return blocked;
    return refusal('missing', `You only have ${this.units.length} out of ${this.need} Metal items. ${LACKING}`, 'Add all the metal first');
  }

  // Why `kind` can't be struck now, or null.
  hitRefusal(kind, book) {
    const blocked = this.finishRefusal();
    if (blocked) return blocked;
    if (!Object.hasOwn(HIT_KINDS, kind)) return refusal('invalid', 'You cannot work the piece with that tool.', null);
    if (!familyNeeded(neededHits(this.units, (id) => book.get(id)), kind)) {
      return refusal('tool', 'This tool is not needed for this craft.', 'Not needed for this piece');
    }
    if ((this.done[kind] ?? 0) >= MAX_HITS) return refusal('limit', "That piece can't take more work.", 'No more work fits');
    return null;
  }

  toJSON() {
    return { recipe: this.recipe, units: [...this.units], done: { ...this.done }, output: this.output && { ...this.output } };
  }

  // A saved state, or null when it breaks the station's rules: units only
  // with a recipe and never past it, hits only once the metal is in and only
  // of a needed family, and a waiting weapon only on an empty station.
  static from(data, book) {
    if (!data || typeof data !== 'object') return null;
    const { recipe, units, done, output } = data;
    const smithy = new Smithy();
    if (recipe !== null && !Object.hasOwn(RECIPES, recipe)) return null;
    smithy.recipe = recipe;
    if (!Array.isArray(units) || (units.length && !recipe)) return null;
    for (const unit of units) {
      if (typeof unit !== 'string' || smithy.unitRefusal(unit, book)) return null;
      smithy.units.push(unit);
    }
    if (!done || typeof done !== 'object' || Array.isArray(done)) return null;
    for (const [kind, n] of Object.entries(done)) {
      if (!Number.isInteger(n) || n < 1 || n > MAX_HITS || smithy.hitRefusal(kind, book)) return null;
      smithy.done[kind] = n;
    }
    if (output === null) return smithy;
    const extras = stackExtras(output);
    const kept = output && typeof output === 'object' && Object.keys(output).every((key) => key === 'id' || key === 'count' || Object.hasOwn(extras, key));
    if (!kept || recipe || output.count !== 1 || !Object.hasOwn(RECIPES, output.id) || !extras.forged) return null;
    smithy.output = { id: output.id, count: 1, ...extras };
    return smithy;
  }
}

export function chooseRecipe(smithy, recipe) {
  if (smithy.output) return result('waiting', smithy.blocked().message);
  if (smithy.recipe) return result('chosen', 'Station already has a recipe selected.');
  if (!Object.hasOwn(RECIPES, recipe)) return result('invalid', 'That is not a piece you can make.');
  smithy.recipe = recipe;
  return result('selected', `Recipe ${RECIPES[recipe].name} selected!`, { ok: true, recipe });
}

// Moves one unit of the bag stack at `index` onto the piece, or nothing.
export function loadSmithy(smithy, inventory, index, book) {
  const selected = inventory.getItem(index);
  if (!selected) return result('invalid', 'Select something in your bag.');
  const { item, stack } = selected;
  const refused = smithy.refusal(stack, book);
  if (refused) return result('refused', refused.message, { id: item.id, code: refused.code });
  const unit = Smithy.unitOf(stack);
  const original = { ...stack };
  const removed = inventory.remove(index, 1);
  if (removed?.id !== original.id || removed.count !== 1) {
    inventory.slots[index] = original;
    return result('invalid', 'That could not be moved.', { id: item.id });
  }
  smithy.units.push(unit);
  return result('loaded', `Added ${unitName(unit, book)}. ${smithy.status()}`, { ok: true, id: item.id, unit });
}

// One hit of `kind`. Its message never tells how many the piece needs.
export function hitSmithy(smithy, kind, book) {
  const refused = smithy.hitRefusal(kind, book);
  if (refused) return result(refused.code, refused.message);
  smithy.done[kind] = (smithy.done[kind] ?? 0) + 1;
  return result('hit', `+1 ${HIT_KINDS[kind].name}`, { ok: true, kind, done: smithy.done[kind] });
}

// Scores the piece, rolls for a clue below 100 %, and turns the units into
// the weapon in one step: nothing after the checks can fail. The weapon goes
// in the bag, or waits on the station when the bag has no room.
export function finishSmithy(smithy, inventory, book, random = Math.random) {
  const refused = smithy.finishRefusal();
  if (refused) return result(refused.code, refused.message);
  const alloyOf = (id) => book.get(id);
  const needed = neededHits(smithy.units, alloyOf);
  const percent = hitsPercent(smithy.done, needed);
  const quality = qualityOf(percent);
  const roll = percent < 100 ? craftRoll(random) : null;
  const clue = roll && (roll.meets ? hitClue(smithy.done, needed) ?? NO_CLUE : NO_CLUE);
  const { id, count, ...extras } = makeWeapon(smithy.recipe, smithy.units, percent, alloyOf);
  smithy.recipe = null;
  smithy.units = [];
  smithy.done = {};
  const waiting = !inventory.add(id, count, extras);
  if (waiting) smithy.output = { id, count, ...extras };
  const name = weaponName({ id, ...extras });
  const lines = [`Hit Percentage: ${percent}%`, `Quality: ${quality.name}`,
    ...(roll ? [`Craft roll: ${roll.text}`, clue] : []),
    `You made a${/^[AEIOU]/.test(name) ? 'n' : ''} ${name}.${waiting ? ' Your bag is full: it waits on the station.' : ''}`];
  return result('finished', lines.join('\n'), { ok: true, id, name, percent, quality: quality.id, roll, clue, waiting, lines });
}

// Gives back each unit the bag has room for, last loaded first; the hits are
// lost. What doesn't fit stays with the recipe. A waiting weapon is left alone.
export function cancelSmithy(smithy, inventory, book) {
  if (!smithy.recipe) return result('empty', 'There is no project to cancel.');
  const back = [];
  for (let i = smithy.units.length - 1; i >= 0; i--) {
    if (giveBack(inventory, smithy.units[i])) back.push(...smithy.units.splice(i, 1));
  }
  if (smithy.units.length && !back.length) return result('full', 'Your bag is full.');
  smithy.done = {};
  const took = back.length ? ` Took back ${namesOf(back, book)}.` : '';
  if (smithy.units.length) return result('cancelled', `${took.trim()} Your bag has no room for the rest.`, { ok: true, units: back });
  smithy.recipe = null;
  return result('cancelled', `Project cancelled.${took}`, { ok: true, units: back });
}

export function takeSmithy(smithy, inventory) {
  const held = smithy.output;
  if (!held) return result('empty', 'Nothing to take.');
  const { id, count, ...extras } = held;
  if (!inventory.add(id, count, extras)) return result('full', 'Your bag is full.', { id });
  smithy.output = null;
  return result('took', `Took ${weaponName(held)}.`, { ok: true, id });
}

// What the station screen shows. It never holds how many hits the piece needs.
export function smithyScreenModel(smithy, inventory, book) {
  const slot = (unit) => (unit ? { unit, name: unitName(unit, book), colour: alloyColour(unit, book) } : null);
  const finish = smithy.finishRefusal();
  const bag = [];
  inventory.slots.forEach((stack, index) => {
    const id = inventory.getItem(index)?.item.id;
    if (!Object.hasOwn(INGREDIENTS, id) && id !== 'alloyIngot' && id !== 'unusableScrap') return;
    const unit = Smithy.unitOf(stack);
    const refused = smithy.refusal(stack, book);
    bag.push({
      index, id, name: unit ? unitName(unit, book) : ITEMS[id].name, colour: unit ? alloyColour(unit, book) : null,
      count: stack.count, target: refused ? null : 'metal', reason: refused?.reason ?? null,
    });
  });
  return {
    recipes: smithy.idle
      ? Object.entries(RECIPES).map(([id, { name, metal }]) => ({ id, name, metal, label: `Metal x${metal}` })) : null,
    recipe: smithy.recipe && { id: smithy.recipe, name: RECIPES[smithy.recipe].name },
    slots: Array.from({ length: smithy.need }, (_, i) => slot(smithy.units[i])),
    status: smithy.status(),
    ready: smithy.ready,
    hits: HIT_ORDER.map((kind, i) => {
      const refused = smithy.hitRefusal(kind, book);
      return { kind, key: i + 1, name: HIT_KINDS[kind].name, done: smithy.done[kind] ?? 0, allowed: !refused, reason: refused?.reason ?? null };
    }),
    total: Object.values(smithy.done).reduce((sum, n) => sum + n, 0),
    canFinish: !finish, finishReason: finish?.reason ?? null,
    canCancel: !!smithy.recipe,
    output: smithy.output && { name: weaponName(smithy.output), colour: smithy.output.forged.colour ? `#${smithy.output.forged.colour}` : null },
    bag,
  };
}

// What the bag shows for a smithed weapon, or null for any other stack.
export function describeWeapon(stack, book) {
  const { forged } = stackExtras(stack);
  if (!forged || !ITEMS[stack.id]?.weapon) return null;
  const name = weaponName({ id: stack.id, forged });
  const inputs = Object.entries(forged.inputs).map(([unit, n]) => `${n} ${unitName(unit, book)}`);
  const quality = QUALITIES.find((q) => q.id === forged.quality);
  const damage = getWeapon(ITEMS[stack.id].weapon, weaponMaterial({ ...stack, forged })).damage;
  return {
    name,
    colour: forged.colour ? `#${forged.colour}` : null,
    description: `${/^[AEIOU]/.test(name) ? 'An' : 'A'} ${name} smithed from ${listNames(inputs)}.`,
    stats: {
      Material: forged.metal, Quality: quality.name, Hits: `${forged.hits}%`,
      Socket: quality.socket ? `${quality.socket} (empty)` : 'none', Damage: String(damage),
      ...Object.fromEntries(statLines(forged)),
    },
    durability: Number.isFinite(forged.stats.durability) ? Math.round(forged.stats.durability) : null,
  };
}

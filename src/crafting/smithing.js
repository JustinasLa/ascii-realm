import { INGOT_TIERS } from '../entities/weapons.js';
import { ITEMS } from '../inventory/items.js';
import { QUALITIES } from './forged.js';
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

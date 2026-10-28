import { ALLOY_NAMES, BASE_BONUS, INGREDIENTS, MAX_FACTOR, ODDS, PALETTE } from './ingredients.js';

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

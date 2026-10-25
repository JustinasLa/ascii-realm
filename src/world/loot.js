import { HuntDrops, MAX_STACKS, PICKUP_DELAY } from '../entities/hunt-drops.js';
import { ITEMS } from '../inventory/items.js';
import { DENARS } from '../inventory/wallet.js';
import { ASPECT } from './world.js';
import { SCALE, TILT } from '../entities/rig.js';

// What a slain monster leaves: a small table per kind, rolled once when it
// dies, laid beside the body where the player can walk to it.

// The chance a goblin, elf or troll leaves something from its tier.
// Provisional: it may yet come down to 8 % (the tier's own 40 % share
// applied as well).
export const TIER_CHANCE = 0.2;

// Tier tables. A tier gives one of its items, by weight: four in five times
// iron, otherwise coin (a count of cents). Provisional, as TIER_CHANCE is.
const tier = (ingots, cents) => Object.freeze([
  Object.freeze({ id: 'ironIngot', count: ingots, weight: 0.4 }),
  Object.freeze({ id: DENARS, count: cents, weight: 0.1 }),
]);
export const TIERS = Object.freeze({
  easy: tier(1, 100),
  medium: tier(2, 200),
  hard: tier(4, 400),
});

// One entry of a tier, picked by weight with one roll.
function pick(entries, roll) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let left = roll * total;
  return entries.find((e) => (left -= e.weight) < 0) ?? entries.at(-1);
}

// What gathering now and then turns up in coin: per block, the chance and
// the range in cents.
export const GATHER_PAY = Object.freeze({
  tree: Object.freeze({ chance: 0.05, cents: Object.freeze([50, 100]) }),
});

// As many lengths of timber as felling gives.
export const logsOf = (tree) => (tree.growth === 'sapling' ? 1 : 3);

// The coin `blocks` blocks of `source` turn up: one stack per block that
// pays, [{ id, count }] with the count in cents.
export function rollPay(source, blocks, random = Math.random) {
  const pay = Object.hasOwn(GATHER_PAY, source) ? GATHER_PAY[source] : null;
  const out = [];
  for (let i = 0; pay && i < blocks; i++) {
    if (!(random() < pay.chance)) continue;
    const [min, max] = pay.cents;
    out.push({ id: DENARS, count: Math.round(min + random() * (max - min)) });
  }
  return out;
}

// Each entry rolls on its own, once per kill: chance, then a count in
// [min, max]. A `table` entry rolls its chance, then gives one of that
// tier's items.
export const LOOT = Object.freeze({
  skeleton: Object.freeze([
    { id: 'bone', chance: 1, count: [1, 2] },
    { id: 'arrow', chance: 0.6, count: [1, 2] },
    // The skeleton's rare headgear: a hood it wore.
    { id: 'outlawHood', chance: 0.01, count: [1, 1] },
  ]),
  goblin: Object.freeze([{ table: 'easy', chance: TIER_CHANCE }]),
  elf: Object.freeze([{ table: 'easy', chance: TIER_CHANCE }]),
  troll: Object.freeze([{ table: 'hard', chance: TIER_CHANCE }]),
});

// The share of a monster's health the player must take off it themselves
// to earn what it drops.
export const LOOT_CREDIT = 0.01;

// Rolls a kind's table: [{ id, count }], equal items merged.
export function rollLoot(kindId, random = Math.random, tables = LOOT) {
  const out = new Map();
  for (const entry of Object.hasOwn(tables, kindId) ? tables[kindId] : []) {
    if (!(random() < entry.chance)) continue;
    let id = entry.id;
    let count;
    if (entry.table) ({ id, count } = pick(TIERS[entry.table], random()));
    else count = entry.count[0] + Math.floor(random() * (entry.count[1] - entry.count[0] + 1));
    if (!Object.hasOwn(ITEMS, id)) continue;
    out.set(id, (out.get(id) ?? 0) + count);
  }
  return [...out].map(([id, count]) => ({ id, count }));
}

// How much of each monster's health the player has taken off it. Every
// landed blow, the player's or anyone's, is seen as the health it really
// removed since the last one, so a resisted spell earns only what it took.
export class LootCredit {
  constructor() {
    this.dealt = new WeakMap();
    this.seen = new WeakMap();
    this.claimed = new WeakSet();
  }

  // Notes a landed blow on `monster`; `mine` when the player dealt it.
  observe(monster, mine) {
    const before = this.seen.get(monster) ?? monster.maxHealth;
    const loss = Math.max(0, before - monster.health);
    this.seen.set(monster, monster.health);
    if (mine && loss > 0) this.dealt.set(monster, (this.dealt.get(monster) ?? 0) + loss);
    return loss;
  }

  earned(monster) {
    return (this.dealt.get(monster) ?? 0) >= LOOT_CREDIT * monster.maxHealth;
  }

  // Whether the monster's loot should drop now: earned, and only once.
  claim(monster) {
    if (this.claimed.has(monster) || !this.earned(monster)) return false;
    this.claimed.add(monster);
    return true;
  }
}

// Spots round a point loot may lie on, metres out, nearest ring first.
const RINGS = [1.2, 1.6, 2, 2.5, 3];
const NEAR_RINGS = [0, 0.5, 1, 1.5, 2, 2.5, 3];
const AROUND = 12;
// How far, metres, the search for dry ground beside the player reaches,
// and the size of its steps.
const SEARCH = 8;
const STEP = 0.5;

const toCells = (mx, mz) => [(mx * SCALE) / ASPECT, mz * SCALE * TILT];
const dry = (world, p) => HuntDrops.dry(world, p.x, p.y);

// The dry cell nearest `from`, walking out over dry ground or not, within
// SEARCH metres; null if there is none.
export function nearestDry(world, from) {
  if (dry(world, from)) return { x: from.x, y: from.y };
  const reach = Math.round(SEARCH / STEP);
  const [sx, sy] = toCells(STEP, STEP);
  const seen = new Set(['0,0']);
  let ring = [[0, 0]];
  while (ring.length) {
    const next = [];
    for (const [i, j] of ring) {
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        const key = `${a},${b}`;
        if (seen.has(key) || Math.hypot(a, b) > reach) continue;
        seen.add(key);
        const spot = { x: from.x + a * sx, y: from.y + b * sy };
        if (dry(world, spot)) return spot;
        next.push([a, b]);
      }
    }
    ring = next;
  }
  return null;
}

// Dry spots in rings round `centre` the player can walk to from `stand`.
function ringSpots(world, centre, rings, stand, path) {
  const out = [];
  for (const r of rings) {
    for (let i = 0; i < (r ? AROUND : 1); i++) {
      const angle = (i / AROUND) * Math.PI * 2 + r;
      const [dx, dy] = toCells(Math.sin(angle) * r, Math.cos(angle) * r);
      const spot = { x: centre.x + dx, y: centre.y + dy };
      if (dry(world, spot) && path(stand, spot)) out.push(spot);
    }
    if (out.length >= 3) break;
  }
  return out;
}

// Where a slain monster's loot may lie: beside the body where the player can
// walk to it; else beside the player; else on the dry ground nearest them.
export function lootSpots(world, body, killer, path = () => true) {
  const stand = nearestDry(world, killer);
  if (!stand) return [];
  const spots = ringSpots(world, body, RINGS, stand, path);
  if (spots.length) return spots;
  const near = ringSpots(world, stand, NEAR_RINGS, stand, path);
  return near.length ? near : [stand];
}

// Lays a kill's stacks in the drop store on spots from `lootSpots`. Returns
// the stacks laid.
export function layLoot(store, world, { x, y, killer, items }, path) {
  const laid = [];
  const spots = items.length ? lootSpots(world, { x, y }, killer, path) : [];
  if (!spots.length) return laid;
  items.forEach((d, i) => {
    const spot = spots[(i * 5) % spots.length];
    const item = store.items.add(d.id, d.count, spot.x, spot.y, { pickupAfter: store.items.time + PICKUP_DELAY });
    if (!item) return;
    store.laid.set(item, store.items.time);
    laid.push(item);
  });
  while (store.laid.size > MAX_STACKS) store.forget(store.laid.keys().next().value);
  return laid;
}

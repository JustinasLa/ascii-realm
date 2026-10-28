import { INGREDIENTS, PALETTE, STAT_NAMES } from './ingredients.js';

// A smithed weapon's quality comes from its Hits %: the highest band reached
// wins. Each band but the lowest leaves one empty socket of its kind.
export const QUALITIES = Object.freeze([
  { id: 'rusted', name: 'Rusted', at: 0, socket: null },
  { id: 'tempered', name: 'Tempered', at: 50, socket: 'Basic' },
  { id: 'polished', name: 'Polished', at: 75, socket: 'Polished' },
  { id: 'gleaming', name: 'Gleaming', at: 90, socket: 'Radiant' },
  { id: 'masterwork', name: 'Masterwork', at: 100, socket: 'Mythical' },
].map(Object.freeze));
// The most metal units one piece takes.
export const MAX_UNITS = 8;

const METAL = /^[A-Za-z]+( [A-Za-z]+)*$/;
const ALLOY_ID = /^a[1-9]\d{0,3}$/;
const STAT_ORDER = Object.keys(STAT_NAMES);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const workable = (id) => ALLOY_ID.test(id) || INGREDIENTS[id]?.type === 'metal';

function lookOf(value) {
  const { metal, colour } = value;
  if (typeof metal !== 'string' || metal.length > 24 || !METAL.test(metal)) return null;
  if (colour !== undefined && !PALETTE.includes(colour)) return null;
  return colour === undefined ? { metal } : { metal, colour };
}

// 1–9 known stats, finite and bounded, with a positive Attack Damage, in the
// stat table's order.
function statsOf(value) {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (!keys.length || !keys.every((key) => STAT_ORDER.includes(key) && Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e6)) return null;
  if (!(value.attackDamage > 0)) return null;
  return Object.freeze(Object.fromEntries(STAT_ORDER.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]])));
}

// 1–8 metal ingredients or alloys, whole counts adding up to at most MAX_UNITS,
// kept in id order.
function inputsOf(value) {
  if (!isObject(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || !entries.every(([id, n]) => workable(id) && Number.isSafeInteger(n) && n >= 1)) return null;
  if (entries.reduce((sum, [, n]) => sum + n, 0) > MAX_UNITS) return null;
  return Object.freeze(Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1))));
}

// A forged weapon's own properties, frozen in a fixed key order, or null when
// any is out of shape. `look` keeps only what friends need to draw it: its
// metal's name and, for an alloy, its colour.
export function readForged(value, { look = false } = {}) {
  if (!isObject(value)) return null;
  const seen = lookOf(value);
  if (!seen || look) return seen && Object.freeze(seen);
  const { quality, hits } = value;
  if (!QUALITIES.some((q) => q.id === quality) || !Number.isInteger(hits) || hits < 0 || hits > 100) return null;
  const stats = statsOf(value.stats);
  const inputs = inputsOf(value.inputs);
  if (!stats || !inputs) return null;
  return Object.freeze({ ...seen, quality, hits, stats, inputs });
}

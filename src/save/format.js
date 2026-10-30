// The save format: one realm record per world (the bodies played there, the
// piles they dropped and the day/night clock) and one edits record per world
// (the per-chunk log of changes to the land). Both share one envelope. These
// functions are pure: they build, check, repair and size records, and never
// touch storage or throw on bad data. `docs/saves.md` describes the format.

import { BAG_SLOTS, cleanStack } from '../inventory/inventory.js';
import { EQUIPMENT_SLOTS } from '../inventory/items.js';

export const SAVE_VERSION = 1;
// How many optional additions this build knows. Filling a reserved field or
// adding an optional one raises it without a version bump, so an older build
// can still play a newer record but never writes over it.
export const SAVE_FEATURES = 1;
export const GAME = 'ascii-realm';
// The body played when no character is active.
export const OUTLAW = 'outlaw';
export const MAX_REALM_CHARS = 256 * 1024;
export const MAX_EDITS_CHARS = 1024 * 1024;
export const MAX_BODIES = 8;
export const MAX_PILES = 16;
export const MAX_PILE_STACKS = 40;
// A bag keeps up to this many entries; those past BAG_SLOTS wait to be placed.
export const MAX_BAG = 64;
export const MAX_COORD = 1e7;
// Ticks in one day/night cycle.
export const TICKS = 24000;
const CAPS = { realm: MAX_REALM_CHARS, edits: MAX_EDITS_CHARS };

const ID = /^[\w-]{1,64}$/;
const CHUNK = /^-?\d+,-?\d+$/;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const coord = (n) => Number.isFinite(n) && Math.abs(n) <= MAX_COORD;
const worldOf = ({ seed, woodland }) => ({ seed, woodland: woodland === 'dense' ? 'dense' : 'sparse' });

// `1` for the sparse world on seed 1, `1-dense` for its dense woods.
export const worldIdOf = (world) => `${world.seed}${worldOf(world).woodland === 'dense' ? '-dense' : ''}`;
export const realmKey = (worldId) => `ascii-realm-save-${worldId}`;
export const editsKey = (worldId) => `ascii-realm-edits-${worldId}`;
export const corruptKey = (key) => `${key}-corrupt`;

const envelope = (kind, world) => ({
  v: SAVE_VERSION, game: GAME, kind, rev: 0, savedAt: 0, features: SAVE_FEATURES, world: worldOf(world),
});
export const emptyRealm = (world) => ({ ...envelope('realm', world), active: null, clock: null, bodies: {}, piles: [] });
export const emptyEdits = (world) => ({ ...envelope('edits', world), chunks: {} });

// Upgrades from each older version to the next, keyed by the version they
// upgrade from: `(record, kind) => record` at `v + 1`. None yet.
export const MIGRATIONS = Object.freeze({});

// Runs `record` up to `target`. It throws when a step is missing or doesn't
// return the next version.
export function migrate(record, kind, steps = MIGRATIONS, target = SAVE_VERSION) {
  let next = record;
  while (next.v < target) {
    const step = steps[next.v];
    if (typeof step !== 'function') throw new Error(`no save migration from v${next.v}`);
    const upgraded = step(next, kind);
    if (upgraded?.v !== next.v + 1) throw new Error(`save migration from v${next.v} didn't advance`);
    next = upgraded;
  }
  return next;
}

// A stored stack cleaned (see `cleanStack`); `repair` hears of each one cut
// to its limit or dropped.
function stackOf(raw, repair) {
  const stack = raw === null ? null : cleanStack(raw);
  if (raw !== null && (!stack || stack.clamped)) repair();
  if (stack) delete stack.clamped;
  return stack;
}

export function cleanClock(raw) {
  if (!plain(raw) || !whole(raw.day) || !Number.isFinite(raw.tick) || raw.tick < 0 || raw.tick >= TICKS) return null;
  return { day: raw.day, tick: raw.tick };
}

// A body with each broken part repaired or dropped, or null when it isn't an
// object. Fields this build doesn't know are kept.
export function cleanBody(raw, repair = () => {}) {
  if (!plain(raw)) return null;
  const at = coord(raw.x) && coord(raw.y);
  const respawn = plain(raw.respawn) && coord(raw.respawn.x) && coord(raw.respawn.y)
    ? { x: raw.respawn.x, y: raw.respawn.y } : null;
  const stacks = (Array.isArray(raw.bag) ? raw.bag : []).map((entry) => stackOf(entry, repair));
  const overflow = stacks.slice(BAG_SLOTS).filter(Boolean);
  if (overflow.length > MAX_BAG - BAG_SLOTS) repair(overflow.length - (MAX_BAG - BAG_SLOTS));
  const bag = [...stacks.slice(0, BAG_SLOTS), ...Array(Math.max(0, BAG_SLOTS - stacks.length)).fill(null),
    ...overflow.slice(0, MAX_BAG - BAG_SLOTS)];
  const worn = Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, stackOf(raw.worn?.[slot] ?? null, repair)]));
  if (plain(raw.worn)) for (const [slot, stack] of Object.entries(raw.worn)) if (!(slot in worn) && stack) repair();
  if (!at || (raw.respawn != null && !respawn) || !Array.isArray(raw.bag)) repair();
  for (const key of ['heading', 'health', 'stamina']) if (!Number.isFinite(raw[key])) repair();
  return {
    ...raw,
    savedAt: whole(raw.savedAt) ? raw.savedAt : 0,
    x: at ? raw.x : null,
    y: at ? raw.y : null,
    heading: Number.isFinite(raw.heading) ? raw.heading : 0,
    health: Number.isFinite(raw.health) ? raw.health : null,
    stamina: Number.isFinite(raw.stamina) ? raw.stamina : null,
    respawn,
    bag,
    worn,
  };
}

// A dropped bag, or null when it has no valid id, owner or place.
export function cleanPile(raw, repair = () => {}) {
  if (!plain(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || typeof raw.owner !== 'string'
    || !ID.test(raw.owner) || !coord(raw.x) || !coord(raw.y)) return null;
  const stacks = (Array.isArray(raw.stacks) ? raw.stacks : []).map((entry) => stackOf(entry, repair)).filter(Boolean);
  if (stacks.length > MAX_PILE_STACKS) repair(stacks.length - MAX_PILE_STACKS);
  return { ...raw, at: whole(raw.at) ? raw.at : 0, stacks: stacks.slice(0, MAX_PILE_STACKS) };
}

export function cleanRealm(record, repair = () => {}) {
  const bodies = {};
  for (const [id, raw] of Object.entries(plain(record.bodies) ? record.bodies : {})) {
    const body = Object.keys(bodies).length < MAX_BODIES && ID.test(id) ? cleanBody(raw, repair) : null;
    if (body) bodies[id] = body;
    else repair();
  }
  const piles = [];
  for (const raw of Array.isArray(record.piles) ? record.piles : []) {
    const pile = piles.length < MAX_PILES ? cleanPile(raw, repair) : null;
    if (pile) piles.push(pile);
    else repair();
  }
  const clock = cleanClock(record.clock);
  const active = typeof record.active === 'string' && Object.hasOwn(bodies, record.active) ? record.active : null;
  if (record.clock != null && !clock) repair();
  if (record.active != null && !active) repair();
  return { ...record, active, clock, bodies, piles };
}

// A plain JSON value at most `depth` containers deep, with short strings.
const valueOk = (value, depth = 4) => value === null || typeof value === 'boolean' || Number.isFinite(value)
  || (typeof value === 'string' && value.length <= 256)
  || (typeof value === 'object' && depth > 0 && Object.values(value).every((child) => valueOk(child, depth - 1)));

// An edit is `[type, target, value?]`. Types this build doesn't know are kept.
const opOk = (op) => Array.isArray(op) && op.length >= 2 && op.length <= 3
  && typeof op[0] === 'string' && op[0].length >= 1 && op[0].length <= 16
  && ((typeof op[1] === 'string' && op[1].length <= 64) || Number.isFinite(op[1]))
  && (op.length === 2 || (valueOk(op[2]) && JSON.stringify(op[2]).length <= 2048));

export function cleanEdits(record, repair = () => {}) {
  const chunks = {};
  for (const [key, ops] of Object.entries(plain(record.chunks) ? record.chunks : {})) {
    if (!CHUNK.test(key) || !Array.isArray(ops)) {
      repair();
      continue;
    }
    chunks[key] = ops.filter((op) => opOk(op) || (repair(), false));
  }
  return { ...record, chunks };
}

// The whole read of one stored text: `{ status, record, repaired, newerFeatures }`.
// `status` is 'none', 'ok', 'repaired', 'corrupt' or 'newer'; `record` is set
// for 'ok' and 'repaired' only. It never throws.
export function readRecord(raw, kind, world, { steps = MIGRATIONS, version = SAVE_VERSION } = {}) {
  const result = (status, record = null, repaired = 0) => ({ status, record, repaired,
    newerFeatures: !!record && record.features > SAVE_FEATURES });
  if (raw == null) return result('none');
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return result('corrupt');
  }
  const here = worldOf(world);
  if (!plain(record) || record.game !== GAME || record.kind !== kind || !Number.isInteger(record.v) || record.v < 1
    || !plain(record.world) || record.world.seed !== here.seed || record.world.woodland !== here.woodland) {
    return result('corrupt');
  }
  if (record.v > version) return result('newer');
  try {
    record = migrate(record, kind, steps, version);
  } catch {
    return result('corrupt');
  }
  let repaired = 0;
  const repair = (n = 1) => { repaired += n; };
  const cleaned = (kind === 'realm' ? cleanRealm : cleanEdits)({
    ...record,
    rev: whole(record.rev) ? record.rev : 0,
    savedAt: whole(record.savedAt) ? record.savedAt : 0,
    features: Number.isSafeInteger(record.features) && record.features >= 1 ? record.features : 1,
    world: here,
  }, repair);
  return result(repaired ? 'repaired' : 'ok', cleaned, repaired);
}

// `{ text }`, or `{ reason: 'too-big' }` when the text is over its kind's cap.
export function serialize(record) {
  const text = JSON.stringify(record);
  return text.length > CAPS[record.kind] ? { reason: 'too-big' } : { text };
}

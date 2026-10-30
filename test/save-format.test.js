import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EQUIPMENT_SLOTS } from '../src/inventory/items.js';
import { BAG_SLOTS } from '../src/inventory/inventory.js';
import {
  GAME, MAX_BAG, MAX_BODIES, MAX_EDITS_CHARS, MAX_PILES, MAX_PILE_STACKS, MAX_REALM_CHARS, MIGRATIONS, OUTLAW,
  SAVE_FEATURES, SAVE_VERSION, TICKS, cleanBody, cleanClock, cleanEdits, cleanPile, cleanRealm, corruptKey,
  editsKey, emptyEdits, emptyRealm, migrate, readRecord, realmKey, serialize, worldIdOf,
} from '../src/save/format.js';

const WORLD = { seed: 1, woodland: 'sparse' };
const worn = (over = {}) => ({ ...Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])), ...over });
const bag = (...stacks) => [...stacks, ...Array(BAG_SLOTS - stacks.length).fill(null)];
const body = (over = {}) => ({
  savedAt: 5, x: 312.4, y: -88, heading: 1.57, health: 64, stamina: 100, respawn: null,
  bag: bag({ id: 'oakLog', count: 3 }), worn: worn({ mainHand: { id: 'shortSword', count: 1, material: 'iron' } }), ...over,
});
const realm = (over = {}) => ({ ...emptyRealm(WORLD), rev: 3, savedAt: 9, active: OUTLAW, bodies: { [OUTLAW]: body() }, ...over });
const read = (record, kind = 'realm', world = WORLD) => readRecord(JSON.stringify(record), kind, world);
const counter = () => {
  const repair = (n = 1) => { repair.count += n; };
  repair.count = 0;
  return repair;
};

test('worlds, keys and empty records', () => {
  assert.equal(worldIdOf({ seed: 1, woodland: 'sparse' }), '1');
  assert.equal(worldIdOf({ seed: -42, woodland: 'dense' }), '-42-dense');
  assert.equal(worldIdOf({ seed: 7 }), '7');
  assert.equal(realmKey('1'), 'ascii-realm-save-1');
  assert.equal(editsKey('1-dense'), 'ascii-realm-edits-1-dense');
  assert.equal(corruptKey('ascii-realm-save-1'), 'ascii-realm-save-1-corrupt');
  const envelope = { v: SAVE_VERSION, game: GAME, rev: 0, savedAt: 0, features: SAVE_FEATURES, world: WORLD };
  assert.deepEqual(emptyRealm({ seed: 1 }), { ...envelope, kind: 'realm', active: null, clock: null, bodies: {}, piles: [] });
  assert.deepEqual(emptyEdits(WORLD), { ...envelope, kind: 'edits', chunks: {} });
  assert.deepEqual(MIGRATIONS, {});
  assert.ok(MAX_REALM_CHARS < MAX_EDITS_CHARS);
});

test('every broken or foreign text reads as corrupt, a missing one as none', () => {
  assert.equal(readRecord(null, 'realm', WORLD).status, 'none');
  for (const raw of ['{', 'null', '[]', '7']) assert.equal(readRecord(raw, 'realm', WORLD).status, 'corrupt', raw);
  const good = emptyRealm(WORLD);
  for (const over of [{ game: 'other' }, { kind: 'edits' }, { v: 0 }, { v: 1.5 }, { v: '1' }, { world: null },
    { world: { seed: 2, woodland: 'sparse' } }, { world: { seed: 1, woodland: 'dense' } }]) {
    const result = read({ ...good, ...over });
    assert.deepEqual(result, { status: 'corrupt', record: null, repaired: 0, newerFeatures: false }, JSON.stringify(over));
  }
  assert.equal(read(emptyEdits(WORLD), 'realm').status, 'corrupt');
});

test('a newer version is left alone, newer features still read', () => {
  assert.deepEqual(read({ ...emptyRealm(WORLD), v: SAVE_VERSION + 1 }),
    { status: 'newer', record: null, repaired: 0, newerFeatures: false });
  const later = read({ ...realm(), features: 99 });
  assert.equal(later.status, 'ok');
  assert.equal(later.newerFeatures, true);
  assert.equal(later.record.features, 99);
});

test('a valid record reads back unchanged, with unknown fields kept', () => {
  const record = realm({ clock: { day: 3, tick: 120.5 }, extra: { kept: true },
    bodies: { [OUTLAW]: body({ later: [1, 2] }) },
    piles: [{ id: 'p1', owner: OUTLAW, x: 1, y: 2, at: 4, stacks: [{ id: 'oakLog', count: 2 }], later: 'x' }] });
  const text = serialize(record).text;
  assert.deepEqual(readRecord(text, 'realm', WORLD), { status: 'ok', record, repaired: 0, newerFeatures: false });
  const edits = { ...emptyEdits(WORLD), rev: 2, chunks: { '0,-1': [['tree', 'p12'], ['prop', 3, { kind: 'rock', x: 1 }]] } };
  assert.deepEqual(readRecord(serialize(edits).text, 'edits', WORLD).record, edits);
});

test('a broken envelope field is reset without counting as damage', () => {
  const result = read({ ...emptyRealm(WORLD), rev: -1, savedAt: 'x', features: 0, world: { ...WORLD, extra: 1 } });
  assert.equal(result.status, 'ok');
  assert.deepEqual([result.record.rev, result.record.savedAt, result.record.features], [0, 0, 1]);
  assert.deepEqual(result.record.world, WORLD);
});

test('migrations run one version at a time and a broken table reads as corrupt', () => {
  const steps = {
    1: (record, kind) => ({ ...record, v: 2, kinds: [kind] }),
    2: (record) => ({ ...record, v: 3, three: true }),
  };
  const old = { ...emptyRealm(WORLD), v: 1 };
  assert.deepEqual(migrate(old, 'realm', steps, 3), { ...old, v: 3, kinds: ['realm'], three: true });
  assert.equal(migrate(old, 'realm'), old);
  assert.throws(() => migrate(old, 'realm', { 1: steps[1] }, 3), /no save migration from v2/);
  assert.throws(() => migrate(old, 'realm', { 1: (record) => record }, 2), /didn't advance/);
  const result = readRecord(JSON.stringify(old), 'realm', WORLD, { steps, version: 3 });
  assert.equal(result.status, 'ok');
  assert.equal(result.record.v, 3);
  assert.equal(result.record.three, true);
  assert.equal(readRecord(JSON.stringify(old), 'realm', WORLD, { steps: {}, version: 2 }).status, 'corrupt');
});

test('a body keeps what it can and counts what it repairs', () => {
  const repair = counter();
  const raw = body({ x: NaN, heading: 'n', health: null, savedAt: -1, respawn: { x: 1, y: 2e7 },
    bag: [{ id: 'gone', count: 1 }, { id: 'oakLog', count: 99 }, 5, null, { id: 'oakLog', count: 1.5 }],
    worn: { mainHand: { id: 'shortSword', count: 1 }, tail: { id: 'oakLog', count: 1 }, wings: null, helm: { id: 'nope' } } });
  const cleaned = cleanBody(raw, repair);
  // gone, clamped, 5, 1.5, tail, helm, coords + respawn (one), heading, health
  assert.equal(repair.count, 9);
  assert.deepEqual([cleaned.x, cleaned.y, cleaned.heading, cleaned.health, cleaned.stamina, cleaned.savedAt],
    [null, null, 0, null, 100, 0]);
  assert.equal(cleaned.respawn, null);
  assert.equal(cleaned.bag.length, BAG_SLOTS);
  assert.deepEqual(cleaned.bag.slice(0, 5), [null, { id: 'oakLog', count: 10 }, null, null, null]);
  assert.deepEqual(cleaned.worn, worn({ mainHand: { id: 'shortSword', count: 1 } }));
  assert.equal(cleanBody('x'), null);
  assert.equal(cleanBody(null), null);
});

test('a body without a bag gets an empty one, and a bad respawn point is dropped', () => {
  const repair = counter();
  const cleaned = cleanBody({ x: 1, y: 2, heading: 0, health: 1, stamina: 1, worn: 'x', respawn: 'bed' }, repair);
  assert.deepEqual(cleaned.bag, Array(BAG_SLOTS).fill(null));
  assert.deepEqual(cleaned.worn, worn());
  assert.equal(repair.count, 1);
  assert.deepEqual(cleanBody(body({ respawn: { x: 3, y: 4 } })).respawn, { x: 3, y: 4 });
});

test('stacks past the bag wait to be placed, up to the bag limit', () => {
  const log = { id: 'oakLog', count: 1 };
  const repair = counter();
  const cleaned = cleanBody(body({ bag: [log, ...Array(BAG_SLOTS - 1).fill(null), null, log, log] }), repair);
  assert.equal(repair.count, 0);
  assert.deepEqual(cleaned.bag.slice(BAG_SLOTS), [log, log]);
  const full = cleanBody(body({ bag: Array(MAX_BAG + 5).fill(log) }), repair);
  assert.equal(full.bag.length, MAX_BAG);
  assert.equal(repair.count, 5);
});

test('piles keep a place, an owner and a bounded list of stacks', () => {
  const pile = (over = {}) => ({ id: 'p1', owner: OUTLAW, x: 1, y: 2, at: 3, stacks: [], ...over });
  for (const over of [{ id: 5 }, { id: 'p'.repeat(65) }, { owner: '' }, { owner: null }, { x: Infinity }, { y: 'a' }]) {
    assert.equal(cleanPile(pile(over)), null, JSON.stringify(over));
  }
  assert.equal(cleanPile([]), null);
  const repair = counter();
  const big = cleanPile(pile({ at: 'x', stacks: [...Array(MAX_PILE_STACKS + 2).fill({ id: 'oakLog', count: 1 }), { id: 'x' }] }), repair);
  assert.equal(big.stacks.length, MAX_PILE_STACKS);
  assert.equal(big.at, 0);
  assert.equal(repair.count, 3);
  assert.deepEqual(cleanPile(pile({ stacks: 'x' })).stacks, []);
});

test('a realm drops broken bodies and piles one at a time', () => {
  const bodies = Object.fromEntries(Array.from({ length: MAX_BODIES + 1 }, (_, i) => [`c${i}`, body()]));
  const repair = counter();
  const cleaned = cleanRealm({ ...realm(), active: 'gone', clock: { day: 1, tick: TICKS },
    bodies: { ...bodies, 'bad id': body(), broken: 'x' },
    piles: [...Array(MAX_PILES + 1).fill({ id: 'p', owner: 'c0', x: 0, y: 0, stacks: [] }), null] }, repair);
  assert.equal(Object.keys(cleaned.bodies).length, MAX_BODIES);
  assert.equal(cleaned.piles.length, MAX_PILES);
  assert.equal(cleaned.active, null);
  assert.equal(cleaned.clock, null);
  // one extra body, a bad id, a broken body, one extra pile, a null pile, the clock and active
  assert.equal(repair.count, 7);
  assert.deepEqual(cleanRealm({ bodies: [], piles: {}, active: 5 }), { active: null, clock: null, bodies: {}, piles: [] });
  assert.equal(read({ ...realm(), active: 'gone' }).status, 'repaired');
  assert.equal(read({ ...realm(), active: 'gone' }).repaired, 1);
});

test('a clock holds a whole day and a tick inside the cycle', () => {
  assert.equal(cleanClock(null), null);
  assert.deepEqual(cleanClock({ day: 0, tick: 0, extra: 1 }), { day: 0, tick: 0 });
  assert.deepEqual(cleanClock({ day: 4, tick: TICKS - 0.5 }), { day: 4, tick: TICKS - 0.5 });
  for (const clock of [{ day: -1, tick: 0 }, { day: 1.5, tick: 0 }, { day: 0, tick: TICKS }, { day: 0, tick: -1 },
    { day: 0, tick: NaN }, [0, 0]]) assert.equal(cleanClock(clock), null, JSON.stringify(clock));
});

test('edits keep bounded ops, including types this build does not know', () => {
  const ok = [['tree', 'p1'], ['someday', 4, null], ['prop', 'x', { kind: 'rock', x: 1, y: 2, scale: 1, later: [true] }],
    ['loot', '0,0', [{ id: 'oakLog', count: 2 }]], ['t'.repeat(16), 't'.repeat(64), 's'.repeat(256)], ['a', 1, [[[[1]]]]]];
  const bad = [['tree'], ['tree', 'p', 1, 2], 'tree', [5, 'p'], ['', 'p'], ['t'.repeat(17), 'p'], ['tree', 't'.repeat(65)],
    ['tree', Infinity], ['tree', null], ['a', 1, 's'.repeat(257)], ['a', 1, [[[[[1]]]]]], ['a', 1, Array(500).fill(12345)]];
  const repair = counter();
  const cleaned = cleanEdits({ ...emptyEdits(WORLD), chunks: { '3,-4': [...ok, ...bad], '1,x': [], '2,2': 'x' } }, repair);
  assert.deepEqual(cleaned.chunks, { '3,-4': ok });
  assert.equal(repair.count, bad.length + 2);
  assert.deepEqual(cleanEdits({ chunks: [] }).chunks, {});
  assert.equal(read({ ...emptyEdits(WORLD), chunks: { '0,0': [['tree']] } }, 'edits').status, 'repaired');
});

test('serialize refuses a record over its cap', () => {
  const text = serialize(emptyRealm(WORLD)).text;
  assert.equal(typeof text, 'string');
  assert.deepEqual(serialize({ ...emptyRealm(WORLD), pad: 'x'.repeat(MAX_REALM_CHARS) }), { reason: 'too-big' });
  assert.ok(serialize({ ...emptyEdits(WORLD), pad: 'x'.repeat(MAX_REALM_CHARS) }).text);
  assert.deepEqual(serialize({ ...emptyEdits(WORLD), pad: 'x'.repeat(MAX_EDITS_CHARS) }), { reason: 'too-big' });
});

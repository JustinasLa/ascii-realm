import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '../src/character/catalog.js';
import { ageOn, birthdayFromAge, realmToday } from '../src/character/calendar.js';
import { blankSheet } from '../src/character/rules.js';
import { cleanRoster, migrate, MIGRATIONS, randomId, Roster, ROSTER_KEY, ROSTER_VERSION } from '../src/character/roster.js';

const START = new Date(2026, 9, 26, 12).getTime();

// A localStorage stand-in; `broken` makes reads or writes throw.
function memory(entries = {}) {
  const map = new Map(Object.entries(entries));
  const broken = { get: false, set: false };
  return {
    map, broken,
    getItem: (key) => { if (broken.get) throw new Error('denied'); return map.get(key) ?? null; },
    setItem: (key, value) => { if (broken.set) throw new Error('quota'); map.set(key, String(value)); },
    removeItem: (key) => map.delete(key),
    saved: () => JSON.parse(map.get(ROSTER_KEY)),
  };
}

// A roster on a settable clock with predictable ids.
function roster(storage = memory(), options = {}) {
  const clock = { now: START };
  let n = 0;
  const made = new Roster({ storage, now: () => clock.now, randomId: () => `c${String(++n).padStart(4, '0')}${options.tag ?? ''}`, ...options });
  return { roster: made, clock, storage };
}

const sheet = (name, changes = {}) => ({
  ...blankSheet(),
  name,
  race: 'orc',
  birthday: birthdayFromAge(30, realmToday(START), name),
  class: 'warrior',
  attributes: { strength: 3, dexterity: 2, constitution: 1, intelligence: 1, wisdom: 0, charisma: 0 },
  description: 'A broad-shouldered wanderer with a broken nose.',
  clues: ['Smells of smoke and iron', 'Whistles when nervous'],
  ...changes,
});

function make(r, name, changes) {
  const draft = r.newDraft();
  draft.sheet = sheet(name, changes);
  return r.create(draft);
}

const stored = (characters, extra = {}) => JSON.stringify({ v: 1, rev: 1, active: characters[0]?.id ?? null, characters, ...extra });
const saved = (id, name = 'Ash', extra = {}) => ({ id, createdAt: START, switchedAt: null, sheet: sheet(name), skin: null, ...extra });

test('an empty roster with nothing saved', () => {
  const { roster: r, storage } = roster();
  assert.deepEqual(r.characters, []);
  assert.equal(r.active, null);
  assert.equal(r.lastSwitchAt, null);
  assert.equal(r.readOnly, false);
  assert.equal(storage.map.size, 0, 'loading writes nothing');
  assert.equal(ROSTER_KEY, 'ascii-realm-characters');
  assert.equal(ROSTER_VERSION, 1);
});

test('the first character is active and has never been switched to', () => {
  const { roster: r, storage } = roster();
  const result = make(r, 'Zoë Ashford');
  assert.equal(result.ok, true);
  assert.deepEqual(result.character, { id: 'c0001', createdAt: START, switchedAt: null, sheet: sheet('Zoë Ashford'), skin: null });
  assert.equal(r.active.id, 'c0001');
  assert.deepEqual(storage.saved(), { v: 1, rev: 1, active: 'c0001', characters: [result.character] });
  // Reloading finds it.
  assert.deepEqual(new Roster({ storage }).active, result.character);
});

test('a second character at once is a switch; a third waits for the cooldown', () => {
  const { roster: r, clock } = roster();
  make(r, 'First');
  clock.now += 1000;
  const second = make(r, 'Second');
  assert.equal(second.ok, true);
  assert.equal(second.character.switchedAt, START + 1000);
  assert.equal(r.active.id, 'c0002');
  assert.equal(r.lastSwitchAt, START + 1000);
  clock.now = START + 1000 + 4 * DAY - 1;
  const opensAt = START + 1000 + 4 * DAY;
  assert.deepEqual(r.canCreate(), { ok: false, reason: 'You are on cooldown from switching characters.', opensAt });
  assert.deepEqual(make(r, 'Third'), { ok: false, reason: 'You are on cooldown from switching characters.', opensAt });
  clock.now = opensAt;
  assert.equal(make(r, 'Third').ok, true);
  assert.deepEqual(r.canCreate(), { ok: false, reason: 'All 3 character slots are taken.' });
  assert.deepEqual(make(r, 'Fourth'), { ok: false, reason: 'All 3 character slots are taken.' });
  assert.equal(r.characters.length, 3);
});

test('?debug skips the cooldown but not the slot limit', () => {
  const { roster: r } = roster(memory(), { bypassCooldown: true });
  for (const name of ['One', 'Two', 'Three']) assert.equal(make(r, name).ok, true);
  assert.equal(make(r, 'Four').reason, 'All 3 character slots are taken.');
  assert.deepEqual(r.canSwitch('c0001'), { ok: true });
  assert.deepEqual(r.switchTo('c0001'), { ok: true });
  assert.equal(r.active.id, 'c0001');
});

test('invalid drafts list their errors and save nothing', () => {
  const { roster: r, storage } = roster();
  const draft = r.newDraft();
  assert.deepEqual(draft, { id: 'c0001', sheet: blankSheet() });
  const result = r.create(draft);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.step), ['name', 'class', 'race', 'age', 'attributes', 'description', 'clues']);
  assert.equal(storage.map.size, 0);
  make(r, 'Kael');
  assert.deepEqual(make(r, 'KAEL').errors, [{ step: 'name', message: 'Name already in use.' }]);
  assert.deepEqual(r.create({ id: 'c0002', sheet: sheet('Other') }), { ok: false, reason: 'This character needs a new id.' });
  assert.deepEqual(r.create({ id: 'no', sheet: sheet('Other') }), { ok: false, reason: 'This character needs a new id.' });
  assert.deepEqual(r.create(null), { ok: false, reason: 'This character needs a new id.' });
});

test('a created character is stored cleaned, with its skin', () => {
  const { roster: r } = roster(memory(), { bypassCooldown: true });
  const draft = r.newDraft();
  draft.sheet = sheet(' O’Brien ', { clues: [' Smells of smoke and iron ', 'Whistles when nervous'] });
  draft.skin = { preset: 'moss' };
  const { character } = r.create(draft);
  assert.equal(character.sheet.name, "O'Brien");
  assert.deepEqual(character.sheet.clues, ['Smells of smoke and iron', 'Whistles when nervous']);
  assert.deepEqual(character.skin, { preset: 'moss' });
  const other = r.newDraft();
  other.sheet = sheet('Second');
  other.skin = 'red';
  assert.equal(r.create(other).character.skin, null);
});

test('switching waits four days after the last switch', () => {
  const { roster: r, clock } = roster();
  make(r, 'First');
  make(r, 'Second');
  assert.deepEqual(r.canSwitch('c0002'), { ok: true }, 'the active one is always fine');
  assert.deepEqual(r.switchTo('c0002'), { ok: true });
  assert.deepEqual(r.canSwitch('c0001'), { ok: false, reason: 'You are on cooldown from switching characters.', opensAt: START + 4 * DAY });
  assert.equal(r.switchTo('c0001').ok, false);
  assert.deepEqual(r.canSwitch('nope'), { ok: false, reason: 'No such character.' });
  clock.now = START + 4 * DAY;
  assert.deepEqual(r.switchTo('c0001'), { ok: true });
  assert.equal(r.active.id, 'c0001');
  assert.equal(r.lastSwitchAt, START + 4 * DAY);
  assert.equal(r.characters[0].switchedAt, START + 4 * DAY);
});

test('a lone character can be switched to without a cooldown', () => {
  const storage = memory({ [ROSTER_KEY]: stored([saved('c0001'), saved('c0002', 'Bryn')], { active: 'c0001' }) });
  const { roster: r } = roster(storage);
  assert.equal(r.lastSwitchAt, null);
  assert.deepEqual(r.switchTo('c0002'), { ok: true });
});

test('edits respect each field’s lock', () => {
  const { roster: r, clock } = roster();
  make(r, 'Kael');
  assert.equal(r.update('c0001', { race: 'human' }).ok, true, 'race is open on the first day');
  clock.now = START + DAY;
  assert.deepEqual(r.update('c0001', { race: 'elf' }), { ok: false, reason: 'Race is locked.' });
  assert.equal(r.update('c0001', { class: 'bard' }).ok, true);
  assert.equal(r.update('c0001', { attributes: { strength: 3, dexterity: 3, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 } })
    .ok, false, 'a bad spend is refused');
  clock.now = START + 5 * DAY;
  assert.deepEqual(r.update('c0001', { class: 'mage' }), { ok: false, reason: 'Class is locked.' });
  assert.deepEqual(r.update('c0001', { attributes: { ...r.active.sheet.attributes, strength: 2, wisdom: 2 } }),
    { ok: false, reason: 'Attributes is locked.' });
  for (const changes of [{ name: 'Kael the Grey' }, { gender: 'other' }, { description: 'A tall, quiet wanderer with grey eyes.' },
    { clues: ['Smells of rain and moss', 'Taps a foot when thinking'] }]) {
    assert.equal(r.update('c0001', changes).ok, true, Object.keys(changes)[0]);
  }
  assert.equal(r.active.sheet.name, 'Kael the Grey');
  assert.equal(r.active.sheet.race, 'human');
  assert.equal(r.active.sheet.class, 'bard');
  assert.deepEqual(r.update('nope', { name: 'X' }), { ok: false, reason: 'No such character.' });
});

test('a birthday change follows the age lock', () => {
  const { roster: r, clock } = roster();
  make(r, 'Kael');
  const birthday = birthdayFromAge(40, realmToday(START), 'other');
  assert.equal(r.update('c0001', { birthday }).ok, true);
  assert.equal(r.active.sheet.birthday, birthday);
  clock.now = START + 5 * DAY;
  assert.deepEqual(r.update('c0001', { birthday: birthdayFromAge(41, realmToday(clock.now), 'x') }), { ok: false, reason: 'Age is locked.' });
});

test('edits check only what they change, so an aged character can still be renamed', () => {
  // Created at 90, the orc maximum, years ago: now past it.
  const old = saved('c0001', 'Grom', { createdAt: START - 400 * DAY });
  old.sheet.birthday = birthdayFromAge(92, realmToday(START), 'c0001');
  const { roster: r } = roster(memory({ [ROSTER_KEY]: stored([old]) }));
  assert.equal(ageOn(r.active.sheet.birthday, realmToday(START)), 92);
  assert.equal(r.update('c0001', { name: 'Grom Oldtusk', description: 'An old orc, grey-tusked and slow to anger.' }).ok, true);
  const young = saved('c0001', 'Grom');
  const { roster: fresh } = roster(memory({ [ROSTER_KEY]: stored([young]) }));
  assert.deepEqual(fresh.update('c0001', { birthday: birthdayFromAge(91, realmToday(START), 'x') }),
    { ok: false, errors: [{ field: 'birthday', message: 'Age must be between 18 and 90 for your race.' }] });
  const elf = saved('c0001', 'Grom');
  elf.sheet.race = 'elf';
  elf.sheet.birthday = birthdayFromAge(150, realmToday(START), 'x');
  const { roster: elder } = roster(memory({ [ROSTER_KEY]: stored([elf]) }));
  assert.deepEqual(elder.update('c0001', { race: 'orc' }), { ok: false, errors: [
    { field: 'birthday', message: 'Age must be between 18 and 90 for your race.' }] });
  assert.deepEqual(elder.update('c0001', { name: '' }), { ok: false, errors: [{ field: 'name', message: 'Name cannot be empty.' }] });
});

test('a rename may not take another character’s name', () => {
  const { roster: r } = roster(memory(), { bypassCooldown: true });
  make(r, 'Kael');
  make(r, 'Bryn');
  assert.deepEqual(r.update('c0002', { name: 'kael' }).errors, [{ field: 'name', message: 'Name already in use.' }]);
  assert.equal(r.update('c0002', { name: 'BRYN' }).ok, true);
});

test('skins are stored as given, or null', () => {
  const { roster: r, storage } = roster();
  make(r, 'Kael');
  assert.deepEqual(r.setSkin('c0001', { tone: 'moss' }), { ok: true });
  assert.deepEqual(r.active.skin, { tone: 'moss' });
  assert.deepEqual(storage.saved().characters[0].skin, { tone: 'moss' });
  r.setSkin('c0001', [1]);
  assert.equal(r.active.skin, null);
  assert.deepEqual(r.setSkin('nope', null), { ok: false, reason: 'No such character.' });
});

test('copies handed out do not change the roster', () => {
  const { roster: r } = roster();
  make(r, 'Kael');
  r.characters[0].sheet.name = 'Changed';
  r.active.sheet.name = 'Changed';
  assert.equal(r.active.sheet.name, 'Kael');
});

test('no storage, or storage that refuses, keeps the roster for the visit', () => {
  for (const storage of [null, memory()]) {
    if (storage) storage.broken.get = storage.broken.set = true;
    const { roster: r } = roster(storage);
    assert.deepEqual(r.characters, []);
    assert.equal(r.suggestedName, '');
    assert.equal(make(r, 'Kael').ok, true);
    assert.equal(r.active.sheet.name, 'Kael');
  }
});

test('changes made while writes fail stick, and the next good write saves them all', () => {
  const storage = memory();
  const { roster: r } = roster(storage);
  make(r, 'Kael');
  storage.broken.set = true;
  assert.equal(r.update('c0001', { name: 'Kael Two' }).ok, true);
  assert.equal(r.update('c0001', { gender: 'male' }).ok, true);
  assert.equal(r.setSkin('c0001', { tone: 'ash' }).ok, true);
  assert.equal(r.active.sheet.name, 'Kael Two');
  assert.equal(r.active.sheet.gender, 'male');
  assert.deepEqual(r.active.skin, { tone: 'ash' });
  assert.equal(storage.saved().characters[0].sheet.name, 'Kael', 'storage still holds the old copy');
  storage.broken.set = false;
  r.update('c0001', { description: 'A wiry outlaw who never sits with his back to a door.' });
  const kept = storage.saved().characters[0];
  assert.deepEqual([kept.sheet.name, kept.sheet.gender, kept.skin], ['Kael Two', 'male', { tone: 'ash' }]);
  assert.equal(new Roster({ storage }).active.sheet.description, 'A wiry outlaw who never sits with his back to a door.');
});

test('the default storage is localStorage, when there is one', () => {
  const storage = memory();
  globalThis.localStorage = storage;
  try {
    make(new Roster({ now: () => START, bypassCooldown: true }), 'Kael');
    assert.equal(storage.saved().characters[0].sheet.name, 'Kael');
  } finally {
    delete globalThis.localStorage;
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.equal(new Roster().storage, null);
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(new Roster().storage, null);
});

test('a corrupt record gives an empty roster without throwing', () => {
  for (const raw of ['{', 'null', '[]', '"text"', '{"characters":[]}', '{"v":"1","characters":[]}', '{"v":0}', '{"v":1.5}']) {
    const storage = memory({ [ROSTER_KEY]: raw });
    const { roster: r } = roster(storage);
    assert.deepEqual(r.characters, [], raw);
    assert.equal(r.readOnly, false);
    assert.equal(make(r, 'Kael').ok, true, 'and is replaced on the next save');
    assert.equal(storage.saved().characters.length, 1);
  }
});

test('a newer version’s record is never written over', () => {
  const raw = JSON.stringify({ v: 2, characters: [saved('c0001')] });
  const storage = memory({ [ROSTER_KEY]: raw });
  const { roster: r } = roster(storage);
  assert.equal(r.readOnly, true);
  assert.deepEqual(r.characters, []);
  const reason = 'Characters were saved by a newer version of the game.';
  assert.deepEqual(r.canCreate(), { ok: false, reason });
  assert.deepEqual(make(r, 'Kael'), { ok: false, reason });
  assert.deepEqual(r.update('c0001', {}), { ok: false, reason });
  assert.deepEqual(r.switchTo('c0001'), { ok: false, reason });
  assert.deepEqual(r.setSkin('c0001', null), { ok: false, reason });
  assert.equal(storage.map.get(ROSTER_KEY), raw);
});

test('migrations chain one version at a time', () => {
  assert.deepEqual(MIGRATIONS, {});
  const record = { v: 1, characters: [] };
  assert.equal(migrate(record), record);
  const order = [];
  const steps = {
    1: (r) => (order.push(r.v), { ...r, added: 'two' }),
    2: (r) => (order.push(r.v), { ...r, more: r.added + ' three' }),
  };
  assert.deepEqual(migrate({ v: 1 }, steps, 3), { v: 3, added: 'two', more: 'two three' });
  assert.deepEqual(order, [1, 2]);
  assert.deepEqual(migrate({ v: 2 }, steps, 3), { v: 3, more: 'undefined three' });
  assert.throws(() => migrate({ v: 1 }, {}, 2));
});

test('cleaning drops broken characters and repairs the rest', () => {
  const good = saved('c0001');
  const clean = cleanRoster({ v: 1, rev: 4, active: 'missing', characters: [
    good,
    null, 'x', [], { ...good }, { ...good, id: 'no' }, { ...good, id: 7 },
    { ...good, id: 'c0002', createdAt: -1 }, { ...good, id: 'c0003', createdAt: 1.5 }, { ...good, id: 'c0004', sheet: [] },
    { ...good, id: 'c0005', switchedAt: 'soon', skin: [1], sheet: { ...good.sheet, race: 'troll', description: 'short' } },
    { ...good, id: 'c0006', skin: { tone: 'ash' } },
    { ...good, id: 'c0007' },
  ] });
  assert.deepEqual(clean.characters.map((c) => c.id), ['c0001', 'c0005', 'c0006']);
  assert.equal(clean.rev, 4);
  assert.equal(clean.active, 'c0001', 'an unknown active id falls back to the first');
  const repaired = clean.characters[1];
  assert.equal(repaired.switchedAt, null);
  assert.equal(repaired.skin, null);
  assert.equal(repaired.sheet.race, null);
  assert.equal(repaired.sheet.description, 'short', 'rule breaches are kept');
  assert.deepEqual(clean.characters[2].skin, { tone: 'ash' });
  assert.equal(cleanRoster({ v: 1, active: 'c0005', characters: clean.characters }).active, 'c0005');
  assert.deepEqual(cleanRoster(undefined), { v: 1, rev: 0, active: null, characters: [] });
  assert.equal(cleanRoster({ rev: -3 }).rev, 0);
});

test('the old lobby name is suggested only when it is a valid name', () => {
  for (const [legacy, suggested] of [['Ash', 'Ash'], ['  Zoë ', 'Zoë'], ['Ash2', ''], ['Al', ''], [null, '']]) {
    const storage = memory(legacy === null ? {} : { 'ascii-realm-name': legacy });
    const { roster: r } = roster(storage);
    assert.equal(r.suggestedName, suggested, String(legacy));
    make(r, 'Kael');
    assert.equal(r.suggestedName, '', 'only for the first character');
    assert.equal(storage.map.get('ascii-realm-name'), legacy ?? undefined, 'never written or deleted');
  }
});

test('two rosters on one storage keep each other’s changes', () => {
  const storage = memory();
  const { roster: a } = roster(storage, { bypassCooldown: true, tag: 'a' });
  const { roster: b } = roster(storage, { bypassCooldown: true, tag: 'b' });
  make(a, 'Kael');
  make(b, 'Bryn');
  assert.deepEqual(storage.saved().characters.map((c) => c.sheet.name), ['Kael', 'Bryn']);
  a.update('c0001a', { gender: 'male' });
  assert.deepEqual(storage.saved().characters.map((c) => c.sheet.name), ['Kael', 'Bryn']);
  assert.equal(storage.saved().rev, 3);
});

test('another tab’s change is picked up from the storage event', () => {
  const storage = memory();
  const events = new EventTarget();
  let changes = 0;
  const { roster: a } = roster(storage, { bypassCooldown: true });
  const { roster: b } = roster(storage, { events, onChange: () => changes++ });
  make(a, 'Kael');
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'ascii-realm-wallet' }));
  assert.equal(b.characters.length, 0);
  events.dispatchEvent(Object.assign(new Event('storage'), { key: ROSTER_KEY }));
  assert.equal(b.active.sheet.name, 'Kael');
  assert.equal(changes, 1);
  // The same record again is not newer.
  events.dispatchEvent(Object.assign(new Event('storage'), { key: ROSTER_KEY }));
  assert.equal(changes, 1);
  const { roster: c } = roster(storage, { events: new EventTarget() });
  assert.equal(c.active.sheet.name, 'Kael', 'onChange is optional');
});

test('a roster whose writes failed does not take an older stored copy', () => {
  const storage = memory();
  const { roster: r } = roster(storage);
  make(r, 'Kael');
  storage.broken.get = true;
  storage.broken.set = true;
  r.update('c0001', { name: 'Kael Two' });
  storage.broken.get = false;
  assert.equal(r.adoptNewer(), false);
  assert.equal(r.active.sheet.name, 'Kael Two');
});

test('ids are c and 16 hex digits from getRandomValues', () => {
  const id = randomId();
  assert.match(id, /^c[0-9a-f]{16}$/);
  assert.notEqual(randomId(), id);
  assert.match(new Roster({ storage: null }).newDraft().id, /^c[0-9a-f]{16}$/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { INTERACT_LINGER, InteractButton, interaction, performInteraction } from '../src/core/interact.js';

const player = (extra = {}) => ({ x: 0, y: 0, air: 0, ...extra });
const mushroomsWith = (node, time = 5) => ({ time, nearby: () => node, interact: () => true });
const firesWith = (fire) => {
  const fires = { radius: null, toggled: 0, nearest: (x, y, radius) => { fires.radius = radius; return fire; },
    toggle: () => { fires.toggled++; return 'out'; } };
  return fires;
};
// A stand-in for the ground-item collection: what is in reach and whether
// the bag has room are all it decides.
const collectionWith = ({ item = null, busy = false, full = false } = {}) => ({
  canCollect: () => !busy,
  interactionTarget: () => (item ? { item } : { resource: null }),
  interact: () => full ? { ok: false, status: 'full', message: 'Inventory full — make room before collecting.' }
    : { ok: true, status: 'picked', message: 'Picked up Arrow.' },
});

test('a ready glowcap in reach offers its spores', () => {
  const target = interaction({ player: player(), mushrooms: mushroomsWith({ cooldown: 2 }), fires: firesWith(null) });
  assert.deepEqual(target, { kind: 'spores', label: 'SPORES', ariaLabel: 'Release spores from the glowcap' });
});

test('a settling glowcap falls through to a fire in reach, or to nothing', () => {
  const fires = firesWith({ x: 3, y: 0 });
  const target = interaction({ player: player(), mushrooms: mushroomsWith({ cooldown: 9 }), fires });
  assert.equal(target.kind, 'fire');
  assert.equal(target.label, 'DOUSE');
  assert.equal(fires.radius, 12, 'the reach putting a fire out uses');
  assert.equal(interaction({ player: player(), mushrooms: mushroomsWith({ cooldown: 9 }), fires: firesWith(null) }), null);
  assert.equal(interaction({ player: player(), mushrooms: mushroomsWith(null), fires: firesWith(null) }), null);
});

test('nothing can be doused while airborne', () => {
  assert.equal(interaction({ player: player({ air: 0.4 }), mushrooms: mushroomsWith(null), fires: firesWith({}) }), null);
});

test('a ground item in reach comes first, named, and a full bag still shows it', () => {
  const context = { player: player(), mushrooms: mushroomsWith({ cooldown: 0 }), fires: firesWith({}),
    collection: collectionWith({ item: { id: 'arrow', count: 3 } }) };
  assert.deepEqual(interaction(context), { kind: 'pickup', label: 'TAKE', ariaLabel: 'Pick up Arrow' });
  assert.deepEqual(performInteraction(context), { kind: 'pickup', result: { ok: true, status: 'picked', message: 'Picked up Arrow.' } });
  const full = { ...context, collection: collectionWith({ item: { id: 'arrow', count: 3 }, full: true }) };
  assert.equal(interaction(full).kind, 'pickup');
  assert.equal(performInteraction(full).result.status, 'full');
  const unknown = { ...context, collection: collectionWith({ item: { id: 'mystery' } }) };
  assert.equal(interaction(unknown).ariaLabel, 'Pick up item');
  // Nothing in reach, or a busy outlaw, falls through to the glowcap.
  assert.equal(interaction({ ...context, collection: collectionWith() }).kind, 'spores');
  assert.equal(interaction({ ...context, collection: collectionWith({ item: { id: 'arrow' }, busy: true }) }).kind, 'spores');
});

test('pressing does what the button offers, checked again at the press', () => {
  const fires = firesWith({ x: 1, y: 0 });
  let released = 0;
  const mushrooms = { time: 5, nearby: () => ({ cooldown: 0 }), interact: () => { released++; return true; } };
  assert.deepEqual(performInteraction({ player: player(), mushrooms, fires }), { kind: 'spores', released: true });
  assert.equal(released, 1);
  const world = {};
  assert.deepEqual(performInteraction({ player: player(), mushrooms: mushroomsWith(null), fires, world }), { kind: 'fire', result: 'out' });
  assert.equal(fires.toggled, 1);
  const empty = firesWith(null);
  assert.equal(performInteraction({ player: player(), mushrooms: mushroomsWith(null), fires: empty, world }), null);
  assert.equal(empty.toggled, 0, 'a late tap never builds a campfire');
  // E never puts out a fire: that is C's.
  assert.equal(interaction({ player: player(), mushrooms: mushroomsWith(null), fires }, { douse: false }), null);
  assert.equal(performInteraction({ player: player(), mushrooms: mushroomsWith(null), fires, world }, { douse: false }), null);
  assert.equal(fires.toggled, 1);
});

// Counts every write the button makes to the page.
function countingButton() {
  const writes = [];
  const button = { dataset: {} };
  for (const name of ['hidden', 'textContent']) {
    let value = name === 'hidden' ? true : 'SPORES';
    Object.defineProperty(button, name, { get: () => value, set: (v) => { writes.push(name); value = v; } });
  }
  button.setAttribute = (name, value) => { writes.push(name); button[`@${name}`] = value; };
  return { button, writes };
}

test('the button writes to the page only when its target changes and lingers briefly', () => {
  const { button, writes } = countingButton();
  const shown = new InteractButton(button);
  const fire = { kind: 'fire', label: 'DOUSE', ariaLabel: 'Put out the fire' };
  shown.update(null, 0);
  assert.deepEqual(writes, [], 'already hidden');
  shown.update(fire, 1);
  assert.deepEqual(writes, ['hidden', 'textContent', 'aria-label']);
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'DOUSE');
  assert.equal(button['@aria-label'], 'Put out the fire');
  assert.equal(button.dataset.kind, 'fire');
  assert.equal(shown.kind, 'fire');
  for (let i = 0; i < 60; i++) shown.update({ ...fire }, 1 + i / 60);
  assert.equal(writes.length, 3, 'an unchanged target costs nothing per frame');
  const last = 1 + 59 / 60;
  shown.update(null, last + INTERACT_LINGER / 2);
  assert.equal(button.hidden, false, 'lingers at the edge of reach');
  shown.update(null, last + INTERACT_LINGER + 0.01);
  assert.equal(button.hidden, true);
  assert.equal(shown.kind, null);
  assert.equal(writes.length, 4);
  shown.update({ kind: 'spores', label: 'SPORES', ariaLabel: 'Release spores from the glowcap' }, 10);
  assert.equal(button.textContent, 'SPORES');
  assert.equal(INTERACT_LINGER, 0.3);
});

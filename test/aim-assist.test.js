import assert from 'node:assert/strict';
import test from 'node:test';
import { AIM_ASSIST_HALF_ANGLE, CAST_ASSIST_FALLBACK, STRIKE_ASSIST_SLACK, assistTarget, castAssist, castAssistRange,
  strikeAssist } from '../src/core/aim-assist.js';
import { toCells, toMetres } from '../src/entities/monsters.js';

const DEG = Math.PI / 180;
// A foe `metres` away at `angle` from straight down the screen (heading 0).
const foeAt = (metres, angle, extra = {}) => {
  const [dx, dy] = toCells(Math.sin(angle) * metres, Math.cos(angle) * metres);
  return { x: dx, y: dy, alive: true, state: 'chase', ...extra };
};
const player = (heading = 0) => ({ x: 0, y: 0, heading });

test('the nearest living foe inside the cone is chosen with the heading that faces it', () => {
  const foe = foeAt(1.2, 20 * DEG);
  const found = assistTarget(player(), [foe], { range: 2 });
  assert.equal(found.foe, foe);
  assert.ok(Math.abs(found.heading - 20 * DEG) < 1e-9);
  assert.ok(Math.abs(found.distance - 1.2) < 1e-9);
  assert.equal(AIM_ASSIST_HALF_ANGLE, 30 * DEG);
});

test('the cone edge is 30 degrees either side of the facing', () => {
  assert.ok(assistTarget(player(), [foeAt(1, 30 * DEG - 1e-9)], { range: 2 }));
  assert.ok(assistTarget(player(), [foeAt(1, -30 * DEG + 1e-9)], { range: 2 }));
  assert.equal(assistTarget(player(), [foeAt(1, 31 * DEG)], { range: 2 }), null);
  assert.equal(assistTarget(player(), [foeAt(1, 180 * DEG)], { range: 2 }), null, 'a foe behind is skipped');
  assert.ok(assistTarget(player(), [foeAt(1, 40 * DEG)], { range: 2, halfAngle: 45 * DEG }), 'the width can change');
});

test('range counts the foe body, and dead or rising foes are skipped', () => {
  assert.equal(assistTarget(player(), [foeAt(2.5, 0)], { range: 2 }), null);
  assert.ok(assistTarget(player(), [foeAt(2.5, 0, { kind: { radius: 0.6 } })], { range: 2 }));
  assert.equal(assistTarget(player(), [foeAt(1, 0, { alive: false })], { range: 2 }), null);
  assert.equal(assistTarget(player(), [foeAt(1, 0, { state: 'rise' })], { range: 2 }), null);
  assert.equal(assistTarget(player(), [], { range: 2 }), null);
});

test('the angle wraps across the back of the circle', () => {
  const foe = foeAt(1, -Math.PI + 0.2);
  const found = assistTarget(player(Math.PI), [foe], { range: 2 });
  assert.equal(found.foe, foe);
});

test('the nearest foe wins over one closer to straight ahead, and a tie goes to the smaller angle', () => {
  const near = foeAt(1, 25 * DEG), ahead = foeAt(1.5, 0);
  assert.equal(assistTarget(player(), [ahead, near], { range: 2 }).foe, near);
  // Both exactly 5 m away (3-4-5 in metres): the one straight ahead wins.
  const wide = { x: 65, y: 26, alive: true }, straight = { x: 0, y: 32.5, alive: true };
  assert.equal(assistTarget(player(), [wide, straight], { range: 6, halfAngle: Math.PI / 4 }).foe, straight);
  assert.equal(assistTarget(player(), [straight, wide], { range: 6, halfAngle: Math.PI / 4 }).foe, straight);
});

test('offsets in columns are converted to metres as the monsters measure them', () => {
  const foe = { x: 10, y: 0, alive: true };
  const [mx] = toMetres(10, 0);
  const found = assistTarget(player(Math.PI / 2), [foe], { range: 50 });
  assert.ok(Math.abs(found.distance - mx) < 1e-9);
  assert.ok(Math.abs(found.heading - Math.PI / 2) < 1e-9);
});

test('a strike looks a stride beyond the weapon reach', () => {
  const foe = foeAt(0.95 + STRIKE_ASSIST_SLACK - 0.01, 0);
  assert.equal(strikeAssist(player(), [foe]).foe, foe);
  assert.equal(strikeAssist({ ...player(), feel: { reach: 0.5 } }, [foe]), null);
});

test('a cast looks as far as the spell flies, and supportive spells never assist', () => {
  const spell = { nodes: {
    root: { steps: [{ op: 'projectile', args: { mr: '20' } }, { op: 'aura', args: {} }] },
    far: { steps: [{ op: 'missile', args: { maxrange: 30 } }, { op: 'projectile', args: { mr: '<modifier.range>' } }] },
    bare: {},
  } };
  assert.equal(castAssistRange(spell), 30);
  assert.equal(castAssistRange({ nodes: { root: { steps: [{ op: 'self' }] } } }), CAST_ASSIST_FALLBACK);
  assert.equal(castAssistRange(undefined), CAST_ASSIST_FALLBACK);
  const foe = foeAt(25, 0);
  assert.equal(castAssist(player(), [foe], spell).foe, foe);
  assert.equal(castAssist(player(), [foeAt(35, 0)], spell), null);
  assert.equal(castAssist(player(), [foe], { ...spell, supportive: true }), null);
  assert.equal(castAssist(player(), [foe], undefined), null);
});

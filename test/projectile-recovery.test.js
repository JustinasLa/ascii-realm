import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCALE, TILT } from '../src/entities/rig.js';
import { GLYPHS, glyph } from '../src/render/glyphs.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { Projectiles } from '../src/world/projectiles.js';
import { ASPECT } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const PHYSICAL = ['arrow', 'spear', 'javelin'];
const WEAPON = { arrow: 'bow', spear: 'spear', javelin: 'javelin' };
const OPEN_WORLD = { propsIn: () => [] };
const COLS_PER_METRE = SCALE / ASPECT;
const ROWS_PER_METRE = SCALE * TILT;

function shot(kind, overrides = {}) {
  return {
    type: 'projectile', weapon: WEAPON[kind] ?? 'staff', material: 'bronze',
    x: 10, y: 20, h: SCALE * 0.75,
    dx: COLS_PER_METRE, dy: 0,
    projectile: { kind, speed: 12, gravity: 5, lifetime: 3 },
    ...overrides,
  };
}

function landAt(projectiles, kind, x, y, overrides = {}) {
  assert.ok(projectiles.launch(shot(kind, {
    x: x - 40, y: y - 5, aimTarget: { x, y }, ...overrides,
  })), `${kind} launches`);
  projectiles.update(10, OPEN_WORLD);
  assert.equal(projectiles.list.length, 0, `${kind} completes its flight`);
  return projectiles.landed.at(-1);
}

function offset(position, xMetres, yMetres) {
  return { x: position.x + xMetres * COLS_PER_METRE, y: position.y + yMetres * ROWS_PER_METRE };
}

function bufferRenderer(cols = 128, rows = 80) {
  return withLayers({
    cols, rows, calls: [],
    fg: new Uint8ClampedArray(cols * rows * 4),
    bg: new Uint8ClampedArray(cols * rows * 4),
    put(x, y, g, r, gg, b) {
      assert.ok([x, y, g, r, gg, b].every(Number.isFinite), 'static sprite cells are finite');
      assert.ok(Number.isInteger(g) && g >= 0 && g < GLYPHS.length, 'static sprite glyph is valid');
      this.calls.push({ x, y, g });
      AsciiRenderer.prototype.put.call(this, x, y, g, r, gg, b);
    },
  });
}

for (const kind of PHYSICAL) {
  test(`${kind} remains at the exact cursor impact with its material until collected`, () => {
    const projectiles = new Projectiles();
    const target = { x: 93.375, y: 37.625 };
    const item = landAt(projectiles, kind, target.x, target.y);
    assert.equal(projectiles.landed.length, 1);
    assert.equal(projectiles.events.length, 1);
    const impact = projectiles.events[0];
    assert.equal(item.x, target.x);
    assert.equal(item.y, target.y);
    assert.equal(item.h, 0);
    assert.equal(item.prop, null);
    assert.equal(item.kind, kind);
    assert.equal(item.weaponId, WEAPON[kind]);
    assert.equal(item.material, 'bronze');
    assert.ok(item.id != null, 'the item has a stable identity');
    assert.equal(item.id, impact.id);
    assert.deepEqual([item.x, item.y, item.h], [impact.x, impact.y, impact.h]);
    assert.ok([item.orientation.x, item.orientation.y].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(item.orientation.x, item.orientation.y) - 1) < 1e-10);
    const fixed = { ...item, orientation: { ...item.orientation } };
    for (const dt of [1 / 60, 5, 60, 3600]) projectiles.update(dt, OPEN_WORLD);
    assert.equal(projectiles.landed[0], item, 'the same item stays in the world');
    assert.deepEqual(item, fixed, 'position, orientation, and item data never decay after landing');
    assert.equal(projectiles.events.length, 1, 'a landed item cannot impact again');
    assert.deepEqual(projectiles.collectNear(target.x, target.y), [item]);
    assert.equal(projectiles.landed.length, 0);
    assert.deepEqual(projectiles.collectNear(target.x, target.y), [], 'one impact yields one collectible item');
  });

  test(`${kind} stays embedded at its actual prop contact height`, () => {
    const prop = {
      kind: kind === 'javelin' ? 'rock' : 'tree', x: 24, y: 20, footW: 2.4, footH: 1.2,
      cells: [{ dx: 0, dy: kind === 'javelin' ? -6 : -35 }],
    };
    const world = { propsIn: () => [prop] };
    const height = kind === 'javelin' ? 3 : 12;
    const projectiles = new Projectiles();
    projectiles.launch(shot(kind, {
      h: height, projectile: { kind, speed: 30, gravity: 0, lifetime: 1 },
    }));
    projectiles.update(0.1, world);
    assert.equal(projectiles.list.length, 0);
    assert.equal(projectiles.landed.length, 1);
    const item = projectiles.landed[0];
    const impact = projectiles.events[0];
    assert.equal(item.prop, prop);
    assert.equal(item.h, height, 'the shaft remains at the struck height rather than falling to the ground');
    assert.deepEqual([item.x, item.y, item.h], [impact.x, impact.y, impact.h]);
    assert.ok(item.x < prop.x && item.x > prop.x - prop.footW, 'the first contact embeds in the near side');
    assert.equal(item.material, 'bronze');
    const location = [item.x, item.y, item.h, item.orientation.x, item.orientation.y];
    projectiles.update(600, world);
    assert.deepEqual([item.x, item.y, item.h, item.orientation.x, item.orientation.y], location);
    assert.equal(projectiles.events.length, 1);
    assert.equal(projectiles.landedDrawables()[0].depth, prop.y, 'the embedded shaft is sorted with its supporting prop');
    assert.deepEqual(projectiles.collectNear(item.x, item.y), [item], 'collection uses the world footprint at the prop');
    assert.deepEqual(projectiles.collectNear(item.x, item.y), []);
  });
}

test('immediate ground contacts drop exactly once, and subsequent launches receive distinct identities', () => {
  const projectiles = new Projectiles();
  const ids = [];
  for (const kind of PHYSICAL) {
    projectiles.launch(shot(kind, { x: 50, y: 40, h: 0, aimTarget: { x: 50, y: 40 } }));
    projectiles.update(1, OPEN_WORLD);
    const item = projectiles.landed.at(-1);
    assert.equal(item.kind, kind);
    assert.deepEqual([item.x, item.y, item.h], [50, 40, 0]);
    ids.push(item.id);
  }
  assert.equal(new Set(ids).size, PHYSICAL.length);
  assert.equal(projectiles.events.length, PHYSICAL.length);
  projectiles.update(100, OPEN_WORLD);
  assert.equal(projectiles.landed.length, PHYSICAL.length);
  assert.equal(projectiles.events.length, PHYSICAL.length);
  assert.equal(projectiles.collectNear(50, 40).length, PHYSICAL.length);
  const next = landAt(projectiles, 'arrow', 50, 40);
  assert.ok(!ids.includes(next.id), 'collecting an item does not reuse its identity');
});

test('synthetic launches without material metadata recover as steel', () => {
  const projectiles = new Projectiles();
  const item = landAt(projectiles, 'spear', 80, 40, { material: undefined });
  assert.equal(item.material, 'steel');
  assert.equal(projectiles.events[0].material, 'steel');
});

test('magic impacts have effects but leave no recoverable item', () => {
  const prop = { kind: 'tree', x: 24, y: 20, footW: 2.4, footH: 1.2 };
  for (const ground of [false, true]) {
    const projectiles = new Projectiles();
    projectiles.launch(shot('magic', {
      h: ground ? 1 : 12,
      projectile: { kind: 'magic', speed: 30, gravity: ground ? 20 : 0, lifetime: 1 },
    }));
    projectiles.update(1, ground ? OPEN_WORLD : { propsIn: () => [prop] });
    assert.equal(projectiles.list.length, 0);
    assert.equal(projectiles.events.length, 1);
    assert.equal(projectiles.events[0].kind, 'magic');
    assert.equal(projectiles.events[0].prop, ground ? null : prop);
    assert.deepEqual(projectiles.landed, []);
    assert.deepEqual(projectiles.collectNear(projectiles.events[0].x, projectiles.events[0].y), []);
    assert.deepEqual(projectiles.landedDrawables(), []);
  }
});

test('lifetime and range expiry in the air do not invent collectible ground impacts', () => {
  for (const kind of PHYSICAL) {
    for (const limit of [{ lifetime: 0.01 }, { lifetime: 3, range: 0.01 }]) {
      const projectiles = new Projectiles();
      const flight = projectiles.launch(shot(kind, {
        h: 100, projectile: { kind, speed: 12, gravity: 0, ...limit },
      }));
      projectiles.update(10, OPEN_WORLD);
      assert.ok(flight.h > 0);
      assert.equal(projectiles.list.length, 0);
      assert.deepEqual(projectiles.events, []);
      assert.deepEqual(projectiles.landed, []);
      assert.deepEqual(projectiles.collectNear(flight.x, flight.y), []);
    }
  }
});

test('collection radius measures metres in both projected ground axes', () => {
  const centre = { x: 100, y: 40 };
  for (const [xMetres, yMetres, near] of [
    [0.74, 0, true], [0, 0.74, true], [0.5, 0.5, true],
    [0.76, 0, false], [0, 0.76, false], [0.6, 0.6, false],
  ]) {
    const projectiles = new Projectiles();
    const item = landAt(projectiles, 'arrow', centre.x, centre.y);
    const player = offset(centre, xMetres, yMetres);
    assert.deepEqual(projectiles.collectNear(player.x, player.y), near ? [item] : [],
      `offset ${xMetres}m, ${yMetres}m obeys a circular 0.75m reach`);
    assert.equal(projectiles.landed.length, near ? 0 : 1);
  }
});

test('a fast walking segment collects along its path without collecting beyond either end or sideways reach', () => {
  const centre = { x: 100, y: 40 };
  const projectiles = new Projectiles();
  const through = landAt(projectiles, 'arrow', centre.x, centre.y);
  const near = offset(centre, 0, 0.74);
  const nearItem = landAt(projectiles, 'spear', near.x, near.y);
  const side = offset(centre, 0, 0.76);
  const sideItem = landAt(projectiles, 'javelin', side.x, side.y);
  const beyond = offset(centre, 2.76, 0);
  const beyondItem = landAt(projectiles, 'arrow', beyond.x, beyond.y);
  const before = offset(centre, -2.76, 0);
  const beforeItem = landAt(projectiles, 'spear', before.x, before.y);
  const start = offset(centre, -2, 0);
  const end = offset(centre, 2, 0);
  assert.deepEqual(projectiles.collectNear(end.x, end.y, 0.75, start), [through, nearItem]);
  assert.deepEqual(projectiles.landed, [sideItem, beyondItem, beforeItem]);
  assert.deepEqual(projectiles.collectNear(end.x, end.y, 0.75, start), [], 'the same swept segment cannot collect twice');
});

test('a diagonal walked segment uses the same ground metric as its endpoints', () => {
  const centre = { x: 100, y: 40 };
  const projectiles = new Projectiles();
  const item = landAt(projectiles, 'javelin', centre.x, centre.y);
  const start = offset(centre, -2, -2);
  const end = offset(centre, 2, 2);
  assert.deepEqual(projectiles.collectNear(end.x, end.y, 0.75, start), [item]);
});

test('independent collectors receive each landed item once while far items remain', () => {
  const projectiles = new Projectiles();
  const first = landAt(projectiles, 'arrow', 80, 40);
  const second = landAt(projectiles, 'spear', 80, 40);
  const distant = landAt(projectiles, 'javelin', 120, 40);
  assert.deepEqual(projectiles.collectNear(80, 40), [first, second]);
  assert.deepEqual(projectiles.collectNear(80, 40), [], 'a second collector cannot receive the same item');
  assert.deepEqual(projectiles.landed, [distant]);
  assert.deepEqual(projectiles.collectNear(120, 40), [distant]);
  assert.deepEqual(projectiles.landed, []);
});

test('landed shafts draw without a flight trail and remain unchanged after time passes', () => {
  for (const kind of PHYSICAL) {
    const projectiles = new Projectiles();
    const item = landAt(projectiles, kind, 100, 40);
    const renderer = bufferRenderer();
    const view = { x0: 0, y0: 0, cols: renderer.cols, rows: renderer.rows };
    const background = renderer.bg.slice();
    const drawables = projectiles.landedDrawables();
    assert.equal(drawables.length, 1);
    assert.equal(drawables[0].depth, item.y, 'ground shafts sort by their ground contact');
    drawables[0].draw(renderer, view);
    assert.ok(renderer.calls.length > 1, 'the settled projectile keeps its shaft and head');
    assert.ok(!renderer.calls.some((cell) => cell.g === glyph('.')), 'settled shafts have no moving dotted trail');
    assert.ok(renderer.fg.some((value, i) => i % 4 === 3 && value > 0), 'the shaft renders into real foreground cells');
    assert.deepEqual(renderer.bg, background);
    const fixed = renderer.fg.slice();
    projectiles.update(600, OPEN_WORLD);
    const later = bufferRenderer();
    projectiles.draw(later, view);
    assert.deepEqual(later.fg, fixed, 'the composite draw keeps the exact same settled image');
    const flying = bufferRenderer();
    projectiles.drawFlying(flying, view);
    assert.equal(flying.calls.length, 0, 'flight drawing does not bypass settled painter ordering');
    projectiles.collectNear(item.x, item.y);
    const collected = bufferRenderer();
    projectiles.draw(collected, view);
    assert.equal(collected.calls.length, 0, 'a collected shaft leaves the scene');
  }
});

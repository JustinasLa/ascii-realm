import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { PROP_CATALOG, PROP_KINDS, propDefinition } from '../src/world/prop-catalog.js';
import { blocks, createProp, drawProp } from '../src/world/props.js';
import { PILLAR_DEFINITIONS } from '../src/world/architecture-pillars.js';
import { reflector } from '../src/world/reflection.js';
import { GRASS, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const expectedKinds = [
  'tree', 'rock', 'standing-stone', 'bush', 'pine', 'stump', 'log', 'flowers', 'mushrooms', 'pale-caps', 'reeds',
  'crate', 'barrel', 'fence', 'tent', 'campfire', 'signpost',
  'stone-gate', 'stone-tower', 'column-short', 'column-broken', 'column-tall',
  'wall-low', 'wall-broken', 'rubble-small', 'rubble-large',
  ...PILLAR_DEFINITIONS.map(p => p.kind),
];
const decorativeKinds = new Set(['flowers', 'mushrooms', 'pale-caps', 'reeds']);

test('catalog exposes the supported scenery kinds and their palette and collision metadata', () => {
  const kinds = PROP_CATALOG.map(({ kind }) => kind);
  assert.equal(new Set(kinds).size, kinds.length, 'palette kinds must be unique');
  assert.deepEqual([...kinds].sort(), [...expectedKinds].sort());
  assert.deepEqual([...PROP_KINDS].sort(), [...expectedKinds].sort());
  for (const definition of PROP_CATALOG) {
    const { kind, label, symbol, group, solid } = definition;
    assert.equal(typeof label, 'string');
    assert.ok(label.trim().length > 0, `${kind} has a readable palette label`);
    assert.equal(typeof symbol, 'string');
    assert.ok(symbol.trim().length > 0, `${kind} has a palette symbol`);
    assert.equal(typeof group, 'string');
    assert.ok(group.trim().length > 0, `${kind} has a palette group`);
    assert.equal(solid, !decorativeKinds.has(kind), `${kind} collision metadata`);
    assert.deepEqual(propDefinition(kind), definition);
  }
  for (const kind of ['flower', 'dragon', '', undefined]) {
    assert.equal(PROP_KINDS.has(kind), false);
    assert.equal(propDefinition(kind), undefined);
  }
});

test('every catalog prop survives placement, erase history, and JSON save/load', async (t) => {
  for (const { kind, solid } of PROP_CATALOG) {
    await t.test(kind, () => {
      const world = new World(42);
      const scene = new Scenery(world);
      const { x, y } = world.spawn;
      // Paint the test point explicitly so water and procedural terrain cannot
      // hide whether the prop itself affects play-mode collision.
      scene.paint(x, y, 0, WATER);
      scene.paint(x, y, 0, GRASS);
      assert.equal(world.typeAt(x, y), GRASS);
      assert.equal(world.isWalkable(x, y), true);

      const prop = scene.place(kind, x, y, { scale: 1.5, seed: 27 });
      const original = structuredClone(prop);
      const anchorWalkable = prop.collisionPolygons ? !blocks(prop, x, y) : !solid || kind === 'stone-gate';
      assert.equal(prop.solid, solid);
      assert.equal(world.isWalkable(x, y), anchorWalkable);
      assert.ok(world.propsIn(x, y, x, y).some(({ id }) => id === prop.id), 'placed prop is visible to world queries');

      assert.equal(scene.erase(x, y, 0), 1);
      assert.equal(world.addedProps.has(prop.id), false);
      assert.equal(world.isWalkable(x, y), true);
      assert.equal(scene.undo(), true);
      assert.deepEqual(world.addedProps.get(prop.id), original);
      assert.equal(world.isWalkable(x, y), anchorWalkable);
      assert.equal(scene.redo(), true);
      assert.equal(world.addedProps.has(prop.id), false);
      assert.equal(world.isWalkable(x, y), true);

      assert.equal(scene.undo(), true, 'undo erase restores the prop again');
      assert.equal(scene.undo(), true, 'undo placement removes the prop');
      assert.equal(world.addedProps.has(prop.id), false);
      assert.equal(scene.redo(), true, 'redo placement rebakes the same appearance');
      assert.deepEqual(world.addedProps.get(prop.id), original);

      const saved = JSON.parse(JSON.stringify(scene.serialize()));
      const restoredWorld = new World(42);
      const restoredScene = new Scenery(restoredWorld);
      assert.equal(restoredScene.load(saved), true);
      assert.deepEqual(restoredScene.serialize(), saved);
      assert.deepEqual(restoredWorld.addedProps.get(prop.id), original, 'load preserves glyphs, colors, footprint, solid flag, id, scale and seed');
      assert.equal(restoredWorld.isWalkable(x, y), anchorWalkable);
      assert.equal(restoredScene.undo(), true, 'loading a scene is undoable');
      assert.equal(restoredWorld.addedProps.has(prop.id), false);
      assert.equal(restoredScene.redo(), true);
      assert.deepEqual(restoredWorld.addedProps.get(prop.id), original);
    });
  }
});

test('decorative scenery allows movement on grass and through painted shallow water', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const { x, y } = world.spawn;
  for (const kind of decorativeKinds) scene.place(kind, x, y, { scale: 3, seed: 19 });
  scene.paint(x, y, 0, GRASS);
  assert.equal(world.isWalkable(x, y), true);
  scene.paint(x, y, 0, WATER);
  assert.equal(world.isWalkable(x, y), true);
  assert.ok(world.waterDepthAt(x, y) > 0);
  assert.equal(scene.undo(), true);
  assert.equal(world.typeAt(x, y), GRASS);
  assert.equal(world.isWalkable(x, y), true);
});

test('viewport queries retain tall props that reflect from above or draw their canopy from below', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  for (const kind of ['tree', 'pine']) {
    const height = -Math.min(...createProp(kind, 0, 0, { scale: 3, seed: 42 }).cells.map(({ dy }) => dy));
    const y = kind === 'tree' ? -128.5 : -height + 8.5;
    const above = scene.place(kind, 20.5, y, { scale: 3, seed: 42 });
    assert.ok(above.y < view.y0 - view.rows, `${kind} base is well above the viewport`);
    const queried = world.propsInView(view);
    assert.ok(queried.some(({ id }) => id === above.id), `${kind} reflection source stays queryable`);
    const renderer = withLayers({
      cols: view.cols,
      rows: view.rows,
      mask: new Uint8Array(view.cols * view.rows).fill(WATER),
      fg: new Float32Array(view.cols * view.rows * 4),
    });
    drawProp(renderer, view, queried.find(({ id }) => id === above.id), reflector(0, view));
    assert.ok(renderer.fg.some((value, index) => index % 4 === 3 && value > 0), `${kind} writes reflected glyphs into visible water`);

    const below = scene.place(kind, 20.5, view.rows + height - 8.5, { scale: 3, seed: 42 });
    const fromBelow = world.propsInView(view).find(({ id }) => id === below.id);
    assert.ok(fromBelow, `${kind} below the viewport remains queryable`);
    const visible = [];
    drawProp({ put(sx, sy, ...cell) {
      if (sx >= 0 && sy >= 0 && sx < view.cols && sy < view.rows) visible.push(cell);
    }, putBg() {} }, view, fromBelow);
    assert.ok(visible.length > 0, `${kind} canopy draws in the viewport through the default renderer writer`);
  }
});

test('pale caps just above the view reflect into the water below them', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const view = { x0: 0, y0: 0, cols: 40, rows: 24 };
  const caps = scene.place('pale-caps', 20.5, -2.5, { seed: 7 });
  const queried = world.propsInView(view).find(({ id }) => id === caps.id);
  assert.ok(queried, 'the clump above the view stays queryable');
  const layer = () => withLayers({ cols: view.cols, rows: view.rows, mask: new Uint8Array(view.cols * view.rows).fill(WATER),
    fg: new Float32Array(view.cols * view.rows * 4) });
  const direct = layer();
  drawProp(direct, view, queried);
  assert.ok(direct.fg.every((value, index) => index % 4 !== 3 || !value), 'the clump itself is off screen');
  const renderer = layer();
  drawProp(renderer, view, queried, reflector(0, view));
  assert.ok(renderer.fg.some((value, index) => index % 4 === 3 && value > 0), 'its reflection reaches the visible water');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { Scenery } from '../src/editor/scenery.js';
import { makePillarGeometry, PILLAR_DEFINITIONS } from '../src/world/architecture-pillars.js';
import { blocks, createProp, rebuildProp } from '../src/world/props.js';
import { ASPECT, World } from '../src/world/world.js';

test('five distinct physical ruin recipes exist for each base shape', () => {
  for (const shape of ['square', 'circular']) {
    const definitions = PILLAR_DEFINITIONS.filter(p => p.kind.startsWith(`column-${shape}-`));
    assert.equal(definitions.length, 5);
    const silhouettes = new Set();
    for (const { kind } of definitions) {
      const p = createProp(kind, 0, 0, { seed: 42 });
      assert.deepEqual(p, createProp(kind, 0, 0, { seed: 42 }));
      assert.notDeepEqual(p.cells, createProp(kind, 0, 0, { seed: 72 }).cells);
      assert.ok(p.cells.length > 200);
      silhouettes.add(p.cells.map(c => `${c.dx},${c.dy}`).join(';'));
      const { mesh } = makePillarGeometry(kind, mulberry32(42), 42);
      for (const triangle of mesh.triangles) {
        assert.ok(triangle.points.flat().every(Number.isFinite));
        assert.ok(triangle.normal.every(Number.isFinite));
      }
    }
    assert.equal(silhouettes.size, 5, 'damage changes the silhouettes, not just colors or random seeds');
    const collapsed = createProp(`column-${shape}-collapsed`, 0, 0, { seed: 42, rotation: 0 });
    const snapped = createProp(`column-${shape}-snapped`, 0, 0, { seed: 42, rotation: 0 });
    assert.ok(-collapsed.bounds.minY < -snapped.bounds.minY * 0.65, 'collapsed pillar retains only a low stump');
    assert.ok(collapsed.bounds.maxX - collapsed.bounds.minX > snapped.bounds.maxX - snapped.bounds.minX,
      'collapsed shaft lies beside the base');
  }
});

test('the new square plinth is physically square and its default yaw is 45 degrees', () => {
  const { groundFootprints } = makePillarGeometry('column-square', mulberry32(42), 42);
  const base = groundFootprints[0];
  const extent = axis => Math.max(...base.map(p => p[axis])) - Math.min(...base.map(p => p[axis]));
  assert.ok(Math.abs(extent(0) - extent(1)) < 0.01);
  assert.ok(base.length <= 8, 'square sides with bevelled corners');
  const p = createProp('column-square', 0, 0, { seed: 42, variant: 0 });
  assert.equal(p.rotation, 45);
  const angle = Math.PI / 4;
  for (const [i, [x, z]] of base.entries()) {
    const xx = Math.cos(angle) * x + Math.sin(angle) * z;
    const zz = -Math.sin(angle) * x + Math.cos(angle) * z;
    assert.ok(Math.hypot(p.collisionPolygons[0][i][0] - xx / ASPECT,
      p.collisionPolygons[0][i][1] + 0.45 * zz) < 1e-8);
  }
  const basePoints = p.collisionPolygons[0];
  const minX = Math.min(...basePoints.map(p => p[0])), maxX = Math.max(...basePoints.map(p => p[0]));
  const minY = Math.min(...basePoints.map(p => p[1])), maxY = Math.max(...basePoints.map(p => p[1]));
  assert.ok(Math.abs(minX + maxX) < 0.01 && Math.abs(minY + maxY) < 0.01,
    'the turned plinth forms a balanced diamond around its placement point');
  assert.ok(p.cells.some(c => c.dy > 0), 'the near half of the footing is fully drawn');
});

test('new pillars preserve orientation and collision through scene IO, undo, and scaling', () => {
  for (const { kind, defaultRotation } of PILLAR_DEFINITIONS) {
    const world = new World(42);
    const scene = new Scenery(world);
    const p = scene.place(kind, 0, 0, { seed: 19, scale: 1.4 });
    assert.equal(p.rotation, defaultRotation);
    for (const polygon of p.collisionPolygons) {
      const [x, y] = polygon.reduce(([x, y], p) => [x + p[0] / polygon.length, y + p[1] / polygon.length], [0, 0]);
      assert.equal(blocks(p, x, y), true);
      for (const [dx, dy] of polygon) {
        assert.ok(Math.abs(dx) <= p.footW + 1e-8 && Math.abs(dy) <= p.footH + 1e-8);
      }
    }
    const saved = JSON.parse(JSON.stringify(scene.serialize()));
    scene.load(saved);
    assert.deepEqual(world.addedProps.get(p.id), p);
    scene.undo();
    scene.undo();
    assert.equal(world.addedProps.size, 0);
    scene.redo();
    assert.deepEqual(world.addedProps.get(p.id), p);
  }
});

test('explicit zero yaw survives rebuilding and scene loading instead of applying the square default', () => {
  const scene = new Scenery(new World(42));
  const p = scene.place('column-square-snapped', 0, 0, { seed: 42, rotation: 0 });
  assert.equal(p.rotation, 0);
  assert.deepEqual(rebuildProp({ make: 'prop', kind: p.kind, x: 0, y: 0,
    options: { seed: 42, rotation: 0 } }).cells, p.cells);
  scene.load(JSON.parse(JSON.stringify(scene.serialize())));
  assert.deepEqual(scene.world.addedProps.get(p.id), p);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { blocks, createProp, drawProp, propInView } from '../src/world/props.js';
import { CHUNK_SIZE, World } from '../src/world/world.js';

const kinds = ['stone-gate', 'stone-tower', 'column-short', 'column-broken', 'column-tall',
  'wall-low', 'wall-broken', 'rubble-small', 'rubble-large'];

// Exercise the real world indexes and terrain/grass lifecycle without unrelated
// procedural obstacles obscuring whether the placed gate is walkable.
class ArchitectureWorld extends World {
  findSpawn() { return { x: 0.5, y: 0.5 }; }
  generate(cx, cy) {
    const chunk = super.generate(cx, cy);
    chunk.props = [];
    return chunk;
  }
}

const centre = (prop, rect) => ({
  x: prop.x + (rect.minX + rect.maxX) / 2,
  y: prop.y + (rect.minY + rect.maxY) / 2,
});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ~= ${expected}`);

test('gate piers block while the full central path stays open across seeds, sizes and variation versions', () => {
  for (const seed of [0, 1, 42, 0xffffffff]) {
    for (const variant of [0, 1]) {
      const original = createProp('stone-gate', -3.25, 64.5, { seed, variant });
      assert.equal(original.collisionRects.length, 2);
      for (const scale of [0.25, 0.75, 1, 2, 3]) {
        const prop = createProp('stone-gate', -3.25, 64.5, { seed, variant, scale });
        assert.equal(prop.collisionRects.length, 2);
        for (let i = 0; i < prop.collisionRects.length; i++) {
          const rect = prop.collisionRects[i];
          for (const key of ['minX', 'maxX', 'minY', 'maxY']) near(rect[key], original.collisionRects[i][key] * scale);
          assert.ok(rect.minX < rect.maxX && rect.minY < rect.maxY);
          assert.ok(rect.minX >= -prop.footW && rect.maxX <= prop.footW);
          assert.ok(rect.minY >= -prop.footH && rect.maxY <= prop.footH);
          const point = centre(prop, rect);
          assert.equal(blocks(prop, point.x, point.y), true, `pier at ${seed}/${variant}/${scale}`);
          // Rectangle corners must not inherit the old ellipse's curved gaps.
          assert.equal(blocks(prop, prop.x + rect.minX * 0.99 + rect.maxX * 0.01,
            prop.y + rect.minY * 0.99 + rect.maxY * 0.01), true);
        }
        const [left, right] = [...prop.collisionRects].sort((a, b) => a.minX - b.minX);
        assert.ok(left.maxX < 0 && right.minX > 0, 'piers leave the anchor inside the opening');
        for (let step = -10; step <= 10; step++) {
          const y = prop.y + step * prop.footH / 5;
          for (const x of [prop.x, prop.x + left.maxX / 2, prop.x + right.minX / 2]) {
            assert.equal(blocks(prop, x, y), false, 'the opening is a through path');
          }
        }
        assert.equal(blocks(prop, prop.x + prop.footW + 0.1, prop.y), false);
      }
    }
  }
});

test('seeded width and height variation scale collision with the artwork', () => {
  for (const kind of kinds) {
    const raw = createProp(kind, 0, 0, { seed: 19, variant: 0 });
    const varied = createProp(kind, 0, 0, { seed: 19, variant: 1, scale: 1.5 });
    if (!raw.collisionRects) continue;
    assert.equal(varied.collisionRects.length, raw.collisionRects.length);
    raw.collisionRects.forEach((rect, i) => {
      for (const key of ['minX', 'maxX']) near(varied.collisionRects[i][key], rect[key] * varied.footW / raw.footW);
      for (const key of ['minY', 'maxY']) near(varied.collisionRects[i][key], rect[key] * varied.footH / raw.footH);
    });
  }
});

test('composite collision respects nonsolid and chopped props and preserves ellipse fallback', () => {
  const prop = { kind: 'stone-gate', x: 4, y: -8, footW: 5, footH: 2,
    collisionRects: [{ minX: -5, maxX: -2, minY: -2, maxY: 2 }, { minX: 2, maxX: 5, minY: -2, maxY: 2 }] };
  assert.equal(blocks(prop, 0, -7), true);
  assert.equal(blocks(prop, 4, -8), false);
  assert.equal(blocks({ ...prop, solid: false }, 0, -7), false);
  assert.equal(blocks({ ...prop, chopped: true }, 0, -7), false);
  assert.equal(blocks({ ...prop, kind: 'bush' }, 0, -7), false);
  assert.equal(blocks({ ...prop, kind: 'bush', solid: true }, 0, -7), true);
  const ellipse = { kind: 'rock', x: 4, y: -8, footW: 5, footH: 2 };
  assert.equal(blocks(ellipse, 4, -8), true);
  assert.equal(blocks(ellipse, 8.5, -6.2), false);
});

test('architecture cells retain anchor depth and final bounds for normal and reflected culling', () => {
  for (const kind of kinds) {
    for (const scale of [0.25, 3]) {
      const prop = createProp(kind, 192.75, -64.25, { seed: 73, scale });
      assert.ok(prop.cells.length > 0);
      const b = prop.bounds;
      for (const { dx, dy } of prop.cells) {
        assert.ok(dx >= b.minX && dx <= b.maxX && dy >= b.minY && dy <= b.maxY);
      }
      const view = { x0: Math.floor(prop.x) + b.minX, y0: Math.floor(prop.y) + b.minY,
        cols: b.maxX - b.minX + 1, rows: b.maxY - b.minY + 1 };
      assert.equal(propInView(view, prop), true);
      assert.equal(propInView({ ...view, x0: Math.floor(prop.x) + b.maxX + 4 }, prop), false);
      assert.equal(propInView({ ...view, y0: Math.floor(prop.y) + b.maxY + 1 }, prop), false);
      assert.equal(propInView({ ...view, y0: Math.floor(prop.y) - b.maxY + 1 }, prop, true), true);
      const writes = [];
      drawProp({}, view, prop, (...args) => writes.push(args));
      assert.equal(writes.length, prop.cells.length);
      assert.ok(writes.every((args) => args[7] === Math.floor(prop.y) - view.y0), 'every stone cell sorts at the ground anchor');
    }
  }
});

test('placed gate collision and grass coverage cross positive and negative chunk seams', () => {
  for (const [x, y] of [[CHUNK_SIZE + 0.5, CHUNK_SIZE + 0.5], [-0.5, -0.5]]) {
    const world = new ArchitectureWorld(42);
    const prop = Object.assign(createProp('stone-gate', x, y, { seed: 31, scale: 3 }), { id: 's:1' });
    world.addProp(prop);
    assert.ok(world.propFootW >= prop.footW && world.propFootH >= prop.footH);
    assert.equal(world.isWalkable(x, y), true);
    for (const rect of prop.collisionRects) {
      const point = centre(prop, rect);
      assert.equal(world.isWalkable(point.x, point.y), false);
      // Test both sides of the horizontal seam, including each pier corner.
      for (const offset of [-0.25, 0.25]) assert.equal(world.isWalkable(point.x, Math.round(y) + offset), false);
      const { c, i } = world.locate(Math.floor(point.x), Math.floor(point.y));
      assert.ok(world.bareGround.get(`${c.cx},${c.cy}`)?.has(i), 'solid pier covers its grass');
      assert.equal(c.grassHeight[i], 0);
    }
    const { c, i } = world.locate(Math.floor(x), Math.floor(y));
    assert.ok(!world.bareGround.get(`${c.cx},${c.cy}`)?.has(i), 'gate opening leaves ground uncovered');
    world.deleteProp(prop.id);
    for (const rect of prop.collisionRects) {
      const point = centre(prop, rect);
      assert.equal(world.isWalkable(point.x, point.y), true);
      const { c, i } = world.locate(Math.floor(point.x), Math.floor(point.y));
      assert.ok(!world.bareGround.get(`${c.cx},${c.cy}`)?.has(i));
    }
  }
});

test('architecture placement, JSON load, undo and redo reconstruct cells and composite geometry', () => {
  const world = new ArchitectureWorld(42);
  const scene = new Scenery(world);
  scene.beginStroke();
  const placed = kinds.map((kind, i) => scene.place(kind, 64.5 + i * 100, -0.5,
    { seed: i + 20, scale: [0.25, 1, 3][i % 3], variant: i % 2 }));
  scene.endStroke();
  const saved = JSON.parse(JSON.stringify(scene.serialize()));
  assert.ok(saved.props.every((p) => !('cells' in p) && !('collisionRects' in p)), 'save only portable definitions');
  const restoredWorld = new ArchitectureWorld(42);
  const restored = new Scenery(restoredWorld);
  restored.load(saved);
  const check = (target) => {
    for (const expected of placed) {
      const actual = target.addedProps.get(expected.id);
      assert.deepEqual(actual, expected, `${expected.kind} reconstruction`);
      if (actual.collisionRects) for (const rect of actual.collisionRects) {
        const point = centre(actual, rect);
        assert.equal(target.isWalkable(point.x, point.y), false);
      }
    }
    const gate = target.addedProps.get(placed[0].id);
    assert.equal(target.isWalkable(gate.x, gate.y), true);
  };
  check(restoredWorld);
  assert.deepEqual(restored.serialize(), saved);
  assert.equal(scene.undo(), true);
  assert.equal(world.addedProps.size, 0);
  assert.equal(scene.redo(), true);
  check(world);
  assert.equal(scene.erase(placed[0].x, placed[0].y, 0), 1);
  assert.equal(scene.undo(), true);
  check(world);
});

test('world view queries include a tall tower whose base lies below the visible chunk', () => {
  const world = new ArchitectureWorld(42);
  const tower = Object.assign(createProp('stone-tower', 64.5, 192.5, { seed: 7, scale: 3 }), { id: 's:1' });
  world.addProp(tower);
  const top = tower.cells.reduce((a, b) => a.dy < b.dy ? a : b);
  const view = { x0: Math.floor(tower.x) + top.dx, y0: Math.floor(tower.y) + top.dy, cols: 1, rows: 1 };
  assert.ok(world.propRenderH >= -top.dy);
  assert.equal(propInView(view, tower), true);
  assert.ok(world.propsInView(view).includes(tower));
});

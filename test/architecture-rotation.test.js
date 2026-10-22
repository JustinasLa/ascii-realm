import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { ArchitectureMesh, project } from '../src/world/architecture-mesh.js';
import { rotateArchitectureGround } from '../src/world/architecture-props.js';
import { blocks, createProp, propInView } from '../src/world/props.js';
import { ASPECT, World } from '../src/world/world.js';

const kinds = ['stone-gate', 'stone-tower', 'column-short', 'column-broken', 'column-tall',
  'wall-low', 'wall-broken', 'rubble-small', 'rubble-large'];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ~= ${b}`);
const vectorNear = (a, b) => a.forEach((n, i) => near(n, b[i]));
const yaw = ([x, h, z], degrees) => {
  const angle = degrees * Math.PI / 180;
  return [Math.cos(angle) * x + Math.sin(angle) * z, h,
    -Math.sin(angle) * x + Math.cos(angle) * z];
};
const centre = (polygon) => polygon.reduce(([x, y], p) =>
  [x + p[0] / polygon.length, y + p[1] / polygon.length], [0, 0]);

class EmptyWorld extends World {
  findSpawn() { return { x: 0.5, y: 0.5 }; }
  generate(cx, cy) { const chunk = super.generate(cx, cy); chunk.props = []; return chunk; }
}

test('ground helper agrees with model yaw and positive 45 gives a screen diagonal', () => {
  for (const rotation of [0, 45, -45, 90, -135]) {
    for (const point of [[12, 0, 0], [-4, 0, 7], [6, 0, -8]]) {
      const [px, py] = project(point), expected = project(yaw(point, rotation));
      const actual = rotateArchitectureGround(px / ASPECT, py, rotation);
      vectorNear([actual.x * ASPECT, actual.y], expected);
      const restored = rotateArchitectureGround(actual.x, actual.y, -rotation);
      vectorNear([restored.x, restored.y], [px / ASPECT, py]);
    }
  }
  const tangent = rotateArchitectureGround(10, 0, 45);
  near(tangent.x * ASPECT, tangent.y);
});

test('mesh yaw keeps height upright and rotates outward and interpolated normals before sampling', () => {
  for (const rotation of [45, -45]) {
    const mesh = new ArchitectureMesh().face([[-3, 0, 0], [3, 0, 0], [0, 9, 0]], [0, 0, -1], {},
      [[0, 0, -1], [0.6, 0, -0.8], [0, 0, -1]]);
    const original = structuredClone(mesh.triangles[0]);
    mesh.yaw(rotation);
    mesh.triangles[0].points.forEach((p, i) => vectorNear(p, yaw(original.points[i], rotation)));
    vectorNear(mesh.triangles[0].normal, yaw(original.normal, rotation));
    const hit = mesh.compile().sample(...project(yaw([0, 3, 0], rotation)));
    assert.ok(hit);
    vectorNear(hit.point, [0, 3, 0]);
    const interpolated = [0.2, 0, -2 / 3 - 0.8 / 3];
    const length = Math.hypot(...interpolated);
    vectorNear(hit.normal, yaw(interpolated.map((n) => n / length), rotation));
  }
});

test('zero rotation retains all legacy architecture output and rectangle collision', () => {
  for (const kind of kinds) {
    const options = { seed: 21, scale: 0.75, variant: 1 };
    const original = createProp(kind, -3, 2, options);
    assert.deepEqual(createProp(kind, -3, 2, { ...options, rotation: 0 }), original);
    assert.ok(original.collisionRects);
    assert.ok(!('rotation' in original) && !('collisionPolygons' in original));
  }
});

test('45 and negative yaw transform the exact collider union and keep gate passages open', () => {
  for (const rotation of [45, -45]) for (const scale of [0.25, 1, 3]) {
    for (const kind of ['stone-gate', 'wall-low', 'wall-broken']) {
      const options = { seed: 19, variant: 0, scale };
      const source = createProp(kind, 0, 0, options);
      const rotated = createProp(kind, 64.5, -0.5, { ...options, rotation });
      assert.equal(rotated.rotation, rotation);
      assert.ok(!('collisionRects' in rotated));
      assert.equal(rotated.collisionPolygons.length, source.collisionRects.length);
      for (const polygon of rotated.collisionPolygons) {
        const [x, y] = centre(polygon);
        assert.equal(blocks(rotated, rotated.x + x, rotated.y + y), true);
        for (const [dx, dy] of polygon) {
          assert.ok(Math.abs(dx) <= rotated.footW + 1e-8);
          assert.ok(Math.abs(dy) <= rotated.footH + 1e-8);
          assert.equal(blocks(rotated, rotated.x + dx, rotated.y + dy), false);
        }
      }
      // Transform a grid spanning the original footprint, including points
      // outside its colliders: a bounding rectangle must not become solid.
      for (let x = -1.2; x <= 1.2; x += 0.17) for (let y = -1.4; y <= 1.4; y += 0.19) {
        const dx = x * source.footW, dy = y * source.footH;
        const p = rotateArchitectureGround(dx, dy, rotation);
        assert.equal(blocks(rotated, rotated.x + p.x, rotated.y + p.y), blocks(source, dx, dy));
      }
      if (kind === 'stone-gate') for (let step = -20; step <= 20; step++) {
        const p = rotateArchitectureGround(0, step * scale, rotation);
        assert.equal(blocks(rotated, rotated.x + p.x, rotated.y + p.y), false, 'full passage remains open');
      }
    }
  }
});

test('polygon collision respects winding, holes between pieces and existing nonsolid rules', () => {
  const prop = { ...createProp('stone-gate', 0, 0, { seed: 7, rotation: 45 }), solid: true };
  const [x, y] = centre(prop.collisionPolygons[0]);
  assert.equal(blocks(prop, x, y), true);
  assert.equal(blocks({ ...prop, collisionPolygons: prop.collisionPolygons.map((p) => [...p].reverse()) }, x, y), true);
  assert.equal(blocks(prop, 0, 0), false);
  for (const changes of [{ solid: false }, { chopped: true }, { kind: 'bush', solid: undefined }]) {
    assert.equal(blocks({ ...prop, ...changes }, x, y), false);
  }
});

test('varied artwork and polygons use matching anisotropic dimensions, including positive ground rows', () => {
  for (const kind of kinds) {
    const raw = createProp(kind, 0, 0, { seed: 19, variant: 0, rotation: 45 });
    const varied = createProp(kind, 0, 0, { seed: 19, variant: 1, rotation: 45, scale: 3 });
    raw.collisionPolygons.forEach((polygon, i) => polygon.forEach(([x, y], j) => {
      near(varied.collisionPolygons[i][j][0], x * varied.footW / raw.footW);
      near(varied.collisionPolygons[i][j][1], y * varied.footH / raw.footH);
    }));
    for (const prop of [raw, varied]) for (const { dx, dy } of prop.cells) {
      assert.ok(dx >= prop.bounds.minX && dx <= prop.bounds.maxX && dy >= prop.bounds.minY && dy <= prop.bounds.maxY);
    }
  }
  const small = createProp('stone-gate', 0, 0, { variant: 0, rotation: 45 });
  const large = createProp('stone-gate', 0, 0, { variant: 0, rotation: 45, scale: 3 });
  assert.ok(small.bounds.maxY > 3, 'front rotated footing is not clipped at the anchor');
  assert.ok(large.bounds.maxY >= small.bounds.maxY * 3 - 1, 'bottom bake extent scales with artwork');
  const below = { x0: -100, y0: large.bounds.maxY, cols: 200, rows: 1 };
  assert.equal(propInView(below, large), true);
});

test('rotated gate broad bounds feed world collision and grass indexes across chunk seams', () => {
  for (const rotation of [45, -45]) {
    const world = new EmptyWorld(42);
    const prop = Object.assign(createProp('stone-gate', -0.5, 64.5, { seed: 19, rotation, scale: 3 }), { id: 's:1' });
    world.addProp(prop);
    assert.ok(world.propFootW >= prop.footW && world.propFootH >= prop.footH);
    assert.equal(world.isWalkable(prop.x, prop.y), true);
    for (const polygon of prop.collisionPolygons) {
      const [dx, dy] = centre(polygon), x = prop.x + dx, y = prop.y + dy;
      assert.equal(world.isWalkable(x, y), false);
      const { c, i } = world.locate(Math.floor(x), Math.floor(y));
      assert.ok(world.bareGround.get(`${c.cx},${c.cy}`)?.has(i));
      assert.equal(c.grassHeight[i], 0);
    }
    world.deleteProp(prop.id);
    for (const polygon of prop.collisionPolygons) {
      const [dx, dy] = centre(polygon);
      assert.equal(world.isWalkable(prop.x + dx, prop.y + dy), true);
    }
  }
});

test('rotation survives JSON, history and relocating a portable definition; defaults keep the save format', () => {
  const world = new EmptyWorld(42), scene = new Scenery(world);
  scene.beginStroke();
  const rotated = scene.place('stone-gate', 64.5, -0.5, { seed: 31, rotation: -45, scale: 1.5 });
  scene.place('wall-low', 180, 80, { seed: 17, rotation: 0 });
  scene.endStroke();
  const saved = JSON.parse(JSON.stringify(scene.serialize()));
  assert.equal(saved.props[0].rotation, -45);
  assert.ok(!('rotation' in saved.props[1]));
  assert.ok(!('collisionPolygons' in saved.props[0]));
  const restoredWorld = new EmptyWorld(42), restored = new Scenery(restoredWorld);
  restored.load(saved);
  assert.deepEqual(restoredWorld.addedProps.get(rotated.id), rotated);
  assert.deepEqual(restored.serialize(), saved);
  scene.undo();
  assert.equal(world.addedProps.size, 0);
  scene.redo();
  assert.deepEqual(world.addedProps.get(rotated.id), rotated);
  const moved = restored.place(rotated.kind, 400, -100, saved.props[0]);
  assert.deepEqual(moved.cells, rotated.cells);
  assert.deepEqual(moved.collisionPolygons, rotated.collisionPolygons);
});

test('invalid rotations reject atomically in both the factory and scene load', () => {
  const scene = new Scenery(new EmptyWorld(42));
  scene.place('wall-low', 0, 0, { seed: 7 });
  const saved = scene.serialize();
  for (const rotation of [NaN, Infinity, -Infinity, '45', null, {}, []]) {
    assert.throws(() => createProp('stone-gate', 0, 0, { rotation }), /rotation/);
    assert.throws(() => scene.place('stone-gate', 0, 0, { rotation }), /rotation/);
    assert.throws(() => scene.load({ ...saved, props: [{ ...saved.props[0], rotation }] }), /rotation/);
    assert.deepEqual(scene.serialize(), saved);
  }
  assert.throws(() => createProp('rock', 0, 0, { rotation: 45 }), /architecture/);
  scene.undo();
  assert.equal(scene.canUndo, false, 'rejected rotations do not consume history');
});

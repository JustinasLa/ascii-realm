import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArchitectureMesh, project } from '../src/world/architecture-mesh.js';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} ~= ${b}`);
const vectorNear = (a, b) => a.forEach((n, i) => near(n, b[i]));

test('a solid box exposes its front, right return and horizontal top with distinct normals', () => {
  const { sample } = new ArchitectureMesh().box(-2, 2, 0, 6, 0, 4).compile();
  for (const [point, normal] of [
    [[0, 3, 0], [0, 0, -1]],
    [[2, 3, 2], [1, 0, 0]],
    [[0, 6, 2], [0, 1, 0]],
  ]) {
    const hit = sample(...project(point));
    assert.ok(hit);
    vectorNear(hit.point, point);
    vectorNear(hit.normal, normal);
  }
  assert.equal(sample(-3, -3), null);
  assert.equal(sample(0, 1), null);
});

test('depth resolution is independent of submission order and discards backfaces', () => {
  const front = { name: 'front' }, behind = { name: 'behind' };
  for (const reverse of [false, true]) {
    const mesh = new ArchitectureMesh();
    const boxes = [[-3, 3, 0, 8, 0, 1, front], [-3, 3, 0, 8, 3, 4, behind]];
    for (const args of reverse ? boxes.reverse() : boxes) mesh.box(...args);
    assert.equal(mesh.compile().sample(0, -4).material, front);
  }
  const away = new ArchitectureMesh().face([[-3, 0, 0], [3, 0, 0], [0, 8, 0]], [0, 0, 1]);
  assert.equal(away.compile().sample(0, -3), null);
});

test('cylinder caps are projected ellipses and sides interpolate unit radial normals', () => {
  const radius = 3;
  const { sample } = new ArchitectureMesh().lathe(-1.65, 3, [[radius, 0], [radius, 10]]).compile();
  const cap = sample(...project([-1.65, 10, 3]));
  vectorNear(cap.normal, [0, 1, 0]);
  assert.ok(cap.material.cap);
  for (const x of [-2, -1, 0, 1, 2]) {
    const hit = sample(x, -5);
    assert.ok(hit);
    near(Math.hypot(...hit.normal), 1);
    near(hit.normal[1], 0);
    assert.ok(hit.normal[2] < 0.6);
    // Radial normal must align with actual world-space radius, not screen x.
    near(hit.normal[0] / hit.normal[2], (hit.point[0] + 1.65) / (hit.point[2] - 3), 1e-6);
  }
  assert.equal(sample(0, -13), null);
  assert.ok(sample(0, -10.8), 'back of the top ellipse extends above the front rim');
});

test('extruded arch wedge has a dark downward intrados and does not paint its aperture', () => {
  const mesh = new ArchitectureMesh();
  mesh.extrude([[-3, 6], [0, 10], [0, 12], [-4, 8]], 0, 4);
  const { sample } = mesh.compile();
  const point = [-1.5, 8, 2];
  const hit = sample(...project(point));
  assert.ok(hit);
  assert.ok(hit.normal[1] < -0.5);
  assert.equal(sample(0, -5), null);
});

test('irregular slabs resolve an elevated faceted lid and deep vertical sides', () => {
  const mesh = new ArchitectureMesh().slab([[-4, 0], [3, 0], [4, 2], [1, 5], [-3, 4]],
    0, [2.8, 3, 3.2, 3.5, 3.1]);
  const { sample, bounds } = mesh.compile();
  const lid = sample(0, -4);
  assert.ok(lid.material.cap && lid.normal[1] > 0.9);
  const side = sample(0, -1);
  vectorNear(side.normal, [0, 0, -1]);
  assert.ok(bounds.minY < -5 && bounds.maxX > 4);
});

test('spatial binning preserves depth hits and surface values at bin boundaries', () => {
  const mesh = new ArchitectureMesh().box(-4, 3, 0, 9, 0, 6)
    .lathe(3, 3, [[2, 0], [2, 12]], { cylinder: true });
  const small = mesh.compile(0.7), large = mesh.compile(100);
  for (let y = -16; y <= 0; y += 0.7) {
    for (let x = -5; x <= 9; x += 0.7) {
      assert.deepEqual(small.sample(x, y), large.sample(x, y));
    }
  }
});

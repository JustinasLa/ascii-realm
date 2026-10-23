// Small orthographic solid modeller. Coordinates are [X, height, depth],
// with depth increasing away from the camera. Recipes stay in physical row
// units; the existing baker alone handles glyph aspect, scale and variation.
export const project = ([x, h, z]) => [x + 0.55 * z, -h - 0.45 * z];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const d = Math.hypot(...v); return v.map((n) => n / (d || 1)); };
const normal = (a, b, c) => {
  const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
  return unit([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
};

export class ArchitectureMesh {
  triangles = [];

  // Upright model yaw, before projection, visibility and lighting. Normals
  // (including smooth per-vertex normals) use the same orthogonal transform.
  yaw(degrees) {
    if (!degrees) return this;
    const angle = (degrees % 360) * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotate = ([x, h, z]) => [c * x + s * z, h, -s * x + c * z];
    this.triangles = this.triangles.map((t) => ({ ...t,
      points: t.points.map(rotate), normal: rotate(t.normal),
      normals: t.normals?.map(rotate) ?? null,
    }));
    return this;
  }

  // Faces are convex. Explicit outward normals make the winding immaterial.
  face(points, outward, material = {}, normals = null) {
    for (let i = 1; i < points.length - 1; i++) {
      this.triangles.push({ points: [points[0], points[i], points[i + 1]],
        normal: outward ?? normal(points[0], points[i], points[i + 1]), material,
        normals: normals ? [normals[0], normals[i], normals[i + 1]] : null });
    }
    return this;
  }

  // Extrude a convex X/height profile, retaining its actual intrados/top faces.
  extrude(profile, z0, z1, material = {}) {
    const area = profile.reduce((sum, p, i) => {
      const q = profile[(i + 1) % profile.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
    const points = area < 0 ? [...profile].reverse() : profile;
    this.face(points.map(([x, h]) => [x, h, z0]), [0, 0, -1], material);
    this.face(points.map(([x, h]) => [x, h, z1]), [0, 0, 1], material);
    for (let i = 0; i < points.length; i++) {
      const [x, h] = points[i], [xx, hh] = points[(i + 1) % points.length];
      this.face([[x, h, z0], [xx, hh, z0], [xx, hh, z1], [x, h, z1]],
        unit([hh - h, x - xx, 0]), material);
    }
    return this;
  }

  box(x0, x1, h0, h1, z0, z1, material = {}) {
    return this.extrude([[x0, h0], [x1, h0], [x1, h1], [x0, h1]], z0, z1, material);
  }

  // A cut stone has twelve chamfered edges, rather than a painted highlight.
  bevelBox(x0, x1, h0, h1, z0, z1, bevel = 0.2, material = {}) {
    const r = Math.max(0, Math.min(bevel, (x1 - x0) * 0.25, (h1 - h0) * 0.25, (z1 - z0) * 0.25));
    if (!r) return this.box(x0, x1, h0, h1, z0, z1, material);
    const ring = [[x0 + r, z0], [x1 - r, z0], [x1, z0 + r], [x1, z1 - r],
      [x1 - r, z1], [x0 + r, z1], [x0, z1 - r], [x0, z0 + r]];
    const inset = ring.map(([x, z]) => [Math.max(x0 + r, Math.min(x1 - r, x)),
      Math.max(z0 + r, Math.min(z1 - r, z))]);
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8, [x, z] = ring[i], [xx, zz] = ring[j];
      const [a, b] = inset[i], [aa, bb] = inset[j];
      const length = Math.hypot(xx - x, zz - z);
      this.face([[x, h0 + r, z], [xx, h0 + r, zz], [xx, h1 - r, zz], [x, h1 - r, z]],
        unit([zz - z, 0, x - xx]), material);
      this.face([[x, h1 - r, z], [xx, h1 - r, zz], [aa, h1, bb], [a, h1, b]],
        unit([zz - z, length, x - xx]), { ...material, bevel: true });
      this.face([[a, h0, b], [aa, h0, bb], [xx, h0 + r, zz], [x, h0 + r, z]],
        unit([zz - z, -length, x - xx]), { ...material, bevel: true });
    }
    this.face([[x0 + r, h1, z0 + r], [x1 - r, h1, z0 + r],
      [x1 - r, h1, z1 - r], [x0 + r, h1, z1 - r]], [0, 1, 0], { ...material, cap: true });
    return this;
  }

  // Turn a stone profile into smooth cylindrical/bevelled surfaces. A final
  // irregular height ring makes a broken shaft with a triangulated solid cap.
  lathe(cx, cz, rings, material = {}, topOffsets = null, segments = 32, options = {}) {
    const flutes = options.flutes ?? 0, depth = options.fluteDepth ?? 0;
    const radiusAt = (r, a) => r * (1 - depth * (0.5 + 0.5 * Math.cos(flutes * a)));
    const vertices = rings.map(([r, h], j) => Array.from({ length: segments }, (_, i) => {
      const a = i * Math.PI * 2 / segments;
      const rr = radiusAt(r, a);
      return [cx + rr * Math.cos(a), h + (j === rings.length - 1 ? topOffsets?.[i] ?? 0 : 0), cz + rr * Math.sin(a)];
    }));
    for (let j = 0; j < rings.length - 1; j++) {
      const [r0, h0] = rings[j], [r1, h1] = rings[j + 1];
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        const n = (index) => {
          const a = index * Math.PI * 2 / segments;
          const r = (r0 + r1) / 2, rr = radiusAt(r, a);
          const derivative = r * depth * 0.5 * flutes * Math.sin(flutes * a);
          return unit([(h1 - h0) * (rr * Math.cos(a) + derivative * Math.sin(a)),
            (r0 - r1) * rr, (h1 - h0) * (rr * Math.sin(a) - derivative * Math.cos(a))]);
        };
        const a = n(i), b = n(next);
        this.face([vertices[j][i], vertices[j][next], vertices[j + 1][next], vertices[j + 1][i]],
          unit(a.map((v, k) => v + b[k])), material, [a, b, b, a]);
      }
    }
    const last = vertices.at(-1);
    const center = [cx, last.reduce((s, p) => s + p[1], 0) / segments, cz];
    for (let i = 0; i < segments; i++) {
      const points = [center, last[(i + 1) % segments], last[i]];
      let n = normal(...points);
      if (n[1] < 0) n = n.map((v) => -v);
      this.face(points, n, { ...material, cap: true });
    }
    return this;
  }

  // Irregular footprint and sloping lid: large rubble slabs, not screen masks.
  slab(outline, bottom, heights, material = {}) {
    const points = [...outline];
    const area = points.reduce((s, p, i) => {
      const q = points[(i + 1) % points.length]; return s + p[0] * q[1] - q[0] * p[1];
    }, 0);
    const top = points.map(([x, z], i) => [x, heights[i], z]);
    const center = [0, 1, 2].map((axis) => top.reduce((s, p) => s + p[axis], 0) / top.length);
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      let n = normal(center, top[i], top[j]);
      if (n[1] < 0) n = n.map((v) => -v);
      this.face([center, top[i], top[j]], n, { ...material, cap: true });
      const [x, z] = points[i], [xx, zz] = points[j];
      this.face([[x, bottom, z], [xx, bottom, zz], top[j], top[i]],
        unit([zz - z, 0, x - xx].map((v) => area < 0 ? -v : v)), material);
    }
    return this;
  }

  compile(binSize = 3, groundSkew = 0.55) {
    const view = [groundSkew, 0.45, -1];
    const projection = ([x, h, z]) => [x + groundSkew * z, -h - 0.45 * z];
    const bins = new Map();
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const t of this.triangles) {
      if (dot(t.normal, view) <= 1e-8) continue;
      const p = t.points.map(projection);
      const [a, b, c] = p;
      const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(determinant) < 1e-9) continue;
      const minX = Math.min(...p.map((v) => v[0])), maxX = Math.max(...p.map((v) => v[0]));
      const minY = Math.min(...p.map((v) => v[1])), maxY = Math.max(...p.map((v) => v[1]));
      bounds.minX = Math.min(bounds.minX, minX); bounds.maxX = Math.max(bounds.maxX, maxX);
      bounds.minY = Math.min(bounds.minY, minY); bounds.maxY = Math.max(bounds.maxY, maxY);
      const triangle = { ...t, p, determinant, minX, maxX, minY, maxY };
      for (let iy = Math.floor(minY / binSize); iy <= Math.floor(maxY / binSize); iy++) {
        for (let ix = Math.floor(minX / binSize); ix <= Math.floor(maxX / binSize); ix++) {
          const key = `${ix},${iy}`;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(triangle);
        }
      }
    }
    const sample = (px, py) => {
      const candidates = bins.get(`${Math.floor(px / binSize)},${Math.floor(py / binSize)}`);
      if (!candidates) return null;
      let nearest = null, bestZ = Infinity, weights;
      for (const t of candidates) {
        if (px < t.minX - 1e-8 || px > t.maxX + 1e-8 || py < t.minY - 1e-8 || py > t.maxY + 1e-8) continue;
        const [a, b, c] = t.p;
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / t.determinant;
        const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / t.determinant;
        const w = 1 - u - v;
        if (u < -1e-8 || v < -1e-8 || w < -1e-8) continue;
        const z = u * t.points[0][2] + v * t.points[1][2] + w * t.points[2][2];
        if (z >= bestZ - 1e-8) continue;
        bestZ = z; nearest = t; weights = [u, v, w];
      }
      if (!nearest) return null;
      const n = nearest.normals ? unit([0, 1, 2].map((axis) =>
        weights.reduce((sum, weight, i) => sum + weight * nearest.normals[i][axis], 0))) : nearest.normal;
      return { point: [px - groundSkew * bestZ, -py - 0.45 * bestZ, bestZ], normal: n, material: nearest.material };
    };
    return { bounds, sample };
  }
}

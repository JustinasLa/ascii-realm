// Flat 2D shapes the wanderer is assembled from once its skeleton has been
// projected onto the screen. Coordinates are in row units (one unit is one
// cell tall; columns are pre-scaled by ASPECT so units are square).
//
// Every shape has a bounding box for quick rejection and a `test(x, y, out)`
// that returns whether the point is inside and, if so, fills `out` with:
//   nx, ny  where on the shape the point lies, -1..1 from its centre line,
//           which doubles as a rough surface normal for lighting;
//   u       distance along the shape's length, for textures that should
//           stick to the body as it moves;
//   v       position across the shape, -1..1.

// A capsule whose radius may taper from `ra` at a to `rb` at b.
export function capsule(ax, ay, bx, by, ra, rb = ra) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const rmax = Math.max(ra, rb);
  return {
    x0: Math.min(ax, bx) - rmax,
    x1: Math.max(ax, bx) + rmax,
    y0: Math.min(ay, by) - rmax,
    y1: Math.max(ay, by) + rmax,
    test(x, y, out) {
      const px = x - ax;
      const py = y - ay;
      const along = px * ux + py * uy;
      const t = Math.max(0, Math.min(1, along / len));
      const rad = ra + (rb - ra) * t;
      const ox = px - ux * len * t;
      const oy = py - uy * len * t;
      if (ox * ox + oy * oy > rad * rad) return false;
      out.nx = ox / rad;
      out.ny = oy / rad;
      out.u = along;
      out.v = (ox * -uy + oy * ux) / rad;
      return true;
    },
  };
}

export function ellipse(cx, cy, rx, ry) {
  return {
    x0: cx - rx,
    x1: cx + rx,
    y0: cy - ry,
    y1: cy + ry,
    test(x, y, out) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) return false;
      out.nx = dx;
      out.ny = dy;
      out.u = y - (cy - ry);
      out.v = dx;
      return true;
    },
  };
}

// A convex quad with corners in order a, b, c, d. Used for cloth panels:
// a-b is the top edge and d-c the bottom, so u runs down the panel.
export function quad(a, b, c, d) {
  const pts = [a, b, c, d];
  // Make the winding consistent so the inside test only needs one sign.
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % 4];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sign = area < 0 ? -1 : 1;
  const topX = (a[0] + b[0]) / 2;
  const topY = (a[1] + b[1]) / 2;
  const botX = (d[0] + c[0]) / 2;
  const botY = (d[1] + c[1]) / 2;
  const ax = botX - topX;
  const ay = botY - topY;
  const alen = Math.hypot(ax, ay) || 1e-6;
  const halfW = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - d[0], c[1] - d[1])) / 4 || 1e-6;
  return {
    x0: Math.min(a[0], b[0], c[0], d[0]),
    x1: Math.max(a[0], b[0], c[0], d[0]),
    y0: Math.min(a[1], b[1], c[1], d[1]),
    y1: Math.max(a[1], b[1], c[1], d[1]),
    test(x, y, out) {
      for (let i = 0; i < 4; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % 4];
        if (((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])) * sign < 0) return false;
      }
      const px = x - topX;
      const py = y - topY;
      const along = (px * ax + py * ay) / alen;
      const across = (px * ay - py * ax) / alen / halfW;
      out.nx = Math.max(-1, Math.min(1, across));
      out.ny = along / alen - 0.5;
      out.u = along;
      out.v = out.nx;
      return true;
    },
  };
}

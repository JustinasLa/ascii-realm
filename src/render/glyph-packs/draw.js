// Small drawing helpers for glyph packs. Every function draws in a glyph's
// inner-cell coordinates (see glyphs.js: 30 across, 50 down) on a 2D canvas
// context whose fill and stroke are white. A grey level paints part of a
// glyph at partial strength, which lets one glyph carry its own shading.

export const TAU = Math.PI * 2;

// A deterministic generator for scattering details inside a glyph.
export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const grey = (v) => {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${c},${c},${c})`;
};

export function dot(ctx, x, y, r, level = 1) {
  ctx.fillStyle = grey(level);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

export function ellipse(ctx, x, y, rx, ry, angle = 0, level = 1) {
  ctx.fillStyle = grey(level);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
  ctx.fill();
}

export function line(ctx, points, width = 4, level = 1) {
  ctx.strokeStyle = grey(level);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.stroke();
}

export function curve(ctx, x0, y0, cx, cy, x1, y1, width = 4, level = 1) {
  ctx.strokeStyle = grey(level);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
}

export function arc(ctx, x, y, rx, ry, a0, a1, width = 4, level = 1) {
  ctx.strokeStyle = grey(level);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, a0, a1);
  ctx.stroke();
}

export function poly(ctx, points, level = 1) {
  ctx.fillStyle = grey(level);
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
}

// An almond leaf from (x, y) pointing along angle, with a darker midrib.
export function leaf(ctx, x, y, length, width, angle, level = 1, rib = 0.45) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const tx = x + c * length;
  const ty = y + s * length;
  const mx = x + c * length * 0.5;
  const my = y + s * length * 0.5;
  ctx.fillStyle = grey(level);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx - s * width, my + c * width, tx, ty);
  ctx.quadraticCurveTo(mx + s * width, my - c * width, x, y);
  ctx.fill();
  if (rib < level) line(ctx, [x, y, x + c * length * 0.85, y + s * length * 0.85], Math.max(1.2, width * 0.18), rib);
}

// A ring of petals around (x, y), leaving the centre open for a layered eye.
export function petals(ctx, x, y, count, length, width, turn = 0, level = 1, hole = 0) {
  for (let k = 0; k < count; k++) {
    const a = turn + k / count * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = x + c * (hole + length / 2);
    const py = y + s * (hole + length / 2) * 1;
    ellipse(ctx, px, py, length / 2, width / 2, a, level);
  }
}

// A soft blob made of many overlapping dots, brighter in the middle.
export function fuzz(ctx, x, y, rx, ry, seed, count = 26, size = 2.6, level = 1) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = rand() * TAU;
    const d = Math.sqrt(rand());
    dot(ctx, x + Math.cos(a) * rx * d, y + Math.sin(a) * ry * d, size * (0.6 + rand() * 0.7),
      level * (1 - d * 0.45));
  }
}

// Generates `count` glyph entries named `${prefix}.${i}` from one drawer.
export function variants(prefix, count, draw, mirror) {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}.${i}`,
    draw: (ctx, w, h) => draw(ctx, w, h, i),
    mirror: mirror ? `${prefix}.${mirror(i)}` : undefined,
  }));
}

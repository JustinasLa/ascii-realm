// Inverse of the renderer's fragment-shader lookup: p = devicePixel +
// uOffset, then worldCell = view origin + p / cell size. A snapshot of the
// last displayed frame avoids mixing a new zoom with an old camera offset.
export function screenToWorld(pointer, frame, bounds) {
  if (!pointer || !frame?.view || !bounds) return null;
  const { x, y } = pointer;
  const { left, top, width: cssWidth, height: cssHeight } = bounds;
  const { width, height, cellW, cellH, view } = frame;
  if (![x, y, left, top, cssWidth, cssHeight, width, height, cellW, cellH,
    view.x0, view.y0, view.offX, view.offY].every(Number.isFinite) ||
    cssWidth <= 0 || cssHeight <= 0 || width <= 0 || height <= 0 || cellW <= 0 || cellH <= 0 ||
    x < left || y < top || x >= left + cssWidth || y >= top + cssHeight) return null;
  return {
    x: view.x0 + ((x - left) * width / cssWidth + view.offX) / cellW,
    y: view.y0 + ((y - top) * height / cssHeight + view.offY) / cellH,
  };
}

// Sprites (the wanderer, trees, rocks) never touch the cell buffers directly;
// they hand each finished cell to a writer. The default writer just draws it,
// but the same sprite code can be pointed at a different writer to, say,
// draw its mirror image into a lake.
//
// `base` is the screen row the sprite stands on. A sprite may also pass a
// background colour to blot out whatever is behind a cell it fully covers.
// Trees and rocks are drawn in small cells, FINE across and down each cell
// (see renderer.js), so they stand apart from the grass around them.
export const FINE = 2;

export function putCell(r, sx, sy, g, cr, cg, cb, base, br, bgG, bb) {
  r.put(sx, sy, g, cr, cg, cb);
  if (br !== undefined) r.putBg(sx, sy, br, bgG, bb);
}

// Keep the player's full-size letters, with the same thin dark border as props.
export function putOutlinedCell(r, sx, sy, g, cr, cg, cb, base, br, bgG, bb) {
  putCell(r, sx, sy, g, cr, cg, cb, base, br, bgG, bb);
  if (br !== undefined) r.outlineCell(sx, sy, br, bgG, bb);
}

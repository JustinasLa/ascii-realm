// Sprites (the wanderer, trees, rocks) never touch the cell buffers directly;
// they hand each finished cell to a writer. The default writer just draws it,
// but the same sprite code can be pointed at a different writer to, say,
// draw its mirror image into a lake.
//
// `base` is the screen row the sprite stands on.
export function putCell(r, sx, sy, g, cr, cg, cb, base) {
  r.put(sx, sy, g, cr, cg, cb);
}

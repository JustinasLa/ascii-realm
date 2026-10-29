// The paper doll: twelve boxes on an 8 × 7 grid of cells about 5:4 wide
// (weapon and shield 2 × 4 cells, body 2 × 3, the other large boxes 2 × 2,
// small boxes one cell). `small` boxes are dashed when empty.
export const DOLL_COLUMNS = 8;
export const DOLL_ROWS = 7;

const box = (column, row, width, height, label, small = false) =>
  Object.freeze({ column, row, width, height, label, small });

export const DOLL_BOXES = Object.freeze({
  mainHand: box(1, 1, 2, 4, 'weapon'),
  hands: box(1, 5, 2, 2, 'gloves'),
  quiver: box(3, 2, 1, 1, 'quiver', true),
  ringLeft: box(3, 4, 1, 1, 'ring', true),
  helm: box(4, 1, 2, 2, 'helmet'),
  chest: box(4, 3, 2, 3, 'body'),
  legs: box(4, 6, 2, 2, 'legs'),
  amulet: box(6, 2, 1, 1, 'amulet', true),
  cape: box(6, 3, 1, 1, 'cloak', true),
  ringRight: box(6, 4, 1, 1, 'ring', true),
  offHand: box(7, 1, 2, 4, 'shield'),
  feet: box(7, 5, 2, 2, 'boots'),
});

// `grid-area` for a slot: "row / column / row end / column end".
export const dollArea = (slot) => {
  const { column, row, width, height } = DOLL_BOXES[slot];
  return `${row} / ${column} / ${row + height} / ${column + width}`;
};

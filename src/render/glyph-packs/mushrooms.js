// The reference mushrooms use heavy terminal lettering, while the meadow
// keeps its finer type. These remain real ASCII characters in the atlas.
export const MUSHROOMS = Array.from({ length: 94 }, (_, i) => ({
  name: `mushrooms.ascii.${i + 33}`,
  ascii: String.fromCharCode(i + 33),
  bold: true,
  strength: 1,
}));

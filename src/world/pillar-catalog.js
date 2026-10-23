// Data only: the palette must not import geometry, which imports the world.
export const PILLAR_RUINS = Object.freeze([
  { name: 'chipped', label: 'Chipped capital' },
  { name: 'snapped', label: 'Diagonal break' },
  { name: 'split', label: 'Split shaft' },
  { name: 'shifted', label: 'Displaced drums' },
  { name: 'collapsed', label: 'Collapsed stump' },
].map(Object.freeze));

export const PILLAR_DEFINITIONS = Object.freeze([
  { kind: 'column-square', label: 'Square-base pillar', symbol: 'I', group: 'Architecture', solid: true, defaultRotation: 45 },
  ...['square', 'circular'].flatMap(shape => PILLAR_RUINS.map(({ name, label }) => ({
    kind: `column-${shape}-${name}`, label: `${shape === 'square' ? 'Square' : 'Circular'} · ${label}`,
    symbol: '/', group: 'Architecture', solid: true, defaultRotation: shape === 'square' ? 45 : 0,
  }))),
].map(Object.freeze));

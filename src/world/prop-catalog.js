import { PILLAR_DEFINITIONS } from './pillar-catalog.js';

// The palette, scene validation and prop factory share these definitions so
// every available prop can also be previewed, saved and restored.
export const PROP_CATALOG = Object.freeze([
  { kind: 'tree', label: 'Tree', symbol: 'Y', group: 'Nature', solid: true },
  { kind: 'pine', label: 'Pine', symbol: '^', group: 'Nature', solid: true },
  { kind: 'rock', label: 'Rock', symbol: 'O', group: 'Nature', solid: true },
  { kind: 'standing-stone', label: 'Standing stone', symbol: '!', group: 'Nature', solid: true },
  { kind: 'bush', label: 'Bush', symbol: '*', group: 'Nature', solid: true },
  { kind: 'stump', label: 'Stump', symbol: 'o', group: 'Nature', solid: true },
  { kind: 'log', label: 'Log', symbol: '=', group: 'Nature', solid: true },
  { kind: 'flowers', label: 'Flowers', symbol: '+', group: 'Nature', solid: false },
  { kind: 'mushrooms', label: 'Mushrooms', symbol: 'T', group: 'Nature', solid: false },
  { kind: 'pale-caps', label: 'Pale caps', symbol: 'm', group: 'Nature', solid: false },
  { kind: 'reeds', label: 'Reeds', symbol: '|', group: 'Nature', solid: false },
  { kind: 'crate', label: 'Crate', symbol: '#', group: 'Camp', solid: true },
  { kind: 'barrel', label: 'Barrel', symbol: 'U', group: 'Camp', solid: true },
  { kind: 'fence', label: 'Fence', symbol: 'H', group: 'Camp', solid: true },
  { kind: 'tent', label: 'Tent', symbol: 'A', group: 'Camp', solid: true },
  { kind: 'campfire', label: 'Campfire', symbol: '*', group: 'Camp', solid: true },
  { kind: 'signpost', label: 'Signpost', symbol: '>', group: 'Camp', solid: true },
  { kind: 'furnace', label: 'Furnace', symbol: 'n', group: 'Camp', solid: true },
  { kind: 'alloy-forge', label: 'Alloy forge', symbol: 'U', group: 'Camp', solid: true },
  { kind: 'stone-gate', label: 'Stone gate', symbol: 'n', group: 'Architecture', solid: true },
  { kind: 'stone-tower', label: 'Stone tower', symbol: '#', group: 'Architecture', solid: true },
  { kind: 'column-short', label: 'Short column', symbol: 'i', group: 'Architecture', solid: true },
  { kind: 'column-broken', label: 'Broken column', symbol: '/', group: 'Architecture', solid: true },
  { kind: 'column-tall', label: 'Tall column', symbol: 'I', group: 'Architecture', solid: true },
  { kind: 'wall-low', label: 'Low wall', symbol: '=', group: 'Architecture', solid: true },
  { kind: 'wall-broken', label: 'Broken wall', symbol: '%', group: 'Architecture', solid: true },
  { kind: 'rubble-small', label: 'Small rubble', symbol: '.', group: 'Architecture', solid: true },
  { kind: 'rubble-large', label: 'Large rubble', symbol: ':', group: 'Architecture', solid: true },
  ...PILLAR_DEFINITIONS,
].map(Object.freeze));

export const PROP_KINDS = new Set(PROP_CATALOG.map(({ kind }) => kind));
const definitions = new Map(PROP_CATALOG.map((definition) => [definition.kind, definition]));
export const propDefinition = (kind) => definitions.get(kind);

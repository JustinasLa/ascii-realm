// Every glyph pack, in atlas order. Each domain of the world owns one file
// so its art can grow without touching the others.

import { CORE } from './core.js';
import { EFFECTS } from './effects.js';
import { FLORA } from './flora.js';
import { PROPS } from './props.js';
import { TERRAIN } from './terrain.js';
import { TREES } from './trees.js';
import { WATER } from './water.js';

export const PACKS = [CORE, TERRAIN, WATER, FLORA, TREES, PROPS, EFFECTS];

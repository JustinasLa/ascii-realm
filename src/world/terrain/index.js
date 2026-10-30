// One shader per terrain type, indexed by the type constants in world.js.
// Each exports shade(out, o, chunk, i, wx, wy, seed, t, wind), which writes
// one ground cell, and animated(chunk, i, wx, wy, seed), true for cells that
// must be reshaded every frame instead of once per chunk.

import * as bog from './bog.js';
import * as dirt from './dirt.js';
import * as meadow from './meadow.js';
import * as shore from './shore.js';
import * as stone from './stone.js';
import * as water from './water.js';

// WATER, SHORE, GRASS, DIRT, STONE, BOG
export const TERRAIN_SHADERS = [water, shore, meadow, dirt, stone, bog];

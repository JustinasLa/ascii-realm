// The colours of the night, shared by everything that draws the world so each
// material keeps one readable hue: a deep navy for gaps and shadow, blue-grey
// stone, teal moonlit leaves over warm wood, and navy water that holds pale
// reflections. Colours are 0-255 rgb triples.

// Empty ground between things, and what the screen fades into at its edges.
export const NIGHT = [10, 9, 20];
export const VIGNETTE = [5, 4, 12];

// Ground fog: a cold grey where it is thin, a pale moonlit white in the
// thick of a bank, and near white where walkers have piled it up.
export const FOG = [184, 204, 226];
export const FOG_THIN = [104, 122, 148];
export const FOG_PILED = [214, 228, 242];

// The moon lights the tops of things with a pale, slightly minty white; the
// undersides fall into a cool shade rather than toward black.
export const MOONLIGHT = [200, 222, 236];
export const MOON_RIM = [128, 186, 226];
export const SHADE = [10, 20, 40];

// Leaves of every species are pulled part of the way toward this teal, which
// cools the whole canopy without losing the difference between species.
export const FOLIAGE_TINT = [78, 130, 166];
export const FOLIAGE_TINT_AMOUNT = 0.55;

// Rock: lavender-grey, from a crack in deep shadow up to a moonlit face.
export const STONE_DARK = [26, 24, 40];
export const STONE_MID = [110, 104, 134];
export const STONE_LIT = [158, 154, 184];
export const STONE_GAP = [13, 12, 24];
export const MOSS = [62, 112, 104];

// Loose ground at the water's edge and along paths.
export const PEBBLES = [92, 96, 116];
export const PEBBLE_GAP = [12, 12, 22];
export const PATH = [138, 102, 66];
export const PATH_GAP = [17, 12, 16];

// Water: streaks of moonlit swell over a navy that deepens away from shore,
// with a pale line of foam where it laps the bank.
export const SWELL = [70, 92, 146];
export const FOAM = [150, 170, 200];
export const WATER_SHALLOW = [13, 15, 34];
export const WATER_DEEP = [6, 6, 19];
// Reflections are dimmed, a little washed out and lifted toward the water.
export const REFLECTION_TINT = [9, 12, 30];

// The sky as seen in the water.
export const MOON = [228, 232, 242];
export const STARLIGHT = [182, 192, 228];

// Daylight is a grade over the finished night scene: a lift of each channel
// that never clips, a saturation and the colour and strength of the edges'
// fade. Night is the identity, so it looks as it always has; the day's warm
// lift cancels the night's blue, and the gaps between glyphs stay dark.
export const GRADE_NIGHT = { gain: [1, 1, 1], sat: 1, edge: VIGNETTE, vignette: 0.7 };
export const GRADE_DAY = { gain: [3.6, 3.8, 2.4], sat: 1.2, edge: [16, 18, 14], vignette: 0.45 };
export const GRADE_DAWN = { gain: [2.6, 1.9, 1.7], sat: 1.15, edge: [14, 8, 18], vignette: 0.6 };
export const GRADE_DUSK = { gain: [2.8, 1.8, 1.2], sat: 1.2, edge: [14, 7, 8], vignette: 0.6 };
// The sun's glare and glints on the water, and the warm glow over the water
// at dawn and dusk.
export const SUN = [255, 236, 196];
export const AFTERGLOW_DAWN = [236, 150, 178];
export const AFTERGLOW_DUSK = [242, 128, 72];

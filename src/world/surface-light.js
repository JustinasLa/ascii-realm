// How warm light (a torch, a fire, a bright spell) falls on a surface that
// faces a way: the rocks and riverbed stones. Everything else takes a
// light's warmth evenly; a stone's face turned to the light takes all of
// it, its back only a dim share, and a wet stone catches a sharp glint.
//
// Shading is done in the world's frame: x east and y south along the
// ground, both in row units, and z up. A light stands at a height over its
// ground point. A stone is lit against the ground: a surface facing up, as
// the ground does, takes exactly the even light everything else gets
// wherever the light stands, so flat ground looks as it always did.
//
// A surface's normal is kept in two bytes (x and y as signed bytes, z
// implied: the faces we see never turn down), and how glossy it is in a
// third, 0 meaning "no normal: light it evenly".

// Where the moon is, in the screen's frame (x right, y down the screen, z
// toward the viewer; not normalised): up and to the left, in front. The
// rocks are lit by it, and trees' shadows fall away from it.
export const MOON = Object.freeze([-0.5, -0.72, 0.48]);

// The share of a light a face turned away from it still gets, and the share
// a face turns into by facing it. A face turned the way the ground is
// takes AMBIENT + DIFFUSE = 1, the even light the ground beside it gets.
export const AMBIENT = 0.22;
export const DIFFUSE = 1 - AMBIENT;
// A face turned further toward the light than the ground is takes more
// than the ground, up to this many times the facing share: a low fire
// lights the sides of stones turned to it well beyond the flat bed.
export const RAKE_MAX = 1.5;
// The ground's own facing is never taken as less than this, so a light
// level with the ground divides by no zero (RAKE_MAX caps the share).
const GROUND_MIN = 1e-3;
// How bright and how tight a glint is: a dry rock shows a broad faint
// sheen, a wet stone a small bright spark.
export const SPEC_GAIN = 4;
export const SPEC_POWER_DRY = 6;
export const SPEC_POWER_WET = 28;
// A riverbed stone is a whole pebble to a glyph: some part of its round
// back always turns to the light, so its glint is broader.
export const PEBBLE_SHARPNESS = 0.35;
// A glint is a warm near-white rather than more of the light's orange, so
// it reads as wet. It follows the light's own strength and flicker.
export const GLINT = [255, 214, 130];
// The colour a rock's small letters take where a warm light outshines the
// moon on them, how fast they turn to it with the light they take, and how
// far at most (see AsciiRenderer.lightFineLit).
export const LIT_INK = [255, 196, 96];
export const TINT = 1.4;
export const TINT_MAX = 0.8;
// How glossy each kind of stone is.
export const GLOSS_DRY = 0.15;
export const GLOSS_DAMP = 0.4;
export const GLOSS_SUBMERGED = 0.55;
export const GLOSS_WET = 1;
// The way to the viewer: the camera looks down on the land from the south
// (see rig.js), and its tilt turns the screen's "toward me" into this.
export const VIEW_C = 0.8;
export const VIEW_S = 0.6;
// Lights at ground level (a spell burst) still stand a little over it, so
// they rake across stones instead of only grazing them.
export const MIN_LIGHT_HEIGHT = 1;

// A gloss as its byte, 1-255 (0 is kept for "no normal"), and back.
export const glossByte = (gloss) => Math.max(1, Math.min(255, Math.round(gloss * 255)));
export const glossOf = (byte) => byte / 255;

// A unit normal's x or y as a byte (signed, offset by 128), and back.
export const normalByte = (v) => Math.max(1, Math.min(255, Math.round(v * 127) + 128));
export const normalOf = (byte) => (byte - 128) / 127;

// A normal in the screen's frame (x right, y down the screen, z toward the
// viewer) turned into the world's. Faces turned to the ground are tipped
// up to level: no light below the ground reaches them anyway.
export function worldNormal(nx, ny, nz) {
  const x = nx;
  const y = VIEW_C * ny + VIEW_S * nz;
  const z = Math.max(0, VIEW_C * nz - VIEW_S * ny);
  const k = Math.hypot(x, y, z) || 1;
  return [x / k, y / k, z / k];
}

// Fills `out` with { diffuse, spec } for a unit normal (nx, ny, implied
// nz) lit from the offset (lx, ly, lz) toward the light, not normalised,
// with a byte gloss. diffuse is the share of the light the face takes:
// how much it faces the light against how much the ground does (AMBIENT
// to AMBIENT + DIFFUSE * RAKE_MAX); spec the glint's strength, its lobe
// narrowed or widened by `sharpness`.
const VIEW_LEN = Math.hypot(VIEW_S, VIEW_C);
const VX = 0, VY = VIEW_S / VIEW_LEN, VZ = VIEW_C / VIEW_LEN;
export function shadeFactors(nx, ny, lx, ly, lz, gloss8, out = { diffuse: 0, spec: 0 }, sharpness = 1) {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const len = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
  lx /= len; ly /= len; lz /= len;
  const facing = nx * lx + ny * ly + nz * lz;
  // The ground's facing is lz: everything without a normal takes the
  // light as the ground does, so a stone is lit against it.
  const rel = facing > 0 ? facing / (lz > GROUND_MIN ? lz : GROUND_MIN) : 0;
  out.diffuse = AMBIENT + DIFFUSE * (rel < RAKE_MAX ? rel : RAKE_MAX);
  out.spec = 0;
  if (facing <= 0) return out;
  // Blinn-Phong: the glint is brightest where the face is halfway between
  // the light and the viewer.
  const hx = lx + VX, hy = ly + VY, hz = lz + VZ;
  const h = (nx * hx + ny * hy + nz * hz) / Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (h <= 0) return out;
  const gloss = gloss8 / 255;
  out.spec = SPEC_GAIN * gloss * h ** ((SPEC_POWER_DRY + (SPEC_POWER_WET - SPEC_POWER_DRY) * gloss) * sharpness);
  return out;
}

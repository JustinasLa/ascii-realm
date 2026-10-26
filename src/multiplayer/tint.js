// Name colours. A player may pick one colour for their name, or keep the
// automatic one their lobby gives them. The page and the lobby server share
// this module, so both clean a colour the same way and make it readable on
// every surface that shows it.

// The automatic colours, one per lobby slot. No two are closer than
// MIN_DELTA_E, so players who keep theirs never look alike.
export const PLAYER_COLORS = [
  [169, 212, 174], [146, 198, 235], [224, 176, 229], [239, 207, 151],
  [237, 162, 155], [149, 220, 208], [183, 180, 237], [220, 230, 145],
];
// Your own nameplate's colour while playing solo.
export const SOLO_COLOR = [212, 218, 228];

export const MIN_CONTRAST = 4.5;
// style.css .nameplate: the opaque backdrop of a nameplate. Nameplates are
// text in a layer over the scene, so the fog and the darkened screen edges
// never reach them and this is the only colour behind their letters.
export const NAMEPLATE_BACKDROP = [10, 9, 19];
// The brightest colour the renderer draws: the white ends of the frost and
// water spells' colour ramps (spells/presentations: frozen-tomb.js,
// crashing-wave.js, cold-embrace.js). A translucent panel over it is the
// worst case for a name.
export const BRIGHTEST_SCENE = [255, 255, 255];
// style.css --surface: the chat lines, the open chat log and the party
// frames sit on it, over the scene.
export const PANEL_SHADE = [6, 9, 10, 0.88];
// An open panel and the phone menu's sheet, which hold the player list and
// the picker's samples.
export const OPEN_PANEL_SHADE = [6, 9, 10, 0.97];

const over = ([r, g, b, alpha], under) => [r, g, b].map((c, i) => c * alpha + under[i] * (1 - alpha));
// Every surface a name colour is drawn on, at its least readable.
export const SURFACES = Object.freeze({
  nameplate: NAMEPLATE_BACKDROP,
  chatLine: over(PANEL_SHADE, BRIGHTEST_SCENE),
  chatLog: over(PANEL_SHADE, BRIGHTEST_SCENE),
  partyFrame: over(PANEL_SHADE, BRIGHTEST_SCENE),
  playerList: over(OPEN_PANEL_SHADE, BRIGHTEST_SCENE),
});

const HEX = /^[0-9a-f]{6}$/;
// The one form a colour takes on the network.
const WIRE = /^#[0-9a-f]{6}$/i;

export function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export function rgbHex(rgb) {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const linear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const encode = (v) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));

// WCAG relative luminance and contrast ratio.
export function luminance(rgb) {
  const [r, g, b] = rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The lowest contrast a colour has against any surface.
export function worstContrast(rgb) {
  return Math.min(...Object.values(SURFACES).map((surface) => contrast(rgb, surface)));
}

export function toOklab(rgb) {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

export function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(encode);
}

// A colour too dark to read on some surface is lightened, not refused: its
// OKLab lightness rises in small steps, keeping its hue, until it reads on
// all of them. The first (darkest) step that does is kept, so a colour that
// already reads comes back as it was.
export function readableTint(hex) {
  const rgb = hexRgb(hex);
  if (worstContrast(rgb) >= MIN_CONTRAST) return hex;
  const [L, a, b] = toOklab(rgb);
  for (let step = 1; ; step++) {
    const lifted = fromOklab([Math.min(1, L + step * 0.005), a, b]);
    if (worstContrast(lifted) >= MIN_CONTRAST) return rgbHex(lifted);
  }
}

// A hex colour as players type it: six hex digits, with or without a
// leading #, any case, spaces around it, as '#rrggbb'. Anything else is no
// colour. Only the page uses it, before a colour is sent.
export function normalHex(raw) {
  if (typeof raw !== 'string' || raw.length > 16) return null;
  const digits = raw.trim().replace(/^#/, '').toLowerCase();
  return HEX.test(digits) ? `#${digits}` : null;
}

// The one parser for colours that cross the network: exactly '#rrggbb' (in
// either case), made readable, or null for the automatic colour.
export function parseTint(raw) {
  return typeof raw === 'string' && WIRE.test(raw) ? readableTint(raw.toLowerCase()) : null;
}

// The named colours, in the order the picker shows them. Black is left out:
// lightened to read at night it would be Dark Gray.
const NAMED = [
  ['dark_blue', 'Dark Blue', '#0000aa'], ['dark_green', 'Dark Green', '#00aa00'],
  ['dark_aqua', 'Dark Aqua', '#00aaaa'], ['dark_red', 'Dark Red', '#aa0000'],
  ['dark_purple', 'Dark Purple', '#aa00aa'], ['gold', 'Gold', '#ffaa00'],
  ['gray', 'Gray', '#aaaaaa'], ['dark_gray', 'Dark Gray', '#555555'],
  ['blue', 'Blue', '#5555ff'], ['green', 'Green', '#55ff55'], ['aqua', 'Aqua', '#55ffff'],
  ['red', 'Red', '#ff5555'], ['light_purple', 'Light Purple', '#ff55ff'],
  ['yellow', 'Yellow', '#ffff55'], ['white', 'White', '#ffffff'],
];
export const NAME_COLOURS = Object.freeze(NAMED.map(([id, label, vanilla]) =>
  Object.freeze({ id, label, vanilla, hex: readableTint(vanilla) })));
const BY_ID = Object.fromEntries(NAME_COLOURS.map((colour) => [colour.id, colour.hex]));

// A named colour's id ('dark_aqua'), as the page's ?tint= accepts it. This
// is resolved on the page; the server only ever takes hex.
export function tintFromAlias(id) {
  return typeof id === 'string' && Object.hasOwn(BY_ID, id) ? BY_ID[id] : null;
}

export function autoColour(color) {
  return PLAYER_COLORS[color % PLAYER_COLORS.length];
}

// The colour a lobby member's name shows in.
export function memberColour(member) {
  return member.tint ? hexRgb(member.tint) : autoColour(member.color);
}

export function toLab(rgb) {
  const [r, g, b] = rgb.map(linear);
  const f = (t) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
  const z = f((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const degrees = (radians) => radians * 180 / Math.PI;
const radians = (deg) => deg * Math.PI / 180;

// The CIEDE2000 colour difference between two CIELAB colours.
export function labDeltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const [p1, p2] = [a1 * (1 + G), a2 * (1 + G)];
  const [C1, C2] = [Math.hypot(p1, b1), Math.hypot(p2, b2)];
  const hue = (b, a) => (a === 0 && b === 0 ? 0 : (degrees(Math.atan2(b, a)) + 360) % 360);
  const [h1, h2] = [hue(b1, p1), hue(b2, p2)];
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = 0;
  if (C1 * C2 !== 0) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin(radians(dh / 2));
  const L = (L1 + L2) / 2;
  const C = (C1 + C2) / 2;
  let H = h1 + h2;
  if (C1 * C2 !== 0) H = Math.abs(h1 - h2) <= 180 ? H / 2 : H < 360 ? (H + 360) / 2 : (H - 360) / 2;
  const T = 1 - 0.17 * Math.cos(radians(H - 30)) + 0.24 * Math.cos(radians(2 * H))
    + 0.32 * Math.cos(radians(3 * H + 6)) - 0.20 * Math.cos(radians(4 * H - 63));
  const SL = 1 + 0.015 * (L - 50) ** 2 / Math.sqrt(20 + (L - 50) ** 2);
  const SC = 1 + 0.045 * C;
  const SH = 1 + 0.015 * C * T;
  const RT = -2 * Math.sqrt(C ** 7 / (C ** 7 + 25 ** 7)) * Math.sin(radians(60 * Math.exp(-(((H - 275) / 25) ** 2))));
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

export function deltaE2000(rgbA, rgbB) {
  return labDeltaE2000(toLab(rgbA), toLab(rgbB));
}

// Closer than this, two names in different colours could pass for one.
export const MIN_DELTA_E = 10;
const tooClose = (a, b) => deltaE2000(a, b) < MIN_DELTA_E;

// The colours a same-named player may be moved to: the automatic ones
// first, then the named ones.
const SPARES = [...PLAYER_COLORS, ...NAME_COLOURS.map((colour) => hexRgb(colour.hex))];

// The colour each lobby member is shown in, for `players` in join order. A
// member who shares an earlier member's name (in any case) and whose colour
// would look the same as theirs is shown in the first spare colour that
// looks different from every earlier member of that name. Should every
// spare look like one of them (custom colours can crowd them out), the one
// least like them all is used, and the member's name tag, "Ash (2)", is
// what tells them apart. Everyone else keeps their own: friends may share a
// colour. Returns, per member, the hex to show, or null for their own
// automatic colour.
export function resolveTints(players) {
  const shown = [];
  return players.map((player) => {
    const name = player.name.toLowerCase();
    const earlier = shown.filter((other) => other.name === name).map((other) => other.rgb);
    let rgb = memberColour(player);
    let tint = player.tint;
    if (earlier.some((other) => tooClose(rgb, other))) {
      const nearest = (colour) => Math.min(...earlier.map((other) => deltaE2000(colour, other)));
      const distances = SPARES.map(nearest);
      const free = distances.findIndex((distance) => distance >= MIN_DELTA_E);
      rgb = SPARES[free >= 0 ? free : distances.indexOf(Math.max(...distances))];
      tint = rgbHex(rgb);
    }
    shown.push({ name, rgb });
    return tint;
  });
}

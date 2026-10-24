// Which character each detail glyph is shown as (see asciify in glyphs.js).
// Glyphs not named here become the character whose shape matches their
// drawing best. A rule gives one character, several to spread over the
// glyphs of a family (picked by name, so a glyph keeps its character), or
// '' to leave the glyph empty.

// Materials drawn by tone, dark to lit: `${family}.${tone}.${variant}`.
const TONES = {
  // Even rock in shadow is solid characters, so a boulder reads as one mass.
  stone: ['=+', 'oce', 'O0Q', '8&$', '#@M'],
  bark: [':.', 'il|', 'oxa', 'hbdQ', '&$@'],
  barkh: [':.', '-=', 'oxa', 'hbdQ', '&$@'],
  birch: [':.', '-=', 'oec', 'bdq', 'O0@'],
  grainv: ['.', ':', '|!', 'Il', 'H#'],
  grainh: ['.', '-', '=-', '=', '#'],
  canvas: ['.', ':', '+', 'x#', '#H'],
  leaves: ['.,', ':;', 'oc', 'O0Q', '@&'],
  needles: [".'", ',;', '^*', '*x', '#%'],
};

// River foam streaks by their direction on screen (along the rows, rising
// to the right, down the screen, falling to the right), light to heavy.
const STREAKS = [['-', '~', '='], ['/', '/', '/'], ["'", '!', '|'], ['\\', '\\', '\\']];

// Outline edges by the side the object lies on: east, then clockwise.
const EDGES = ['(', '/', '_', '\\', ')', '/', '-', '\\'];

const ITEMS = {
  flint: '^', stick: '/', leaf: '%', cap: 'n', stem: '|', spots: ':', reed: '|', clay: 'o',
  straw: '"', fibre: '~', log: '=', logend: 'o', ore: '*', glints: "'", blade: '/', hilt: '+',
  bow: ')', shaft: '/', head: '^', hammerhead: 'T', flask: 'u', liquid: '~', roll: '@',
};

// A blade keeps its physical lean, expressed with ordinary font characters.
export function grassCharacter(bottom, top, tip = 0) {
  const lean = top - bottom;
  if (lean > 1) return '/';
  if (lean < -1) return '\\';
  return tip === 2 ? "'" : '|';
}

export const ASCII_RULES = [
  [/^veil\./, ''],
  [/^block\.full$/, '#'],
  [/^(dot|speck)\./, '.'],
  [/^sparkle\./, '+'],
  [/(^|\.)flower\.(ring|eye|cup|bell|small)/, '*'],
  [/^flower\.spray/, "*'."],
  [/(^|\.)(pebble|gravel)\./, 'o'],
  [/^(leaf|leaflet)\./, ",'`"],
  [/^moss\./, '"'],
  [/^bark\./, 'Q&$'],

  // Flowers in the grass are bright stars; their eyes would only smudge them.
  [/^flora\.stem\.(\d+)\.(\d+)$/, (m) => grassCharacter(Number(m[1]), Number(m[2]))],
  [/^flora\.[a-z.0-9]*eye/, ''],
  [/^flora\.seed\./, ';'],
  [/^flora\.foxglove\.throat/, ''],
  [/^flora\.(lupin|foxglove)\.mid/, ':'],
  [/^flora\.bluebell\./, 'o'],
  [/^flora\.[a-z.0-9]*@/, '*'],
  [/^flora\.dew/, '.'],
  [/^flora\.frond\.tip/, "'"],
  [/^flora\.frond/, '%'],

  [/^tree\.fall/, ",'`"],
  [/^tree\.litter/, ",'."],

  // Lily pads are round leaves, their flowers stars.
  [/^water\.pad/, 'o'],
  [/^water\.bloom/, '*'],
  [/^water\.(star|glitter)/, '*+'],
  // The river's current: foam streaks lie along the flow, heavier toward
  // the head of each streak.
  [/^water\.streak\.(\d)\.(\d)$/, (m) => STREAKS[Number(m[1])][Number(m[2])]],
  [/^water\.riffle\.(\d)$/, (m) => '~^,~'[Number(m[1])]],
  [/^water\.eddy\.(\d)$/, (m) => 'c()'[Number(m[1])]],
  [/^water\.vee\.(\d)$/, (m) => '-/|\\'[Number(m[1])]],

  [/^props\.(stone|bark|barkh|birch|grainv|grainh|canvas|leaves|needles)\.(\d)\./,
    (m) => TONES[m[1]][Math.min(4, Number(m[2]))]],
  [/^props\.cut\.[sr]\.(\d)\./, (m) => EDGES[Number(m[1])]],
  [/^props\.shade/, ''],
  [/^props\.strip/, '|'],
  // Facet ridges would break a boulder's face into dashes; the stone shows.
  [/^props\.ridge/, ''],
  [/^props\.moss/, '"'],
  [/^props\.lichen/, '*'],
  [/^props\.fungus/, 'n'],
  [/^props\.chips/, ',.'],
  [/^props\.seam/, '-'],
  [/^props\.ring\./, 'O0@'],
  [/^props\.ringcore/, '@'],
  [/^props\.flame/, '&%$'],
  [/^props\.char/, '#'],
  [/^props\.embers/, ".'"],
  [/^props\.berry/, 'o'],
  [/^props\.fork/, 'Y'],
  [/^props\.stubble/, ','],
  [/^props\.cap\.0/, '('],
  [/^props\.cap\.1/, '@'],
  [/^props\.cap\.2/, ')'],
  [/^props\.capspots/, ':'],
  [/^props\.stem/, '|'],
  [/^props\.nails/, '.'],
  [/^props\.hoop/, 'O'],
  [/^props\.lash/, 'x'],
  [/^props\.peg/, '|'],
  [/^props\.item\.([a-z]+)/, (m) => ITEMS[m[1]]],

  // Fire: a heavy heart, licking tongues and flying sparks.
  [/^effects\.flame\.core/, '@#'],
  [/^effects\.flame\.(body|s)/, '&%$8'],
  [/^effects\.flame\.tip/, "^*'"],
  [/^effects\.flame\.lick/, ",'`"],
  [/^effects\.smoke/, '~-'],
  [/^effects\.(ember|spark)/, ".'*"],
  [/^effects\.coal/, 'o@'],
  [/^effects\.(log|logglow)/, '='],
  [/^effects\.stone/, 'oO'],
  [/^effects\.puff/, 'o~'],
  [/^effects\.wisp/, '~'],
  [/^effects\.halo\./, ''],
  [/^effects\.mist/, ''],
  [/^effects\.(fly|mote)/, '.*'],
  [/^effects\.moth/, 'v'],
  [/^effects\.bat\./, 'vw^'],
  [/^effects\.batrim/, ''],
  [/^effects\.boot\./, '.,'],
  [/^effects\.bootrim/, ''],
  [/^effects\.rain/, '/'],
  [/^effects\.drizzle/, "'."],
  [/^effects\.(flake|crown)/, '*'],
  [/^effects\.settled/, '.'],
  [/^effects\.hail/, 'o'],
];

function nameHash(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The character a rule gives the glyph, or undefined when no rule names it.
export function ruleFor(name) {
  for (const [re, value] of ASCII_RULES) {
    const m = re.exec(name);
    if (!m) continue;
    const chars = typeof value === 'function' ? value(m) : value;
    if (chars === undefined || chars.length <= 1) return chars;
    return chars[nameHash(name) % chars.length];
  }
  return undefined;
}

import { fbm, valueNoise } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { blocks, createProp, treeSpeciesAt } from './props.js';
import { paleCaps } from './pale-caps.js';
import { makeTree } from './trees.js';
import { ASPECT, GRASS } from './world.js';

// How thickly woods grow. The sparse world is the default; a dense one grows
// groves: a few more trees where the forest is thick, a flowered sward around
// each mature trunk and clusters of pale caps in the trees' shade, with the
// ground between neighbouring trunks left open to walk through.
export const WOODLANDS = Object.freeze(['sparse', 'dense']);

export const GROVE = Object.freeze({
  step: Object.freeze([32, 22]), // grove-tree grid slot, cells × rows (2 × 3 slots a chunk)
  margin: Object.freeze([4, 2]), // a slot's tree keeps this far inside it
  forestFrom: 0.5, // the forest noise sparse trees follow, from where groves begin
  forestGain: 2.4, // chance = clamp((forest - forestFrom) * gain, 0, chanceMax)
  chanceMax: 0.55,
  maxTreesPerChunk: 2, // 0 grows the undergrowth around the sparse trees only
  treeGap: Object.freeze([32, 10]), // trees conflict when |dx| < 32 cells and |dy| < 10 rows
  spawnClear: 42, // grove trees and caps keep out of the spawn clearing
  skirt: Object.freeze([14, 5]), // ground cover beyond the largest foot, cells × rows
  clusters: Object.freeze([2, 4]), // pale-cap clusters a tree
  clumps: Object.freeze([1, 3]), // clumps a cluster
  ring: Object.freeze([1.2, 1.9]), // cluster distance in foot radii, plus 2 cells / 1 row
  scale: Object.freeze([0.6, 1.25]), // pale-cap sizes, the larger nearer a cluster's heart
  laneHalfAngle: 20, // degrees of clusters skipped toward a neighbouring tree within laneReach
  laneReach: 36, // ground units (60 cells across)
  laneClear: 3, // ground units kept clear either side of the line between two trunks
  maxClumpsPerChunk: 40,
});

// Generated props a chunk may number: sparse ≤ 9, grove trees ≤ 2, clumps ≤ 40.
export const MAX_CHUNK_PROPS = 64;

// The largest trunk foot a generated tree can have, from the tree generator's
// own ranges (trees.js): the broadest species foot (2.4 × 1.3), a mature
// crown's widest spread (2.8; feet are 1.45 × deeper) and the oldest girth (2).
export const TREE_FOOT_MAX = 2.4 * 2.8 * 2;
export const TREE_FOOTH_MAX = 1.3 * 1.45 * Math.SQRT2;
// The largest scattered rock's foot (props.js makeRock: rx < 5.8, divided by
// ASPECT, which world.js cannot lend this module while it loads).
export const ROCK_FOOT_MAX = (2.6 + 3.2) / 0.6;

// Every random stream here is seeded the way generateProps seeds its own:
// hash2 gives [0, 1), and mulberry32 wants a 32-bit integer.
export const rngSeed = (a, b, seed) => Math.floor(hash2(a, b, seed) * 2 ** 32);

const SPARSE_STEP = [42, 28];
const smoothstep = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const config = (world) => world.grove ?? GROVE;
const spawnDistance = (world, x, y) => Math.hypot((x - world.spawn.x) * ASPECT, y - world.spawn.y);

// The world's woodland choice from the page address: ?woodland=dense grows
// groves, ?flora=1 or 0 turns wild flowers on or off (dense brings them
// unless ?flora=0). Lobbies share one world, so a page in a lobby is sparse.
export function woodlandOptions(params, { inLobby = false } = {}) {
  const woodland = !inLobby && params.get('woodland') === 'dense' ? 'dense' : 'sparse';
  const flora = { 1: true, true: true, 0: false, false: false }[params.get('flora')];
  return flora === undefined ? { woodland } : { woodland, flora };
}

// The mature trees generateProps may grow in a chunk, replayed draw for draw
// up to the tree itself, which is never baked here. Its big-rock and river
// rejections are left out, so a site may have no tree: it only gets a little
// more ground cover.
function sparseSites(world, cx, cy, size) {
  const out = [];
  const seed = world.seed;
  for (let gy = 0; gy < size; gy += SPARSE_STEP[1]) {
    for (let gx = 0; gx < size; gx += SPARSE_STEP[0]) {
      const ox = cx * size + gx;
      const oy = cy * size + gy;
      const rand = mulberry32(rngSeed(ox, oy, seed + 61));
      const x = ox + Math.floor(rand() * Math.min(SPARSE_STEP[0], size - gx));
      const y = oy + Math.floor(rand() * Math.min(SPARSE_STEP[1], size - gy));
      if (world.landTypeAt(x, y) !== GRASS || spawnDistance(world, x + 0.5, y + 0.5) < 36) continue;
      const forest = fbm(x * ASPECT * 0.01, y * 0.01, seed + 500, 3);
      if (rand() < Math.max(0, forest - 0.44) * 0.2) out.push({ x: x + 0.5, y: y + 0.5, grove: false });
    }
  }
  return out;
}

// Grove-tree candidates of a chunk: one jittered point a slot, kept where the
// forest is thick, on grass and away from spawn.
function groveCandidates(world, cx, cy, size) {
  const g = config(world);
  const out = [];
  const seed = world.seed;
  let slot = 0;
  for (let gy = 0; gy < size; gy += g.step[1]) {
    for (let gx = 0; gx < size; gx += g.step[0], slot++) {
      const ox = cx * size + gx;
      const oy = cy * size + gy;
      const w = Math.min(g.step[0], size - gx) - 2 * g.margin[0];
      const h = Math.min(g.step[1], size - gy) - 2 * g.margin[1];
      const rand = mulberry32(rngSeed(ox, oy, seed + 2301));
      const x = ox + g.margin[0] + Math.floor(rand() * Math.max(1, w));
      const y = oy + g.margin[1] + Math.floor(rand() * Math.max(1, h));
      const forest = fbm(x * ASPECT * 0.01, y * 0.01, seed + 500, 3);
      const chance = Math.max(0, Math.min(g.chanceMax, (forest - g.forestFrom) * g.forestGain));
      if (rand() >= chance) continue;
      if (world.landTypeAt(x, y) !== GRASS || spawnDistance(world, x + 0.5, y + 0.5) < g.spawnClear) continue;
      out.push({ x: x + 0.5, y: y + 0.5, grove: true, key: [cy, cx, slot] });
    }
  }
  return out;
}

const before = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const conflicts = (g, a, b) => Math.abs(a.x - b.x) < g.treeGap[0] && Math.abs(a.y - b.y) < g.treeGap[1];

// Site lists are pure functions of the world, so each is kept per world.
function cached(world, key, make) {
  const cache = world.siteCache;
  if (!cache) return make();
  let value = cache.get(key);
  if (!value) {
    if (cache.size >= 1024) cache.clear();
    cache.set(key, value = make());
  }
  return value;
}

// A chunk's tree sites, sparse and grove, as pure positions: nothing is
// baked. A grove candidate stands only if it keeps treeGap from every sparse
// site and from every grove candidate before it (whether or not that one
// stood), so the rule needs no chain of decisions across chunks; the first
// maxTreesPerChunk in slot order are kept.
export function treeSites(world, cx, cy, size) {
  return cached(world, `t${cx},${cy}`, () => {
    const g = config(world);
    const sparse = [];
    const candidates = [];
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        sparse.push(...cached(world, `s${x},${y}`, () => sparseSites(world, x, y, size)));
        candidates.push(...cached(world, `g${x},${y}`, () => groveCandidates(world, x, y, size)));
      }
    }
    const own = cached(world, `g${cx},${cy}`, () => groveCandidates(world, cx, cy, size));
    const grove = own.filter((site) => !sparse.some((other) => conflicts(g, site, other))
      && !candidates.some((other) => before(other.key, site.key) < 0 && conflicts(g, site, other)))
      .slice(0, g.maxTreesPerChunk);
    return [...cached(world, `s${cx},${cy}`, () => sparseSites(world, cx, cy, size)), ...grove];
  });
}

// The tree sites of a chunk and the eight around it.
export function sitesAround(world, cx, cy, size) {
  const out = [];
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) out.push(...treeSites(world, x, y, size));
  }
  return out;
}

// How strongly a grove grows on each cell of a chunk, 0-255, or null when no
// tree is near. Around each mature trunk the sward thickens and flowers; its
// heart sits a little toward the shade the moon (upper left) leaves, and its
// rim is ragged and patchy rather than a disc.
export function groveField(world, cx, cy, size) {
  const g = config(world);
  const seed = world.seed;
  const rx = TREE_FOOT_MAX + g.skirt[0];
  const ry = TREE_FOOTH_MAX + g.skirt[1];
  const x0 = cx * size;
  const y0 = cy * size;
  let field = null;
  for (const site of sitesAround(world, cx, cy, size)) {
    const ox = site.x + 2;
    const oy = site.y + 0.6;
    const ax = Math.max(x0, Math.floor(ox - rx * 1.3));
    const bx = Math.min(x0 + size - 1, Math.ceil(ox + rx * 1.3));
    const ay = Math.max(y0, Math.floor(oy - ry * 1.3));
    const by = Math.min(y0 + size - 1, Math.ceil(oy + ry * 1.3));
    if (ax > bx || ay > by) continue;
    field ??= new Uint8Array(size * size);
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        const d = Math.hypot((x + 0.5 - ox) / rx, (y + 0.5 - oy) / ry);
        const edge = 0.7 + 0.6 * valueNoise(x * ASPECT * 0.15, y * 0.15, seed + 2424);
        if (d >= edge) continue;
        const patchy = 0.55 + 0.45 * valueNoise(x * ASPECT * 0.3, y * 0.3, seed + 2425);
        const v = Math.round(smoothstep(edge, 0.35 * edge, d) * patchy * 255);
        const i = (y - y0) * size + x - x0;
        if (v > field[i]) field[i] = v;
      }
    }
  }
  return field;
}

// Generated solids of the eight chunks around one, as conservative shapes
// worked out from the generators' own draws and ranges, without generating
// those chunks. Big rocks replay their first draws for the exact foot; their
// fragments, which come later in the stream, get a box covering every place
// they can fall. Trees get the largest foot at every site.
export function neighbourSolids(world, cx, cy, size) {
  const seed = world.seed;
  const out = [];
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x === cx && y === cy) continue;
      const rand = mulberry32(rngSeed(x, y, seed + 2203));
      if (rand() < 0.3) {
        const bx = x * size + 12 + Math.floor(rand() * (size - 24)) + 0.5;
        const by = y * size + 8 + Math.floor(rand() * (size - 12)) + 0.5;
        const rx = 12 + rand() * 8;
        const ry = rx * (0.58 + rand() * 0.22);
        const footW = rx * 0.9 / ASPECT;
        const footH = Math.max(2, ry * 0.3);
        const reach = footW * 1.15 + 3 + ROCK_FOOT_MAX;
        out.push({ box: true, x0: bx - reach, x1: bx + reach, y0: by - footH, y1: by + 3 + 1.4 + 0.5 });
      }
      for (const site of treeSites(world, x, y, size)) {
        out.push({ box: false, x: site.x, y: site.y, footW: TREE_FOOT_MAX, footH: TREE_FOOTH_MAX });
      }
    }
  }
  return out;
}

const insideShape = (s, x, y) => s.box ? x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1
  : ((x - s.x) / s.footW) ** 2 + ((y - s.y) / s.footH) ** 2 < 1;

// Whether two feet (ellipses) overlap, the first grown by a gap: sixteen points
// round each foot tested against the other, both ways, and each centre.
function feetOverlap(a, b, gapX = 0, gapY = 0) {
  const grown = { x: a.x, y: a.y, footW: a.footW + gapX, footH: a.footH + gapY };
  const inside = (s, x, y) => ((x - s.x) / s.footW) ** 2 + ((y - s.y) / s.footH) ** 2 < 1;
  if (inside(grown, b.x, b.y) || inside(b, grown.x, grown.y)) return true;
  for (let k = 0; k < 16; k++) {
    const c = Math.cos(k * Math.PI / 8);
    const s = Math.sin(k * Math.PI / 8);
    if (inside(b, grown.x + c * grown.footW, grown.y + s * grown.footH)) return true;
    if (inside(grown, b.x + c * b.footW, b.y + s * b.footH)) return true;
  }
  return false;
}

// Distance from a point to the segment between two others, on the ground
// (cells corrected for their aspect).
function laneDistance(px, py, a, b) {
  const ax = a.x * ASPECT, bx = b.x * ASPECT, x = px * ASPECT;
  const dx = bx - ax, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, py - a.y - t * dy);
}

// The widest a pale-cap clump made with these options can be, in cells either
// side of its base, before it is made: its caps' reach (pale-caps.js) at the
// largest width variation createProp gives it (1.12).
export function clumpReach(seed, scale) {
  return paleCaps(mulberry32(seed), seed).b / ASPECT * 1.12 * scale;
}

const solidFoot = (p) => p.solid !== false && !(p.kind === 'bush' && p.solid !== true);

// The dense additions to a chunk's generated props, appended after them so the
// sparse props keep their order and ids: grove trees on this chunk's grove
// sites, then clusters of pale caps around every mature tree. Every draw is
// made whether or not what it places is kept, so rejecting one thing never
// moves another.
export function groveProps(world, cx, cy, size, props) {
  const g = config(world);
  const seed = world.seed;
  const keeps = world.keeps ?? (() => true);
  const phantoms = neighbourSolids(world, cx, cy, size);
  const solids = props.filter(solidFoot);
  const added = [];
  const trees = props.filter((p) => p.kind === 'tree' && keeps(p));
  const own = treeSites(world, cx, cy, size).filter((site) => site.grove);
  for (const site of own) {
    // The largest foot this tree could have must clear every solid around it,
    // so no tree is baked only to be thrown away.
    const foot = { x: site.x, y: site.y, footW: TREE_FOOT_MAX + 2, footH: TREE_FOOTH_MAX + 1 };
    if (solids.some((p) => feetOverlap(foot, p))) continue;
    if (phantoms.some((s) => s.box && foot.x + foot.footW > s.x0 && foot.x - foot.footW < s.x1
      && foot.y + foot.footH > s.y0 && foot.y - foot.footH < s.y1)) continue;
    const x = Math.floor(site.x);
    const y = Math.floor(site.y);
    const tree = makeTree(site.x, site.y, mulberry32(rngSeed(x, y, seed + 2311)),
      { species: treeSpeciesAt(world, x, y), season: world.season, seed });
    if (!keeps(tree)) continue;
    added.push(tree);
    solids.push(tree);
    trees.push(tree);
  }
  // Trunks a lane runs between: this chunk's trees and every site around it.
  const ends = [...trees, ...phantoms.filter((s) => !s.box)];
  const lanes = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i], b = ends[j];
      if (Math.hypot((a.x - b.x) * ASPECT, a.y - b.y) <= g.laneReach) lanes.push([a, b]);
    }
  }
  const halfAngle = g.laneHalfAngle * Math.PI / 180;
  const accepted = [];
  for (const t of trees) {
    const rand = mulberry32(rngSeed(Math.floor(t.x * 4), Math.floor(t.y * 4), seed + 2431));
    const count = g.clusters[0] + Math.floor(rand() * (g.clusters[1] - g.clusters[0] + 1));
    // Directions to the trunks near this one, to skip clusters in their lanes early.
    const toward = ends.filter((e) => e !== t && Math.hypot((e.x - t.x) * ASPECT, e.y - t.y) <= g.laneReach)
      .map((e) => Math.atan2(e.y - t.y, (e.x - t.x) * ASPECT));
    for (let k = 0; k < count; k++) {
      // Most clusters grow in the shade to the right of and in front of the trunk.
      const shade = rand() < 0.6;
      const turn = rand();
      const a = shade ? -Math.PI / 4 + turn * Math.PI : turn * Math.PI * 2;
      const u = g.ring[0] + rand() * (g.ring[1] - g.ring[0]);
      const clumps = g.clumps[0] + Math.floor(rand() * (g.clumps[1] - g.clumps[0] + 1));
      const draws = [];
      for (let j = 0; j < g.clumps[1]; j++) draws.push([rand(), rand(), rand(), rand()]);
      const ground = Math.atan2(Math.sin(a), Math.cos(a) * ASPECT);
      if (toward.some((d) => Math.abs(Math.atan2(Math.sin(ground - d), Math.cos(ground - d))) < halfAngle)) continue;
      const hx = t.x + Math.cos(a) * (t.footW * u + 2);
      const hy = Math.min(t.y + Math.sin(a) * (t.footH * u + 1), t.y + t.footH + 2.5);
      for (let j = 0; j < clumps; j++) {
        const [ox, oy, s, jitter] = draws[j];
        const capSeed = Math.floor(s * 2 ** 32);
        // The largest cap stands at the cluster's heart.
        const spread = j ? 1 : 0.4;
        const scale = (g.scale[1] + (g.scale[0] - g.scale[1]) * j / clumps) * (0.9 + jitter * 0.2);
        if (accepted.length >= g.maxClumpsPerChunk) continue;
        // The ring is where a clump's near side stands, so it is set out by its own width.
        const reach = clumpReach(capSeed, scale);
        const x = Math.floor(hx + Math.cos(a) * reach + (ox - 0.5) * 5 * spread) + 0.5;
        const y = Math.floor(hy + (oy - 0.5) * 1.5 * spread) + 0.5;
        if (Math.floor(x / size) !== cx || Math.floor(y / size) !== cy) continue;
        if (world.typeAt(Math.floor(x), Math.floor(y)) !== GRASS) continue;
        if (spawnDistance(world, x, y) < g.spawnClear) continue;
        if (lanes.some(([p, q]) => laneDistance(x, y, p, q) <= g.laneClear)) continue;
        if (accepted.some((c) => Math.abs(c.x - x) < 3 && Math.abs(c.y - y) < 1)) continue;
        const clump = createProp('pale-caps', x, y, { seed: capSeed, scale });
        const outline = [[0, 0], [-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1], [-1, -0.5], [1, -0.5]]
          .map(([dx, dy]) => [x + dx * clump.footW, y + dy * clump.footH]);
        if (outline.some(([px, py]) => solids.some((p) => blocks(p, px, py)
          || (p.kind === 'tree' && insideShape({ x: p.x, y: p.y, footW: p.footW * 1.15, footH: p.footH * 1.15 }, px, py)))
          || phantoms.some((ph) => insideShape(ph, px, py)))) continue;
        accepted.push(clump);
      }
    }
  }
  return [...added, ...accepted];
}

// Dense woods are this page's own: lobbies share the sparse world. A dense
// page asked to join or create a lobby keeps the request, reloads into the
// sparse world without opening a connection, and makes it from there.
export const PENDING_LOBBY = 'ascii-realm-pending-lobby';

export function guardLobbyConnect(client, { dense, storage, reload }) {
  if (!dense) return false;
  client.connect = ({ mode, name, seed, code, server = '' }) => {
    try { storage.setItem(PENDING_LOBBY, JSON.stringify({ mode, name, seed, code, server })); } catch {}
    reload();
  };
  return true;
}

// The lobby request a dense page left before reloading, made now. Returns it,
// or null if there was none.
export function resumePendingLobby(client, storage) {
  let request = null;
  try {
    request = JSON.parse(storage.getItem(PENDING_LOBBY));
    storage.removeItem(PENDING_LOBBY);
  } catch { return null; }
  if (!request || !['create', 'join'].includes(request.mode)) return null;
  const { mode, name, seed, code, server = '' } = request;
  client.connect({ mode, name, seed, code, server });
  return request;
}

// Whether joining a lobby must reload the page: into the lobby's seed, or out
// of a dense world, which lobbies don't share.
export const needsWorldReload = (lobby, seed, woodland) => lobby.seed !== seed || woodland === 'dense';

// The address a lobby's world is played at: its seed and code, the lobby
// server if one was named, and the sparse woods.
export function lobbyWorldUrl(href, lobby, server) {
  const url = new URL(href);
  url.searchParams.set('seed', lobby.seed);
  url.searchParams.set('room', lobby.code);
  if (server) url.searchParams.set('server', server);
  url.searchParams.delete('woodland');
  return url;
}

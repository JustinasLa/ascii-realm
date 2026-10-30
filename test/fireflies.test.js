import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { FINE } from '../src/render/cells.js';
import { glyph } from '../src/render/glyphs.js';
import { BG_KEEP, NIGHT } from '../src/render/palette.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { FADE_IN, Fireflies, WAKE_BAND } from '../src/world/fireflies.js';
import { withLayers } from './helpers/renderer.js';
import { GRASS, STONE } from '../src/world/world.js';

function terrain(type = STONE) {
  return {
    type,
    queries: 0,
    typeAt() {
      this.queries++;
      return this.type;
    },
  };
}

test('failed spawns wait before retrying and never draw invisible placeholders', () => {
  const world = terrain();
  const fireflies = new Fireflies();
  fireflies.update(1 / 60, 0, world, 0, 0, 20, 13);
  const firstQueries = world.queries;
  assert.equal(firstQueries, 4 * 8, 'try each of the four slots only once initially');
  for (let i = 1; i < 60; i++) fireflies.update(1 / 60, i / 60, world, 0, 0, 20, 13);
  assert.equal(world.queries, firstQueries, 'stationary frames do not keep querying barren terrain');

  const r = {
    cols: 40,
    fg: new Uint8ClampedArray(40 * 26 * 4),
    bg: new Uint8ClampedArray(40 * 26 * 4),
    put() { assert.fail('failed spawns must not be drawn'); },
  };
  fireflies.draw(r, { x0: -20, y0: -13, cols: 40, rows: 26 }, 1);
  assert.ok(r.fg.every((v) => v === 0));
  assert.ok(r.bg.every((v) => v === 0));

  fireflies.update(1 / 60, 1, world, 0, 0, 20, 13);
  assert.equal(world.queries, firstQueries * 2, 'retry after the delay');
});

test('failed spawns recover when grass becomes available after the retry delay', () => {
  const world = terrain();
  const fireflies = new Fireflies();
  fireflies.update(0, 0, world, 0, 0, 20, 13);
  world.type = GRASS;
  fireflies.update(0, 1, world, 0, 0, 20, 13);
  assert.equal(world.queries, 4 * 8 + 4);
  assert.equal(fireflies.list.length, 4);
  assert.ok(fireflies.list.every((f) => Number.isFinite(f.phase)));
});

test('camera movement can retry earlier without retrying for tiny camera drift', () => {
  const world = terrain();
  const fireflies = new Fireflies();
  fireflies.update(0, 0, world, 0, 0, 20, 13);
  const firstQueries = world.queries;
  world.type = GRASS;
  fireflies.update(0, 0.1, world, 0.1, 0.1, 20, 13);
  assert.equal(world.queries, firstQueries);
  fireflies.update(0, 0.2, world, 100, 100, 20, 13);
  assert.equal(world.queries, firstQueries + 4);
  assert.ok(fireflies.list.every((f) => Math.abs(f.x - 100) <= 20 && Math.abs(f.y - 100) <= 13));
  assert.ok(fireflies.list.every((f) => Number.isFinite(f.phase)));
});

test('successful spawns retain the same density as the viewport changes', () => {
  const world = terrain(GRASS);
  const fireflies = new Fireflies();
  for (const [halfW, halfH, count] of [[20, 13, 4], [40, 26, 16], [10, 13, 2]]) {
    fireflies.update(0, 0, world, 0, 0, halfW, halfH);
    assert.equal(fireflies.list.length, count);
    assert.ok(fireflies.list.every((f) => Number.isFinite(f.phase)));
  }
});

// Runs `body` with Math.random seeded, so every swarm lands the same.
function seeded(body) {
  const random = Math.random;
  Math.random = mulberry32(7);
  try { return body(); } finally { Math.random = random; }
}

const VIEW = { x0: -40, y0: -26, cols: 80, rows: 52 };
const screenOf = () => withLayers({ cols: VIEW.cols, rows: VIEW.rows });

// A swarm stepped `frames` frames at a presence (none given: the old call),
// and drawn.
function swarm(presence, frames = 30) {
  return seeded(() => {
    const fireflies = new Fireflies();
    const world = terrain(GRASS);
    for (let i = 0; i < frames; i++) {
      const args = [1 / 60, i / 60, world, 0, 0, 40, 26];
      if (presence === undefined) fireflies.update(...args);
      else fireflies.update(...args, presence);
    }
    const r = screenOf();
    fireflies.draw(r, VIEW, frames / 60);
    return { fireflies, r };
  });
}

test('at full night the swarm is drawn exactly as before; in daylight not at all, and holds still', () => {
  const old = swarm(), night = swarm(1);
  assert.deepEqual([night.r.fg, night.r.bg, night.r.ov], [old.r.fg, old.r.bg, old.r.ov]);
  assert.ok(old.r.fg.some((v) => v > 0));
  assert.ok(night.fireflies.list.every((f) => f.lit === 1));
  const day = seeded(() => {
    const fireflies = new Fireflies();
    fireflies.update(1 / 60, 0, terrain(GRASS), 0, 0, 40, 26, 0);
    const before = fireflies.list.map((f) => [f.x, f.y]);
    fireflies.update(1 / 60, 1, terrain(GRASS), 0, 0, 40, 26, 0);
    assert.deepEqual(fireflies.list.map((f) => [f.x, f.y]), before, 'asleep, they do not drift');
    const r = screenOf();
    fireflies.draw(r, VIEW, 1);
    return { fireflies, r };
  });
  assert.ok(day.fireflies.list.every((f) => f.lit === 0));
  assert.ok([day.r.fg, day.r.bg, day.r.ov].every((a) => a.every((v) => v === 0)));
});

test('fireflies wake one by one as the firefly hours come, each at its own point', () => {
  const half = seeded(() => {
    const fireflies = new Fireflies();
    fireflies.update(1 / 60, 0, terrain(GRASS), 0, 0, 200, 130, 0.5);
    fireflies.update(1 / 60, 0, terrain(GRASS), 0, 0, 200, 130, 0.5);
    return fireflies;
  });
  assert.ok(half.list.length > 300);
  const lit = half.list.filter((f) => f.lit > 0).length / half.list.length;
  assert.ok(lit > 0.35 && lit < 0.65, `${lit}`);
  seeded(() => {
    const fireflies = new Fireflies();
    const world = terrain(GRASS);
    fireflies.update(1 / 60, 0, world, 0, 0, 40, 26, 0);
    const count = fireflies.list.length;
    let last = fireflies.list.map(() => 0);
    for (let k = 1; k <= 100; k++) {
      fireflies.update(1 / 60, k / 60, world, 0, 0, 40, 26, k / 100);
      assert.equal(fireflies.list.length, count);
      const now = fireflies.list.map((f) => f.lit);
      for (let i = 0; i < count; i++) assert.ok(Math.abs(now[i] - last[i]) <= 0.1 + 1e-9, `step ${k}`);
      last = now;
    }
    const f = fireflies.list[0];
    assert.equal(fireflies.spawn(world, 0, 0, 40, 26, 0).wake >= 0, true);
    assert.equal((f.seed * 0.618034) % 1 * (1 - WAKE_BAND), f.wake, 'its waking point comes from its seed');
  });
});

// The screen covered in bright grass, as the meadow is drawn before the
// fireflies: bare, with a tree's small cells over the firefly's body and the
// right of its halo, or with a mushroom's soft letter drifting by its halo.
function meadow(scene = 'grass') {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(VIEW.cols, VIEW.rows);
  r.clear();
  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) {
      r.bg.set([12, 26, 14], (y * r.cols + x) * 4);
      r.put(x, y, glyph(','), 90, 190, 70);
    }
  }
  if (scene === 'tree') {
    for (let fy = 25 * FINE; fy < 29 * FINE; fy++) {
      for (let fx = 40 * FINE; fx < 42 * FINE; fx++) r.fineAt(fx, fy, glyph(fx % 2 ? '#' : '%'), 60, 120, 90, 8, 10, 14);
    }
  }
  if (scene === 'mushroom') {
    r.beginFloating();
    r.putFloating(41.3, 25.6, glyph('o'), 200, 120, 160);
  }
  return r;
}

// What the shader can show of a cell (see renderer.js). Each pixel is the
// ground between letters, mix(NIGHT, bg, BG_KEEP), with the glyph's ink over
// it by the glyph's coverage there; a sprite's small cells mix in by their
// flags, and a soft letter drifting in by the cell's motion tag.
function shown(r, cell) {
  const o = cell * 4;
  const x = cell % r.cols;
  const y = (cell - x) / r.cols;
  const small = [];
  for (let j = 0; j < FINE; j++) {
    for (let i = 0; i < FINE; i++) {
      const at = ((y * FINE + j) * r.fineCols + x * FINE + i) * 4;
      small.push([...r.fine.subarray(at, at + 4), ...r.fineBg.subarray(at, at + 4)]);
    }
  }
  const tag = r.motion[o + 2] | (r.motion[o + 3] << 8);
  return { glyph: r.glyphAt(cell), ink: [...r.fg.subarray(o, o + 3)], small, motion: tag & 32769 ? tag : 0,
    ground: [0, 1, 2].map((c) => NIGHT[c] + (r.bg[o + c] - NIGHT[c]) * BG_KEEP) };
}

// The most any pixel of a cell can change from one frame to the next. With
// its glyph kept, a pixel moves no more than its ground or ink; with the
// glyph swapped, it can go from one glyph's ink to the ground and on to the
// other's. A sprite's small letters are brightened up to 1.55 times and its
// backdrop kept at BG_KEEP. A change of a small cell's glyph or flags, or of
// the motion tag, shows another picture altogether.
const far = (p, q) => Math.max(...p.map((v, c) => Math.abs(v - q[c])));
function jump(a, b) {
  if (a.motion !== b.motion || a.small.some((s, i) => s[3] !== b.small[i][3] || s[7] !== b.small[i][7])) return Infinity;
  const glyphs = a.glyph === b.glyph ? Math.max(far(a.ground, b.ground), far(a.ink, b.ink))
    : far(a.ground, b.ground) + far(a.ink, a.ground) + far(b.ink, b.ground);
  return Math.max(glyphs, ...a.small.map((s, i) => Math.max(1.55 * far(s.slice(0, 3), b.small[i].slice(0, 3)),
    BG_KEEP * far(s.slice(4, 7), b.small[i].slice(4, 7)))));
}

for (const scene of ['grass', 'tree', 'mushroom']) {
  test(`a firefly falling asleep over ${scene} sinks away and leaves the cell as it was, with no jump on screen`, () => {
    const bare = meadow(scene);
    // Its body 2 rows over the grass it lights, at row 1 and column 0.
    const body = (1 - VIEW.y0) * VIEW.cols - VIEW.x0;
    const cells = bare.cols * bare.rows;
    let last = null;
    let worst = 0;
    for (let step = 100; step >= 0; step--) {
      const lit = step / 100;
      const fireflies = new Fireflies();
      fireflies.list.push({ x: 0.5, y: 3.5, h: 2, seed: 1, phase: 1, period: 3, lit });
      const r = meadow(scene);
      fireflies.draw(r, VIEW, 0);
      const now = Array.from({ length: cells }, (_, cell) => shown(r, cell));
      if (lit === 1) {
        assert.equal(r.glyphAt(body) !== bare.glyphAt(body), scene === 'grass', 'awake, its body takes only a plain cell');
        assert.ok(jump(now[body], shown(bare, body)) > 10, 'and is seen there');
      }
      if (last) for (let cell = 0; cell < cells; cell++) worst = Math.max(worst, jump(last[cell], now[cell]));
      last = now;
      if (lit === 0) {
        assert.deepEqual([r.fg, r.bg, r.fine, r.fineBg, r.motion], [bare.fg, bare.bg, bare.fine, bare.fineBg, bare.motion],
          'asleep, the meadow is as it was');
      }
    }
    assert.ok(worst <= 8, `a step of 0.01 changes a pixel by up to ${worst}`);
  });
}

test('a newcomer fades in, while the first swarm and one met after a jump show at once', () => {
  seeded(() => {
    const fireflies = new Fireflies();
    const world = terrain(GRASS);
    fireflies.update(1 / 60, 0, world, 0, 0, 40, 26, 1);
    assert.ok(fireflies.list.every((f) => f.lit === 1), 'the first frame is whole');
    const gone = fireflies.list[0];
    gone.x = 500;
    fireflies.update(1 / 60, 1 / 60, world, 0, 0, 40, 26, 1);
    const fresh = fireflies.list[0];
    assert.notEqual(fresh, gone);
    assert.equal(fresh.lit, 0, 'not on its first frame');
    fireflies.update(1 / 60, 2 / 60, world, 0, 0, 40, 26, 1);
    assert.ok(fresh.lit > 0 && fresh.lit <= 1 / 60 / FADE_IN + 1e-9);
    fireflies.update(1 / 60, 3 / 60, world, 600, 0, 40, 26, 1);
    fireflies.update(1 / 60, 4 / 60, world, 600, 0, 40, 26, 1);
    assert.ok(fireflies.list.every((f) => f.lit === 1), 'a jump brings a whole new swarm');
    const old = { x: 600, y: 0, h: 2, seed: 3, phase: 1, period: 3 };
    fireflies.list[0] = old;
    fireflies.update(1 / 60, 5 / 60, world, 600, 0, 40, 26, 1);
    assert.equal(old.lit, 1, 'one made before the clock is fully awake');
  });
});

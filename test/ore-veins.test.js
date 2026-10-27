import assert from 'node:assert/strict';
import test from 'node:test';
import { glyph, LAYER } from '../src/render/glyphs.js';
import { STONE_MID } from '../src/render/palette.js';
import { rockTypeAt } from '../src/world/geology.js';
import { fineRecipe, fineSource } from '../src/world/prop-art.js';
import { packFine } from '../src/world/fine-bakes.js';
import { HOST_TINT, minedKey, oreFoot, ORES, oreSeed, placeVeins, VEIN_COUNT } from '../src/world/ore-veins.js';
import { blocks, makeOreBlock, rebuildProp } from '../src/world/props.js';
import { neighbourSolids } from '../src/world/woodland.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from '../src/world/world.js';

const finish = (steps) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};
const fineCells = (prop) => finish(fineRecipe(prop)());
// Open grass everywhere, spawn at the origin: placement alone, no scenery.
const open = (seed = 1, typeAt = () => GRASS) => ({ seed, spawn: { x: 0.5, y: 0.5 }, typeAt, landTypeAt: () => GRASS, siteCache: new Map() });
const veinsOf = (blocks) => {
  const out = new Map();
  for (const b of blocks) {
    if (!out.has(b.vein)) out.set(b.vein, []);
    out.get(b.vein).push(b);
  }
  return [...out.values()];
};
const oresOf = (world, cx, cy) => world.propsOf(cx, cy).filter((p) => p.ore);

test('ore veins are seed-pure: the same blocks in any order of loading', () => {
  const a = new World(1);
  const b = new World(1);
  const key = (p) => [p.id, p.ore, p.host, p.x, p.y, p.cells.length].join();
  const first = [oresOf(a, -1, -2), oresOf(a, 0, -2)];
  const second = [oresOf(b, 0, -2), oresOf(b, -1, -2)].reverse();
  assert.ok(first[0].length > 0, 'a vein in this chunk');
  assert.deepEqual(first.map((list) => list.map(key)), second.map((list) => list.map(key)));
  // Ore blocks come after every other generated prop, so those keep their ids.
  const props = a.propsOf(-1, -2).filter((p) => p.id.startsWith('p:'));
  const index = (p) => Number(p.id.split(':')[3]);
  const lastOther = Math.max(...props.filter((p) => !p.ore).map(index));
  assert.ok(props.filter((p) => p.ore).every((p) => index(p) > lastOther));
});

test('each chunk gets up to two veins, with the ores and sizes of the table', () => {
  const world = open();
  const chunks = [0, 0, 0];
  const counts = {};
  const hosts = new Set();
  let veins = 0;
  for (let i = 0; i < 4000; i++) {
    const found = veinsOf(placeVeins(world, (i % 64) - 32, Math.floor(i / 64) - 32, CHUNK_SIZE, []));
    chunks[found.length]++;
    for (const vein of found) {
      const ore = ORES[vein[0].ore];
      veins++;
      counts[ore.id] = (counts[ore.id] ?? 0) + 1;
      assert.ok(vein.length >= ore.size[0] && vein.length <= ore.size[1], `${ore.id} vein of ${vein.length}`);
      assert.ok(vein.every((b) => b.host === vein[0].host && b.ore === ore.id));
      assert.equal(vein[0].host, rockTypeAt(world, vein[0].x, vein[0].y));
      for (const b of vein) hosts.add(b.host);
    }
  }
  VEIN_COUNT.forEach((p, n) => assert.ok(Math.abs(chunks[n] / 4000 - p) < 0.04, `${n} veins in ${chunks[n]} chunks`));
  for (const ore of Object.values(ORES)) {
    assert.ok(Math.abs(counts[ore.id] / veins * 100 - ore.weight) < 3, `${ore.id}: ${counts[ore.id]} of ${veins}`);
  }
  assert.deepEqual([...hosts].sort(), ['basalt', 'granite', 'limestone']);
});

test('a candidate is checked where it snaps: its whole foot and the rows beside it stay dry', () => {
  // Water on every seventh row: no block may stand on, above or below one.
  const world = open(2, (x, y) => (((y % 7) + 7) % 7 === 0 ? WATER : GRASS));
  let placed = 0;
  for (let i = 0; i < 600; i++) {
    const cx = (i % 30) - 15, cy = Math.floor(i / 30) - 10;
    for (const b of placeVeins(world, cx, cy, CHUNK_SIZE, [])) {
      placed++;
      const foot = oreFoot(b.seed);
      assert.equal(b.x - Math.floor(b.x), 0.5);
      assert.equal(b.y - Math.floor(b.y), 0.5);
      assert.equal(b.seed, oreSeed(world, b.x, b.y));
      for (let gy = Math.floor(b.y) - 1; gy <= Math.floor(b.y) + 1; gy++) {
        for (let gx = Math.floor(b.x - foot); gx <= Math.floor(b.x + foot); gx++) assert.equal(world.typeAt(gx, gy), GRASS);
      }
      assert.ok(b.x - foot >= cx * CHUNK_SIZE + 4 && b.x + foot < (cx + 1) * CHUNK_SIZE - 4, 'inside the chunk');
      assert.ok(b.y >= cy * CHUNK_SIZE + 2 && b.y < (cy + 1) * CHUNK_SIZE - 2);
      assert.ok(Math.hypot((b.x - world.spawn.x) * ASPECT, b.y - world.spawn.y) >= 40, 'clear of spawn');
    }
  }
  assert.ok(placed > 100);
});

test('veins keep clear of scenery here and across the seams, and of the spawn clearing', () => {
  const world = new World(1, { spawnRuins: true });
  const sx = Math.floor(world.spawn.x / CHUNK_SIZE);
  const sy = Math.floor(world.spawn.y / CHUNK_SIZE);
  const found = new Set();
  let hugged = 0, rocky = 0;
  for (let cy = sy - 6; cy <= sy + 6; cy++) {
    for (let cx = sx - 6; cx <= sx + 6; cx++) {
      const props = world.propsOf(cx, cy);
      const ores = props.filter((p) => p.ore);
      const others = props.filter((p) => !p.ore);
      const solids = neighbourSolids({ ...world, typeAt: (x, y) => world.preRiverTypeAt(x, y),
        landTypeAt: (x, y) => world.landTypeAt(x, y) }, cx, cy, CHUNK_SIZE);
      for (const b of ores) {
        found.add(b.ore);
        assert.equal(minedKey(b), `ore:${Math.floor(b.x)}:${Math.floor(b.y)}`);
        assert.ok(Math.hypot((b.x - world.spawn.x) * ASPECT, b.y - world.spawn.y) >= 40);
        assert.equal(world.inRiver(b), false);
        assert.equal(world.typeAt(Math.floor(b.x), Math.floor(b.y)), GRASS);
        for (const t of others.filter((p) => p.kind === 'tree')) {
          assert.ok(!(Math.abs(b.x - t.x) < t.footW + 6 && Math.abs(b.y - t.y) < t.footH + 3), 'off tree bases');
        }
        for (const p of others) assert.ok(!blocks(p, b.x, b.y), `${b.id} inside ${p.id}`);
        for (const s of solids) {
          if (s.box) assert.ok(!(b.x > s.x0 && b.x < s.x1 && b.y > s.y0 && b.y < s.y1), 'off a neighbour rock');
          else assert.ok(!(Math.abs(b.x - s.x) < s.footW && Math.abs(b.y - s.y) < s.footH), 'off a neighbour tree');
        }
      }
      const rock = others.find((p) => p.kind === 'rock' && p.footW > 8);
      if (rock && ores.length) {
        rocky++;
        const b = ores[0];
        if (Math.abs(b.x - rock.x) < rock.footW + 6 && b.y - rock.y < rock.footH + 4) hugged++;
      }
    }
  }
  assert.deepEqual([...found].sort(), Object.keys(ORES).sort(), 'every ore turns up near spawn');
  assert.ok(rocky > 3 && hugged / rocky >= 0.6, `${hugged} of ${rocky} veins hug their rock`);
});

test('an ore block is fresh stone tinted by its rock, with clumps of its ore and no lichen', () => {
  const glyphs = new Set([...'%*:;'].map((ch) => glyph(ch)));
  const flecks = {};
  for (const ore of Object.keys(ORES)) {
    const block = makeOreBlock({ x: 10.5, y: 20.5, ore, host: 'granite', seed: 99 });
    assert.equal(block.kind, 'rock');
    assert.equal(block.ore, ore);
    const fine = fineCells(block);
    assert.ok(fine.length > block.cells.length, 'the fine bake has more cells');
    flecks[ore] = fine.filter((c) => glyphs.has(c.g & ~LAYER));
    assert.ok(flecks[ore].length >= 4, `${ore} shows its flecks`);
    // Lichen is yellow-green or rust; no cell is.
    assert.ok(!fine.some((c) => c.r > 150 && c.gg > 130 && c.b < 100 && Math.abs(c.r - c.gg) < 20), 'no lichen');
  }
  const mean = (cells, k) => cells.reduce((s, c) => s + c[k], 0) / cells.length;
  const bright = (cells) => mean(cells, 'r') + mean(cells, 'gg') + mean(cells, 'b');
  assert.ok(Object.keys(ORES).every((ore) => ore === 'coal' || bright(flecks.coal) < bright(flecks[ore])), 'coal is darkest');
  assert.ok(mean(flecks.lapis, 'b') > mean(flecks.lapis, 'r') + 40, 'lapis is blue');
  assert.ok(flecks.copper.some((c) => c.gg > c.r), 'copper has green patina');
  assert.ok(mean(flecks.copper, 'r') > mean(flecks.copper, 'b') + 40, 'copper is orange');
  // Each rock type gives its own host stone.
  const hosts = Object.keys(HOST_TINT).map((host) => makeOreBlock({ x: 0.5, y: 0.5, ore: 'iron', host, seed: 5 }));
  assert.equal(new Set(hosts.map((b) => JSON.stringify(b.cells.map((c) => c.r)))).size, 3);
  assert.ok(STONE_MID.length === 3);
});

test('a worker rebuilds an ore block from its source exactly', () => {
  const block = makeOreBlock({ x: 4.5, y: 9.5, ore: 'copper', host: 'basalt', seed: 1234 });
  const source = fineSource(block);
  assert.deepEqual(structuredClone(source), source);
  assert.deepEqual(packFine(fineCells(rebuildProp(structuredClone(source), true))), packFine(fineCells(block)));
});

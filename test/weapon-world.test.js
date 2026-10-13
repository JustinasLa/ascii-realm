import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat } from '../src/entities/combat.js';
import { SCALE, TILT } from '../src/entities/rig.js';
import { MATERIAL_IDS } from '../src/entities/weapons.js';
import { GLYPHS, glyph } from '../src/render/glyphs.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { Projectiles } from '../src/world/projectiles.js';
import { ASPECT, CHOP_RADIUS, CHUNK_SIZE, GRASS, TREE_DURABILITY, World } from '../src/world/world.js';

// Real chunk ownership and collision, with deterministic open terrain.
class Meadow extends World {
  findSpawn() {
    return { x: 0.5, y: 0.5 };
  }

  generate(cx, cy) {
    const size = CHUNK_SIZE * CHUNK_SIZE;
    return {
      cx,
      cy,
      type: new Uint8Array(size).fill(GRASS),
      elev: new Float32Array(size),
      shade: new Float32Array(size),
      rnd: new Float32Array(size),
      props: [],
    };
  }
}

function prop(kind, x, y) {
  return {
    kind,
    x,
    y,
    footW: 2.4,
    footH: 1.2,
    durability: kind === 'tree' ? TREE_DURABILITY : undefined,
    cells: [{ dx: 0, dy: kind === 'tree' ? -35 : -6, g: glyph('#'), r: 70, gg: 100, b: 60 }],
  };
}

function meadowWith(...props) {
  const world = new Meadow(1);
  for (const p of props) {
    world.chunk(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.y / CHUNK_SIZE)).props.push(p);
  }
  return world;
}

function shot(overrides = {}) {
  return {
    type: 'projectile',
    x: 10,
    y: 20,
    h: 12,
    dx: SCALE / ASPECT,
    dy: 0,
    projectile: { kind: 'arrow', speed: 12, gravity: 0, lifetime: 1 },
    ...overrides,
  };
}

function bufferRenderer(cols = 64, rows = 40) {
  return {
    cols,
    rows,
    fg: new Uint8ClampedArray(cols * rows * 4),
    bg: new Uint8ClampedArray(cols * rows * 4),
    put(x, y, g, r, gg, b) {
      for (const n of [x, y, g, r, gg, b]) assert.ok(Number.isFinite(n), 'finite sprite cell');
      assert.ok(Number.isInteger(g) && g >= 0 && g < GLYPHS.length, 'valid glyph');
      AsciiRenderer.prototype.put.call(this, x, y, g, r, gg, b);
    },
    putBg: AsciiRenderer.prototype.putBg,
  };
}

function chargedProjectile(weapon, seconds) {
  const combat = new Combat(weapon);
  combat.attack({ held: true });
  for (let time = 0; time < seconds; time += 1 / 120) {
    combat.update(Math.min(1 / 120, seconds - time), { held: true });
  }
  combat.release();
  for (let frame = 0; frame < 180; frame++) {
    combat.update(1 / 120, { held: false });
    const event = combat.events.find((e) => e.type === 'projectile');
    if (event) return event;
  }
  assert.fail(`a released ${weapon} emits its charged projectile`);
}

test('axe damage persists and felling removes the tree from drawing and movement collision', () => {
  const tree = prop('tree', 20.5, 20.5);
  const world = meadowWith(tree);
  assert.equal(world.isWalkable(tree.x, tree.y), false);

  for (let health = TREE_DURABILITY - 1; health >= 0; health--) {
    const hit = world.chopTree(tree.x, tree.y);
    assert.equal(hit.tree, tree);
    assert.equal(hit.health, health);
    assert.equal(tree.durability, health);
    assert.equal(hit.felled, health === 0);
    assert.equal(world.isWalkable(tree.x, tree.y), health === 0);
    assert.equal(world.propsIn(0, 0, CHUNK_SIZE - 1, CHUNK_SIZE - 1).includes(tree), health > 0);
  }

  assert.equal(world.chunk(0, 0).props.includes(tree), false);
  assert.equal(world.chopTree(tree.x, tree.y), null, 'a felled tree cannot be struck again');
});

test('actual axe chops damage trees more and fell them sooner as their material improves', () => {
  const origin = { x: 5, y: 20 };
  const damage = [];
  const hitsToFell = [];
  for (const material of MATERIAL_IDS) {
    const tree = prop('tree', 20, 20);
    const world = meadowWith(tree);
    const combat = new Combat('axe', material);
    let hits = 0;
    while (world.propsIn(0, 0, 63, 63).includes(tree) && hits < 12) {
      assert.equal(combat.attack({ held: false, moving: false, air: 0 }), true);
      const chops = [];
      for (let frame = 0; combat.busy && frame < 1200; frame++) {
        combat.update(1 / 120, { held: false, moving: false, air: 0 });
        chops.push(...combat.events.splice(0).filter((event) => event.type === 'chop'));
      }
      assert.equal(combat.busy, false, `${material} axe finishes its strike`);
      assert.equal(chops.length, 1, `${material} axe makes one actual contact`);
      const event = chops[0];
      assert.equal(event.move, 'hew', 'each tier uses the same light move');
      const hit = world.chopTree(origin.x + event.reach * SCALE / ASPECT, origin.y, event.strength, origin);
      assert.equal(hit.tree, tree);
      if (hits === 0) damage.push(TREE_DURABILITY - hit.health);
      hits++;
      // Reset the combo and recover stamina through ordinary idle updates.
      for (let frame = 0; frame < 120; frame++) {
        combat.update(1 / 120, { held: false, moving: false, air: 0 });
      }
    }
    assert.equal(tree.durability, 0, `${material} axe eventually fells the tree`);
    assert.equal(world.isWalkable(tree.x, tree.y), true);
    hitsToFell.push(hits);
  }
  for (let tier = 1; tier < MATERIAL_IDS.length; tier++) {
    assert.ok(damage[tier] > damage[tier - 1], `${MATERIAL_IDS[tier]} chops remove more durability`);
    assert.ok(hitsToFell[tier] <= hitsToFell[tier - 1], `${MATERIAL_IDS[tier]} needs no more contacts`);
  }
  assert.ok(hitsToFell.at(-1) < hitsToFell[0], 'steel fells a tree in fewer contacts than stone');
});

test('an axe selects the nearest tree and leaves rocks and other nearby trees intact', () => {
  const farther = prop('tree', 20, 20);
  const nearest = prop('tree', 23, 20);
  const rock = prop('rock', 23.2, 20);
  const world = meadowWith(farther, rock, nearest);
  const hit = world.chopTree(23.1, 20);
  assert.equal(hit.tree, nearest);
  assert.equal(nearest.durability, TREE_DURABILITY - 1);
  assert.equal(farther.durability, TREE_DURABILITY);
  assert.equal(world.propsIn(0, 0, 63, 63).includes(rock), true);
});

test('axe strikes outside reach do not damage a tree returned from the same chunk', () => {
  const tree = prop('tree', 20, 20);
  const rock = prop('rock', 40, 40);
  const world = meadowWith(tree, rock);
  assert.equal(world.chopTree(tree.x + (CHOP_RADIUS + 0.1) / ASPECT, tree.y), null);
  assert.equal(world.chopTree(rock.x, rock.y), null);
  assert.equal(tree.durability, TREE_DURABILITY);
});

test('felling removes a tree from its owning chunk across positive and negative boundaries', () => {
  const tree = prop('tree', CHUNK_SIZE + 0.5, -0.5);
  const world = meadowWith(tree);
  const hit = world.chopTree(tree.x - 1, tree.y, TREE_DURABILITY);
  assert.equal(hit.felled, true);
  assert.deepEqual(world.chunk(1, -1).props, []);
  assert.equal(world.isWalkable(tree.x, tree.y), true);
  assert.equal(world.propsIn(CHUNK_SIZE - 2, -2, CHUNK_SIZE + 2, 2).includes(tree), false);
});

test('an axe strike hits the first trunk along its bounded segment', () => {
  const near = prop('tree', 25, 20);
  const far = prop('tree', 39, 20);
  const world = meadowWith(far, near);
  const hit = world.chopTree(40, 20, 1, { x: 20, y: 20 });
  assert.equal(hit.tree, near);
  assert.equal(near.durability, TREE_DURABILITY - 1);
  assert.equal(far.durability, TREE_DURABILITY);

  const behind = prop('tree', 18, 20);
  const beyond = prop('tree', 42, 20);
  const outside = meadowWith(behind, beyond);
  assert.equal(outside.chopTree(40, 20, 1, { x: 20, y: 20 }), null);
  assert.equal(behind.durability, TREE_DURABILITY);
  assert.equal(beyond.durability, TREE_DURABILITY);
});

test('a fully drawn bow launches a faster arrow that travels farther than a partial draw', () => {
  const partial = chargedProjectile('bow', 0.25);
  const full = chargedProjectile('bow', 0.95);
  assert.ok(full.charge > partial.charge);
  assert.ok(full.projectile.speed > partial.projectile.speed);
  assert.ok(full.projectile.range > partial.projectile.range);
  const shortFlight = new Projectiles();
  const longFlight = new Projectiles();
  const shortArrow = shortFlight.launch(shot({ h: 1000, projectile: partial.projectile }));
  const longArrow = longFlight.launch(shot({ h: 1000, projectile: full.projectile }));
  const world = meadowWith();
  shortFlight.update(0.1, world);
  longFlight.update(0.1, world);
  assert.ok(longArrow.x > shortArrow.x, 'charge changes world flight speed');
  shortFlight.update(10, world);
  longFlight.update(10, world);
  assert.equal(shortFlight.list.length, 0);
  assert.equal(longFlight.list.length, 0);
  assert.ok(longArrow.x > shortArrow.x, 'charge changes the maximum distance traveled');
});

test('projectiles use heading cell displacement and expire after their finite lifetime', () => {
  const projectiles = new Projectiles();
  const event = shot({ dx: 0, dy: SCALE * TILT });
  const arrow = projectiles.launch(event);
  assert.equal(arrow.vx, 0);
  assert.equal(arrow.vy, event.dy * event.projectile.speed);
  projectiles.update(0.1, meadowWith());
  assert.ok(Math.abs(arrow.x - event.x) < 1e-9);
  assert.ok(Math.abs(arrow.y - event.y - arrow.vy * 0.1) < 1e-9);
  assert.equal(projectiles.list.length, 1);
  projectiles.update(event.projectile.lifetime + 0.1, meadowWith());
  assert.equal(projectiles.list.length, 0);
});

test('projectile range caps travel even when a frame is longer than the remaining flight', () => {
  const projectiles = new Projectiles();
  const event = shot({ projectile: { kind: 'javelin', speed: 20, gravity: 0, lifetime: 5, range: 2 } });
  const javelin = projectiles.launch(event);
  projectiles.update(1, meadowWith());
  assert.equal(projectiles.list.length, 0);
  assert.ok(Math.abs((javelin.x - event.x) / event.dx - event.projectile.range) < 1e-9);
  assert.ok(Math.abs(javelin.travelled - event.projectile.range) < 1e-9);
});

test('a paired projectile event launches two distinct finite flights', () => {
  const projectiles = new Projectiles();
  const event = shot({ projectile: { kind: 'magic', speed: 12, gravity: 0, lifetime: 1, count: 2 } });
  const first = projectiles.launch(event);
  assert.equal(projectiles.list.length, 2);
  assert.equal(first, projectiles.list[0]);
  assert.notEqual(projectiles.list[0].vy, projectiles.list[1].vy, 'paired shots spread apart');
  projectiles.update(0.1, meadowWith());
  for (const p of projectiles.list) {
    for (const n of [p.x, p.y, p.h, p.vx, p.vy, p.life]) assert.ok(Number.isFinite(n));
  }
  assert.notEqual(projectiles.list[0].y, projectiles.list[1].y);
});

test('swept projectile collision catches the first tree even during a large movement step', () => {
  const first = prop('tree', 24, 20);
  const second = prop('tree', 42, 20);
  const world = meadowWith(second, first);
  const projectiles = new Projectiles();
  projectiles.launch(shot({ projectile: { kind: 'arrow', speed: 30, gravity: 0, lifetime: 1 } }));
  projectiles.update(0.1, world);
  assert.equal(projectiles.list.length, 0);
  assert.equal(projectiles.events.length, 1);
  assert.equal(projectiles.events[0].type, 'impact');
  assert.equal(projectiles.events[0].prop, first);
  assert.equal(first.durability, TREE_DURABILITY, 'arrows do not chop trees');
});

test('a real charged spear catches the first trunk across a large frame without chopping it', () => {
  const first = prop('tree', 24, 20);
  const second = prop('tree', 42, 20);
  const world = meadowWith(second, first);
  const throwEvent = chargedProjectile('spear', 1.3);
  assert.equal(throwEvent.projectile.kind, 'spear');
  const projectiles = new Projectiles();
  assert.ok(projectiles.launch(shot({ ...throwEvent })));
  projectiles.update(0.25, world);
  assert.equal(projectiles.list.length, 0);
  assert.equal(projectiles.events.length, 1);
  const impact = projectiles.events[0];
  assert.equal(impact.kind, 'spear');
  assert.equal(impact.prop, first);
  assert.equal(impact.damage, throwEvent.damage);
  assert.equal(first.durability, TREE_DURABILITY, 'spear damage does not fell trees');
  assert.equal(second.durability, TREE_DURABILITY);
});

test('a real thrown spear renders a long shaft, falls under gravity, and lands once', () => {
  const throwEvent = chargedProjectile('spear', 1.3);
  const projectiles = new Projectiles();
  const spear = projectiles.launch(shot({ ...throwEvent }));
  assert.ok(spear, 'the spear projectile style accepts actual combat throw data');
  const javelin = new Projectiles().launch(shot({ projectile: { ...throwEvent.projectile, kind: 'javelin' } }));
  assert.ok(spear.length > javelin.length, 'the spear sprite keeps its longer polearm silhouette');
  const world = meadowWith();
  projectiles.update(0.02, world);
  assert.ok(spear.x > 10);
  assert.ok(spear.h < 12);
  assert.ok(spear.vh < 0);
  const renderer = bufferRenderer();
  projectiles.draw(renderer, { x0: 0, y0: 0, cols: renderer.cols, rows: renderer.rows });
  assert.ok(renderer.fg.some((value, i) => i % 4 === 3 && value > 0), 'the actual thrown spear is visible');
  projectiles.update(2, world);
  assert.equal(projectiles.list.length, 0);
  assert.equal(projectiles.events.length, 1);
  const impact = projectiles.events[0];
  assert.equal(impact.kind, 'spear');
  assert.equal(impact.prop, null);
  for (const value of [impact.x, impact.y, impact.h, impact.damage, impact.strength]) {
    assert.ok(Number.isFinite(value));
  }
  projectiles.update(1, world);
  assert.equal(projectiles.events.length, 1, 'a landed spear cannot hit twice');
});

test('projectiles can pass above a tree but collide with a rock at its actual height', () => {
  const world = meadowWith(prop('tree', 24, 20));
  const high = new Projectiles();
  high.launch(shot({ h: 60, projectile: { kind: 'arrow', speed: 30, gravity: 0, lifetime: 1 } }));
  high.update(0.1, world);
  assert.equal(high.list.length, 1);
  assert.equal(high.events.length, 0);

  const rock = prop('rock', 24, 20);
  const low = new Projectiles();
  low.launch(shot({ h: 3, projectile: { kind: 'javelin', speed: 30, gravity: 0, lifetime: 1 } }));
  low.update(0.1, meadowWith(rock));
  assert.equal(low.list.length, 0);
  assert.equal(low.events[0].prop, rock);
});

test('a falling projectile lands once and emits a finite ground impact', () => {
  const projectiles = new Projectiles();
  projectiles.launch(shot({ h: 1, projectile: { kind: 'arrow', speed: 12, gravity: 20, lifetime: 3 } }));
  projectiles.update(1, meadowWith());
  assert.equal(projectiles.list.length, 0);
  assert.equal(projectiles.events.length, 1);
  const impact = projectiles.events[0];
  assert.equal(impact.type, 'impact');
  assert.equal(impact.kind, 'arrow');
  for (const n of [impact.x, impact.y, impact.strength]) assert.ok(Number.isFinite(n));
  projectiles.update(1, meadowWith());
  assert.equal(projectiles.events.length, 1, 'an expired projectile cannot impact a second time');
});

test('invalid projectile launches do not introduce nonfinite or immortal state', () => {
  const projectiles = new Projectiles();
  const invalid = [
    shot({ x: NaN }),
    shot({ dy: Infinity }),
    shot({ projectile: { kind: 'arrow', speed: Infinity, gravity: 0, lifetime: 1 } }),
    shot({ projectile: { kind: 'arrow', speed: 12, gravity: 0, lifetime: Infinity } }),
    shot({ projectile: { kind: 'arrow', speed: 12, gravity: 0, lifetime: 0 } }),
  ];
  for (const event of invalid) assert.equal(projectiles.launch(event), null);
  assert.equal(projectiles.list.length, 0);
});

test('arrows, spears, javelins and magic render distinct ASCII sprites into finite cell buffers', () => {
  const sprites = [];
  for (const kind of ['arrow', 'spear', 'javelin', 'magic']) {
    const projectiles = new Projectiles();
    projectiles.launch(shot({ projectile: { kind, speed: 12, gravity: 0, lifetime: 1 } }));
    projectiles.update(0.02, meadowWith());
    const renderer = bufferRenderer();
    const background = renderer.bg.slice();
    projectiles.draw(renderer, { x0: 0, y0: 0, cols: renderer.cols, rows: renderer.rows });
    assert.ok(renderer.fg.some((value, i) => i % 4 === 3 && value > 0), `${kind} is visible`);
    assert.deepEqual(renderer.bg, background);
    sprites.push(Buffer.from(renderer.fg).toString('hex'));
    const foreground = renderer.fg.slice();
    projectiles.draw(renderer, { x0: 1000, y0: 1000, cols: renderer.cols, rows: renderer.rows });
    assert.deepEqual(renderer.fg, foreground, 'offscreen drawing does not write into the buffer');
  }
  assert.equal(new Set(sprites).size, 4);
});

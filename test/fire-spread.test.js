import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Fires, MAX_FIRES } from '../src/world/fire.js';
import { MAX_BURN_EVENTS, MAX_BURN_OBJECTS, vegetationFuel } from '../src/world/fire-spread.js';
import { Grass } from '../src/world/grass.js';
import { clumpAt, patchAt } from '../src/world/grass-roots.js';
import { Harvesting } from '../src/world/harvesting.js';
import { drawResource } from '../src/world/item-draw.js';
import { glyph } from '../src/render/glyphs.js';
import { blocks, drawProp } from '../src/world/props.js';
import { DIRT, GRASS, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

function field(points = [], { plane = false, plant = false } = {}) {
  const material = new Set(points.map(([x, y]) => `${x},${y}`));
  const burned = new Set();
  const types = new Map();
  const solid = new Set();
  const trees = [];
  const world = { seed: 19, gathered: new Set(), burntPlants: new Set(),
    typeAt(x, y) { return types.get(`${Math.floor(x)},${Math.floor(y)}`) ?? GRASS; },
    isWalkable(x, y) { return !solid.has(`${Math.floor(x)},${Math.floor(y)}`); },
    burnGrass() { assert.fail('a natural fire must not burn a radial area'); },
    burnGrassCell(x, y) { burned.add(`${Math.floor(x)},${Math.floor(y)}`); },
    beginTreeBurn(prop, node) { prop.burning = node; },
    endTreeBurn(prop) { delete prop.burning; },
    burnTree(prop) { prop.burnt = true; prop.chopped = true; },
  };
  const fuelAt = (_world, x, y) => {
    x = Math.floor(x); y = Math.floor(y);
    const key = `${x},${y}`;
    if (world.typeAt(x, y) !== GRASS) return null;
    for (const tree of trees) {
      if (tree.burnt || tree.chopped) continue;
      if (((x + 0.5 - tree.x) / tree.footW) ** 2 + ((y + 0.5 - tree.y) / tree.footH) ** 2 <= 1) {
        return { key: `tree:${tree.id}`, kind: 'tree', x: tree.x, y: tree.y,
          width: tree.footW, height: tree.footH, duration: 10, prop: tree };
      }
    }
    if (solid.has(key) || (!plant && burned.has(key)) || (!plane && !material.has(key))) return null;
    if (plant) {
      if (world.gathered.has(`${plant}:${x}:${y}`)) return null;
      return { key: `plant:${key}`, kind: 'plant', x: x + 0.5, y: y + 0.5, width: 4, height: 2,
        duration: 5, node: { kind: plant, x: x + 0.5, y: y + 0.5 } };
    }
    return { key: `grass:${key}`, kind: 'grass', x: x + 0.5, y: y + 0.5, width: 0.5, height: 0.5, duration: 4 };
  };
  const fires = new Fires({ windAt: () => 0, fuelAt });
  return { world, fires, burned, types, solid, trees };
}

function finish(fires, world) {
  fires.update(120, 120, world);
  for (let i = 0; i < 256 && fires.list.some(f => f.kind === 'ground'); i++) {
    fires.update(0.25, 120 + (i + 1) / 4, world);
  }
  assert.ok(!fires.list.some(f => f.kind === 'ground'), 'all finite connected fuel eventually burns out');
}

test('campfires stay contained beside combustible grass', () => {
  const { world, fires, burned } = field([], { plane: true });
  const camp = fires.add(world, 0.5, 0.5);
  assert.ok(camp);
  fires.update(180, 180, world);
  assert.equal(fires.list.length, 1);
  assert.equal(camp.intensity, 1);
  assert.equal(camp.spread, undefined);
  assert.equal(burned.size, 0, 'a live hearth never ignites the surrounding material');
});

test('a torch burns its connected clump and leaves a separate nearby clump intact', () => {
  const connected = [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]];
  const { world, fires, burned } = field([...connected, [4, 0], [5, 0]]);
  const fire = fires.ignite(world, 0.5, 0.5);
  assert.deepEqual([...burned], ['0,0'], 'only the landing cell burns immediately');
  fires.update(0.6, 0.6, world);
  assert.ok(burned.size > 1, 'the front advances into touching fuel');
  fires.update(60, 60, world);
  assert.deepEqual([...burned].sort(), connected.map(([x, y]) => `${x},${y}`).sort());
  assert.equal(fire.outReason, 'fuel');
  assert.equal(fires.list.length, 0);
});

test('a clump larger than the old cell limit burns completely with bounded work per frame', () => {
  const clump = [];
  for (let y = -10; y < 10; y++) for (let x = -20; x < 20; x++) clump.push([x, y]);
  const { world, fires, burned } = field([...clump, [24, 0], [25, 0]]);
  const fire = fires.ignite(world, 0.5, 0.5);
  let reads = 0;
  const fuelAt = fire.spread.fuelAt;
  fire.spread.fuelAt = (...args) => { reads++; return fuelAt(...args); };
  fires.update(60, 60, world);
  assert.ok(reads <= MAX_BURN_EVENTS * 4, 'one frame cannot process the entire overdue frontier');
  assert.ok(fire.spread.active.size > 0, 'the unfinished front stays alive for later frames');
  assert.ok(burned.size < clump.length, 'the full clump is not scorched in one synchronous burst');
  const visible = fires.prepare({ x0: -50, y0: -30, cols: 100, rows: 60 }, 60);
  assert.ok(visible.length <= MAX_FIRES, 'complete combustion retains the flame render budget');
  for (let i = 0; i < 32 && fires.list.length; i++) fires.update(0.1, 60 + (i + 1) / 10, world);
  assert.equal(fire.spread.nodes.size, clump.length);
  assert.ok(fire.spread.nodes.size > MAX_BURN_OBJECTS, 'grass is not truncated by the object budget');
  assert.deepEqual([...burned].sort(), clump.map(([x, y]) => `${x},${y}`).sort());
  assert.equal(fire.outReason, 'fuel');
  assert.equal(fires.list.length, 0);
});

test('grass reached from a burning tree sustains itself to the far end of the clump', () => {
  const points = Array.from({ length: 48 }, (_, i) => [i + 2, 0]);
  const { world, fires, burned, trees } = field(points);
  const tree = { id: 'tree', x: 0.5, y: 0.5, footW: 1.5, footH: 0.5 };
  trees.push(tree);
  const fire = fires.ignite(world, 0.5, 0.5, { source: 'lightning' });
  fires.update(60, 60, world);
  assert.deepEqual([...burned].sort(), points.map(([x, y]) => `${x},${y}`).sort());
  assert.equal(tree.burnt, true);
  assert.equal(fire.outReason, 'fuel');
});

test('a resource grass tuft within a meadow clump does not weaken its advancing front', () => {
  const points = Array.from({ length: 80 }, (_, x) => [x, 0]);
  const { world, fires, burned } = field(points);
  const tuft = { kind: 'grass', x: 24.5, y: 0.5 };
  const original = fires.fuelAt;
  fires.fuelAt = (w, x, y) => {
    const fuel = original(w, x, y);
    return fuel && Math.floor(x) === 24 ? { ...fuel, key: 'plant:tuft', kind: 'plant', node: tuft } : fuel;
  };
  const fire = fires.ignite(world, 0.5, 0.5);
  fires.update(60, 60, world);
  assert.equal(tuft.burnt, true);
  assert.deepEqual([...burned].sort(), points.map(([x, y]) => `${x},${y}`).sort());
  assert.equal(fire.outReason, 'fuel');
});

test('visible fringe blades burn with the clump even beyond its continuous fuel mask', () => {
  const world = new World(19);
  world.propsIn(-4, -4, 68, 68);
  const chunk = world.chunk(0, 0);
  let edge = null, body = null;
  for (const i of chunk.blades.indices) {
    const x = i % 64, y = Math.floor(i / 64);
    if (patchAt(x, y, world.seed) >= 0.1 && clumpAt(x, y, world.seed) >= 0.3) continue;
    if (!world.isWalkable(x + 0.5, y + 0.5)) continue;
    body = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .find(([nx, ny]) => vegetationFuel(world, nx, ny)?.kind === 'grass');
    if (body) { edge = [x, y]; break; }
  }
  assert.ok(edge, 'the generated patch has a visible edge blade touching its body');
  const fires = new Fires({ windAt: () => 0 });
  const fire = fires.ignite(world, body[0], body[1]);
  fires.update(0.6, 0.6, world);
  const { c, i } = world.locate(...edge);
  assert.equal(c.burnt[i], 255, 'the edge blade joins the front instead of staying green');
  assert.equal(c.blades.present[i], 0, 'the burned fringe is removed from rendering');
  fires.extinguish(world, fire);
});

test('smothering a grass front cancels the rest of its clump', () => {
  const { world, fires, burned } = field(Array.from({ length: 48 }, (_, x) => [x, 0]));
  const fire = fires.ignite(world, 0.5, 0.5);
  fires.update(0.6, 0.6, world);
  fires.extinguish(world, fire, 'smother');
  fires.update(60, 60, world);
  assert.deepEqual([...burned].sort(), ['0,0', '1,0']);
  assert.equal(fire.spread.events.length, 0);
});

test('corner contact and empty cells cannot bridge disconnected grass', () => {
  const { world, fires, burned } = field([[0, 0], [1, 1], [2, 0]]);
  fires.ignite(world, 0.5, 0.5);
  fires.update(60, 60, world);
  assert.deepEqual([...burned], ['0,0']);
});

for (const barrier of ['water', 'path', 'rock']) {
  test(`${barrier} breaks an otherwise connected chain of fuel`, () => {
    const { world, fires, burned, types, solid } = field([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
    if (barrier === 'rock') solid.add('2,0');
    else types.set('2,0', barrier === 'water' ? WATER : DIRT);
    fires.ignite(world, 0.5, 0.5);
    fires.update(60, 60, world);
    assert.deepEqual([...burned].sort(), ['0,0', '1,0']);
  });
}

test('nearby disconnected ignitions are separate, while a torch in a hearth stays contained', () => {
  const { world, fires } = field([[10, 0], [13, 0]]);
  const camp = fires.add(world, 0.5, 0.5);
  assert.equal(fires.ignite(world, 3.5, 0.5), camp);
  const a = fires.ignite(world, 10.5, 0.5);
  const b = fires.ignite(world, 13.5, 0.5);
  assert.notEqual(a, camp, 'being near a hearth does not turn a ground ignition into a campfire');
  assert.notEqual(a, b, 'bare ground separates nearby incidents');
  assert.equal(fires.list.length, 3);
});

test('bare ground cannot sustain lightning, and a thrown torch itself soon burns out', () => {
  const { world, fires, burned } = field();
  assert.equal(fires.ignite(world, 0.5, 0.5, { source: 'lightning' }), null);
  const torch = fires.ignite(world, 0.5, 0.5, { source: 'torch' });
  assert.ok(torch);
  fires.update(10, 10, world);
  assert.equal(fires.list.length, 0);
  assert.equal(torch.outReason, 'fuel');
  assert.deepEqual([...burned], ['0,0'], 'the torch never paints a wide burn on empty ground');
});

test('lightning can burn a blocking tree and spread through grass touching its trunk', () => {
  const { world, fires, burned, solid, trees } = field([[2, 0], [3, 0], [6, 0]]);
  const tree = { id: 'tree', x: 0.5, y: 0.5, footW: 1.5, footH: 0.5 };
  trees.push(tree);
  solid.add('0,0');
  const fire = fires.ignite(world, 0.5, 0.5, { source: 'lightning' });
  assert.ok(fire, 'a tree is combustible even though the player cannot walk through it');
  fires.update(2, 2, world);
  assert.ok(tree.burning.progress > 0);
  assert.ok(burned.has('2,0'));
  assert.equal(tree.chopped, undefined, 'wood takes time to consume');
  fires.update(60, 60, world);
  assert.equal(tree.burnt, true);
  assert.equal(tree.chopped, true);
  assert.equal(tree.burning, undefined);
  assert.equal(burned.has('6,0'), false, 'the remote clump stays intact');
});

test('smothering a spreading fire cancels its pending front and lets an unfinished tree survive', () => {
  const { world, fires, burned, trees } = field([[2, 0], [3, 0]]);
  const tree = { id: 'tree', x: 0.5, y: 0.5, footW: 1.5, footH: 0.5 };
  trees.push(tree);
  const fire = fires.ignite(world, 0.5, 0.5);
  fires.update(0.2, 0.2, world);
  fires.extinguish(world, fire, 'smother');
  fires.update(60, 60, world);
  assert.equal(burned.size, 0);
  assert.equal(tree.burning, undefined);
  assert.equal(tree.burnt, undefined);
  assert.equal(fire.spread.events.length, 0);
});

test('two separate fronts cannot consume the same tree twice', () => {
  const { world, fires, trees } = field([[-2, 0], [2, 0]]);
  const tree = { id: 'shared', x: 0.5, y: 0.5, footW: 1.5, footH: 0.5 };
  trees.push(tree);
  const a = fires.ignite(world, -1.5, 0.5);
  const b = fires.ignite(world, 2.5, 0.5);
  assert.notEqual(a, b);
  fires.update(0.6, 0.6, world);
  const treeNodes = [...a.spread.nodes.values(), ...b.spread.nodes.values()].filter(n => n.fuel.kind === 'tree');
  assert.equal(treeNodes.length, 1, 'one tree is one supply of fuel across all incidents');
  fires.update(60, 60, world);
  assert.equal(tree.burnt, true);
  assert.equal(fires.list.length, 0);
});

test('flooding an ignition before its front advances stops its pending spread', () => {
  const { world, fires, types, burned } = field([[0, 0], [1, 0], [2, 0]]);
  const fire = fires.ignite(world, 0.5, 0.5);
  types.set('0,0', WATER);
  fires.update(60, 60, world);
  assert.equal(fire.outReason, 'fuel');
  assert.deepEqual([...burned], ['0,0']);
});

test('connected woody plants still lose heat and keep a bounded object budget', () => {
  const { world, fires } = field([], { plane: true, plant: 'bush' });
  const fire = fires.ignite(world, 0.5, 0.5);
  fires.update(1.5, 1.5, world);
  const visible = fires.prepare({ x0: -50, y0: -30, cols: 100, rows: 60 }, 1.5);
  assert.ok(visible.length > 1, 'flames follow the advancing front');
  assert.ok(visible.length <= MAX_FIRES, 'many fuel nodes share the existing flame budget');
  assert.ok(visible.every(f => f.hearth.length === 0), 'natural fires have no stone ring or campfire logs');
  fires.update(60, 60, world);
  for (let i = 0; i < 16 && fires.list.length; i++) fires.update(0.1, 60 + (i + 1) / 10, world);
  assert.equal(fire.spread.nodes.size, MAX_BURN_OBJECTS);
  assert.equal(fire.spread.active.size, 0);
  assert.equal(fires.list.length, 0);
  assert.ok(!world.gathered.has('bush:100:100'), 'connected wood does not give the blaze unlimited reach');
});

test('fast-forward and small steps burn the same connected cells', () => {
  const points = Array.from({ length: 48 }, (_, x) => [x, 0]);
  const a = field(points), b = field(points);
  a.fires.ignite(a.world, 0.5, 0.5);
  b.fires.ignite(b.world, 0.5, 0.5);
  a.fires.update(30, 30, a.world);
  for (let i = 0; i < 300; i++) b.fires.update(0.1, i / 10, b.world);
  assert.deepEqual([...a.burned].sort(), [...b.burned].sort());
  assert.equal(a.burned.size, points.length, 'the entire clump burns despite its length');
  assert.equal(a.fires.list.length, 0);
  assert.equal(b.fires.list.length, 0);
});

test('strong wind can stop a natural ignition before its fuel spreads', () => {
  const { world, burned, fires } = field([[0, 0], [1, 0]]);
  fires.windAt = () => 1;
  const fire = fires.ignite(world, 0.5, 0.5);
  fires.update(5, 5, world);
  assert.equal(fire.outReason, 'wind');
  assert.deepEqual([...burned], ['0,0']);
});

test('exact burn cells persist across negative chunk boundaries without a radial mark', () => {
  const world = new World(19, 16);
  world.setTerrain(-1, -1, GRASS);
  world.burnGrassCell(-0.5, -0.5);
  const { c, i } = world.locate(-1, -1);
  assert.equal(c.burnt[i], 255);
  assert.equal(c.burnt[i - 1], 0);
  const mark = c.burnt.slice();
  for (let n = 0; n < 48; n++) world.chunk(n + 20, 20);
  assert.deepEqual(world.locate(-1, -1).c.burnt, mark);
});

test('picked berry foliage remains fuel, while consumed plants neither render nor obstruct a hearth', () => {
  const bush = { kind: 'bush', x: 0.5, y: 0.5, harvested: true };
  const world = { typeAt: () => GRASS, isWalkable: () => true, propsIn: () => [] };
  const resourcesIn = () => [bush];
  const fires = new Fires({ resourcesIn });
  assert.equal(vegetationFuel(world, bush.x, bush.y, resourcesIn)?.node, bush);
  assert.equal(fires.canPlace(world, 0.5, 0.5), false);
  const leaves = [];
  const renderer = { cols: 40, rows: 24 }, view = { x0: -10, y0: -10 };
  drawResource(renderer, view, bush, 0, (...args) => leaves.push(args));
  assert.ok(leaves.length > 0, 'picking berries preserves combustible foliage');
  bush.burnt = true;
  assert.equal(vegetationFuel(world, bush.x, bush.y, resourcesIn), null);
  assert.equal(fires.canPlace(world, 0.5, 0.5), true);
  drawResource(renderer, view, bush, 0, () => assert.fail('burned plants have no surviving foliage'));
});

for (const kind of ['grass', 'bush']) {
  test(`consumed resource ${kind} leaves ash and stays absent after chunk eviction`, () => {
    const world = new World(19, 16);
    const harvesting = new Harvesting(world, null);
    const plant = harvesting.resourcesOf(0, 0).find(p => p.kind === kind);
    assert.ok(plant);
    const fires = new Fires({ windAt: () => 0, resourcesIn: harvesting.resourcesIn.bind(harvesting) });
    const fire = fires.ignite(world, plant.x, plant.y, { source: 'lightning' });
    assert.ok(fire);
    assert.equal(plant.burnt, true);
    assert.equal(plant.harvested, true);
    assert.ok(world.burntPlants.has(`${kind}:${Math.floor(plant.x)}:${Math.floor(plant.y)}`));
    const { c, i } = world.locate(Math.floor(plant.x), Math.floor(plant.y));
    assert.equal(c.burnt[i], 255);
    finish(fires, world);
    for (let n = 0; n < 48; n++) world.chunk(n + 20, 20);
    const regenerated = harvesting.resourcesOf(0, 0).find(p => p.uid === plant.uid);
    assert.ok(regenerated);
    assert.equal(regenerated.burnt, true);
    assert.equal(regenerated.harvested, true);
    assert.equal(harvesting.harvest(regenerated), null, 'fire consumes resources without granting harvest rewards');
    const view = { x0: Math.floor(plant.x) - 10, y0: Math.floor(plant.y) - 10 };
    drawResource({ cols: 40, rows: 24 }, view, regenerated, 0,
      () => assert.fail('a consumed plant must not grow green stubble or leaves'));
    assert.equal(fire.outReason, 'fuel');
  });
}

test('burning trampled grass removes its green footprint mat instead of painting over ash', () => {
  const world = new World(19);
  const chunk = world.chunk(0, 0);
  const i = chunk.blades.indices[0];
  const x = (i % 64) + 0.5, y = Math.floor(i / 64) + 0.5;
  const grass = new Grass();
  grass.update(world, { x, y, air: 0, feet: [{ id: 1, plant: 1, grounded: true, hx: x, hy: y, tx: x, ty: y + 0.55 }] }, 1);
  const key = `${Math.floor(x)},${Math.floor(y)}`;
  assert.ok(grass.tracks.has(key));
  world.burnGrassCell(x, y);
  const view = { x0: Math.floor(x) - 2, y0: Math.floor(y) - 2, cols: 5, rows: 5 };
  const r = withLayers({ cols: 5, rows: 5 });
  r.put(2, 2, glyph('.'), 40, 30, 20);
  grass.drawTracks(r, view, 1, world);
  assert.equal(r.glyphAt(12), glyph('.'), 'ash is still the visible character');
  assert.deepEqual([...r.fg.slice(48, 51)], [40, 30, 20]);
  assert.equal(grass.tracks.has(key), false);
});

test('burning trees survive chunk eviction as active fuel and leave persistent charred stumps', () => {
  const world = new World(19, 16);
  const tree = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 0], [0, 2]].flatMap(([cx, cy]) => world.propsOf(cx, cy))
    .find(p => p.kind === 'tree' && world.typeAt(p.x, p.y) !== WATER);
  assert.ok(tree);
  const fuel = vegetationFuel(world, tree.x, tree.y);
  assert.equal(fuel?.prop, tree);
  const fires = new Fires({ windAt: () => 0 });
  const fire = fires.ignite(world, tree.x, tree.y, { source: 'lightning' });
  assert.ok(fire);
  fires.update(0.5, 0.5, world);
  const [_, cx, cy] = tree.id.split(':');
  for (let n = 0; n < 48; n++) world.chunk(n + 20, 20);
  const regenerated = world.propsOf(Number(cx), Number(cy)).find(p => p.id === tree.id);
  assert.ok(regenerated.burning?.progress > 0, 'the same burn state follows the regenerated tree');
  finish(fires, world);
  assert.equal(regenerated.burnt, true);
  assert.equal(regenerated.chopped, true);
  assert.equal(blocks(regenerated, regenerated.x, regenerated.y), false);
  for (let n = 0; n < 48; n++) world.chunk(n + 20, 20);
  const stump = world.propsOf(Number(cx), Number(cy)).find(p => p.id === tree.id);
  assert.equal(stump.burnt, true);
  assert.equal(stump.chopped, true);
  assert.equal(stump.burning, undefined);
  const cells = [];
  drawProp({}, { x0: 0, y0: 0 }, stump, (_r, x, y, g, red, green, blue) => cells.push({ x, y, g, red, green, blue }));
  assert.ok(cells.length > 0 && cells.every(c => c.red < 70 && c.green < 70), 'only a dark charred stump is drawn');
  assert.equal(world.burningTrees.size, 0);
});

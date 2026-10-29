import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { KINDS, Monster, Monsters, toCells } from '../src/entities/monsters.js';
import { GRASS } from '../src/world/world.js';

const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
// Resolve the browser import map in Node, replacing only the GPU renderer
// (see model-animation.test.js).
const modules = new Map([['three', dataURL(`
  export * from ${JSON.stringify(threeURL)};
  export class WebGLRenderer {
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
  }
`)]]);
function moduleURL(path) {
  const file = new URL(path, import.meta.url);
  const source = readFileSync(file, 'utf8').replace(/from '([^']+)'/g, (_, specifier) => {
    const target = specifier === 'three' ? specifier : new URL(specifier, file).href;
    return `from ${JSON.stringify(modules.get(target) ?? target)}`;
  });
  const url = dataURL(source);
  modules.set(file.href, url);
  return url;
}
moduleURL('../vendor/three/utils/BufferGeometryUtils.js');
moduleURL('../vendor/three/utils/SkeletonUtils.js');
const { GLTFLoader } = await import(moduleURL('../vendor/three/loaders/GLTFLoader.js'));
moduleURL('../src/entities/retarget.js');
moduleURL('../src/entities/gear.js');
moduleURL('../src/entities/armory.js');
moduleURL('../src/entities/model.js');
const { MonsterFigures } = await import(moduleURL('../src/entities/monster-figures.js'));

const bytes = readFileSync(new URL('../assets/ual1.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const figures = () => new MonsterFigures(gltf, { renderer: {
  setPixelRatio() {}, setSize() {}, setClearColor() {},
} });
const SKELETON = KINDS.skeleton;
const open = { isWalkable: () => true, typeAt: () => GRASS };
const dt = 1 / 60;

test('a frozen monster keeps a finite pose and resumes walking after thawing', () => {
  const f = figures();
  const s = new Monster(0, 0, { risen: true });
  s.magicSpeed = 0;
  s.update(dt, open, null);
  assert.equal(s.speedScale, 0);
  f.update(dt, [s]);
  const rig = f.rigs.get(s);
  const finitePose = () => {
    assert.ok(Object.values(rig.weights).every(Number.isFinite));
    rig.model.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
  };
  finitePose();
  s.magicSpeed = 1;
  s.setState('chase');
  const [x, y] = toCells(10, 0);
  for (let time = 0; time < 0.5; time += dt) {
    s.update(dt, open, { x, y });
    f.update(dt, [s]);
    finitePose();
  }
  assert.ok(s.groundSpeed > 0);
  assert.ok(rig.weights.walk + rig.weights.run > 0);
});

test('the skeleton is bones on the armature, not the mannequin skin', () => {
  const f = figures();
  const s = new Monster(0, 0, { risen: true });
  f.update(dt, [s]);
  const rig = f.rigs.get(s);
  let skinned = 0;
  let bones = 0;
  rig.model.traverse((o) => {
    if (o.isSkinnedMesh) skinned++;
    if (o.isMesh) bones++;
  });
  assert.equal(skinned, 0);
  assert.ok(bones > 30, `${bones} bone meshes`);
  // The player's model still has its own skin.
  let skin = 0;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skin++; });
  assert.ok(skin > 0);
});

test('a skeleton stands upright, runs on its feet, and falls over when killed', () => {
  const f = figures();
  const monsters = new Monsters({ counts: { skeleton: 3 }, first: Infinity });
  const s = new Monster(0, 0, { risen: true });
  monsters.list.push(s);
  const player = { x: toCells(12, 0)[0], y: 0, air: 0, heading: -Math.PI / 2, runSpeed: 5, feel: { reach: 0.95 } };
  for (let t = 0; t < 0.5; t += dt) f.update(dt, monsters.list);
  const rig = f.rigs.get(s);
  const standing = rig.headHeight();
  assert.ok(standing > 1.3, `head at ${standing} m`);
  // Running at the player, it stays on its feet.
  for (let t = 0; t < 1.5; t += dt) {
    monsters.update(dt, open, player);
    f.update(dt, monsters.list);
  }
  assert.equal(s.state, 'chase');
  assert.ok(rig.weights.run > 0.5, 'running');
  assert.ok(rig.headHeight() > 1.1);
  // Cut down, it collapses to the ground.
  [player.x, player.y] = [s.x + toCells(1, 0)[0], s.y];
  monsters.strike({ type: 'strike', swing: 'spin' }, player, 1000);
  assert.equal(s.state, 'dead');
  for (let t = 0; t < 3; t += dt) {
    monsters.update(dt, open, player);
    f.update(dt, monsters.list);
  }
  assert.ok(rig.headHeight() < 0.5, `head at ${rig.headHeight()} m after falling`);
});

test('a skeleton climbs up from the ground as it rises', () => {
  const f = figures();
  const s = new Monster(0, 0);
  f.update(dt, [s]);
  const rig = f.rigs.get(s);
  assert.ok(rig.headHeight() < 0.5, `starts at ${rig.headHeight()} m`);
  for (let t = 0; t < SKELETON.rise + 0.5; t += dt) {
    s.update(dt, open, null);
    f.update(dt, [s]);
  }
  assert.ok(rig.headHeight() > 1.3, `ends at ${rig.headHeight()} m`);
});

test('a wading skeleton stands on the lake bed, its legs cut by the surface', () => {
  const f = figures();
  const s = new Monster(0, 0, { risen: true });
  f.update(dt, [s]);
  const rig = f.rigs.get(s);
  const dry = rig.headHeight();
  assert.deepEqual(rig.waterContacts(), []);
  s.waterDepth = 0.42;
  f.update(dt, [s]);
  assert.ok(Math.abs(rig.headHeight() - (dry - 0.42)) < 0.02, 'lowered by the depth');
  const contacts = rig.waterContacts();
  assert.equal(contacts.length, 2, 'a waterline on each leg');
  for (const c of contacts) assert.ok(Math.abs(c.x) < 0.4 && Math.abs(c.z) < 0.4);
});

test('rigs of removed monsters are reused', () => {
  const f = figures();
  const a = new Monster(0, 0, { risen: true });
  f.update(dt, [a]);
  const rig = f.rigs.get(a);
  f.update(dt, []);
  assert.equal(f.rigs.size, 0);
  const b = new Monster(5, 5, { risen: true });
  f.update(dt, [b]);
  assert.equal(f.rigs.get(b), rig);
  assert.equal(f.scene.children.filter((c) => c === rig.model).length, 1);
});

test('read-back pixels become cells: outline at the edges, glyphs inside, glowing eyes', () => {
  const f = figures();
  const s = new Monster(10.5, 20.5, { risen: true });
  // Paint slot 0: a solid bone-white block and a lone ember-red cell.
  const fill = (cx, cy, rgb, cover = 1) => {
    for (let j = 0; j < 6; j++) {
      const row = f.height - 1 - (cy * 6 + j);
      for (let i = 0; i < 4; i++) {
        if ((j * 4 + i) / 24 >= cover) continue;
        f.pixels.set([...rgb, 255], (row * f.width + cx * 4 + i) * 4);
      }
    }
  };
  for (let cy = 10; cy < 14; cy++) for (let cx = 30; cx < 33; cx++) fill(cx, cy, [210, 205, 180]);
  fill(31, 8, [255, 90, 30]);
  fill(29, 10, [210, 205, 180], 0.5);
  const view = { x0: 0, y0: 0 };
  const slot = { x: 0, cx0: Math.floor(s.x) - 32, cy0: Math.floor(s.y) - 38, cols: 64, rows: f.height / 6 };
  const { cells, top } = f.cellsOf(slot, s, view, 0);
  assert.equal(cells.length, 3 * 4 + 2);
  const at = (cx, cy) => cells.find((c) => c.sx === slot.cx0 + cx && c.sy === slot.cy0 + cy);
  assert.ok(at(31, 11).g !== at(29, 10).g, 'an edge is drawn differently from the solid bone');
  const eye = at(31, 8);
  assert.ok(eye.r > 200 && eye.gg < 140, 'the eye keeps its ember colour');
  assert.equal(top, slot.cy0 + 8);
  assert.equal(f.cellsOf(slot, s, view, 0).bottom, slot.cy0 + 13);
  // A fresh cut flashes the bones.
  const flashed = f.cellsOf(slot, s, view, 1);
  assert.ok(flashed.cells[0].gg >= cells[0].gg);
});

test('a goblin is a small green figure with a big head, and falls over when killed', () => {
  const f = figures();
  const monsters = new Monsters({ counts: { goblin: 1 }, first: Infinity });
  const g = new Monster(0, 0, { kind: KINDS.goblin });
  const s = new Monster(5, 0, { risen: true });
  monsters.list.push(g, s);
  f.update(dt, monsters.list);
  const rig = f.rigs.get(g);
  let skin = null;
  rig.model.traverse((o) => { if (o.isSkinnedMesh) skin = o; });
  assert.ok(skin, 'it keeps the mannequin skin');
  assert.ok(skin.material.vertexColors);
  // Its painted skin is its own: the player's figure paints the shared mesh.
  let shared = null;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && o.name === skin.name) shared = o; });
  assert.notEqual(skin.geometry, shared.geometry);
  const colors = skin.geometry.attributes.color;
  let green = 0;
  for (let i = 0; i < colors.count; i++) if (colors.getY(i) > colors.getX(i) && colors.getY(i) > colors.getZ(i)) green++;
  assert.ok(green > colors.count * 0.5, 'mostly green');
  for (let t = 0; t < 0.5; t += dt) f.update(dt, monsters.list);
  const standing = rig.headHeight();
  const skeletonHead = f.rigs.get(s).headHeight();
  assert.ok(standing > 0.7 && standing < skeletonHead * 0.75, `goblin head at ${standing} m, skeleton ${skeletonHead} m`);
  assert.ok(rig.head.scale.x > 1.2, 'a big head');
  const p = { x: g.x + toCells(0.8, 0)[0], y: 0, air: 0, heading: -Math.PI / 2, runSpeed: 5, feel: { reach: 0.95 } };
  monsters.strike({ type: 'strike', swing: 'spin' }, p, 1000);
  for (let t = 0; t < 3; t += dt) {
    monsters.update(dt, open, p);
    f.update(dt, monsters.list);
  }
  assert.ok(rig.headHeight() < 0.35, `head at ${rig.headHeight()} m after falling`);
  // Long after the fall has ended, the head is still its own size.
  for (let t = 0; t < 2; t += dt) f.update(dt, monsters.list);
  assert.ok(Math.abs(rig.head.scale.x - 1.35) < 1e-6, `head scale ${rig.head.scale.x}`);
});

test('a troll towers over a skeleton, broad and small-headed, and falls over when killed', () => {
  const f = figures();
  const monsters = new Monsters({ counts: { troll: 1 }, first: Infinity });
  const t = new Monster(0, 0, { kind: KINDS.troll });
  const s = new Monster(8, 0, { risen: true });
  monsters.list.push(t, s);
  for (let time = 0; time < 0.5; time += dt) f.update(dt, monsters.list);
  const rig = f.rigs.get(t);
  const tall = rig.headHeight();
  const skeletonHead = f.rigs.get(s).headHeight();
  assert.ok(tall > skeletonHead * 1.25, `troll head at ${tall} m, skeleton ${skeletonHead} m`);
  let skin = null;
  rig.model.traverse((o) => { if (o.isSkinnedMesh) skin = o; });
  const c = skin.geometry.attributes.color;
  assert.ok(Math.abs(c.getX(0) - c.getZ(0)) < 0.2, 'mossy grey, not goblin green');
  const p = { x: t.x + toCells(1, 0)[0], y: 0, air: 0, heading: -Math.PI / 2, runSpeed: 5, feel: { reach: 0.95 } };
  monsters.strike({ type: 'strike', swing: 'spin' }, p, 1000);
  for (let time = 0; time < 4; time += dt) {
    monsters.update(dt, open, p);
    f.update(dt, monsters.list);
  }
  assert.ok(rig.headHeight() < 0.7, `head at ${rig.headHeight()} m after falling`);
  assert.ok(Math.abs(rig.bones['DEF-spine003'].scale.x - 1.22) < 1e-6, 'its build holds after the fall');
});

test('the slot round a fallen troll holds its whole body and club, whichever way it falls', async () => {
  const THREE = await import(modules.get('three'));
  const view = { x0: -200, y0: -200, cols: 400, rows: 400 };
  for (let i = 0; i < 8; i++) {
    const f = figures();
    const t = new Monster(0, 0, { kind: KINDS.troll, heading: (i * Math.PI) / 4 });
    f.update(dt, [t]);
    t.takeHit(1e6, t.x + Math.sin(t.heading), t.y + Math.cos(t.heading));
    assert.equal(t.state, 'dead');
    for (let time = 0; time < 2.5; time += dt) f.update(dt, [t]);
    const rig = f.rigs.get(t);
    const slot = f.slotOf(t, view);
    // In world cells, the way the camera sees it.
    const inside = (v, what) => {
      const cx = t.x + (v.x * 13) / 0.6;
      const cy = t.y - (v.y * Math.sqrt(0.75) - v.z * 0.5) * 13;
      assert.ok(cx > slot.cx0 && cx < slot.cx0 + slot.cols && cy > slot.cy0 && cy < slot.cy0 + slot.rows,
        `heading ${i}: ${what} at (${cx.toFixed(1)}, ${cy.toFixed(1)}) outside ${JSON.stringify(slot)}`);
    };
    const v = new THREE.Vector3();
    rig.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const pos = o.geometry.attributes.position;
      for (let k = 0; k < pos.count; k += 7) {
        o.applyBoneTransform(k, v.fromBufferAttribute(pos, k)).applyMatrix4(o.matrixWorld);
        inside(v, 'the skin');
      }
    });
    inside(rig.club.localToWorld(new THREE.Vector3(0, 0.72, 0)), 'the club head');
  }
});

test('a troll swings its club in both hands, high overhead, down to the ground and never through it', async () => {
  const THREE = await import(modules.get('three'));
  const f = figures();
  const t = new Monster(0, 0, { kind: KINDS.troll });
  const p = { x: toCells(1.65, 0)[0], y: 0, air: 0, runSpeed: 5 };
  f.update(dt, [t]);
  const rig = f.rigs.get(t);
  const length = rig.club.localToWorld(new THREE.Vector3(0, 0.72, 0))
    .distanceTo(rig.club.localToWorld(new THREE.Vector3(0, -0.15, 0)));
  assert.ok(length > 0.9 && length < 1.5, `club ${length} m long`);
  let lowest = Infinity;
  let highest = -Infinity;
  let impact = null;
  let apart = 0;
  const events = [];
  for (let time = 0; time < KINDS.troll.swingTime + 0.5; time += dt) {
    t.update(dt, { isWalkable: () => true, typeAt: () => GRASS }, p);
    f.update(dt, [t]);
    events.push(...t.events.splice(0));
    if (t.state !== 'attack') continue;
    const head = rig.clubHeadHeight();
    lowest = Math.min(lowest, head);
    highest = Math.max(highest, head);
    // Both hands stay on the haft.
    const hands = ['DEF-handR', 'DEF-handL'].map((n) => rig.bones[n].getWorldPosition(new THREE.Vector3()));
    const haft = rig.club.localToWorld(new THREE.Vector3(0, 0, 0));
    apart = Math.max(apart, ...hands.map((h) => h.distanceTo(haft)));
    if (!impact && events.some((e) => e.type === 'slam')) {
      impact = { head, at: rig.club.localToWorld(new THREE.Vector3(0, 0.72, 0)) };
    }
  }
  assert.ok(lowest >= 0, `the club head dips to ${lowest} m`);
  assert.ok(highest > rig.headHeight() + 0.3, `raised to ${highest} m`);
  assert.ok(impact && impact.head < 0.2, `meets the ground: ${impact?.head} m`);
  // It lands where the smash is felt, in front of the troll.
  assert.ok(Math.abs(Math.hypot(impact.at.x, impact.at.z) - KINDS.troll.smashAt) < 0.45,
    `lands ${Math.hypot(impact.at.x, impact.at.z)} m ahead`);
  assert.ok(apart < 0.35, `hands stray ${apart} m from the grip`);
});

test('an elf is tall and pale in a green tunic, bow in hand, and raises it to draw', async () => {
  const THREE = await import(modules.get('three'));
  const f = figures();
  const e = new Monster(0, 0, { kind: KINDS.elf });
  f.update(dt, [e]);
  const rig = f.rigs.get(e);
  // The colour of each vertex by the bone that moves it most, across both
  // of the mannequin's meshes. (The fingers have the most vertices.)
  const regions = {};
  rig.model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const { color, skinIndex, skinWeight } = o.geometry.attributes;
    for (let i = 0; i < color.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
      const name = o.skeleton.bones[skinIndex.getComponent(i, best)].name;
      const region = /spine/.test(name) ? 'torso' : /head/.test(name) ? 'head' : /handR/.test(name) ? 'hand'
        : /shinL/.test(name) ? 'leg' : null;
      if (region) regions[region] = [color.getX(i), color.getY(i), color.getZ(i)];
    }
  });
  const [tr, tg, tb] = regions.torso;
  assert.ok(tg > tr && tg > tb, `a green tunic: ${regions.torso}`);
  for (const pale of [regions.head, regions.hand]) assert.ok(pale[0] > 0.6 && pale[1] > 0.5, `pale skin: ${pale}`);
  assert.ok(regions.leg[0] > regions.leg[2] && regions.leg[0] < 0.5, `brown leggings: ${regions.leg}`);
  assert.equal(rig.armory.active?.visible, true, 'a bow in hand');
  for (let time = 0; time < 0.5; time += dt) f.update(dt, [e]);
  const hand = () => rig.bones['DEF-handL'].getWorldPosition(new THREE.Vector3()).y;
  const resting = hand();
  e.setState('aim');
  for (let time = 0; time < 0.4; time += dt) {
    e.stateTime += dt;
    f.update(dt, [e]);
  }
  assert.ok(hand() > resting + 0.3, `hand from ${resting} m to ${hand()} m`);
});

test('an elf draws like an archer: bow upright in the outstretched left hand, string back to the cheek', async () => {
  const THREE = await import(modules.get('three'));
  const f = figures();
  const e = new Monster(0, 0, { kind: KINDS.elf, heading: 0.7 });
  f.update(dt, [e]);
  e.setState('aim');
  for (let time = 0; time < 0.6; time += dt) {
    e.stateTime += dt;
    f.update(dt, [e]);
  }
  const rig = f.rigs.get(e);
  const bow = rig.armory.active;
  assert.equal(bow.parent, rig.bones['DEF-handL'], 'held in the left hand');
  // Into the elf's own frame, facing +z, to judge the shape.
  const local = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.7);
  const at = (x, y) => local(bow.localToWorld(new THREE.Vector3(x, y, 0)));
  const grip = at(0, 0);
  const string = at(0, -0.13);
  const tips = [at(-0.73, -0.13), at(0.73, -0.13)];
  // Upright: the tips one above the other.
  assert.ok(Math.abs(tips[0].y - tips[1].y) > 1.2, 'limbs up and down');
  assert.ok(Math.hypot(tips[0].x - tips[1].x, tips[0].z - tips[1].z) < 0.15, 'not leaning');
  // The belly faces the target: the grip ahead of the string, the tips level with it.
  assert.ok(grip.z > string.z + 0.1, `grip ${grip.z}, string ${string.z}`);
  for (const tip of tips) assert.ok(Math.abs(tip.z - string.z) < 0.05, 'the string meets the tips');
  const bone = (n) => local(rig.bones[n].getWorldPosition(new THREE.Vector3()));
  const head = bone('DEF-head');
  assert.ok(bone('DEF-handL').z > 0.4 && Math.abs(bone('DEF-handL').y - bone('DEF-upper_armL').y) < 0.15,
    'the bow arm straight out at shoulder height');
  assert.ok(bone('DEF-handR').distanceTo(head) < 0.25, 'the drawing hand at the cheek');
});

test('on raised ground a monster is drawn through its own lifted view, its health bar over it', () => {
  // A stand-in GPU whose read-back is solid bone over every slot.
  const gpu = { setPixelRatio() {}, setSize() {}, setClearColor() {}, setScissorTest() {}, clear() {},
    setViewport() {}, setScissor() {}, render() {},
    getContext: () => ({ readPixels: (x, y, w, h, format, type, out) => out.fill(200) }) };
  const f = new MonsterFigures(gltf, { renderer: gpu });
  const s = new Monster(0.5, 0.5, { risen: true });
  f.update(dt, [s]);
  const view = { x0: -100, y0: -60, cols: 200, rows: 120 };
  const rows = ([d]) => [d.base, d.top, d.cells.map((c) => c.sy)];
  const [base, top, plain] = rows(f.rasterise(view, [s], s));
  assert.ok(plain.length > 0);
  const [liftedBase, liftedTop, lifted] = rows(f.rasterise(view, [s], s, () => ({ ...view, y0: view.y0 + 6 })));
  assert.equal(liftedBase, base - 6);
  assert.deepEqual(lifted, plain.map((sy) => sy - 6));
  // The top is a row of the plain view, so the bar rides up with the figure.
  assert.equal(liftedTop, top - 6);
});

test('a pitched camera frames a monster where the pitch draws it', async () => {
  const { BASE_LOOK, pitchLook } = await import('../src/world/camera.js');
  const { assertPitched } = await import('./helpers/pitch-check.js');
  const view = { x0: -200, y0: -200, cols: 400, rows: 400 };
  const f = figures();
  const t = new Monster(0.3, 0.6, { kind: KINDS.troll, heading: 0.7 });
  for (let i = 0; i < 10; i++) f.update(dt, [t]);
  const rig = f.rigs.get(t);
  assert.equal(f.pitch, BASE_LOOK);
  assert.deepEqual(rig.reach(), rig.reach(BASE_LOOK.up), 'the usual pitch by default');
  const rows = {};
  for (const deg of [30, 25, 45]) {
    const look = pitchLook(deg);
    f.setLook(look);
    const dir = f.camera.position.clone().normalize();
    assert.ok(Math.abs(dir.y - look.sin) < 1e-9 && Math.abs(dir.z - look.cos) < 1e-9);
    const slot = f.slotOf(t, view);
    rows[deg] = slot.rows;
    assert.ok(assertPitched(f, rig.model, t.x, t.y, slot, look) > 10);
  }
  assert.ok(rows[25] > rows[30] && rows[30] > rows[45], JSON.stringify(rows));
});

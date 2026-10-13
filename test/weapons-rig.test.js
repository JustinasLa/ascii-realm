import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dressFigure, drawFigure } from '../src/entities/figure.js';
import { MATERIALS } from '../src/entities/materials.js';
import { buildRig, project, rotY, sub } from '../src/entities/rig.js';
import { glyph } from '../src/render/glyphs.js';
import { getWeapon, MATERIAL_IDS, WEAPON_IDS } from '../src/entities/weapons.js';

const HEADINGS = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
const GUARD = {
  hand: [0.12, 0.24, 0.3], blade: [-0.55, 0.5, 0.67],
  twist: 0.3, lean: 0, crouch: 0.14, off: 1,
};

function state(id = 'greatsword', material = 'steel', extra = {}, inHand = true) {
  const weapon = getWeapon(id, material);
  return {
    x: 80, y: 70, heading: 0, phase: 0, walk: 0, run: 0, time: 0,
    weapon,
    combat: { weapon, active: 1, inHand, pose: GUARD },
    ...extra,
  };
}

// Definitions contain local sprite coordinates. Only posed geometry should
// rotate with the warrior, so leave the source data out of these checks.
function vectors(record, prefix = '', out = new Map()) {
  if (!record || typeof record !== 'object') return out;
  if (Array.isArray(record) && record.length === 3 && record.every((n) => typeof n === 'number')) {
    out.set(prefix, record);
    return out;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'definition' || key === 'spriteParts') continue;
    vectors(value, `${prefix}.${key}`, out);
  }
  return out;
}

function equipmentVectors(rig) {
  return vectors({
    weapon: rig.weapon, sheathed: rig.sheathedWeapon,
    shield: rig.shield, quiver: rig.quiver,
  });
}

function near(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-9,
      `${message}: coordinate ${i}, ${actual[i]} != ${expected[i]}`);
  }
}

function buffer(cols = 160, rows = 100) {
  return {
    cols, rows,
    fg: new Uint8ClampedArray(cols * rows * 4),
    bg: new Uint8ClampedArray(cols * rows * 4),
    put(x, y, g, r, green, b) {
      assert.ok([x, y, g, r, green, b].every(Number.isFinite), 'a rendered cell is finite');
      assert.ok(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(g));
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      this.fg.set([r, green, b, g], (y * cols + x) * 4);
    },
    putBg(x, y, r, green, b) {
      assert.ok([r, green, b].every(Number.isFinite), 'a rendered background is finite');
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      this.bg.set([r, green, b], (y * cols + x) * 4);
    },
  };
}

function rasterize(st) {
  const r = buffer();
  const view = { x0: 0, y0: 0, cols: r.cols, rows: r.rows };
  drawFigure(r, view, st, dressFigure(st));
  return r;
}

function glyphs(r) {
  return Array.from({ length: r.cols * r.rows }, (_, i) => r.fg[i * 4 + 3]).join(',');
}

function visible(r) {
  let cells = 0;
  for (let i = 0; i < r.fg.length; i += 4) {
    if (r.fg[i] || r.fg[i + 1] || r.fg[i + 2]) cells++;
  }
  return cells;
}

test('every weapon and material has finite posed equipment and projected shapes', () => {
  const poses = [
    {},
    { phase: 1.2, walk: 0.8, run: 0.3 },
    { phase: 2.4, walk: 1, run: 1, air: 0.35 },
    { crouch: 0.5, kneel: 0.6, look: 0.3 },
  ];
  for (const id of WEAPON_IDS) {
    for (const material of MATERIAL_IDS) {
      for (const heading of HEADINGS) {
        for (const pose of poses) {
          for (const inHand of [false, true]) {
            const st = state(id, material, { heading, ...pose }, inHand);
            const rig = buildRig(st);
            const label = `${id}/${material}, heading=${heading}, drawn=${inHand}`;
            assert.equal(Boolean(rig.weapon), inHand, label);
            assert.ok(rig.sheathedWeapon, `${label}: carried geometry exists`);
            assert.equal(rig.sheathedWeapon.carried, !inHand, label);
            const joints = vectors({ legs: rig.legs, arms: rig.arms });
            for (const [name, point] of [...joints, ...equipmentVectors(rig)]) {
              assert.ok(point.every(Number.isFinite), `${label}${name}: finite point`);
            }
            for (const equipment of [rig.weapon, rig.sheathedWeapon].filter(Boolean)) {
              near([Math.hypot(...equipment.blade)], [1], `${label}: blade frame is normalized`);
              near([Math.hypot(...equipment.side)], [1], `${label}: side frame is normalized`);
            }
            const parts = dressFigure(st);
            assert.ok(parts.length > 0, `${label}: dressed figure exists`);
            for (let i = 0; i < parts.length; i++) {
              const p = parts[i];
              assert.ok([p.x0, p.x1, p.y0, p.y1, p.z, ...p.mat.color].every(Number.isFinite),
                `${label}: finite bounds, depth and material`);
              assert.ok(p.x0 <= p.x1 && p.y0 <= p.y1, `${label}: ordered bounds`);
              if (i > 0) assert.ok(parts[i - 1].z <= p.z, `${label}: sorted by depth`);
              const sample = {};
              if (p.test((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, sample)) {
                assert.ok(['nx', 'ny', 'u', 'v'].every((key) => Number.isFinite(sample[key])),
                  `${label}: finite raster sample`);
              }
            }
          }
        }
      }
    }
  }
});

test('carried and drawn equipment follows the heading and combat spin', () => {
  for (const id of WEAPON_IDS) {
    for (const inHand of [false, true]) {
      const base = buildRig(state(id, 'steel', {}, inHand));
      const original = equipmentVectors(base);
      for (const heading of HEADINGS) {
        const spin = 0.61;
        const turned = buildRig(state(id, 'steel', { heading, combatSpin: spin }, inHand));
        const actual = equipmentVectors(turned);
        assert.deepEqual([...actual.keys()], [...original.keys()], `${id}: equipment is retained`);
        for (const [name, point] of original) {
          near(actual.get(name), rotY(point, heading + spin), `${id}${name}: heading and spin`);
        }
        near(turned.at([0.2, 0.4, -0.1]), rotY(base.at([0.2, 0.4, -0.1]), heading + spin),
          `${id}: torso attachments rotate with the weapon`);
      }
    }
  }
});

test('the weapon is gripped by the sword-side hand and uses its configured reach', () => {
  const lengths = new Map();
  for (const id of WEAPON_IDS) {
    const st = state(id);
    const rig = buildRig(st);
    const wrist = rig.arms.find((arm) => arm.s === -1).wrist;
    const offset = sub(rig.weapon.grip, wrist);
    near(offset, rig.weapon.blade.map((n) => n * 0.03), `${id}: grip rests in the main hand`);
    const length = Math.hypot(...sub(rig.weapon.tip, rig.weapon.guard));
    near([length], [st.weapon.reach], `${id}: visible reach matches the weapon`);
    lengths.set(id, length);
  }
  assert.ok(lengths.get('spear') > lengths.get('dagger') * 2, 'a spear reaches beyond a dagger');
  assert.ok(lengths.get('greatsword') > lengths.get('dagger'), 'a greatsword is longer than a dagger');
});

test('only two-handed melee weapons attach the other hand to the grip', () => {
  for (const id of WEAPON_IDS.filter((id) => id !== 'bow')) {
    const st = state(id);
    const joined = buildRig(st);
    const free = buildRig({ ...st, combat: { ...st.combat, pose: { ...GUARD, off: 0 } } });
    const joinedWrist = joined.arms.find((arm) => arm.s === 1).wrist;
    const freeWrist = free.arms.find((arm) => arm.s === 1).wrist;
    if (st.weapon.hands === 2) {
      assert.ok(Math.hypot(...sub(joinedWrist, freeWrist)) > 0.03, `${id}: the support hand joins`);
    } else {
      near(joinedWrist, freeWrist, `${id}: the support hand remains independent`);
    }
  }
});

test('shield and quiver are present only with their matching loadout', () => {
  for (const id of WEAPON_IDS) {
    for (const inHand of [false, true]) {
      const rig = buildRig(state(id, 'steel', {}, inHand));
      assert.equal(Boolean(rig.shield), id === 'sword-shield', `${id}: shield`);
      assert.equal(Boolean(rig.quiver), id === 'bow', `${id}: quiver`);
      if (rig.quiver) {
        assert.ok(rig.quiver.arrows.length > 0, 'the bow carries arrows');
        for (const arrow of rig.quiver.arrows) {
          assert.ok(Math.hypot(...sub(arrow.tip, arrow.tail)) > 0.2, 'arrows have a visible shaft');
        }
      }
    }
  }
});

test('blocking raises the shield with the support arm', () => {
  const st = state('sword-shield', 'steel', { heading: Math.PI / 2 });
  const guarded = { ...st, combat: { ...st.combat, blocking: true } };
  const resting = buildRig(st);
  const blocked = buildRig(guarded);
  assert.equal(blocked.shield.blocking, true);
  assert.ok(blocked.shield.center[1] > resting.shield.center[1] + 0.1,
    'the shield is raised into the blocking stance');
  const wrist = blocked.arms.find((arm) => arm.s === 1).wrist;
  near([Math.hypot(...sub(blocked.shield.center, wrist))], [0.08], 'the raised shield stays on the support wrist');
  assert.notEqual(glyphs(rasterize(st)), glyphs(rasterize(guarded)), 'the blocking stance is visible');
});

test('charging the bow pulls its drawn string and arrow with the support hand', () => {
  const st = state('bow', 'steel', { heading: Math.PI / 2 });
  const pulled = { ...st, combat: { ...st.combat, charge: 1 } };
  const rested = buildRig(st);
  const drawn = buildRig(pulled);
  assert.ok(Math.hypot(...sub(drawn.weapon.string, rested.weapon.string)) > 0.05,
    'charge pulls the bowstring');
  near(drawn.weapon.arrow.tail, drawn.weapon.string, 'the nocked arrow follows the bowstring');
  near(drawn.weapon.string, drawn.arms.find((arm) => arm.s === 1).hand, 'the support hand draws the string');
  const strings = (s) => dressFigure(s).filter((part) => part.weaponPart?.material === 'string');
  const original = strings(st);
  const charged = strings(pulled);
  assert.ok(charged.length >= 2, 'two string segments connect the curved stave to the drawing hand');
  assert.notDeepEqual(charged.map((p) => [p.x0, p.x1, p.y0, p.y1]),
    original.map((p) => [p.x0, p.x1, p.y0, p.y1]), 'the rendered string geometry follows the draw');
  const point = project(drawn.weapon.string);
  assert.ok(charged.some((part) => part.test(point[0], point[1], {})), 'a rendered string reaches the drawing hand');
  assert.notEqual(glyphs(rasterize(st)), glyphs(rasterize(pulled)), 'the charged bow is visibly drawn');
});

test('weapons return to their own body mount when sheathed', () => {
  const mounts = new Set();
  for (const id of WEAPON_IDS) {
    const st = state(id, 'steel', {}, false);
    const rig = buildRig(st);
    assert.equal(rig.weapon, null, `${id}: no weapon remains in hand`);
    assert.equal(rig.sheathedWeapon.placement, st.weapon.sheath.mount, `${id}: body mount`);
    assert.equal(rig.sheathedWeapon.carried, true, `${id}: weapon is carried`);
    mounts.add(rig.sheathedWeapon.placement);
  }
  assert.deepEqual([...mounts].sort(), ['back', 'hip', 'quiver']);
  const dagger = buildRig(state('dagger', 'steel', {}, false));
  const sword = buildRig(state('greatsword', 'steel', {}, false));
  assert.ok(dagger.sheathedWeapon.grip[1] < sword.sheathedWeapon.grip[1] - 0.25,
    'the dagger hangs at the hip below the greatsword on the back');
});

test('all nine weapon loadouts produce distinct visible ASCII figures', () => {
  const appearances = new Set();
  for (const id of WEAPON_IDS) {
    const views = [0.4, Math.PI / 2, Math.PI].map((heading) => {
      const r = rasterize(state(id, 'steel', { heading }));
      assert.ok(visible(r) > 40, `${id}: the figure is visible`);
      return glyphs(r);
    });
    const appearance = views.join(';');
    assert.ok(!appearances.has(appearance), `${id}: a distinct weapon silhouette and glyphs`);
    appearances.add(appearance);
  }
  assert.equal(appearances.size, 9);
});

test('all five material tiers visibly recolour every weapon', () => {
  for (const id of WEAPON_IDS) {
    const appearances = new Set();
    const baseParts = dressFigure(state(id, MATERIAL_IDS[0], { heading: 0.4 }));
    for (const material of MATERIAL_IDS) {
      const st = state(id, material, { heading: 0.4 });
      const parts = dressFigure(st);
      assert.deepEqual(parts.map((p) => [p.x0, p.x1, p.y0, p.y1, p.z]),
        baseParts.map((p) => [p.x0, p.x1, p.y0, p.y1, p.z]), `${id}: tier preserves geometry`);
      const r = rasterize(st);
      assert.ok(visible(r) > 40, `${id}/${material}: visible cells`);
      const appearance = Array.from(r.fg).join(',');
      assert.ok(!appearances.has(appearance), `${id}/${material}: visible material colour differs`);
      appearances.add(appearance);
    }
    assert.equal(appearances.size, 5, `${id}: all tiers are visible`);
  }
});

test('weapon sprite data is consumed by the figure renderer', () => {
  for (const id of WEAPON_IDS) {
    const st = state(id);
    const parts = dressFigure(st);
    for (const descriptor of st.weapon.spriteParts) {
      assert.ok(parts.some((part) => part.weaponPart === descriptor), `${id}: its sprite part is dressed`);
    }
  }
  const st = state('dagger', 'steel', { heading: Math.PI / 2 });
  const original = rasterize(st);
  const added = {
    shape: 'limb', a: [0, 0, 0], b: [0, 3, 0],
    ra: 0.12, rb: 0.04, material: 'blade', glyph: '@',
  };
  const weapon = { ...st.weapon, spriteParts: [...st.weapon.spriteParts, added] };
  const changed = { ...st, weapon, combat: { ...st.combat, weapon } };
  assert.ok(dressFigure(changed).some((part) => part.weaponPart === added && part.glyph === glyph('@')),
    'a new descriptor supplies actual geometry and its ASCII glyph');
  const modified = rasterize(changed);
  assert.notEqual(glyphs(modified), glyphs(original), 'editing the sprite data changes the visible figure');
  assert.ok(Array.from(modified.fg).some((n, i) => i % 4 === 3 && n === glyph('@')),
    'the descriptor glyph reaches a rendered cell');
});

test('material selection tints equipment while preserving the armour palette', () => {
  const armour = new Set([MATERIALS.plate, MATERIALS.darkPlate, MATERIALS.mail, MATERIALS.crimson]);
  const steel = dressFigure(state('sword-shield', 'steel'));
  const copper = dressFigure(state('sword-shield', 'copper'));
  assert.deepEqual(copper.filter((part) => armour.has(part.mat)).map((part) => part.mat.color),
    steel.filter((part) => armour.has(part.mat)).map((part) => part.mat.color), 'armour is unchanged');
  assert.ok(copper.some((part) => part.weaponPart &&
    ['blade', 'metal', 'trim'].includes(part.weaponPart.material) &&
    part.mat.color.every((n, i) => n === getWeapon('sword-shield', 'copper').materialColor[i])),
  'weapon metal uses the selected copper palette');
});

test('states without an equipment selection retain the steel greatsword', () => {
  const rig = buildRig({ heading: 0, phase: 0, walk: 0, run: 0, time: 0 });
  assert.equal(rig.weapon, null);
  assert.equal(rig.sheathedWeapon.definition.id, 'greatsword');
  assert.equal(rig.sheathedWeapon.definition.material, 'steel');
});

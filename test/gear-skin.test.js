import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rig, THREE } from './helpers/gear-rig.js';
import { cleanSkin, DEFAULT_SKIN, presetSkin, skinPaint } from '../src/character/skin.js';

const { regionColors } = await import('../src/entities/gear.js');

// The colours the rigged outlaw was painted in before skins.
const OLD = { jerkin: 0x6c4e34, tunic: 0x5c4a3c, linen: 0x968e7c, hose: 0x484852, boot: 0x4e3828, leather: 0x563c2a,
  bracer: 0x5a402a, skin: 0x967660, hood: 0x46444a, cloak: 0x3a3840, hair: 0x342820 };

// One vertex on each region: forearm, torso, then the extra bones below.
const EXTRA = ['DEF-neck', 'DEF-upper_armL', 'DEF-handL', 'DEF-thighL', 'DEF-shinL', 'DEF-footL'];
const REGIONS = ['forearm', 'torso', 'head', 'upperArm', 'hand', 'thigh', 'shin', 'foot'];
function outlaw() {
  const made = rig(EXTRA);
  assert.deepEqual(made.gear.painted[0].regions, REGIONS);
  return made;
}
// The colour of each region's vertex, as hex.
function painted(skin) {
  const out = skin.geometry.attributes.color;
  return Object.fromEntries(REGIONS.map((region, i) => [region, new THREE.Color(out.getX(i), out.getY(i), out.getZ(i)).getHex()]));
}
const hexOf = (rgb) => new THREE.Color().setHex((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]).getHex();
const hoodParts = (gear) => [...gear.hood.children, gear.capelet];

test('without a skin the outlaw is painted exactly as before', () => {
  const { gear, skin } = outlaw();
  assert.deepEqual(hoodParts(gear).map((o) => o.material.color.getHex()), [OLD.hood, OLD.hood, OLD.hood, OLD.hood],
    'before the first apply too');
  for (const equipment of [undefined, { mainHand: { id: 'shortSword' } }]) {
    gear.apply(equipment);
    assert.deepEqual(painted(skin), { forearm: OLD.bracer, torso: OLD.jerkin, head: OLD.hood, upperArm: OLD.tunic,
      hand: OLD.leather, thigh: OLD.hose, shin: OLD.boot, foot: OLD.boot });
    // The vertex colours are the same floats as `color.set(0x…)` gave.
    const out = skin.geometry.attributes.color;
    const old = new THREE.Color(OLD.jerkin);
    assert.deepEqual([out.getX(1), out.getY(1), out.getZ(1)], [...new Float32Array([old.r, old.g, old.b])]);
    assert.deepEqual(hoodParts(gear).map((o) => o.material.color.getHex()), [OLD.hood, OLD.hood, OLD.hood, OLD.hood]);
    assert.equal(gear.hair.material.color.getHex(), OLD.hair);
    assert.equal(gear.cloak.material.color.getHex(), OLD.cloak);
    assert.deepEqual([gear.hood.visible, gear.capelet.visible, gear.hair.visible, gear.cloak.visible], [true, true, false, true]);
  }
});

test('a green-skinned outlaw with the hood down shows the face and hair', () => {
  const { gear, skin } = outlaw();
  const green = cleanSkin({ tone: 'olive', hair: 'black', layers: { hood: false } });
  gear.apply({}, green);
  assert.equal(painted(skin).head, hexOf([108, 120, 72]));
  assert.deepEqual([gear.hood.visible, gear.capelet.visible, gear.hair.visible, gear.cloak.visible], [false, false, true, true]);
  assert.equal(gear.hair.material.color.getHex(), hexOf([30, 28, 30]));
  assert.equal(painted(skin).torso, OLD.jerkin);
});

test('taking off the jerkin shows the linen shirt; the cloak can come off', () => {
  const { gear, skin } = outlaw();
  gear.apply({}, cleanSkin({ shirt: 'dun', layers: { jerkin: false } }));
  const linen = hexOf([118, 100, 78]);
  assert.deepEqual([painted(skin).torso, painted(skin).upperArm, painted(skin).forearm], [linen, linen, OLD.bracer]);
  assert.equal(gear.cloak.visible, true);
  gear.apply({}, cleanSkin({ jerkin: 'black', bracers: 'black', boots: 'dark', layers: { cloak: false } }));
  assert.equal(gear.cloak.visible, false);
  assert.deepEqual([painted(skin).torso, painted(skin).forearm, painted(skin).hand, painted(skin).shin],
    [hexOf([40, 36, 36]), hexOf([40, 36, 36]), hexOf([40, 36, 36]), hexOf([56, 42, 34])]);
});

test('the hood, hair and cloak take the skin\'s colours', () => {
  const { gear } = outlaw();
  const skin = presetSkin('greenwood');
  gear.apply(undefined, skin);
  const paint = skinPaint(skin);
  for (const o of hoodParts(gear)) assert.equal(o.material.color.getHex(), hexOf(paint.hood));
  assert.equal(gear.hair.material.color.getHex(), hexOf(paint.hair));
  assert.equal(gear.cloak.material.color.getHex(), hexOf(paint.cloak));
  // A rider on a horse dresses with no skin, as today's outlaw.
  gear.apply(undefined);
  assert.equal(gear.cloak.material.color.getHex(), OLD.cloak);
});

test('apply repaints only when the equipment or the skin changes', () => {
  const { gear, skin } = outlaw();
  const colours = skin.geometry.attributes.color;
  const equipment = { mainHand: { id: 'shortSword' } };
  const reaver = presetSkin('reaver');
  gear.apply(equipment, reaver);
  const version = colours.version;
  gear.apply(equipment, reaver);
  gear.apply({ mainHand: { id: 'shortSword' } }, reaver);
  assert.equal(colours.version, version, 'same gear, same skin');
  gear.apply(equipment, cleanSkin(reaver));
  assert.equal(colours.version, version + 1, 'a new skin object repaints');
  assert.equal(gear.palettes.size, 1, 'equal skins share their colours');
  gear.apply(equipment, cleanSkin({ tone: 'fern' }));
  assert.equal(colours.version, version + 2);
  assert.equal(gear.palettes.size, 2);
});

test('the per-skin colour table stays small', () => {
  const { gear } = outlaw();
  for (const tone of ['fair', 'tan', 'deep', 'dark', 'olive', 'fern', 'sage', 'ember', 'rust']) {
    gear.apply({}, cleanSkin({ tone }));
  }
  assert.ok(gear.palettes.size <= 8);
});

test('region colours follow the skin\'s layers', () => {
  assert.deepEqual(regionColors(undefined), { head: 'hood', torso: 'jerkin', upperArm: 'tunic', forearm: 'bracer',
    hand: 'glove', thigh: 'hose', shin: 'boot', foot: 'boot' });
  assert.deepEqual(regionColors({}, cleanSkin({ layers: { hood: false, jerkin: false } })),
    { head: 'skin', torso: 'linen', upperArm: 'linen', forearm: 'bracer', hand: 'glove', thigh: 'hose', shin: 'boot', foot: 'boot' });
  assert.deepEqual(regionColors({}, DEFAULT_SKIN), regionColors({}));
});

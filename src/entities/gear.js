import * as THREE from 'three';
import { DEFAULT_PAINT, DEFAULT_SKIN, skinPaint } from '../character/skin.js';
import { EQUIPMENT_SLOTS } from '../inventory/items.js';
import { buildInstrumentShape, HOLD } from './instrument-shapes.js';
import { wears } from './loadout.js';

// What the outlaw wears on the 3D character. The mannequin is one plain
// mesh, so clothing is painted onto it by body region, each vertex taking
// the region of the bone that moves it most, and the hood, cloak, buckler
// and hair are simple shapes riding on the bones. The hands' gear follows
// the inventory's equipment slots; the clothes are always worn for now, and
// their colours and outer layers come from the character's skin
// (`character/skin.js`), shared with the shape-built figure.

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);

// The buckler's board and fittings, which no skin paints.
const COLORS = { wood: 0x84623e, iron: 0x70747c };
const hex = ([r, g, b]) => (r << 16) | (g << 8) | b;

const REGION_OF = [
  [/head|neck/, 'head'],
  [/upper_arm/, 'upperArm'],
  [/forearm/, 'forearm'],
  [/hand|f_|thumb/, 'hand'],
  [/thigh/, 'thigh'],
  [/shin/, 'shin'],
  [/foot|toe/, 'foot'],
  [/hips|spine|shoulder/, 'torso'],
];

// The material painted on each body region for the gear being worn, by the
// names `skinPaint` colours.
export function regionColors(equipment, skin = DEFAULT_SKIN) {
  const wearing = (slot) => wears(equipment, slot, skin);
  const sleeve = wearing('chest') ? 'tunic' : 'linen';
  return {
    head: wearing('helm') ? 'hood' : 'skin',
    torso: wearing('chest') ? 'jerkin' : 'linen',
    upperArm: sleeve,
    forearm: wearing('hands') ? 'bracer' : sleeve,
    hand: wearing('hands') ? 'glove' : 'skin',
    thigh: 'hose',
    shin: wearing('feet') ? 'boot' : 'hose',
    foot: wearing('feet') ? 'boot' : 'cuff',
  };
}

function mesh(geometry, color) {
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
}

export class Gear {
  // `model` and `bones` come straight from the loaded character, still in
  // its rest pose, so pieces can be placed in model space.
  constructor(model, bones) {
    this.bones = bones;
    this.painted = [];
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isSkinnedMesh || o.material?.userData?.joint) return;
      const { skinIndex, skinWeight } = o.geometry.attributes;
      const regions = new Array(skinIndex.count);
      for (let i = 0; i < skinIndex.count; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
        const name = o.skeleton.bones[skinIndex.getComponent(i, best)]?.name ?? '';
        regions[i] = REGION_OF.find(([pattern]) => pattern.test(name))?.[1] ?? 'torso';
      }
      o.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skinIndex.count * 3), 3));
      o.material.color.set(0xffffff);
      o.material.vertexColors = true;
      o.material.needsUpdate = true;
      this.painted.push({ mesh: o, regions });
    });

    const head = bones[bone('DEF-head')];
    const chest = bones[bone('DEF-spine.003')];
    const forearm = bones[bone('DEF-forearm.L')];

    // A hood open at the face, a peak pulled over the brow, a tail down the
    // back and a short cape over the shoulders.
    this.hood = new THREE.Group();
    const cowl = mesh(new THREE.SphereGeometry(0.185, 18, 12, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7), hex(DEFAULT_PAINT.hood));
    cowl.material.side = THREE.DoubleSide;
    const peak = mesh(new THREE.ConeGeometry(0.06, 0.12, 10), hex(DEFAULT_PAINT.hood));
    peak.position.set(0, 0.18, -0.03);
    peak.rotation.x = -0.35;
    const tail = mesh(new THREE.ConeGeometry(0.05, 0.32, 8), hex(DEFAULT_PAINT.hood));
    tail.position.set(0, -0.14, -0.17);
    tail.rotation.x = Math.PI - 0.35;
    this.hood.add(cowl, peak, tail);
    this.attach(this.hood, head, [0, 1.67, -0.02]);
    this.capelet = mesh(new THREE.CylinderGeometry(0.11, 0.25, 0.16, 16, 1, true), hex(DEFAULT_PAINT.hood));
    this.capelet.material.side = THREE.DoubleSide;
    this.attach(this.capelet, chest, [0, 1.43, -0.01]);

    this.hair = mesh(new THREE.SphereGeometry(0.172, 14, 8, 0, Math.PI * 2, 0, 1.2), hex(DEFAULT_PAINT.hair));
    this.attach(this.hair, head, [0, 1.675, -0.02]);

    // The cloak hangs from the shoulders to the calves behind the back.
    const cloakShape = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(-0.32, -0.95, -0.08),
      new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(0.32, -0.95, -0.08), new THREE.Vector3(-0.32, -0.95, -0.08),
    ]);
    cloakShape.computeVertexNormals();
    this.cloak = mesh(cloakShape, hex(DEFAULT_PAINT.cloak));
    this.cloak.material.side = THREE.DoubleSide;
    this.attach(this.cloak, chest, [0, 1.44, -0.15]);

    // A round buckler on the back of the left forearm.
    this.buckler = new THREE.Group();
    const board = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 20), COLORS.wood);
    const rim = mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 24), COLORS.iron);
    rim.rotation.x = Math.PI / 2;
    const boss = mesh(new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.iron);
    this.buckler.add(board, rim, boss);
    this.attach(this.buckler, forearm, [0.62, 1.49, -0.068]);
    // An off-hand instrument hangs from the left hand instead. Each is built
    // the first time it is carried and kept for the next.
    this.offHand = new THREE.Group();
    this.offHand.position.set(...HOLD.at);
    this.offHand.quaternion.set(...HOLD.quaternion);
    forearm.add(this.offHand);
    this.instruments = new Map();

    this.signature = null;
    this.skin = null;
    // Each skin's region colours, converted once.
    this.palettes = new Map();
  }

  // Parents `object` to `parent` so that, in the rest pose, it sits at
  // `at` in model space with the model's own orientation.
  attach(object, parent, at) {
    const world = new THREE.Matrix4().makeTranslation(...at);
    const local = parent.matrixWorld.clone().invert().multiply(world);
    local.decompose(object.position, object.quaternion, object.scale);
    parent.add(object);
  }

  // Shows and paints what `equipment` says is worn, in the colours and
  // layers of `skin`; cheap when neither changed.
  apply(equipment, skin = DEFAULT_SKIN) {
    const signature = equipment === undefined ? 'all'
      : EQUIPMENT_SLOTS.map((s) => equipment?.[s]?.id ?? '').join();
    if (signature === this.signature && skin === this.skin) return;
    this.signature = signature;
    if (skin !== this.skin) this.paint(skin);
    this.skin = skin;
    const wearing = (slot) => wears(equipment, slot, skin);
    this.hood.visible = wearing('helm');
    this.capelet.visible = wearing('helm');
    this.hair.visible = !wearing('helm');
    this.cloak.visible = wearing('cape');
    const offHand = equipment?.offHand?.id;
    this.buckler.visible = offHand === 'woodenBuckler';
    if (offHand && !this.instruments.has(offHand)) {
      const shape = buildInstrumentShape(THREE, offHand);
      if (shape) this.offHand.add(shape);
      this.instruments.set(offHand, shape);
    }
    for (const [id, shape] of this.instruments) if (shape) shape.visible = id === offHand;
    const regions = regionColors(equipment, skin);
    const colors = this.palette(skin);
    for (const { mesh: o, regions: of } of this.painted) {
      const out = o.geometry.attributes.color;
      for (let i = 0; i < of.length; i++) {
        const color = colors[regions[of[i]]];
        out.setXYZ(i, color.r, color.g, color.b);
      }
      out.needsUpdate = true;
    }
  }

  // Colours the hood, hair and cloak for a skin.
  paint(skin) {
    const paint = skinPaint(skin);
    for (const o of [...this.hood.children, this.capelet]) o.material.color.setHex(hex(paint.hood));
    this.hair.material.color.setHex(hex(paint.hair));
    this.cloak.material.color.setHex(hex(paint.cloak));
  }

  // A skin's colours as three.js colours, by material name. Packing them to
  // hex keeps the same sRGB conversion the fixed colours always had.
  palette(skin) {
    const paint = skinPaint(skin);
    let colors = this.palettes.get(paint);
    if (!colors) {
      colors = Object.fromEntries(Object.entries(paint).map(([name, rgb]) => [name, new THREE.Color().setHex(hex(rgb))]));
      if (this.palettes.size >= 8) this.palettes.clear();
      this.palettes.set(paint, colors);
    }
    return colors;
  }
}

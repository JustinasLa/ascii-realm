import { buildInstrumentShape } from '../entities/instrument-shapes.js';
import { WEAPONS, WEAPON_MATERIALS, weaponMaterial } from '../entities/weapons.js';
import { GLYPHS } from '../render/glyphs.js';
import { BARK_RAMP } from '../world/tree-chars.js';
import { INSTRUMENT_PAINTS, ITEM_MODELS, PAINTS, WEAPON_PAINTS } from './item-models.js';
import { ASPECT, GRIDS, SX, SY, artKey, artTint, cellsFromPixels, drawCells, gridOf, hash, poseAngle, seedOf } from './item-shading.js';

// The inventory's item pictures: each item is a small 3D model (a weapon
// from the same parts the hands carry, an instrument from the shape the
// hand holds, anything else from a few simple parts), drawn once
// offscreen, lit from the top left, turned into shaded letters the way the
// player is, and kept as an image. three.js is loaded and its renderer made only when a picture is
// first needed, and the renderer is let go when idle.

// The trees' and figure's glyph ramps, as characters.
export const glyphChars = (ramp) => ramp.map((level) => level.map((g) => GLYPHS[g]));
const RAMPS = { bark: glyphChars(BARK_RAMP) };
const PAINT_IDS = Object.keys(PAINTS);
// Let the renderer go this long after the last picture.
const IDLE_MS = 10000;

const lumOf = (c) => (c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15) / 255;

// A paint's name and colour (its own, unless `own` is given) in a model of
// metal `tint`: tinted paints take their share of it, and stone tools are
// stone where the metal would be.
export function paintFor(name, tint, own = PAINTS[name].colour) {
  const paint = PAINTS[name];
  const colour = paint.tinted && tint ? tint.map((c) => c * paint.tinted) : own;
  return { name: paint.tinted && tint === WEAPON_MATERIALS.stone.color ? 'stone' : name, colour };
}

// The geometry of each kind of part (see item-models.js).
const GEOMETRY = {
  box: (THREE, [w, h, d]) => new THREE.BoxGeometry(w, h, d),
  cyl: (THREE, [top, bottom, h, sides = 12, start = 0, turn = Math.PI * 2]) =>
    new THREE.CylinderGeometry(top, bottom, h, sides, 1, turn < Math.PI * 2, start, turn),
  cone: (THREE, [r, h]) => new THREE.ConeGeometry(r, h, 12),
  ball: (THREE, [rx, ry, rz]) => new THREE.SphereGeometry(1, 12, 8).scale(rx, ry, rz),
  shell: (THREE, [r, start, turn]) => new THREE.SphereGeometry(r, 18, 12, start, turn),
  torus: (THREE, [big, r]) => new THREE.TorusGeometry(big, r, 8, 16),
  lathe: (THREE, points) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 16),
  slab: (THREE, [points, depth]) => new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))),
    { depth, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }).translate(0, 0, -depth / 2),
  // Each corner pushed in or out by a hash of where it is, so the corners
  // the faces share move together.
  lump(THREE, [r, rough, detail], seed) {
    const geometry = new THREE.IcosahedronGeometry(r, detail);
    const at = geometry.attributes.position;
    for (let i = 0; i < at.count; i++) {
      const [x, y, z] = [at.getX(i), at.getY(i), at.getZ(i)];
      const k = 1 + rough * (hash(Math.round(x * 1e4), Math.round(y * 1e4) ^ Math.round(z * 1e5), seed) - 0.5);
      at.setXYZ(i, x * k, y * k, z * k);
    }
    return geometry;
  },
  tube: (THREE, [points, r]) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 16, r, 6),
};

// A group of parts; lumps and few-sided cylinders show their facets.
function partsModel(THREE, parts, mesh, item, seed) {
  const root = new THREE.Group();
  parts.forEach(([kind, size, at, turn, paint, colour, scale], i) => {
    const node = kind === 'group' ? partsModel(THREE, size, mesh, item, seed + i)
      : mesh(GEOMETRY[kind](THREE, size, seed + i), paint, colour === 'item' ? item.colour : colour, kind === 'lump' || (kind === 'cyl' && size[3] < 7));
    node.position.set(...at);
    if (turn) node.rotation.set(...turn);
    if (scale) node.scale.set(...scale);
    root.add(node);
  });
  return root;
}

// Which way is up for an instrument: a turn about z from its long axis +x.
const UP = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+y': 0 };

// An instrument's held shape stood on its `up` axis and turned by `roll`,
// each piece painted by its colour.
function instrumentModel(THREE, recipe, item) {
  const shape = buildInstrumentShape(THREE, item.id);
  shape.traverse((node) => {
    if (!node.isMesh) return;
    const hex = node.material.color.getHex();
    node.userData = { paint: INSTRUMENT_PAINTS[hex] ?? recipe.body ?? 'wood', colour: [hex >> 16, (hex >> 8) & 255, hex & 255] };
  });
  shape.rotation.set(0, recipe.roll ?? 0, UP[recipe.up]);
  return new THREE.Group().add(shape);
}

// The mannequin's body regions and sides, as gear.js paints them, matched
// against bone names as the loader cleans them up.
const REGIONS = [['head|neck', 'head'], ['upper_arm', 'upperArm'], ['forearm', 'forearm'], ['hand|f_|thumb', 'hand'],
  ['thigh', 'thigh'], ['shin', 'shin'], ['foot|toe', 'foot'], ['hips|spine|shoulder', 'torso']];
const SIDES = [['L', '.L'], ['R', '.R']];

// A bone's { region, side }: side is '' down the middle.
export function boneRegion(THREE, name) {
  const clean = THREE.PropertyBinding.sanitizeNodeName;
  return { region: REGIONS.find(([pattern]) => new RegExp(clean(pattern)).test(name))?.[1] ?? 'torso',
    side: SIDES.find(([, end]) => name.endsWith(clean(end)))?.[0] ?? '' };
}

// Clothing cut out of the mannequin (`gltf`) in its rest pose, a T-pose:
// the triangles whose three corners all move with bones of the regions
// `cut` paints ({ region: [paint, colour] }), on one `side` if given, one
// piece per region, then any `parts` (in its metres), all turned by `turn`
// (about y, then x, then z).
function mannequinModel(THREE, recipe, gltf, mesh, item) {
  const body = new THREE.Group();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh || o.material.name === 'M_Joints') return;
    const { position, normal, skinIndex, skinWeight } = o.geometry.attributes;
    const bones = o.skeleton.bones.map(({ name }) => boneRegion(THREE, name));
    const region = Array.from({ length: position.count }, (_, i) => {
      let best = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
      const bone = bones[skinIndex.getComponent(i, best)];
      return (!recipe.side || bone.side === recipe.side) && recipe.cut[bone.region] ? bone.region : null;
    });
    const pieces = {};
    const index = o.geometry.index.array;
    for (let t = 0; t < index.length; t += 3) {
      const corners = [index[t], index[t + 1], index[t + 2]];
      if (corners.every((v) => region[v])) (pieces[region[corners[0]]] ??= []).push(...corners);
    }
    for (const [name, corners] of Object.entries(pieces)) {
      const used = [...new Set(corners)];
      const at = new Map(used.map((v, i) => [v, i]));
      const geometry = new THREE.BufferGeometry();
      for (const [key, from] of [['position', position], ['normal', normal]]) {
        geometry.setAttribute(key, new THREE.Float32BufferAttribute(used.flatMap((v) => [from.getX(v), from.getY(v), from.getZ(v)]), 3));
      }
      geometry.setIndex(corners.map((v) => at.get(v)));
      const [paint, colour] = recipe.cut[name];
      body.add(mesh(geometry.applyMatrix4(o.matrixWorld), paint, colour === 'item' ? item.colour : colour));
    }
  });
  if (recipe.parts) body.add(partsModel(THREE, recipe.parts, mesh, item, seedOf(item.id)));
  if (recipe.turn) body.rotation.set(...recipe.turn, 'ZXY');
  return new THREE.Group().add(body);
}

// An item's recipe, in its `variant` ('card', 'compact', 'two' or '').
export const recipeOf = (item, variant = '') => ({ ...ITEM_MODELS[item.id], ...ITEM_MODELS[item.id][variant] });

// A model, in metres with +y along a long item: a weapon from the sprite
// parts the hands carry (limbs, blobs and panels), its blades flattened to
// 30% depth; an instrument from its held shape; clothing from the
// mannequin `gltf`; anything else from its parts.
export function buildModel(THREE, { item, tint = null, variant = '', gltf = null }) {
  const mesh = (geometry, name, own, flatShading = false) => {
    const { name: paint, colour } = paintFor(name, tint, own);
    const material = new THREE.MeshLambertMaterial({ flatShading, side: THREE.DoubleSide,
      color: new THREE.Color().setRGB(...colour.map((c) => c / 255), THREE.SRGBColorSpace) });
    const node = new THREE.Mesh(geometry, material);
    node.userData = { paint, colour };
    return node;
  };
  const recipe = recipeOf(item, variant);
  if (recipe.from === 'instrument') return instrumentModel(THREE, recipe, item);
  if (recipe.from === 'mannequin') return mannequinModel(THREE, recipe, gltf, mesh, item);
  if (recipe.parts) return partsModel(THREE, recipe.parts, mesh, item, seedOf(item.id));
  const root = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  for (const part of WEAPONS[item.weapon].spriteParts) {
    const paint = WEAPON_PAINTS[part.material];
    let node;
    if (part.shape === 'limb') {
      const a = new THREE.Vector3(...part.a);
      const along = new THREE.Vector3(...part.b).sub(a);
      const geometry = new THREE.CylinderGeometry(part.rb, part.ra, along.length(), 12);
      node = mesh(part.material === 'blade' ? geometry.scale(1, 1, 0.3) : geometry, paint);
      node.position.copy(a).addScaledVector(along, 0.5);
      node.quaternion.setFromUnitVectors(up, along.normalize());
    } else if (part.shape === 'blob') {
      node = mesh(new THREE.SphereGeometry(1, 12, 8).scale(part.rx, part.ry, part.rx), paint);
      node.position.set(...part.c);
    } else {
      const outline = new THREE.Shape(part.points.map(([x, y]) => new THREE.Vector2(x, y)));
      node = mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.006, bevelEnabled: false }), paint);
      node.position.z = part.points[0][2] - 0.003;
    }
    root.add(node);
  }
  return root;
}

// Long items are drawn this much thicker than they are, so a blade or haft
// is a few letters wide rather than a single stroke.
const GIRTH = 1.8;

// How other poses turn a model about its height (yaw) and then tip its top
// towards the camera (pitch): upright items face on, flat ones lie seen
// from 50° above.
const TURNS = { upright: [0.44, 0.26], flat: [0.52, 0.87], front: [0, 0.14] };

// The model turned for its box: long items along the grid's diagonal, tip
// to the top right and turned a little so a blade's flat catches the light.
export function posed(THREE, model, grid, pose = 'long') {
  const outer = new THREE.Group().add(model);
  if (pose === 'long') {
    model.scale.set(GIRTH, 1, GIRTH);
    model.rotation.y = 0.35;
    outer.rotation.z = poseAngle(grid) - Math.PI / 2;
  } else [model.rotation.y, outer.rotation.x] = TURNS[pose];
  outer.updateMatrixWorld(true);
  return outer;
}

// Fits an orthographic camera round the posed model, filling 90% of the
// grid's tighter side, with undistorted cells.
export function fit(THREE, camera, object, grid) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const aspect = (grid.cols * ASPECT) / grid.rows;
  const half = Math.max(size.y, size.x / aspect) / 2 / (grid.fill ?? 0.9);
  Object.assign(camera, { left: c.x - half * aspect, right: c.x + half * aspect, top: c.y + half, bottom: c.y - half,
    near: 0.01, far: size.z + 2 });
  camera.position.set(0, 0, box.max.z + 1);
  camera.updateProjectionMatrix();
}

// three.js, the outline picker and, when it comes, the mannequin (shared
// with the player's, so it's fetched once).
const loadLibs = async (mannequin) => {
  const { ModelFigure, outline } = await import('../entities/model.js');
  return { THREE: await import('three'), outline, mannequin: ModelFigure.library(mannequin) };
};
const makeRenderer = (THREE) => new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true,
  antialias: false, preserveDrawingBuffer: true });

export class ItemStudio {
  // `budget` caps the decoded size of the kept pictures in bytes.
  constructor({ webgl = typeof WebGLRenderingContext !== 'undefined', load = loadLibs, renderer = makeRenderer,
    budget = 24 * 2 ** 20, ratio = () => globalThis.devicePixelRatio || 1, now = () => performance.now(),
    mannequin = 'assets/ual1.glb' } = {}) {
    Object.assign(this, { load, makeRenderer: renderer, budget, ratio, now, mannequin, off: !webgl, losses: 0, disposing: false,
      cache: new Map(), bytes: 0, peak: 0, jobs: new Map(), lib: null, renderer: null, frame: null });
  }

  // The picture of `stack` (described as `own`) for a box shape, `aspect`
  // (width / height) if it isn't the desktop one: { src }, or null while
  // it's made, or when the item has no model. Pictures asked for while
  // WebGL is off stay queued for a retry.
  art(stack, item, own, shape, aspect = 0) {
    const recipe = ITEM_MODELS[item.id];
    if (!recipe) return null;
    const tint = artTint(stack, item, own, weaponMaterial);
    const dpr = Math.min(2, Math.ceil(this.ratio()));
    // The recipe's own version for a small box, a card or a stack, if any.
    const variant = (shape === '1x1' && recipe.compact && 'compact') || (shape === 'card' && recipe.card && 'card')
      || (stack?.count > 1 && recipe.two && 'two') || '';
    const grid = gridOf(shape, aspect);
    const key = artKey(item.id, variant, tint, grid === GRIDS[shape] ? shape : `${shape}/${grid.rows}`, dpr);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const waits = recipeOf(item, variant).from === 'mannequin';
    if (!this.jobs.has(key)) this.jobs.set(key, { key, item, tint, grid, dpr, variant, waits });
    return null;
  }

  // Makes queued pictures: one batch of at most two or 8 ms (at least one)
  // per painted frame, or per 16 ms without frames; true when any was.
  // Clothing waits for the mannequin.
  pump() {
    if (this.off || !this.jobs.size || this.frame) return false;
    if (!this.lib) {
      this.loading ??= this.load(this.mannequin).then((lib) => {
        this.lib = lib;
        lib.mannequin?.then((gltf) => { lib.gltf = gltf; }, () => {});
      }, () => { this.off = true; });
      return false;
    }
    const start = this.now();
    let made = 0;
    for (const [key, job] of this.jobs) {
      if (made === 2 || (made && this.now() - start > 8)) break;
      if (job.waits && !this.lib.gltf) continue;
      this.jobs.delete(key);
      if (!this._make(job)) return false;
      made++;
    }
    if (!made) return false;
    this.frame = (globalThis.requestAnimationFrame ?? setTimeout)(() => { this.frame = null; }, 16);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.release(), IDLE_MS);
    return true;
  }

  // An inventory opening tries WebGL again after one unexpected loss.
  reopen() {
    if (this.off && this.losses === 1 && this.lib) this.off = false;
  }

  // Lets the renderer and canvas go; the next picture makes new ones.
  release() {
    if (!this.renderer) return;
    this.disposing = true;
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer = null;
    this.canvas = null;
  }

  _lost() {
    if (this.disposing) {
      this.disposing = false;
      return;
    }
    this.renderer = null;
    this.losses++;
    this.off = true;
  }

  _setup() {
    const { THREE } = this.lib;
    const renderer = this.makeRenderer(THREE);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.addEventListener('webglcontextlost', () => this._lost());
    this.scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 3.6);
    key.position.set(-0.6, 0.8, 0.5);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.8);
    rim.position.set(0.7, -0.2, -0.6);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x404040, 1));
    this.camera = new THREE.OrthographicCamera();
    this.ids = PAINT_IDS.map((_, i) => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: new THREE.Color().setRGB((i * 8 + 4) / 255, 0, 0, THREE.SRGBColorSpace) }));
    this.renderer = renderer;
  }

  _make(job) {
    const { THREE, outline } = this.lib;
    try {
      if (!this.renderer) this._setup();
    } catch {
      this.off = true;
      this.jobs.clear();
      return false;
    }
    const { grid } = job;
    const w = grid.cols * SX;
    const h = grid.rows * SY;
    const model = posed(THREE, buildModel(THREE, { ...job, gltf: this.lib.gltf }), grid, recipeOf(job.item, job.variant).pose);
    fit(THREE, this.camera, model, grid);
    this.scene.add(model);
    this.renderer.setSize(w, h, false);
    const gl = this.renderer.getContext();
    const read = () => {
      this.renderer.render(this.scene, this.camera);
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const shade = read();
    const meshes = [];
    model.traverse((node) => node.isMesh && meshes.push(node));
    // Each paint's brightness is its first piece's colour.
    const lums = {};
    for (const node of meshes) {
      lums[node.userData.paint] ??= lumOf(node.userData.colour);
      node.material.dispose();
      node.material = this.ids[PAINT_IDS.indexOf(node.userData.paint)];
    }
    const ids = read();
    this.scene.remove(model);
    for (const node of meshes) node.geometry.dispose();
    const paints = PAINT_IDS.map((name) => ({ ...PAINTS[name], ramp: RAMPS[PAINTS[name].ramp] ?? PAINTS[name].ramp,
      lum: Math.max(0.05, lums[name] ?? 1) }));
    const letter = (mx, my, cover) => {
      const o = outline(mx, my, cover);
      return { ch: GLYPHS[o.g], rim: o.rim };
    };
    const cells = cellsFromPixels({ shade, ids, grid, paints, outline: letter, seed: seedOf(job.item.id) });
    const font = grid.font * job.dpr;
    this.canvas ??= document.createElement('canvas');
    this.canvas.width = Math.round(grid.cols * ASPECT * font);
    this.canvas.height = Math.round(grid.rows * font);
    drawCells(this.canvas.getContext('2d'), cells, font);
    this._store(job.key, { src: this.canvas.toDataURL(), bytes: this.canvas.width * this.canvas.height * 4 });
    return true;
  }

  // Least recently used pictures go first once the budget is full.
  _store(key, entry) {
    this.cache.set(key, entry);
    this.bytes += entry.bytes;
    this.peak = Math.max(this.peak, this.bytes);
    for (const [old, kept] of this.cache) {
      if (this.bytes <= this.budget || old === key) break;
      this.cache.delete(old);
      this.bytes -= kept.bytes;
    }
  }
}

export const itemStudio = new ItemStudio();

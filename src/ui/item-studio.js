import { WEAPONS, WEAPON_MATERIALS, weaponMaterial } from '../entities/weapons.js';
import { GLYPHS } from '../render/glyphs.js';
import { BARK_RAMP } from '../world/tree-chars.js';
import { ITEM_MODELS, PAINTS, WEAPON_PAINTS } from './item-models.js';
import { ASPECT, GRIDS, SX, SY, artKey, artTint, cellsFromPixels, drawCells, poseAngle, seedOf } from './item-shading.js';

// The inventory's item pictures: each item is a small 3D model (a weapon
// from the same parts the hands carry), drawn once offscreen, lit from the
// top left, turned into shaded letters the way the player is, and kept as
// an image. three.js is loaded and its renderer made only when a picture is
// first needed, and the renderer is let go when idle.

// The trees' and figure's glyph ramps, as characters.
export const glyphChars = (ramp) => ramp.map((level) => level.map((g) => GLYPHS[g]));
const RAMPS = { bark: glyphChars(BARK_RAMP) };
const PAINT_IDS = Object.keys(PAINTS);
// Let the renderer go this long after the last picture.
const IDLE_MS = 10000;

const lumOf = (c) => (c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15) / 255;

// A paint's name and colour in a model of metal `tint`: tinted paints take
// their share of it, and stone tools are stone where the metal would be.
export function paintFor(name, tint) {
  const paint = PAINTS[name];
  const colour = paint.tinted && tint ? tint.map((c) => c * paint.tinted) : paint.colour;
  return { name: paint.tinted && tint === WEAPON_MATERIALS.stone.color ? 'stone' : name, colour };
}

// A model, in metres with +y along a long item: a weapon from the sprite
// parts the hands carry (limbs, blobs and panels), its blades flattened to
// 30% depth. Other items have no model yet and keep their outline.
export function buildModel(THREE, { item, tint = null }) {
  const mesh = (geometry, name) => {
    const { name: paint, colour } = paintFor(name, tint);
    const material = new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...colour.map((c) => c / 255), THREE.SRGBColorSpace) });
    const node = new THREE.Mesh(geometry, material);
    node.userData = { paint, colour };
    return node;
  };
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

// The model turned for its box: long items along the grid's diagonal, tip
// to the top right and turned a little so a blade's flat catches the light.
export function posed(THREE, model, grid) {
  const outer = new THREE.Group().add(model);
  model.scale.set(GIRTH, 1, GIRTH);
  model.rotation.y = 0.35;
  outer.rotation.z = poseAngle(grid) - Math.PI / 2;
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

const loadLibs = async () => ({ THREE: await import('three'), outline: (await import('../entities/model.js')).outline });
const makeRenderer = (THREE) => new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true,
  antialias: false, preserveDrawingBuffer: true });

export class ItemStudio {
  // `budget` caps the decoded size of the kept pictures in bytes.
  constructor({ webgl = typeof WebGLRenderingContext !== 'undefined', load = loadLibs, renderer = makeRenderer,
    budget = 24 * 2 ** 20, ratio = () => globalThis.devicePixelRatio || 1, now = () => performance.now() } = {}) {
    Object.assign(this, { load, makeRenderer: renderer, budget, ratio, now, off: !webgl, losses: 0, disposing: false,
      cache: new Map(), bytes: 0, peak: 0, jobs: new Map(), lib: null, renderer: null });
  }

  // The picture of `stack` (described as `own`) for a box shape: { src },
  // or null while it's made, or when the item has no model yet.
  art(stack, item, own, shape) {
    if (!ITEM_MODELS[item.id] || this.off) return null;
    const tint = artTint(stack, item, own, weaponMaterial);
    const dpr = Math.min(2, Math.ceil(this.ratio()));
    const key = artKey(item.id, '', tint, shape, dpr);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    if (!this.jobs.has(key)) this.jobs.set(key, { key, item, tint, shape, dpr });
    return null;
  }

  // Makes queued pictures, at most two or 8 ms a call (at least one); true
  // when any was.
  pump() {
    if (this.off || !this.jobs.size) return false;
    if (!this.lib) {
      this.loading ??= this.load().then((lib) => { this.lib = lib; }, () => { this.off = true; });
      return false;
    }
    const start = this.now();
    let made = 0;
    for (const [key, job] of this.jobs) {
      if (made === 2 || (made && this.now() - start > 8)) break;
      this.jobs.delete(key);
      if (!this._make(job)) return false;
      made++;
    }
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
    this.jobs.clear();
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
    this.ids = PAINT_IDS.map((_, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB((i * 8 + 4) / 255, 0, 0, THREE.SRGBColorSpace) }));
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
    const grid = GRIDS[job.shape];
    const w = grid.cols * SX;
    const h = grid.rows * SY;
    const model = posed(THREE, buildModel(THREE, job), grid);
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
    for (const node of meshes) {
      node.material.dispose();
      node.material = this.ids[PAINT_IDS.indexOf(node.userData.paint)];
    }
    const ids = read();
    this.scene.remove(model);
    for (const node of meshes) node.geometry.dispose();
    const paints = PAINT_IDS.map((name) => ({ ...PAINTS[name], ramp: RAMPS[PAINTS[name].ramp] ?? PAINTS[name].ramp,
      lum: Math.max(0.05, lumOf(paintFor(name, job.tint).colour)) }));
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

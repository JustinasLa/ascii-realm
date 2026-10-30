import { clearInput, isControlTarget } from '../core/input.js';
import { liftView } from '../world/camera.js';
import { createProp, drawProp } from '../world/props.js';
import { PROP_CATALOG, PROP_KINDS, propDefinition } from '../world/prop-catalog.js';
import { groundUnder } from '../world/relief.js';
import { ASPECT, BOG, DIRT, GRASS, SHORE, STONE, WATER } from '../world/world.js';
import { brushSize, screenToWorld, worldToScreen } from './coordinates.js';
import { findPlayPosition } from './recovery.js';
import { placeRuinScene } from './ruin-scene.js';
import { Scenery } from './scenery.js';

const TERRAIN = { grass: GRASS, dirt: DIRT, shore: SHORE, water: WATER, stone: STONE, bog: BOG };
const PROPS = PROP_KINDS;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

// The panel owns editor interaction; the world still owns shading, reflections
// and collisions, so the same scenery can immediately be tested in play mode.
export class SceneryBuilder {
  constructor({ world, player, camera, renderer, onModeChange = () => {}, onReset = () => {}, allowed }) {
    // Phones can't build; `allowed` is asked before anything enters building
    // mode or changes the scene. Left undefined, building is allowed.
    Object.assign(this, { world, player, camera, renderer, onModeChange, onReset, allowed });
    this.canvas = renderer.canvas;
    this.scene = new Scenery(world);
    this.enabled = false;
    this.tool = 'grass';
    this.radius = 6;
    this.scale = 1;
    this.nextSeed = this.scene.nextPropSeed();
    this.pointer = null;
    this.stroke = null;
    this.ghost = null;
    this.storageKey = `ascii-realm:scenery:v1:${world.seed}`;
    const byId = (id) => document.getElementById(`builder-${id}`);
    this.panel = document.getElementById('scenery-builder');
    this.cursor = byId('cursor');
    this.banner = byId('banner');
    this.modeButton = byId('mode');
    this.status = byId('status');
    this.undoButton = byId('undo');
    this.redoButton = byId('redo');
    this.radiusInput = byId('radius');
    this.scaleInput = byId('scale');
    this.buildPalette(byId('props'));
    this.addBogTool();
    this.tools = [...this.panel.querySelectorAll('[data-tool]')];
    this.modeButton.addEventListener('click', () => this.setEnabled(!this.enabled));
    this.panel.addEventListener('toggle', () => {
      if (!this.panel.open && this.enabled && !this.setEnabled(false)) this.panel.open = true;
    });
    for (const button of this.tools) {
      button.addEventListener('click', () => {
        this.finishStroke();
        this.tool = button.dataset.tool;
        this.ghost = null;
        this.setEnabled(true);
        this.canvas.focus({ preventScroll: true });
        const label = propDefinition(this.tool)?.label ?? (this.tool === 'erase' ? 'erase props' : this.tool);
        const walkThrough = propDefinition(this.tool)?.solid === false ? ' Walk-through decoration.' : '';
        this.refresh(`Selected ${label}.${walkThrough}`);
      });
    }
    this.radiusInput.addEventListener('input', () => {
      this.finishStroke();
      this.radius = Number(this.radiusInput.value);
      byId('radius-value').value = String(this.radius);
    });
    this.scaleInput.addEventListener('input', () => {
      this.scale = Number(this.scaleInput.value);
      byId('scale-value').value = `${this.scale.toFixed(1)}×`;
      this.ghost = null;
    });
    byId('undo').addEventListener('click', () => this.edit(() => this.scene.undo(), 'Undid scene edit.'));
    byId('redo').addEventListener('click', () => this.edit(() => this.scene.redo(), 'Redid scene edit.'));
    byId('ruins').addEventListener('click', () => this.addRuins());
    byId('reset').addEventListener('click', () => this.edit(() => {
      this.scene.reset();
      this.onReset();
    }, 'Restored the generated world. Undo to recover your scene.'));
    byId('save').addEventListener('click', () => this.save());
    byId('load').addEventListener('click', () => this.load());
    byId('export').addEventListener('click', () => this.export());
    byId('import').addEventListener('click', () => byId('file').click());
    byId('file').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      try {
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) throw new Error('Scene file must be smaller than 8 MiB.');
        this.importScene(JSON.parse(await file.text()));
      } catch (error) {
        this.refresh(error.message);
      } finally {
        event.target.value = '';
      }
    });
    window.addEventListener('keydown', (event) => this.keydown(event));
    this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => {
      if (this.stroke?.id === event.pointerId) this.finishStroke();
    });
    this.canvas.addEventListener('pointercancel', () => this.finishStroke());
    this.canvas.addEventListener('lostpointercapture', () => this.finishStroke());
    this.canvas.addEventListener('pointerleave', () => {
      if (!this.stroke) this.pointer = null;
    });
    this.canvas.addEventListener('contextmenu', (event) => {
      if (this.enabled) event.preventDefault();
    });
    window.addEventListener('blur', () => {
      this.finishStroke();
      this.pointer = null;
    });
    this.refresh(`Seed ${world.seed}. Choose a tool or start building.`);
    // Defer until main has finished wiring the builder and gameplay callbacks.
    const preview = new URLSearchParams(window.location?.search ?? '');
    if (preview.get('scene') === 'ruins') {
      queueMicrotask(() => {
        this.addRuins();
        if (preview.has('play')) {
          this.setEnabled(false);
          this.panel.open = false;
        }
      });
    }
  }

  // The Bog brush, after Stone; the page's markup has no button for it yet.
  addBogTool() {
    const stone = [...this.panel.querySelectorAll('[data-tool]')].find((b) => b.dataset.tool === 'stone');
    if (!stone) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tool = 'bog';
    button.setAttribute('aria-pressed', 'false');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '"';
    button.append(icon, document.createTextNode(' Bog'));
    stone.after(button);
  }

  buildPalette(container) {
    for (const group of new Set(PROP_CATALOG.map((prop) => prop.group))) {
      const section = document.createElement('div');
      section.className = 'builder-prop-group';
      const heading = document.createElement('h3');
      heading.id = `builder-props-${group.toLowerCase()}`;
      heading.textContent = group;
      const grid = document.createElement('div');
      grid.className = 'builder-tool-grid builder-prop-grid';
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-labelledby', heading.id);
      for (const { kind, label, symbol, solid } of PROP_CATALOG.filter((prop) => prop.group === group)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.tool = kind;
        button.setAttribute('aria-pressed', 'false');
        button.title = solid ? `${label}: solid scenery` : `${label}: walk-through decoration`;
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = symbol;
        button.append(icon, document.createTextNode(` ${label}`));
        grid.append(button);
      }
      section.append(heading, grid);
      container.append(section);
    }
  }

  mayBuild() {
    return this.allowed?.() !== false;
  }

  setEnabled(enabled) {
    if (enabled === this.enabled) return true;
    if (enabled && !this.mayBuild()) return false;
    this.finishStroke();
    if (!enabled) {
      const position = findPlayPosition(this.world, this.player, this.camera);
      if (!position) {
        this.refresh('No safe ground nearby. Paint grass or erase props before playing.');
        return false;
      }
      if (position.x !== this.player.x || position.y !== this.player.y) {
        Object.assign(this.player, position, { vx: 0, vz: 0, vy: 0, air: 0,
          surge: 0, skid: 0, skidSpeed: 0, wasMoving: false, speed: 0,
          anchors: [null, null], liftAnchors: [null, null], locks: [null, null], trail: [] });
      }
      this.camera.x = this.player.x;
      this.camera.y = this.player.y - 11;
    }
    this.applyMode(enabled);
    if (enabled) {
      this.panel.open = true;
      this.camera.quake = 0;
    }
    this.onModeChange(enabled);
    this.canvas.focus({ preventScroll: true });
    this.refresh(enabled ? 'Building. Paint terrain or place props; WASD pans.' : 'Playing with your test scenery.');
    return true;
  }

  applyMode(enabled) {
    clearInput();
    this.enabled = enabled;
    this.modeButton.setAttribute('aria-pressed', String(enabled));
    this.modeButton.textContent = enabled ? 'Return to play (B)' : 'Start building';
    this.banner.hidden = !enabled;
    this.cursor.hidden = true;
    this.canvas.style.touchAction = enabled ? 'none' : '';
  }

  // Leaves building mode even when there is no safe ground to return to, for
  // a device that has just become a phone and can't reach the builder's
  // recovery controls. The player stays where they stand; the scene is kept.
  forceExit() {
    if (!this.enabled || this.setEnabled(false)) return;
    this.finishStroke();
    this.applyMode(false);
    this.onModeChange(false);
  }

  keydown(event) {
    const editingField = event.target.closest?.('input:not([type="range"]), textarea, select, [contenteditable="true"]');
    if (editingField || event.altKey) return;
    if (event.code === 'KeyB' && !event.ctrlKey && !event.metaKey && !event.repeat) {
      if (!this.enabled && !this.mayBuild()) return;
      event.preventDefault();
      if (this.setEnabled(!this.enabled) && !this.enabled) {
        this.panel.open = false;
      }
      return;
    }
    if (!this.enabled) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.setEnabled(false);
    } else if ((event.ctrlKey || event.metaKey) && ['KeyZ', 'KeyY'].includes(event.code)) {
      event.preventDefault();
      if (event.repeat) return;
      const redo = event.code === 'KeyY' || event.shiftKey;
      this.edit(() => redo ? this.scene.redo() : this.scene.undo(), redo ? 'Redid scene edit.' : 'Undid scene edit.');
    } else if (event.code === 'Enter' && !isControlTarget(event.target) && !event.repeat) {
      event.preventDefault();
      this.edit(() => this.stamp({ x: this.camera.x, y: this.camera.y }), 'Applied tool at camera centre.');
    }
  }

  edit(action, message) {
    if (!this.mayBuild()) return;
    this.finishStroke();
    if (!this.setEnabled(true)) return;
    try {
      action();
      this.refresh(message);
    } catch (error) {
      this.refresh(error.message);
    }
  }

  addRuins() {
    this.edit(() => {
      placeRuinScene(this.scene, this.camera);
      this.nextSeed = this.scene.nextPropSeed();
      this.ghost = null;
      this.onReset();
    }, 'Added the column ruins. Open court in the middle; follow the path north to the gate. B to play; Undo removes the preset.');
  }

  worldPoint(event, view = this.camera.view(this.renderer)) {
    return this.onGround(screenToWorld(event.clientX, event.clientY, this.canvas.getBoundingClientRect(), this.renderer, view));
  }

  // On raised ground (see relief.js) a point on screen is on the ground
  // drawn there, not on the flat row behind it.
  onGround(point) {
    if (!this.world.relief) return point;
    const row = Math.floor(point.y);
    point.y += groundUnder((x, y) => this.world.liftAt(x, y), Math.floor(point.x), row) - row;
    return point;
  }

  pointerDown(event) {
    if (!this.enabled || event.button !== 0 || event.isPrimary === false || this.stroke) return;
    if (!this.mayBuild()) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.pointer = { clientX: event.clientX, clientY: event.clientY };
    const point = this.worldPoint(event);
    this.scene.beginStroke();
    this.stroke = { id: event.pointerId, last: point, tool: this.tool };
    this.canvas.setPointerCapture(event.pointerId);
    try {
      this.stamp(point);
    } catch (error) {
      this.finishStroke();
      this.refresh(error.message);
    }
  }

  pointerMove(event) {
    if (!this.enabled) return;
    if (this.stroke && this.stroke.id !== event.pointerId) return;
    this.pointer = { clientX: event.clientX, clientY: event.clientY };
    if (!this.stroke) return;
    if (!(event.buttons & 1)) {
      this.finishStroke();
      return;
    }
    // Props are deliberately one per press; terrain and eraser interpolate
    // between events so quick strokes do not leave holes.
    if (PROPS.has(this.stroke.tool)) return;
    const point = this.worldPoint(event);
    const previous = this.stroke.last;
    const distance = Math.hypot((point.x - previous.x) * ASPECT, point.y - previous.y);
    // Keep the sample spacing even when the browser coalesces a long movement.
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, this.radius / 2)));
    try {
      for (let i = 1; i <= steps; i++) {
        this.stamp({ x: previous.x + (point.x - previous.x) * i / steps,
          y: previous.y + (point.y - previous.y) * i / steps });
      }
      this.stroke.last = point;
    } catch (error) {
      this.finishStroke();
      this.refresh(error.message);
    }
  }

  stamp(point) {
    const x = Math.floor(point.x) + 0.5;
    const y = Math.floor(point.y) + 0.5;
    if (PROPS.has(this.tool)) {
      this.nextSeed = this.scene.nextPropSeed(this.nextSeed);
      this.scene.place(this.tool, x, y, { scale: this.scale, seed: this.nextSeed });
      this.nextSeed = this.scene.nextPropSeed();
      this.ghost = null;
    } else if (this.tool === 'erase') {
      this.scene.erase(x, y, this.radius);
    } else {
      this.scene.paint(x, y, this.radius, TERRAIN[this.tool]);
    }
  }

  finishStroke() {
    if (!this.stroke) return;
    const { id } = this.stroke;
    this.stroke = null;
    this.scene.endStroke();
    if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.refresh('Scene edited. Undo restores the last stroke.');
  }

  updateCamera(dt, move, running) {
    if (!this.enabled || this.stroke || isControlTarget(document.activeElement)) return;
    const length = Math.hypot(move.x, move.y) || 1;
    const speed = running ? 100 : 40;
    this.camera.x = Math.max(-100000, Math.min(100000, this.camera.x + move.x / length * speed * dt / ASPECT));
    this.camera.y = Math.max(-100000, Math.min(100000, this.camera.y + move.y / length * speed * dt));
  }

  drawPreview(view) {
    if (!this.enabled || !this.pointer) {
      this.cursor.hidden = true;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const { clientX, clientY } = this.pointer;
    const element = document.elementFromPoint(clientX, clientY);
    if (element !== this.canvas) {
      this.cursor.hidden = true;
      return;
    }
    const point = this.onGround(screenToWorld(clientX, clientY, rect, this.renderer, view));
    const x = Math.floor(point.x) + 0.5;
    const y = Math.floor(point.y) + 0.5;
    const lift = this.world.relief ? this.world.liftAt(x, y) : 0;
    const position = worldToScreen(x, y - lift, rect, this.renderer, view);
    let size = brushSize(this.radius, rect, this.renderer);
    if (PROPS.has(this.tool)) {
      const seed = this.scene.nextPropSeed(this.nextSeed);
      if (seed !== this.nextSeed) {
        this.nextSeed = seed;
        this.ghost = null;
      }
      if (!this.ghost) this.ghost = createProp(this.tool, 0, 0, { scale: this.scale, seed: this.nextSeed });
      const prop = { ...this.ghost, x, y };
      size = { width: prop.footW * 2 * this.renderer.cellW * rect.width / this.canvas.width,
        height: prop.footH * 2 * this.renderer.cellH * rect.height / this.canvas.height };
      drawProp(this.renderer, liftView(view, lift), prop, (renderer, sx, sy, g, r, green, b) => {
        renderer.put(sx, sy, g, r * 0.55 + 35, green * 0.55 + 55, b * 0.55 + 30);
      });
    }
    Object.assign(this.cursor.style, { left: `${position.x}px`, top: `${position.y}px`,
      width: `${Math.max(8, size.width)}px`, height: `${Math.max(8, size.height)}px`,
      borderColor: this.tool === 'erase' ? '#df9a80' : '#b7e7a0' });
    this.cursor.hidden = false;
  }

  refresh(message) {
    for (const button of this.tools) button.setAttribute('aria-pressed', String(button.dataset.tool === this.tool));
    this.radiusInput.disabled = PROPS.has(this.tool);
    this.scaleInput.disabled = !PROPS.has(this.tool);
    this.undoButton.disabled = !this.scene.canUndo;
    this.redoButton.disabled = !this.scene.canRedo;
    const counts = this.scene.counts;
    this.status.textContent = `${message} ${counts.terrain} terrain cells · ${counts.props} placed props.`;
  }

  save() {
    this.finishStroke();
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.scene.serialize()));
      this.refresh(`Saved locally for seed ${this.world.seed}.`);
    } catch (error) {
      this.refresh(`Could not save locally: ${error.message} Export JSON to keep your scene.`);
    }
  }

  load() {
    if (!this.mayBuild()) return;
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (!saved) throw new Error(`No local scene saved for seed ${this.world.seed}.`);
      this.importScene(JSON.parse(saved), 'Loaded local scene.');
    } catch (error) {
      this.refresh(error.message);
    }
  }

  importScene(data, message = 'Imported scene.') {
    if (!this.mayBuild()) return;
    this.finishStroke();
    this.scene.load(data);
    this.nextSeed = this.scene.nextPropSeed();
    this.setEnabled(true);
    this.ghost = null;
    this.onReset();
    this.refresh(message);
  }

  export() {
    this.finishStroke();
    const blob = new Blob([JSON.stringify(this.scene.serialize(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ascii-realm-scenery-${this.world.seed}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.refresh('Exported scene JSON.');
  }
}

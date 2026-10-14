import { dressFigure, drawFigure } from '../entities/figure.js';
import { Player } from '../entities/player.js';
import { EQUIPMENT_SLOTS } from '../inventory/items.js';
import { GLYPHS } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';

const FONT = '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

// A still equipment preview, independent of the moving player and its combat pose.
export class CharacterPortrait {
  constructor(canvas, { fontFamily = FONT, fontSize = 9, columns = 48, rows = 44,
    pixelRatio = globalThis.devicePixelRatio || globalThis.window?.devicePixelRatio || 1,
    brightness = 1.7 } = {}) {
    this.canvas = canvas;
    this.context = canvas?.getContext?.('2d');
    if (!this.context) throw new TypeError('CharacterPortrait requires a 2D canvas.');
    this.columns = Math.max(24, Math.floor(positive(columns, 48)));
    this.rows = Math.max(32, Math.floor(positive(rows, 44)));
    this.fontSize = positive(fontSize, 9);
    this.cellWidth = this.fontSize * ASPECT;
    this.width = this.columns * this.cellWidth;
    this.height = this.rows * this.fontSize;
    this.pixelRatio = positive(pixelRatio, 1);
    this.brightness = positive(brightness, 1.7);
    this.fontFamily = fontFamily;
    this.signature = null;

    canvas.width = Math.round(this.width * this.pixelRatio);
    canvas.height = Math.round(this.height * this.pixelRatio);
    if (canvas.style) canvas.style.aspectRatio = `${this.width} / ${this.height}`;
    this.preview = new Player(this.columns / 2, this.rows - 6);
    this.preview.heading = 0.2;
    this.preview.settleCape();
  }

  update(player) {
    if (!this.context || !player) return false;
    const equipment = player.equipment;
    const signature = equipment === undefined ? 'legacy'
      : JSON.stringify(EQUIPMENT_SLOTS.map((slot) => {
        const stack = equipment?.[slot];
        return stack ? [stack.id, stack.count] : null;
      }));
    if (signature === this.signature) return false;

    // Copy stacks so drawing can never attach preview state to the real gear.
    this.preview.equipment = equipment === undefined ? undefined
      : Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot,
        equipment?.[slot] ? { ...equipment[slot] } : null]));
    const context = this.context;
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.font = `${this.fontSize}px ${this.fontFamily}`;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    const view = { x0: 0, y0: 0, cols: this.columns, rows: this.rows };
    const lift = (channel) => Math.round(Math.min(255, Math.max(0, channel * this.brightness)));
    drawFigure({}, view, this.preview, dressFigure(this.preview), (r, x, y, glyph, red, green, blue) => {
      if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return;
      const character = GLYPHS[glyph] || ' ';
      if (character === ' ') return;
      context.fillStyle = `rgb(${lift(red)}, ${lift(green)}, ${lift(blue)})`;
      context.fillText(character, x * this.cellWidth, y * this.fontSize);
    });
    this.signature = signature;
    return true;
  }

  destroy() {
    this.context?.clearRect(0, 0, this.width, this.height);
    this.context = null;
    this.canvas = null;
    this.preview = null;
  }
}

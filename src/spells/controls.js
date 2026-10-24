import { RadialMenu, WHEEL } from './radial.js';
import { wheelCells, wrap } from './wheel-art.js';

export const SCHOOLS = [
  { id: 'oseni', name: 'Oseni', kind: 'Fire', sigil: '^', color: '#e9965f' },
  { id: 'seithr', name: 'Seithr', kind: 'Ice', sigil: '*', color: '#ade0f2' },
  { id: 'cerrith', name: 'Cerrith', kind: 'Life', sigil: '&', color: '#a9d888' },
  { id: 'mitlan', name: 'Mitlan', kind: 'Water', sigil: '~', color: '#74ace8' },
];
const STORAGE_KEY = 'ascii-realm:rune';
// The wheel's drawing box, in wheel units around its centre.
const BOX = WHEEL.outer + 20;
// Its character cell: the interface font size and a line height, in pixels.
const FONT_SIZE = 12, LINE = 14;
const HUB_WIDTH = 16;
const SURFACE = 'rgba(6, 9, 10, 0.9)';


const tag = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Holding the middle mouse button (or RUNES on touch) opens the rune wheel: a school first, then
// one of its runes, which stays bound to R until another is chosen. Phones cast it with the
// CAST button, so the wheel names that instead.
export class SpellControls {
  constructor(casting, { surface, touchButton, canOpen = () => true, onBind = () => {}, onFocus = () => {},
    restore = true, storage, phone = () => false }) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage; } catch { storage = null; }
    }
    Object.assign(this, { casting, surface, canOpen, onBind, onFocus, restore, storage, phone });
    this.menu = new RadialMenu();
    this.buildWheel();
    this.listen(touchButton);
    this.populate();
  }

  // Schools in wheel order, each with the runes this character can cast.
  schools() {
    return SCHOOLS.map(school => ({ ...school, items: this.casting.available.filter(s => s.element === school.id) }));
  }

  populate() {
    const available = this.casting.available;
    if (this.restore && available.length) {
      const saved = this.read();
      if (available.some(s => s.id === saved)) this.casting.selected = saved;
      this.restore = false;
    }
    if (!available.some(s => s.id === this.casting.selected)) this.casting.selected = available[0]?.id ?? '';
    this.menu.setGroups(this.schools());
    if (this.menu.isOpen) this.drawWheel();
  }

  read() { try { return this.storage?.getItem(STORAGE_KEY); } catch { return null; } }
  remember(id) { try { this.storage?.setItem(STORAGE_KEY, id); } catch { /* private mode */ } }

  stats(spell) {
    const v = this.casting.variant(spell), p = v ? this.casting.modifiers(v) : {};
    return [`${p.mana ?? 0} mana`, p.damage && `${p.damage} dmg`, p.heal && `${p.heal} heal`,
      p.shield_power && `${p.shield_power} shield`, p.duration && `${p.duration}s long`,
      p.mana_regen && `+${p.mana_regen} mana/s`,
      spell.toggleAura && (this.casting.hasAura(this.casting.player, spell.toggleAura) ? 'Active - cast off' : 'Cast to activate')].filter(Boolean);
  }

  bind(spell) {
    this.casting.selected = spell.id;
    this.remember(spell.id);
    this.onBind(spell);
  }

  update() {
    if (this.menu.isOpen && !this.canOpen()) this.close();
    if (this.menu.isOpen && this.menu.stage === 'items') this.tickWheel();
  }

  // --- The wheel ---------------------------------------------------------
  // Drawn in characters on a grid, like the world: line characters for the
  // rims and spokes, and labels written into whole cells.

  buildWheel() {
    this.wheel = tag('div');
    this.wheel.id = 'spell-wheel';
    this.wheel.hidden = true;
    this.wheel.setAttribute('role', 'dialog');
    this.wheel.setAttribute('aria-label', 'Rune wheel');
    this.ring = tag('div', 'spell-wheel-ring');
    this.ring.style.width = this.ring.style.height = `${BOX * 2}px`;
    this.canvas = tag('canvas', 'spell-wheel-art');
    this.canvas.setAttribute('role', 'img');
    this.ctx = this.canvas.getContext?.('2d') ?? null;
    this.ring.append(this.canvas);
    this.wheel.append(this.ring);
    document.body.append(this.wheel);
  }

  open(x, y, held, source, pointerId = null) {
    if (!this.menu.open(held)) return false;
    Object.assign(this, { source, pointerId });
    const vw = innerWidth, vh = innerHeight;
    // Keep clear of the rune bar and hotbar when the screen is tall enough.
    this.scale = Math.min(1, (vw - 16) / (BOX * 2), (vh - 16) / (BOX * 2));
    const half = BOX * this.scale, below = vh - half * 2 > 300 ? 150 : 8;
    const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
    this.cx = clamp(x, half + 8, vw - half - 8);
    this.cy = clamp(y, half + 8, vh - half - below);
    this.ring.style.left = `${this.cx}px`;
    this.ring.style.top = `${this.cy}px`;
    this.ring.style.transform = `translate(-50%, -50%) scale(${this.scale})`;
    this.wheel.hidden = false;
    document.body.classList.add('spell-wheel-open');
    this.menu.point((x - this.cx) / this.scale, (y - this.cy) / this.scale);
    this.drawWheel();
    return true;
  }

  close() {
    this.menu.close();
    this.wheel.hidden = true;
    document.body.classList.remove('spell-wheel-open');
    this.pointerId = null;
  }

  // Applies a menu result: a bound rune closes the wheel, a school redraws it.
  apply(result) {
    if (!result) return this.paint();
    if (result.type === 'item') this.bind(result.item);
    if (!this.menu.isOpen) { this.close(); this.onFocus(); return; }
    this.drawWheel();
  }

  at(e) { return [(e.clientX - this.cx) / this.scale, (e.clientY - this.cy) / this.scale]; }

  // The character cell and palette, read once from the interface styles.
  grid() {
    if (this.cell) return this.cell;
    const family = getComputedStyle(this.wheel).fontFamily;
    this.ctx.font = `${FONT_SIZE}px ${family}`;
    const cw = this.ctx.measureText('M').width || FONT_SIZE * 0.6;
    const css = getComputedStyle(document.documentElement), v = name => css.getPropertyValue(name).trim();
    this.colors = { ink: v('--ink'), muted: v('--muted'), quiet: v('--quiet') };
    this.cells = new Map();
    return this.cell = { family, cw, lh: LINE, cols: 2 * Math.floor(BOX / cw) + 1, rows: 2 * Math.floor(BOX / LINE) + 1 };
  }

  drawWheel() {
    const menu = this.menu, entries = menu.entries, count = entries.length;
    this.wheel.dataset.stage = menu.stage;
    this.waiting = entries.map(() => false);
    this.artKey = null;
    if (!this.ctx) return;
    const { cw, lh, cols, rows } = this.grid();
    // Crowded wheels set their labels further out, where the sectors are wider.
    const step = Math.PI * 2 / count, mid = WHEEL.inner + (WHEEL.outer - WHEEL.inner) * (count > 8 ? 0.58 : 0.5);
    const chord = Math.min(116, Math.max(80, 2 * mid * Math.sin(Math.min(step, Math.PI) / 2) * 0.96));
    this.spots = entries.map((_, i) => ({
      col: Math.round((cols - 1) / 2 + mid * Math.sin(i * step) / cw),
      row: Math.round((rows - 1) / 2 - mid * Math.cos(i * step) / lh),
      width: Math.floor(chord / cw),
    }));
    if (menu.stage === 'items') this.tickWheel();
    this.paint();
  }

  // Hover, the bound rune and the hub follow the pointer, and the cast hint
  // follows the phone check; the art is redrawn only when one of them changes.
  paint() {
    const menu = this.menu;
    if (!menu.isOpen || !this.spots) return;
    const bound = this.casting.selected;
    const key = JSON.stringify([menu.stage, menu.group?.id, menu.entries.length, menu.hover, bound, this.waiting, this.scale,
      this.phone()]);
    if (this.artKey === key) return;
    this.artKey = key;
    this.render(bound);
  }

  // Label text as lines of [text, colour, bold] runs.
  hubLines(bound) {
    const menu = this.menu, hovered = menu.hovered, { ink, muted, quiet } = this.colors;
    const name = (text, color) => wrap(text, HUB_WIDTH).map(line => [[line, color, true]]);
    if (menu.stage === 'groups') {
      const spell = this.casting.spells.get(bound);
      if (hovered) return [[[hovered.sigil, hovered.color, true]], ...name(hovered.name, ink), [[`${hovered.kind} runes`, muted]]];
      const hint = this.phone() ? 'Tap CAST to cast' : 'Bound to [R]';
      return [...name('Runes', ink), [[spell ? hint : 'Choose a school', muted]],
        ...(spell ? wrap(spell.name, HUB_WIDTH).map(line => [[line, quiet]]) : [])];
    }
    const color = menu.group.color;
    if (hovered) return [...name(hovered.name, color), ...this.stats(hovered).map(s => [[s, quiet]])];
    return [[[menu.group.sigil, color, true]], ...name(menu.group.name, color), [['< back', quiet]]];
  }

  entryLines(entry, i, bound, width) {
    const menu = this.menu, { ink, muted, quiet } = this.colors;
    const hover = i === menu.hover, tint = (menu.group ?? entry).color;
    if (menu.stage === 'groups') {
      const isBound = entry.items.some(s => s.id === bound), n = entry.items.length;
      return [[[entry.sigil, tint, true]], ...wrap(entry.name, width).map(line => [[line, hover || isBound ? tint : muted, true]]),
        [[`${entry.kind} · ${n} rune${n === 1 ? '' : 's'}`, hover ? muted : quiet]]];
    }
    const isBound = entry.id === bound, waiting = this.waiting[i];
    const color = hover ? tint : waiting ? quiet : isBound ? tint : muted;
    // Phones tag the bound rune on a line of its own: [CAST] would crowd the narrow sectors.
    const tag = key => [['[', quiet], [key, ink], [']', quiet]], phone = isBound && this.phone();
    return [...wrap(entry.name, width).map(line => [[line, color, true]]),
      [[this.stats(entry)[0], hover ? muted : quiet], ...(isBound && !phone ? [[' ', quiet], ...tag('R')] : [])],
      ...(phone ? [tag('CAST')] : []), ...(waiting ? [[['low mana', quiet]]] : [])];
  }

  render(bound) {
    const { ctx, canvas, menu } = this, entries = menu.entries, count = entries.length;
    const { family, cw, lh, cols, rows } = this.grid(), colors = this.colors;
    if (!this.cells.has(count)) this.cells.set(count, wheelCells({ count, inner: WHEEL.inner, outer: WHEEL.outer, cw, lh, cols, rows }));
    const cells = this.cells.get(count);
    const size = BOX * 2, px = Math.round(size * (globalThis.devicePixelRatio || 1) * this.scale), k = px / size;
    if (canvas.width !== px) canvas.width = canvas.height = px;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Labels go on the same grid as the rims, centred on a cell each.
    const text = new Map(), clear = new Set();
    const write = (lines, row, col) => {
      const top = Math.round(row - (lines.length - 1) / 2);
      lines.forEach((runs, n) => {
        const width = runs.reduce((sum, [t]) => sum + t.length, 0);
        let c = col - Math.floor(width / 2);
        for (let i = -1; i <= width; i++) clear.add((top + n) * cols + c + i);
        for (const [t, color, bold] of runs) for (const ch of t) text.set((top + n) * cols + c++, { ch, color, bold });
      });
    };
    const hub = this.hubLines(bound);
    write(hub, (rows - 1) / 2, (cols - 1) / 2);
    entries.forEach((entry, i) => write(this.entryLines(entry, i, bound, this.spots[i].width), this.spots[i].row, this.spots[i].col));
    canvas.setAttribute('aria-label', hub.map(runs => runs.map(([t]) => t).join('')).join(', '));

    const isBound = i => menu.stage === 'groups' ? entries[i].items.some(s => s.id === bound) : entries[i].id === bound;
    const tint = i => (menu.group ?? entries[i]).color;
    const snap = v => Math.round(v * k) / k;
    const x0 = BOX - (cols - 1) / 2 * cw, y0 = BOX - (rows - 1) / 2 * lh;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r][c], label = text.get(r * cols + c);
        if (cell.zone === 'out' && !label) continue;
        const x = x0 + c * cw, y = y0 + r * lh, left = snap(x - cw / 2), top = snap(y - lh / 2);
        ctx.fillStyle = SURFACE;
        ctx.fillRect(left, top, snap(x + cw / 2) - left, snap(y + lh / 2) - top);
        let { ch, color, bold } = label ?? cell, alpha = 1;
        if (!label && cell.zone === 'ring') {
          // The hovered sector is stippled in its colour.
          if (cell.sectors[0] !== menu.hover || (r + c) % 2 || clear.has(r * cols + c)) continue;
          [ch, color, alpha] = ['.', tint(menu.hover), 0.5];
        } else if (!label) {
          const near = cell.sectors.includes(menu.hover) ? menu.hover : cell.sectors.find(isBound);
          color = near === undefined ? colors.quiet : tint(near);
          alpha = near === undefined ? 0.6 : near === menu.hover ? 1 : 0.7;
        }
        if (!ch || ch === ' ') continue;
        ctx.font = `${bold ? '700 ' : ''}${FONT_SIZE}px ${family}`;
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fillText(ch, x, y + 0.5);
        ctx.globalAlpha = 1;
      }
    }
  }

  tickWheel() {
    const mana = this.casting.state().mana;
    this.waiting = this.menu.entries.map(spell => {
      const v = this.casting.variant(spell);
      return mana < (v ? this.casting.modifiers(v).mana ?? 0 : 0);
    });
    this.paint();
  }

  listen(touchButton) {
    const stop = e => { e.stopImmediatePropagation(); e.preventDefault(); };
    window.addEventListener('mousedown', e => {
      if (e.button === 1) {
        e.preventDefault(); // no autoscroll
        if (this.menu.isOpen) { this.close(); return; }
        if (e.target === this.surface && this.canOpen()) this.open(e.clientX, e.clientY, true, 'mouse');
      } else if (this.menu.isOpen && this.menu.held && this.source === 'mouse') {
        // Clicks made while the middle button is held arrive only here.
        stop(e);
        this.apply(e.button === 2 ? this.menu.back() : e.button === 0 ? this.menu.press(...this.at(e)) : null);
        this.menuSuppressed = e.button === 2;
      } else if (this.menu.isOpen && e.button === 2) {
        stop(e);
        this.menuSuppressed = true;
        this.apply(this.menu.back());
      }
    }, true);
    window.addEventListener('pointerdown', e => {
      if (!this.menu.isOpen) return;
      // The wheel takes clicks and taps so they never strike in the world.
      e.stopImmediatePropagation();
      if (e.pointerType !== 'mouse') e.preventDefault();
      if (e.pointerType === 'mouse' && (this.menu.held || e.button !== 0)) return;
      if (e.pointerId === this.pointerId) return;
      this.apply(this.menu.press(...this.at(e)));
    }, true);
    window.addEventListener('pointermove', e => {
      if (!this.menu.isOpen) return;
      if (this.source !== 'mouse' && this.pointerId !== null && e.pointerId !== this.pointerId) return;
      this.apply(this.menu.point(...this.at(e)));
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 1 && this.menu.isOpen && this.source === 'mouse') this.apply(this.menu.release());
    }, true);
    const lift = e => {
      if (!this.menu.isOpen || e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.apply(e.type === 'pointercancel' ? this.menu.close() : this.menu.release());
    };
    window.addEventListener('pointerup', lift, true);
    window.addEventListener('pointercancel', lift, true);
    window.addEventListener('contextmenu', e => {
      if (this.menu.isOpen || this.menuSuppressed) { e.preventDefault(); this.menuSuppressed = false; }
    }, true);
    window.addEventListener('auxclick', e => { if (e.button === 1 && e.target === this.surface) e.preventDefault(); });
    window.addEventListener('wheel', e => { if (this.menu.isOpen) stop(e); }, { capture: true, passive: false });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.menu.isOpen) { stop(e); this.close(); this.onFocus(); }
    }, true);
    window.addEventListener('blur', () => { if (this.menu.isOpen) this.close(); });
    window.addEventListener('resize', () => { if (this.menu.isOpen) this.close(); });
    touchButton?.addEventListener('pointerdown', e => {
      if (this.menu.isOpen || !this.canOpen()) return;
      e.preventDefault();
      if (this.open(innerWidth / 2, innerHeight / 2, true, 'touch', e.pointerId)) touchButton.setPointerCapture(e.pointerId);
    });
  }
}

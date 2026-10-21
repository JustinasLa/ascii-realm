import { RadialMenu, sectorPath, WHEEL } from './radial.js';

export const SCHOOLS = [
  { id: 'oseni', name: 'Oseni', kind: 'Fire', sigil: '^', color: '#e9965f' },
  { id: 'seithr', name: 'Seithr', kind: 'Ice', sigil: '*', color: '#ade0f2' },
  { id: 'cerrith', name: 'Cerrith', kind: 'Life', sigil: '&', color: '#a9d888' },
  { id: 'mitlan', name: 'Mitlan', kind: 'Water', sigil: '~', color: '#74ace8' },
];
const STORAGE_KEY = 'ascii-realm:rune';
// The wheel's drawing box, in wheel units around its centre.
const BOX = WHEEL.outer + 20;
const NS = 'http://www.w3.org/2000/svg';

const tag = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// The bound rune, mana and cooldown sit above the hotbar. Holding the middle
// mouse button (or RUNES on touch) opens the rune wheel: a school first, then
// one of its runes, which stays bound to R until another is chosen.
export class SpellControls {
  constructor(casting, { root, surface, touchButton, canOpen = () => true, onBind = () => {}, onFocus = () => {},
    restore = true, storage = globalThis.localStorage }) {
    Object.assign(this, { casting, root, surface, canOpen, onBind, onFocus, restore, storage });
    this.root.innerHTML = '<div class="spell-bound"><kbd>R</kbd><span id="spell-name">No rune</span>'
      + '<span id="spell-ready" role="status"></span></div>'
      + '<div class="spell-mana"><label for="spell-mana">Mana</label><meter id="spell-mana" min="0" max="100" value="100"></meter>'
      + '<output id="spell-mana-value">100 / 100</output></div>'
      + '<span class="spell-change"><kbd>Hold MMB</kbd> runes</span>';
    this.name = root.querySelector('#spell-name');
    this.ready = root.querySelector('#spell-ready');
    this.meter = root.querySelector('meter');
    this.manaText = root.querySelector('output');
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
    this.describe();
    if (this.menu.isOpen) this.drawWheel();
  }

  read() { try { return this.storage?.getItem(STORAGE_KEY); } catch { return null; } }
  remember(id) { try { this.storage?.setItem(STORAGE_KEY, id); } catch { /* private mode */ } }

  stats(spell) {
    const v = this.casting.variant(spell), p = v ? this.casting.modifiers(v) : {};
    return [`${p.mana ?? 0} mana`, `${p.cooldown ?? 0}s`, p.damage && `${p.damage} dmg`, p.heal && `${p.heal} heal`,
      p.shield_power && `${p.shield_power} shield`, p.duration && `${p.duration}s long`].filter(Boolean);
  }

  remaining(spell) {
    const v = this.casting.variant(spell);
    if (!v) return 0;
    return Math.max(0, (this.casting.state().cooldowns.get(`${spell.id}:${v.id}`) ?? 0) - this.casting.time);
  }

  describe() {
    const spell = this.casting.spells.get(this.casting.selected);
    const school = SCHOOLS.find(s => s.id === spell?.element);
    this.name.textContent = spell ? spell.name : 'No rune';
    this.name.style.color = school?.color ?? '';
    this.root.title = spell ? `${spell.name} · ${school?.name ?? spell.element} · ${this.stats(spell).join(' · ')}` : '';
  }

  bind(spell) {
    this.casting.selected = spell.id;
    this.remember(spell.id);
    this.describe();
    this.onBind(spell);
  }

  update() {
    const casting = this.casting, spell = casting.spells.get(casting.selected), v = casting.variant(spell);
    const state = casting.state(), p = v ? casting.modifiers(v) : {};
    const remaining = spell ? this.remaining(spell) : 0;
    this.meter.value = state.mana; this.meter.max = state.maxMana;
    this.manaText.textContent = `${Math.floor(state.mana)} / ${state.maxMana}`;
    const text = !spell ? '' : remaining ? `${remaining.toFixed(1)}s` : state.mana < (p.mana ?? 0) ? 'Low mana' : 'Ready';
    if (this.ready.textContent !== text) this.ready.textContent = text;
    this.root.classList.toggle('spell-waiting', Boolean(text && text !== 'Ready'));
    if (this.menu.isOpen && !this.canOpen()) this.close();
    if (this.menu.isOpen && this.menu.stage === 'items') this.tickWheel();
  }

  // --- The wheel ---------------------------------------------------------

  buildWheel() {
    this.wheel = tag('div');
    this.wheel.id = 'spell-wheel';
    this.wheel.hidden = true;
    this.wheel.setAttribute('role', 'dialog');
    this.wheel.setAttribute('aria-label', 'Rune wheel');
    this.ring = tag('div', 'spell-wheel-ring');
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', `${-BOX} ${-BOX} ${BOX * 2} ${BOX * 2}`);
    this.svg.setAttribute('aria-hidden', 'true');
    this.labels = tag('div', 'spell-wheel-labels');
    this.hub = tag('div', 'spell-wheel-hub');
    this.hint = tag('p', 'spell-wheel-hint');
    this.ring.append(this.svg, this.labels, this.hub, this.hint);
    this.wheel.append(this.ring);
    document.body.append(this.wheel);
  }

  open(x, y, held, source, pointerId = null) {
    if (!this.menu.open(held)) return false;
    Object.assign(this, { source, pointerId });
    const vw = innerWidth, vh = innerHeight;
    // Leave room under the ring for the hint line, and keep clear of the
    // rune bar and hotbar when the screen is tall enough.
    this.scale = Math.min(1, (vw - 16) / (BOX * 2), (vh - 56) / (BOX * 2));
    const half = BOX * this.scale, below = vh - half * 2 > 300 ? 150 : 48;
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

  drawWheel() {
    const menu = this.menu, entries = menu.entries, count = entries.length;
    const step = Math.PI * 2 / count, gap = Math.min(0.03, step * 0.08);
    const mid = (WHEEL.inner + WHEEL.outer) / 2;
    const width = Math.min(116, Math.max(80, 2 * mid * Math.sin(Math.min(step, Math.PI) / 2) * 0.96));
    this.wheel.dataset.stage = menu.stage;
    this.wheel.style.setProperty('--school', menu.group?.color ?? 'var(--ink)');
    this.sectors = entries.map((entry, i) => {
      const path = document.createElementNS(NS, 'path');
      const a = i * step - step / 2 + gap, b = (i + 1) * step - step / 2 - gap;
      path.setAttribute('d', count === 1 ? sectorPath(0, 0, WHEEL.inner + 4, WHEEL.outer, -Math.PI + 0.001, Math.PI)
        : sectorPath(0, 0, WHEEL.inner + 4, WHEEL.outer, a, b));
      path.style.setProperty('--tint', (menu.group ?? entry).color);
      return path;
    });
    this.svg.replaceChildren(...this.sectors);
    this.cells = entries.map((entry, i) => {
      const cell = tag('div', 'spell-wheel-label');
      const t = i * step;
      cell.style.left = `${BOX + mid * Math.sin(t)}px`;
      cell.style.top = `${BOX - mid * Math.cos(t)}px`;
      cell.style.width = `${width}px`;
      cell.style.setProperty('--tint', (menu.group ?? entry).color);
      if (menu.stage === 'groups') {
        cell.append(tag('span', 'spell-wheel-sigil', entry.sigil), tag('strong', '', entry.name),
          tag('span', 'spell-wheel-meta', `${entry.kind} · ${entry.items.length} rune${entry.items.length === 1 ? '' : 's'}`));
      } else {
        cell.append(tag('strong', '', entry.name), tag('span', 'spell-wheel-meta', this.stats(entry)[0]),
          tag('span', 'spell-wheel-cooldown'));
      }
      return cell;
    });
    this.labels.replaceChildren(...this.cells);
    this.hint.innerHTML = menu.stage === 'groups'
      ? `Point at a school · ${this.source === 'touch' ? 'lift' : 'release or click'} to open`
      : menu.held ? 'Release on a rune to bind it to <kbd>R</kbd> · centre: back'
        : this.source === 'touch' ? 'Tap a rune to bind it to CAST · centre: back · outside: close'
          : 'Click a rune to bind it to <kbd>R</kbd> · right-click: back · <kbd>Esc</kbd> close';
    if (menu.stage === 'items') this.tickWheel();
    this.paint();
  }

  // Hover, the bound rune and the hub follow the pointer.
  paint() {
    const menu = this.menu;
    if (!menu.isOpen || !this.sectors) return;
    const bound = this.casting.selected;
    menu.entries.forEach((entry, i) => {
      const isBound = menu.stage === 'groups' ? entry.items.some(s => s.id === bound) : entry.id === bound;
      for (const node of [this.sectors[i], this.cells[i]]) {
        node.classList.toggle('hover', i === menu.hover);
        node.classList.toggle('bound', isBound);
      }
    });
    const hovered = menu.hovered;
    const lines = [];
    if (menu.stage === 'groups') {
      const spell = this.casting.spells.get(bound);
      if (hovered) lines.push(['spell-wheel-sigil', hovered.sigil], ['strong', hovered.name], ['', `${hovered.kind} runes`]);
      else lines.push(['strong', 'Runes'], ['', spell ? 'Bound to R' : 'Choose a school'], ['spell-wheel-meta', spell?.name ?? '']);
    } else if (hovered) {
      lines.push(['strong', hovered.name], ...this.stats(hovered).map(s => ['spell-wheel-meta', s]));
    } else {
      lines.push(['spell-wheel-sigil', menu.group.sigil], ['strong', menu.group.name], ['spell-wheel-meta', '‹ back']);
    }
    const key = JSON.stringify(lines);
    if (this.hubKey === key) return;
    this.hubKey = key;
    this.hub.replaceChildren(...lines.map(([kind, text]) => kind === 'strong' ? tag('strong', '', text)
      : tag('span', kind || 'spell-wheel-line', text)));
  }

  tickWheel() {
    const mana = this.casting.state().mana;
    this.menu.entries.forEach((spell, i) => {
      const left = this.remaining(spell), cell = this.cells[i];
      const v = this.casting.variant(spell), cost = v ? this.casting.modifiers(v).mana ?? 0 : 0;
      const text = left ? `${left.toFixed(1)}s` : mana < cost ? 'low mana' : '';
      const node = cell.lastChild;
      if (node.textContent !== text) node.textContent = text;
      this.sectors[i].classList.toggle('waiting', Boolean(text));
    });
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

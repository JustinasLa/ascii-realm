import { furnaceScreenModel, SLOTS } from '../crafting/furnace.js';
import { ITEMS } from '../inventory/items.js';
import { itemArt } from './item-art.js';

const LABELS = { input: 'Input', fuel: 'Fuel', output: 'Output', base: 'Base', catalyst: 'Catalyst', metal: 'Metal' };
const HINTS = { input: 'Choose ore from your satchel.', fuel: 'Choose fuel from your satchel.', output: 'Smelted ingots come out here.' };
const TARGETS = { input: 'the input', fuel: 'the fuel slot', base: 'the base slot', catalyst: 'a catalyst slot',
  metal: 'the piece' };
const FURNACE = { name: 'furnace', title: 'Furnace', help: [['Enter', 'Put in / take out'], ['Arrows', 'Move'], ['Esc', 'Close']] };
// The flame gauge's rows, top to bottom, shown from the bottom up as fuel is left.
const FLAME = [' ^ ', '(^)', '/^\\'];
// The tap that opened the screen ends with a click on whatever is now under
// the finger; pointer clicks this soon after opening are ignored.
const GHOST_MS = 500;

// An element with its class, text and attributes.
export function element(tag, className, text, attributes = {}) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
export const setText = (node, text) => node.textContent !== text && (node.textContent = text);
export const attribute = (node, name, value) => node.getAttribute(name) !== value && node.setAttribute(name, value);
export const art = (id) => itemArt(id, ITEMS[id].glyph);
const flameArt = (flame) => FLAME.map((row, i) => (3 - i <= Math.ceil(flame * 3) ? row : ' . ')).join('\n');
const arrowArt = (step) => `[${'='.repeat(step)}>${' '.repeat(10 - step)}]`;

/** A furnace's screen: its three slots and gauges, and the satchel's resources to load. */
// Other stations extend it with their own `kind`, `_layout`, `_controls`, `_select`, `_put` and `update`.
export class FurnaceScreen {
  constructor({ onToggle = () => {}, onNotify = () => {}, ...options }, kind = FURNACE) {
    Object.assign(this, options, { onToggle, onNotify, isOpen: false, id: null, rows: [],
      _consumed: new Set(), _openedAt: -Infinity });
    this.root = document.getElementById('inventory-root');
    this.screen = element('section', `inventory-screen ${kind.name}-screen`, undefined, { role: 'dialog',
      'aria-modal': 'true', 'aria-labelledby': `${kind.name}-title`, 'aria-describedby': `${kind.name}-help` });
    this.screen.hidden = true;
    const header = element('header', 'inventory-header');
    this.closeButton = this._button('inventory-close', () => this.close(), { 'aria-label': `Close the ${kind.title.toLowerCase()}` });
    this.closeButton.append(element('span', '', 'Close'), element('kbd', '', 'Esc'));
    header.append(element('h2', 'inventory-title', kind.title, { id: `${kind.name}-title` }), this.closeButton);
    this._mount(header, this._layout(), kind);
  }

  // The slots and gauges over the satchel's list, with the feedback line.
  _layout() {
    this.slots = {};
    for (const slot of SLOTS) {
      const node = this.slots[slot] = this._button('furnace-slot',
        () => this._notify(this.furnaces.takeOut(this.id, slot, this.inventory)));
      node.art = element('span', 'furnace-slot-art');
      node.count = element('span', 'furnace-slot-count');
      node.append(node.art, node.count, element('span', 'furnace-slot-caption', LABELS[slot]));
    }
    const gauge = (className, label) => element('pre', className, undefined,
      { role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' });
    this.flame = gauge('furnace-flame', 'Fuel');
    this.arrow = gauge('furnace-arrow', 'Smelting');
    const left = element('div', 'furnace-column');
    left.append(this.slots.input, this.flame, this.slots.fuel);
    const works = element('div', 'furnace-works');
    works.append(left, this.arrow, this.slots.output);
    this.status = element('p', 'furnace-status');
    this.feedback = element('p', 'inventory-feedback', undefined, { role: 'status', 'aria-atomic': 'true' });
    this.feedback.hidden = true;
    const furnace = element('div', 'furnace-main');
    furnace.append(works, this.status, this.feedback);
    this.list = element('div', 'furnace-bag-list', undefined, { role: 'group', 'aria-label': 'Your satchel' });
    this.empty = element('p', 'furnace-empty',
      'Nothing in your satchel smelts or burns. Mine iron, copper and coal from ore veins.');
    const satchel = element('section', 'furnace-satchel');
    satchel.append(element('h3', 'inventory-heading', 'From your satchel'), this.list, this.empty);
    const layout = element('div', 'furnace-layout');
    layout.append(furnace, satchel);
    return layout;
  }

  // Puts the layout between the header and the key hints, and the dialog in the page.
  _mount(header, layout, kind) {
    const help = element('div', 'inventory-help', undefined, { id: `${kind.name}-help` });
    help.append(...kind.help.map(([keys, action]) => {
      const hint = element('span', 'inventory-key-hint');
      hint.append(element('kbd', '', keys), element('span', '', action));
      return hint;
    }));
    this.screen.append(header, layout, help);
    // Keep scene zoom and pointer handlers out of the panel.
    this.screen.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      this.screen.addEventListener(type, (event) => event.stopPropagation());
    }
    this.root.append(this.screen);
    window.addEventListener('keydown', (event) => this._handleKeydown(event), true);
    window.addEventListener('keyup', (event) => this._consumed.delete(event.code) && event.stopImmediatePropagation(), true);
  }

  // Every control in visual order: the slots, the satchel's rows, Close.
  _controls() {
    return [this.slots.input, this.slots.fuel, this.slots.output, ...this.rows, this.closeButton];
  }

  // The furnace with this prop id, or why it can't be used.
  _select(id) {
    this.furnace = this.furnaces.get(id);
    return this.furnace ? null : "This furnace can't be used: too many furnaces are busy.";
  }

  _put(index) {
    return this.furnaces.putIn(this.id, this.inventory, index);
  }

  _button(className, onClick, attributes) {
    const node = element('button', className, undefined, { type: 'button', ...attributes });
    node.addEventListener('click', (event) => {
      if (!event.detail || performance.now() - this._openedAt >= GHOST_MS) onClick();
    });
    return node;
  }

  // Opens the station with this prop id; false when it can't be used.
  open(id) {
    const busy = this._select(id);
    if (busy) {
      this.onNotify(busy, 'error');
      return false;
    }
    this.id = id;
    this._signature = null;
    if (!this.isOpen) {
      this._previousFocus = document.activeElement;
      this._openedAt = performance.now();
      this._setOpen(true);
    }
    this.update();
    (this.rows.find((row) => row.dataset.target) ?? this._controls()[0]).focus();
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this._setOpen(false);
    const target = document.getElementById('screen') ?? this._previousFocus;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  _setOpen(open) {
    this.isOpen = open;
    this.screen.hidden = !open;
    this.root.classList.toggle('is-open', open);
    document.body.classList.toggle('station-open', open);
    for (const id of ['hud-root', 'screen']) {
      const surface = document.getElementById(id);
      if (surface) surface.inert = open;
    }
    this.feedback.hidden = true;
    this.onToggle(open);
  }

  // Tells what a move did in the feedback line, and as a toast unless `quiet`.
  _notify(done, kind = done.ok ? 'info' : 'error', quiet = false) {
    if (!quiet) this.onNotify(done.message, kind);
    this.feedback.textContent = done.message;
    this.feedback.dataset.kind = kind;
    this.feedback.hidden = false;
    this._feedbackUntil = performance.now() + 3500;
    this.update();
  }

  _handleKeydown(event) {
    if (!this.isOpen || event.defaultPrevented) return;
    // Browser shortcuts keep their defaults; no key reaches the game. A text
    // field keeps every key but Esc and Tab, and Enter submits its form.
    event.stopImmediatePropagation();
    const typing = event.target?.tagName === 'INPUT' && !['Escape', 'Tab'].includes(event.code);
    if (event.altKey || event.ctrlKey || event.metaKey || typing) return;
    event.preventDefault();
    const code = event.code;
    this._consumed.add(code);
    if (code === 'Escape' || code === 'KeyE') {
      if (!event.repeat) this.close();
      return;
    }
    const controls = this._controls();
    const at = controls.indexOf(document.activeElement);
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, Tab: event.shiftKey ? -1 : 1 }[code];
    if (step) controls[(Math.max(at, step > 0 ? -1 : 0) + step + controls.length) % controls.length].focus();
    else if (at >= 0 && ['Enter', 'NumpadEnter', 'Space'].includes(code) && !event.repeat) controls[at].click();
  }

  // Redraws what changed; the gauges' spoken values only on whole steps.
  update() {
    if (!this.isOpen) return;
    if (!this.feedback.hidden && performance.now() >= this._feedbackUntil) this.feedback.hidden = true;
    const model = furnaceScreenModel(this.furnace, this.inventory);
    const seconds = Math.ceil(this.furnace.burn);
    const step = Math.floor(model.arrow * 10);
    const signature = JSON.stringify([model.input, model.fuel, model.output, model.status, seconds, step,
      Math.ceil(model.flame * 3)]);
    if (signature !== this._signature) {
      this._signature = signature;
      for (const slot of SLOTS) {
        const node = this.slots[slot];
        const stack = model[slot];
        node.classList.toggle('empty', !stack);
        setText(node.art, stack ? art(stack.id) : '');
        setText(node.count, stack ? `x${stack.count}` : '');
        attribute(node, 'aria-label', stack ? `${LABELS[slot]}: ${stack.name}, ${stack.count}. Press to take${
          slot === 'output' ? '' : ' back'}.` : `${LABELS[slot]}: empty. ${HINTS[slot]}`);
      }
      setText(this.flame, flameArt(model.flame));
      this.flame.classList.toggle('lit', model.lit);
      attribute(this.flame, 'aria-valuenow', String(Math.round(seconds / (this.furnace.burnTotal || 1) * 100)));
      attribute(this.flame, 'aria-valuetext', model.lit ? `${seconds} seconds of fuel left` : 'Out of fuel');
      setText(this.arrow, arrowArt(step));
      attribute(this.arrow, 'aria-valuenow', String(step * 10));
      attribute(this.arrow, 'aria-valuetext', `${step * 10} percent`);
      setText(this.status, model.status);
    }
    const bag = JSON.stringify(model.bag);
    if (bag !== this._bag) {
      this._bag = bag;
      this._fillBag(model.bag);
    }
  }

  // Rebuilds the satchel's rows, keeping focus at the same place in the list.
  _fillBag(rows) {
    const focused = this.rows.indexOf(document.activeElement);
    this.rows = rows.map((row) => {
      const node = this._button('furnace-bag-item', () => this._notify(this._put(row.index)),
        { 'aria-label': `${row.name}, ${row.count}. ${row.target ? `Put in ${TARGETS[row.target]}` : row.reason}.` });
      const name = element('span', 'furnace-bag-name', row.name);
      name.style.color = row.colour ?? '';
      node.append(element('span', 'furnace-bag-art', art(row.id)), name,
        element('span', 'furnace-bag-count', `x${row.count}`),
        element('span', 'furnace-bag-target', row.target ? `→ ${LABELS[row.target]}` : row.reason));
      if (row.target) node.dataset.target = row.target;
      else node.setAttribute('aria-disabled', 'true');
      return node;
    });
    this.list.replaceChildren(...this.rows);
    this.empty.hidden = rows.length > 0;
    if (focused >= 0) (this.rows[Math.min(focused, this.rows.length - 1)] ?? this._controls()[0]).focus();
  }
}

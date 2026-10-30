import { EQUIPMENT_SLOTS, ITEMS, STACK_SLOTS, fitsSlot } from '../inventory/items.js';
import { BagGestures } from './bag-gestures.js';
import { BAG_TABS, bagView, cardLabel, itemKind } from './bag-view.js';
import { itemArt } from './item-art.js';
import { shapeOf } from './item-shading.js';
import { itemStudio } from './item-studio.js';
import { ItemTooltip, tooltipFor } from './item-tooltip.js';
import { DOLL_BOXES, dollArea } from './paper-doll.js';
import { sheetStats } from './sheet-stats.js';

const SLOT_NAMES = {
  helm: 'Helm',
  chest: 'Chest',
  legs: 'Legs',
  hands: 'Hands',
  cape: 'Cloak',
  mainHand: 'Main hand',
  offHand: 'Off hand',
  feet: 'Feet',
  amulet: 'Amulet',
  ringLeft: 'Left ring',
  ringRight: 'Right ring',
  quiver: 'Quiver',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

// A box's art: the picture `src` when there is one, else the outline text.
function setArt(node, src, text) {
  const image = node.firstElementChild;
  if (!src) {
    if (image) node.replaceChildren();
    setText(node, text);
    return;
  }
  if (image) attribute(image, 'src', src);
  else {
    const img = element('img', 'item-art');
    img.alt = '';
    img.setAttribute('src', src);
    node.replaceChildren(img);
  }
}

function attribute(node, name, value) {
  if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
}

function hidden(node, value) {
  if (node.hidden !== value) node.hidden = value;
}

// What an empty box says. Phones have no pointer to click with, so they name taps.
export function emptySlotHint(phone = false) {
  return phone ? 'Tap gear in the bag to equip it.' : 'Click gear in the bag to equip it.';
}

// Within this many px of a scrolling edge, a drag scrolls toward it.
const EDGE = 48;

/** A live inventory panel. Opening it blocks controls, while the world keeps moving. */
export class InventoryScreen {
  // `pages` are more tabs after the bag's: `{ id, label, node, onShow }`,
  // `onShow` running each time the page shows.
  // `isCovered` is true while another panel (a furnace) holds the keys.
  // `describe(stack)` gives a stack's own { name, colour, description, stats }
  // (an alloy ingot's), or null for its item's; `describeVersion()` changes with them.
  // The stats strip reads `wallet.cents` and `attributes()`, the six totals
  // or null; `className` heads the sheet beside the name. `art` makes the
  // item pictures (item-studio.js); without it the outlines show.
  constructor({ inventory, player, onToggle, onNotify, onDrop, name = 'Kael', className = null, phone = () => false,
    pages = [], isCovered = () => false, describe = () => null, describeVersion = () => 0, wallet = null,
    attributes = () => null, art = itemStudio }) {
    Object.assign(this, { isCovered, describe, describeVersion, wallet, attributes, art });
    // A picture the studio lets go comes off the screen at once; its box
    // shows the outline until the picture is made again.
    this._unwatch = art?.watch?.((src) => {
      for (const img of this.root.querySelectorAll('.item-art')) if (img.getAttribute('src') === src) img.remove();
      this._signature = null;
    });
    this.manaSource = null;
    // Phones have no keyboard, so their hints name taps instead of keys.
    this.phone = phone;
    // Drops a bag stack into the world; returns { ok, message }.
    this.onDrop = typeof onDrop === 'function' ? onDrop : null;
    this.inventory = inventory;
    this.player = player;
    this.onToggle = onToggle || (() => {});
    this.onNotify = (message, kind = 'info') => {
      if (typeof onNotify === 'function') onNotify(message, kind);
      if (!this._isOpen) return;
      setText(this.feedback, String(message));
      this.feedback.dataset.kind = kind;
      hidden(this.feedback, false);
      this._feedbackUntil = performance.now() + 3500;
    };
    this._isOpen = false;
    this._signature = null;
    this._drag = null;
    this._consumedKeys = new Set();
    const firstItem = inventory.slots.findIndex((stack) => stack);
    this.selection = firstItem >= 0 ? { source: 'bag', index: firstItem } : null;

    this.root = document.getElementById('inventory-root');
    if (!this.root) {
      this.root = element('div');
      this.root.id = 'inventory-root';
      document.body.append(this.root);
    }

    this.screen = element('section', 'inventory-screen inventory-sheet');
    this.screen.hidden = true;
    this.screen.setAttribute('role', 'dialog');
    this.screen.setAttribute('aria-label', 'Inventory');
    this.screen.setAttribute('aria-modal', 'true');
    this.screen.setAttribute('aria-describedby', 'inventory-help');

    // The header: NAME · CLASS, the pages and a boxed close (I).
    const header = element('header', 'inventory-header');
    const identity = element('h2', 'inventory-identity');
    this.nameNode = element('span', 'inventory-character-name');
    this.nameNode.setAttribute('dir', 'auto');
    const separator = element('span', 'inventory-identity-separator', ' · ');
    separator.setAttribute('aria-hidden', 'true');
    this.classNode = element('span', 'inventory-character-class');
    identity.append(this.nameNode, separator, this.classNode);
    this.setName(name, className);
    const close = element('button', 'inventory-close', 'close');
    close.append(element('kbd', '', 'I'));
    close.type = 'button';
    close.setAttribute('aria-label', 'Close inventory');
    close.addEventListener('click', () => this.setOpen(false));
    // The pages, as tabs: the bag, then the character menu's.
    this.page = 'inventory';
    this.pages = [{ id: 'inventory', label: 'Inventory' }, ...pages];
    const tabs = element('div', 'inventory-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Pages');
    tabs.hidden = !pages.length;
    for (const page of this.pages) {
      page.tab = element('button', 'inventory-tab', page.label);
      page.tab.type = 'button';
      page.tab.id = `inventory-tab-${page.id}`;
      page.tab.setAttribute('role', 'tab');
      page.tab.setAttribute('aria-controls', `inventory-page-${page.id}`);
      page.tab.addEventListener('click', () => this._show(page.id, true));
      tabs.append(page.tab);
    }
    header.append(identity, tabs, close);

    const body = element('div', 'inventory-body');
    // The paper doll: a box per slot on one grid (paper-doll.js).
    const doll = element('section', 'inventory-doll');
    const frame = element('div', 'doll-frame');
    this.equipmentGrid = element('div', 'equipment-slots');
    this.equipmentGrid.setAttribute('role', 'group');
    this.equipmentGrid.setAttribute('aria-label', 'Equipped items');
    this.equipmentNodes = new Map();
    for (const slot of EQUIPMENT_SLOTS) {
      const button = element('button', 'equipment-slot');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.equipmentSlot = slot;
      button.dataset.box = DOLL_BOXES[slot].small ? 'small' : 'large';
      button.style.gridArea = dollArea(slot);
      const label = element('span', 'equipment-slot-label', DOLL_BOXES[slot].label);
      const icon = element('div', 'equipment-slot-icon');
      icon.setAttribute('aria-hidden', 'true');
      const count = element('span', 'equipment-slot-count');
      count.setAttribute('aria-hidden', 'true');
      button.append(label, icon, count);
      button.addEventListener('click', () => this._press({ source: 'equipment', slot }));
      this.equipmentNodes.set(slot, { button, icon, count });
      this.equipmentGrid.append(button);
    }
    frame.append(this.equipmentGrid);
    doll.append(frame);
    // The stats strip: `label value` pairs, built for each set of keys.
    this.statsStrip = element('dl', 'sheet-stats');
    this.statsStrip.setAttribute('aria-label', 'Character stats');
    this._statKeys = null;
    this._statsLine = null;

    // The bag: its count and a hint, filter tabs with stack counts, and a
    // card per slot, hidden while empty or filtered out.
    const bag = element('section', 'inventory-bag');
    const bagHeading = element('div', 'inventory-bag-heading');
    this.slotCounter = element('h3', 'inventory-heading');
    this.bagHint = element('span', 'inventory-bag-hint');
    bagHeading.append(this.slotCounter, this.bagHint);
    // Not role="tab": the page keys turn pages on those.
    this.filter = 'all';
    const filters = element('div', 'bag-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter the bag');
    this.filterNodes = new Map(BAG_TABS.map(({ id, label }) => {
      const button = element('button', 'bag-filter', label);
      button.type = 'button';
      button.dataset.filter = id;
      const count = element('span', 'bag-filter-count');
      button.append(count);
      button.addEventListener('click', () => this._filterBy(id));
      filters.append(button);
      return [id, { button, count }];
    }));
    this.cardGrid = element('div', 'bag-cards');
    this.cardGrid.setAttribute('role', 'group');
    this.cardGrid.setAttribute('aria-label', 'Carried items');
    this.bagNodes = inventory.slots.map((_, index) => {
      const button = element('button', 'bag-card');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.slotIndex = String(index);
      const icon = element('div', 'bag-card-art');
      icon.setAttribute('aria-hidden', 'true');
      const count = element('span', 'bag-card-label');
      count.setAttribute('aria-hidden', 'true');
      button.append(icon, count);
      button.addEventListener('click', () => this._press({ source: 'bag', index }));
      this.cardGrid.append(button);
      return { button, icon, count };
    });
    this.bagEmpty = element('p', 'bag-empty');
    this.feedback = element('p', 'inventory-feedback');
    this.feedback.setAttribute('role', 'status');
    this.feedback.setAttribute('aria-atomic', 'true');
    this.feedback.hidden = true;
    this.bag = bag;
    bag.append(bagHeading, filters, this.cardGrid, this.bagEmpty, this.feedback);
    const carried = element('div', 'inventory-carried');
    carried.append(bag);
    body.append(doll, this.statsStrip, carried);

    const help = element('div', 'inventory-help');
    for (const [keys, action] of [['Arrows', 'Navigate'], ['G', 'Switch pane'], ['Enter', 'Equip / take off'],
      ...(this.onDrop ? [['X', 'Drop']] : [])]) {
      const hint = element('span', 'inventory-key-hint');
      hint.append(element('kbd', '', keys), element('span', '', action));
      help.append(hint);
    }
    help.id = 'inventory-help';
    this.pages[0].node = body;
    this.pages[0].help = help;
    for (const page of this.pages) {
      page.node.id = `inventory-page-${page.id}`;
      page.node.setAttribute('role', 'tabpanel');
      page.node.setAttribute('aria-labelledby', page.tab.id);
    }
    this.screen.append(header, body, help, ...pages.map((page) => page.node));
    this._show('inventory');
    // Keep scene zoom and pointer handlers out of panel interactions.
    this.screen.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    this.screen.addEventListener('pointerdown', (event) => {
      this._pointerType = event.pointerType;
      this._keyboard = false;
      // A press anywhere else closes a pinned panel before it acts.
      if (this.tooltip.pinned) this._hideTip();
      event.stopPropagation();
    });
    // The item tooltip: beside a mouse or pen over a filled card or box, at
    // the button the keys select, and pinned with buttons after a hold.
    this.tooltip = new ItemTooltip(this.root);
    this._tip = null;
    this.screen.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || this.tooltip.pinned || this._drag) return;
      const source = this._sourceOf(event.target);
      if (!source) this._hideTip();
      else if (this._tip?.node === source.node && !this._tip.keyboard) {
        // A redraw shows it where the pointer is now.
        this._tip.point = { x: event.clientX, y: event.clientY };
        this.tooltip.move(event.clientX, event.clientY);
      } else this._showTip(source, { x: event.clientX, y: event.clientY });
    });
    this.screen.addEventListener('pointerleave', () => { if (!this.tooltip.pinned && !this._drag) this._hideTip(); });
    // A scroll moves the cards away from a tooltip; one the keys showed
    // follows its button. A pinned panel waits for the next press, and a
    // touch on its way to a hold carries on.
    this.screen.addEventListener('scroll', () => {
      if (this._tip?.keyboard) this._showTip(this._tip);
      else if (this._tip && !this.tooltip.pinned) this._hideTip();
    }, { capture: true, passive: true });
    this.gestures = new BagGestures({ surface: this.screen, swallowOn: this.root,
      sourceOf: (target) => this._sourceOf(target), onHold: (selection) => this._hold(selection),
      onDragStart: (selection) => this._dragStart(selection), onDragMove: (point, target) => this._dragMove(point, target),
      onDrop: (selection, target) => this._dropOn(selection, target), onDragEnd: () => this._dragEnd() });
    // No browser menu in the window; a right-click drops a card's stack. A
    // long touch sends one too on Android, and drops nothing.
    this.screen.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const card = event.target?.closest?.('.bag-card');
      if (!card || this._pointerType === 'touch') return;
      this._select({ source: 'bag', index: Number(card.dataset.slotIndex) });
      this._drop();
    });
    this.screen.addEventListener('pointerup', (event) => event.stopPropagation());
    this.screen.addEventListener('mousedown', (event) => event.stopPropagation());
    this.screen.addEventListener('mouseup', (event) => event.stopPropagation());
    this.root.append(this.screen);

    this._keydown = (event) => this._handleKeydown(event);
    this._keyup = (event) => {
      if (!this._isOpen && !this._consumedKeys.has(event.code)) return;
      this._consumedKeys.delete(event.code);
      event.stopImmediatePropagation();
    };
    this._blur = () => { this._consumedKeys.clear(); this._hideTip(); };
    window.addEventListener('keydown', this._keydown, true);
    window.addEventListener('keyup', this._keyup, true);
    window.addEventListener('blur', this._blur);
    // A turned phone re-places a pinned panel, its buttons on screen.
    // A turned phone reshapes the boxes, and so their pictures.
    this._resize = () => {
      this._signature = null;
      if (this.tooltip.pinned) this._pin(this._tip);
    };
    window.addEventListener('resize', this._resize);
  }

  get isOpen() { return this._isOpen; }

  // Opens on `page`, or turns to it when already open.
  setOpen(open, page = 'inventory') {
    open = Boolean(open);
    if (open) this._show(page, this._isOpen);
    if (open === this._isOpen) return;
    if (open) this._previousFocus = document.activeElement;
    this._isOpen = open;
    this.screen.hidden = !open;
    this.root.classList.toggle('is-open', open);
    document.body.classList.toggle('inventory-open', open);
    for (const id of ['hud-root', 'screen']) {
      const surface = document.getElementById(id);
      if (surface) surface.inert = open;
    }
    hidden(this.feedback, true);
    this._hideTip();
    this.onToggle(open);
    if (open) {
      this.art?.reopen();
      this.update();
      // The sheet opens at its top, on the doll, wherever the selection is
      // and however far down it was scrolled when it closed.
      this.screen.scrollTop = 0;
      if (this.page === 'inventory') this._focusTarget().focus({ preventScroll: true });
      else this._tab().focus();
    } else {
      // Gameplay handlers ignore UI controls, so closing returns to the scene.
      const canvas = document.getElementById('screen');
      if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
      const target = canvas || this._previousFocus;
      if (target?.isConnected && !this.screen.contains(target)) target.focus({ preventScroll: true });
    }
  }

  // Without a class the character is an outlaw; `setName(name)` keeps the class.
  setName(name, className = this._className) {
    this._className = className || 'Outlaw';
    setText(this.nameNode, String(name));
    setText(this.classNode, this._className);
  }

  // Any object with mana and maxMana, such as the spellcasting system.
  attachMana(source) { this.manaSource = source || null; }

  _tab(id = this.page) { return this.pages.find((page) => page.id === id).tab; }

  // Shows one page and hides the rest, with its tab selected and the one
  // Tab and arrow keys reach.
  _show(id, focus = false) {
    if (!this.pages.some((page) => page.id === id)) return;
    if (id !== this.page) {
      this._hideTip();
      // The doll's boxes are measured afresh when it shows again.
      this._signature = null;
    }
    this.page = id;
    for (const page of this.pages) {
      const selected = page.id === id;
      attribute(page.tab, 'aria-selected', String(selected));
      page.tab.tabIndex = selected ? 0 : -1;
      page.tab.classList.toggle('selected', selected);
      hidden(page.node, !selected);
      if (page.help) hidden(page.help, !selected);
      if (selected) page.onShow?.();
    }
    if (focus) this._tab().focus();
  }

  toggle() { this.setOpen(!this._isOpen); }

  _consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    this._consumedKeys.add(event.code);
  }

  _handleKeydown(event) {
    if (event.defaultPrevented || (!this._isOpen && this.isCovered())) return;
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    const editing = event.target?.isContentEditable
      || event.target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    // Tab keeps moving focus inside the builder and audio panels.
    if (!this._isOpen && (editing || event.target?.closest?.('#panel-dock'))) return;
    if (!modified && (event.code === 'KeyI' || event.code === 'Tab' && !event.shiftKey)) {
      this._consume(event);
      if (!event.repeat) this.toggle();
      return;
    }
    if (!this._isOpen) return;
    this._keyboard = true;
    // Tab closes the inventory; reverse Tab navigates its controls. Keep
    // that focus inside the panel even though the world continues updating.
    if (!modified && event.code === 'Tab' && event.shiftKey) {
      this._consume(event);
      const controls = [...this.screen.querySelectorAll('button')]
        .filter((button) => button.tabIndex >= 0 && !button.disabled && !button.closest('[hidden]'));
      const index = controls.indexOf(document.activeElement);
      controls[index <= 0 ? controls.length - 1 : index - 1]?.focus();
      this._tipAtFocus();
      return;
    }
    // Browser shortcuts retain their defaults while game listeners stay blocked.
    if (modified) {
      event.stopImmediatePropagation();
      return;
    }
    // Esc ends a drag first, and closes the window after.
    if (event.code === 'Escape') {
      this._consume(event);
      if (this.gestures.dragging) this.gestures.cancel();
      else this.setOpen(false);
      return;
    }
    // C turns to the next page; arrows, Home and End move along the tabs.
    const pageAt = (index) => this.pages[(index + this.pages.length) % this.pages.length].id;
    const current = this.pages.findIndex((page) => page.id === this.page);
    if (event.code === 'KeyC') {
      this._consume(event);
      if (!event.repeat) this._show(pageAt(current + 1), true);
      return;
    }
    const tabKeys = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: this.pages.length - 1 };
    if (event.code in tabKeys && event.target?.closest?.('[role="tab"]')) {
      this._consume(event);
      this._show(pageAt(tabKeys[event.code]), true);
      return;
    }
    const focusedButton = event.target?.closest?.('button');
    if (focusedButton && this.screen.contains(focusedButton)
      && (event.code === 'Space' || ['Enter', 'NumpadEnter'].includes(event.code)
        && !focusedButton.matches('.bag-card, .equipment-slot'))) {
      this._consume(event);
      if (!event.repeat) focusedButton.click();
      return;
    }
    // The other pages have no bag keys, but no key reaches the game either.
    const gameKeys = ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyF', 'KeyQ', 'Equal', 'Minus', 'Backspace'];
    if (this.page !== 'inventory') {
      event.stopImmediatePropagation();
      if (gameKeys.includes(event.code)) this._consume(event);
      return;
    }
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(event.code)) {
      this._consume(event);
      this._navigate(event.code);
      return;
    }
    if (['KeyG', 'KeyE', 'KeyU', 'KeyX', 'Enter', 'NumpadEnter'].includes(event.code)) {
      this._consume(event);
      if (event.repeat) return;
      // The bag may have changed since the last frame; act on what shows.
      this.update();
      const first = this._view.visible[0];
      if (event.code === 'KeyG') {
        if (this.selection?.source !== 'equipment') this._select({ source: 'equipment', slot: EQUIPMENT_SLOTS[0] }, true);
        else if (first !== undefined) this._select({ source: 'bag', index: first }, true);
      } else if (event.code === 'KeyE') this._equip();
      else if (event.code === 'KeyU') this._unequip();
      else if (event.code === 'KeyX') this._drop();
      else this._activate();
      return;
    }
    // No held movement or queued attack may escape from an open inventory.
    event.stopImmediatePropagation();
    if (gameKeys.includes(event.code)) this._consume(event);
  }

  // The selection is null while the bag shows no cards.
  _selectedButton() {
    return this.selection?.source === 'bag'
      ? this.bagNodes[this.selection.index]?.button
      : this.equipmentNodes.get(this.selection?.slot)?.button;
  }

  _focusTarget() { return this._selectedButton() ?? this.filterNodes.get(this.filter).button; }

  // A click or a tap acts at once, without moving focus.
  _press(selection) {
    this._select(selection);
    this._activate({ pointer: true });
  }

  // The filled card or box under `target` (any box with `empty`) and its selection.
  _sourceOf(target, empty = false) {
    const node = target?.closest?.('.bag-card, .equipment-slot');
    if (!node) return null;
    const { equipmentSlot: slot, slotIndex } = node.dataset;
    const selection = slot ? { source: 'equipment', slot } : { source: 'bag', index: Number(slotIndex) };
    return empty || this._selectedItem(selection) ? { selection, node } : null;
  }

  // What the tooltip says about `selection`: its item, or an empty box's hint.
  _tipContent(selection, phone = false) {
    const held = this._selectedItem(selection);
    if (!held) return { name: SLOT_NAMES[selection.slot], colour: null, lines: [], help: emptySlotHint(this.phone()) };
    return tooltipFor({ item: held.item, stack: held.stack, own: this.describe(held.stack), where: selection.source,
      phone, drop: Boolean(this.onDrop) });
  }

  // The tooltip redraws when this changes: the stack shown or the describer's version.
  _tipKey(selection) {
    return JSON.stringify([selection, this._selectedItem(selection)?.stack, this.describeVersion(), this.phone()]);
  }

  // Beside the pointer at `point`, or without one beside the button.
  _showTip({ selection, node }, point = null) {
    const { right, top } = node.getBoundingClientRect();
    this._tip = { selection, node, point, keyboard: !point, key: this._tipKey(selection) };
    this._describe(node);
    this.tooltip.show(this._tipContent(selection), point?.x ?? right, point?.y ?? top);
  }

  // Hides the tooltip and drops a hold or drag in progress.
  _hideTip() {
    this._tip = null;
    this._describe(null);
    this.tooltip.hide();
    this.gestures.cancel();
  }

  // The tooltip describes the card or box it shows for.
  _describe(node) {
    if (this._described !== node) this._described?.removeAttribute('aria-describedby');
    node?.setAttribute('aria-describedby', this.tooltip.node.id);
    this._described = node;
  }

  // After a key moves focus onto a card or box, its tooltip shows beside it.
  _tipAtFocus() {
    const source = this._keyboard && this._sourceOf(document.activeElement, true);
    if (source) this._showTip(source);
    else this._hideTip();
  }

  _refreshTip() {
    const tip = this._tip;
    if (!this._selectedItem(tip.selection) && !(tip.keyboard && tip.selection.source === 'equipment')) this._hideTip();
    else if (this.tooltip.pinned) this._pin(tip);
    else this._showTip(tip, tip.point);
  }

  // A hold selects the card or box and pins its tooltip, with buttons for its
  // action, then drop.
  _hold(selection) {
    this._select(selection);
    this._pin({ selection, node: this._selectedButton() });
  }

  _pin({ selection, node }) {
    const { item } = this._selectedItem(selection);
    const run = (action) => () => {
      this._hideTip();
      this._select(selection);
      action.call(this, { pointer: true });
    };
    const main = selection.source === 'equipment' ? { label: 'take off', run: run(this._unequip) }
      : item.equipmentSlot ? { label: 'equip', run: run(this._equip) } : item.use ? { label: 'use', run: run(this._use) } : null;
    const drop = selection.source === 'bag' && this.onDrop ? { label: 'drop', run: run(this._drop) } : null;
    this._tip = { selection, node, point: null, keyboard: false, key: this._tipKey(selection) };
    this._describe(node);
    this.tooltip.pin(this._tipContent(selection, true), node.getBoundingClientRect(), [main, drop].filter(Boolean));
  }

  // What a drag from `from` may end on: a doll box its piece fits (a worn
  // piece's, by a swap), the bag for worn gear, another card for a card.
  _accepts(from, node) {
    const slot = node.dataset.equipmentSlot;
    if (from.source === 'equipment') return slot ? this.inventory.canSwapEquipped(from.slot, slot) : node === this.bag;
    const item = this._selectedItem(from)?.item;
    return Boolean(item) && (slot ? fitsSlot(item, slot) : node.classList.contains('bag-card') && node !== this.bagNodes[from.index].button);
  }

  // The card, box or bag under `target` that a drag from `from` may end on.
  _dropTarget(from, target) {
    const node = target?.closest?.(from.source === 'bag' ? '.equipment-slot, .bag-card' : '.equipment-slot, .inventory-bag');
    return node && this.screen.contains(node) && this._accepts(from, node) ? node : null;
  }

  // A drag picks the piece up: a ghost of its art, and only the boxes (or
  // the bag) it may go to lit.
  _dragStart(selection) {
    this._tip = null;
    this._describe(null);
    this.tooltip.hide();
    this._select(selection);
    const node = this._selectedButton();
    const ghost = element('div', 'drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    const art = node.querySelector('.bag-card-art, .equipment-slot-icon');
    const copy = element('div', 'bag-card-art');
    setArt(copy, art.querySelector('img')?.getAttribute('src'), art.textContent);
    ghost.append(copy);
    this.root.append(ghost);
    const lit = [...this.equipmentNodes.values()].map(({ button }) => button).concat(this.bag)
      .filter((target) => this._accepts(selection, target));
    for (const target of lit) target.classList.add('drop-ok');
    node.classList.add('dragging');
    document.body.classList.add('inventory-dragging');
    const { width, height } = ghost.getBoundingClientRect();
    this._drag = { selection, node, ghost, lit, width, height, hover: null, speed: 0,
      scroller: this.phone() ? this.screen : this.cardGrid };
    // The cards slide under a still pointer: what it is over now lights.
    const scroll = () => {
      const { speed, scroller, point } = this._drag;
      if (speed) {
        scroller.scrollTop += speed;
        this._dragMove(point, this.gestures.hitTest(point.x, point.y));
      }
      this._drag.frame = requestAnimationFrame(scroll);
    };
    scroll();
  }

  // The ghost rides above a finger (never off the top) and centred on a
  // mouse; the target under it lights brighter, and near the scroller's top
  // or bottom edge it scrolls.
  _dragMove(point, target) {
    const { x, y, touch } = point;
    const drag = this._drag;
    drag.point = point;
    drag.ghost.style.transform = `translate(${Math.round(x - drag.width / 2)}px, ${Math.round(Math.max(0, y - drag.height * (touch ? 1.1 : 0.5)))}px)`;
    const hover = this._dropTarget(drag.selection, target);
    if (hover !== drag.hover) {
      drag.hover?.classList.remove('drop-hover');
      hover?.classList.add('drop-hover');
      drag.hover = hover;
    }
    const { top, bottom } = drag.scroller.getBoundingClientRect();
    const near = (edge) => Math.max(0, EDGE - edge) / 4;
    drag.speed = y < top || y > bottom ? 0 : near(bottom - y) - near(y - top);
  }

  // A card on a lit box equips there, on another card moves or merges; worn
  // gear in the bag comes off, on a lit box swaps. Anywhere else, nothing.
  _dropOn(from, target) {
    const node = this._dropTarget(from, target);
    if (!node) return;
    const slot = node.dataset.equipmentSlot;
    const index = Number(node.dataset.slotIndex);
    this.selection = from;
    if (from.source === 'bag') {
      if (slot) this._equip({ pointer: true, slot });
      else if (this.inventory.move(from.index, index)) this._select({ source: 'bag', index });
    } else if (slot) {
      this.inventory.swapEquipped(from.slot, slot);
      this._select({ source: 'equipment', slot });
    } else this._unequip({ pointer: true });
  }

  _dragEnd() {
    const { node, ghost, lit, hover } = this._drag;
    cancelAnimationFrame(this._drag.frame);
    this._drag = null;
    ghost.remove();
    for (const target of lit) target.classList.remove('drop-ok');
    hover?.classList.remove('drop-hover');
    node.classList.remove('dragging');
    document.body.classList.remove('inventory-dragging');
    this.update();
  }

  _filterBy(id) {
    this.filter = id;
    this._hideTip();
    this.update();
  }

  // After an action on bag slot `index`, the selection stays in the bag: on
  // that card if it still shows, else the next, else the previous, else none.
  // Focus moves only off a card that hid, without scrolling the sheet.
  _settle(index) {
    const { visible } = bagView(this.inventory.slots, this.filter);
    const next = visible.find((shown) => shown >= index) ?? visible.at(-1);
    this.selection = next === undefined ? null : { source: 'bag', index: next };
    this.update();
    if (document.activeElement?.hidden && this.screen.contains(document.activeElement)) {
      this._focusTarget().focus({ preventScroll: true });
    }
    // The keys' tooltip follows focus to the card that now has it.
    if (this._keyboard) this._tipAtFocus();
  }

  _select(selection, focus = false) {
    this.selection = selection;
    this.update();
    if (!focus) return;
    this._selectedButton()?.focus();
    this._tipAtFocus();
  }

  _navigate(code) {
    if (this.selection?.source === 'equipment') {
      // Gear is placed around the outlaw. Navigate its visible positions,
      // so arrows follow the same layout at every viewport size.
      const origin = this._selectedButton().getBoundingClientRect();
      const x = origin.left + origin.width / 2;
      const y = origin.top + origin.height / 2;
      let best = null;
      let score = Infinity;
      for (const [slot, { button }] of this.equipmentNodes) {
        if (slot === this.selection.slot) continue;
        const rect = button.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - x;
        const dy = rect.top + rect.height / 2 - y;
        const forward = code === 'ArrowLeft' ? -dx : code === 'ArrowRight' ? dx
          : code === 'ArrowUp' ? -dy : dy;
        if (forward <= 1) continue;
        const across = Math.abs(code === 'ArrowLeft' || code === 'ArrowRight' ? dy : dx);
        const distance = Math.hypot(dx, dy) + across * 2;
        if (distance < score) { score = distance; best = slot; }
      }
      if (best) this._select({ source: 'equipment', slot: best }, true);
      return;
    }
    // The bag walks its shown cards.
    const { visible } = this._view;
    if (!visible.length) return;
    const columns = getComputedStyle(this.cardGrid).gridTemplateColumns.split(/\s+/).length;
    const width = columns > 1 ? columns : 6;
    const length = visible.length;
    const index = Math.max(0, visible.indexOf(this.selection?.index));
    let next;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const column = index % width;
      const rows = Math.floor((length - 1 - column) / width) + 1;
      const row = Math.floor(index / width);
      const direction = code === 'ArrowUp' ? -1 : 1;
      next = ((row + direction + rows) % rows) * width + column;
    } else {
      next = (index + (code === 'ArrowLeft' ? -1 : 1) + length) % length;
    }
    this._select({ source: 'bag', index: visible[next] }, true);
  }

  _selectedItem(selection = this.selection) {
    const stack = selection?.source === 'bag'
      ? this.inventory.slots[selection.index]
      : this.inventory.equipment[selection?.slot];
    return stack && ITEMS[stack.id] ? { stack, item: ITEMS[stack.id] } : null;
  }

  // `pointer` actions keep the selection where it was, so the sheet stays still.
  _activate(options) {
    const selected = this._selectedItem();
    if (!selected) return;
    if (this.selection.source === 'equipment') this._unequip(options);
    else if (selected.item.equipmentSlot) this._equip(options);
    else if (selected.item.use) this._use(options);
  }

  // Into `wanted`, a box its kind fits, else where it goes by itself.
  _equip({ pointer = false, slot: wanted } = {}) {
    const selected = this._selectedItem();
    if (this.selection?.source !== 'bag' || !selected?.item.equipmentSlot) return;
    const slot = this.inventory.targetSlot(selected.item, wanted);
    const equipped = this.inventory.equip(this.selection.index, wanted);
    const refusal = slot === 'quiver' ? 'Your quiver is full.' : 'No room to replace equipped gear.';
    this.onNotify(equipped ? `Equipped ${selected.item.name}.` : refusal, equipped ? 'success' : 'error');
    if (equipped && pointer) this._settle(this.selection.index);
    else if (equipped) this._select({ source: 'equipment', slot }, true);
    else this.update();
  }

  _use({ pointer = false } = {}) {
    const selected = this._selectedItem();
    if (this.selection?.source !== 'bag' || !selected?.item.use) return;
    const used = this.inventory.useItem(this.selection.index, this.player.vitals);
    this.onNotify(used ? `Used ${selected.item.name}.` : 'Your vitality is already full.', used ? 'success' : 'info');
    this._settle(this.selection.index);
    if (!pointer) this._focusTarget().focus();
  }

  // Sets the selected bag stack down at the outlaw's feet.
  _drop() {
    const selected = this._selectedItem();
    if (this.selection?.source !== 'bag' || !selected || !this.onDrop) return;
    const result = this.onDrop(this.selection.index);
    if (result?.message) this.onNotify(result.message, result.ok ? 'success' : 'info');
    this._settle(this.selection.index);
  }

  _unequip({ pointer = false } = {}) {
    const selected = this._selectedItem();
    if (this.selection?.source !== 'equipment' || !selected) return;
    const unequipped = this.inventory.unequip(this.selection.slot);
    this.onNotify(unequipped ? `Unequipped ${selected.item.name}.` : 'Your bag has no room for this gear.', unequipped ? 'success' : 'error');
    const index = this.inventory.slots.findIndex((stack) => stack?.id === selected.item.id);
    if (unequipped && index >= 0 && !pointer) this._select({ source: 'bag', index }, true);
    else this.update();
  }

  update() {
    if (!this._isOpen) return;
    if (!this.feedback.hidden && performance.now() >= this._feedbackUntil) hidden(this.feedback, true);
    // The strip is live every frame, and so is a shown tooltip's key; the
    // rest redraws when its state changes.
    this._updateStats();
    if (this._tip && this._tipKey(this._tip.selection) !== this._tip.key) this._refreshTip();
    // New pictures are made a couple a frame; each batch redraws the boxes.
    if (this.art?.pump()) this._signature = null;
    if (this._state() === this._signature) return;
    // A bag selection is always a shown card: the first when the selected
    // one hid (taken off, swapped, used, dropped or filtered out), none
    // when the tab is empty.
    const view = bagView(this.inventory.slots, this.filter);
    this._view = view;
    this.filter = view.filter;
    if (this.selection?.source !== 'equipment' && !view.visible.includes(this.selection?.index)) {
      this.selection = view.visible.length ? { source: 'bag', index: view.visible[0] } : null;
    }
    this._signature = this._state();
    this._render();
  }

  _state() {
    return JSON.stringify([this.inventory.slots, this.inventory.equipment,
      this.inventory.capacity, this.selection, this.filter, this.phone(), this.describeVersion()]);
  }

  // Writes only the values that changed, and rebuilds the pairs when the
  // set of stats does (mana attached, attributes or the pouch appearing).
  _updateStats() {
    const pairs = sheetStats({ vitals: this.player.vitals, mana: this.manaSource, attributes: this.attributes(),
      weight: this.inventory.weight, capacity: this.inventory.capacity, cents: this.wallet?.cents ?? null });
    const line = pairs.map(({ key, value }) => `${key} ${value}`).join('|');
    if (line === this._statsLine) return;
    this._statsLine = line;
    const keys = pairs.map(({ key }) => key).join(' ');
    if (keys !== this._statKeys) {
      this._statKeys = keys;
      this._statValues = new Map();
      this.statsStrip.replaceChildren(...pairs.map(({ key, label }) => {
        const pair = element('div', 'sheet-stat');
        const value = element('dd');
        pair.append(element('dt', '', label), value);
        this._statValues.set(key, value);
        return pair;
      }));
    }
    for (const { key, value } of pairs) setText(this._statValues.get(key), value);
  }

  // The only place the doll gets its art, for the box `slot` names: the
  // picture's `src` (null while it's made) and the outline shown until then.
  _art(item, slot, stack) { return this._picture(item, stack, shapeOf(DOLL_BOXES[slot]), this._sizes?.get(slot)); }

  // The only place the bag gets its art.
  _cardArt(item, stack) { return this._picture(item, stack, 'card', this._cardSize); }

  _picture(item, stack, shape, size) {
    const art = this.art?.art(stack, item, this.describe(stack), shape, size);
    return { src: art?.src ?? null, text: itemArt(item.id, item.glyph) };
  }

  _render() {
    const view = this._view;
    // Each doll box's picture size inside its 3 px padding, and the cards'
    // inside theirs (a shown card's; null while hidden), read before anything
    // is written, so pictures are drawn at the size they show at.
    const inner = ({ clientWidth: w, clientHeight: h }, bottom) => (h > bottom ? [w - 6, h - bottom] : null);
    this._sizes = new Map([...this.equipmentNodes].map(([slot, { button }]) => [slot, inner(button, 6)]));
    this._cardSize = this.bagNodes.map(({ button }) => inner(button, 15)).find(Boolean) ?? null;
    setText(this.slotCounter, `Bag ${view.used}/${view.total}`);
    const drop = this.onDrop ? ` \u00b7 ${this.phone() ? 'hold' : 'RMB'} \u2014 drop` : '';
    setText(this.bagHint, `${this.phone() ? 'tap' : 'LMB'} \u2014 equip / take off${drop} \u00b7 drag to equip`);
    const counts = new Map(view.tabs.map((tab) => [tab.id, tab.count]));
    for (const [id, { button, count }] of this.filterNodes) {
      const selected = id === view.filter;
      hidden(button, !counts.has(id));
      setText(count, String(counts.get(id) ?? 0));
      attribute(button, 'aria-pressed', String(selected));
      button.classList.toggle('selected', selected);
    }
    setText(this.bagEmpty, view.used ? 'Nothing here.' : 'Your bag is empty.');
    hidden(this.bagEmpty, view.visible.length > 0);

    const shown = new Set(view.visible);
    for (const [index, nodes] of this.bagNodes.entries()) {
      const stack = this.inventory.slots[index];
      const item = stack ? ITEMS[stack.id] : null;
      const own = item ? this.describe(stack) : null;
      const selected = this.selection?.source === 'bag' && this.selection.index === index;
      hidden(nodes.button, !shown.has(index));
      nodes.button.classList.toggle('selected', selected);
      attribute(nodes.button, 'aria-pressed', String(selected));
      attribute(nodes.button, 'aria-label', item
        ? `Slot ${index + 1}: ${own?.name ?? item.name}, count ${stack.count}` : `Slot ${index + 1}: empty`);
      attribute(nodes.button, 'tabindex', selected ? 0 : -1);
      attribute(nodes.button, 'data-item-kind', item ? itemKind(item) : 'empty');
      attribute(nodes.button, 'data-item-id', item?.id || '');
      const art = item ? this._cardArt(item, stack) : { src: null, text: '' };
      setArt(nodes.icon, art.src, art.text);
      setText(nodes.count, item ? cardLabel(stack, item, own) : '');
    }
    for (const [slot, nodes] of this.equipmentNodes.entries()) {
      const stack = this.inventory.equipment[slot];
      const item = stack ? ITEMS[stack.id] : null;
      const selected = this.selection?.source === 'equipment' && this.selection.slot === slot;
      nodes.button.classList.toggle('selected', selected);
      nodes.button.classList.toggle('empty', !item);
      nodes.button.classList.toggle('filled', Boolean(item));
      attribute(nodes.button, 'aria-pressed', String(selected));
      attribute(nodes.button, 'aria-label', `${SLOT_NAMES[slot]}: ${item?.name || 'empty'}`);
      attribute(nodes.button, 'tabindex', selected ? 0 : -1);
      attribute(nodes.button, 'data-item-id', item?.id || '');
      const art = item ? this._art(item, slot, stack) : { src: null, text: '' };
      setArt(nodes.icon, art.src, art.text);
      setText(nodes.count, item && STACK_SLOTS.includes(slot) ? String(stack.count) : '');
    }
  }

  destroy() {
    if (this._isOpen) this.setOpen(false);
    this._unwatch?.();
    window.removeEventListener('keydown', this._keydown, true);
    window.removeEventListener('keyup', this._keyup, true);
    window.removeEventListener('blur', this._blur);
    window.removeEventListener('resize', this._resize);
    this.gestures.destroy();
    this.tooltip.destroy();
    this.screen.remove();
  }
}

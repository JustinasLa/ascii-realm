import { noteReference } from '../audio/instruments.js';
import { EQUIPMENT_SLOTS, ITEMS, STACK_SLOTS } from '../inventory/items.js';
import { itemArt } from './item-art.js';
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

function attribute(node, name, value) {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
}

function hidden(node, value) {
  if (node.hidden !== value) node.hidden = value;
}

function kg(value) {
  return Number(value || 0).toLocaleString('en', { maximumFractionDigits: 2 });
}

function statName(key) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
}

// What an empty slot says. Phones have no keyboard, so they name the button.
export function emptySlotHint(carried, phone = false) {
  if (carried) return 'Drag another item into this slot to move or swap it.';
  return phone ? 'Select compatible gear in your bag, then tap Equip.'
    : 'Select compatible gear in your bag, then press E to equip it.';
}

/** A live inventory panel. Opening it blocks controls, while the world keeps moving. */
export class InventoryScreen {
  // `pages` are more tabs after the bag's: `{ id, label, node, onShow }`,
  // `onShow` running each time the page shows.
  // `isCovered` is true while another panel (a furnace) holds the keys.
  // `describe(stack)` gives a stack's own { name, colour, description, stats }
  // (an alloy ingot's), or null for its item's; `describeVersion()` changes with them.
  // The stats strip reads `wallet.cents` and `attributes()`, the six totals
  // or null; `className` heads the sheet beside the name.
  constructor({ inventory, player, onToggle, onNotify, onDrop, name = 'Kael', className = null, phone = () => false,
    pages = [], isCovered = () => false, describe = () => null, describeVersion = () => 0, wallet = null,
    attributes = () => null }) {
    Object.assign(this, { isCovered, describe, describeVersion, wallet, attributes });
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
    this._statsSignature = null;
    this._dragFrom = null;
    this._consumedKeys = new Set();
    const firstItem = inventory.slots.findIndex((stack) => stack);
    this.selection = { source: 'bag', index: Math.max(0, firstItem) };

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
      const icon = element('pre', 'equipment-slot-icon');
      icon.setAttribute('aria-hidden', 'true');
      const count = element('span', 'equipment-slot-count');
      count.setAttribute('aria-hidden', 'true');
      button.append(label, icon, count);
      button.addEventListener('click', () => this._select({ source: 'equipment', slot }));
      button.addEventListener('dblclick', () => this._unequip());
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

    const bag = element('section', 'inventory-bag');
    const bagHeading = element('div', 'inventory-bag-heading');
    this.slotCounter = element('h3', 'inventory-heading');
    bagHeading.append(this.slotCounter, element('span', 'inventory-bag-hint'));
    bag.append(bagHeading);
    this.bagGrid = element('div', 'inventory-slot-grid');
    this.bagGrid.setAttribute('role', 'group');
    this.bagGrid.setAttribute('aria-label', 'Carried items, 24 slots');
    this.bagNodes = inventory.slots.map((_, index) => {
      const button = element('button', 'inventory-slot');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.slotIndex = String(index);
      const number = element('span', 'inventory-slot-number', String(index + 1).padStart(2, '0'));
      number.setAttribute('aria-hidden', 'true');
      const icon = element('pre', 'inventory-slot-icon');
      icon.setAttribute('aria-hidden', 'true');
      const count = element('span', 'inventory-slot-count');
      count.setAttribute('aria-hidden', 'true');
      button.append(number, icon, count);
      button.addEventListener('click', () => this._select({ source: 'bag', index }));
      button.addEventListener('dblclick', () => this._activate());
      button.addEventListener('dragstart', (event) => {
        if (!this.inventory.slots[index]) {
          event.preventDefault();
          return;
        }
        this._dragFrom = index;
        this._select({ source: 'bag', index });
        event.dataTransfer.setData('application/x-ascii-realm-slot', String(index));
        event.dataTransfer.effectAllowed = 'move';
      });
      button.addEventListener('dragover', (event) => {
        if (this._dragFrom === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      button.addEventListener('drop', (event) => {
        if (this._dragFrom === null) return;
        event.preventDefault();
        const from = this._dragFrom;
        this._dragFrom = null;
        if (this.inventory.move(from, index)) this._select({ source: 'bag', index }, true);
        this.update();
      });
      button.addEventListener('dragend', () => { this._dragFrom = null; });
      this.bagGrid.append(button);
      return { button, icon, count };
    });
    bag.append(this.bagGrid);

    this.details = element('section', 'inventory-details inventory-tooltip');
    this.details.id = 'inventory-item-details';
    this.details.setAttribute('aria-label', 'Selected item details');
    this.details.tabIndex = -1;
    this.itemPreview = element('pre', 'inventory-item-preview');
    this.itemPreview.setAttribute('aria-hidden', 'true');
    const itemInfo = element('div', 'inventory-item-info');
    this.itemType = element('p', 'inventory-item-type');
    this.itemName = element('h3', 'inventory-item-name');
    this.description = element('p', 'inventory-description');
    // The keys an instrument plays; phones play them once there's a keyboard.
    this.notes = element('div', 'inventory-notes');
    this.noteLines = [0, 1, 2].map(() => element('p', 'inventory-description'));
    this.notes.append(...this.noteLines);
    this.stats = element('dl', 'inventory-stats');
    this.itemWeight = element('p', 'inventory-weight');
    this.durability = element('p', 'inventory-durability');
    const actions = element('div', 'inventory-actions');
    this.equipButton = element('button', 'inventory-equip', 'Equip');
    this.equipButton.append(element('kbd', '', 'E'));
    this.useButton = element('button', 'inventory-use', 'Use');
    this.useButton.append(element('kbd', '', 'Enter'));
    this.unequipButton = element('button', 'inventory-unequip', 'Unequip');
    this.unequipButton.append(element('kbd', '', 'U'));
    this.dropButton = element('button', 'inventory-drop', 'Drop');
    this.dropButton.append(element('kbd', '', 'X'));
    for (const button of [this.equipButton, this.useButton, this.unequipButton, this.dropButton]) button.type = 'button';
    this.dropButton.addEventListener('click', () => this._drop());
    this.equipButton.addEventListener('click', () => this._equip());
    this.useButton.addEventListener('click', () => this._use());
    this.unequipButton.addEventListener('click', () => this._unequip());
    actions.append(this.equipButton, this.useButton, this.unequipButton, this.dropButton);
    this.feedback = element('p', 'inventory-feedback');
    this.feedback.setAttribute('role', 'status');
    this.feedback.setAttribute('aria-atomic', 'true');
    this.feedback.hidden = true;
    itemInfo.append(this.itemType, this.itemName, this.description, this.notes, this.stats, this.itemWeight,
      this.durability, actions, this.feedback);
    this.details.append(this.itemPreview, itemInfo);
    const carried = element('div', 'inventory-carried');
    carried.append(bag, this.details);
    body.append(doll, this.statsStrip, carried);

    const help = element('div', 'inventory-help');
    for (const [keys, action] of [['Arrows', 'Navigate'], ['G', 'Switch pane'],
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
    this.screen.addEventListener('pointerdown', (event) => event.stopPropagation());
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
    this._blur = () => this._consumedKeys.clear();
    window.addEventListener('keydown', this._keydown, true);
    window.addEventListener('keyup', this._keyup, true);
    window.addEventListener('blur', this._blur);
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
    this.onToggle(open);
    if (open) {
      this.update();
      // The sheet opens at its top, on the doll, wherever the selection is
      // and however far down it was scrolled when it closed.
      this.screen.scrollTop = 0;
      if (this.page === 'inventory') this._selectedButton()?.focus({ preventScroll: true });
      else this._tab().focus();
    } else {
      this._dragFrom = null;
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
    // Tab closes the inventory; reverse Tab navigates its controls. Keep
    // that focus inside the panel even though the world continues updating.
    if (!modified && event.code === 'Tab' && event.shiftKey) {
      this._consume(event);
      const controls = [...this.screen.querySelectorAll('button')]
        .filter((button) => button.tabIndex >= 0 && !button.disabled && !button.closest('[hidden]'));
      const index = controls.indexOf(document.activeElement);
      controls[index <= 0 ? controls.length - 1 : index - 1]?.focus();
      return;
    }
    // Browser shortcuts retain their defaults while game listeners stay blocked.
    if (modified) {
      event.stopImmediatePropagation();
      return;
    }
    if (event.code === 'Escape') {
      this._consume(event);
      this.setOpen(false);
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
        && !focusedButton.matches('.inventory-slot, .equipment-slot'))) {
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
      if (event.code === 'KeyG') {
        this._select(this.selection.source === 'bag'
          ? { source: 'equipment', slot: EQUIPMENT_SLOTS[0] }
          : { source: 'bag', index: 0 }, true);
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

  _selectedButton() {
    return this.selection.source === 'bag'
      ? this.bagNodes[this.selection.index]?.button
      : this.equipmentNodes.get(this.selection.slot)?.button;
  }

  _select(selection, focus = false) {
    this.selection = selection;
    this.update();
    if (focus) this._selectedButton()?.focus();
  }

  _navigate(code) {
    const bag = this.selection.source === 'bag';
    if (!bag) {
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
    const columns = getComputedStyle(this.bagGrid).gridTemplateColumns.split(/\s+/).length;
    const width = columns > 1 ? columns : 6;
    const length = this.bagNodes.length;
    const index = this.selection.index;
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
    this._select({ source: 'bag', index: next }, true);
  }

  _selectedItem() {
    const stack = this.selection.source === 'bag'
      ? this.inventory.slots[this.selection.index]
      : this.inventory.equipment[this.selection.slot];
    return stack && ITEMS[stack.id] ? { stack, item: ITEMS[stack.id] } : null;
  }

  _activate() {
    const selected = this._selectedItem();
    if (!selected) return;
    if (this.selection.source === 'equipment') this._unequip();
    else if (selected.item.equipmentSlot) this._equip();
    else if (selected.item.use) this._use();
  }

  _equip() {
    const selected = this._selectedItem();
    if (this.selection.source !== 'bag' || !selected?.item.equipmentSlot) return;
    const context = this.details.contains(document.activeElement);
    const slot = this.inventory.targetSlot(selected.item);
    const equipped = this.inventory.equip(this.selection.index);
    const refusal = slot === 'quiver' ? 'Your quiver is full.' : 'No room to replace equipped gear.';
    this.onNotify(equipped ? `Equipped ${selected.item.name}.` : refusal, equipped ? 'success' : 'error');
    if (equipped) this._select({ source: 'equipment', slot }, !context);
    else this.update();
    if (context) this._focusDetails(equipped ? this.unequipButton : this.equipButton);
  }

  _use() {
    const selected = this._selectedItem();
    if (this.selection.source !== 'bag' || !selected?.item.use) return;
    const context = this.details.contains(document.activeElement);
    const used = this.inventory.useItem(this.selection.index, this.player.vitals);
    this.onNotify(used ? `Used ${selected.item.name}.` : 'Your vitality is already full.', used ? 'success' : 'info');
    this.update();
    if (context) this._focusDetails(this.useButton);
    else this._selectedButton()?.focus();
  }

  // Sets one of the selected bag stack down at the outlaw's feet.
  _drop() {
    const selected = this._selectedItem();
    if (this.selection.source !== 'bag' || !selected || !this.onDrop) return;
    const result = this.onDrop(this.selection.index);
    if (result?.message) this.onNotify(result.message, result.ok ? 'success' : 'info');
    this.update();
  }

  _unequip() {
    const selected = this._selectedItem();
    if (this.selection.source !== 'equipment' || !selected) return;
    const context = this.details.contains(document.activeElement);
    const unequipped = this.inventory.unequip(this.selection.slot);
    this.onNotify(unequipped ? `Unequipped ${selected.item.name}.` : 'Your bag has no room for this gear.', unequipped ? 'success' : 'error');
    const index = this.inventory.slots.findIndex((stack) => stack?.id === selected.item.id);
    if (unequipped && index >= 0) this._select({ source: 'bag', index }, !context);
    else this.update();
    if (context) this._focusDetails(unequipped ? this.equipButton : this.unequipButton);
  }

  _focusDetails(button) {
    // A contextual action should keep the item details in view, including
    // when consuming the last item hides or disables its Use button.
    const target = button && !button.hidden && !button.disabled ? button : this.details;
    target.focus({ preventScroll: true });
    this.feedback.scrollIntoView({ block: 'nearest' });
  }

  update() {
    if (!this._isOpen) return;
    if (!this.feedback.hidden && performance.now() >= this._feedbackUntil) hidden(this.feedback, true);
    // The strip is live every frame; the rest redraws when its state changes.
    this._updateStats();
    const vitals = this.player.vitals;
    const signature = JSON.stringify([this.inventory.slots, this.inventory.equipment,
      this.inventory.capacity, this.selection,
      vitals.health >= vitals.maxHealth, vitals.stamina >= vitals.maxStamina, this.phone(), this.describeVersion()]);
    if (signature === this._signature) return;
    this._signature = signature;
    this._render();
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

  // The only place the doll gets its art, for the box `slot` names.
  _art(item, slot) { return itemArt(item.id, item.glyph); }

  _render() {
    const vitals = this.player.vitals;
    const occupied = this.inventory.slots.filter(Boolean).length;
    setText(this.slotCounter, `Bag ${occupied}/${this.bagNodes.length}`);

    for (const [index, nodes] of this.bagNodes.entries()) {
      const stack = this.inventory.slots[index];
      const item = stack ? ITEMS[stack.id] : null;
      const selected = this.selection.source === 'bag' && this.selection.index === index;
      nodes.button.classList.toggle('selected', selected);
      nodes.button.classList.toggle('empty', !item);
      attribute(nodes.button, 'aria-pressed', String(selected));
      attribute(nodes.button, 'aria-label', item
        ? `Slot ${index + 1}: ${this.describe(stack)?.name ?? item.name}, count ${stack.count}` : `Slot ${index + 1}: empty`);
      attribute(nodes.button, 'tabindex', selected ? 0 : -1);
      attribute(nodes.button, 'draggable', Boolean(item));
      attribute(nodes.button, 'data-item-kind', !item ? 'empty'
        : item.equipmentSlot ? 'equipment' : item.use ? 'consumable' : 'material');
      attribute(nodes.button, 'data-item-id', item?.id || '');
      attribute(nodes.button, 'aria-describedby', selected ? this.details.id : null);
      setText(nodes.icon, item ? itemArt(item.id, item.glyph) : '');
      setText(nodes.count, item ? `x${stack.count}` : '');
    }
    for (const [slot, nodes] of this.equipmentNodes.entries()) {
      const stack = this.inventory.equipment[slot];
      const item = stack ? ITEMS[stack.id] : null;
      const selected = this.selection.source === 'equipment' && this.selection.slot === slot;
      nodes.button.classList.toggle('selected', selected);
      nodes.button.classList.toggle('empty', !item);
      nodes.button.classList.toggle('filled', Boolean(item));
      attribute(nodes.button, 'aria-pressed', String(selected));
      attribute(nodes.button, 'aria-label', `${SLOT_NAMES[slot]}: ${item?.name || 'empty'}`);
      // A stopgap tooltip: filled boxes show no text.
      attribute(nodes.button, 'title', item ? this.describe(stack)?.name ?? item.name : null);
      attribute(nodes.button, 'tabindex', selected ? 0 : -1);
      attribute(nodes.button, 'data-item-id', item?.id || '');
      attribute(nodes.button, 'aria-describedby', selected ? this.details.id : null);
      setText(nodes.icon, item ? this._art(item, slot) : '');
      setText(nodes.count, item && STACK_SLOTS.includes(slot) ? String(stack.count) : '');
    }

    const selected = this._selectedItem();
    const item = selected?.item;
    const stack = selected?.stack;
    const carried = this.selection.source === 'bag';
    const own = stack ? this.describe(stack) : null;
    attribute(this.details, 'data-item-id', item?.id || '');
    setText(this.itemPreview, item ? itemArt(item.id, item.glyph) : '');
    hidden(this.itemPreview, !item);
    setText(this.itemType, item ? item.use ? 'Consumable' : item.equipmentSlot ? 'Equipment' : 'Material' : '');
    setText(this.itemName, item ? own?.name ?? item.name : carried ? 'Empty slot' : `${SLOT_NAMES[this.selection.slot]} slot`);
    this.itemName.style.color = own?.colour ?? '';
    setText(this.description, own?.description ?? (item?.description || emptySlotHint(carried, this.phone())));
    const notes = noteReference(item?.id);
    if (notes.length && this.phone()) notes.push('Played with a keyboard for now.');
    for (const [index, line] of this.noteLines.entries()) {
      setText(line, notes[index] ?? '');
      hidden(line, !notes[index]);
    }
    hidden(this.notes, !notes.length);
    const stats = own?.stats ?? item?.stats ?? {};
    const statsSignature = JSON.stringify(stats);
    if (statsSignature !== this._statsSignature) {
      this._statsSignature = statsSignature;
      this.stats.replaceChildren();
      for (const [key, value] of Object.entries(stats)) {
        this.stats.append(element('dt', '', statName(key)), element('dd', '',
          typeof value === 'number' && value > 0 ? `+${value}` : String(value)));
      }
    }
    hidden(this.stats, !item || !Object.keys(stats).length);
    hidden(this.itemWeight, !item);
    setText(this.itemWeight, item
      ? `${kg(item.weight)} kg each / ${kg(item.weight * stack.count)} kg carried / ${stack.count} ${stack.count === 1 ? 'item' : 'items'}` : '');
    // A smithed weapon's own maximum comes from its metal.
    const most = own?.durability ?? item?.durability;
    hidden(this.durability, !most);
    setText(this.durability, most ? `Durability: ${stack.durability ?? most} / ${most}` : '');
    hidden(this.equipButton, !carried || !item?.equipmentSlot);
    hidden(this.useButton, !carried || !item?.use);
    const useDisabled = Boolean(item?.use)
      && (!item.use.health || vitals.health >= vitals.maxHealth)
      && (!item.use.stamina || vitals.stamina >= vitals.maxStamina);
    if (this.useButton.disabled !== useDisabled) this.useButton.disabled = useDisabled;
    attribute(this.useButton, 'title', useDisabled ? 'Your vitality is already full.' : '');
    hidden(this.unequipButton, carried || !item);
    hidden(this.dropButton, !carried || !item || !this.onDrop);
  }

  destroy() {
    if (this._isOpen) this.setOpen(false);
    window.removeEventListener('keydown', this._keydown, true);
    window.removeEventListener('keyup', this._keyup, true);
    window.removeEventListener('blur', this._blur);
    this.screen.remove();
  }
}

import { EQUIPMENT_SLOTS, ITEMS } from '../inventory/items.js';

const SLOT_NAMES = {
  helm: 'Helm',
  chest: 'Chest',
  legs: 'Legs',
  hands: 'Hands',
  cape: 'Cape',
  mainHand: 'Main hand',
  offHand: 'Off hand',
};

const PAPER_DOLL = String.raw`       /---\
       |o o|
     __|_-_|__       /
    / /|===|\ \     /
   |_| |===| |_|===[
       /| |\
      /_| |_\
       /   \
      [_] [_]`;

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

/** A live inventory panel. Opening it blocks controls, while the world keeps moving. */
export class InventoryScreen {
  constructor({ inventory, player, onToggle, onNotify, name = 'Kael' }) {
    this.inventory = inventory;
    this.player = player;
    this.onToggle = onToggle || (() => {});
    this.onNotify = onNotify || (() => {});
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

    this.screen = element('section', 'inventory-screen');
    this.screen.hidden = true;
    this.screen.setAttribute('role', 'dialog');
    this.screen.setAttribute('aria-label', 'Inventory');
    this.screen.setAttribute('aria-modal', 'false');
    this.screen.setAttribute('aria-describedby', 'inventory-help');

    const header = element('header', 'inventory-header');
    const title = element('h2', 'inventory-title', `[ ${String(name)}'S INVENTORY ]`);
    const close = element('button', 'inventory-close', '[ X ]');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close inventory');
    close.addEventListener('click', () => this.setOpen(false));
    header.append(title, close);

    const body = element('div', 'inventory-body');
    const equipment = element('section', 'inventory-equipment');
    equipment.append(element('h3', 'inventory-heading', '+ EQUIPMENT +'));
    const doll = element('pre', 'inventory-paper-doll', PAPER_DOLL);
    doll.setAttribute('aria-hidden', 'true');
    equipment.append(doll);
    this.equipmentGrid = element('div', 'equipment-slots');
    this.equipmentGrid.setAttribute('role', 'group');
    this.equipmentGrid.setAttribute('aria-label', 'Equipped items');
    this.equipmentNodes = new Map();
    for (const slot of EQUIPMENT_SLOTS) {
      const button = element('button', 'equipment-slot');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.equipmentSlot = slot;
      const label = element('span', 'equipment-slot-label', SLOT_NAMES[slot]);
      const icon = element('pre', 'equipment-slot-icon');
      icon.setAttribute('aria-hidden', 'true');
      const itemName = element('span', 'equipment-slot-name');
      button.append(label, icon, itemName);
      button.addEventListener('click', () => this._select({ source: 'equipment', slot }));
      button.addEventListener('dblclick', () => this._unequip());
      this.equipmentNodes.set(slot, { button, icon, itemName });
      this.equipmentGrid.append(button);
    }
    equipment.append(this.equipmentGrid);

    const bag = element('section', 'inventory-bag');
    bag.append(element('h3', 'inventory-heading', '+ CARRIED ITEMS +'));
    this.capacity = element('p', 'inventory-capacity');
    bag.append(this.capacity);
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
        if (this.inventory.move(from, index)) this._select({ source: 'bag', index });
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
    this.itemName = element('h3', 'inventory-item-name');
    this.description = element('p', 'inventory-description');
    this.stats = element('dl', 'inventory-stats');
    this.itemWeight = element('p', 'inventory-weight');
    this.durability = element('p', 'inventory-durability');
    this.assignment = element('p', 'inventory-hotbar-assignment');
    const actions = element('div', 'inventory-actions');
    this.equipButton = element('button', 'inventory-equip', 'Equip [E]');
    this.useButton = element('button', 'inventory-use', 'Use [Enter]');
    this.unequipButton = element('button', 'inventory-unequip', 'Unequip [U]');
    for (const button of [this.equipButton, this.useButton, this.unequipButton]) button.type = 'button';
    this.equipButton.addEventListener('click', () => this._equip());
    this.useButton.addEventListener('click', () => this._use());
    this.unequipButton.addEventListener('click', () => this._unequip());
    actions.append(this.equipButton, this.useButton, this.unequipButton);
    this.details.append(this.itemName, this.description, this.stats, this.itemWeight,
      this.durability, this.assignment, actions);
    body.append(equipment, bag, this.details);

    const help = element('pre', 'inventory-help',
      '[I / Tab / Esc] close\nArrows: select | [G]: bag / gear | [Enter]: equip / use\n[E]: equip | [U]: unequip | [1-9]: assign hotbar\nDouble-click: equip / use | Drag: move / swap slots');
    help.id = 'inventory-help';
    this.screen.append(header, body, help);
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

  setOpen(open) {
    open = Boolean(open);
    if (open === this._isOpen) return;
    if (open) this._previousFocus = document.activeElement;
    this._isOpen = open;
    this.screen.hidden = !open;
    this.onToggle(open);
    if (open) {
      this.update();
      this._selectedButton()?.focus();
    } else {
      this._dragFrom = null;
      // Gameplay handlers ignore UI controls, so closing returns to the scene.
      const canvas = document.getElementById('screen');
      if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
      const target = canvas || this._previousFocus;
      if (target?.isConnected && !this.screen.contains(target)) target.focus({ preventScroll: true });
    }
  }

  toggle() { this.setOpen(!this._isOpen); }

  _consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    this._consumedKeys.add(event.code);
  }

  _handleKeydown(event) {
    if (event.defaultPrevented) return;
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    const editing = event.target?.isContentEditable
      || event.target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if (!this._isOpen && editing) return;
    if (!modified && (event.code === 'KeyI' || event.code === 'Tab' && !event.shiftKey)) {
      this._consume(event);
      if (!event.repeat) this.toggle();
      return;
    }
    if (!this._isOpen) return;
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
    const focusedButton = event.target?.closest?.('button');
    if (focusedButton && this.screen.contains(focusedButton)
      && (event.code === 'Space' || ['Enter', 'NumpadEnter'].includes(event.code)
        && !focusedButton.matches('.inventory-slot, .equipment-slot'))) {
      this._consume(event);
      if (!event.repeat) focusedButton.click();
      return;
    }
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(event.code)) {
      this._consume(event);
      this._navigate(event.code);
      return;
    }
    if (['KeyG', 'KeyE', 'KeyU', 'Enter', 'NumpadEnter'].includes(event.code)) {
      this._consume(event);
      if (event.repeat) return;
      if (event.code === 'KeyG') {
        this._select(this.selection.source === 'bag'
          ? { source: 'equipment', slot: EQUIPMENT_SLOTS[0] }
          : { source: 'bag', index: 0 }, true);
      } else if (event.code === 'KeyE') this._equip();
      else if (event.code === 'KeyU') this._unequip();
      else this._activate();
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
    if (digit) {
      this._consume(event);
      if (!event.repeat && this.selection.source === 'bag') {
        const stack = this.inventory.slots[this.selection.index];
        if (stack && this.inventory.assignHotbar(Number(digit[1]) - 1, stack.id)) {
          this.onNotify(`${ITEMS[stack.id].name} assigned to hotbar ${digit[1]}.`);
          this.update();
        }
      }
      return;
    }
    // No held movement or queued attack may escape from an open inventory.
    event.stopImmediatePropagation();
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyF', 'KeyQ',
      'Equal', 'Minus', 'Backspace'].includes(event.code)) this._consume(event);
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
    const grid = bag ? this.bagGrid : this.equipmentGrid;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length;
    const width = columns > 1 ? columns : bag ? 6 : 2;
    const length = bag ? this.bagNodes.length : EQUIPMENT_SLOTS.length;
    const index = bag ? this.selection.index : EQUIPMENT_SLOTS.indexOf(this.selection.slot);
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -width, ArrowDown: width }[code];
    const next = (index + delta + length) % length;
    this._select(bag ? { source: 'bag', index: next }
      : { source: 'equipment', slot: EQUIPMENT_SLOTS[next] }, true);
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
    const equipped = this.inventory.equip(this.selection.index);
    this.onNotify(equipped ? `Equipped ${selected.item.name}.` : 'No room to replace equipped gear.');
    if (equipped) this._select({ source: 'equipment', slot: selected.item.equipmentSlot }, true);
    else this.update();
  }

  _use() {
    const selected = this._selectedItem();
    if (this.selection.source !== 'bag' || !selected?.item.use) return;
    const used = this.inventory.useItem(this.selection.index, this.player.vitals);
    this.onNotify(used ? `Used ${selected.item.name}.` : 'Your vitality is already full.');
    this.update();
    this._selectedButton()?.focus();
  }

  _unequip() {
    const selected = this._selectedItem();
    if (this.selection.source !== 'equipment' || !selected) return;
    const unequipped = this.inventory.unequip(this.selection.slot);
    this.onNotify(unequipped ? `Unequipped ${selected.item.name}.` : 'Your bag has no room for this gear.');
    const index = this.inventory.slots.findIndex((stack) => stack?.id === selected.item.id);
    if (unequipped && index >= 0) this._select({ source: 'bag', index }, true);
    else this.update();
  }

  update() {
    if (!this._isOpen) return;
    const vitals = this.player.vitals;
    const signature = JSON.stringify([this.inventory.slots, this.inventory.equipment,
      this.inventory.hotbar, this.inventory.capacity, this.selection,
      vitals.health >= vitals.maxHealth, vitals.stamina >= vitals.maxStamina]);
    if (signature === this._signature) return;
    this._signature = signature;
    const occupied = this.inventory.slots.filter(Boolean).length;
    setText(this.capacity,
      `${occupied} / ${this.bagNodes.length} slots | ${kg(this.inventory.weight)} / ${kg(this.inventory.capacity)} kg`);

    for (const [index, nodes] of this.bagNodes.entries()) {
      const stack = this.inventory.slots[index];
      const item = stack ? ITEMS[stack.id] : null;
      const selected = this.selection.source === 'bag' && this.selection.index === index;
      nodes.button.classList.toggle('selected', selected);
      nodes.button.classList.toggle('empty', !item);
      attribute(nodes.button, 'aria-pressed', String(selected));
      attribute(nodes.button, 'aria-label', item
        ? `Slot ${index + 1}: ${item.name}, count ${stack.count}` : `Slot ${index + 1}: empty`);
      attribute(nodes.button, 'tabindex', selected ? 0 : -1);
      attribute(nodes.button, 'draggable', Boolean(item));
      attribute(nodes.button, 'data-item-kind', !item ? 'empty'
        : item.equipmentSlot ? 'equipment' : item.use ? 'consumable' : 'material');
      attribute(nodes.button, 'aria-describedby', selected ? this.details.id : null);
      setText(nodes.icon, item?.glyph || ' . ');
      setText(nodes.count, item ? `x${stack.count}` : '');
    }
    for (const [slot, nodes] of this.equipmentNodes.entries()) {
      const stack = this.inventory.equipment[slot];
      const item = stack ? ITEMS[stack.id] : null;
      const selected = this.selection.source === 'equipment' && this.selection.slot === slot;
      nodes.button.classList.toggle('selected', selected);
      nodes.button.classList.toggle('empty', !item);
      attribute(nodes.button, 'aria-pressed', String(selected));
      attribute(nodes.button, 'aria-label', `${SLOT_NAMES[slot]}: ${item?.name || 'empty'}`);
      attribute(nodes.button, 'tabindex', selected ? 0 : -1);
      attribute(nodes.button, 'aria-describedby', selected ? this.details.id : null);
      setText(nodes.icon, item?.glyph || ' . ');
      setText(nodes.itemName, item?.shortName || (item ? item.name : '[ empty ]'));
    }

    const selected = this._selectedItem();
    const item = selected?.item;
    const stack = selected?.stack;
    const carried = this.selection.source === 'bag';
    setText(this.itemName, item ? `[ ${item.name} ]`
      : carried ? '[ EMPTY SLOT ]' : `[ ${SLOT_NAMES[this.selection.slot].toUpperCase()} - EMPTY ]`);
    setText(this.description, item?.description || (carried
      ? 'Drag another item into this slot to move or swap it.'
      : 'Select compatible gear in your bag, then press E to equip it.'));
    const statsSignature = JSON.stringify(item?.stats || {});
    if (statsSignature !== this._statsSignature) {
      this._statsSignature = statsSignature;
      this.stats.replaceChildren();
      for (const [key, value] of Object.entries(item?.stats || {})) {
        this.stats.append(element('dt', '', statName(key)), element('dd', '',
          typeof value === 'number' && value > 0 ? `+${value}` : String(value)));
      }
    }
    hidden(this.stats, !item || !Object.keys(item.stats || {}).length);
    hidden(this.itemWeight, !item);
    setText(this.itemWeight, item
      ? `Count: ${stack.count} | Weight: ${kg(item.weight)} kg each (${kg(item.weight * stack.count)} kg total)` : '');
    hidden(this.durability, !item?.durability);
    setText(this.durability, item?.durability
      ? `Durability: ${stack.durability ?? item.durability} / ${item.durability}` : '');
    hidden(this.assignment, !item);
    const hotbarSlots = item ? this.inventory.hotbar
      .flatMap((id, index) => id === item.id ? [`[${index + 1}]`] : []) : [];
    setText(this.assignment, item ? `Hotbar: ${hotbarSlots.join(' ') || 'unassigned'}${carried ? ' | Press 1-9 to assign.' : ''}` : '');
    hidden(this.equipButton, !carried || !item?.equipmentSlot);
    hidden(this.useButton, !carried || !item?.use);
    const useDisabled = Boolean(item?.use)
      && (!item.use.health || vitals.health >= vitals.maxHealth)
      && (!item.use.stamina || vitals.stamina >= vitals.maxStamina);
    if (this.useButton.disabled !== useDisabled) this.useButton.disabled = useDisabled;
    attribute(this.useButton, 'title', useDisabled ? 'Your vitality is already full.' : '');
    hidden(this.unequipButton, carried || !item);
  }

  destroy() {
    if (this._isOpen) this.setOpen(false);
    window.removeEventListener('keydown', this._keydown, true);
    window.removeEventListener('keyup', this._keyup, true);
    window.removeEventListener('blur', this._blur);
    this.screen.remove();
  }
}

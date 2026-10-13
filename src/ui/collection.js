import { clearInput, setGameplayBlocked } from '../core/input.js';

const SLOT_COUNT = 24;
const formatWeight = (value) => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A small collection HUD. Inventory owns items; this view only selects slots
// and asks the game to drop them, keeping world placement in one place.
export class CollectionUI {
  constructor(inventory, { onDrop, onMute, isMuted = false } = {}) {
    this.inventory = inventory;
    this.onDrop = onDrop;
    this.onMute = onMute;
    this._muted = typeof isMuted === 'function' ? false : Boolean(isMuted);
    this._readMuted = typeof isMuted === 'function' ? isMuted : () => this._muted;
    this.open = false;
    this.selectedSlot = Math.max(0, inventory.slots.findIndex((stack) => stack?.count > 0));
    this._consumedKeys = new Set();
    this._lastTime = null;
    this._usingGameTime = false;
    this._toastExpiresAt = null;
    this._prompt = '';
    this._disposed = false;

    this.root = element('section', 'collection-ui');
    this.root.id = 'collection-ui';
    this.root.setAttribute('data-game-ui', '');
    this.root.setAttribute('aria-label', 'Collection controls');
    const hud = element('div', 'collection-hud');
    const controls = element('div', 'collection-controls');
    this.bagButton = element('button', 'collection-button collection-bag-button', '[_] BAG [I / Tab]');
    this.bagButton.type = 'button';
    this.bagButton.setAttribute('aria-haspopup', 'dialog');
    this.bagButton.setAttribute('aria-controls', 'collection-bag');
    this.bagButton.setAttribute('aria-expanded', 'false');
    this.muteButton = element('button', 'collection-button collection-mute-button');
    this.muteButton.type = 'button';
    controls.append(this.bagButton, this.muteButton);
    this.summary = element('p', 'collection-summary');
    this.selection = element('p', 'collection-selection');
    hud.append(controls, this.summary, this.selection);

    this.prompt = element('div', 'collection-prompt');
    this.prompt.setAttribute('role', 'status');
    this.prompt.setAttribute('aria-live', 'polite');
    this.prompt.hidden = true;
    this.toastNode = element('div', 'collection-toast');
    this.toastNode.setAttribute('role', 'status');
    this.toastNode.setAttribute('aria-live', 'polite');
    this.toastNode.hidden = true;

    this.shade = element('div', 'collection-shade');
    this.shade.hidden = true;
    this.dialog = element('div', 'collection-bag');
    this.dialog.id = 'collection-bag';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-labelledby', 'collection-bag-title');
    this.dialog.setAttribute('aria-describedby', 'collection-bag-hint');
    const header = element('div', 'collection-bag-header');
    const title = element('h2', '', '[_] COLLECTION');
    title.id = 'collection-bag-title';
    this.closeButton = element('button', 'collection-button', 'CLOSE [Esc]');
    this.closeButton.type = 'button';
    this.closeButton.setAttribute('aria-label', 'Close bag');
    header.append(title, this.closeButton);
    this.bagSummary = element('p', 'collection-bag-summary');
    this.grid = element('div', 'collection-grid');
    this.grid.setAttribute('role', 'group');
    this.grid.setAttribute('aria-label', 'Bag slots. Use arrow keys to select a slot.');
    this.slotButtons = [];
    for (let index = 0; index < SLOT_COUNT; index++) {
      const button = element('button', 'collection-slot');
      button.type = 'button';
      button.addEventListener('click', () => this._select(index, true));
      this.slotButtons.push(button);
      this.grid.append(button);
    }
    this.detail = element('p', 'collection-detail');
    this.description = element('p', 'collection-description');
    const footer = element('div', 'collection-bag-footer');
    this.dropButton = element('button', 'collection-button collection-drop-button', '[Q] DROP ONE');
    this.dropButton.type = 'button';
    const hint = element('p', 'collection-bag-hint', 'Arrows / click: select · Q: drop one · I / Tab / Esc: close');
    hint.id = 'collection-bag-hint';
    footer.append(this.dropButton, hint);
    this.dialog.append(header, this.bagSummary, this.grid, this.detail, this.description, footer);
    this.shade.append(this.dialog);
    this.root.append(hud, this.prompt, this.toastNode, this.shade);
    document.body.append(this.root);

    this.bagButton.addEventListener('click', () => this._setOpen(!this.open));
    this.closeButton.addEventListener('click', () => this._setOpen(false));
    this.dropButton.addEventListener('click', () => this._drop());
    this.muteButton.addEventListener('click', () => this._toggleMute());
    this.shade.addEventListener('click', (event) => {
      if (event.target === this.shade) this._setOpen(false);
    });
    // Scrolling the bag should not also zoom the world behind it.
    this.root.addEventListener('wheel', (event) => event.stopPropagation());
    this._keydown = (event) => this._handleKeyDown(event);
    this._keyup = (event) => this._handleKeyUp(event);
    window.addEventListener('keydown', this._keydown, true);
    window.addEventListener('keyup', this._keyup, true);
    this.update();
  }

  _consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    this._consumedKeys.add(event.code);
  }

  _handleKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const code = event.code;
    if (code === 'KeyI' || code === 'Tab') {
      this._consume(event);
      if (!event.repeat) this._setOpen(!this.open);
      return;
    }
    if (code === 'KeyM') {
      this._consume(event);
      if (!event.repeat) this._toggleMute();
      return;
    }
    const number = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (number) {
      this._consume(event);
      if (!event.repeat) this._select(Number(number[1]) - 1, this.open);
      return;
    }
    if (!this.open) return;
    this._consume(event);
    if (code === 'Escape') this._setOpen(false);
    else if (code === 'KeyQ' && !event.repeat) this._drop();
    else if (code.startsWith('Arrow')) {
      const columns = window.innerWidth <= 560 ? 4 : 6;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[code];
      if (delta !== undefined) this._select(Math.max(0, Math.min(SLOT_COUNT - 1, this.selectedSlot + delta)), true);
    } else if (code === 'Home') this._select(0, true);
    else if (code === 'End') this._select(SLOT_COUNT - 1, true);
    else if ((code === 'Enter' || code === 'Space') && !event.repeat
      && event.target?.tagName === 'BUTTON' && this.dialog.contains(event.target)) {
      event.target.click();
    }
  }

  _handleKeyUp(event) {
    if (!this.open && !this._consumedKeys.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this._consumedKeys.delete(event.code);
  }

  _focusGame() {
    const active = document.activeElement;
    if (active && this.root.contains(active)) active.blur();
    const canvas = document.getElementById('screen');
    if (canvas) {
      if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = -1;
      canvas.focus({ preventScroll: true });
    }
  }

  _setOpen(open) {
    this.open = Boolean(open);
    clearInput();
    setGameplayBlocked(this.open);
    this.shade.hidden = !this.open;
    this.bagButton.setAttribute('aria-expanded', String(this.open));
    this.update();
    if (this.open) this.slotButtons[this.selectedSlot].focus({ preventScroll: true });
    else this._focusGame();
  }

  _select(index, focus = false) {
    this.selectedSlot = index;
    this.update();
    if (focus) this.slotButtons[index].focus({ preventScroll: true });
  }

  _drop() {
    if (!this.inventory.getItem(this.selectedSlot)) return;
    this.onDrop?.(this.selectedSlot);
    this.update();
  }

  _toggleMute() {
    const result = this.onMute?.();
    this._muted = typeof result === 'boolean' ? result : !this._muted;
    this.update();
    if (!this.open) this._focusGame();
  }

  update({ prompt, time } = {}) {
    if (this._disposed) return;
    // The game supplies elapsed seconds; wall time is also useful when this
    // view is used on its own. Toasts adopt whichever clock update provides.
    if (Number.isFinite(time)) {
      if (!this._usingGameTime && this._toastExpiresAt !== null) this._toastExpiresAt += time - this._lastTime;
      this._lastTime = time;
      this._usingGameTime = true;
    } else if (!this._usingGameTime) this._lastTime = performance.now() / 1000;
    if (prompt !== undefined) this._prompt = typeof prompt === 'string' ? prompt : prompt?.text ?? prompt?.label ?? '';
    const selectedIndex = Number.isInteger(this.selectedSlot) ? this.selectedSlot : 0;
    this.selectedSlot = Math.max(0, Math.min(SLOT_COUNT - 1, selectedIndex));
    const stacks = this.inventory.slots.slice(0, SLOT_COUNT);
    const used = stacks.filter((stack) => stack?.count > 0).length;
    const weight = formatWeight(this.inventory.weight);
    const capacity = formatWeight(this.inventory.capacity);
    const signature = `${stacks.map((stack) => stack ? `${stack.id}:${stack.count}` : '').join('|')};${this.selectedSlot};${weight};${capacity}`;
    if (signature !== this._inventorySignature) {
      this._inventorySignature = signature;
      const summary = `${used}/${SLOT_COUNT} stacks · ${weight}/${capacity} kg`;
      this.summary.textContent = summary;
      this.bagSummary.textContent = summary;
      this.bagButton.setAttribute('aria-label', `Open bag. ${used} of ${SLOT_COUNT} slots occupied. Carrying ${weight} of ${capacity} kilograms.`);
      for (let index = 0; index < SLOT_COUNT; index++) {
        const selected = this.inventory.getItem(index);
        const button = this.slotButtons[index];
        button.textContent = selected
          ? `${String(index + 1).padStart(2, '0')} ${selected.item.glyph}\n${selected.item.shortName ?? selected.item.name}\nx${selected.stack.count}`
          : `${String(index + 1).padStart(2, '0')}\n[ . ]\nempty`;
        button.setAttribute('aria-label', selected
          ? `Slot ${index + 1}: ${selected.item.name}, ${selected.stack.count}.`
          : `Slot ${index + 1}: empty.`);
        button.setAttribute('aria-pressed', String(index === this.selectedSlot));
        button.tabIndex = index === this.selectedSlot ? 0 : -1;
      }
      const selected = this.inventory.getItem(this.selectedSlot);
      const label = selected ? `${selected.item.name} x${selected.stack.count}` : 'Empty slot';
      this.selection.textContent = `[${this.selectedSlot + 1}] ${label}${selected ? ' · [Q] drop' : ' · [1-9] select'}`;
      this.detail.textContent = selected
        ? `${label} · ${formatWeight(selected.item.weight)} kg each`
        : `Slot ${this.selectedSlot + 1} is empty. [E] collects nearby items.`;
      this.description.textContent = selected?.item.description ?? '';
      this.dropButton.disabled = !selected;
    }
    const muted = Boolean(this._readMuted());
    if (muted !== this._muteSignature) {
      this._muteSignature = muted;
      this.muteButton.textContent = muted ? '[M] SOUND OFF' : '[M] SOUND ON';
      this.muteButton.setAttribute('aria-label', muted ? 'Unmute pickup sounds' : 'Mute pickup sounds');
      this.muteButton.setAttribute('aria-pressed', String(muted));
    }
    const promptText = this.open ? '' : this._prompt;
    if (promptText !== this._promptSignature) {
      this._promptSignature = promptText;
      this.prompt.textContent = promptText;
      this.prompt.hidden = !promptText;
    }
    if (!this.toastNode.hidden) {
      if (this._toastExpiresAt === null) this._toastExpiresAt = this._lastTime + 3;
      if (this._lastTime >= this._toastExpiresAt) this.toastNode.hidden = true;
    }
  }

  toast(message) {
    if (this._disposed) return;
    this.toastNode.textContent = String(message ?? '');
    this.toastNode.hidden = !message;
    this._toastExpiresAt = this._lastTime === null ? null : this._lastTime + 3;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    window.removeEventListener('keydown', this._keydown, true);
    window.removeEventListener('keyup', this._keyup, true);
    clearInput();
    setGameplayBlocked(false);
    this._focusGame();
    this.root.remove();
  }
}

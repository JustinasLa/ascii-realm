// The corner menu on phones. It turns the existing panel dock into a
// full-screen sheet; style.css decides which panels show inside it, so this
// class does no layout and knows nothing of the dock's contents.

const FOCUSABLE = 'button, summary, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

function visible(node) {
  if (node.disabled) return false;
  return node.checkVisibility?.() ?? node.offsetParent !== null;
}

export class PhoneMenu {
  constructor({ button, dock, closeButton, inventoryButton, outside = [], canvas = null,
    onToggle = () => {}, onInventory = () => {}, phone = { phone: true },
    win = window, doc = document }) {
    Object.assign(this, { button, dock, closeButton, inventoryButton, outside, canvas,
      onToggle, onInventory, phone, doc });
    this._open = false;
    this._role = dock.getAttribute('role');
    this._label = dock.getAttribute('aria-label');
    button.addEventListener('click', () => this.setOpen(!this._open));
    closeButton.addEventListener('click', () => this.setOpen(false));
    inventoryButton.addEventListener('click', () => this.openInventory());
    // Capture on the window so these run ahead of the game's own shortcuts.
    win.addEventListener('keydown', (event) => this.keydown(event), true);
    win.addEventListener('pagehide', () => this.setOpen(false));
  }

  get open() { return this._open; }

  setOpen(open) {
    open = Boolean(open) && this.phone.phone !== false;
    if (open === this._open) return;
    this._open = open;
    this.doc.body.classList.toggle('phone-menu-open', open);
    if (open) {
      this.dock.setAttribute('role', 'dialog');
      this.dock.setAttribute('aria-modal', 'true');
      this.dock.setAttribute('aria-label', 'Menu');
    } else {
      this.dock.setAttribute('role', this._role ?? 'navigation');
      this.dock.removeAttribute('aria-modal');
      this.dock.setAttribute('aria-label', this._label ?? 'Game panels');
    }
    this.button.setAttribute('aria-expanded', String(open));
    for (const node of this.outside) if (node) node.inert = open;
    this.onToggle(open);
    if (open) this.closeButton.focus({ preventScroll: true });
    else this.canvas?.focus({ preventScroll: true });
  }

  // Closing first means the inventory closes back to a clean screen.
  openInventory() {
    this.setOpen(false);
    this.onInventory();
  }

  focusable() {
    return [...this.dock.querySelectorAll(FOCUSABLE)].filter(visible);
  }

  keydown(event) {
    if (!this._open || event.defaultPrevented) return;
    const consume = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (event.code === 'Escape') {
      consume();
      this.setOpen(false);
    } else if (event.code === 'Tab') {
      // Focus wraps inside the sheet; the scene behind it is inert.
      const nodes = this.focusable();
      const first = nodes[0];
      const last = nodes.at(-1);
      const active = this.doc.activeElement;
      if (event.shiftKey ? active === first || !nodes.includes(active) : active === last || !nodes.includes(active)) {
        consume();
        (event.shiftKey ? last : first)?.focus();
      }
    } else if (event.code === 'KeyI' && !event.altKey && !event.ctrlKey && !event.metaKey
      && !event.target?.closest?.('input, textarea, select')) {
      consume();
      if (!event.repeat) this.openInventory();
    }
  }
}

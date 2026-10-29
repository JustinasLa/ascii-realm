import { noteReference } from '../audio/instruments.js';
import { itemKind, materialOf } from './bag-view.js';

const KIND_WORDS = { weapons: 'weapon', armor: 'armor', cloaks: 'cloak', ammo: 'ammo', consumables: 'consumable',
  instruments: 'instrument', materials: 'material' };
// Stats with a line of their own, by their lower-case key.
const OWN_LINES = ['material', 'grip', 'type', 'health', 'stamina', 'durability'];

export function kg(value) {
  return Number(value || 0).toLocaleString('en', { maximumFractionDigits: 2 });
}

// `attackDamage` and `Attack Damage` both read `attack damage`.
export function statName(key) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function statOf(stats, key) {
  return Object.entries(stats).find(([name]) => name.toLowerCase() === key)?.[1];
}

// The lines of an item's tooltip: its name, then white lines, then a dim
// help line. `own` is the stack's own description (an alloy's, a forged
// weapon's), `where` is 'bag' or 'equipment', and phones get no help line,
// because their pinned panel shows buttons instead.
export function tooltipFor({ item, stack, own = null, where = 'bag', phone = false, drop = true }) {
  const stats = own?.stats ?? item.stats ?? {};
  const kind = itemKind(item);
  const grip = statOf(stats, 'grip') ?? statOf(item.stats ?? {}, 'grip');
  const type = statOf(stats, 'type');
  const lines = [`${String(type ?? KIND_WORDS[kind]).toLowerCase()}${grip ? ` · ${String(grip).toLowerCase()}` : ''}`];
  const description = own?.description ?? item.description;
  if (description) lines.push(description);
  const material = materialOf(item, own);
  if (material) lines.push(`material ${material}`);
  for (const [key, value] of Object.entries(stats)) {
    if (OWN_LINES.includes(key.toLowerCase())) continue;
    lines.push(`${statName(key)} ${typeof value === 'number' && value > 0 ? `+${value}` : value}`);
  }
  lines.push(stack.count > 1 ? `weight ${kg(item.weight)} kg each · ${kg(item.weight * stack.count)} kg`
    : `weight ${kg(item.weight)} kg`);
  // A smithed weapon's own maximum comes from its metal.
  const most = own?.durability ?? item.durability;
  if (most) lines.push(`durability ${stack.durability ?? most}/${most}`);
  for (const vital of ['health', 'stamina']) if (item.use?.[vital]) lines.push(`restores ${item.use[vital]} ${vital}`);
  const notes = noteReference(item.id);
  lines.push(...notes);
  if (notes.length && phone) lines.push('Played with a keyboard for now.');
  const dropHelp = drop ? 'right-click — drop' : '';
  const help = phone ? '' : where === 'equipment' ? 'click — take off'
    : item.equipmentSlot ? ['click — equip', dropHelp].filter(Boolean).join(' · ')
      : item.use ? ['click — use', dropHelp].filter(Boolean).join(' · ') : dropHelp;
  return { name: own?.name ?? item.name, colour: own?.colour ?? null, lines, help };
}

function clamp(value, low, high) { return Math.max(low, Math.min(value, high)); }

// Where a w × h tooltip goes for a pointer at (x, y): below right, flipped
// left or up at the viewport's edges, and never off screen.
export function placeTooltip(x, y, w, h, vw, vh, gap = 14, margin = 8) {
  const left = x + gap + w > vw - margin ? x - gap - w : x + gap;
  const top = y + gap + h > vh - margin ? y - gap - h : y + gap;
  return { left: clamp(left, margin, vw - w - margin), top: clamp(top, margin, vh - h - margin) };
}

/** One boxed panel describing an item: beside the pointer, or pinned under a card with buttons on phones. */
export class ItemTooltip {
  constructor(root) {
    const element = (tag, className) => {
      const node = document.createElement(tag);
      node.className = className;
      return node;
    };
    // In the root, not the window: the window is transformed and scrolls,
    // so it would clip a fixed child.
    this.node = element('div', 'item-tooltip');
    this.node.id = 'inventory-item-tooltip';
    this.node.setAttribute('role', 'tooltip');
    this.node.hidden = true;
    this.nameNode = element('strong', 'item-tooltip-name');
    // The lines scroll on a short screen; the buttons stay below them.
    this.body = element('div', 'item-tooltip-body');
    this.body.tabIndex = -1;
    this.lines = element('div', 'item-tooltip-lines');
    this.help = element('p', 'item-tooltip-help');
    this.body.append(this.lines, this.help);
    this.actions = element('div', 'item-tooltip-actions');
    this.actions.hidden = true;
    this.node.append(this.nameNode, this.body, this.actions);
    // Taps on a pinned panel never reach the game.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel']) {
      this.node.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
    }
    this.renders = 0;
    this._key = null;
    root.append(this.node);
  }

  get shown() { return !this.node.hidden; }
  get pinned() { return this.node.classList.contains('pinned'); }

  // Rebuilds the lines only when they change, and measures them once.
  _fill(content) {
    const key = JSON.stringify(content);
    if (key === this._key) return;
    this._key = key;
    this.renders++;
    this.nameNode.textContent = content.name;
    this.nameNode.style.color = content.colour ?? '';
    this.lines.replaceChildren(...content.lines.map((line) => {
      const node = document.createElement('p');
      node.textContent = line;
      return node;
    }));
    this.help.textContent = content.help;
    this.help.hidden = !content.help;
    this._size = null;
  }

  _place(left, top) { this.node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`; }

  _measure() {
    this._size ??= { w: this.node.offsetWidth, h: this.node.offsetHeight };
    return this._size;
  }

  show(content, x, y) {
    if (this.pinned) this._unpin();
    this._fill(content);
    this.node.hidden = false;
    this.move(x, y);
  }

  // One transform write per pointer move, from the cached size.
  move(x, y) {
    const { w, h } = this._measure();
    const { left, top } = placeTooltip(x, y, w, h, innerWidth, innerHeight);
    this._place(left, top);
  }

  // Under the card's rect, above it with no room below, else beside it, with
  // a button per `{ label, run }` action.
  pin(content, rect, actions) {
    this._fill(content);
    this.actions.replaceChildren(...actions.map(({ label, run }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', run);
      return button;
    }));
    this.actions.hidden = false;
    this.node.classList.add('pinned');
    this.node.hidden = false;
    this._size = null;
    const { w, h } = this._measure();
    const margin = 8;
    const below = rect.bottom + 4;
    const above = rect.top - 4 - h;
    let left = rect.left;
    let top = below;
    if (below + h > innerHeight - margin && above >= margin) top = above;
    else if (below + h > innerHeight - margin) {
      top = rect.top;
      left = rect.right + 4 + w <= innerWidth - margin ? rect.right + 4 : rect.left - 4 - w;
    }
    this._place(clamp(left, margin, innerWidth - w - margin), clamp(top, margin, innerHeight - h - margin));
    if (this.body.scrollHeight > this.body.clientHeight) this.body.setAttribute('aria-label', 'More details below');
    else this.body.removeAttribute('aria-label');
  }

  _unpin() {
    this.node.classList.remove('pinned');
    this.actions.replaceChildren();
    this.actions.hidden = true;
    this._size = null;
  }

  hide() {
    if (this.pinned) this._unpin();
    this.node.hidden = true;
  }

  destroy() { this.node.remove(); }
}

import { noteReference } from '../audio/instruments.js';
import { itemKind, materialOf } from './bag-view.js';

const KIND_WORDS = { weapons: 'weapon', armor: 'armor', cloaks: 'cloak', ammo: 'ammo', consumables: 'consumable',
  instruments: 'instrument', materials: 'material' };
// Stats with lines of their own, by their lower-case key.
const OWN_LINES = ['material', 'grip', 'type', 'health', 'stamina', 'durability'];

export const kg = (value) => Number(value || 0).toLocaleString('en', { maximumFractionDigits: 2 });

// `attackDamage` and `Attack Damage` both read `attack damage`.
export const statName = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const statOf = (stats = {}, key) => Object.entries(stats).find(([name]) => name.toLowerCase() === key)?.[1];

// An item's tooltip: its name (`own` is a stack's own description, an
// alloy's or a forged weapon's), white lines, and a dim help line, which
// phones go without, their pinned panel showing buttons instead.
export function tooltipFor({ item, stack, own = null, where = 'bag', phone = false, drop = true }) {
  const stats = own?.stats ?? item.stats ?? {};
  const grip = statOf(stats, 'grip') ?? statOf(item.stats, 'grip');
  const kind = String(statOf(stats, 'type') ?? KIND_WORDS[itemKind(item)]).toLowerCase();
  const lines = [grip ? `${kind} · ${grip.toLowerCase()}` : kind, own?.description ?? item.description];
  const material = materialOf(item, own);
  if (material) lines.push(`material ${material}`);
  for (const [key, value] of Object.entries(stats)) {
    const shown = typeof value === 'number' && value > 0 ? `+${value}` : value;
    if (!OWN_LINES.includes(key.toLowerCase())) lines.push(`${statName(key)} ${shown}`);
  }
  lines.push(`weight ${kg(item.weight)} kg${stack.count > 1 ? ` each · ${kg(item.weight * stack.count)} kg` : ''}`);
  // A smithed weapon's own maximum comes from its metal.
  const most = own?.durability ?? item.durability;
  if (most) lines.push(`durability ${stack.durability ?? most}/${most}`);
  for (const vital of ['health', 'stamina']) if (item.use?.[vital]) lines.push(`restores ${item.use[vital]} ${vital}`);
  const notes = noteReference(item.id);
  lines.push(...notes, ...(notes.length && phone ? ['Played with a keyboard for now.'] : []));
  const click = where === 'equipment' ? 'take off' : item.equipmentSlot ? 'equip' : item.use && 'use';
  const help = [click && `click — ${click}`, where === 'equipment' ? 'drag to the bag' : drop && 'right-click — drop'].filter(Boolean);
  return { name: own?.name ?? item.name, colour: own?.colour ?? null, lines: lines.filter(Boolean),
    help: phone ? '' : help.join(' · ') };
}

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

// Where a w × h tooltip goes for a pointer at (x, y): below right, flipped
// left or up at the viewport's edges, and never off screen.
export function placeTooltip(x, y, w, h, vw, vh, gap = 14, margin = 8) {
  const left = x + gap + w > vw - margin ? x - gap - w : x + gap;
  const top = y + gap + h > vh - margin ? y - gap - h : y + gap;
  return { left: clamp(left, margin, vw - w - margin), top: clamp(top, margin, vh - h - margin) };
}

/** A boxed panel describing an item: beside the pointer, or pinned with buttons after a hold. */
export class ItemTooltip {
  constructor(root) {
    const make = (tag, className, parent) => {
      const node = Object.assign(document.createElement(tag), { className });
      parent.append(node);
      return node;
    };
    // In the root: the window is transformed and scrolls, so it would clip it.
    this.node = make('div', 'item-tooltip', root);
    Object.assign(this.node, { id: 'inventory-item-tooltip', hidden: true });
    this.node.setAttribute('role', 'tooltip');
    this.nameNode = make('strong', 'item-tooltip-name', this.node);
    // The lines scroll on a short screen; the buttons stay below them.
    this.body = make('div', 'item-tooltip-body', this.node);
    this.body.tabIndex = -1;
    this.lines = make('div', 'item-tooltip-lines', this.body);
    this.help = make('p', 'item-tooltip-help', this.body);
    this.actions = make('div', 'item-tooltip-actions', this.node);
    // Taps on a pinned panel never reach the game.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel']) {
      this.node.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
    }
    this.renders = 0;
  }

  get shown() { return !this.node.hidden; }
  get pinned() { return this.node.classList.contains('pinned'); }

  // Rebuilds the lines only when they change, and measures the box once
  // each time it is shown.
  _fill(content, actions = []) {
    this.node.classList.toggle('pinned', actions.length > 0);
    this.actions.replaceChildren(...actions.map(({ label, run }) => {
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
      button.addEventListener('click', run);
      return button;
    }));
    this.node.hidden = false;
    const key = JSON.stringify(content);
    if (key !== this._key) {
      this._key = key;
      this.renders++;
      this.nameNode.textContent = content.name;
      this.nameNode.style.color = content.colour ?? '';
      this.lines.replaceChildren(...content.lines.map((text) => Object.assign(document.createElement('p'), { textContent: text })));
      this.help.textContent = content.help;
      this.help.hidden = !content.help;
    }
    this._size = { w: this.node.offsetWidth, h: this.node.offsetHeight };
  }

  _place(left, top) {
    const x = Math.round(clamp(left, 8, innerWidth - this._size.w - 8));
    this.node.style.transform = `translate(${x}px, ${Math.round(clamp(top, 8, innerHeight - this._size.h - 8))}px)`;
  }

  show(content, x, y) {
    this._fill(content);
    this.move(x, y);
  }

  // One transform write per pointer move, from the measured size.
  move(x, y) {
    const { left, top } = placeTooltip(x, y, this._size.w, this._size.h, innerWidth, innerHeight);
    this._place(left, top);
  }

  // Under the card's rect, above it with no room below, else beside it, with
  // a button per `{ label, run }` action.
  pin(content, rect, actions) {
    this._fill(content, actions);
    const { w, h } = this._size;
    const fits = (top) => top >= 8 && top + h <= innerHeight - 8;
    if (fits(rect.bottom + 4)) this._place(rect.left, rect.bottom + 4);
    else if (fits(rect.top - 4 - h)) this._place(rect.left, rect.top - 4 - h);
    else this._place(rect.right + 4 + w <= innerWidth - 8 ? rect.right + 4 : rect.left - 4 - w, rect.top);
    if (this.body.scrollHeight > this.body.clientHeight) this.body.setAttribute('aria-label', 'More details below');
    else this.body.removeAttribute('aria-label');
  }

  hide() {
    this.node.hidden = true;
    this.node.classList.remove('pinned');
  }

  destroy() { this.node.remove(); }
}

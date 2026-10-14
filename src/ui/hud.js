import { ITEMS } from '../inventory/items.js';
import { itemArt } from './item-art.js';

const MAX_TOASTS = 5;
const TOAST_LIFETIME = 4;
const MAX_DAMAGE = 16;
const DAMAGE_LIFETIME = 1.1;

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function attribute(node, name, value) {
  const next = String(value);
  if (node.getAttribute(name) !== next) node.setAttribute(name, next);
}

function style(node, name, value) {
  if (node.style[name] !== value) node.style[name] = value;
}

function hidden(node, value) {
  if (node.hidden !== value) node.hidden = value;
}

function clamp(value, min, max) {
  return max < min ? (min + max) / 2 : Math.max(min, Math.min(max, value));
}

function number(value) {
  return String(Math.round(value * 10) / 10);
}

// One row of a status frame: a short label, a segmented bar and the value.
function makeVital(label, kind, short) {
  const node = element('div', `hud-vital hud-${kind}`);
  attribute(node, 'role', 'meter');
  attribute(node, 'aria-label', label);
  attribute(node, 'aria-valuemin', 0);
  const caption = element('span', 'hud-vital-label', short);
  const bar = element('span', 'hud-vital-bar');
  attribute(bar, 'aria-hidden', 'true');
  const filled = element('span', 'hud-vital-filled');
  bar.append(filled);
  const value = element('span', 'hud-vital-value');
  node.append(caption, bar, value);
  return { node, bar, filled, value };
}

/** Persistent ASCII controls and short-lived feedback from real game events. */
export class Hud {
  constructor({ player, inventory, name, debug = false, onSelect, onInventory }) {
    this.player = player;
    this.inventory = inventory;
    this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
    this.onInventory = typeof onInventory === 'function' ? onInventory : () => {};
    this.toasts = [];
    this.damageNumbers = [];
    this.destroyed = false;

    this.root = document.getElementById('hud-root');
    if (!this.root) {
      this.root = element('div', '');
      this.root.id = 'hud-root';
      document.body.append(this.root);
    }
    this.canvas = document.getElementById('screen');
    this.element = element('div', 'hud');

    // Status frames stack down the top-left corner: the player's own, then
    // any party members below it.
    this.frames = element('section', 'hud-frames hud-panel');
    attribute(this.frames, 'aria-label', 'Player status');
    const status = element('div', 'hud-frame hud-status');
    this.nameNode = element('div', 'hud-name', String(name || 'Wanderer').slice(0, 24));
    status.append(this.nameNode);
    this.health = makeVital('Health', 'health', 'HP');
    this.load = element('div', 'hud-frame-note');
    status.append(this.health.node, this.load);
    this.party = element('div', 'hud-party');
    this.partyTab = element('div', 'hud-party-tab', 'party');
    this.partyTab.hidden = true;
    this.frames.append(status, this.party, this.partyTab);
    this.status = status;
    const framesNode = this.frames;

    this.element.append(framesNode);

    if (debug) {
      this.coordinates = element('div', 'hud-coordinates');
      attribute(this.coordinates, 'aria-label', 'Debug world coordinates');
      this.element.append(this.coordinates);
    }

    const hotbarWrap = element('div', 'hud-hotbar-wrap');
    const hotbarHeading = element('div', 'hud-hotbar-heading');
    this.selectedItem = element('div', 'hud-selected-item');
    hotbarHeading.append(this.selectedItem, element('span', 'hud-quick-hint', '1–9 select · Q use'));
    const hotbar = element('div', 'hud-hotbar');
    attribute(hotbar, 'role', 'group');
    attribute(hotbar, 'aria-label', 'Quick slots. Use number keys 1 to 9 to select.');
    this.slots = Array.from({ length: 9 }, (_, index) => {
      const button = element('button', 'hud-slot');
      button.type = 'button';
      button.dataset.slot = String(index + 1);
      const key = element('span', 'hud-slot-number', String(index + 1));
      const glyph = element('pre', 'hud-slot-glyph');
      attribute(glyph, 'aria-hidden', 'true');
      const count = element('span', 'hud-slot-count');
      const state = element('span', 'hud-slot-state');
      button.append(key, glyph, count, state);
      button.addEventListener('click', () => this.onSelect(index));
      hotbar.append(button);
      return { button, glyph, count, state, signature: '' };
    });
    const inventoryButton = element('button', 'hud-inventory-button');
    inventoryButton.type = 'button';
    attribute(inventoryButton, 'aria-label', 'Open inventory. Keyboard shortcut I.');
    attribute(inventoryButton, 'aria-haspopup', 'dialog');
    const bag = element('pre', 'hud-inventory-glyph', '  __  \n /==\\ \n|    |\n|____|');
    attribute(bag, 'aria-hidden', 'true');
    inventoryButton.append(bag, element('span', 'hud-inventory-label', 'Inventory'), element('kbd', 'hud-inventory-key', 'I'));
    inventoryButton.addEventListener('click', () => this.onInventory());
    hotbarWrap.append(hotbarHeading, hotbar, inventoryButton);
    this.element.append(hotbarWrap);

    // What E would do here, e.g. "E  Gather 5 berries".
    this.prompt = element('div', 'hud-prompt');
    this.prompt.hidden = true;
    this.element.append(this.prompt);

    this.toastLayer = element('div', 'hud-toasts');
    attribute(this.toastLayer, 'role', 'log');
    attribute(this.toastLayer, 'aria-label', 'Game notifications');
    attribute(this.toastLayer, 'aria-live', 'polite');
    attribute(this.toastLayer, 'aria-relevant', 'additions');
    this.damageLayer = element('div', 'hud-damage-layer');
    attribute(this.damageLayer, 'aria-hidden', 'true');
    // Notifications stack under the status and party frames, never over them.
    this.frames.append(this.toastLayer);
    this.element.append(this.damageLayer);
    this.root.append(this.element);
    this.update(0);
  }

  updateVital(vital, value, maximum) {
    const available = Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0;
    const max = available ? maximum : 1;
    const current = available ? clamp(value, 0, max) : 0;
    const fraction = available ? current / max : 0;
    style(vital.filled, 'width', `${(fraction * 100).toFixed(1)}%`);
    text(vital.value, available ? `${Math.round(current)}/${Math.round(max)}` : '--/--');
    attribute(vital.node, 'aria-valuemax', number(max));
    attribute(vital.node, 'aria-valuenow', number(current));
    attribute(vital.node, 'aria-valuetext', available ? `${number(current)} of ${number(max)}` : 'Unavailable');
  }

  updateHotbar() {
    for (let index = 0; index < this.slots.length; index++) {
      const slot = this.slots[index];
      const entry = this.inventory.getHotbar(index);
      const item = entry?.item;
      const count = item && Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : 0;
      const selected = this.inventory.selectedHotbar === index;
      const equipped = Boolean(item && (entry.equipped || entry.source === 'equipment'));
      const glyph = item ? itemArt(item.id, String(item.glyph || '?').slice(0, 96)) : '';
      const name = item?.name || 'Empty';
      const signature = JSON.stringify([item?.id, name, glyph, count, selected, equipped]);
      if (signature === slot.signature) continue;
      slot.signature = signature;
      slot.button.classList.toggle('empty', !item);
      slot.button.classList.toggle('selected', selected);
      slot.button.classList.toggle('equipped', equipped);
      slot.button.dataset.itemId = item?.id || '';
      text(slot.glyph, glyph);
      text(slot.count, item && count > 1 ? `x${count}` : '');
      text(slot.state, equipped ? '*' : '');
      attribute(slot.button, 'aria-pressed', selected);
      attribute(slot.button, 'aria-label', `Slot ${index + 1}: ${name}${item ? `, count ${count}` : ''}${equipped ? ', equipped' : ''}${selected ? ', selected' : ''}`);
      attribute(slot.button, 'title', `${index + 1}: ${name}${equipped ? ' (equipped)' : ''}`);
    }
    const selected = this.inventory.getHotbar();
    text(this.selectedItem, selected?.item.name || 'Quick slots');
  }

  update(dt, view) {
    if (this.destroyed) return;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const vitals = this.player.vitals || {};
    this.updateVital(this.health, vitals.health, vitals.maxHealth);
    const weight = Number.isFinite(this.inventory.weight) ? this.inventory.weight : 0;
    text(this.load, `Bag ${number(weight)}/${number(this.inventory.capacity ?? 0)} kg`);
    this.updateHotbar();

    if (this.coordinates) {
      const x = Number.isFinite(this.player.x) ? number(this.player.x) : '--';
      const y = Number.isFinite(this.player.y) ? number(this.player.y) : '--';
      text(this.coordinates, `X ${x}  Y ${y}`);
    }

    for (let index = this.toasts.length - 1; index >= 0; index--) {
      const toast = this.toasts[index];
      toast.age += elapsed;
      if (toast.age >= TOAST_LIFETIME) {
        toast.node.remove();
        this.toasts.splice(index, 1);
      } else if (toast.age > TOAST_LIFETIME - 0.35) {
        style(toast.node, 'opacity', String((TOAST_LIFETIME - toast.age) / 0.35));
      }
    }
    this.updateDamage(elapsed, view);
  }

  notify(message, kind = 'pickup') {
    if (this.destroyed || !String(message || '').trim()) return;
    const category = /^[a-z-]+$/.test(kind) ? kind : 'info';
    const node = element('div', 'hud-toast', String(message).trim().slice(0, 160));
    node.dataset.kind = category;
    if (this.toasts.length >= MAX_TOASTS) this.toasts.shift().node.remove();
    this.toastLayer.append(node);
    this.toasts.push({ node, age: 0 });
  }

  damage(amount, x, y) {
    if (this.destroyed || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const node = element('span', 'hud-damage', `-${number(amount)}`);
    node.hidden = true;
    if (this.damageNumbers.length >= MAX_DAMAGE) this.damageNumbers.shift().node.remove();
    this.damageLayer.append(node);
    this.damageNumbers.push({ node, x, y, age: 0 });
  }

  setPrompt(value) {
    const label = String(value || '');
    hidden(this.prompt, !label);
    text(this.prompt, label);
  }

  // Shows another line of player state in the frame, e.g. what is carried.
  attachNote(node) {
    if (!node) return;
    node.classList.add('hud-frame-note');
    this.status.append(node);
  }

  setName(name) {
    text(this.nameNode, String(name || 'Wanderer').slice(0, 24));
  }

  // Party members' frames, below the player's own: [{ name, health, maxHealth,
  // note }]. An empty list hides the party.
  setParty(members) {
    const list = Array.isArray(members) ? members : [];
    const signature = JSON.stringify(list.map((m) => [m.id, m.name]));
    if (signature !== this.partySignature) {
      this.partySignature = signature;
      this.party.replaceChildren();
      this.partyFrames = list.map((member) => {
        const frame = element('div', 'hud-frame hud-member');
        const title = element('div', 'hud-name');
        const health = makeVital(`${member.name} health`, 'health', 'HP');
        frame.append(title, health.node);
        this.party.append(frame);
        return { title, health };
      });
      this.partyTab.hidden = list.length === 0;
    }
    list.forEach((member, index) => {
      const frame = this.partyFrames[index];
      text(frame.title, `${String(member.name || 'Wanderer').slice(0, 24)}${member.note ? ` · ${member.note}` : ''}`);
      this.updateVital(frame.health, member.health, member.maxHealth);
    });
  }

  updateDamage(dt, view) {
    for (let index = this.damageNumbers.length - 1; index >= 0; index--) {
      const damage = this.damageNumbers[index];
      damage.age += dt;
      if (damage.age >= DAMAGE_LIFETIME) {
        damage.node.remove();
        this.damageNumbers.splice(index, 1);
      }
    }
    if (!this.damageNumbers.length) return;
    // Camera offsets and cell dimensions are device pixels, while DOM positions
    // are CSS pixels. Do not infer cell size from the grid's spare row/column.
    if (!this.canvas || !view || !Number.isFinite(view.cellW) || view.cellW <= 0 || !Number.isFinite(view.cellH) || view.cellH <= 0 || !this.canvas.width || !this.canvas.height) {
      for (const damage of this.damageNumbers) hidden(damage.node, true);
      return;
    }
    const canvas = this.canvas.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const scaleX = canvas.width / this.canvas.width;
    const scaleY = canvas.height / this.canvas.height;
    const left = canvas.left - root.left;
    const top = canvas.top - root.top;
    const size = `${canvas.width}/${canvas.height}`;
    for (const damage of this.damageNumbers) {
      const worldX = ((damage.x - view.x0) * view.cellW - view.offX) * scaleX;
      const worldY = ((damage.y - view.y0) * view.cellH - view.offY) * scaleY;
      const visible = worldX >= 0 && worldX <= canvas.width && worldY >= 0 && worldY <= canvas.height;
      hidden(damage.node, !visible);
      if (!visible) continue;
      // Keep complete numerals on-screen even when the hit is at an edge.
      if (damage.size !== size) {
        damage.width = damage.node.offsetWidth || 40;
        damage.height = damage.node.offsetHeight || 20;
        damage.size = size;
      }
      const { width, height } = damage;
      const x = clamp(left + worldX, left + width / 2 + 8, left + canvas.width - width / 2 - 8);
      const y = clamp(top + worldY - 20 - damage.age * 34, top + height + 8, top + canvas.height - 8);
      style(damage.node, 'transform', `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`);
      style(damage.node, 'opacity', String(Math.min(1, (DAMAGE_LIFETIME - damage.age) / 0.3)));
    }
  }

  showEvent(event) {
    if (!event) return;
    if (event.type === 'damage') this.damage(event.amount, event.x, event.y);
    if (event.type === 'pickup') {
      const count = Number.isFinite(event.count) ? Math.max(0, Math.floor(event.count)) : 1;
      if (!count) return;
      const item = ITEMS[event.id];
      const name = item?.name || String(event.id || 'Item').replace(/[-_]/g, ' ');
      this.notify(`Picked up ${count} x ${name}`, 'pickup');
    }
  }

  destroy() {
    this.destroyed = true;
    this.element.remove();
    this.toasts.length = 0;
    this.damageNumbers.length = 0;
  }
}

import { ITEMS } from '../inventory/items.js';
import { denars } from '../inventory/wallet.js';
import { itemArt } from './item-art.js';
import { lootLabels } from './loot-labels.js';

const MAX_TOASTS = 5;
const TOAST_LIFETIME = 4;
const MAX_DAMAGE = 16;
const DAMAGE_LIFETIME = 1.1;
// Seconds the pouch line shows a gain in brighter gold.
const PURSE_GAIN = 1.2;

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
  constructor({ player, inventory, name, onSelect, onInventory, wallet = null }) {
    this.player = player;
    this.inventory = inventory;
    this.wallet = wallet;
    this.purseGain = 0;
    this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
    this.onInventory = typeof onInventory === 'function' ? onInventory : () => {};
    this.toasts = [];
    this.damageNumbers = [];
    // Frames over wounded enemies, by id.
    this.foes = [];
    this.foeFrames = new Map();
    this.lootFrames = new Map();
    this.loot = [];
    this.target = null;
    this.destroyed = false;

    this.root = document.getElementById('hud-root');
    if (!this.root) {
      this.root = element('div', '');
      this.root.id = 'hud-root';
      document.body.append(this.root);
    }
    this.canvas = document.getElementById('screen');
    // The canvas and HUD boxes, read once per screen size: read on every
    // frame, after its first DOM writes, they would force a style pass.
    this.boxes = null;
    this.onResize = () => { this.boxes = null; };
    globalThis.addEventListener?.('resize', this.onResize);
    this.element = element('div', 'hud');

    // Status frames stack down the top-left corner: the player's own, then
    // any party members below it.
    this.frames = element('section', 'hud-frames hud-panel');
    attribute(this.frames, 'aria-label', 'Player status');
    const status = element('div', 'hud-frame hud-status');
    this.nameNode = element('div', 'hud-name', String(name || 'Wanderer').slice(0, 24));
    status.append(this.nameNode);
    this.health = makeVital('Health', 'health', 'HP');
    // Mana appears once a spell caster is attached.
    this.mana = makeVital('Mana', 'mana', 'MP');
    this.mana.node.hidden = true;
    this.manaSource = null;
    this.load = element('div', 'hud-frame-note');
    // The coin in the pouch, e.g. "Pouch 12.40d".
    this.purse = element('div', 'hud-purse');
    this.purseValue = element('span', 'hud-purse-value');
    this.purse.append(element('span', 'hud-purse-label', 'Pouch '), this.purseValue, element('span', 'hud-purse-unit', 'd'));
    this.purse.hidden = !wallet;
    status.append(this.health.node, this.mana.node, this.load, this.purse);
    this.party = element('div', 'hud-party');
    this.partyTab = element('div', 'hud-party-tab', 'party');
    this.partyTab.hidden = true;
    this.frames.append(status, this.party, this.partyTab);
    this.status = status;
    this.element.append(this.frames);

    // The creature last struck, by name and health, in a frame of its own
    // at the top of the screen.
    this.targetFrame = element('section', 'hud-target hud-panel hud-frame');
    attribute(this.targetFrame, 'aria-label', 'Target');
    this.targetFrame.hidden = true;
    const targetHeading = element('div', 'hud-target-heading');
    this.targetName = element('span', 'hud-name hud-target-name');
    this.targetNote = element('span', 'hud-target-note');
    targetHeading.append(this.targetName, this.targetNote);
    this.targetHealth = makeVital('Target health', 'health hud-target-health', 'HP');
    this.targetFrame.append(targetHeading, this.targetHealth.node);
    this.element.append(this.targetFrame);

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

  // `round` turns the current value into the number shown; `label` leads
  // the spoken value.
  updateVital(vital, value, maximum, round = Math.round, label = '') {
    const available = Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0;
    const max = available ? maximum : 1;
    const current = available ? clamp(value, 0, max) : 0;
    const fraction = available ? current / max : 0;
    style(vital.filled, 'width', `${(fraction * 100).toFixed(1)}%`);
    text(vital.value, available ? `${round(current)}/${Math.round(max)}` : '--/--');
    attribute(vital.node, 'aria-valuemax', number(max));
    attribute(vital.node, 'aria-valuenow', number(current));
    attribute(vital.node, 'aria-valuetext', `${label}${available ? `${number(current)} of ${number(max)}` : 'Unavailable'}`);
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
    if (this.manaSource) this.updateVital(this.mana, this.manaSource.mana, this.manaSource.maxMana);
    const weight = Number.isFinite(this.inventory.weight) ? this.inventory.weight : 0;
    text(this.load, `Bag ${number(weight)}/${number(this.inventory.capacity ?? 0)} kg`);
    this.updatePurse(elapsed);
    this.updateHotbar();

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
    this.updateFoes(view);
    this.updateLoot(view);
    this.updateTarget();
  }

  updatePurse(elapsed) {
    if (!this.wallet) return;
    const value = denars(this.wallet.cents);
    text(this.purseValue, value);
    attribute(this.purse, 'aria-label', `Pouch ${value} denars`);
    this.purseGain = Math.max(0, this.purseGain - elapsed);
    this.purse.classList.toggle('gain', this.purseGain > 0);
  }

  // Tells of coin gone into the pouch: a `+0.73d` notice and a brief
  // brighter pouch line.
  earned(cents) {
    if (this.destroyed || !Number.isSafeInteger(cents) || cents <= 0) return;
    this.notify(`+${denars(cents)}d`, 'coin');
    this.purseGain = PURSE_GAIN;
    this.updatePurse(0);
  }

  // The target frame's creature: { name, health, maxHealth, note, slain },
  // or null to hide it.
  setTarget(view) {
    this.target = view || null;
  }

  updateTarget() {
    const view = this.target;
    hidden(this.targetFrame, !view);
    if (!view) return;
    const name = String(view.name || 'Foe').slice(0, 24);
    text(this.targetName, name);
    text(this.targetNote, view.note || '');
    this.targetFrame.classList.toggle('slain', Boolean(view.slain));
    // A foe on its last sliver of health never reads 0 until it falls.
    this.updateVital(this.targetHealth, view.health, view.maxHealth, view.slain ? Math.round : Math.ceil,
      `${name}${view.slain ? ', slain' : ''}, `);
  }

  // Wounded enemies to show a health bar over, in the segmented style of the
  // player's own: [{ id, name, health, maxHealth, x, y }], where (x, y) is
  // the world cell just above the head. Bars of enemies left out are removed.
  setFoes(foes) {
    this.foes = Array.isArray(foes) ? foes : [];
  }

  updateFoes(view) {
    const present = new Set(this.foes.map((foe) => foe.id));
    for (const [id, frame] of this.foeFrames) {
      if (present.has(id)) continue;
      frame.node.remove();
      this.foeFrames.delete(id);
    }
    if (!this.foes.length) return;
    const projection = this.projector(view);
    for (const foe of this.foes) {
      let frame = this.foeFrames.get(foe.id);
      if (!frame) {
        // Just the bar: no frame, name or numbers.
        const node = element('div', 'hud-vital-bar hud-foe');
        attribute(node, 'role', 'meter');
        attribute(node, 'aria-valuemin', 0);
        const filled = element('span', 'hud-vital-filled');
        node.append(filled);
        this.damageLayer.append(node);
        frame = { node, filled };
        this.foeFrames.set(foe.id, frame);
      }
      frame.node.classList.toggle('target', Boolean(foe.target));
      const max = Number.isFinite(foe.maxHealth) && foe.maxHealth > 0 ? foe.maxHealth : 1;
      const current = Number.isFinite(foe.health) ? clamp(foe.health, 0, max) : 0;
      style(frame.filled, 'width', `${(current / max * 100).toFixed(1)}%`);
      attribute(frame.node, 'aria-label', `${String(foe.name || 'Enemy').slice(0, 24)} health`);
      attribute(frame.node, 'aria-valuemax', number(max));
      attribute(frame.node, 'aria-valuenow', number(current));
      const at = projection?.project(foe.x, foe.y);
      hidden(frame.node, !at?.visible);
      if (!at?.visible) continue;
      style(frame.node, 'transform', `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`);
    }
  }

  // The stacks lying on the ground to name, with the player and the bag
  // that would take them.
  setLoot(items, player, inventory) {
    this.loot = Array.isArray(items) ? items : [];
    this.lootPlayer = player;
    this.lootInventory = inventory;
  }

  updateLoot(view) {
    const projection = this.loot.length ? this.projector(view) : null;
    const labels = projection ? lootLabels(this.loot, this.lootPlayer, this.lootInventory, projection.project) : [];
    const present = new Set(labels.map((label) => label.key));
    for (const [key, node] of this.lootFrames) {
      if (present.has(key)) continue;
      node.remove();
      this.lootFrames.delete(key);
    }
    for (const label of labels) {
      let node = this.lootFrames.get(label.key);
      if (!node) {
        node = element('span', 'hud-loot-label');
        this.damageLayer.append(node);
        this.lootFrames.set(label.key, node);
      }
      text(node, label.text);
      node.classList.toggle('full', label.full);
      style(node, 'color', `rgb(${label.colour.join(', ')})`);
      style(node, 'transform', `translate(${label.x.toFixed(1)}px, ${label.y.toFixed(1)}px) translate(-50%, -100%)`);
    }
  }

  // Maps world cells to CSS pixels in the HUD for this frame's view, or
  // null if the view or canvas has no size yet. Camera offsets and cell
  // dimensions are device pixels, while DOM positions are CSS pixels.
  projector(view) {
    if (!this.canvas || !view || !Number.isFinite(view.cellW) || view.cellW <= 0 || !Number.isFinite(view.cellH) || view.cellH <= 0 || !this.canvas.width || !this.canvas.height) {
      return null;
    }
    const { width, height } = this.canvas;
    if (this.boxes?.width !== width || this.boxes.height !== height) {
      this.boxes = { width, height, canvas: this.canvas.getBoundingClientRect(), root: this.root.getBoundingClientRect() };
    }
    const { canvas, root } = this.boxes;
    const scaleX = canvas.width / this.canvas.width;
    const scaleY = canvas.height / this.canvas.height;
    const left = canvas.left - root.left;
    const top = canvas.top - root.top;
    return {
      bounds: { left, top, width: canvas.width, height: canvas.height },
      project(x, y) {
        const worldX = ((x - view.x0) * view.cellW - view.offX) * scaleX;
        const worldY = ((y - view.y0) * view.cellH - view.offY) * scaleY;
        return { x: left + worldX, y: top + worldY,
          visible: worldX >= 0 && worldX <= canvas.width && worldY >= 0 && worldY <= canvas.height };
      },
    };
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

  // Any object with mana and maxMana, such as the spellcasting system.
  attachMana(source) {
    this.manaSource = source || null;
    hidden(this.mana.node, !this.manaSource);
    if (this.manaSource) this.updateVital(this.mana, source.mana, source.maxMana);
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
    const projection = this.projector(view);
    if (!projection) {
      for (const damage of this.damageNumbers) hidden(damage.node, true);
      return;
    }
    const canvas = projection.bounds;
    const { left, top } = canvas;
    const size = `${canvas.width}/${canvas.height}`;
    for (const damage of this.damageNumbers) {
      const at = projection.project(damage.x, damage.y);
      hidden(damage.node, !at.visible);
      if (!at.visible) continue;
      // Keep complete numerals on-screen even when the hit is at an edge.
      if (damage.size !== size) {
        damage.width = damage.node.offsetWidth || 40;
        damage.height = damage.node.offsetHeight || 20;
        damage.size = size;
      }
      const { width, height } = damage;
      const x = clamp(at.x, left + width / 2 + 8, left + canvas.width - width / 2 - 8);
      const y = clamp(at.y - 20 - damage.age * 34, top + height + 8, top + canvas.height - 8);
      style(damage.node, 'transform', `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`);
      style(damage.node, 'opacity', String(Math.min(1, (DAMAGE_LIFETIME - damage.age) / 0.3)));
    }
  }

  showEvent(event) {
    if (!event) return;
    if (event.type === 'damage') this.damage(event.amount, event.x, event.y);
    if (event.type === 'coin') this.earned(event.cents);
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
    globalThis.removeEventListener?.('resize', this.onResize);
    this.element.remove();
    this.toasts.length = 0;
    this.damageNumbers.length = 0;
    this.foeFrames.clear();
    this.lootFrames.clear();
  }
}

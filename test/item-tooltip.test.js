import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ITEMS } from '../src/inventory/items.js';
import { ItemTooltip, kg, placeTooltip, statName, tooltipFor } from '../src/ui/item-tooltip.js';

test('the tooltip names the item, its kind, grip, stats, weight, durability and what it restores', () => {
  assert.deepEqual(tooltipFor({ item: ITEMS.healingDraught, stack: { id: 'healingDraught', count: 3 } }), {
    name: 'Healing Draught', colour: null,
    lines: ['consumable', ITEMS.healingDraught.description, 'weight 0.25 kg each · 0.75 kg', 'restores 35 health'],
    help: 'click — use · right-click — drop',
  });
  const tonic = tooltipFor({ item: ITEMS.staminaTonic, stack: { id: 'staminaTonic', count: 1 }, drop: false });
  assert.equal(tonic.lines.at(-1), 'restores 45 stamina');
  assert.equal(tonic.help, 'click — use', 'no drop without one');
  const sword = tooltipFor({ item: ITEMS.shortSword, stack: { id: 'shortSword', count: 1, durability: 87 }, where: 'equipment' });
  assert.deepEqual(sword.lines, ['weapon · one hand', ITEMS.shortSword.description, 'material Iron', 'weight 1.6 kg',
    'durability 87/100']);
  assert.equal(sword.help, 'click — take off');
  const bow = tooltipFor({ item: ITEMS.longbow, stack: { id: 'longbow', count: 1 }, drop: false });
  assert.equal(bow.help, 'click — equip');
  const ore = tooltipFor({ item: ITEMS.rawIron, stack: { id: 'rawIron', count: 1 } });
  assert.equal(ore.lines[0], 'resource', "an item's own type");
  assert.equal(ore.help, 'right-click — drop');
  assert.equal(tooltipFor({ item: ITEMS.rawIron, stack: { id: 'rawIron', count: 1 }, drop: false }).help, '');
  // A made-up item with no description, stats or durability, and own stats.
  const plain = tooltipFor({ item: { id: 'x', name: 'X', weight: 0 }, stack: { count: 1 },
    own: { stats: { attackSpeed: 2, Penalty: -1, Grip: 'Two hands' } } });
  assert.deepEqual(plain.lines, ['material · two hands', 'attack speed +2', 'penalty -1', 'weight 0 kg']);
  // Phones show buttons, not a help line.
  assert.equal(tooltipFor({ item: ITEMS.longbow, stack: { count: 1 }, phone: true }).help, '');
  assert.equal(kg(undefined), '0');
  assert.equal(statName('Attack Damage'), 'attack damage');
});

test('the tooltip goes below right of the pointer, flips at the edges and stays on screen', () => {
  assert.deepEqual(placeTooltip(100, 100, 200, 80, 1000, 800), { left: 114, top: 114 });
  assert.deepEqual(placeTooltip(900, 750, 200, 80, 1000, 800), { left: 686, top: 656 });
  assert.deepEqual(placeTooltip(150, 60, 280, 400, 320, 300), { left: 8, top: 8 }, 'clamped on a small phone');
});

test('a pinned panel sits under the card, above it, or beside it, and labels lines that scroll', () => {
  const made = [];
  const node = (tag) => {
    const el = { tag, children: [], style: {}, attributes: new Map(), listeners: new Map(), hidden: false, className: '',
      offsetWidth: 100, offsetHeight: 50, scrollHeight: 0, clientHeight: 0,
      classList: { set: new Set(), add(n) { this.set.add(n); }, remove(n) { this.set.delete(n); }, contains(n) { return this.set.has(n); } },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      remove() { this.removed = true; } };
    made.push(el);
    return el;
  };
  const saved = { document: globalThis.document, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  Object.assign(globalThis, { document: { createElement: node }, innerWidth: 400, innerHeight: 300 });
  try {
    const root = node('div');
    const tip = new ItemTooltip(root);
    assert.equal(root.children[0], tip.node);
    const event = { stopPropagation() { this.stopped = true; } };
    tip.node.listeners.get('pointerdown')(event);
    assert.equal(event.stopped, true, 'taps on the panel stay away from the game');
    const content = { name: 'Bow', colour: '#123', lines: ['a', 'b'], help: '' };
    let ran = 0;
    tip.pin(content, { left: 20, top: 40, right: 76, bottom: 152 }, [{ label: 'drop', run: () => ran++ }]);
    assert.equal(tip.node.style.transform, 'translate(20px, 156px)', 'under the card');
    assert.equal(tip.nameNode.style.color, '#123');
    assert.equal(tip.help.hidden, true);
    tip.actions.children[0].listeners.get('click')();
    assert.equal(ran, 1);
    tip.pin(content, { left: 20, top: 200, right: 76, bottom: 260 }, []);
    assert.equal(tip.node.style.transform, 'translate(20px, 146px)', 'above it');
    tip.body.scrollHeight = 90;
    tip.body.clientHeight = 40;
    tip.node.offsetHeight = 280;
    tip.pin({ ...content, name: 'Tall' }, { left: 20, top: 100, right: 76, bottom: 212 }, []);
    assert.equal(tip.node.style.transform, 'translate(80px, 12px)', 'beside it, kept on screen');
    assert.equal(tip.body.attributes.get('aria-label'), 'More details below');
    tip.pin({ ...content, name: 'Tall' }, { left: 300, top: 100, right: 356, bottom: 212 }, []);
    assert.equal(tip.node.style.transform, 'translate(196px, 12px)', 'on its left near the right edge');
    tip.body.scrollHeight = 0;
    tip.pin(content, { left: 300, top: 100, right: 356, bottom: 212 }, []);
    assert.equal(tip.body.attributes.has('aria-label'), false);
    // Showing at a pointer unpins it.
    tip.show(content, 10, 10);
    assert.equal(tip.pinned, false);
    assert.equal(tip.actions.hidden, true);
    tip.hide();
    assert.equal(tip.shown, false);
    tip.destroy();
    assert.equal(tip.node.removed, true);
  } finally {
    Object.assign(globalThis, saved);
  }
});

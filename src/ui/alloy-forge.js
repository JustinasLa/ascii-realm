import { emptyForge, fireForge, forgeScreenModel, loadForge, takeForge } from '../crafting/alloys.js';
import { art, attribute, element, FurnaceScreen, setText } from './furnace.js';

const FORGE = { name: 'forge', title: 'Alloy forge', help: [['Enter', 'Add / press'], ['Arrows', 'Move'], ['Esc', 'Close']] };
// Drawn around a new alloy's name; it fades once.
const BURST = '\\ | /\n- * -\n/ | \\';

export function box(tag, className, ...children) {
  const node = element(tag, className);
  node.append(...children);
  return node;
}
// A coloured alloy name.
export function named(name, colour) {
  const node = element('span', 'forge-alloy-name', name);
  node.style.color = colour ?? '';
  return node;
}

/**
 * The alloy forge's screen: the base and catalyst slots, Fire, Empty and Take,
 * the naming row after a discovery, the satchel's rows and the known alloys.
 */
export class AlloyForgeScreen extends FurnaceScreen {
  constructor(options) {
    super({ onDiscover: () => {}, random: Math.random, ...options }, FORGE);
  }

  _layout() {
    this.slots = Array.from({ length: 5 }, () => {
      const node = box('div', 'forge-slot', element('span', 'forge-slot-art'), element('span', 'forge-slot-caption'));
      [node.art, node.caption] = node.children;
      return node;
    });
    this.status = element('p', 'forge-status');
    this.result = element('p', 'forge-result');
    const button = (className, text, onClick) => Object.assign(this._button(className, onClick), { textContent: text });
    this.fire = button('forge-fire', '', () => this._fire());
    this.emptyButton = button('forge-empty', 'Empty forge', () => this._move(emptyForge));
    this.take = button('forge-take', '', () => this._move((forge, inventory) => takeForge(forge, inventory, this.book)));
    this.nameInput = element('input', 'forge-name', undefined, { type: 'text', maxlength: '24', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: 'false', inputmode: 'text', enterkeyhint: 'done', pattern: '[A-Za-z_]+',
      'aria-label': 'New name: letters and underscores' });
    this.nameInput.addEventListener('focus', () => this.nameInput.scrollIntoView({ block: 'center' }));
    this.renameButton = button('forge-rename', 'Rename', () => this._rename());
    this.keepButton = button('forge-keep', 'Keep name', () => this._notify(this.book.keepName()));
    this.discovered = element('p', 'forge-discovered');
    this.countdown = element('p', 'forge-countdown');
    // A form, so Enter in the field (or a phone keyboard's Done) renames.
    this.naming = box('form', 'forge-naming', element('pre', 'forge-burst', BURST, { 'aria-hidden': 'true' }),
      this.discovered, this.countdown, box('div', 'forge-name-row', this.nameInput, this.renameButton, this.keepButton));
    this.naming.setAttribute('aria-label', 'Name the new alloy');
    this.naming.addEventListener('submit', (event) => {
      event.preventDefault();
      this._rename();
    });
    this.feedback = element('p', 'inventory-feedback', undefined, { role: 'status', 'aria-atomic': 'true' });
    this.feedback.hidden = true;
    this.list = element('div', 'furnace-bag-list', undefined, { role: 'group', 'aria-label': 'Your satchel' });
    this.empty = element('p', 'furnace-empty', 'Nothing in your satchel goes in the forge. Smelt iron and copper '
      + 'ore, or carry Raw Tin and Lapis Lazuli.');
    this.knownTitle = element('h3', 'inventory-heading');
    this.known = element('ul', 'forge-known', undefined, { tabindex: '0', 'aria-label': 'Known alloys' });
    this.knownEmpty = element('p', 'furnace-empty', 'None yet. A new mix has a small chance to make one.');
    return box('div', 'forge-layout',
      box('div', 'forge-main', box('div', 'forge-slots', ...this.slots), this.status, this.result,
        box('div', 'forge-actions', this.fire, this.emptyButton, this.take), this.naming, this.feedback),
      box('div', 'forge-side',
        box('section', 'furnace-satchel', element('h3', 'inventory-heading', 'From your satchel'), this.list, this.empty),
        box('section', 'forge-known-list', this.knownTitle, this.known, this.knownEmpty)));
  }

  _controls() {
    const naming = this.naming.hidden ? [] : [this.nameInput, this.renameButton, this.keepButton];
    return [this.fire, this.emptyButton, this.take, ...naming, ...this.rows, this.known, this.closeButton]
      .filter((node) => !node.hidden);
  }

  _select(id) {
    this.forge = this.book.forge(id);
    return this.forge ? null : "This alloy forge can't be used: too many forges are busy.";
  }

  _put(index) {
    return this.book.saved(this.id, (forge) => loadForge(forge, this.inventory, index));
  }

  _move(move) {
    this._notify(this.book.saved(this.id, (forge) => move(forge, this.inventory)));
  }

  _fire() {
    const done = this.book.saved(this.id, (forge) => fireForge(forge, this.inventory, this.book, this.id, this.random));
    this._notify(done, done.outcome === 'new' ? 'discovery' : undefined);
    if (done.outcome !== 'new') return;
    this.onDiscover(this.id, done.alloy);
    this.nameInput.focus();
    this.nameInput.select();
  }

  _rename() {
    this._notify(this.book.rename(this.nameInput.value));
  }

  // What the book's update said: the naming window running out.
  tell(done) {
    this._notify(done);
  }

  update() {
    if (!this.isOpen) return;
    if (!this.feedback.hidden && performance.now() >= this._feedbackUntil) this.feedback.hidden = true;
    const { bag, known, naming, ...model } = forgeScreenModel(this.forge, this.inventory, this.book);
    const signature = JSON.stringify([model, naming?.id, naming?.name]);
    if (signature !== this._signature) {
      this._signature = signature;
      this._render(model, naming);
    }
    if (naming) setText(this.countdown, `Name it within ${naming.left} s`);
    if (this.book.version !== this._version) {
      this._version = this.book.version;
      this._renderKnown(known);
    }
    const rows = JSON.stringify(bag);
    if (rows !== this._bag) {
      this._bag = rows;
      this._fillBag(bag);
    }
  }

  _render(model, naming) {
    [model.base, ...model.catalysts].forEach((stack, i) => {
      const node = this.slots[i];
      node.classList.toggle('empty', !stack);
      setText(node.art, stack ? art(stack.id) : '');
      setText(node.caption, stack ? stack.name : i ? 'Catalyst' : 'Base');
      attribute(node, 'aria-label', `${i ? `Catalyst ${i}` : 'Base'}: ${stack ? stack.name : 'empty'}`);
    });
    setText(this.status, model.status);
    setText(this.result, model.result ? `Result: ${model.result}` : 'Add a base and a catalyst');
    setText(this.fire, `Fire · 1 Coal (${model.fire.coal})`);
    attribute(this.fire, 'aria-disabled', String(!model.fire.ready));
    attribute(this.emptyButton, 'aria-disabled', String(!model.canEmpty));
    this.take.hidden = !model.output;
    if (model.output) this.take.replaceChildren('Take ', named(model.output.name, model.output.colour));
    this.naming.hidden = !naming;
    if (!naming) return;
    this.discovered.replaceChildren('You discovered ', named(naming.name, `#${this.book.get(naming.id).colour}`), '!');
    if (naming.id !== this._namingId) this.nameInput.value = naming.name.replace(/ /g, '_');
    this._namingId = naming.id;
  }

  _renderKnown(known) {
    setText(this.knownTitle, `Known alloys (${known.length})`);
    this.known.replaceChildren(...known.map((alloy) => {
      const swatch = named('[####]', alloy.colour);
      swatch.setAttribute('aria-hidden', 'true');
      return box('li', 'forge-known-item', swatch, named(alloy.name, alloy.colour),
        element('span', 'forge-known-recipe', alloy.recipe),
        element('span', 'forge-known-stats', alloy.stats.map(([stat, value]) => `${stat} ${value}`).join(' · ')));
    }));
    this.known.hidden = !known.length;
    this.knownEmpty.hidden = known.length > 0;
  }
}

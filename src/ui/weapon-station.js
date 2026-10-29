import { cancelSmithy, chooseRecipe, finishSmithy, HIT_ORDER, hitSmithy, loadSmithy, RECIPES, smithyScreenModel,
  takeSmithy } from '../crafting/smithing.js';
import { box, named } from './alloy-forge.js';
import { art, attribute, element, FurnaceScreen, setText } from './furnace.js';

const STATION = { name: 'smith', title: 'Weapon station',
  help: [['1–6', 'Hit'], ['Enter', 'Add / press'], ['Arrows', 'Move'], ['Esc', 'Close']] };
// Hits closer together than this count once, so a held key or a quick
// double tap doesn't strike twice.
export const HIT_GAP_MS = 100;
// How long a hit's sparks stay over the anvil; under reduced motion the
// anvil only changes colour for that time.
const STRUCK_MS = 150;
const ANVIL = "        \n<=====[]=]\n   )##(\n  /____\\";
const SPARKS = " * .' , \n<=====[]=]\n   )##(\n  /____\\";
// Digit and numpad keys 1–6 hit in the buttons' order.
const KEYS = Object.fromEntries(HIT_ORDER.flatMap((kind, i) => [[`Digit${i + 1}`, kind], [`Numpad${i + 1}`, kind]]));

/**
 * The weapon station's screen: the recipes when it is idle; the piece's
 * metal slots, the six hit buttons (keys 1–6), Finish and Cancel while one
 * is worked; Take while a finished weapon waits; the last finish's report;
 * the satchel's rows. It never shows how many hits a piece needs.
 */
export class WeaponStationScreen extends FurnaceScreen {
  constructor(options) {
    super({ onHit: () => {}, onFinish: () => {}, random: Math.random, reducedMotion: () => false, ...options }, STATION);
    Object.assign(this, { _lastHit: -Infinity, _struckUntil: 0 });
  }

  _layout() {
    const button = (className, text, onClick) => Object.assign(this._button(className, onClick), { textContent: text });
    this.recipeButtons = Object.entries(RECIPES).map(([id, { name, metal }]) => {
      const node = this._button('smith-recipe', () => this._move((s) => chooseRecipe(s, id)));
      node.append(element('span', 'smith-recipe-name', name), element('span', 'smith-recipe-metal', `Metal x${metal}`));
      return node;
    });
    this.recipes = box('div', 'smith-recipes', ...this.recipeButtons);
    this.recipes.setAttribute('aria-label', 'Choose a piece');
    this.recipes.setAttribute('role', 'group');
    this.piece = element('p', 'smith-piece');
    this.slots = element('div', 'smith-slots', undefined, { role: 'list', 'aria-label': 'Metal' });
    this.anvil = element('pre', 'smith-anvil', ANVIL, { 'aria-hidden': 'true' });
    this.hitButtons = HIT_ORDER.map((kind, i) => {
      const node = this._button('smith-hit', () => this._hit(kind));
      node.count = element('span', 'smith-hit-count');
      node.append(element('kbd', '', String(i + 1)), element('span', 'smith-hit-name'), node.count);
      return node;
    });
    this.total = element('p', 'smith-total');
    this.finish = button('smith-finish', 'Finish', () => this._finish());
    this.cancel = button('smith-cancel', 'Cancel project', () => this._move((s) => cancelSmithy(s, this.inventory, this.book)));
    this.take = button('smith-take', '', () => this._move((s) => takeSmithy(s, this.inventory)));
    this.work = box('div', 'smith-work', box('div', 'smith-bench', this.slots, this.anvil),
      box('div', 'smith-hits', ...this.hitButtons), this.total, box('div', 'smith-actions', this.finish, this.cancel));
    this.report = element('div', 'smith-report', undefined, { role: 'status' });
    this.feedback = element('p', 'inventory-feedback', undefined, { role: 'status', 'aria-atomic': 'true' });
    this.feedback.hidden = true;
    this.list = element('div', 'furnace-bag-list', undefined, { role: 'group', 'aria-label': 'Your satchel' });
    this.empty = element('p', 'furnace-empty', 'Nothing in your satchel can be worked. Smelt iron and copper ore, '
      + 'or forge an alloy.');
    return box('div', 'smith-layout',
      box('div', 'smith-main', this.piece, this.report, this.recipes, this.work, this.take, this.feedback),
      box('section', 'furnace-satchel', element('h3', 'inventory-heading', 'From your satchel'), this.list, this.empty));
  }

  _controls() {
    const { idle, recipe, output } = this.smithy;
    return [...(idle ? this.recipeButtons : []), ...(recipe ? [...this.hitButtons, this.finish, this.cancel] : []),
      ...(output ? [this.take] : []), ...this.rows, this.closeButton];
  }

  // The station with this prop id; a new visit starts without a report.
  _select(id) {
    this.smithy = this.book.bench(id);
    this.lines = null;
    return this.smithy ? null : "This weapon station can't be used: too many stations are busy.";
  }

  _put(index) {
    return this.book.savedBench(this.id, (s) => loadSmithy(s, this.inventory, index, this.book));
  }

  _move(move) {
    const done = this.book.savedBench(this.id, move);
    if (done.ok && done.recipe) this.lines = null;
    this._notify(done);
  }

  // One hit, unless it follows the last too closely. A hit's "+1" stays in
  // the feedback line; refusals are told as toasts too.
  _hit(kind) {
    const now = performance.now();
    if (now - this._lastHit < HIT_GAP_MS) return;
    this._lastHit = now;
    const done = this.book.savedBench(this.id, (s) => hitSmithy(s, kind, this.book), { later: true });
    this._notify(done, undefined, done.ok);
    if (!done.ok) return;
    this._struckUntil = now + STRUCK_MS;
    this.anvil.classList.add('struck');
    setText(this.anvil, this.reducedMotion() ? ANVIL : SPARKS);
    this.onHit(this.id, kind);
  }

  _finish() {
    const done = this.book.savedBench(this.id, (s) => finishSmithy(s, this.inventory, this.book, this.random));
    if (done.ok) this.lines = done.lines;
    this._notify(done.ok ? { ...done, message: done.lines.at(-1) } : done);
    if (done.ok) this.onFinish(this.id, done);
  }

  _handleKeydown(event) {
    const kind = KEYS[event.code];
    const hit = kind && this.isOpen && !event.defaultPrevented && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey;
    super._handleKeydown(event);
    if (hit) this._hit(kind);
  }

  update() {
    if (!this.isOpen) return;
    const now = performance.now();
    if (!this.feedback.hidden && now >= this._feedbackUntil) this.feedback.hidden = true;
    if (now >= this._struckUntil && this.anvil.classList.contains('struck')) {
      this.anvil.classList.remove('struck');
      setText(this.anvil, ANVIL);
    }
    const { bag, ...model } = smithyScreenModel(this.smithy, this.inventory, this.book);
    const signature = JSON.stringify([model, this.lines, this.book.version]);
    const rows = JSON.stringify(bag);
    if (signature === this._signature && rows === this._bag) return;
    if (signature !== this._signature) this._render(model);
    if (rows !== this._bag) this._fillBag(bag);
    [this._signature, this._bag] = [signature, rows];
    // A control that just went away (a chosen piece's button, a hit button
    // after Finish) hands focus on, as opening does.
    if (!this._controls().includes(document.activeElement)) (this.rows.find((row) => row.dataset.target) ?? this._controls()[0]).focus();
  }

  _render(model) {
    setText(this.piece, model.recipe ? `${model.recipe.name} · ${model.status}` : model.output
      ? 'A finished weapon waits on the station.' : 'Choose a piece');
    this.recipes.hidden = !model.recipes;
    this.work.hidden = !model.recipe;
    this.slots.replaceChildren(...model.slots.map((slot, i) => {
      const node = box('div', `smith-slot${slot ? '' : ' empty'}`, element('span', 'smith-slot-art', slot
        ? art(/^a\d/.test(slot.unit) ? 'alloyIngot' : slot.unit) : ''), named(slot?.name ?? 'Metal', slot?.colour));
      node.setAttribute('role', 'listitem');
      node.setAttribute('aria-label', `Metal ${i + 1}: ${slot?.name ?? 'empty'}`);
      return node;
    }));
    model.hits.forEach((hit, i) => {
      const node = this.hitButtons[i];
      setText(node.children[1], hit.name);
      setText(node.count, String(hit.done));
      attribute(node, 'aria-disabled', String(!hit.allowed));
      attribute(node, 'aria-label', `${hit.key} ${hit.name}: ${hit.done} done${hit.allowed ? '' : `. ${hit.reason}`}`);
    });
    setText(this.total, `Total ${model.total}`);
    attribute(this.finish, 'aria-disabled', String(!model.canFinish));
    attribute(this.finish, 'aria-label', model.canFinish ? 'Finish' : `Finish. ${model.finishReason}`);
    attribute(this.cancel, 'aria-disabled', String(!model.canCancel));
    this.take.hidden = !model.output;
    if (model.output) this.take.replaceChildren('Take ', named(model.output.name, model.output.colour));
    this.report.hidden = !this.lines;
    this.report.replaceChildren(...(this.lines ?? []).map((line) => element('p', '', line)));
  }
}

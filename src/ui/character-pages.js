// The character menu's pages inside the inventory. The Character page shows
// the active character's sheet and opens Edit; the Characters page lists the
// roster, switches with Play as and starts another with Create character.
// Names go in as text, never markup.

import { createState, rosterRows, sheetRows, waitText } from '../character/menu.js';
import { cleanSkin, skinKey } from '../character/skin.js';
import { CharacterPortrait } from './portrait.js';

export const LOBBY_NOTE = 'You are in a lobby: a new name or character shows to the others when you next join.';

export class CharacterPages {
  // `name()` is the name this visit shows; `inLobby()` whether a lobby is
  // joined. Both are read on every render. `onEdit()`, `onCreate()` and
  // `onPlay(id)` return `{ ok, reason }`; a refusal shows on the page.
  // `equipment()` dresses the portraits.
  constructor({ doc = document, roster, now = () => Date.now(), inLobby = () => false, name = () => null,
    formatDate, formatTime, onEdit = () => ({ ok: true }), onCreate = () => ({ ok: true }), onPlay = () => ({ ok: true }),
    equipment = () => undefined, portrait = (canvas) => new CharacterPortrait(canvas, { columns: 24, rows: 32 }) } = {}) {
    Object.assign(this, { doc, roster, now, inLobby, name, formatDate, formatTime, onEdit, onCreate, onPlay, equipment, portrait });
    this.sheet = this.section('Character');
    this.list = this.section('Characters');
    // Each row's portrait, kept while its skin stays the same.
    this.portraits = new Map();
  }

  section(label) {
    const node = this.element('section', 'character-sheet');
    node.setAttribute('aria-label', label);
    node.status = this.element('p', 'character-status');
    node.status.setAttribute('role', 'status');
    return node;
  }

  button(text, label, onclick) {
    const node = this.element('button', 'character-action', text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', onclick);
    return node;
  }

  // Runs a page action; a refusal is said on the page and nothing changes.
  act(page, run) {
    const result = run();
    if (!result.ok) page.status.textContent = waitText(result, this.now(), this.formatTime);
    return result;
  }

  element(tag, className, text) {
    const node = this.doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  render() {
    const character = this.roster.active;
    const nodes = [];
    if (!character) nodes.push(this.element('p', 'character-empty', 'You have no character yet. Make one on the Characters page.'));
    else {
      const list = this.element('dl', 'character-rows');
      for (const row of sheetRows(character, this.now(), { shown: this.name(), formatDate: this.formatDate })) {
        const value = this.element('dd', '', row.list ? undefined : row.value);
        if (row.label === 'Name') value.setAttribute('dir', 'auto');
        if (row.colour) value.style.color = row.colour;
        if (row.list) {
          const items = this.element(row.label === 'Clues' ? 'ol' : 'ul', 'character-list');
          items.append(...row.list.map((text) => this.element('li', '', text)));
          value.append(items);
        }
        if (row.note) value.append(this.element('span', 'character-lock', row.note));
        list.append(this.element('dt', '', row.label), value);
      }
      this.edit = this.button('Edit', null, () => this.act(this.sheet, this.onEdit));
      nodes.push(list, this.edit);
    }
    if (this.inLobby()) nodes.push(this.element('p', 'character-note', LOBBY_NOTE));
    const error = this.roster.saveError;
    if (error) nodes.push(this.element('p', 'character-note', error));
    this.sheet.status.textContent = '';
    this.sheet.replaceChildren(...nodes, this.sheet.status);
    this.renderList();
  }

  // The roster, most recently played first, each with its portrait.
  renderList() {
    const now = this.now();
    const list = this.element('ul', 'character-roster');
    list.setAttribute('aria-label', 'Your characters');
    const characters = this.roster.characters;
    this.headings = new Map();
    for (const row of rosterRows(this.roster, now)) {
      const item = this.element('li', row.active ? 'active' : '');
      const heading = this.element('h4', '', row.name);
      heading.setAttribute('dir', 'auto');
      heading.tabIndex = -1;
      const text = this.element('div', 'character-roster-text');
      text.append(heading, this.element('p', '', row.line));
      if (row.active) text.append(this.element('p', 'character-playing', 'Playing now'));
      else {
        const play = this.button('Play as', `Play as ${row.name}`, () => this.switchTo(row));
        text.append(play);
        if (!row.play.ok) {
          const why = this.element('p', 'character-lock', waitText(row.play, now, this.formatTime));
          why.id = `character-why-${row.id}`;
          play.setAttribute('aria-disabled', 'true');
          play.setAttribute('aria-describedby', why.id);
          text.append(why);
        }
      }
      item.append(this.drawPortrait(characters.find((character) => character.id === row.id)), text);
      list.append(item);
      this.headings.set(row.id, heading);
    }
    const state = createState(this.roster);
    this.create = this.button('Create character', null, () => this.act(this.list, () => state.ok ? this.onCreate() : state));
    const create = this.element('div', 'character-create');
    create.append(this.create, this.element('p', 'character-lock', state.used));
    if (!state.ok) {
      this.create.setAttribute('aria-disabled', 'true');
      create.append(this.element('p', 'character-lock', waitText(state, now, this.formatTime)));
    }
    this.list.status.textContent = '';
    this.list.replaceChildren(this.element('h3', '', 'Your characters'), list, create, this.list.status);
  }

  drawPortrait(character) {
    const key = skinKey(cleanSkin(character.skin));
    let entry = this.portraits.get(character.id);
    if (!entry) {
      const canvas = this.element('canvas', 'character-portrait');
      canvas.setAttribute('aria-hidden', 'true');
      entry = { canvas, portrait: this.portrait(canvas) };
      this.portraits.set(character.id, entry);
    }
    // The same skin object while the skin is the same, so it isn't redrawn.
    if (entry.key !== key) Object.assign(entry, { key, skin: cleanSkin(character.skin) });
    entry.portrait.update({ equipment: this.equipment(), skin: entry.skin });
    return entry.canvas;
  }

  // Play as: a refusal stays on the page; a switch moves focus to the new
  // active row's name.
  switchTo(row) {
    const result = this.act(this.list, () => row.play.ok ? this.onPlay(row.id) : row.play);
    if (!result.ok) return;
    this.render();
    this.list.status.textContent = `Now playing as ${row.name}.`;
    this.headings.get(row.id).focus();
  }
}

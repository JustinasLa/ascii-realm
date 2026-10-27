// The character menu's pages inside the inventory. The Character page shows
// the active character's sheet, read only. Names go in as text, never markup.

import { sheetRows } from '../character/menu.js';

export const LOBBY_NOTE = 'You are in a lobby: a new name or character shows to the others when you next join.';

export class CharacterPages {
  // `name()` is the name this visit shows; `inLobby()` whether a lobby is
  // joined. Both are read on every render.
  constructor({ doc = document, roster, now = () => Date.now(), inLobby = () => false, name = () => null,
    formatDate } = {}) {
    Object.assign(this, { doc, roster, now, inLobby, name, formatDate });
    this.sheet = this.element('section', 'character-sheet');
    this.sheet.setAttribute('aria-label', 'Character');
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
    if (!character) nodes.push(this.element('p', 'character-empty', 'You have no character yet.'));
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
      nodes.push(list);
    }
    if (this.inLobby()) nodes.push(this.element('p', 'character-note', LOBBY_NOTE));
    const error = this.roster.saveError;
    if (error) nodes.push(this.element('p', 'character-note', error));
    this.sheet.replaceChildren(...nodes);
  }
}

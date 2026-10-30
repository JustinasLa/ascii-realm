// The panel a solo page opens with when its world has a save: Continue or
// New game, and the screens that say why this page can't save
// (`docs/saves.md`). It is the character creator's panel (its classes, and
// its phone sheet and side panel) in the creator's root, and the two are
// never open together. While it is open it owns the keyboard, the rest of
// the page is inert and the world waits behind it.

const FOCUSABLE = 'button, input, textarea';
const DIALOG = Object.freeze({ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'start-title' });
const DECLINE = ['Play without saving', 'decline'];
// Each screen's title, lines and [text, action] buttons, primary last.
const SCREENS = {
  newer: { title: 'A newer save', lines: ['This save was made by a newer version of the game.',
    'Reload to get it. If you play here, nothing is saved.'], buttons: [DECLINE, ['Reload', 'reload']] },
  'other-tab': { title: 'Open in another tab', lines: ['This world is being played in another tab. Close it, then try again.'],
    buttons: [DECLINE, ['Try again', 'retry']] },
  stale: { title: 'Saved in another tab', lines: ['This world was played in another tab while this page was away, so this page stopped saving.',
    'Reload to carry on from that save.'], buttons: [DECLINE, ['Reload', 'reload']] },
};
// What the panel says while main acts on a choice.
const BUSY = { continue: 'Opening your save…', new: 'Starting over…', retry: 'Checking…', reload: 'Reloading…', decline: '' };

// "12 s", "3 min" or "2 h" ago, or the date for a save older than a day.
export function savedAgo(savedAt, now) {
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s >= 86_400) return `on ${new Date(savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  return `${s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`} ago`;
}

// The Continue screen for `info` = `{ who, day, savedAt, hasBody, newerFeatures }`
// (`SaveSession.summary`). A save from a newer build can be played but not
// written over, so it offers no New game.
function welcome({ who, day, savedAt, hasBody, newerFeatures }, now) {
  const when = [day === null ? '' : `day ${day + 1}`, savedAt > 0 ? `saved ${savedAgo(savedAt, now)}` : '']
    .filter(Boolean).join(', ');
  const lines = [hasBody ? `${who}${when ? `: ${when}` : ''}.` : `${who} hasn't set out on this world yet.`];
  if (newerFeatures) lines.push('Carry on where you left off.', 'Parts of this save come from a newer version, so this page won\'t save.');
  else lines.push('Carry on where you left off, or start this world over.');
  return { title: 'Welcome back', lines, buttons: [...newerFeatures ? [] : [['New game', 'ask']], ['Continue', 'continue']] };
}

export class StartChoice {
  // `outside` is made inert while the panel is open. `onChoose(action)` gets
  // 'continue', 'new', 'decline', 'reload' or 'retry'; the panel stays busy
  // until main calls `open`, `fail` or `close`.
  constructor({ root, outside = [], onChoose = () => {}, now = () => Date.now(), win = window, doc = document }) {
    Object.assign(this, { root, outside, onChoose, now, doc, mode: null, asking: null });
    win.addEventListener('keydown', (event) => this.keydown(event), true);
  }

  get isOpen() { return this.mode !== null; }

  // Shows `mode`'s screen: 'continue' (with `info`), 'newer', 'other-tab' or 'stale'.
  open(mode, info = {}) {
    const screen = mode === 'continue' ? welcome(info, this.now()) : SCREENS[mode];
    this.mode = mode;
    this.asking = null;
    this.doc.body.classList.add('creator-open');
    for (const node of this.outside) node.inert = true;
    for (const [key, value] of Object.entries(DIALOG)) this.root.setAttribute(key, value);
    this.message = this.el('p', { className: 'creator-message', role: 'status' });
    this.buttons = screen.buttons.map(([text, action], at, all) => this.el('button',
      at === all.length - 1 ? { type: 'submit', className: 'creator-primary', textContent: text }
        : { type: 'button', textContent: text, onclick: () => this.pick(action) }));
    this.primary = this.buttons.at(-1);
    this.footer = this.el('footer', {}, ...this.buttons);
    const primary = screen.buttons.at(-1)[1];
    this.form = this.el('form', { className: 'creator-panel', onsubmit: (event) => { event.preventDefault(); this.pick(primary); } },
      this.el('header', {}, this.el('h2', { id: 'start-title', textContent: screen.title })),
      this.el('div', { className: 'creator-body' }, ...screen.lines.map((line) => this.el('p', { textContent: line }))),
      this.message, this.footer);
    this.root.replaceChildren(this.form);
    this.primary.focus({ preventScroll: true });
  }

  close() {
    if (!this.mode) return;
    this.mode = null;
    this.asking = null;
    this.root.replaceChildren();
    for (const key of Object.keys(DIALOG)) this.root.removeAttribute(key);
    this.doc.body.classList.remove('creator-open');
    for (const node of this.outside) node.inert = false;
  }

  // Says why the choice didn't go through, and lets the player choose again.
  fail(text) {
    this.busy(false);
    this.message.textContent = text;
    this.message.dataset.state = 'error';
    this.primary.focus({ preventScroll: true });
  }

  busy(on, text = '') {
    for (const button of this.buttons) button.disabled = on;
    this.message.textContent = text;
    delete this.message.dataset.state;
  }

  pick(action) {
    if (action === 'ask') return this.ask();
    if (this.primary.disabled) return;
    this.busy(true, BUSY[action]);
    this.onChoose(action);
  }

  // New game asks first, with Keep my save focused.
  ask() {
    const keep = this.el('button', { type: 'button', textContent: 'Keep my save', onclick: () => this.keep() });
    this.asking = this.el('div', { className: 'creator-discard', role: 'alertdialog', 'aria-labelledby': 'start-ask',
      'aria-describedby': 'start-ask-line' },
    this.el('p', { id: 'start-ask', textContent: 'Start this world over?' }),
    this.el('p', { id: 'start-ask-line', textContent: 'Every character\'s place and bag on this world, and the changes to the land, will be lost. Your characters and pouch stay.' }),
    keep, this.el('button', { type: 'button', textContent: 'Start over', onclick: () => {
      this.keep();
      this.pick('new');
    } }));
    this.footer.replaceWith(this.asking);
    keep.focus({ preventScroll: true });
  }

  keep() {
    this.asking.replaceWith(this.footer);
    this.asking = null;
    this.primary.focus({ preventScroll: true });
  }

  // An element; props the element has are set, the rest are attributes.
  el(tag, props, ...children) {
    const node = this.doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  // Every key stops here while the panel is open, so no game key runs. Esc
  // only leaves New game's question, since a choice has to be made, and Tab
  // wraps inside the panel.
  keydown(event) {
    if (!this.mode) return;
    event.stopImmediatePropagation();
    const nodes = [...this.root.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled);
    const [from, wrap] = event.shiftKey ? [nodes[0], nodes.at(-1)] : [nodes.at(-1), nodes[0]];
    let to = null;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.asking) this.keep();
    } else if (!this.root.contains(event.target)) to = this.asking ? nodes[0] : this.primary;
    else if (event.key === 'Tab' && event.target === from) to = wrap;
    if (!to) return;
    event.preventDefault();
    to.focus({ preventScroll: true });
  }
}

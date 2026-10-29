// A fake DOM with just enough of the browser for the station screens (as the
// inventory panel's test has): reflected attributes, focus, simple selectors
// and element events. `installBrowser(t)` puts it in place for one test.
let currentDocument = null;

function matchesSimple(node, selector) {
  const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attribute) {
    const [, name, value] = attribute;
    if (!node.hasAttribute(name)) return false;
    return value === undefined || node.getAttribute(name) === value;
  }
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

export class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.listeners = new Map();
    this.focusOptions = [];
    this.scrolls = [];
    this.disabled = false;
    this._text = '';
    const tokens = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: (name) => tokens().has(name),
      add: (...names) => { this.className = [...new Set([...tokens(), ...names])].join(' '); },
      remove: (...names) => { this.className = [...tokens()].filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const next = force ?? !tokens().has(name);
        if (next) this.classList.add(name);
        else this.classList.remove(name);
        return next;
      },
    };
    if (this.tagName === 'CANVAS') {
      const context = {
        draws: 0,
        setTransform() {},
        clearRect() {},
        fillText() { this.draws++; },
      };
      this.getContext = (kind) => kind === '2d' ? context : null;
    }
  }

  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) {
    if (value) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }
  get tabIndex() {
    if (this.hasAttribute('tabindex')) return Number(this.getAttribute('tabindex'));
    return this.tagName === 'BUTTON' ? 0 : -1;
  }
  set tabIndex(value) { this.setAttribute('tabindex', value); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    this._text = String(value ?? '');
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === currentDocument?.body;
  }

  append(...nodes) {
    for (const item of nodes) {
      const node = typeof item === 'string' ? Object.assign(new FakeElement('#text'), { _text: item }) : item;
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    if (name === 'class') this.className = String(value);
    else this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    if (name === 'class') return this.className;
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  matches(selector) { return selector.split(',').some((part) => matchesSimple(this, part.trim())); }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }

  focus(options) {
    currentDocument.activeElement = this;
    this.focusOptions.push(options);
  }
  scrollIntoView(options) { this.scrolls.push(options); }
  select() { this.selected = true; }
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 10, height: 10 }; }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, fields = {}) {
    const event = {
      type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...fields,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  click() { return this.dispatch('click'); }
}

// Node's EventTarget ignores a boolean `useCapture` in removeEventListener,
// which browsers honour, so spell it out as an options object.
class FakeWindow extends EventTarget {
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
}

function override(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

export function installBrowser(t, { canvas = true, hud = true } = {}) {
  const body = new FakeElement('body');
  const document = {
    body,
    activeElement: body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      const find = (node) => {
        for (const child of node.children) {
          if (child.id === id) return child;
          const found = find(child);
          if (found) return found;
        }
        return null;
      };
      return find(body);
    },
  };
  if (hud) {
    const hudRoot = new FakeElement('div');
    hudRoot.id = 'hud-root';
    body.append(hudRoot);
  }
  if (canvas) {
    const screen = new FakeElement('canvas');
    screen.id = 'screen';
    body.append(screen);
  }
  const window = new FakeWindow();
  const clock = { now: 1000 };
  const grid = { columns: '50px 50px 50px 50px 50px 50px' };
  currentDocument = document;
  override(t, 'document', document);
  override(t, 'window', window);
  override(t, 'performance', { now: () => clock.now });
  override(t, 'getComputedStyle', () => ({ gridTemplateColumns: grid.columns }));
  t.after(() => { currentDocument = null; });
  return { document, window, clock, grid };
}


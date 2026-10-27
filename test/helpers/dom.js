// The HUD needs only element creation, text, attributes, and direct events.
// Browser integration and layout are checked separately in the real preview.
class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.listeners = new Map();
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
  }

  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    this._text = String(value ?? '');
  }

  // An HTML parser is deliberately outside the scope of this fixture. This
  // also makes accidental HTML interpolation fail instead of hiding it.
  set innerHTML(_) { throw new Error('HUD must create elements and use textContent'); }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
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
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 400 }; }
  focus() { globalThis.document.activeElement = this; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  click() {
    const event = { type: 'click', target: this, currentTarget: this,
      preventDefault() {}, stopPropagation() {} };
    for (const listener of this.listeners.get('click') ?? []) listener(event);
  }
}

export function allElements(root, predicate) {
  return root.children.flatMap((child) => [
    ...(predicate(child) ? [child] : []), ...allElements(child, predicate),
  ]);
}

export const byClass = (root, name) => allElements(root, (element) => element.classList.contains(name));

export function installDocument(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const body = new Element('body');
  const screen = new Element('canvas');
  screen.id = 'screen';
  screen.width = 1600;
  screen.height = 800;
  screen.getBoundingClientRect = () => ({ left: 25, top: 30, width: 800, height: 400 });
  body.append(screen);
  const document = {
    body,
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => allElements(body, (element) => element.id === id)[0] ?? null,
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  return document;
}

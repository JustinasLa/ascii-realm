// Nameplates: each player's name over their head, in their name colour, and
// the tag that tells same-named players apart, "Ash (2)", after it. They are
// text in a layer over the scene, below the speech bubbles, each on an
// opaque dark backdrop: the fog and the darkened screen edges are drawn into
// the scene beneath, so they never wash a name out, and the backdrop is the
// only colour behind its letters (multiplayer/tint.js NAMEPLATE_BACKDROP).
// Each is placed every frame from its player's position, a letter to a cell
// as the scene draws them, and names go in as text, never markup. A plate
// near the screen's edge is held inside it, clear of a notch, and one wider
// than the screen shortens the name, never the tag. A nearer player's plate
// stands over a farther one's, as their speech bubbles do.

// `edge` keeps a plate that many CSS px inside the safe area; the screen is
// read again for `settle` ms after a turn or resize.
export const NAMEPLATES = Object.freeze({ edge: 4, settle: 500 });

const CUT = '…';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// The name as it fits in `room` letters before its tag: whole, or cut short
// with an ellipsis (only the ellipsis when no letter of it fits).
export function fitName(name, tag, room) {
  if (name.length + tag.length <= room) return name;
  return `${name.slice(0, Math.max(0, room - tag.length - CUT.length))}${CUT}`;
}

export class Nameplates {
  constructor({ doc = document, win = doc.defaultView, root, measure = null, insets = null,
    now = () => performance.now() }) {
    Object.assign(this, { doc, win, root, now });
    this.measure = measure ?? (() => this.probe());
    this.insets = insets ?? (() => this.probeInsets());
    this.plates = new Map();
    this.fontSize = '';
    this.advance = 0;
    this.spacing = '';
    this.box = null;
    this.settleUntil = -Infinity;
    // A phone turned from one landscape to the other keeps its size but
    // moves its notch, so the safe area is read again for a moment after any
    // turn or resize, and after the layer itself settles on a new size.
    const unsettle = () => {
      this.box = null;
      this.settleUntil = this.now() + NAMEPLATES.settle;
    };
    win?.addEventListener?.('resize', unsettle);
    win?.addEventListener?.('orientationchange', unsettle);
    if (win?.ResizeObserver && root) new win.ResizeObserver(unsettle).observe(root);
  }

  // How wide a letter of the nameplate font is at the layer's font size.
  probe() {
    const span = this.doc.createElement('span');
    span.className = 'nameplate nameplate-probe';
    span.textContent = 'M'.repeat(20);
    this.root.append(span);
    const { width } = span.getBoundingClientRect();
    span.remove();
    return width / 20;
  }

  // The screen's safe-area insets in CSS px (a notch, rounded corners), from
  // a hidden probe padded by `env(safe-area-inset-*)`.
  probeInsets() {
    const span = this.doc.createElement('span');
    span.className = 'nameplate-safe';
    this.root.append(span);
    const style = this.win.getComputedStyle(span);
    const px = (value) => Number.parseFloat(value) || 0;
    const insets = { left: px(style.paddingLeft), right: px(style.paddingRight) };
    span.remove();
    return insets;
  }

  // The layer's box and the safe area, read once and then on every frame
  // while a turn or resize settles, before the frame's writes.
  layout() {
    if (!this.box || this.now() <= this.settleUntil) {
      const { left, top, width } = this.root.getBoundingClientRect();
      this.box = { left, top, width, safe: this.insets() };
    }
    return this.box;
  }

  get size() { return this.plates.size; }

  // `plates` lists `{ key, x, row, depth, name, tag, colour }`: the column a
  // name centres on, the row it sits on and the row of the player's feet, in
  // world cells, the tag (or null) and the [r, g, b] it shows in.
  // `projection` turns world cells into CSS pixels; without one (the canvas
  // has no size yet) no name shows.
  update(plates, projection) {
    const seen = new Set();
    if (projection && plates.length) {
      const box = this.layout();
      // Letters a cell tall, spaced a cell apart.
      const corner = projection.project(0, 0);
      const fontSize = `${Math.max(1, Math.round((projection.project(0, 1).y - corner.y) * 2) / 2)}px`;
      if (fontSize !== this.fontSize) {
        this.root.style.fontSize = this.fontSize = fontSize;
        this.advance = this.measure();
      }
      const cellW = projection.project(1, 0).x - corner.x;
      const spacing = `${Math.max(0, cellW - this.advance).toFixed(2)}px`;
      if (spacing !== this.spacing) this.root.style.letterSpacing = this.spacing = spacing;
      // A letter takes a cell, or the font's own width if that is wider; the
      // padding is a quarter of the font size on each side.
      const fit = { step: Math.max(cellW, this.advance), pad: Number.parseFloat(fontSize) / 2,
        low: box.safe.left + NAMEPLATES.edge, high: box.width - box.safe.right - NAMEPLATES.edge, box };
      fit.room = Math.max(0, Math.floor((fit.high - fit.low - fit.pad) / fit.step));
      const shown = [];
      for (const plate of plates) {
        seen.add(plate.key);
        const node = this.plate(plate.key);
        if (this.place(node, plate, projection.project(plate.x, plate.row + 0.5), fit)) shown.push({ node, depth: plate.depth });
      }
      // The nearer player (feet lower on the screen) stands on top.
      shown.sort((a, b) => a.depth - b.depth);
      shown.forEach(({ node }, rank) => {
        const z = String(rank + 1);
        if (z !== node.z) node.node.style.zIndex = node.z = z;
      });
    }
    for (const [key, plate] of this.plates) {
      if (seen.has(key)) continue;
      plate.node.remove();
      this.plates.delete(key);
    }
  }

  plate(key) {
    let plate = this.plates.get(key);
    if (!plate) {
      const node = this.doc.createElement('div');
      node.className = 'nameplate';
      const name = this.doc.createElement('span');
      name.className = 'nameplate-name';
      const tag = this.doc.createElement('span');
      tag.className = 'nameplate-tag';
      node.append(name, tag);
      this.root.append(node);
      plate = { node, name, tag, texts: ['', ''], colour: '', transform: '', z: '', hidden: false };
      this.plates.set(key, plate);
    }
    return plate;
  }

  // Only what changed is written, so a still crowd costs no DOM writes.
  // Gives whether the plate shows.
  place(plate, { name, tag, colour }, at, { step, pad, low, high, room, box }) {
    const hidden = !at.visible;
    if (hidden !== plate.hidden) plate.node.hidden = plate.hidden = hidden;
    if (hidden) return false;
    const suffix = tag ? ` (${tag})` : '';
    const texts = [fitName(String(name), suffix, room), suffix];
    for (let i = 0; i < 2; i++) {
      if (texts[i] !== plate.texts[i]) [plate.name, plate.tag][i].textContent = plate.texts[i] = texts[i];
    }
    const rgb = `rgb(${colour.join(', ')})`;
    if (rgb !== plate.colour) plate.node.style.color = plate.colour = rgb;
    // Centred over the player, or as near it as the safe area allows.
    const half = ((texts[0].length + suffix.length) * step + pad) / 2;
    const x = clamp(at.x - box.left, low + half, Math.max(low + half, high - half));
    const transform = `translate(${x.toFixed(1)}px, ${(at.y - box.top).toFixed(1)}px) translate(-50%, -50%)`;
    if (transform !== plate.transform) plate.node.style.transform = plate.transform = transform;
    return true;
  }
}

// Nameplates: each player's name over their head, in their name colour, and
// the tag that tells same-named players apart, "Ash (2)", after it. They are
// text in a layer over the scene, below the speech bubbles, each on an
// opaque dark backdrop: the fog and the darkened screen edges are drawn into
// the scene beneath, so they never wash a name out, and the backdrop is the
// only colour behind its letters (multiplayer/tint.js NAMEPLATE_BACKDROP).
// Each is placed every frame from its player's position, a letter to a cell
// as the scene draws them, and names go in as text, never markup.

export class Nameplates {
  constructor({ doc = document, root, measure = null }) {
    Object.assign(this, { doc, root });
    this.measure = measure ?? (() => this.probe());
    this.plates = new Map();
    this.fontSize = '';
    this.advance = 0;
    this.spacing = '';
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

  get size() { return this.plates.size; }

  // `plates` lists `{ key, x, row, name, tag, colour }`: the column a name
  // centres on and the row it sits on, in world cells, the tag (or null) and
  // the [r, g, b] it shows in. `projection` turns world cells into CSS
  // pixels; without one (the canvas has no size yet) no name shows.
  update(plates, projection) {
    const seen = new Set();
    if (projection) {
      // Letters a cell tall, spaced a cell apart.
      const corner = projection.project(0, 0);
      const fontSize = `${Math.max(1, Math.round((projection.project(0, 1).y - corner.y) * 2) / 2)}px`;
      if (fontSize !== this.fontSize) {
        this.root.style.fontSize = this.fontSize = fontSize;
        this.advance = this.measure();
      }
      const spacing = `${Math.max(0, projection.project(1, 0).x - corner.x - this.advance).toFixed(2)}px`;
      if (spacing !== this.spacing) this.root.style.letterSpacing = this.spacing = spacing;
      for (const plate of plates) {
        seen.add(plate.key);
        this.place(this.plate(plate.key), plate, projection.project(plate.x, plate.row + 0.5));
      }
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
      plate = { node, name, tag, texts: ['', ''], colour: '', transform: '', hidden: false };
      this.plates.set(key, plate);
    }
    return plate;
  }

  // Only what changed is written, so a still crowd costs no DOM writes.
  place(plate, { name, tag, colour }, at) {
    const hidden = !at.visible;
    if (hidden !== plate.hidden) plate.node.hidden = plate.hidden = hidden;
    if (hidden) return;
    const texts = [String(name), tag ? ` (${tag})` : ''];
    for (let i = 0; i < 2; i++) {
      if (texts[i] !== plate.texts[i]) [plate.name, plate.tag][i].textContent = plate.texts[i] = texts[i];
    }
    const rgb = `rgb(${colour.join(', ')})`;
    if (rgb !== plate.colour) plate.node.style.color = plate.colour = rgb;
    const transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
    if (transform !== plate.transform) plate.node.style.transform = plate.transform = transform;
  }
}

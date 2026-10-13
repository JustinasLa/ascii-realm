// Keyboard and touch have separate ownership: releasing one finger must not
// release another finger's action, or a physical key that is still held.
export class InputState {
  constructor() {
    this.held = new Set();
    this.tapped = new Set();
    this.pointers = new Map();
    this.touch = { x: 0, y: 0, running: false };
  }

  keyDown(code, repeat = false) {
    if (!repeat) this.tapped.add(code);
    this.held.add(code);
  }

  keyUp(code) { this.held.delete(code); }

  pressPointer(id, code) {
    this.pointers.set(id, code);
    this.tapped.add(code);
  }

  releasePointer(id) { this.pointers.delete(id); }

  setMove(x, y, running = false) {
    this.touch.x = x;
    this.touch.y = y;
    this.touch.running = running;
  }

  clear() {
    this.held.clear();
    this.tapped.clear();
    this.pointers.clear();
    this.setMove(0, 0);
  }

  wasTapped(...codes) {
    let hit = false;
    for (const code of codes) hit = this.tapped.delete(code) || hit;
    return hit;
  }

  isDown(...codes) {
    for (const code of codes) {
      if (this.held.has(code)) return true;
      if (this.touch.running && (code === 'ShiftLeft' || code === 'ShiftRight')) return true;
      for (const action of this.pointers.values()) if (action === code) return true;
    }
    return false;
  }

  moveAxis() {
    let x = this.touch.x;
    let y = this.touch.y;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    return { x, y };
  }
}

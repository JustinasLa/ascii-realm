export class Camera {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // Eases toward the target; `stiffness` is roughly how many times per second
  // the remaining distance halves.
  follow(tx, ty, dt, stiffness = 6) {
    const k = 1 - Math.exp(-stiffness * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  // Works out which world cell lands in the top-left grid slot and how far
  // (in device px) the grid must be scrolled to place the camera centre
  // exactly in the middle of the screen.
  view(renderer) {
    const halfW = renderer.canvas.width / renderer.cellW / 2;
    const halfH = renderer.canvas.height / renderer.cellH / 2;
    const left = this.x - halfW;
    const top = this.y - halfH;
    const x0 = Math.floor(left);
    const y0 = Math.floor(top);
    return {
      x0,
      y0,
      offX: (left - x0) * renderer.cellW,
      offY: (top - y0) * renderer.cellH,
      cols: renderer.cols,
      rows: renderer.rows,
    };
  }
}

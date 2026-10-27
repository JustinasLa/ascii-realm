export class Camera {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.quake = 0;
    this.time = 0;
    // How far below the screen centre the target sits, as a fraction of the
    // view height. Applied when the view is built, so a change shows at once.
    this.bias = 0;
    // How far right of the screen centre it sits, as a fraction of the width.
    this.biasX = 0;
  }

  // Jolts the view, e.g. when a heavy blow lands; `amount` is in rows.
  shake(amount) {
    this.quake = Math.max(this.quake, amount);
  }

  // Eases toward the target; `stiffness` is roughly how many times per second
  // the remaining distance halves.
  follow(tx, ty, dt, stiffness = 6) {
    this.time += dt;
    this.quake *= Math.exp(-9 * dt);
    const k = 1 - Math.exp(-stiffness * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  // Works out which world cell lands in the top-left grid slot and how far
  // (in device px) the grid must be scrolled to place the camera target
  // exactly in the middle of the screen, or `bias` of the height below it
  // and `biasX` of the width right of it.
  view(renderer) {
    const halfW = renderer.canvas.width / renderer.cellW / 2;
    const halfH = renderer.canvas.height / renderer.cellH / 2;
    // A fast, decaying wobble while the view is shaken.
    const jx = (Math.sin(this.time * 71) * this.quake) / 0.6;
    const jy = Math.sin(this.time * 53 + 1) * this.quake;
    const left = this.x + jx - halfW * (1 + 2 * this.biasX);
    const top = this.y + jy - halfH * (1 + 2 * this.bias);
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

  // The world row at the middle of the screen, which `bias` moves above the
  // target.
  centreY(view) {
    return this.y - this.bias * view.rows;
  }
}

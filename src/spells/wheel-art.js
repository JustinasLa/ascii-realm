// The rune wheel drawn as a character grid, like the world: its rims and
// spokes are line characters, and the hub and sectors are blank cells the
// labels write into. Cells are cw by lh pixels, centred on the wheel;
// distances are in the wheel's own units.

// The character for a line passing near a cell centre. g is the centre's
// signed distance from the line and (nx, ny) the line's unit normal, y down.
// Shallow lines pick _ . - ' by where they cross the cell, the way hand-drawn
// ASCII circles do; steep ones step down in | and slanted ones in / or \.
// Returns '' when the line misses the cell.
export function stroke(g, nx, ny, cw, lh) {
  // Rows the line climbs per column it crosses.
  const climb = (Math.abs(nx) / lh) / Math.max(1e-9, Math.abs(ny) / cw);
  if (climb < 0.7) {
    if (!(g > -Math.abs(ny) * lh / 2 && g <= Math.abs(ny) * lh / 2)) return '';
    const drop = -g / (ny * lh); // where the line crosses, -0.5 top to 0.5 bottom
    return drop >= 0.3 ? '_' : drop >= 0.12 ? '.' : drop > -0.2 ? '-' : "'";
  }
  // Steeper lines take one character per row.
  if (!(g > -Math.abs(nx) * cw / 2 && g <= Math.abs(nx) * cw / 2)) return '';
  return climb > 1.6 ? '|' : nx * ny < 0 ? '\\' : '/';
}

// Rows of cells: { ch, zone, sectors }. zone is 'hub', 'ring', 'line' or
// 'out'; sectors lists the sectors a cell belongs to or borders.
export function wheelCells({ count, inner, outer, cw, lh, cols, rows }) {
  const cc = (cols - 1) / 2, rc = (rows - 1) / 2;
  const step = count ? Math.PI * 2 / count : 0;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const x = (c - cc) * cw, y = (r - rc) * lh, d = Math.hypot(x, y) || 1e-9;
      const t = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
      const sector = count ? Math.floor((t + step / 2) / step) % count : -1;
      const rim = stroke(d - inner, x / d, y / d, cw, lh) || stroke(d - outer, x / d, y / d, cw, lh);
      let spoke = '', k = -1;
      if (count > 1 && d > inner - lh && d < outer + lh) {
        k = ((Math.round((t - step / 2) / step) % count) + count) % count;
        const a = step / 2 + k * step;
        spoke = stroke(x * Math.cos(a) + y * Math.sin(a), Math.cos(a), Math.sin(a), cw, lh);
      }
      const between = d > inner && d < outer;
      let cell;
      if (rim && spoke) cell = { ch: '+', zone: 'line', sectors: [k, (k + 1) % count] };
      else if (rim) cell = { ch: rim, zone: 'line', sectors: count ? [sector] : [] };
      else if (spoke && between) cell = { ch: spoke, zone: 'line', sectors: [k, (k + 1) % count] };
      else if (d < inner) cell = { ch: '', zone: 'hub', sectors: [] };
      else if (d <= outer) cell = { ch: '', zone: 'ring', sectors: count ? [sector] : [] };
      else cell = { ch: '', zone: 'out', sectors: [] };
      row.push(cell);
    }
    grid.push(row);
  }
  return grid;
}

// Words folded into lines of at most width characters.
export function wrap(text, width) {
  const lines = [];
  let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

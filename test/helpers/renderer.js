import { AsciiRenderer } from '../../src/render/renderer.js';

// Gives a hand-built test renderer the real cell-writing methods and the
// layer buffer, keeping any method the test defines itself.
export function withLayers(r) {
  const n = r.cols * (r.rows ?? 1) * 4;
  const Buffer = r.fg?.constructor ?? Uint8ClampedArray;
  r.fg ??= new Buffer(n);
  r.bg ??= new Buffer(n);
  r.ov ??= new Buffer(n);
  for (const name of ['put', 'putAt', 'layer', 'layerAt', 'setGlyph', 'glyphAt', 'hasLayer']) {
    r[name] ??= AsciiRenderer.prototype[name];
  }
  return r;
}

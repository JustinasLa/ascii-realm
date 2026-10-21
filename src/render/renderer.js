// Draws a grid of coloured glyphs with a single full-screen WebGL2 pass.
//
// The CPU fills three cell buffers each frame: `fg` (rgb + low byte of the
// glyph), `ov` (the same for a second glyph layered over the first, like a
// flower over grass) and `bg` (rgb + the high bits of both glyphs). They are
// uploaded as textures and the fragment shader looks up the glyphs in the
// atlas for every pixel, so cost is independent of how many characters are
// on screen.
//
// Ground fog is drawn in the same pass from grey `o` characters that are not
// held to the grid: several drifting layers of them, scattered and freely
// overlapping, so thick fog piles up into a dense, smoky mass. They are laid
// over the finished scene without touching the cell buffers.

import { NOISE, NOISE_SIZE } from '../world/fog-banks.js';
import { ASPECT } from '../world/world.js';
import { BLANK_GLYPH, glyph, GLYPH_KIND, GLYPH_MASK, LAYER } from './glyphs.js';
import { FOG, FOG_PILED, FOG_THIN, NIGHT, VIGNETTE } from './palette.js';

// An rgb triple as a GLSL vec3 literal.
// How much of a cell's ground colour shows behind its glyph.
const BG_KEEP = 0.12;
// The character the fog is made of, and how many drifting layers of it can
// pile up over one spot.
const FOG_GLYPH = glyph('o');
const FOG_LAYERS = 5;
const vec3 = (c) => `vec3(${c.map((v) => (v / 255).toFixed(4)).join(', ')})`;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uFg;
uniform sampler2D uBg;
uniform sampler2D uOv;
uniform sampler2D uAtlas;
uniform vec2 uView;
uniform vec2 uCell;
uniform vec2 uOffset;
uniform vec2 uAtlasCols;
uniform vec2 uAtlasCell;
uniform float uAtlasPad;
uniform vec2 uAtlasSize;
uniform sampler2D uNoise;
uniform vec2 uWorld;
uniform vec2 uFogDrift;
uniform vec3 uFog;
// The fog in view as walkers have pushed it about, beside the fog the banks
// alone would put there (see world/fog-wake.js), and where that field lies:
// its corner, width and height, in rows with columns scaled to rows.
uniform sampler2D uPushed;
uniform vec4 uPushedArea;
out vec4 outColor;

const float NOISE = ${NOISE_SIZE.toFixed(1)};

// Smooth value noise from one filtered lookup of the random texture: easing
// the fraction before the hardware interpolates hides the lattice.
float noise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise, (i + f + 0.5) / NOISE).r;
}

const mat2 TURN = mat2(1.6, 1.2, -1.2, 1.6);

float fbm(vec2 x) {
  float sum = 0.5 * noise(x);
  x = TURN * x + 17.3;
  sum += 0.25 * noise(x);
  x = TURN * x + 31.7;
  sum += 0.125 * noise(x);
  x = TURN * x + 5.9;
  sum += 0.0625 * noise(x);
  return sum / 0.9375;
}

// How thick the fog is at a point on the ground, in rows. Broad banks are
// warped by a second noise so their edges curl into wisps, and fine streaks
// inside them keep any bank from reading as a flat smear.
float fogAt(vec2 w) {
  float t = uFog.z;
  vec2 q = (w + uFogDrift) / 28.0;
  vec2 warp = vec2(fbm(q * 1.7 + vec2(0.0, t * 0.021)), fbm(q * 1.7 + vec2(5.2, 1.3) - t * 0.017));
  float bank = fbm(q + 1.4 * warp + vec2(t * 0.006, 0.0));
  float edge = 0.52 - 0.22 * uFog.y;
  float thick = smoothstep(edge, edge + 0.34, bank);
  float streak = fbm(vec2((w.x + uFogDrift.x * 1.35) / 5.5, (w.y + uFogDrift.y) / 2.4) + 2.5 * warp);
  return thick * (0.35 + 1.1 * streak);
}

float coverage(float g, vec2 local) {
  vec2 gcell = vec2(mod(g, uAtlasCols.x), floor(g / uAtlasCols.x));
  vec2 inner = uAtlasCell - 2.0 * uAtlasPad;
  vec2 apx = gcell * uAtlasCell + uAtlasPad + local * inner;
  float lod = clamp(log2(inner.y / uCell.y), 0.0, 2.5);
  return textureLod(uAtlas, apx / uAtlasSize, lod).r;
}

float random(vec2 slot, float salt) {
  return texelFetch(uNoise, ivec2(mod(slot + vec2(salt * 61.0, salt * 23.0), NOISE)), 0).r;
}

// The fog at a point of the ground once walkers have pushed it about, given
// the undisturbed banks there. Where fog was pushed away the banks thin in
// proportion, keeping their fine streaks; fog pushed in on top piles up.
float pushedFog(vec2 ground, float banks) {
  vec2 uv = (ground - uPushedArea.xy) / uPushedArea.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return banks;
  vec2 field = texture(uPushed, uv).rg;
  return banks * min(1.0, field.r / max(field.g, 0.02)) + max(0.0, field.r - field.g);
}

// One layer of fog characters around a point, in world cells. Each slot of
// the layer's grid holds one 'o', nudged off the grid, sized a little up or
// down and swaying on its own; only the four slots nearest the point can
// reach it. Every character fades with the fog's thickness and with its own
// slow pulse, so banks churn rather than slide. Returns the colour after
// laying the layer's characters over it.
vec3 fogLayer(vec3 color, vec2 at, float layer, float thick, vec3 tint) {
  float t = uFog.z;
  vec2 shift = vec2(uFogDrift.x / ${ASPECT.toFixed(4)}, uFogDrift.y) * (0.75 + 0.18 * layer)
    - vec2(layer * 0.37, layer * 0.61);
  vec2 q = at - shift;
  vec2 base = floor(q - 0.5);
  for (int k = 0; k < 4; k++) {
    vec2 slot = base + vec2(float(k & 1), float(k >> 1));
    float r1 = random(slot, layer);
    float r2 = random(slot, layer + 4.0);
    float r3 = random(slot, layer + 8.0);
    float phase = r1 * 6.2832;
    vec2 centre = slot + 0.5 + (vec2(r1, r2) - 0.5) * 0.6
      + 0.12 * vec2(sin(t * 0.5 + phase), cos(t * 0.4 + phase * 1.7));
    float size = 0.8 + 0.5 * r3;
    vec2 local = (q - centre) / size + 0.5;
    if (any(lessThan(local, vec2(0.0))) || any(greaterThan(local, vec2(1.0)))) continue;
    float pulse = 0.55 + 0.45 * sin(t * (0.25 + 0.3 * r2) + phase * 3.0);
    // Fog piled up past its usual thickness keeps getting denser.
    float a = smoothstep(r3 * 0.35, r3 * 0.35 + 0.45, thick) * pulse * (0.38 + 0.35 * r2)
      * (1.0 + 0.45 * max(0.0, thick - 0.9));
    color = mix(color, tint, coverage(${FOG_GLYPH.toFixed(1)}, local) * a);
  }
  return color;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y) + uOffset;
  vec2 cell = floor(p / uCell);
  vec2 local = (p - cell * uCell) / uCell;
  ivec2 ci = ivec2(cell);

  vec4 fg = texelFetch(uFg, ci, 0);
  vec4 bg = texelFetch(uBg, ci, 0);
  vec4 ov = texelFetch(uOv, ci, 0);

  // The background's alpha holds the high bits of both glyph indices.
  float hi = floor(bg.a * 255.0 + 0.5);
  float g = floor(fg.a * 255.0 + 0.5) + mod(hi, 16.0) * 256.0;
  float og = floor(ov.a * 255.0 + 0.5) + floor(hi / 16.0) * 256.0;

  // Cells are not painted in: the ground colour only faintly tints the night
  // between characters, so every shape is drawn by its glyphs alone.
  vec3 ground = mix(${vec3(NIGHT)}, bg.rgb, ${BG_KEEP.toFixed(3)});
  vec3 color = mix(ground, fg.rgb, coverage(g, local));
  if (og > 0.5) color = mix(color, ov.rgb, coverage(og, local));

  if (uFog.x > 0.0) {
    // The fog's thickness hardly changes across a character, so it is found
    // once for the pixel and shared by every character over it.
    vec2 at = uWorld + p / uCell;
    vec2 ground = at * vec2(${ASPECT.toFixed(4)}, 1.0);
    // Walkers push the fog aside into the fog around them.
    float thick = clamp(pushedFog(ground, fogAt(ground)) * uFog.x, 0.0, 2.2);
    if (thick > 0.01) {
      vec3 tint = mix(${vec3(FOG_THIN)}, ${vec3(FOG)}, clamp(thick, 0.0, 1.0));
      tint = mix(tint, ${vec3(FOG_PILED)}, clamp(thick - 1.0, 0.0, 1.0) * 0.6);
      for (int layer = 0; layer < ${FOG_LAYERS}; layer++) color = fogLayer(color, at, float(layer), thick, tint);
    }
  }

  // Fade toward a deep navy at the corners so the eye settles on the middle
  // of the scene and the edges stay night rather than plain black.
  vec2 uv = gl_FragCoord.xy / uView - 0.5;
  uv.x *= uView.x / uView.y;
  float vignette = 1.0 - smoothstep(0.35, 1.05, length(uv)) * 0.7;
  outColor = vec4(mix(${vec3(VIGNETTE)}, color, vignette), 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function dataTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export class AsciiRenderer {
  constructor(canvas, atlas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.atlas = atlas;
    this.restore();
  }

  restore() {
    const gl = this.gl;
    const atlas = this.atlas;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    this.prog = prog;
    this.u = {};
    for (const name of ['uFg', 'uBg', 'uOv', 'uAtlas', 'uView', 'uCell', 'uOffset', 'uAtlasCols',
      'uAtlasCell', 'uAtlasPad', 'uAtlasSize', 'uNoise', 'uWorld', 'uFogDrift', 'uFog', 'uPushed', 'uPushedArea']) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    // Coverage is monochrome and the shader reads only red. R8 retains
    // every coverage value and mip level using one quarter of RGBA's VRAM.
    const width = atlas.canvas.width;
    const height = atlas.canvas.height;
    const rgba = atlas.canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const coverage = new Uint8Array(width * height);
    for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4];
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, coverage);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // A fixed field of random values that tiles, so the fog's noise costs
    // one texture read per octave instead of hashing every corner. The game
    // reads the same values to know where the banks lie (fog-banks.js).
    this.noiseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NOISE_SIZE, NOISE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, NOISE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // The pushed-fog field is smooth, so it is read with filtering.
    this.pushedTex = dataTexture(gl);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.fgTex = dataTexture(gl);
    this.bgTex = dataTexture(gl);
    this.ovTex = dataTexture(gl);

    gl.uniform1i(this.u.uFg, 0);
    gl.uniform1i(this.u.uBg, 1);
    gl.uniform1i(this.u.uAtlas, 2);
    gl.uniform1i(this.u.uOv, 3);
    gl.uniform1i(this.u.uNoise, 4);
    gl.uniform1i(this.u.uPushed, 5);
    gl.uniform2f(this.u.uAtlasCols, atlas.cols, atlas.rows);
    gl.uniform2f(this.u.uAtlasCell, atlas.cellW, atlas.cellH);
    gl.uniform1f(this.u.uAtlasPad, atlas.pad);
    gl.uniform2f(this.u.uAtlasSize, atlas.canvas.width, atlas.canvas.height);

    this.cols = 0;
    this.rows = 0;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  // Cell size is given in CSS pixels and may be fractional: rounding it to
  // whole device pixels would nudge the width/height ratio at every zoom
  // level and visibly stretch the world. The buffers are only reallocated
  // when the grid actually changes size, so zooming smoothly is cheap.
  resize(cssW, cssH, dpr, cellW, cellH) {
    const gl = this.gl;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    this.dpr = dpr;
    const deviceW = cellW * dpr;
    const deviceH = cellH * dpr;
    // Browser zoom can lower DPR below one. Enlarge both dimensions together
    // when enforcing the minimum so the world keeps its aspect ratio.
    const scale = Math.max(1, 2 / deviceW, 3 / deviceH);
    this.cellW = deviceW * scale;
    this.cellH = deviceH * scale;
    // One spare row and column so sub-cell scrolling never exposes a gap.
    const cols = Math.ceil(w / this.cellW) + 1;
    const rows = Math.ceil(h / this.cellH) + 1;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.fg = new Uint8ClampedArray(cols * rows * 4);
    this.bg = new Uint8ClampedArray(cols * rows * 4);
    this.ov = new Uint8ClampedArray(cols * rows * 4);
    // Terrain type under each cell, so later passes know where water is.
    this.mask = new Uint8Array(cols * rows);

    for (const tex of [this.fgTex, this.bgTex, this.ovTex]) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }

  clear(r = NIGHT[0], g = NIGHT[1], b = NIGHT[2]) {
    const { fg, bg, ov } = this;
    fg.fill(0);
    ov.fill(0);
    for (let i = 0; i < bg.length; i += 4) {
      bg[i] = r;
      bg[i + 1] = g;
      bg[i + 2] = b;
      bg[i + 3] = 0;
    }
  }

  // Replaces the cell's glyph, covering anything layered on it. A glyph
  // flagged with LAYER is stacked on top instead (see layer).
  put(x, y, glyphIndex, r, g, b) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.putAt(y * this.cols + x, glyphIndex, r, g, b);
  }

  putAt(cell, glyphIndex, r, g, b) {
    if (glyphIndex & LAYER) {
      this.layerAt(cell, glyphIndex, r, g, b);
      return;
    }
    const i = cell * 4;
    this.fg[i] = r;
    this.fg[i + 1] = g;
    this.fg[i + 2] = b;
    this.fg[i + 3] = glyphIndex & 255;
    this.bg[i + 3] = glyphIndex >> 8;
    this.ov[i + 3] = 0;
  }

  // The topmost character takes the cell, including overlapping blades.
  // Blank highlights leave the current character and its colour intact.
  layer(x, y, glyphIndex, r, g, b) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.layerAt(y * this.cols + x, glyphIndex, r, g, b);
  }

  layerAt(cell, glyphIndex, r, g, b) {
    const glyphIndexOnly = glyphIndex & GLYPH_MASK;
    if (GLYPH_KIND[glyphIndexOnly] === BLANK_GLYPH) return;
    this.putAt(cell, glyphIndexOnly, r, g, b);
  }

  // The base glyph of a cell, without anything layered over it.
  glyphAt(cell) {
    return this.fg[cell * 4 + 3] | ((this.bg[cell * 4 + 3] & 15) << 8);
  }

  // Swaps the base glyph, keeping its colour, and drops any layer over it.
  setGlyph(cell, glyphIndex) {
    const i = cell * 4;
    this.fg[i + 3] = glyphIndex & 255;
    this.bg[i + 3] = (glyphIndex & GLYPH_MASK) >> 8;
    this.ov[i + 3] = 0;
  }

  // Whether a second glyph is layered over the cell's base glyph.
  hasLayer(cell) {
    return this.ov[cell * 4 + 3] !== 0 || this.bg[cell * 4 + 3] >> 4 !== 0;
  }

  putBg(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = (y * this.cols + x) * 4;
    this.bg[i] = r;
    this.bg[i + 1] = g;
    this.bg[i + 2] = b;
  }

  // offsetX/offsetY: how far (in device px) the grid is scrolled into its
  // first cell, so the camera can move smoothly between cells. `fog` places
  // the ground fog: the world cell in the grid's corner (x0, y0), its
  // density, coverage, drift and age (see world/fog.js). Without it the
  // scene is drawn clear.
  draw(offsetX = 0, offsetY = 0, fog = null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE,
      this.fg);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE,
      this.bg);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ovTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE,
      this.ov);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    gl.uniform3f(this.u.uFog, fog?.density ?? 0, fog?.coverage ?? 0, fog?.time ?? 0);
    gl.uniform2f(this.u.uWorld, fog?.x0 ?? 0, fog?.y0 ?? 0);
    gl.uniform2f(this.u.uFogDrift, fog?.driftX ?? 0, fog?.driftY ?? 0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.pushedTex);
    const wake = fog?.wake;
    if (wake && !Number.isNaN(wake.ox)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, wake.w, wake.h, 0, gl.RG, gl.FLOAT, wake.texels);
      gl.uniform4f(this.u.uPushedArea, wake.ox, wake.oy, wake.width, wake.height);
    } else {
      // Nothing pushed: an area too small to reach any pixel.
      gl.uniform4f(this.u.uPushedArea, -1e6, -1e6, 1, 1);
    }

    gl.uniform2f(this.u.uView, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.uCell, this.cellW, this.cellH);
    gl.uniform2f(this.u.uOffset, offsetX, offsetY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// Draws a grid of coloured glyphs with a single full-screen WebGL2 pass.
//
// The CPU fills cell buffers each frame: `fg` (rgb + low byte of the
// glyph) and `bg` (rgb + the glyph's high bits). They are uploaded as
// textures and the fragment shader looks up the glyphs in the
// atlas for every pixel, so cost is independent of how many characters are
// on screen.
//
// Ground fog is drawn in the same pass from grey `o` characters that are not
// held to the grid: several drifting layers of them, scattered and freely
// overlapping, so thick fog piles up into a dense, smoky mass. They are laid
// over the finished scene without touching the cell buffers.
//
// Trees and rocks are drawn finer than everything else: a second grid with
// FINE x FINE small cells in every cell, in `fine` (rgb + low byte of the
// glyph) and `fineBg` (the dark backdrop that blots out the ground behind a
// solid part, plus the glyph's high bits and flags). A sprite drawn there
// stands apart from the grass as a dense mass of smaller letters with a hard
// edge. Painter's order still holds: whatever is drawn into a cell after a
// fine sprite is laid over the sprite's small cells there.

import { NOISE, NOISE_SIZE } from '../world/fog-banks.js';
import { deviceGrid } from '../core/layout.js';
import { ASPECT } from '../world/world.js';
import { FINE } from './cells.js';
import { BLANK_GLYPH, glyph, GLYPH_KIND, GLYPH_MASK, LAYER } from './glyphs.js';
import { FOG, FOG_PILED, FOG_THIN, NIGHT, VIGNETTE } from './palette.js';

// An rgb triple as a GLSL vec3 literal.
// How much of a cell's ground colour shows behind its glyph.
const BG_KEEP = 0.12;
// The character the fog is made of, and how many drifting layers of it can
// pile up over one spot.
const FOG_GLYPH = glyph('o');
const FOG_LAYERS = 5;
// Flags in the fine backdrop's alpha, above the glyph's high four bits:
// the small cell holds a sprite; it blots out the ground behind it;
// something was drawn into its cell after it and stands in front of it;
// and that was a glyph layered over the cell (a firefly, a raindrop), which
// is drawn over the sprite's small letters instead of in their place.
const FINE_SET = 16;
const FINE_SOLID = 32;
const FINE_UNDER = 64;
const FINE_OVER = 128;
// A small cell next to a solid part of a sprite, with nothing of the sprite
// in it, is part of the sprite's outline of nothing: a thin band of night
// that parts the sprite from the grass behind it. Its strength, 1 to
// FINE_HALO, is kept in the backdrop's alpha, below FINE_SET, while nothing
// has been drawn into its cell since. Where a sprite stands on the ground
// the outline fades out, so the sprite stays planted in the grass.
const FINE_HALO = 15;
// How wide the band is, in small-cell heights, and how many small cells
// around a solid one it can reach.
const HALO_WIDTH = 1.25;
const HALO_REACH = 2;
// How much of a sprite's backdrop colour shows: it is near black, so the
// silhouette reads as one dark mass against the grass.
const FINE_BG_KEEP = 0.12;
// Small letters carry less ink than full-size ones, so they are drawn
// brighter to keep a sprite as bright as before.
const FINE_INK = 1.55;
const vec3 = (c) => `vec3(${c.map((v) => (v / 255).toFixed(4)).join(', ')})`;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uFg;
uniform sampler2D uBg;
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
uniform sampler2D uFine;
uniform sampler2D uFineBg;
uniform sampler2D uMotion;
uniform bool uMotionActive;
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

// How much of a glyph covers a point of its cell, for cells of the given
// height in device pixels.
float coverageAt(float g, vec2 local, float height) {
  vec2 gcell = vec2(mod(g, uAtlasCols.x), floor(g / uAtlasCols.x));
  vec2 inner = uAtlasCell - 2.0 * uAtlasPad;
  vec2 apx = gcell * uAtlasCell + uAtlasPad + local * inner;
  float lod = clamp(log2(inner.y / height), 0.0, 3.5);
  return textureLod(uAtlas, apx / uAtlasSize, lod).r;
}

float coverage(float g, vec2 local) {
  return coverageAt(g, local, uCell.y);
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

  // The background's alpha holds the high bits of the glyph index.
  float hi = floor(bg.a * 255.0 + 0.5);
  float g = floor(fg.a * 255.0 + 0.5) + mod(hi, 16.0) * 256.0;

  // Cells are not painted in: the ground colour only faintly tints the night
  // between characters, so every shape is drawn by its glyphs alone.
  vec3 ground = mix(${vec3(NIGHT)}, bg.rgb, ${BG_KEEP.toFixed(3)});
  vec3 color = mix(ground, fg.rgb, coverage(g, local));

  // Soft sprites can move their letters between grid slots. Only cells in
  // their small neighbourhood pay for these samples; later terrain/figure
  // writes remove the mark so a drifting letter cannot bleed through them.
  if (uMotionActive) {
    vec4 motion = texelFetch(uMotion, ci, 0);
    int tag = int(round(motion.b * 255.0)) | (int(round(motion.a * 255.0)) << 8);
    if ((tag & 32768) != 0) {
      bool floating = (tag & 1) != 0;
      int depth = (tag & 32767) >> 1;
      if (floating) color = ground;
      ivec2 size = textureSize(uMotion, 0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          ivec2 neighbour = ci + ivec2(x, y);
          if (any(lessThan(neighbour, ivec2(0))) || any(greaterThanEqual(neighbour, size))) continue;
          vec4 m = texelFetch(uMotion, neighbour, 0);
          int t = int(round(m.b * 255.0)) | (int(round(m.a * 255.0)) << 8);
          int d = (t & 32767) >> 1;
          if ((t & 1) == 0 || d < depth || (!floating && d == depth)) continue;
          vec2 offset = (round(m.rg * 255.0) - 128.0) / 254.0;
          vec2 at = local - vec2(x, y) - offset;
          if (any(lessThan(at, vec2(0.0))) || any(greaterThan(at, vec2(1.0)))) continue;
          vec4 ink = texelFetch(uFg, neighbour, 0);
          vec4 back = texelFetch(uBg, neighbour, 0);
          float letter = round(ink.a * 255.0) + mod(round(back.a * 255.0), 16.0) * 256.0;
          color = mix(color, ink.rgb, coverage(letter, at));
        }
      }
    }
  }

  // A tree or rock drawn in small cells over this spot.
  vec2 finePos = p / uCell * ${FINE.toFixed(1)};
  vec2 fineCell = floor(finePos);
  vec4 fineBg = texelFetch(uFineBg, ivec2(fineCell), 0);
  float flags = floor(fineBg.a * 255.0 + 0.5);
  if (flags >= ${FINE_SET.toFixed(1)}) {
    // A solid small cell is darker than the night, faintly tinted by the
    // sprite's backdrop, so the sprite's outline is crisp.
    bool solid = mod(floor(flags / ${FINE_SOLID.toFixed(1)}), 2.0) > 0.5;
    vec3 backdrop = mix(${vec3(NIGHT)} * 0.5, fineBg.rgb, ${FINE_BG_KEEP.toFixed(3)});
    bool under = mod(floor(flags / ${FINE_UNDER.toFixed(1)}), 2.0) > 0.5;
    if (under && flags < ${FINE_OVER.toFixed(1)}) {
      // Whatever was drawn into the cell afterwards stands in front, over
      // the sprite's backdrop and in place of its small letters.
      if (solid) color = mix(backdrop, fg.rgb, coverage(g, local));
    } else {
      vec4 fine = texelFetch(uFine, ivec2(fineCell), 0);
      float fineGlyph = mod(flags, 16.0) * 256.0 + floor(fine.a * 255.0 + 0.5);
      // Lifted without clipping, so lit wood keeps its highlights.
      vec3 ink = fine.rgb * ${FINE_INK.toFixed(2)} / (1.0 + fine.rgb * ${(FINE_INK - 1).toFixed(2)});
      vec3 sprite = mix(solid ? backdrop : color, ink,
        coverageAt(fineGlyph, finePos - fineCell, uCell.y / ${FINE.toFixed(1)}));
      color = under ? mix(sprite, fg.rgb, coverage(g, local)) : sprite;
    }
  } else if (flags > 0.5) {
    // Beside a solid part of a sprite: how far this pixel is from it, in
    // device pixels, decides how much of what lies behind is blotted out.
    vec2 small = uCell / ${FINE.toFixed(1)};
    float near = 1e9;
    for (int j = -${HALO_REACH}; j <= ${HALO_REACH}; j++) {
      for (int i = -${HALO_REACH}; i <= ${HALO_REACH}; i++) {
        ivec2 at = ivec2(fineCell) + ivec2(i, j);
        float f = floor(texelFetch(uFineBg, at, 0).a * 255.0 + 0.5);
        if (f < ${FINE_SET.toFixed(1)} || mod(floor(f / ${FINE_SOLID.toFixed(1)}), 2.0) < 0.5) continue;
        vec2 off = max(abs(finePos - vec2(at) - 0.5) - 0.5, 0.0) * small;
        near = min(near, length(off));
      }
    }
    float strength = flags / ${FINE_HALO.toFixed(1)};
    // Faint outlines are narrower and fade from the silhouette itself.
    // Full-strength scenery retains its original width and firm inner edge.
    float width = small.y * ${HALO_WIDTH.toFixed(2)} * mix(0.25, 1.0, strength);
    float inner = width * 0.6 * max(0.0, (strength - 0.4) / 0.6);
    color = mix(color, ${vec3(NIGHT)} * 0.5,
      (1.0 - smoothstep(inner, width, near)) * strength);
  }

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
    for (const name of ['uFg', 'uBg', 'uAtlas', 'uView', 'uCell', 'uOffset', 'uAtlasCols',
      'uAtlasCell', 'uAtlasPad', 'uAtlasSize', 'uNoise', 'uWorld', 'uFogDrift', 'uFog', 'uPushed', 'uPushedArea',
      'uFine', 'uFineBg', 'uMotion', 'uMotionActive']) {
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
    this.fineTex = dataTexture(gl);
    this.fineBgTex = dataTexture(gl);
    this.motionTex = dataTexture(gl);

    gl.uniform1i(this.u.uFg, 0);
    gl.uniform1i(this.u.uBg, 1);
    gl.uniform1i(this.u.uAtlas, 2);
    gl.uniform1i(this.u.uNoise, 4);
    gl.uniform1i(this.u.uPushed, 5);
    gl.uniform1i(this.u.uFine, 6);
    gl.uniform1i(this.u.uFineBg, 7);
    gl.uniform1i(this.u.uMotion, 3);
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
    const { width: w, height: h, cellW: deviceW, cellH: deviceH, cols, rows } =
      deviceGrid(cssW, cssH, dpr, cellW, cellH);
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    this.dpr = dpr;
    this.cellW = deviceW;
    this.cellH = deviceH;
    // One spare row and column so sub-cell scrolling never exposes a gap.
    if (cols === this.cols && rows === this.rows) return;
    this.allocate(cols, rows);

    for (const tex of [this.fgTex, this.bgTex, this.motionTex]) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    for (const tex of [this.fineTex, this.fineBgTex]) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.fineCols, this.fineRows, 0, gl.RGBA,
        gl.UNSIGNED_BYTE, null);
    }
  }

  // The cell buffers for a grid of the given size.
  allocate(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.fg = new Uint8ClampedArray(cols * rows * 4);
    this.bg = new Uint8ClampedArray(cols * rows * 4);
    // Legacy CPU shading helpers still write this buffer; layers now
    // resolve into fg, so it does not need a GPU texture.
    this.ov = new Uint8ClampedArray(cols * rows * 4);
    this.motion = new Uint8Array(cols * rows * 4);
    this.motionPass = 0;
    this.motionUsed = false;
    // Terrain type under each cell, so later passes know where water is.
    this.mask = new Uint8Array(cols * rows);
    this.fineCols = cols * FINE;
    this.fineRows = rows * FINE;
    this.fine = new Uint8ClampedArray(this.fineCols * this.fineRows * 4);
    this.fineBg = new Uint8ClampedArray(this.fineCols * this.fineRows * 4);
    // Cells holding any small cell of a sprite, so plain cells skip them.
    this.fineMark = new Uint8Array(cols * rows);
    this.fineUsed = false;
  }

  clear(r = NIGHT[0], g = NIGHT[1], b = NIGHT[2]) {
    const { fg, bg, ov } = this;
    fg.fill(0);
    ov.fill(0);
    this.clearFine();
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
    if (this.motionUsed) {
      this.motion[i] = this.motion[i + 1] = 0;
      this.motion[i + 2] = (this.motionPass * 2) & 255;
      this.motion[i + 3] = (this.motionPass * 2) >> 8;
    }
    if (this.fineMark?.[cell]) this.overFine(cell, FINE_UNDER);
  }

  // Empties the fine grid. The ground is drawn over every cell each frame,
  // but nothing redraws the small cells, so they are emptied with it.
  clearFine() {
    if (this.motionUsed) this.motion.fill(0);
    this.motionPass = 0;
    this.motionUsed = false;
    if (!this.fineUsed) return;
    this.fineBg.fill(0);
    this.fineMark.fill(0);
    this.fineUsed = false;
  }

  // One painter-ordered soft sprite. The pass number is small (one per
  // mushroom), unlike a counter for every terrain and grass cell.
  beginFloating() {
    this.motionUsed = true;
    this.motionPass = Math.min(16383, this.motionPass + 1);
  }

  putFloating(x, y, g, red, green, blue) {
    const sx = Math.round(x), sy = Math.round(y);
    if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) return;
    this.put(sx, sy, g, red, green, blue);
    const at = (sy * this.cols + sx) * 4;
    const tag = 32768 | (this.motionPass * 2 + 1);
    this.motion[at] = Math.round((x - sx) * 254) + 128;
    this.motion[at + 1] = Math.round((y - sy) * 254) + 128;
    this.motion[at + 2] = tag & 255;
    this.motion[at + 3] = tag >> 8;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = sx + dx, ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        this.motion[(ny * this.cols + nx) * 4 + 3] |= 128;
      }
    }
  }

  // Something drawn into a cell holding part of a sprite: it stands in
  // front of the sprite's small cells there (FINE_UNDER), is layered over
  // them (FINE_UNDER | FINE_OVER), or, being solid, hides them (0).
  overFine(cell, flag) {
    const cx = cell % this.cols;
    const cy = (cell - cx) / this.cols;
    for (let j = 0; j < FINE; j++) {
      let at = ((cy * FINE + j) * this.fineCols + cx * FINE) * 4 + 3;
      for (let i = 0; i < FINE; i++, at += 4) {
        const flags = this.fineBg[at];
        if (flags >= FINE_SET) this.fineBg[at] = flag ? (flags & ~FINE_OVER) | flag : 0;
        // Whatever is drawn afterwards stands in front of the outline too.
        else if (flags) this.fineBg[at] = 0;
      }
    }
    if (!flag) this.fineMark[cell] = 0;
  }

  // Lighting passes reach a sprite's small cells too. Adds a colour to the
  // small cells of a cell, and a share of it to their backdrop.
  lightFine(cell, cr, cg, cb, ground = 0.2) {
    this.blendFine(cell, 1, 0, 0, 0, 0, cr, cg, cb, ground);
  }

  // Blends the small cells of a cell as v * m * (1 - k) + c * k + add; the
  // backdrop takes `ground` of the colour and of the light added.
  blendFine(cell, m, k, cr, cg, cb, ar, ag, ab, ground) {
    const cx = cell % this.cols;
    const cy = (cell - cx) / this.cols;
    const keep = m * (1 - k);
    for (let j = 0; j < FINE; j++) {
      let at = ((cy * FINE + j) * this.fineCols + cx * FINE) * 4;
      for (let i = 0; i < FINE; i++, at += 4) {
        if (this.fineBg[at + 3] < FINE_SET) continue;
        const { fine, fineBg } = this;
        fine[at] = fine[at] * keep + cr * k + ar;
        fine[at + 1] = fine[at + 1] * keep + cg * k + ag;
        fine[at + 2] = fine[at + 2] * keep + cb * k + ab;
        fineBg[at] = fineBg[at] * keep + (cr * k + ar) * ground;
        fineBg[at + 1] = fineBg[at + 1] * keep + (cg * k + ag) * ground;
        fineBg[at + 2] = fineBg[at + 2] * keep + (cb * k + ab) * ground;
      }
    }
  }

  // Draws a glyph into one small cell of the fine grid, given in small
  // cells (FINE to a cell). With a backdrop colour the small cell is solid
  // and blots out the ground behind it; without one, a glyph laid over a
  // solid small cell keeps that backdrop. A solid small cell rings itself
  // with an outline of nothing of the given strength (see FINE_HALO).
  fineAt(fx, fy, glyphIndex, r, g, b, br, bgG, bb, halo = FINE_HALO) {
    if (fx < 0 || fy < 0 || fx >= this.fineCols || fy >= this.fineRows) return;
    const i = (fy * this.fineCols + fx) * 4;
    const glyphOnly = glyphIndex & GLYPH_MASK;
    if ((glyphIndex & LAYER) && GLYPH_KIND[glyphOnly] === BLANK_GLYPH) return;
    const old = this.fineBg[i + 3];
    let flags = FINE_SET | (glyphOnly >> 8);
    if (br !== undefined) {
      this.fineBg[i] = br;
      this.fineBg[i + 1] = bgG;
      this.fineBg[i + 2] = bb;
      flags |= FINE_SOLID;
      if (halo > 0) this.haloAround(fx, fy, halo);
    } else if ((old & FINE_SOLID) && !(old & FINE_UNDER)) flags |= FINE_SOLID;
    this.fine[i] = r;
    this.fine[i + 1] = g;
    this.fine[i + 2] = b;
    this.fine[i + 3] = glyphOnly & 255;
    this.fineBg[i + 3] = flags;
    this.fineMark[((fy / FINE) | 0) * this.cols + ((fx / FINE) | 0)] = 1;
    this.fineUsed = true;
  }

  // A full-size character cell can use the fine sprite border too. Lay a
  // solid backing under its existing glyph; later scenery still covers it.
  outlineCell(x, y, br, bgG, bb) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    for (let j = 0; j < FINE; j++) {
      for (let i = 0; i < FINE; i++) {
        const fx = x * FINE + i;
        const fy = y * FINE + j;
        this.fineAt(fx, fy, 0, 0, 0, 0, br, bgG, bb, 0);
        // A distinct but soft border, still narrower than the prop outlines.
        this.haloAround(fx, fy, 10);
      }
    }
    this.overFine(y * this.cols + x, FINE_UNDER);
  }

  // Marks the empty small cells around a solid one as its outline.
  haloAround(fx, fy, halo) {
    for (let y = Math.max(0, fy - HALO_REACH); y <= Math.min(this.fineRows - 1, fy + HALO_REACH); y++) {
      for (let x = Math.max(0, fx - HALO_REACH); x <= Math.min(this.fineCols - 1, fx + HALO_REACH); x++) {
        const at = (y * this.fineCols + x) * 4 + 3;
        if (this.fineBg[at] >= halo) continue;
        this.fineBg[at] = halo;
        this.fineMark[((y / FINE) | 0) * this.cols + ((x / FINE) | 0)] = 1;
      }
    }
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
    if (this.fineMark?.[cell]) this.overFine(cell, FINE_UNDER | FINE_OVER);
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
    if (this.motionUsed) {
      this.motion[i] = this.motion[i + 1] = 0;
      this.motion[i + 2] = (this.motionPass * 2) & 255;
      this.motion[i + 3] = (this.motionPass * 2) >> 8;
    }
  }

  // Whether a second glyph is layered over the cell's base glyph.
  hasLayer(cell) {
    return this.ov[cell * 4 + 3] !== 0 || this.bg[cell * 4 + 3] >> 4 !== 0;
  }

  putBg(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    // A solid cell drawn over part of a sprite hides it there.
    if (this.fineMark?.[y * this.cols + x]) this.overFine(y * this.cols + x, 0);
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
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.fineTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.fineCols, this.fineRows, gl.RGBA, gl.UNSIGNED_BYTE,
      this.fine);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.fineBgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.fineCols, this.fineRows, gl.RGBA, gl.UNSIGNED_BYTE,
      this.fineBg);
    gl.uniform1i(this.u.uMotionActive, this.motionUsed ? 1 : 0);
    if (this.motionUsed) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.motionTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this.motion);
    }
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

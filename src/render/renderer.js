// Draws a grid of coloured glyphs with a single full-screen WebGL2 pass.
//
// The CPU fills two cell buffers each frame: `fg` (rgb + glyph index in alpha)
// and `bg` (rgb). They are uploaded as textures and the fragment shader looks
// up the glyph in the atlas for every pixel, so cost is independent of how
// many characters are on screen.

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
out vec4 outColor;

void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y) + uOffset;
  vec2 cell = floor(p / uCell);
  vec2 local = (p - cell * uCell) / uCell;
  ivec2 ci = ivec2(cell);

  vec4 fg = texelFetch(uFg, ci, 0);
  vec3 bg = texelFetch(uBg, ci, 0).rgb;

  float g = floor(fg.a * 255.0 + 0.5);
  vec2 gcell = vec2(mod(g, uAtlasCols.x), floor(g / uAtlasCols.x));
  vec2 inner = uAtlasCell - 2.0 * uAtlasPad;
  vec2 apx = gcell * uAtlasCell + uAtlasPad + local * inner;
  float lod = clamp(log2(inner.y / uCell.y), 0.0, 2.5);
  float a = textureLod(uAtlas, apx / uAtlasSize, lod).r;

  outColor = vec4(mix(bg, fg.rgb, a), 1.0);
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
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.atlas = atlas;

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
      'uAtlasCell', 'uAtlasPad', 'uAtlasSize']) {
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.fgTex = dataTexture(gl);
    this.bgTex = dataTexture(gl);

    gl.uniform1i(this.u.uFg, 0);
    gl.uniform1i(this.u.uBg, 1);
    gl.uniform1i(this.u.uAtlas, 2);
    gl.uniform2f(this.u.uAtlasCols, atlas.cols, atlas.rows);
    gl.uniform2f(this.u.uAtlasCell, atlas.cellW, atlas.cellH);
    gl.uniform1f(this.u.uAtlasPad, atlas.pad);
    gl.uniform2f(this.u.uAtlasSize, atlas.canvas.width, atlas.canvas.height);

    this.cols = 0;
    this.rows = 0;
  }

  // Cell size is given in CSS pixels; it is snapped to whole device pixels so
  // glyph edges stay crisp.
  resize(cssW, cssH, dpr, cellW, cellH) {
    const gl = this.gl;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.cellW = Math.max(2, Math.round(cellW * dpr));
    this.cellH = Math.max(3, Math.round(cellH * dpr));
    // One spare row and column so sub-cell scrolling never exposes a gap.
    this.cols = Math.ceil(this.canvas.width / this.cellW) + 1;
    this.rows = Math.ceil(this.canvas.height / this.cellH) + 1;
    this.fg = new Uint8ClampedArray(this.cols * this.rows * 4);
    this.bg = new Uint8ClampedArray(this.cols * this.rows * 4);

    for (const tex of [this.fgTex, this.bgTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.cols, this.rows, 0, gl.RGBA,
        gl.UNSIGNED_BYTE, null);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  clear(r = 0, g = 0, b = 0) {
    const { fg, bg } = this;
    fg.fill(0);
    for (let i = 0; i < bg.length; i += 4) {
      bg[i] = r;
      bg[i + 1] = g;
      bg[i + 2] = b;
    }
  }

  put(x, y, glyphIndex, r, g, b) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = (y * this.cols + x) * 4;
    this.fg[i] = r;
    this.fg[i + 1] = g;
    this.fg[i + 2] = b;
    this.fg[i + 3] = glyphIndex;
  }

  putBg(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = (y * this.cols + x) * 4;
    this.bg[i] = r;
    this.bg[i + 1] = g;
    this.bg[i + 2] = b;
  }

  // offsetX/offsetY: how far (in device px) the grid is scrolled into its
  // first cell, so the camera can move smoothly between cells.
  draw(offsetX = 0, offsetY = 0) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE,
      this.fg);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE,
      this.bg);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    gl.uniform2f(this.u.uView, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.uCell, this.cellW, this.cellH);
    gl.uniform2f(this.u.uOffset, offsetX, offsetY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

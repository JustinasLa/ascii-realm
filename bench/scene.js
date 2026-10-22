// Dependency-free CPU benchmark, usable from Node or a browser console.
// Pass another checkout URL to measure exactly the same workload before/after.
export async function createScene(root = new URL('../', import.meta.url), options = {}) {
  const load = (path) => import(new URL(`src/${path}.js`, root));
  const [worldModule, { Player }, figure, { Grass }, { drawGround }, { drawSkyReflection },
    { reflector }, propsModule, { Camera }, { AsciiRenderer }] = await Promise.all([
    load('world/world'), load('entities/player'), load('entities/figure'), load('world/grass'),
    load('world/ground'), load('world/sky'), load('world/reflection'), load('world/props'),
    load('world/camera'), load('render/renderer'),
  ]);
  const { width = 390, height = 844, cell = 8, seed = 1 } = options;
  const world = new worldModule.World(seed);
  const player = new Player(world.spawn.x, world.spawn.y);
  if (options.x !== undefined) { player.x = options.x; player.y = options.y; }
  const camera = new Camera(player.x, player.y - 11);
  const grass = new Grass();
  const cols = Math.ceil(width / (cell * worldModule.ASPECT)) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const { drawProp } = propsModule;
  // Older checkouts have no fine bakes.
  const { bakeFine } = await import(new URL('src/world/fine-bakes.js', root)).catch(() => ({}));
  const r = Object.assign(Object.create(AsciiRenderer.prototype), {
    cellW: cell * worldModule.ASPECT, cellH: cell, dpr: 1, canvas: { width, height },
  });
  // Older checkouts have no allocate(); build the buffers they read.
  if (r.allocate) r.allocate(cols, rows);
  else {
    Object.assign(r, { cols, rows, fg: new Uint8ClampedArray(cols * rows * 4),
      bg: new Uint8ClampedArray(cols * rows * 4), ov: new Uint8ClampedArray(cols * rows * 4),
      mask: new Uint8Array(cols * rows) });
  }
  let time = 0;
  const move = { x: 0, y: 0 };
  function frame(dt = 1 / 60) {
    const timings = {};
    let start = performance.now();
    const mark = (name) => { const now = performance.now(); timings[name] = now - start; start = now; };
    time += dt;
    player.update(dt, world, move, false);
    grass.update(world, player, time);
    player.events.length = 0;
    camera.follow(player.x, player.y - 11, dt);
    const view = camera.view(r);
    mark('update');
    drawGround(r, world, view, time);
    grass.drawTracks(r, view, time, world);
    drawSkyReflection(r, view, time);
    figure.drawShadow(r, view, player.x, player.y, player.air);
    mark('groundAndSky');
    const props = world.propsIn(view.x0 - 30, view.y0 - view.rows,
      view.x0 + view.cols + 30, view.y0 + view.rows + 50);
    const parts = figure.dressFigure(player);
    const mirror = reflector(time, view);
    const drawables = props.map((p) => ({ y: p.y, draw: () => drawProp(r, view, p),
      reflect: () => drawProp(r, view, p, mirror) }));
    drawables.push({ y: player.y, draw: () => figure.drawFigure(r, view, player, parts),
      reflect: () => figure.drawFigure(r, view, player, parts, mirror) });
    drawables.sort((a, b) => a.y - b.y);
    mark('prepareSprites');
    grass.drawReflections(r, world, view, time, mirror, drawables.map((d) => ({ y: d.y, draw: d.reflect })));
    mark('reflections');
    grass.drawLayered(r, world, view, time, drawables);
    figure.drawTrail(r, view, player.trail, player.time);
    figure.drawNameTag(r, view, player, parts, 'Kael');
    mark('grassAndSprites');
    // Fine bakes queued by this frame finish before the next one, so every
    // run draws the same frames. Older checkouts have none.
    if (bakeFine) {
      bakeFine();
      mark('fineBakes');
    }
    return timings;
  }
  return { frame, world, player, grass, camera, renderer: r, move };
}

export const scenarios = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'meadow', width: 390, height: 844, seed: 19, x: 160, y: -120 },
];

export async function benchmark(root, { warmup = 45, frames = 180 } = {}) {
  const results = [];
  for (const scenario of scenarios) {
    const scene = await createScene(root, scenario);
    for (let i = 0; i < warmup; i++) scene.frame();
    const samples = [];
    const stages = {};
    for (let i = 0; i < frames; i++) {
      const timings = scene.frame();
      samples.push(Object.values(timings).reduce((a, b) => a + b, 0));
      for (const [name, ms] of Object.entries(timings)) stages[name] = (stages[name] || 0) + ms / frames;
    }
    samples.sort((a, b) => a - b);
    results.push({ name: scenario.name, cells: scene.renderer.cols * scene.renderer.rows,
      medianMs: samples[Math.floor(frames / 2)], p95Ms: samples[Math.floor(frames * 0.95)],
      meanMs: samples.reduce((a, b) => a + b, 0) / frames, stages });
  }
  return results;
}

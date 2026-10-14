import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { buildRig } from '../src/entities/rig.js';
import { FrameClock, FrameQuality, renderSize } from '../src/render/budget.js';
import { ASPECT, GRASS, WATER } from '../src/world/world.js';

const noop = () => {};

// Run the real frame loop and player state with browser, rendering and audio I/O stubbed.
// A stand-in for systems these tests don't exercise: every method is a no-op
// returning an empty list.
const inert = () => class {
  constructor() {
    this.list = [];
    this.events = [];
    return new Proxy(this, { get: (target, key) => key in target ? target[key] : () => [] });
  }
};

async function loadGame(move = { x: 0, y: 0 }) {
  const taps = new Set();
  const canvas = new EventTarget();
  const window = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
  const hint = { classList: { add: noop, remove: noop }, addEventListener: noop };
  let nextFrame;
  let now = 0;
  let bladeSamples = 0;
  let modelUpdates = 0;
  let cellHeight;
  const model = {
    gaits: [{ key: 'walk', speed: 1 }, { key: 'jog', speed: 3 }],
    update: () => { modelUpdates++; },
    rasterise: noop,
    cells: [],
    waterContacts: () => [],
    torchPose: () => null,
    draw: noop,
    swordLine: () => {
      bladeSamples++;
      return { base: [0, 0], tip: [1, 1] };
    },
  };
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  runInNewContext(source.replace(/^import .*;\r?\n/gm, ''), {
    console, URLSearchParams, window,
    document: { getElementById: id => id === 'screen' ? canvas : hint, hidden: false, addEventListener: noop },
    matchMedia: () => ({ matches: false }), innerWidth: 800, innerHeight: 600,
    cancelAnimationFrame: noop, FrameClock, FrameQuality, renderSize, installTouchControls: noop,
    Grass: inert(),
    MAX_TREE_HALF_WIDTH: 40, MAX_TREE_HEIGHT: 160, MAX_LEAF_DRIFT: 8,
    propInView: () => true, drawLeaves: noop,
    location: { search: '?debug' },
    performance: { now: () => 0 },
    requestAnimationFrame: callback => { nextFrame = callback; },
    isDown: () => false,
    isControlTarget: () => false,
    clearInput: noop, isGameplayBlocked: () => false, setGameplayBlocked: noop,
    Inventory, ITEMS, Hud: inert(), InventoryScreen: inert(),
    GroundItems: inert(), Harvesting: inert(), Collection: inert(), drawItem: noop, drawResource: noop,
    moveAxis: () => move,
    wasTapped: code => taps.delete(code),
    Player, ASPECT, GRASS,
    World: class {
      constructor() { this.spawn = { x: 0, y: 0 }; }
      isWalkable() { return true; }
      typeAt() { return GRASS; }
      propsIn() { return []; }
      propsInView() { return []; }
      waterDepthAt() { return 0; }
    },
    Camera: class {
      constructor(x, y) { this.x = x; this.y = y; }
      follow() {}
      shake() {}
      view() { return { x0: 0, y0: 0, rows: 60, cols: 80 }; }
    },
    Fireflies: class { constructor() { this.list = []; } update() {} draw() {} },
    Dust: class { update() {} draw() {} burst() {} sparks() {} },
    Footprints: class { draw() {} },
    Fires: inert(),
    Torches: inert(),
    WeatherEffects: class extends inert() { constructor() { super(); this.wind = 0; } },
    fireWeatherWind: () => 0,
    Splashes: class {
      react() {} update() {} precipitate() {}
      drawSurface() {} drawContacts() {} drawSpray() {}
    },
    WATER,
    AsciiRenderer: class {
      resize(width, height, pixelRatio, cellW, cellH) { cellHeight = cellH; }
      draw() {}
    },
    buildAtlas: noop, glyph: noop, drawGround: noop, drawSkyReflection: noop,
    drawShadow: noop, drawProp: noop, reflector: noop, dressFigure: noop,
    drawFigure: noop, drawNameTag: noop, drawTrail: noop, putCell: noop,
    ModelFigure: { load: () => Promise.resolve(model) },
    SceneryBuilder: class {
      constructor() { this.enabled = false; }
      drawPreview() {}
    },
    GameAudio: class {
      constructor() { this.music = { update: noop }; this.engine = { setListener: noop }; this.weather = {}; }
      play() {}
      pause() {}
      update() {}
    },
    bindAudioControls: () => Object.assign(() => {}, { updateSong: noop }),
  });
  await Promise.resolve();
  return {
    game: window.game,
    frame: (dt = 1 / 60) => nextFrame(now += dt * 1000),
    bladeSamples: () => bladeSamples,
    modelUpdates: () => modelUpdates,
    cellHeight: () => cellHeight,
    keydown(key, modifiers = {}) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ...modifiers });
      window.dispatchEvent(event);
      return event;
    },
    tap(action) {
      if (action !== 'mouse') {
        taps.add(action);
        return;
      }
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'mouse' }));
      window.dispatchEvent(Object.assign(new Event('pointerup'), { button: 0, pointerType: 'mouse' }));
    },
  };
}

test('an early first animation timestamp does not move time backwards', async () => {
  const { game, frame, tap } = await loadGame();
  tap('Space');
  // The frame clock gives the first frame one nominal step, whatever its stamp.
  frame(-0.02);
  assert.ok(Math.abs(game.player.time - 1 / 60) < 1e-12);
  assert.ok(game.player.windUp > 0, 'the captured jump advances with the first frame');
  const windUp = game.player.windUp;
  frame();
  assert.ok(Math.abs(game.player.time - 2 / 60) < 1e-12);
  assert.ok(game.player.windUp > windUp);
});

test('held movement keeps a finite pose through stale and zero-time frames', async () => {
  const { game, frame } = await loadGame({ x: 1, y: 0 });
  const player = game.player;
  frame(-0.02);
  const first = player.x;
  assert.ok(Math.abs(player.time - 1 / 60) < 1e-12);
  // A repeated or stale timestamp is skipped rather than replayed.
  for (const dt of [0, -0.005]) {
    frame(dt);
    assert.ok(Math.abs(player.time - 1 / 60) < 1e-12);
    assert.equal(player.x, first);
    assert.ok(Number.isFinite(player.bank));
    assert.ok(buildRig(player).head.every(Number.isFinite));
  }
  frame(0.04);
  assert.ok(player.time > 1 / 60);
  assert.ok(player.x > first);
  assert.ok(Number.isFinite(player.bank));
  assert.ok(buildRig(player).head.every(Number.isFinite));
});

test('browser zoom shortcuts do not also change game zoom', async () => {
  const { game, frame, keydown, cellHeight } = await loadGame();
  game.freeze = true;
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    for (const key of ['+', '=', '-', '_']) {
      const event = keydown(key, { [modifier]: true });
      frame();
      assert.equal(event.defaultPrevented, false);
      assert.equal(cellHeight(), 8, `${modifier} + ${key}`);
    }
  }
  keydown('+');
  frame();
  assert.ok(cellHeight() > 8, 'unmodified zoom keys still zoom the game');
});

test('a coarse frame applies the remaining hit stop before returning to normal speed', async () => {
  const { game, frame } = await loadGame();
  game.freeze = true;
  game.player.events.push({ type: 'slam', x: 0, y: 0, strength: 1 });
  frame();
  game.freeze = false;
  // 0.08 s of hit stop at 5% speed, then 0.02 s at full speed.
  frame(0.05);
  frame(0.05);
  assert.ok(Math.abs(game.player.time - 0.024) < 1e-12, `player time: ${game.player.time}`);
});

for (const action of ['Space', 'KeyJ', 'KeyF', 'mouse']) {
  test(`freezing consumes ${action} without changing the pose or replaying it on resume`, async () => {
    const { game, frame, tap } = await loadGame();
    const player = game.player;
    game.freeze = true;
    tap(action);
    frame();
    assert.equal(player.time, 0);
    assert.equal(player.windUp, -1);
    assert.equal(player.combat.move, null);

    game.freeze = false;
    frame();
    assert.ok(player.time > 0);
    assert.equal(player.windUp, -1);
    assert.equal(player.combat.move, null);

    tap(action);
    frame();
    if (action === 'Space') assert.ok(player.windUp >= 0);
    else assert.equal(player.combat.move, 'draw');
  });
}

test('a frozen sword swing keeps its trail bounded and resumes sampling when unfrozen', async () => {
  const { game, frame, bladeSamples, modelUpdates } = await loadGame();
  const player = game.player;
  assert.ok(game.model);
  player.combat.inHand = true;
  player.combat.trailing = true;
  const sample = { t: player.time, hx: 0, hy: 0, tx: 1, ty: 1 };
  player.trail.push(sample);
  game.freeze = true;
  frame(0);
  assert.equal(bladeSamples(), 0);
  assert.equal(modelUpdates(), 0);
  for (let i = 0; i < 600; i++) frame();
  assert.equal(player.time, 0);
  assert.equal(bladeSamples(), 0);
  assert.deepEqual(player.trail, [sample]);

  game.freeze = false;
  player.combat.start('a');
  for (let i = 0; i < 10; i++) frame();
  assert.ok(bladeSamples() > 0);
  assert.ok(modelUpdates() > 0);
  assert.ok(player.trail.some(point => point.t > sample.t));
});

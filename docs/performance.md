# Full-detail performance pass

This report covers the original performance pass. The subsequent requested
water and grass density changes are described in [scene-density.md](scene-density.md).

The optimizations retain the UI overhaul, layered glyphs, grass density,
reflections, weather, character supersampling, controls, audio, inventory,
scenery editing, and multiplayer. They do not change zoom, resolution budgets,
frame caps, effect counts, or animation rates.

- Glyph coverage is uploaded as R8 instead of RGBA. The shader already reads
  only red, so the same coverage and mipmaps use 75% less texture storage.
- Scenery keeps a weakly cached index of contiguous sprite rows. Rows outside
  the view or without any reflected water are rejected before cell shading;
  cell order, layers, tree sway, and player reveal stay unchanged.
- Overlapping reflections reuse the exact same wave noise at each water cell.
  Grass and water reuse noise lattice corners along a row, and sky stars reuse
  their fixed positions. All caches remain bounded or have weak owners.
- The character submits its current pose and a pixel-buffer copy early in the
  frame, while CPU terrain work runs. Cells are read back later in the same
  frame. No previous-frame pose or extra input latency is introduced.

## Measurements

Recorded on 2026-10-14 using Chromium 155, Windows, a Ryzen 7 3800X, and a
GeForce RTX 2070 SUPER. This is the real game at its stationary spawn, with the
3D character loaded, 1280×800 backing pixels, and 27,068 cells. Automatic pixel
scaling was locked to 1 for both builds, including under CPU throttling.
Each sample follows warmup and records 120 frames.

The baseline is the completed UI/detail merge at `da01b94`. The optimized
checkout also includes main's subsequent unloaded-ground fix from `5db0cc5`.
These timings and atlas dimensions describe that measured snapshot, before
the later ASCII artwork and campfire changes in `719223a` and `6738466`.
The optimization is rebased onto those changes; their frame times may differ.

| CPU throttle | Median work, before → after | P95 work, before → after | FPS, before → after |
| --- | --- | --- | --- |
| 1× | 12.1 → 10.7 ms | 13.7 → 14.4 ms | 60.0 → 60.0 |
| 2× | 31.3 → 27.4 ms | 33.1 → 29.0 ms | 30.6 → 34.8 |
| 4× | 64.2 → 57.4 ms | 68.5 → 62.0 ms | 14.9 → 16.5 |
| 6× | 103.8 → 91.5 ms | 118.5 → 102.8 ms | 9.1 → 10.3 |

The atlas is 1344×5642 pixels. Its base texture drops from 30,331,392 to
7,582,848 bytes (28.9 to 7.2 MiB); mipmap storage falls by the same proportion.
The browser compared rendered RGBA and R8 images at cell heights 6, 8, and 24:
zero differing pixel channels. Buffered and direct character readback also
produced identical cells.

CPU throttling does not emulate an old GPU or test a specific low-end device.
The 4× and 6× stress cases remain below 30 FPS at full-screen detail. These
results show lower work and memory use, rather than a guarantee that every old
PC will run smoothly. The normal-speed P95 also varies between runs.

Raw samples and browser assertions are in [performance.json](performance.json).
The earlier grass-only measurements remain in the
[archived phone report](performance-phone-2026-10-13.md); its adaptation and
cell budgets describe that older build, rather than the current game.

## Reproduce

The normal application remains build-free. Run `npm ci`, then `npm start` to
serve the game with multiplayer. Run `npm test` for the application and
rendered-cell regression suite.

For the optional browser checks, install Puppeteer in a separate tooling
folder and set `PUPPETEER_MODULE` to its absolute module directory. This keeps
browser tooling out of the game's runtime dependencies. Set `GAME_URL` to the
running optimized server and optionally `GAME_BASELINE_URL` to a server for a
baseline checkout, then run:

```sh
npm run bench:low-end
npm run test:browser
```

`BENCH_OUTPUT` selects the results directory. The low-end benchmark fixes
detail and resolution, tests 1×/2×/4×/6× CPU throttling, compares atlas pixels
and character cells, and checks movement, jumping, torches, and inventory.
The existing browser suite checks touch layouts, simultaneous touch actions,
zoom, hidden-tab suspension, and WebGL context recovery.

The dependency-free CPU scene benchmark remains available with `npm run
bench`; `node bench/run.mjs path-to-other-checkout` measures another checkout.
That synthetic scene uses the procedural character and is not a game-FPS test.

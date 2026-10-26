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

Raw samples and earlier phone measurements are kept in Git history.

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
zoom, hidden-tab suspension, the phone's play and resume card, full screen
and wake lock (spied on, as headless Chrome may refuse them), page gestures,
the web-app manifest, the phone pacing's wiring, and WebGL context recovery.
It loads the game with `?nogate`, except for the card's own check.

## Phones

Phones pace their frames rather than let them judder. The cap stays at 60
frames a second while a frame's own work fits in 13 ms (of the 16.7 ms a
60th allows), drops to an even 30 after 2 seconds above that, and returns to
60 after 8 seconds below 9 ms. A phone that cannot hold 30 either (work above
30 ms for 6 seconds) draws at most 12,000 cells instead of 40,000, which
enlarges the cells; that comes back, before the rate does, after 8 seconds
below 9 ms. One change happens at a time, nothing is judged in the first 3
seconds after loading (those frames build the world), and a single long frame
(over 250 ms, such as a resume) never counts. A graphics card still late at
the lowest backing resolution also gets the even 30, since fewer frames
queued behind it arrive more evenly; its own time per frame cannot be
measured under the cap, so that 30 holds until the page is reloaded. The
pacing is relearned on every load and never saved. Its constants are `PHONE_PACING` in `src/render/budget.js`.

The GPU check that lowers the backing resolution judges a late frame against
the current cap, so an even 30 is not mistaken for a GPU bottleneck. Fog,
glyph detail and halos are never reduced. Frame metrics (`game.metrics`;
`bubblesMs` is the speech bubbles' share of `workMs`) and both checks use the
real time between frames, while the simulation step stays clamped. Desktops
and tablets keep a fixed 60 cap.

The dependency-free CPU scene benchmark remains available with `npm run
bench`; `node bench/run.mjs path-to-other-checkout` measures another checkout.
That synthetic scene uses the procedural character and is not a game-FPS test.

Trees' shadows and moonbeams are measured at a fixed lakeside scene
(`bench/lakeside.js`, whose `SHAFTS` are the three beams in its view).
`node bench/night-cpu.mjs <before-checkout> . <w> <h> <rounds> <frames> [tier]`
steps both checkouts in one process, a frame each in turn, reporting the
`night` and `shafts` stages (with `off` for the before checkout, the before
build is this one with its beams switched off, so the difference is the
beams' whole cost, the grass's tint included), and also times stalls when walking into a
fresh area and at the widest zoom, and the beams' worst cases: walking fast
across the slots and switching a phone's tier back and forth. `BEFORE_URL=…
AFTER_URL=… node bench/night.cjs` does the same in Chrome, with the beams
switched off as a control (`CONTROL=shadows` switches off the whole night
light instead; `TIER=desktop|phone|reduced` holds the beams' tier; `SPIKES=1`
for the stalls and a walk, `THROTTLE=4` for a slow phone, `TOGGLE=1` to time
the control on and off by turns on one page, free of page-to-page noise).

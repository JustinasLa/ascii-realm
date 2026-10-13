# Phone performance

Measured on 2026-10-13 against `97c6d72` on `feat/19-taller-grass`.
The test machine was a Ryzen 7 3800X, Windows, Node 24.15.0, with Chrome
155.0.8059.39 and an RTX 2070 SUPER for browser checks.

## Repeatable CPU benchmark

`npm run bench` warms each scene for 45 frames and samples 180 frames. Both
revisions run the same scene sizes, seed, animation, grass contacts, ground,
sky, sprite and reflection passes. These times exclude WebGL submission,
fireflies, dust, browser layout and startup; they are not phone FPS estimates.

| Scene, 8 px cells | Cells | Before median | After median | Speedup | After p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Phone portrait, 390 × 844 | 8,881 | 9.28 ms | 1.89 ms | 4.9× | 2.44 ms |
| Phone landscape, 844 × 390 | 8,850 | 9.92 ms | 1.94 ms | 5.1× | 2.63 ms |
| Desktop, 1280 × 800 | 27,068 | 19.04 ms | 3.89 ms | 4.9× | 4.78 ms |
| Meadow, seed 19 | 8,881 | 9.31 ms | 2.21 ms | 4.2× | 2.55 ms |

To compare another checkout without modifying it:

```sh
node bench/run.mjs /path/to/other/checkout
```

The test suite also compares 16 complete foreground/background/terrain buffers
against snapshots captured from the original commit. Movement, sword swings,
jumping, trampled grass and reflections remain byte-for-byte identical at the
same view and time.

## Full browser loop

Chrome mobile emulation used a 390 × 844 viewport, touch input and DPR 3.
The game renders at DPR 1.5: 585 × 1266 backing pixels, 75% fewer pixels than
the original full-DPR buffer, with the same world cell size.

| CPU throttle | Average FPS | p95 frame interval | Median CPU work | Visible cells |
| --- | ---: | ---: | ---: | ---: |
| 1× | 60.0 | 16.8 ms | 2.4 ms | 8,881 |
| 4× | 60.0 | 16.9 ms | 10.9 ms | 8,881 |
| 6×, after adaptation | 58.7 | 16.8 ms | 11.9 ms | 3,484 |

Each row samples 180 rendered frames after warmup (10 seconds at 6× to let
adaptation settle). An additional 360-frame running, jumping and combat check
at 4× covered 360 world columns and reached 58.2 fps, with a 16.8 ms p95 frame
interval. Chunk entry produced an occasional 66.8 ms interval; generation is
still synchronous. That run retained 52 chunks, below the phone limit of 64.

These are desktop Chrome measurements with CPU throttling, not physical-device
results. Phone GPU performance, thermal throttling and iOS Safari remain
unverified on hardware.

The browser smoke check verifies:

- 320 × 568, 375 × 667, 390 × 844 and 844 × 390 layouts, without overflow or
  clipped controls, with touch targets at least 44 px in both dimensions.
- Simultaneous running, jumping and sword input, then touch cancellation
  clearing all held actions and movement.
- Zoom after automatic cell-budget reduction, with no WebGL errors.
- Background tabs stop simulation and rendering; returning resumes correctly.
- Losing and restoring the WebGL context recreates the renderer and resumes
  gameplay. No JavaScript errors were reported.

To run it, serve this checkout on port 8000, then in another terminal use
Node 22.12+ and the optional browser dependency (the game itself has none):

```sh
npm install --no-save --package-lock=false puppeteer@25.13.0
npm run test:browser
```

`GAME_URL` overrides `http://localhost:8000/?debug`. `PUPPETEER_MODULE` may point
to an existing Puppeteer installation. `BENCH_OUTPUT` chooses the result folder;
by default JSON measurements and screenshots go to `ascii-realm-browser-check`
inside the system temporary directory. FPS is reported rather than asserted
because it depends on the machine running the check.

## What changed

- Immutable chunks cache sparse grass roots, height/variation values and static
  terrain shading. Only water and dew need terrain animation each frame.
- Reusable contact fields replace per-blade and per-stroke string/Map lookups.
  Footprint recovery, species, wind and painter order remain intact.
- A summed water mask culls reflections before expensive drawing. Ripple
  displacement is calculated once per row. Offscreen props are skipped and
  their glyphs are baked only when first visible.
- The warrior filters candidate shapes once per cell, keeps the original
  twelve coverage samples, and reuses its shaded raster for its reflection.
- Phones cap DPR at 1.5, backing pixels at 1.2 million and the initial cell
  budget at 14,000. Sustained CPU work above 12 ms reduces the cell budget,
  down to 3,500; recovery uses an eight-second quiet period. This changes the
  visible area by enlarging cells without thinning or disabling tall grass.
- World chunks use bounded least-recently-used eviction: 64 on phones and
  128 on desktop. Terrain and props regenerate deterministically on return.
- Rendering is capped at 60 Hz, including on high-refresh displays, and
  suspends when hidden or while the WebGL context is lost.

The smaller backing buffer follows [MDN's WebGL performance guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
Touch ownership and cancellation follow the [Pointer Events model](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events).

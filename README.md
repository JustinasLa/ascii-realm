# ASCII Realm

> A browser world drawn entirely in ASCII, where a hooded outlaw fights, casts runes and explores by torchlight.

ASCII Realm renders every frame as a grid of coloured glyphs. Grass sways as
`\ | /` blades, lakes ripple with `- ~ ≈` and mirror the night sky, and the
player is a rigged 3D outlaw converted into shaded characters each frame. The
world is generated as you walk, and up to eight friends can share it.

**Play:** https://justinasla.github.io/ascii-realm/

## Features

- **Glowcap mushrooms** — pale caps and teal stems growing in clusters. Walking nearby makes them wobble fluidly and release spores that float upward. Press `E` (or tap SPORES, which appears nearby on touch screens) for a larger rising burst.
- **Infinite seeded world** — lakes, shorelines, meadows, dirt paths and rocky outcrops generate in chunks as you walk; `?seed=42` picks another world.
- **Living meadows and forests** — wind-swept grass that keeps your footprints, and eight tree species with seasonal palettes, falling leaves and fallen logs.
- **Water and reflections** — wade knee-deep through any lake while the outlaw, trees and stars reflect and break apart on the swell.
- **A motion-captured outlaw** — real walk, run, jump and trick animations, an idle that looks around, breath in the cold, and footprints in dirt and sand.
- **Sword play** — click to cut towards the cursor: draw, guard, a three-hit combo, a running lunge, a plunge from the air and a charged spin; cuts fell trees and mow tall grass.
- **Rune casting** — 40 rune spells across fire, ice, life and water, picked from a hold-to-open rune wheel (middle mouse) and cast at the cursor with `R` or a right click, each with its own ASCII animation and recorded foley, paid for with slowly refilling mana.
- **Monsters** — skeletons that climb from the ground, goblins that stab and flee, trolls with a ground-shaking club and elves that lead their arrows.
- **Fire** — carry and throw a lit torch that sets dry ground alight, and build contained campfires that grow and react to wind and footsteps.
- **Weather and seasons** — 17 weather presets with rain, snow, hail, fog and lightning that lights the ground and can start fires.
- **Satchel and quick slots** — a status frame, nine quick slots, a 24-slot satchel with a carrying limit, and an equipment view drawn in the outlaw's own glyphs.
- **Sound and music** — recorded footsteps and water, weather and wildlife ambience, and 42 original songs chosen by season and weather.
- **Multiplayer lobbies** — share a six-character code to explore the same world together and see each other's movement, swings and rune casts.
- **Scenery builder** — paint terrain and place props, with undo, local saves and JSON export.
- **Phones too** — a decluttered touch layout for portrait or landscape that re-lays out as you turn the phone, with a stick, a thumb attack cluster with aim assist, and pinch zoom. It installs to the home screen, plays full screen, keeps the screen awake, pauses when you switch away, and paces its frames to hold a steady 60 or 30 fps.

## Your first night

**Torch in hand → Draw your sword → Choose a rune → Face what climbs from the ground → Rest by a campfire**

## Documentation

[Project documentation](docs/README.md)

The full feature guide, [controls](docs/controls.md),
[running and hosting](docs/running.md), the
[scenery builder](docs/scenery-builder.md) and the technical notes live in
[`docs/`](docs/README.md). The [casting arena](docs/casting-simulation.html)
lets you practise every rune.

## Running

No build step. Install Node 22+, then:

```sh
npm ci
npm start
# then open http://localhost:8000
```

Any static file server also runs the game solo, for example
`python -m http.server 8000`. A browser with WebGL2 is required. Hosting and
lobby server details are in [running and hosting](docs/running.md).

## Tests

CI uses Node 22. Install dependencies and run the Node test runner:

```sh
npm ci
npm test
```

The suite covers gameplay, movement and combat, input, inventory, rendering
equivalence, memory bounds and frame budgets, the lobby server and protocol,
and every rune's behaviour and presentation. The tests do not run a real
browser or GPU; `npm run bench` and the optional `npm run test:browser` check
(needs Puppeteer) are described in the
[performance notes](docs/performance.md).

### Coverage

CI runs the suite on every push to `main` and every pull request through
`npm run test:coverage`, which adds Node's built-in coverage to the same run:

```sh
npm run test:coverage
```

The script fails, with a non-zero exit, when total coverage across all files
drops below its floors: 95% of lines, 94% of branches and 68% of functions.
The floors live in the `test:coverage` script in `package.json`. They only
ever go up: when coverage rises, raise them to the new totals rounded down to
a whole percent, and never lower them to make a change pass.

Every file a pull request adds or changes reaches 100% line coverage, even
though the floors only check the totals. To check a file, find it in the
coverage report printed after the test results. Files are listed under their
folders, with `line %`, `branch %` and `funcs %` columns and the line numbers
no test runs under `uncovered lines`; the `all files` row holds the totals the
floors check.

## License

Copyright (c) 2026 Justinas Launikonis.

Licensed under the [MIT License](LICENSE). Motion capture, the character
model, three.js and recorded sounds retain their own licenses; see
[credits](docs/credits.md).

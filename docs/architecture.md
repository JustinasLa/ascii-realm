# Source layout

```
src/
  main.js            game loop and wiring
  character/         character sheet rules, realm calendar, the saved roster and skins
                     (skin.js colours both the rigged outlaw, gear.js, and the shape-built
                     figure, figure.js)
  core/              input, touch controls, pointer aiming, ballistics, hashing, noise
  multiplayer/       lobby client, controls, snapshot validation and interpolation
  editor/            scenery builder controls, scene history and persistence
  audio/             lazy Web Audio engine, sampled grass steps, effects, weather, ambience and music
  crafting/          furnace smelting, alloy forging, weapon smithing, the kept furnace, forge and weapon station states and the alloy book
  inventory/         items, satchel, equipment and carry weight
  render/            glyph atlas, WebGL renderer (with a fine grid for trees and rocks), cell writers
  spells/            rune casting simulation, rune definitions by element, animations and sounds
  ui/                status frames, inventory panel, item art (drawn from 3D models) and notifications
  world/             terrain, rivers and their current, drifting river debris, grass and water
                     shading, props and their fine bakes (with a worker), sky, reflections,
                     fireflies, campfires, dust
  entities/          the outlaw: skeleton, clothing, materials, cloak, combat, movement;
                     monsters, animals, predators, birds, fish and horses with their
                     riders, and their figures; hunt drops
```

Animals are described in [wildlife](wildlife.md), horses in [horses](horses.md).

`tools/item-atlas.html` is a dev page (not linked from the game) that draws
every item's inventory picture in every box shape and metal.

`server/` contains the HTTP/WebSocket server and in-memory lobby lifecycle.
The server owns lobby membership, IDs, colours and world seeds. Players
choose a name colour (`multiplayer/tint.js`, shared by the page and the
server): the server accepts only `#rrggbb` (the page tidies what a player
types), lightens it until it reads on every surface that shows a name,
numbers players who share a name, and gives a later same-named player another
colour if theirs would look alike. Nameplates are text in a layer over the
canvas (`ui/nameplates.js`), on an opaque backdrop, so the shader's fog and
vignette never change the colour behind a name.
Each player simulates their own movement and sends bounded pose snapshots at
20 Hz.
Other players interpolate snapshots 100 ms behind and are drawn as the
shape-built outlaw in their own gear. Rune casts are relayed as allowlisted cast
intent and simulated by each client. Chat (`server/chat.js`, rules in
`multiplayer/chat.js`) is relayed by the server, which cleans the text again,
limits each player's rate, and works out who hears a line from the players'
last reported positions. Each listener gets their own copy, muffled by
distance with a seed per message and listener. The speaker gets their words
back clean, and the server only sends notice codes, which the page turns into
text. Chat is not stored. The page draws speech bubbles from the lines it is
relayed (`ui/bubbles.js`); the server knows nothing of them. Played instrument
notes (`server/notes.js`) are relayed as checked note intent to the rest of
the lobby, at most 20 per player a second with bursts of 23, kept on the
player through reconnects; each listener decides by distance whether to play one. Monsters, wildlife and combat are simulated locally;
lobbies do not synchronize enemies or add PvP damage, shared loot or competitive
movement validation. The server uses [ws](https://github.com/websockets/ws) (MIT);
the browser uses its native WebSocket API.

Warm light (`drawFireLight` in `world/fire.js`, used by torches, fires,
spells and burning furnaces and alloy forges in `world/furnace-glow.js`) rakes across stone
by the way it faces (`world/surface-light.js`).
The renderer keeps a normal, gloss and water clarity per cell (`cellLit`,
written by the water shader for riverbed stone glyphs and copied with the
cached ground) and per small cell (`fineLit`, written by `fineAt` from a
rock's fine bake). Anything else drawn over a stone clears it, so it is lit
evenly. Shading is done in the world's frame with the light at its own
height over the ground, and against the ground's own facing, so a level
stone takes the even light and the faces turned to the light more; a rock
not yet fine-baked is lit evenly. A rock's small letters are already near
full brightness in the moonlight, so on them the light shows as colour: the
lit faces turn toward a warm gold (`LIT_INK`), scaled down as a whole rather
than clipped to white. `?debug&pintime=<s>`
freezes the world and holds the render clock, for pixel comparisons.

Trees' moon shadows come from a per-frame night light map
(`world/night-light.js`): one value per world cell over the view and a
margin, saying how much of the night's light reaches the ground there. Each
tree's crown keeps its leaf masses (`canopyOf` in `world/prop-art.js`, taken
in `trees.js` before the branches split them, or from a builder tree's
blobs); `world/canopy.js` bakes them once per tree into a stamp of leaf
layers fixed to world cells (each mass an ellipse seen from above, its edge
broken by world noise, leaned along the moon's ground direction, clipped to
the tree's reach). New stamps are baked a few a frame, stopping once that
frame's baking work (cells times leaf masses) passes `BAKE_WORK`, and fade
in. Each layer keeps `LEAF_GAIN` of the light, down to `GAIN_FLOOR`. The map is built straight
after the frame's props are fetched and has three consumers: it multiplies
the ground drawn so far (skipping water), `Grass.drawRow` scales each root's
light by it, and `drawFine` scales a rock's or tree's ground cells as they
are laid down, so no cell is shaded twice. Warm light is added after it, so
a torch under a tree is as bright as in the open. With no tree near, nothing
is drawn differently.

Moonbeams use the same map: a second layer, `lift`, holds how much more
light than the open sky reaches each cell, so `gainAt` goes above 1 in a
beam and `tintAt` says how far the colours turn toward the moonlight
(`world/moon-tint.js`); the grass and `drawFine` read both at once with
`lightAt`. `world/moon-shafts.js` cuts the world into slots
(`SLOT_W` × `SLOT_H`); half of them, by a hash of the slot and the seed, hold
a beam whose patch centre is not on water. A slot is decided only once
the world has loaded the chunk under its centre, so looking for beams never
generates ground; decided slots are remembered per world and seed. A beam's patch (three lobes with noise-broken edges) and its
column of air (leaning by `COLUMN_STEP`, from the moon's direction) are
baked once into stamps fixed to world cells, within the trees' bake budget.
Each frame `NightLight` picks the beams near the view, nearest first, up to
the device's tier (`SHAFT_TIERS`: desktop, phone, or a phone at its reduced
cells, which has no columns), fades new ones in and dropped ones out (at
most a tier's count more, the faintest dropped at once) and lays the patches
into `lift`, the brighter where two overlap. The ground pass then multiplies
each cell once by both the canopy and the lift, and tints it. After the
layered draw and the contact splashes, before warm light, `drawShafts`
lightens the glyphs in each column (not water, not sprites' small cells) and
lays its motes with `softLayer`, for every column that reaches into the
view, whether or not its patch is on the map; a tier change fades the columns and motes
rather than dropping them. Cloud and lightning scale the beams by the moon's
share (`moonlightOf`). `game.nightLight` (with `shafts`, `tier`, `visible`
and `debugShaftAt`), `game.metrics.nightMs` and `game.metrics.shaftMs` (the
columns alone, included in `nightMs`) are on `?debug`.

The time of day comes from one clock (`world/clock.js`). A day is 24000
ticks (0 sunrise, 6000 noon, 12000 sunset, 18000 midnight); the night half
of the ticks takes `NIGHT_SHARE` of each real day, which only changes how
fast ticks pass. Solo, the clock steps by the world's own step, so the play
card and `?debug&pintime=` hold it; in a lobby it is worked out each frame
from the wall clock (so a hidden tab is right again when it comes back),
and only a pinned frame holds it. Each frame `main.js` asks it for one sky
state, a reused object (daylight, night, stars, the moon's and sun's
visibility, twilight warmth, the moon phase and the scene's grade), and
passes it down: to the sky reflection (`world/sky.js`, which draws the
stars, the moon's phase in `world/moon.js`, the sun and the afterglow by
it), to the sound as its night, and to the renderer as `renderer.sky`.
The grade is applied last in the shader, before the vignette: a lift of
each channel that never clips (`c·g / (1 + c·(g − 1))`), a saturation and
the vignette's colour and strength. Its keys are in `render/palette.js`;
the night key is the identity, which the shader skips, so the night is
drawn as it was before the clock. The state also holds four light levels
that are all exactly 1 at a full-moon midnight, so that night is drawn and
played as before: `moonlight` (the moon's visibility times its phase's
brightness, never below `MOON_FLOOR` of it), `direct` (the moon's or the
sun's, whichever lights the land), `fireflies` (how far into the firefly
hours it is) and `glow`. Night-only effects multiply by them where they
already compute a strength: `NightLight.prepare` takes the sky as
`env.sky`, steps the moonlight to `BEAM_STEPS` so the beams' map is laid
again only once a step through twilight, and shades the canopy by
`direct`; the grass's `light` (`direct`) pales its tips and lights its dew;
`Mushrooms.drawGlow` takes `glow`; and `Fireflies.update` takes `fireflies`
as its presence, each firefly waking at a point from its seed, and one that
takes another's place fading in. Night creatures (`night: true` in
`entities/monsters.js`'s profiles: skeletons and trolls) spawn by the chance
`spawnChance` in `entities/night-spawns.js` gives: 0 outside the night's
hours (ticks 13000-23000), otherwise how likely the sky's light (15 less the
hour's and the weather's darkening) is dark enough, normalised so a clear
night is 1, and 0.8 of it under a new moon. A spawn there also fails where
a fire or a torch in flight lights the ground (`lightSources`,
`lightLevel`). `game.dayClock` (`tick`, `day`, `phase`, `set()`) and
`game.monsters.chances` (each kind's last spawn chance) are on `?debug`.

The season is worked out from the clock's day, never stored
(`world/seasons.js`): `SEASON_DAYS` days each, summer from day 0, so a saved
day, a lobby's shared day and a debug jump all give theirs, and changing
those constants moves every saved world to another season. On a season's
last night each tree wants the next season from its own `turnPoint`, seeded
by its sprite seed. Each frame, `Seasons.update` (`world/season-turn.js`)
sets `world.season` (which new land grows in) and the river debris's, and
walks the frame's props for trees whose season isn't the one they want. A
tree out of view, directly and in the water, is made again by the fine-bake
workers (`rebake` in `world/fine-bakes.js`, at most 24 at once): the worker
rebuilds it from its source in the new season and sends back its ordinary
cells packed in one array (`packCells`) with its fine bake. Trees in view
are asked for first. Landings are applied a millisecond's worth a frame:
the prop takes its new season, cells and fine bake at once, so everything
that reads it sees one season. A tree seen directly or in the water
(`visible`, with the old and new bounds) keeps a turn record beside it
(`withTurn` in `world/prop-art.js`): its old season, cells, leaf colour and
fine bake, its progress `k` over `TURN_SECONDS` (2 s) and its new measures.
While `k < 1`, `drawProp` draws both looks with complementary masks (a
cell's hash against `k`), in small letters if it was drawn in them and in
ordinary cells (and its reflection) otherwise, with the tree's contact
shadow drawn once; a tree that started in ordinary cells takes its new fine
bake (`pending`) only at `k = 1`. Its canopy shadow's strength blends by
`k`, falling leaves born before the landing keep the old season, cells and
colour, and its bounds are the union of both crowns until the record ends,
10 s after landing (the longest leaf's fall), when the new measures are set
exactly. A tree out of view, or any tree behind the play card or in a pinned
frame, lands with no record. Nothing is made
again on the main thread: a tree no worker can make keeps its look
(`game.seasons.failed`). A page joining a lobby holds its season until its
clock is shared; shared, it follows the realm's day with no pin. `game.seasons`
(`name`, `dayOfSeason`, `length`, `pinned`, `pending`, `turning`, `failed`, `finish()`)
and `game.metrics.seasonMs` are on `?debug`.

River debris (`world/debris.js`) is local to each player. Each frame, after
the player and the monsters have moved, it is handed the bodies standing in
the water, works out how each moved, and settles every meeting of a body and
a piece, or of two pieces, in short steps shared by all of them. It never
moves a body: a knock goes into the body's `bump`, which `rivers.js` defines
next to the current's `carry`, and the body slides by both in its own drift.

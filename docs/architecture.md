# Source layout

```
src/
  main.js            game loop and wiring
  core/              input, touch controls, pointer aiming, ballistics, hashing, noise
  multiplayer/       lobby client, controls, snapshot validation and interpolation
  editor/            scenery builder controls, scene history and persistence
  audio/             lazy Web Audio engine, sampled grass steps, effects, weather, ambience and music
  inventory/         items, satchel, equipment, quick slots and carry weight
  render/            glyph atlas, WebGL renderer (with a fine grid for trees and rocks), cell writers
  spells/            rune casting simulation, rune definitions by element, animations and sounds
  ui/                status frames, inventory panel, item art and notifications
  world/             terrain, rivers and their current, drifting river debris, grass and water
                     shading, props and their fine bakes (with a worker), sky, reflections,
                     fireflies, campfires, dust
  entities/          the outlaw: skeleton, clothing, materials, cloak, combat, movement;
                     monsters, animals, predators and their figures, hunt drops
```

Animals are described in [wildlife](wildlife.md).

`server/` contains the HTTP/WebSocket server and in-memory lobby lifecycle.
The server owns lobby membership, IDs, colours and world seeds; each player
simulates their own movement and sends bounded pose snapshots at 20 Hz.
Other players interpolate snapshots 100 ms behind and are drawn as the
shape-built outlaw in their own gear. Rune casts are relayed as allowlisted cast
intent and simulated by each client. Monsters, wildlife and combat are simulated locally;
lobbies do not synchronize enemies or add PvP damage, shared loot or competitive
movement validation. The server uses [ws](https://github.com/websockets/ws) (MIT);
the browser uses its native WebSocket API.

Warm light (`drawFireLight` in `world/fire.js`, used by torches, fires and
spells) rakes across stone by the way it faces (`world/surface-light.js`).
The renderer keeps a normal, gloss and water clarity per cell (`cellLit`,
written by the water shader for riverbed stone glyphs and copied with the
cached ground) and per small cell (`fineLit`, written by `fineAt` from a
rock's fine bake). Anything else drawn over a stone clears it, so it is lit
evenly. Shading is done in the world's frame with the light at its own
height over the ground; a rock not yet fine-baked is lit evenly. `?debug&pintime=<s>`
freezes the world and holds the render clock, for pixel comparisons.

River debris (`world/debris.js`) is local to each player. Each frame, after
the player and the monsters have moved, it is handed the bodies standing in
the water, works out how each moved, and settles every meeting of a body and
a piece, or of two pieces, in short steps shared by all of them. It never
moves a body: a knock goes into the body's `bump`, which `rivers.js` defines
next to the current's `carry`, and the body slides by both in its own drift.

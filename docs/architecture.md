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

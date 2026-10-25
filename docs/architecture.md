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
                     monsters, animals, predators, birds, fish and their figures, hunt drops
```

Animals are described in [wildlife](wildlife.md).

`server/` contains the HTTP/WebSocket server and in-memory lobby lifecycle.
The server owns lobby membership, IDs, colours and world seeds; each player
simulates their own movement and sends bounded pose snapshots at 20 Hz.
Other players interpolate snapshots 100 ms behind and are drawn as the
shape-built outlaw in their own gear. Rune casts are relayed as allowlisted cast
intent and simulated by each client. Chat (`server/chat.js`, rules in
`multiplayer/chat.js`) is relayed by the server, which cleans the text again,
limits each player's rate, and works out who hears a line from the players'
last reported positions. Each listener gets their own copy, muffled by
distance with a seed per message and listener. The speaker gets their words
back clean, and the server only sends notice codes, which the page turns into
text. Chat is not stored. The page draws speech bubbles from the lines it is
relayed (`ui/bubbles.js`); the server knows nothing of them. Monsters, wildlife and combat are simulated locally;
lobbies do not synchronize enemies or add PvP damage, shared loot or competitive
movement validation. The server uses [ws](https://github.com/websockets/ws) (MIT);
the browser uses its native WebSocket API.

River debris (`world/debris.js`) is local to each player. Each frame, after
the player and the monsters have moved, it is handed the bodies standing in
the water, works out how each moved, and settles every meeting of a body and
a piece, or of two pieces, in short steps shared by all of them. It never
moves a body: a knock goes into the body's `bump`, which `rivers.js` defines
next to the current's `carry`, and the body slides by both in its own drift.

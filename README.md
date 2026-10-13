# ASCII Realm

A browser game rendered entirely in ASCII characters. Every frame is a grid of
coloured glyphs: grass is made of `\ | /` blades that sway in the wind, water is
streaked with `- ~ ≈` ripples and reflects whatever stands on the shore, and the
player is an armoured warrior drawn from hundreds of shaded characters.

**Play:** https://justinasla.github.io/ascii-realm/

![An armoured warrior mid-swing on a moonlit lakeshore, reflected in the water](docs/screenshot.png)

Explore procedurally generated terrain solo, or with up to eight friends in a
shared online lobby.

## Features

- **One-pass WebGL2 renderer.** The CPU fills a cell buffer (glyph + colours);
  a fragment shader draws every glyph from a font atlas, so the screen can hold
  tens of thousands of characters at full frame rate.
- **Infinite seeded world.** Lakes, shoreline, meadows, dirt paths and rocky
  outcrops from layered noise, generated in 64×64 chunks as you walk. Add
  `?seed=42` to the URL for a different world.
- **Living grass.** Blades lean with rolling gusts, flash lighter where the wind
  catches them, part around your feet, and hide twinkling dew drops.
- **Water.** Drifting ripple streaks, lapping foam, and a night sky (stars and
  the moon) mirrored in every lake.
- **Reflections.** The wanderer, trees and boulders are mirrored about their own
  base, so the reflection only appears where it would actually reach the water,
  then sways and breaks into slivers with the swell.
- **The warrior.** A 3D skeleton posed every frame, turned to any heading and
  dressed in armour: horned great helm with glowing eyes, layered pauldrons,
  cuirass and crimson tabard, greaves and gauntlets, a greatsword on the back
  and a simulated cape. Every part is rasterised into glyphs with
  supersampling: outlines follow the silhouette with a moonlit rim, and each
  material (plate, mail, cloth, leather, brass) has its own glyph texture.
- **Animation.** Walk and run cycles driven by the ground actually covered, so
  planted feet stay planted, with hip sway, a steady head, leaning into turns
  and into speeding up or stopping. An idle stance that shifts its weight and
  looks around, then kneels to rest; blinking eyes and breath fogging in the
  cold air; jumping with a wind-up and landing squash; and sword play: draw,
  guard, a three-hit combo with glowing swing trails and an overhead chop that
  strikes sparks, shakes the camera and freezes for a beat on impact.
  Footsteps kick up dust and grass and leave prints in dirt and sand.
- **Nameplate.** The warrior's name floats above the helm; add `?name=...` to
  the URL to choose it.
- **Atmosphere.** Fireflies, a vignette, and zoom.
- **Multiplayer lobbies.** Create a lobby and share its six-character code;
  friends enter the code to join the same seeded world. Movement, jumping,
  sword poses, capes, grass interactions, nameplates and reflections are visible
  to everyone. Players have distinct nameplate colours, and brief connection
  drops reconnect automatically. The lobby keeps working when its creator leaves.

## Running

No build step. For solo and multiplayer, install Node 22+ and run:

```sh
npm ci
npm start
# then open http://localhost:8000
```

Open **Multiplayer**, enter your name and click **Create lobby**. Share the code
shown in the panel. Friends open the same website, enter the code and click
**Join lobby**. **Copy invite** shares a link that joins that lobby automatically.
**Leave lobby** returns to solo exploration in the current world.

The server listens on all interfaces so other devices on your network can open
`http://<your-computer's-LAN-IP>:8000`. Set `PORT` or `HOST` to change the binding.
Lobby codes belong to one server: friends must connect to the same server.

For friends over the internet, deploy `npm start` on a Node host with WebSocket
support and an HTTPS reverse proxy that forwards `/multiplayer` upgrades. The
server serves both the game and the lobbies; `/health` is a health-check endpoint.
No database is needed. Lobbies are held in memory and disappear when the last
player leaves, after a 30-second reconnect grace for unexpected disconnects, or
when the server restarts. Use one server process; multiple instances would need
shared room storage and routing.

The game can also run solo on any static file server:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

A browser with WebGL2 is required. Static hosting (including GitHub Pages) cannot
run the lobby server. To use a separately hosted server, expand **Lobby server**
in the panel and enter its HTTPS or WSS address, for example
`https://lobby.example.com` or `wss://lobby.example.com/multiplayer`. Invite links
include that address. You can also use `?server=wss%3A%2F%2Flobby.example.com%2Fmultiplayer`
and `?room=ABC234` URL parameters. Solo gameplay requires no lobby server.

Run the rig, gait, protocol, lobby, reconnect and input tests with:

```sh
npm test
```

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrow keys | Walk |
| `Shift` | Run |
| `Space` | Jump |
| `J` / left click | Strike (repeat for a combo) |
| `F` | Draw or sheathe the sword |
| Mouse wheel / `+` `-` | Zoom |

## Layout

```
src/
  main.js            game loop and wiring
  core/              input, hashing, noise
  multiplayer/       lobby client, controls, snapshot validation and interpolation
  render/            glyph atlas, WebGL renderer, cell writers
  world/             terrain, grass and water shading, props, sky, reflections, fireflies, dust
  entities/          the warrior: skeleton, armour, materials, cape, combat, movement
```

`server/` contains the HTTP/WebSocket server and in-memory lobby lifecycle.
The server owns lobby membership, IDs, colours and world seeds; each player
simulates their own movement and sends bounded pose snapshots at 20 Hz.
Other players interpolate snapshots 100 ms behind. This is cooperative
exploration with cosmetic sword play; it does not add PvP damage or competitive
movement validation. The server uses [ws](https://github.com/websockets/ws) (MIT);
the browser uses its native WebSocket API.

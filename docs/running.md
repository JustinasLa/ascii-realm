# Running and hosting

No build step. For solo and multiplayer, install Node 22+ and run:

```sh
npm ci
npm start
# then open http://localhost:8000
```

Open **Multiplayer**, enter your name and click **Create lobby**. Share the code
shown in the panel. Friends open the same website, enter the code and click
**Join lobby**. **Copy invite** shares a link that joins that lobby. Joining a
lobby on another world seed reloads the page into that world. **Leave lobby**
returns to solo exploration.

The server listens on all interfaces so other devices on your network can open
`http://<your-computer's-LAN-IP>:8000`. Set `PORT` or `HOST` to change the binding.
Lobby codes belong to one server: friends must connect to the same server.

For friends over the internet, deploy `npm start` on a Node host with WebSocket
support and an HTTPS reverse proxy that forwards `/multiplayer` upgrades. The
server serves both the game and the lobbies; `/health` is a health-check endpoint.
No database is needed. Lobbies are held in memory and disappear when the last
player leaves, after a 30-second reconnect grace for unexpected disconnects, or
when the server restarts. Use one server process. Each address may hold 16
connections and create 6 lobbies a minute.

The game can also run solo on any static file server:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

A browser with WebGL2 is required. Static hosting (including GitHub Pages) cannot
run the lobby server. To use a separately hosted server, expand **Lobby server**
in the panel and enter its HTTPS or WSS address, for example
`https://lobby.example.com` or `wss://lobby.example.com/multiplayer`. Invite links
include that address; an invite naming another server fills in the panel but
waits for you to press **Join lobby**. You can also use the `?room=ABC234` and
`?server=...` URL parameters.

To play this checkout on a phone on the same Wi-Fi, open
`http://<computer-LAN-IP>:8000` on the phone after starting the server.

`manifest.webmanifest` and the icons in `assets/icons/` let phones install the
game with **Add to Home Screen**; it opens standalone with the dark theme. Its
start URL and scope are relative, so it works from a sub-path such as GitHub
Pages. There is no service worker, so nothing is cached offline. Phones start
behind a "Tap to play" card and come back from being hidden behind "Tap to
resume"; tools and benchmarks add `?nogate` to skip both.

Tests are described in the [README](../README.md#tests). Run `npm run bench` for
the repeatable CPU benchmark; measurements, browser checks and reproduction
instructions are in the [performance notes](performance.md).

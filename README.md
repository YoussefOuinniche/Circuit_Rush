# Circuit Rush: CS411 Multiplayer Game Arena

A browser-based 3D kart race for 1 to 3 human players per room. Bots fill the grid to 8 karts.
One **Node.js server** acts as the referee. Players open an **HTTP or HTTPS link** in Chrome or Edge: no desktop app, Node.js, or downloads are needed on player computers.

The graphics come from [Turbo Kart Rally](https://github.com/bridge-mind/turbo-kart-rally) (MIT, see `client/game/LICENSE`). The multiplayer networking, rooms, synchronization, item decisions, disconnect handling, and network experiment are additions for this project.

## Run and share

Only the host computer needs Node.js and a copy of this project. From the project folder:

```powershell
npm start
```

The launcher installs missing game dependencies, starts the game server and HTTP gateway, and uses `cloudflared` to create a public link such as `https://random-words.trycloudflare.com`. On Windows it attempts to install `cloudflared` with WinGet if needed; on other systems install `cloudflared` separately to use public sharing.

**Server operator:** open `http://localhost:8081`. This is the room-management dashboard, with no game canvas or player slot. Create a room with a name, difficulty, and lap count. Wait for clients to join, then click **Start race**. Rooms remain open when everyone leaves, and can be closed from the dashboard while no race is running.

**Players:** share the printed HTTPS link (also available to copy in the dashboard). Players open it, press Enter, enter a name, and see **AVAILABLE ROOMS**. New rooms appear automatically, including rooms created while a client is already in the lobby. Players join a room, choose a racer, and wait for the server to start. They cannot create rooms or start races. A race can start with one player plus bots; the server operator never joins the grid.

Keep the host computer awake and the terminal running while people play. Stop with **Ctrl+C**. The public link changes when the tunnel restarts; it is not permanent hosting. Internet access is needed for initial dependency installation and public sharing.

### Local computer or same Wi-Fi

To play without creating a public tunnel:

```powershell
npm run local
```

The server operator opens `http://localhost:8081`. Players on the same network open `http://SERVER-IP:8080`; the launcher prints available LAN addresses. Allow inbound TCP port **8080** in the host firewall for LAN access. `localhost` always refers to the computer opening the link, so do not send a localhost link to other players. The operator dashboard is bound to loopback and is not available through the player link.

Both launch commands also work from the `client` folder. They start the browser server.

### Manual startup

```powershell
npm --prefix client ci
npm run server
```

This serves the same browser game at `http://localhost:8080`, without a public tunnel. If the default npm registry is blocked, use `npm --prefix client ci --registry=https://registry.npmmirror.com`.

The server uses TCP **5000**, UDP **5000**, player HTTP/WebSocket **8080**, and local operator HTTP **8081** by default. `TCP_PORT`, `UDP_PORT`, `WEB_PORT`, and `ADMIN_PORT` environment variables can override them; the admin port otherwise defaults to the web port plus one. Browser players only reach the HTTP/WebSocket gateway; raw TCP/UDP connections run between that gateway and the game server on the host. Public sharing tunnels only the player HTTP port.

## Structure

```text
start.js                          dependency check + server + optional public link
server/server.js                  game server and race rules (Node built-ins only)
server/gateway.js                 HTTP assets + WebSocket-to-TCP/UDP bridge
server/admin.js                   local-only room management API
server/admin/                     operator dashboard HTML, CSS, and JavaScript
server/selftest.js                real TCP/UDP multiplayer smoke test
server/network-stats.test.mjs      network measurement and report tests
client/package.json               Three.js dependency and browser launch commands
client/game/index.html            browser game entry point
client/game/net-shim.js            window.net API over same-origin WebSocket
client/game/src/net.js             protocol selection, kart states, remote smoothing
client/game/src/network-stats.mjs  per-race application measurements
client/game/src/network-report.mjs end-of-race comparison table
client/game/src/main.js            game flow, rendering loop, server messages
client/game/src/menu.js            name entry, lobby, and room screens
client/game/src/*.js               physics, AI, track, items, graphics, audio, HUD
presentation.html                 project presentation (open separately)
```

```text
Player browser -- WebSocket/TCP --> Web gateway -- TCP/UDP --> Game server
                   HTTP(S) link       same host computer
```

The server operator manages rooms and race starts without registering as a player. Each client browser simulates its own kart. The first connected racer also drives the bots; the internal `host` field represents this simulation responsibility, not permission to manage the room. Bot control moves to another racer if needed. Other players' karts are predicted and smoothed toward incoming updates. Rooms and scores are held in memory and reset when the server stops.

## TCP / UDP comparison experiment

**The browser-to-gateway connection always uses WebSocket/TCP.** Pressing **T** switches TCP/UDP only on the gateway-to-game-server connection, which runs locally on the host. These results are not a direct TCP-versus-UDP comparison over each player's internet connection. The live panel and results table explain this scope.

At GO, the **LIVE NETWORK LAB** becomes active. Click **SWITCH TO TCP / UDP**, or press **T**, to change the gateway's outgoing position transport and the server's return transport for your peer updates. Other players choose independently. Login, items, laps, results, and switch commands continue to use reliable TCP on the server leg.

Spend similar amounts of time on both protocols. One human plus bots is enough to collect acknowledgements. The results show time selected, updates attempted/sent, server acknowledgements, unacknowledged updates, simulated drops, average/maximum round-trip time, jitter, message rate, outgoing payload size/rate, and received/stale peer updates. An unused protocol is marked **Not sampled**.

Counters reset per race and measure from GO until your finish, or race end if you do not finish. Late replies received before the results appear count toward the protocol that originally sent the update.

The **UDP loss demo** button, or **L**, deliberately skips about 20% of outgoing UDP-designated position messages before they reach the gateway. TCP messages and heartbeats are unaffected. This demonstrates missing updates; it does not simulate equivalent physical packet loss for TCP.

Measurement definitions:

- RTT is update send to application acknowledgement receipt. It includes both WebSocket journeys, gateway forwarding, and application scheduling; it is not one-way latency.
- Jitter is the mean absolute difference between consecutive RTT samples for that protocol.
- Unacknowledged updates may be lost, delayed, rejected, or have missing replies. This is **not an IP packet-loss measurement**. Operating-system TCP retransmissions are not counted.
- Counts refer to application messages. Payload counts position JSON and the TCP newline delimiter, excluding WebSocket wrapping, protocol headers, replies, heartbeats, and retransmissions. The client assigned bot control also sends bot positions.
- Peer receive counts can be zero when racing alone; server ACKs still work. Sequence numbers reject old updates across switches, and race IDs reject packets from earlier races.

Results initially show a short summary. **See details** expands all measurements and definitions. Deliberately skipped updates are excluded from the confirmation percentage because they were never sent.

## Controls

WASD / arrow keys: drive. Space: drift. E / left Shift: use item. C: look back. Esc: menu (the multiplayer race continues). M: mute. **T:** switch the server-leg position transport. **L:** toggle the 20% UDP loss demo.

## Protocol and race rules

All browser traffic reaches the gateway over WebSocket. Between the gateway and game server:

| Interaction | Protocol |
|---|---|
| Login, room lists, joining, character selection | TCP |
| `race_start`, `loaded`, `go` | TCP |
| Laps, finishes, results, points | TCP |
| Item box claims, uses, hits | TCP |
| Kart positions, heading, speed (~30 updates/s) | TCP or UDP, selected in-game |
| Position acknowledgements | Same transport as the received update |
| Heartbeats (once per second) | TCP, plus UDP when selected |

TCP messages are newline-delimited JSON. UDP datagrams contain JSON with a sequence number. Both use the same ownership and race checks.

- **Rooms:** at most 3 humans; join only in the lobby; only the server operator creates rooms and starts races. These actions use the local admin HTTP API, and client protocol attempts are rejected.
- **Start:** clients send `loaded`; the server sends `go` after everyone loads or a 10-second timeout, triggering each client's countdown.
- **Laps:** reports must be in order and meet a 10-second minimum lap time.
- **Finish:** accepted reports are ordered by server receipt; unfinished karts are ranked by reported progress.
- **Items:** first box claim wins; duplicate projectile-hit claims are ignored.
- **Points:** 10/8/6/5/4/3/2/1 by place, accumulated within the room across races. Disconnected players receive no points.
- **Ownership:** clients report their own kart; the assigned bot-driving client may also report bots. Movement and collisions are simulated by clients.
- **Disconnects:** socket closure or roughly 3 seconds without either transport removes the player. The race continues. Another client takes over bots if needed. Empty rooms return to the lobby and remain available until the operator closes them.

## Checks

```powershell
npm test
```

Runs measurement/report tests and a smoke test with real TCP/UDP sockets, admin-only creation/start, live room discovery, and room lifecycle checks. Test servers use ports 5100–5103. To check browser play manually, open the player link in two windows and log in with different names. Create a room in the separate server dashboard, verify it appears in both lobbies, join it, and start the race from the dashboard.

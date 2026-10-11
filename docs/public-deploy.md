# Putting the public floor on the internet

The backend has two listeners. They are not interchangeable:

| | Operator port (`server.port`, 9520) | Public floor (`public.port`, 9521) |
|---|---|---|
| Who it is for | The Gate machine, crew phones on the venue LAN | Anyone with the public URL |
| Trust model | A loopback peer **is the operator**; LAN devices join with a token | Nobody is ever trusted; every message goes through an allowlist |
| Serves | The full UI, handover, reports, media proxy, QR | `public.html` and its assets, `/ws`, `/health` — nothing else |
| Behind a proxy | **Never.** Refuses any request carrying `X-Forwarded-For` / `CF-Connecting-IP` / `X-Real-IP` / `Forwarded` with a 403 naming the public port | Built for it: default bind `127.0.0.1`, reads the client IP from the proxy's headers for its per-IP cap |

A reverse proxy on the show machine connects from 127.0.0.1. Pointing it at
9520 would make every visitor the operator — token rotation, game mode,
`POST /handover` (stops sACN and exits the process), everything. That is why
the operator port refuses proxied requests instead of trying to tell a proxy
from a person, and why the public listener exists at all.

## What the public listener enforces

- **Allowlisted messages**: draw, effects and shapes, game input and commands,
  exposed patch knobs, a capped preview, naming yourself, presenting a key.
  Each is a live toggle in Settings → Public floor, with **The floor is
  open/closed** as the master switch. Everything else is refused; twenty
  refusals close the socket.
- **Rate limits**: a per-connection token bucket (default 40 msg/s sustained,
  80 burst — drawing batches at 30 Hz); over the rate, messages are dropped
  silently and counted. Text frames over 16 KiB are refused at the socket.
- **Caps answered at the HTTP upgrade**: total connections (503 + Retry-After)
  and per-IP (429), so an over-cap request costs nothing past the handshake.
- **Hello within 5 s, idle timeout 20 min, Origin must match Host** (no
  cross-site WebSocket from a stranger's page).
- **Sessions are in memory**: a public join never writes `config.json` and never
  appears in the remembered-clients list. The roster shows public players
  separately with a **Block** that holds for the run (id and address).
- **Input level**: every public dab and effect is scaled by Settings → Public
  floor → Internet input level, on top of the Floor input fader.
- **No preview by default**: the array is above their heads, and every viewer
  is uplink bandwidth out of the venue. 1–10 fps at ≥ 6× decimation when a
  show wants it.
- **Nothing about the show leaks**: a public connection receives a small
  `public_state` snapshot (what it may do, the game, the geometry), never the
  config or status.

## TLS: let the proxy do it

The app speaks plain HTTP on purpose. Certificates, renewal, HTTP/2, and
header hygiene are the proxy's job; the Cloudflare API token a DNS-01 challenge
needs then lives in the proxy's config, not in the show config this app
broadcasts to every LAN admin. Two deployments cover every case:

### A. cloudflared tunnel (public internet)

TLS terminates at Cloudflare's edge; the tunnel carries plain HTTP to the
listener next to it. Nothing inbound is opened on the venue network.

```yaml
# ~/.cloudflared/config.yml on the show machine
tunnel: <tunnel-id>
credentials-file: /path/to/<tunnel-id>.json
ingress:
  - hostname: play.example.com
    service: http://127.0.0.1:9521
  - service: http_status:404
```

Cloudflare adds `CF-Connecting-IP`, which the listener prefers for its per-IP
cap. Its proxies drop idle WebSockets after about 100 s; the 1 Hz
`public_state` push keeps a quiet phone alive.

### B. Caddy on the show machine (LAN direct path, DNS-01)

For the venue's own Wi-Fi, a local DNS override points `play.example.com` at
the show machine's LAN IP, so phones in the room reach the floor without a
round trip through Cloudflare. Caddy terminates TLS with a certificate
obtained over DNS-01 (the name resolves privately, so HTTP-01 cannot work),
using the Cloudflare DNS plugin:

```caddyfile
play.example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy 127.0.0.1:9521
}
```

Caddy sets `X-Forwarded-For` to the client address; the listener believes it
because the TCP peer is loopback. With both A and B in place, the same URL
works from the dance floor and from home.

Both configurations are managed outside this repository (the ops checkout),
and neither touches port 9520.

### Why not build DNS-01 into the app

It was considered. It would mean an ACME client, a renewal scheduler, rustls
server config, certificate storage, and a Cloudflare API token in the show
config — all duplicating what Caddy does well, and a TLS bug in the app would
take the operator UI down with it. The LAN direct path already needs a proxy
for the certificate, and the internet path needs a tunnel anyway.

## Settings → Public floor

1. **Run the public listener** — binds `public.bind:public.port`. Keep
   `127.0.0.1` with a proxy on this machine; `0.0.0.0` only if the proxy runs
   on another LAN host (then firewall 9521 to that host).
2. **Public URL** — `https://play.example.com`, once it exists. It only feeds
   the ⊕ Connect dialog's **Public** QR and the key links.
3. **What the floor may do** — the live toggles and the input level.
4. **Who is on the floor** — counts, the most recently active players, Block.
5. **Secret keys** — see below.

The listener starts and stops with the checkbox; no restart.

## Secret keys

A key is `{name, secret, perks, on/off, max uses, uses, bloom}`. Hand out the
link (`https://play.example.com/k/<secret>`, also as a QR from the panel) or
the code itself (`?key=<secret>`, or typed into the public page's "Have a
code?"). The phone keeps the secret and presents it on every hello, so the
unlock survives reloads.

Perks are strings. Five override the floor's toggles for the holder — `draw`,
`effects`, `games`, `knobs`, `preview` — so a group can keep drawing while
the floor is closed to everyone else. The public page reads the rest:
`big_brush` (strokes up to half the array), `strobe` (the strobe pad
appears), `cone` (an orange traffic-cone shape pad appears), and
`game:<kind>` for a **hidden game** — `game:perimeter` (GPE's) and
`game:gathering` (the host camp's) today — which gives
the holder a Start pad for that game while nothing else is running, a Stop
while the floor's own game runs, and the games capability whatever the
floor's toggle says. A floor-started game stops by itself after three
minutes without any game input, so a group that wanders off cannot leave
its world over the show; the operator can stop it any time from the Games
tab, and a game the operator started is never the floor's to stop. Adding an
easter egg is adding a string and the code that honours it
(`plans/hidden-modes.md`).

Keys are bearer secrets: a photo of a card spreads one. **Max uses**,
switching a key off, and rolling a new code (🎲) are the controls. Codes are
rate-limited to six attempts a minute per connection, so a short word read
out over the mic is fine for a moment and then switched off.

## Checking a deployment

With the backend running and the floor enabled:

```sh
bun scripts/public-floor-test.ts
# against a real deployment, with a configured key:
PUBLIC_BASE=https://play.example.com OPERATOR_BASE=http://127.0.0.1:9520 KEY=FIREFLY-COMET-47 bun scripts/public-floor-test.ts
```

It verifies the public routes (and that the operator routes are absent), that
the operator port refuses a proxied request, the hello gate, the allowlist,
the rate limiter, the strike limit, and a key.

To try it on a workstation without a proxy: enable the listener, open
`http://127.0.0.1:9521/` in a browser. Under `bun tauri dev` the public page
is `http://localhost:28149/public.html` and talks to port 9521
(`?backend=<port>` to point it elsewhere).

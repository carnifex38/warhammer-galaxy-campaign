# Warhammer Galaxy Campaign

An event app for tabletop campaign nights (Warhammer 40,000 and the Horus Heresy). Players pick a sector, a planet and a
battlezone on an interactive 3D galaxy map, and the gamemaster runs the event: which worlds are in play, what players may
read, and which sectors stay locked in fog.

It is a fan project for private club use. It is not affiliated with or endorsed by Games Workshop, and the lore texts are
short paraphrases written for the app.

## What it does today

- **3D galaxy map**, built procedurally (no image map): sectors, planets, the Great Rift and warp storms. A **40K / 30K** switch
  changes the galaxy between the Dark Imperium and the Horus Heresy.
- **Detailed planets** when selected (Terra, Mars, Macragge, Necromunda, Cadia, Baal, Fenris, Prospero, Caliban and more), plus
  space hulks and the Rock.
- **Information windows** for every sector, planet, space hulk and battlezone, with Info, Intel and Mission tabs.
- **Gamemaster tools** (Host tab): show or hide planets, mark them in play or restricted, set battlezone counts, add space hulks,
  lock sectors behind void-shroud fog, rewrite any text, hide or reveal each section, quick reveal presets and a host preview.
- **Logins** for Guest, Player and Gamemaster.
- Works on phones, tablets and desktop, and installs as an app (PWA).

## Run it

```bash
npm install
npm run dev      # development server
npm run build    # production build
```

## Host it for your players

`server/index.mjs` is a small dependency-free Node server (Node 22.13+; it uses Node's built-in SQLite). It serves the built app and keeps the event state:
the gamemaster's changes are saved on the server and appear on every player's screen within a moment, no reload needed.
It checks the gamemaster password itself, and the text of any section you have hidden (and anything about hidden planets) is
stripped before the event is sent to players.

```bash
npm install
npm run build
GM_PASSWORD="pick-something" npm run serve     # http://localhost:3000
```

Or with Docker (state is kept in a volume, so it survives restarts and rebuilds):

```bash
echo 'GM_PASSWORD=pick-something' > .env
docker compose up -d --build
```

With Docker, `PORT` and `BIND_ADDRESS` in `.env` set where the container is published on the host (default `0.0.0.0:3000`),
e.g. `BIND_ADDRESS=10.0.0.2` and `PORT=5172` to serve only on that address. The server inside the container always uses 3000.

Settings (environment variables): `GM_PASSWORD` (required), `PORT` (3000), `HOST` (0.0.0.0), `DATA_DIR` (`./data`, holds
`campaign.db`), `DIST_DIR` (`./dist`), `TRUST_PROXY` (off; set it to `1` only when a reverse proxy is the only way to reach the
server, so failed logins are counted per player address from `X-Forwarded-For` rather than all players sharing the proxy's).

**Where things are saved.** Everything the server keeps (the map setup, player profiles and their army lists, battlezone claims
and the calendar) is in one SQLite database, `campaign.db` in `DATA_DIR`. Nothing extra needs installing. A server that used the
older JSON files (`state.json`, `profiles.json`, `claims.json`, `calendar.json`) moves them into the database on its first start
and renames them `*.migrated`.

To back up, copy `campaign.db` while the server is stopped, or while it runs use
`sqlite3 data/campaign.db ".backup backup.db"`. The Host tab's event save is a backup of the event too, though it leaves out
players' profiles.

**Reaching it from outside your home.** Players need a public https address (https is also required to install the app on a
phone). The easiest options that need no router changes: a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(`cloudflared tunnel --url http://localhost:3000` for a quick temporary address) or Tailscale Funnel. Then send players the link;
they choose Player, type a callsign and they are in.

For development run `npm run serve` (with a `GM_PASSWORD`) and `npm run dev` side by side; the dev server proxies `/api`.

## Known limits

- **There are no accounts.** Players are just a typed callsign (two people can use the same one), and there is one shared
  gamemaster password. Anyone with the link can enter as a player.
- **Hidden things are hidden from the network, not from the app's built-in text.** The server never sends the text you wrote
  in hidden sections, but the app's built-in lore for every planet ships inside the page, so it can be read by a determined player.
- **One gamemaster at a time.** Two gamemaster tabs open at once will overwrite each other's changes.
- **The first gamemaster to log in publishes the event.** If the server has no saved event yet, whatever is saved in that
  gamemaster's browser becomes the event.

## Roadmap

1. Live battlezone claiming.
2. Organiser tools to place sectors and planets and upload battlezone layouts.
3. Army builders for 40K and 30K.

## Built with

Vite, React, TypeScript, three.js (react-three-fiber).

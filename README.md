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

## Known limits

- **Everything is saved in the browser on one device.** Settings are not shared between devices yet.
- **The logins are only a door sign.** The gamemaster password is `admin`, set in `src/auth.ts`. It sits in the code, so it
  protects nothing until the live-event server exists. Hidden and locked content is not truly hidden from a determined player.

## Roadmap

1. A small live-event server that holds the event state, checks the gamemaster password, and sends players only what they may see.
2. Live battlezone claiming.
3. Organiser tools to place sectors and planets and upload battlezone layouts.
4. Army builders for 40K and 30K.

## Built with

Vite, React, TypeScript, three.js (react-three-fiber).

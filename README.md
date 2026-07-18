# Кораблик — build a boat for treasure ⚓

A 3D "Build a Boat for Treasure"-style arcade game for **Telegram Mini Apps**, built with
**Three.js + Rapier physics**. Build a boat out of blocks on a neon dock, launch it down a
hazard-filled river, wreck spectacularly, bank the gold, rebuild better — together with friends.

## Run it

```bash
npm install
npm run dev          # game on http://localhost:4740 (Telegram MOCK mode in a plain browser)
npm run relay        # optional: multiplayer relay on ws://localhost:8791
```

Open http://localhost:4740 — with no Telegram context it boots in **mock mode**
(fake user "Captain Dev", share links copied to clipboard). Everything is playable.

`npm run typecheck` — strict TS pass. `npm run build` — production bundle in `dist/`.

## The loop

1. **BUILD** (untimed) — tap to place blocks on the plot grid, drag to orbit, pinch to zoom.
   Blocks cost gold; deleting refunds them. A seat is mandatory — the captain rides it.
2. **LAUNCH** — the dock floods, the gate drops, 3‑2‑1‑GO. The current carries you.
3. **SAIL** — 8 stages in three tiers (🟢 1‑3, 🟡 4‑6, 🔴 7‑8), each entry pays **+8 gold**.
   Rocks, gap walls, swinging axes, spinning saws, wall cannons, geysers, spike beds and
   low ceilings chip your blocks; dead blocks snap off physically and float away. Lose the
   seat (or drown, or stall) and the run ends — **gold is banked either way**.
4. **THE WATERFALL** — survive the drop and the spike pool…
5. **THE END** — the chest creaks open: base 50 + 12/stage + time bonus + first‑clear 100.
6. Rebuild richer. Repeat forever.

Three quests (reach stage 5 / wood‑only finish / survive the waterfall) pay bonus gold.
Gold, inventory, boat design, best stage and quest state persist in `localStorage`.

## Controls

| | Mobile (Telegram) | Desktop |
|---|---|---|
| Orbit / zoom | 1‑finger drag / pinch | mouse drag / wheel |
| Place block | tap a face or the plot | click |
| Delete | ✕ toggle, then tap | ✕ toggle + click |
| Rotate (seat/thruster/rudder) | ⟳ button | ⟳ or `R`* |
| Steer | left joystick | `A`/`D` or ←/→ |
| Boost (thrusters, burst + cooldown) | BOOST button | `W` or ↑ |
| Jump / hop seats | JUMP button | `Space` |

*Undo ⟲ reverts the last 30 build actions.*

## Blocks

| Block | Cost | HP | Notes |
|---|---|---|---|
| Wood | 3 | 35 | floats generously — the honest hull |
| Plastic | 5 | 55 | light, slick, glossy |
| Metal | 10 | 115 | armor; sinks without enough hull |
| Gold | 25 | 145 | very heavy, very shiny |
| Seat | 8 | 62 | required; extra seats = crew + jump hops |
| Rudder | 10 | 45 | +85% steering authority each |
| Thruster | 30 | 55 | 2.2s burst, 4.5s cooldown, glorious flames |
| Balloon | 15 | 14 | constant lift; pops if you look at it wrong |
| TNT | 12 | 30 | explodes on a hard hit. Why did you place this |

Starter kit: 24 wood + 1 seat + 30 gold (a ready-made raft is pre-placed on first boot).

## Multiplayer

Real-time co-op over a tiny WebSocket relay (`server/relay.mjs`):

- **⚙ Settings → CREATE ROOM** — get a 5-letter code; **INVITE** shares a
  `t.me/...?startapp=CODE` deep link (mock mode: copies a `?startapp=` URL).
- **Team build**: everyone places blocks on the shared plot in real time (your blocks,
  your inventory; deleting refunds only your own).
- **Sail together**: needs one seat per crew member. The **host** simulates physics and
  streams transforms + block breakage at ~11Hz; guests run a local prediction sim that
  snaps to the host state, and their steering/boost/jump inputs stream back to the host —
  the whole crew steers the same boat. Stage gold, wrecks and the treasure payout are
  host-authoritative events; every crew member gets paid.
- Host leaves → the next player becomes host (build phase only; a run in flight ends).
- Solo fallback: boat designs can also be shared asynchronously as links (Settings → Share boat).

`node server/test-client.mjs <ROOM>` runs a headless guest that joins, places a block and
logs the transform/event stream — handy for protocol smoke tests.

## Architecture

```
src/
  config.ts        every tuning number: blocks, physics, economy, stage layouts
  types.ts         shared types + net protocol messages
  telegram.ts      Telegram WebApp boilerplate (initData, fullscreen, safe areas,
                   haptics, deep links) with a transparent mock mode
  engine/
    renderer.ts    three.js scene, ACES + bloom, sky shader, shadow-following sun
    physics.ts     Rapier world init, fixed-step, contact-force event plumbing
    water.ts       water level & current field (the river's "conveyor") + animated
                   water/waterfall shaders, dock flood state
    particles.ts   pooled GPU point sprites + instanced debris cubes
    audio.ts       WebAudio synth: coins, cracks, booms, thruster loop — no assets
  game/
    blocks.ts      block visual factory, damage tinting, ghost preview, avatars
    builder.ts     build phase: grid, raycast snapping, economy, undo, share codes
    boat.ts        Fleet/Cluster: per-block buoyancy + drag, damage, breakage,
                   connectivity splits ("the boat snapped in half"), wreck culling
    stages.ts      course construction + obstacle behaviors + damage registry,
                   waterfall, plunge pool, treasure chamber & chest
    sail.ts        run orchestration: flood→countdown→sail→wreck/treasure→summary,
                   controls→forces, stage rewards, end conditions, MP streaming
    cameras.ts     build orbit / chase cam / treasure cinematic + screen shake
    controls.ts    floating joystick, boost/jump buttons, keyboard mapping
    state.ts       gold/inventory/design/quests + localStorage persistence
  net/net.ts       WebSocket room client (host-authoritative protocol)
  ui/hud.ts        DOM HUD: palette, popups, banners, modals, boot screen
server/relay.mjs   ~150-line WebSocket room relay (rooms, host handoff, mirroring)
```

Physics notes: each block is a cuboid collider on a compound rigid body; buoyancy applies
per submerged block volume (generous ×1.35 water density — fun first), the river current is
a velocity field that drags submerged blocks, and contact-force events above per-obstacle
thresholds convert to block damage. Breakage recomputes grid connectivity; detached
components become independent floating bodies. Fixed 60Hz substeps, CCD on, block cap 130.

## Deploying as a real Telegram Mini App

1. **Host it over HTTPS** (required by Telegram):
   - `npm run build` → serve `dist/` statically (nginx, Vercel, Netlify, Railway…).
   - Run `node server/relay.mjs` alongside and reverse-proxy `wss://your.host/relay` → `:8791`
     (or set `VITE_RELAY_URL=wss://relay.your.host` at build time). The game runs fine
     without the relay — multiplayer buttons will just report the relay as unreachable.
2. **BotFather**: `/newbot` → then `/newapp`, pick the bot, set the Web App URL to your
   HTTPS host, choose a short name (e.g. `play`).
3. Update `appLink()` in `src/telegram.ts` with your bot/app names
   (`https://t.me/<bot>/<app>?startapp=...`) so invites and boat-share links resolve.
4. Optional: `/setmenubutton` to put the game in the bot's menu button.
5. Deep links: `?startapp=XXXXX` (5 letters) auto-joins a room; `?startapp=boat_<code>`
   imports a shared boat design.

The app calls `ready()`, `expand()`, `requestFullscreen()` (Bot API 8+), disables vertical
swipes, applies `safeAreaInset`/`contentSafeAreaInset` as CSS vars and uses haptic feedback —
tested against the mock and the official `telegram-web-app.js`.

## Tuning

Every gameplay number lives in [src/config.ts](src/config.ts) — block stats, buoyancy,
current speeds per tier, damage thresholds, stage layouts (data-driven obstacle specs),
economy and quest rewards. The physics-feel constants worth fiddling with first:
`PHYS.buoyN`, `PHYS.currentByTier`, `PHYS.turnPower`, `DMG.scale`, `DMG.maxHit`.

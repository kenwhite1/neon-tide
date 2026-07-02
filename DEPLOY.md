# NEON TIDE — deployment status & notes

**Bot:** [@lodkabuildbot](https://t.me/lodkabuildbot) ("лодка строитель")
**Live game:** https://kenwhite1.github.io/neon-tide/
**Source:** https://github.com/kenwhite1/neon-tide
**Hub:** registered as tile `neontide` in `GG/shared/games.ts`, deployed to
https://game-is-game-production.up.railway.app

---

## What is live now

| Piece | Status | Where |
|---|---|---|
| Boat game (solo loop) | ✅ live | GitHub Pages `gh-pages` branch |
| Bot menu button → game | ✅ set | opens the mini app when you open @lodkabuildbot → Menu |
| Bot commands / description | ✅ set | `/start`, `/play` |
| Hub tile "Неон-Тайд" | ✅ deployed | flagship arcade tile in the Game is Game hub |
| Multiplayer relay | ⏸️ prepared, not hosted | needs a Node host (see below) |

## One manual step you still need (BotFather)

The hub tile opens `https://t.me/lodkabuildbot?startapp=gg`. For that deep link to
launch the mini app directly, enable the bot's **Main Mini App** (this is the same
one-time step every game bot in the hub needs — see `GG/DEPLOY.md` §3):

1. Open **@BotFather** → `/mybots` → **@lodkabuildbot**
2. **Bot Settings → Configure Mini App → Enable** → set URL to
   `https://kenwhite1.github.io/neon-tide/`
3. **Main Mini App → Enable** (so `?startapp` opens it).

Until then, players can still open the game via the bot's **Menu button** (already wired).

## Multiplayer (relay) — when you have a Node host

GitHub Pages is static, so the WebSocket relay isn't running there and multiplayer
room join is disabled (solo play is unaffected — it fails gracefully). Everything is
built to run the relay on the same port as the SPA.

**Option A — Railway (once the `game-is-game` project has plan capacity):**
The service was blocked by "Free plan resource provision limit exceeded". When capacity
frees up:
```
cd build-a-boat
railway link --project game-is-game --environment production
railway add --service neon-tide \
  --variables "BOT_TOKEN=<token>" \
  --variables "BOT_USERNAME=lodkabuildbot" \
  --variables "WEBHOOK_SECRET=<random>"
railway domain --service neon-tide        # generate a public URL
railway up --service neon-tide
```
Then point the bot's Main Mini App at the Railway URL instead of Pages, and the relay
(`wss://<domain>/relay`) comes online automatically.

The production server (`server/index.mjs`) already serves the SPA + relay + Telegram
webhook on one port and reads `PORT`, `BOT_TOKEN`, `APP_URL`/`RAILWAY_PUBLIC_DOMAIN`,
`WEBHOOK_SECRET`. `railway.json` + `nixpacks.toml` are in place.

**Option B — any Node host:** `npm install && npm run build && npm start`.

## Local dev
```
npm install
npm run dev            # http://localhost:4740  (Telegram mock mode)
npm run relay          # optional: local multiplayer relay on :8791
```

## Redeploy the static game after code changes
```
npm run build
cd dist && git init -q && git checkout -b gh-pages && touch .nojekyll \
  && git add -A && git commit -qm deploy \
  && git push -f https://github.com/kenwhite1/neon-tide.git gh-pages
```

## ⚠️ Security note
The bot token was shared in plaintext chat. It lives only in Railway env vars and this
machine's shell history — it is **not** committed anywhere in the repo. If that
transcript isn't private, rotate the token in BotFather and update the
`BOT_TOKEN` env var.

# NEON TIDE — deployment status & notes

**Bot:** [@lodkabuildbot](https://t.me/lodkabuildbot) ("лодка строитель")
**Live game (canonical, with multiplayer):** https://neon-tide-production.up.railway.app
**Static mirror (solo only):** https://kenwhite1.github.io/neon-tide/
**Source:** https://github.com/kenwhite1/neon-tide
**Hub:** registered as tile `neontide` in `GG/shared/games.ts`, deployed to
https://game-is-game-production.up.railway.app

---

## What is live now

| Piece | Status | Where |
|---|---|---|
| Boat game (solo + multiplayer) | ✅ live | Railway `neon-tide` (kenwhite1's Projects) |
| Multiplayer relay | ✅ live | `wss://neon-tide-production.up.railway.app/relay` |
| Telegram bot (menu button, webhook, commands) | ✅ wired to Railway | auto-configured by the server on boot |
| Hub tile "Неон-Тайд" | ✅ deployed | flagship arcade tile in the Game is Game hub |
| Static mirror | ✅ live | GitHub Pages (solo fallback, no relay) |

Verified in production: `/api/health` → `{"ok":true}`, relay creates rooms,
webhook returns 200, bundle serves (HTTP 200).

## Railway service

- **Workspace:** kenwhite1's Projects · **Project:** `neon-tide` · **Service:** `neon-tide`
- **Env vars:** `BOT_TOKEN`, `BOT_USERNAME=lodkabuildbot`, `WEBHOOK_SECRET`,
  `APP_URL=https://neon-tide-production.up.railway.app`, `NODE_ENV=production`
- The server (`server/index.mjs`) serves the SPA + relay + Telegram webhook on one
  port and, on boot, sets the bot's menu button + webhook from `APP_URL`.

Redeploy after code changes:
```
cd build-a-boat
railway up --service neon-tide      # (already linked to project neon-tide)
```

## One manual step you still need (BotFather)

The hub tile opens `https://t.me/lodkabuildbot?startapp=gg`. For that deep link to
launch the mini app directly, enable the bot's **Main Mini App** (same one-time step
every hub game bot needs — see `GG/DEPLOY.md` §3):

1. **@BotFather** → `/mybots` → **@lodkabuildbot**
2. **Bot Settings → Configure Mini App → Enable** → URL
   `https://neon-tide-production.up.railway.app`
3. **Main Mini App → Enable**.

Until then, players can open the game via the bot's **Menu button** (already wired to
the Railway URL).

## Local dev
```
npm install
npm run dev            # http://localhost:4740  (Telegram mock mode)
npm run relay          # optional: local multiplayer relay on :8791
```

## Static mirror (GitHub Pages) — optional
Solo-only fallback; the WS relay isn't hosted there. Redeploy:
```
npm run build
cd dist && git init -q && git checkout -b gh-pages && touch .nojekyll \
  && git add -A && git commit -qm deploy \
  && git push -f https://github.com/kenwhite1/neon-tide.git gh-pages
```

## ⚠️ Security note
The bot token was shared in plaintext chat. It lives only in Railway env vars — it is
**not** committed anywhere in the repo. If that transcript isn't private, rotate the
token in BotFather and update the `BOT_TOKEN` env var on the Railway service.

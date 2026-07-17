// Unified production server for NEON TIDE:
//   • serves the built SPA (dist/)
//   • hosts the multiplayer relay on the same port at /relay
//   • runs the Telegram bot (menu button + webhook)
//   • GET /api/health for platform health checks
//
//   node server/index.mjs      (PORT, default 8080)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRelay } from './relay.mjs';
import { setupBot, handleUpdate } from './bot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_USERNAME = process.env.BOT_USERNAME || 'lodkabuildbot';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'neon-tide-hook';
// Railway provides RAILWAY_PUBLIC_DOMAIN; APP_URL overrides.
const APP_URL =
  process.env.APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const hasDist = fs.existsSync(path.join(DIST, 'index.html'));
if (!hasDist) console.warn('[web] dist/ not built yet - run `npm run build`. Serving API only.');

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
  });
}

function serveStatic(req, res, urlPath) {
  // block path traversal, then resolve to a file within dist/
  let rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const full = path.join(DIST, rel);
  if (!full.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      // SPA fallback → index.html
      fs.readFile(path.join(DIST, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME['.html'] }).end(html);
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream' };
    // hashed vite assets are immutable; html/wasm stay fresh-ish
    if (rel.startsWith('assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers).end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, dist: hasDist }));
    return;
  }

  // Telegram webhook
  if (req.method === 'POST' && urlPath === `/bot/${WEBHOOK_SECRET}`) {
    const body = await readBody(req);
    res.writeHead(200).end('ok');
    try {
      const update = JSON.parse(body);
      await handleUpdate({ token: BOT_TOKEN, appUrl: APP_URL, update });
    } catch {}
    return;
  }

  if (!hasDist) {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('NEON TIDE server up. Build the app with `npm run build`.');
    return;
  }
  serveStatic(req, res, urlPath);
});

// multiplayer relay shares this port
attachRelay(server, '/relay');

server.listen(PORT, () => {
  console.log(`[web] NEON TIDE listening on :${PORT}  (dist=${hasDist})`);
  console.log(`[web] APP_URL=${APP_URL || '(unset)'}`);
  setupBot({ token: BOT_TOKEN, appUrl: APP_URL, secret: WEBHOOK_SECRET, botUsername: BOT_USERNAME });
});

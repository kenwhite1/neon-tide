// Minimal Telegram bot wiring for the NEON TIDE mini app.
// No polling loop: we set a webhook and handle /start + the menu button.
// Everything degrades gracefully when BOT_TOKEN is absent (DEV mode).

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function call(token, method, body) {
  try {
    const res = await fetch(API(token, method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json();
    if (!json.ok) console.warn(`[bot] ${method} failed:`, json.description);
    return json;
  } catch (e) {
    console.warn(`[bot] ${method} error:`, e.message);
    return { ok: false };
  }
}

/**
 * Registers the bot's menu button, commands and webhook against APP_URL.
 * Safe to call on every boot - Telegram treats these as idempotent upserts.
 */
export async function setupBot({ token, appUrl, secret, botUsername }) {
  if (!token) {
    console.warn('[bot] BOT_TOKEN not set - running in DEV MODE (no Telegram wiring).');
    return;
  }
  if (!appUrl) {
    console.warn('[bot] APP_URL not set - skipping webhook/menu setup.');
    return;
  }
  const url = appUrl.replace(/\/$/, '');

  // Menu button opens the mini app directly.
  await call(token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: '🚤 Играть', web_app: { url } },
  });

  await call(token, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Построить лодку и отплыть' },
      { command: 'play', description: 'Открыть игру' },
    ],
  });

  await call(token, 'setMyDescription', {
    description: 'NEON TIDE - строй лодку из блоков, гони по неоновой реке сквозь ловушки и забирай золото из сундука. Играй соло или с друзьями.',
  });
  await call(token, 'setMyShortDescription', {
    short_description: 'Строй лодку, пройди реку ловушек, забери сокровище.',
  });

  const hook = `${url}/bot/${secret}`;
  await call(token, 'setWebhook', {
    url: hook,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });

  console.log(`[bot] @${botUsername || '?'} wired → menu button + webhook (${hook})`);
}

/** Handles an incoming Telegram webhook update (message only). */
export async function handleUpdate({ token, appUrl, update }) {
  const msg = update?.message;
  if (!msg?.chat?.id) return;
  const text = String(msg.text || '');
  if (!/^\/(start|play)/.test(text)) return;
  const url = (appUrl || '').replace(/\/$/, '');

  await call(token, 'sendMessage', {
    chat_id: msg.chat.id,
    text:
      '🚤 *NEON TIDE*\n\nСтрой лодку из блоков, отправляй её по неоновой реке сквозь пилы, пушки и водопад - и забирай золото из сундука в конце.\n\nЖми кнопку, чтобы отплыть 👇',
    parse_mode: 'Markdown',
    reply_markup: url
      ? { inline_keyboard: [[{ text: '⚓ Играть', web_app: { url } }]] }
      : undefined,
  });
}

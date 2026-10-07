// Панель «позвать друзей из хаба» для игр без общего каркаса.
//
// Друзья заводятся один раз в хабе и видны всей экосистеме. Эти игры устроены
// очень по-разному (у кого-то токен в localStorage, у кого-то в памяти, у
// кого-то свой прокси), поэтому модуль ничего не берёт из игры: токен запуска
// он достаёт сам из start_param (с запасным вариантом из localStorage) - ровно
// так же, как это делает каждая игра для отчёта о результате.
//
// В хаб ходим прямо из браузера: маршруты /api/sdk/* отдают CORS и
// авторизуются заголовком x-gg-launch, а не кукой.
//
// Запуск не из хаба или друзей ещё нет - панель не создаётся вовсе.

const HUB_URL = (
  (import.meta as any).env?.GG_HUB_URL ?? 'https://game-is-game-hub-production.up.railway.app'
).replace(/\/$/, '');

interface HubFriend { id: number; name: string; color: string; face: string }

/** start_param -> токен запуска (JWT из трёх частей). Иначе это обычный deep-link. */
function decodeLaunchParam(startParam: string | undefined | null): string | null {
  if (!startParam) return null;
  try {
    const token = atob(String(startParam).replace(/-/g, '+').replace(/_/g, '/'));
    return token.split('.').length === 3 ? token : null;
  } catch {
    return null;
  }
}

/** Язык хаба из полезной нагрузки токена запуска: панель говорит на языке витрины. */
function tokenLang(token: string): 'ru' | 'en' {
  try {
    const raw = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(raw)).lng === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

/** Подписи самой панели. Игра передаёт только свою строчку-приглашение. */
const PANEL_EN: Record<string, string> = {
  'Позвать друзей из хаба': 'Invite hub friends',
  'Позвать': 'Invite',
  'Позвали': 'Invited',
  'Позвать всех': 'Invite all',
};

/** Токен запуска: из текущего start_param, иначе из того, что игра сохранила. */
function launchToken(): string | null {
  const sp = (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param;
  const fromParam = decodeLaunchParam(sp);
  if (fromParam) return fromParam;
  for (const key of ['gg_launch', 'gg-launch']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      // игры хранят кто уже раскодированный JWT, кто ещё в виде start_param
      if (raw.split('.').length === 3) return raw;
      const decoded = decodeLaunchParam(raw);
      if (decoded) return decoded;
    } catch { /* приватный режим */ }
  }
  return null;
}

async function hub(path: string, token: string, body?: unknown): Promise<any | null> {
  try {
    const res = await fetch(`${HUB_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body
        ? { 'content-type': 'application/json', 'x-gg-launch': token }
        : { 'x-gg-launch': token },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export interface HubInviteOptions {
  /** Строчка от игры в приглашении («ждём в лобби»). */
  note?: string;
  /** Переводчик игры; по умолчанию оставляем русский как есть. */
  t?: (ru: string) => string;
}

/**
 * Собрать панель и вложить её в host. Возвращает элемент или null, если звать
 * некого. Ошибки наружу не выпускает: игра не должна падать из-за хаба.
 */
export async function mountHubInvite(
  host: HTMLElement,
  opts: HubInviteOptions = {},
): Promise<HTMLElement | null> {
  const token = launchToken();
  if (!token) return null;
  const language = () => document.documentElement.lang === 'en' ? 'en' : document.documentElement.lang === 'ru' ? 'ru' : tokenLang(token);
  const t = (ru: string) => (language() === 'en' ? PANEL_EN[ru] ?? opts.t?.(ru) ?? ru : ru);

  const data = await hub('/api/sdk/friends', token);
  const friends: HubFriend[] = data?.ok ? data.friends : [];
  if (friends.length === 0) return null;

  const sent = new Set<number>();
  const root = document.createElement('div');
  root.className = 'hub-invite';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'hub-invite-open';
  const label = document.createElement('span');
  label.textContent = `👥 ${t('Позвать друзей из хаба')}`;
  const count = document.createElement('span');
  count.className = 'hub-invite-n';
  count.textContent = String(friends.length);
  openBtn.append(label, count);

  const list = document.createElement('div');
  list.className = 'hub-invite-list';
  list.hidden = true;
  openBtn.addEventListener('click', () => { list.hidden = !list.hidden; });

  const invite = async (ids: number[], btn: HTMLButtonElement) => {
    if (ids.length === 0) return;
    ids.forEach(id => sent.add(id));
    btn.disabled = true;
    btn.textContent = t('Позвали');
    await hub('/api/sdk/invite', token, { friendIds: ids, note: opts.note });
  };

  const faces = new Map<number, HTMLElement>();
  for (const f of friends) {
    const row = document.createElement('div');
    row.className = 'hub-invite-row';
    const av = document.createElement('span');
    av.className = 'hub-invite-av';
    av.style.background = f.color;
    faces.set(f.id, av);
    const nm = document.createElement('span');
    nm.className = 'hub-invite-nm';
    nm.textContent = f.name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hub-invite-btn';
    btn.textContent = t('Позвать');
    btn.addEventListener('click', () => { void invite([f.id], btn); });
    row.append(av, nm, btn);
    list.appendChild(row);
  }

  if (friends.length > 1) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'hub-invite-all';
    all.textContent = t('Позвать всех');
    all.addEventListener('click', () => {
      void invite(friends.filter(f => !sent.has(f.id)).map(f => f.id), all);
    });
    list.appendChild(all);
  }

  const repaint = () => {
    if (!root.isConnected) { window.removeEventListener('gg:language-change', repaint); return; }
    label.textContent = `👥 ${t('Позвать друзей из хаба')}`;
    for (const button of list.querySelectorAll<HTMLButtonElement>('.hub-invite-btn')) button.textContent = t(button.disabled ? 'Позвали' : 'Позвать');
    const all = list.querySelector<HTMLButtonElement>('.hub-invite-all'); if (all) all.textContent = t(all.disabled ? 'Позвали' : 'Позвать всех');
  };
  window.addEventListener('gg:language-change', repaint);
  // Лица друзей в образе из хаба: один запрос образов на всю панель. Не
  // получилось - остаются цветные кружки, как раньше.
  void import('./gg/avatarRender').then(async sdk => {
    const avatars = await sdk.ggAvatar(HUB_URL, token);
    const looks = await avatars.looks(friends.map(f => f.id));
    for (const f of friends) {
      const slot = faces.get(f.id);
      if (!slot || !looks[f.id]) continue;
      const img = await avatars.image(64, looks[f.id]);
      if (!img) continue;
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
      slot.style.overflow = 'hidden';
      slot.append(img);
    }
  }).catch(() => {});
  root.append(openBtn, list);
  host.appendChild(root);
  return root;
}

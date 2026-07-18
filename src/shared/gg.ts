// Results SDK - копия GG/shared/sdk.ts (не редактировать руками; Кораблик).
// Контракт «игра → хаб» (§2 библии). Игра рапортует ЧТО
// произошло в матче; сколько это стоит (монеты/XP/прогресс) - решает ТОЛЬКО
// хаб. Поэтому скомпрометированная игра максимум наврёт про исход (ограниченно
// и детектируемо), но не может начислить валюту. Файл общий: типы одинаковы у
// хаба и у клиента игры.

export type MatchOutcome = 'win' | 'loss' | 'draw' | 'finish'
export type MatchMode = 'multi' | 'solo' | 'friends'

/** Что игра сообщает по завершении матча. */
export interface MatchReport {
  /** Дедуп: одна выплата на матч/игрока. Повтор с тем же ключом - идемпотентен. */
  idempotencyKey: string
  result: MatchOutcome
  /** Место 1..N (опц.). */
  placement?: number
  /** Размер лобби. */
  players?: number
  /** Сколько из них живые люди (важно для соц./ранга/анти-чита). */
  humanPlayers?: number
  /** Очки, зависят от игры (опц.). */
  score?: number
  durationSec?: number
  mode?: MatchMode
  /** Свободные данные для игровых достижений (голы, «без потерь» и т.п.). */
  stats?: Record<string, number | boolean | string>
  /** Telegram id живых соперников (для честного Glicko-2 и «Друзей-соперников»). */
  opponents?: number[]
}

export interface ReportResponse {
  ok: boolean
  /** Начислено ли вознаграждение в этом вызове (false при повторе/деньги за пределом капа). */
  rewarded: boolean
  coins: number
  /** Причина, если ok=false. */
  error?: string
}

/**
 * Крошечная интеграция для игры: один вызов на конец матча.
 * Токен запуска игра получает из startapp-параметра (см. §2.6). Хаб дедупит по
 * idempotencyKey, поэтому при сетевом сбое можно безопасно повторить.
 *
 *   await ggReport(HUB_URL, launchToken, { idempotencyKey, result: 'win', ... })
 */
export async function ggReport(
  hubUrl: string,
  launchToken: string,
  report: MatchReport,
): Promise<ReportResponse> {
  try {
    const res = await fetch(`${hubUrl.replace(/\/$/, '')}/api/sdk/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gg-launch': launchToken },
      body: JSON.stringify(report),
    })
    const json = (await res.json().catch(() => ({}))) as ReportResponse
    return res.ok ? json : { ok: false, rewarded: false, coins: 0, error: json.error ?? 'request_failed' }
  } catch {
    return { ok: false, rewarded: false, coins: 0, error: 'network' }
  }
}

// ─── Единая валюта G (§Кошелёк) ────────────────────────────────────────────
// На весь проект один счёт G. Игра НЕ держит своей валюты - читает баланс и
// тратит G у хаба по токену запуска. Хаб - единственная точка изменения баланса.

export interface WalletResponse { ok: boolean; coins: number; error?: string }

/** Прочитать баланс G игрока (по токену запуска). */
export async function ggBalance(hubUrl: string, launchToken: string): Promise<WalletResponse> {
  try {
    const res = await fetch(`${hubUrl.replace(/\/$/, '')}/api/sdk/balance`, { headers: { 'x-gg-launch': launchToken } })
    const json = (await res.json().catch(() => ({}))) as WalletResponse
    return res.ok ? json : { ok: false, coins: 0, error: json.error ?? 'request_failed' }
  } catch {
    return { ok: false, coins: 0, error: 'network' }
  }
}

/** Списать G (например, покупка косметики в игре). Идемпотентно по idempotencyKey. */
export async function ggSpend(
  hubUrl: string,
  launchToken: string,
  spend: { amount: number; reason?: string; ref?: string; idempotencyKey?: string },
): Promise<WalletResponse> {
  try {
    const res = await fetch(`${hubUrl.replace(/\/$/, '')}/api/sdk/spend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gg-launch': launchToken },
      body: JSON.stringify(spend),
    })
    const json = (await res.json().catch(() => ({}))) as WalletResponse
    return res.ok ? json : { ok: false, coins: 0, error: json.error ?? 'request_failed' }
  } catch {
    return { ok: false, coins: 0, error: 'network' }
  }
}

export interface EarnResponse { ok: boolean; coins: number; credited?: number; capped?: boolean; error?: string }

/**
 * Начислить G за игровое событие (килл, собранный ресурс, забег…). Хаб -
 * единственная точка изменения баланса: идемпотентно по idempotencyKey и с
 * общим дневным потолком заработка из игр (при достижении capped=true,
 * credited=0). Возвращает новый баланс G.
 *
 *   await ggEarn(HUB_URL, launchToken, { amount: 1, reason: 'kill', idempotencyKey })
 */
export async function ggEarn(
  hubUrl: string,
  launchToken: string,
  earn: { amount: number; reason?: string; ref?: string; idempotencyKey?: string },
): Promise<EarnResponse> {
  try {
    const res = await fetch(`${hubUrl.replace(/\/$/, '')}/api/sdk/earn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gg-launch': launchToken },
      body: JSON.stringify(earn),
    })
    const json = (await res.json().catch(() => ({}))) as EarnResponse
    return res.ok ? json : { ok: false, coins: 0, error: json.error ?? 'request_failed' }
  } catch {
    return { ok: false, coins: 0, error: 'network' }
  }
}

// ─── Доставка токена запуска через startapp (§2.3) ─────────────────────────
// Токен запуска - это JWT, а в нём есть точки; Telegram `startapp` разрешает
// только [A-Za-z0-9_-] (≤512 симв.), поэтому точки туда нельзя. Заворачиваем
// токен в base64url БЕЗ паддинга - так он безопасно едет в ссылке на игру.
// Хаб: `?startapp=${encodeLaunchParam(token)}`. Игра: раскодирует start_param.
// Обе функции чистые (btoa/atob есть и в Node ≥18, и в браузере), токен - ASCII.

/** Хаб → ссылка на игру: завернуть токен запуска для startapp. */
export function encodeLaunchParam(launchToken: string): string {
  return btoa(launchToken).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Игра ← start_param: развернуть токен запуска (или null, если это не он). */
export function decodeLaunchParam(startParam: string | undefined): string | null {
  if (!startParam) return null
  try {
    const token = atob(startParam.replace(/-/g, '+').replace(/_/g, '/'))
    // Токен запуска - это JWT (три сегмента через точку). Иначе это обычный
    // deep-link (напр. 'gg' / реф-код) - не токен.
    return token.split('.').length === 3 ? token : null
  } catch {
    return null
  }
}

/**
 * Язык хаба из токена запуска (§i18n): 'ru' | 'en' | null.
 * Игра читает claim `lng` из payload JWT (без проверки подписи - это лишь
 * подсказка интерфейса, не право на награду), чтобы открыться на том же языке,
 * что и хаб. null - игра открыта не из хаба, язык определяет сама.
 *
 *   const lang = launchLang(window.Telegram?.WebApp?.initDataUnsafe?.start_param)
 *   if (lang) setLang(lang)
 */
export function launchLang(startParam: string | undefined): 'ru' | 'en' | null {
  const token = decodeLaunchParam(startParam)
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.lng === 'en' ? 'en' : payload.lng === 'ru' ? 'ru' : null
  } catch {
    return null
  }
}

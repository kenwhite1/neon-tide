// Интеграция с хабом Game is Game: игра рапортует исход заплыва, хаб решает
// награду. Всё fire-and-forget - хаб недоступен, НЕОН-ТАЙД живёт дальше.
//
// У НЕОН-ТАЙДА нет ни сервера с авторизацией, ни своей БД (только релей для
// мультиплеера и localStorage), поэтому токен запуска живёт в памяти вкладки:
// приехал в startapp - держим до конца заплыва.

import { ggReport, ggBalance, ggSpend, ggEarn, decodeLaunchParam, type MatchMode } from './shared/gg';
import { tg } from './telegram';

// GG_HUB_URL прокинут в бандл через envPrefix в vite.config.ts (сервера со
// своим окружением у игры нет - читать переменную в рантайме неоткуда).
const HUB_URL = ((import.meta as any).env?.GG_HUB_URL ?? 'https://game-is-game-hub-production.up.railway.app').replace(/\/$/, '');

let launchToken: string | null = null;

/** Токен запуска из startapp. Коды комнат и 'boat_...' токеном не являются. */
export function storeLaunchToken(startParam: string | undefined): void {
  const token = decodeLaunchParam(startParam);
  if (token) launchToken = token;
}

export interface RunFacts {
  /** Уникален для пары «заплыв + игрок»: хаб дедупит выплату по нему. */
  idempotencyKey: string;
  /** Сундук забран. Иначе лодка развалилась по дороге - это не финиш. */
  finished: boolean;
  players: number;
  humanPlayers: number;
  mode: MatchMode;
  durationSec: number;
  score: number;
  stats: Record<string, number | boolean>;
}

/** Один вызов на конец заплыва. */
export function reportRun(f: RunFacts): void {
  if (!HUB_URL || !launchToken) return;
  void ggReport(HUB_URL, launchToken, {
    idempotencyKey: f.idempotencyKey,
    // 'finish' - заплыв доведён до сундука (кормит successes_game_neontide).
    // Разбитая лодка финишем не была, поэтому 'loss'.
    result: f.finished ? 'finish' : 'loss',
    players: f.players,
    humanPlayers: f.humanPlayers,
    score: f.score,
    durationSec: f.durationSec,
    mode: f.mode,
    stats: f.stats,
  }).catch(() => {});
}

/** Стабильный id заплыва: игрок + момент старта. */
export function newRunId(): string {
  return `neontide-${tg.user.id}-${Date.now()}`;
}

// ─── Единый кошелёк G ───────────────────────────────────────────────────────
// Когда игра запущена из хаба (есть токен запуска и HUB_URL), баланс золота -
// это счёт G хаба: читаем его через ggBalance, тратим через ggSpend. Хаб -
// единственная точка изменения баланса. Без токена (обычный браузер / прямой
// deep-link) игра живёт на локальном балансе, как раньше.

/** Игра запущена из хаба и умеет говорить с кошельком G. */
export function hubWalletEnabled(): boolean {
  return !!HUB_URL && !!launchToken;
}

/** Прочитать баланс G. null - хаб недоступен или ответил ошибкой (fallback). */
export async function hubBalance(): Promise<number | null> {
  if (!HUB_URL || !launchToken) return null;
  const r = await ggBalance(HUB_URL, launchToken);
  return r.ok ? r.coins : null;
}

/**
 * Списать G у хаба (идемпотентно по idempotencyKey). Возвращает новый баланс,
 * либо null если хаб недоступен/отказал - вызывающий сам решает про fallback.
 */
export async function hubSpend(
  amount: number,
  reason: string,
  ref: string,
  idempotencyKey: string,
): Promise<number | null> {
  if (!HUB_URL || !launchToken) return null;
  const r = await ggSpend(HUB_URL, launchToken, { amount, reason, ref, idempotencyKey });
  return r.ok ? r.coins : null;
}

/**
 * Начислить G у хаба за игровое событие (идемпотентно по idempotencyKey). Хаб
 * применяет дневной потолок заработка. Возвращает новый баланс, либо null если
 * хаб недоступен/отказал - вызывающий сам решает про fallback.
 */
export async function hubEarn(
  amount: number,
  reason: string,
  ref: string,
  idempotencyKey: string,
): Promise<number | null> {
  if (!HUB_URL || !launchToken) return null;
  const r = await ggEarn(HUB_URL, launchToken, { amount, reason, ref, idempotencyKey });
  return r.ok ? r.coins : null;
}

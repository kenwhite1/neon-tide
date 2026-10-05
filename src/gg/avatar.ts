// ВНИМАНИЕ: копия GG/shared/avatar.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
// Avatar SDK - «один образ, три рендера» (§3D-2D-Rendering-Strategy, §10 библии).
//
// Косметику игрок покупает в хабе. Чтобы надетое было видно В ИГРЕ - и в 2D, и
// в 3D - игре нужны две вещи: что надето (образ) и чем это рисовать (арт). Обе
// приезжают по HTTP, поэтому новая шляпа появляется во всех играх БЕЗ их
// передеплоя: игра каждый запуск берёт свежий манифест.
//
//   манифест   GET  /api/sdk/avatar      публичный, кешируется по версии арта
//   свой образ GET  /api/sdk/look        по токену запуска
//   чужие      POST /api/sdk/looks       по токену запуска, до 64 id за раз
//
// Здесь - КОНТРАКТ и сеть: типы, нормализация, хеш образа, три вызова. Без
// зависимостей и без DOM, поэтому файл читают и хаб, и сервер, и игра.
// Композиция слоёв в <canvas> живёт рядом, в avatarRender.ts (там нужен
// браузер). Игра копирует к себе оба файла и импортирует второй.

/**
 * Боевой хаб. Тот же адрес уже зашит запасным значением в каждой игре
 * (GG_HUB_URL в server/src/gg.ts), поэтому клиенту не нужно ничего настраивать:
 * аватар работает сразу после установки SDK.
 */
export const GG_HUB_DEFAULT = 'https://game-is-game-hub-production.up.railway.app'

// ─── Контракт ──────────────────────────────────────────────────────────────

/** Слои, которые НАДЕВАЮТСЯ на тело, снизу вверх. Порядок = порядок отрисовки. */
export const WORN_ORDER = ['top', 'eyewear', 'hat'] as const
export type WornSlot = (typeof WORN_ORDER)[number]

/** Все слои композиции снизу вверх. `body` - крашеный силуэт «Бубла». */
export const AVATAR_LAYERS = ['body', 'face', 'top', 'eyewear', 'hat'] as const
export type AvatarLayer = (typeof AVATAR_LAYERS)[number]

/** Что надето. Подмножество Look хаба: только то, что видно на персонаже. */
export interface AvatarLook {
  /** id предмета слота color (c_teal…) - тело красится его hex из манифеста. */
  color: string
  /** id предмета слота face (f_smile…). */
  face: string
  hat: string
  top: string
  eyewear: string
  /** Перекраска: itemId → поворот оттенка в градусах (§10.6). */
  recolors?: Record<string, number>
}

export interface AvatarManifest {
  /** Версия арта+каталога. Меняется - игра перечитывает и перепекает текстуры. */
  v: string
  /** Сторона квадрата композиции (100 - та же сетка, что у тела и лиц). */
  box: number
  /** Абсолютный префикс URL арта ('' - тот же origin). */
  base: string
  /** Тело «Бубла»: силуэт, тень, блик. */
  body: { mask: string; dark: string; light: string }
  /** id предмета слота color → hex тела. */
  colors: Record<string, string>
  /** id предмета слота face → разметка SVG лица (внутренности <g>). */
  faces: Record<string, string>
  /** id надеваемого предмета → слой. Предметы без арта сюда не попадают. */
  items: Record<string, { slot: WornSlot; url: string }>
}

export const EMPTY_AVATAR_LOOK: AvatarLook = {
  color: 'c_cream', face: 'f_deadpan', hat: 'hat_none', top: 'top_none', eyewear: 'eye_none',
}

/** Приводит произвольный объект к образу: недостающее - дефолт хаба. */
export function normalizeLook(raw: Partial<AvatarLook> | null | undefined): AvatarLook {
  return {
    color: raw?.color || EMPTY_AVATAR_LOOK.color,
    face: EMPTY_AVATAR_LOOK.face,
    hat: raw?.hat || EMPTY_AVATAR_LOOK.hat,
    top: raw?.top || EMPTY_AVATAR_LOOK.top,
    eyewear: raw?.eyewear || EMPTY_AVATAR_LOOK.eyewear,
    ...(raw?.recolors && Object.keys(raw.recolors).length ? { recolors: raw.recolors } : {}),
  }
}

/**
 * Стабильный ключ образа: одинаково считается на сервере и в игре. Им
 * кешируются готовые текстуры и по нему видно, что игрок переоделся.
 */
export function lookHash(look: Partial<AvatarLook>): string {
  const l = normalizeLook(look)
  const rec = l.recolors
    ? Object.keys(l.recolors).sort().map(k => `${k}=${l.recolors![k]}`).join(',')
    : ''
  const s = `${l.color}|${l.face}|${l.top}|${l.eyewear}|${l.hat}|${rec}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

// ─── Сеть ──────────────────────────────────────────────────────────────────

const hubBase = (hubUrl: string) => hubUrl.replace(/\/$/, '')

const manifestCache = new Map<string, Promise<AvatarManifest | null>>()

/** Манифест арта. Один запрос на запуск игры, дальше из памяти. */
export function ggAvatarManifest(hubUrl: string): Promise<AvatarManifest | null> {
  const key = hubBase(hubUrl)
  let p = manifestCache.get(key)
  if (!p) {
    p = fetch(`${key}/api/sdk/avatar`)
      .then(r => (r.ok ? (r.json() as Promise<{ ok?: boolean; manifest?: AvatarManifest }>) : null))
      .then(j => (j?.ok && j.manifest ? j.manifest : null))
      .catch(() => null)
    manifestCache.set(key, p)
  }
  return p
}

/** Образ самого игрока (по токену запуска). null - хаб недоступен/токена нет. */
export async function ggLook(hubUrl: string, launchToken: string): Promise<AvatarLook | null> {
  if (!launchToken) return null
  try {
    const r = await fetch(`${hubBase(hubUrl)}/api/sdk/look`, { headers: { 'x-gg-launch': launchToken } })
    if (!r.ok) return null
    const j = (await r.json()) as { ok?: boolean; look?: Partial<AvatarLook> }
    return j.ok && j.look ? normalizeLook(j.look) : null
  } catch { return null }
}

/** Образы других игроков лобби: до 64 id за вызов. Пустой ответ - не беда. */
export async function ggLooks(hubUrl: string, launchToken: string, uids: number[]): Promise<Record<number, AvatarLook>> {
  const ids = [...new Set(uids.filter(n => Number.isFinite(n) && n > 0))].slice(0, 64)
  if (!ids.length || !launchToken) return {}
  try {
    const r = await fetch(`${hubBase(hubUrl)}/api/sdk/looks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gg-launch': launchToken },
      body: JSON.stringify({ uids: ids }),
    })
    if (!r.ok) return {}
    const j = (await r.json()) as { ok?: boolean; looks?: Record<string, Partial<AvatarLook>> }
    const out: Record<number, AvatarLook> = {}
    for (const [k, v] of Object.entries(j.looks ?? {})) out[Number(k)] = normalizeLook(v)
    return out
  } catch { return {} }
}

// ─── Цвет тела ─────────────────────────────────────────────────────────────
// Тело красится ОДНИМ hex, поэтому перекраску считаем арифметикой, а не
// фильтром canvas: точно, и работает даже там, где ctx.filter нет (вебвью iOS).
// 3D-риг берёт этот же hex материалом меша.
//
// Арифметика - ровно та, что у CSS `hue-rotate()` (матрица из Filter Effects,
// в sRGB): хаб красит <Character> именно этим фильтром (Avatar.tsx → hueFilter),
// и только так перекрашенный «Бубл» в игре того же цвета, что в профиле.
// Поворот по HSL давал на тех же 30° заметно другой оттенок.

function hueMatrix(deg: number): number[] {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}

/** Цвет после CSS `hue-rotate(deg)`. Понимает #rgb и #rrggbb, прочее отдаёт как есть. */
export function hueRotateHex(hex: string, deg: number): string {
  const d = ((deg % 360) + 360) % 360
  if (!d) return hex
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const raw = m[1] ?? ''
  const full = raw.length === 3 ? raw.replace(/./g, ch => ch + ch) : raw
  const n = parseInt(full, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const k = hueMatrix(d)
  const ch = (i: number) => {
    const v = (k[i] ?? 0) * r + (k[i + 1] ?? 0) * g + (k[i + 2] ?? 0) * b
    return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  }
  return `#${ch(0)}${ch(3)}${ch(6)}`
}

/** Цвет тела с учётом перекраски - материал для 3D-меша «Бубла». */
export function avatarBodyHex(m: AvatarManifest, look: AvatarLook): string {
  return hueRotateHex(m.colors[look.color] ?? '#f3d9a4', look.recolors?.[look.color] ?? 0)
}

/** Fixed face artwork; body recolors must not tint the eyes. */
export function avatarFaceMarkup(m: AvatarManifest, look: AvatarLook): string | null {
  const markup = m.faces[look.face] ?? m.faces[EMPTY_AVATAR_LOOK.face]
  if (!markup) return null
  return markup
}

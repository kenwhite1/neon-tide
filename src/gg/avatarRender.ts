// ВНИМАНИЕ: копия GG/shared/avatarRender.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
import { wearPlacement } from './wearPlacement'
import { drawWornTop } from './garmentRender'
import { drawAvatarPhoto, photoMaterial } from './photoRender'
// Avatar SDK, половина «рисовать»: композиция образа в <canvas>. Отдельный
// файл потому, что здесь нужен браузер (Image, canvas), а контракт из
// ./avatar.ts читают и сервер хаба, и любой не-браузерный потребитель.
//
// Игра копирует к себе ОБА файла и импортирует только этот - он реэкспортирует
// контракт целиком (scripts/sync-avatar-sdk.mjs раскладывает их сам).
//
//   const av = await ggAvatar(HUB, launchToken)
//   lobby.appendChild((await av.image(64))!)                        // 2D
//   const tex = new THREE.CanvasTexture((await av.canvas(256))!)    // 3D
//
// ── Зачем слои по отдельности ──────────────────────────────────────────────
// В 2D нужен один готовый квадрат. В 3D - нет: там тело это МЕШ (его цвет -
// avatarBodyHex), а на меш кладутся разные куски под разными углами:
//
//   face   лицо + очки  → узкая дуга спереди (сзади лица быть не должно)
//   wear   одежда       → широкий запах вокруг тела (куртка видна со спины)
//   hat    шляпа        → билборд на макушке, читается с любого угла
//
// Поэтому любой вызов принимает список слоёв, а av.parts() отдаёт сразу три
// готовых куска для 3D-рига.
import {
  AVATAR_LAYERS, EMPTY_AVATAR_LOOK, avatarBodyHex, avatarFaceMarkup, ggAvatarManifest, ggLook, ggLooks,
  lookHash, normalizeLook, type AvatarLayer, type AvatarLook, type AvatarManifest,
} from './avatar'

export * from './avatar'
export { trackGamePlaytime } from './playtime'

// ─── Загрузка арта ─────────────────────────────────────────────────────────

const imgCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imgCache.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      // Хаб отдаёт арт с access-control-allow-origin: *. Без crossOrigin canvas
      // станет tainted и WebGL откажется брать из него текстуру - в 3D аватар
      // просто не появится.
      if (!url.startsWith('data:')) img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`avatar art: ${url}`))
      img.src = url
    })
    imgCache.set(url, p)
  }
  return p
}

function faceUrl(markup: string): string {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${markup}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`
}

let filterOk: boolean | null = null
function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  if (filterOk === null) filterOk = typeof (ctx as { filter?: unknown }).filter === 'string'
  return filterOk
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  return c
}

// ─── Композиция ────────────────────────────────────────────────────────────

export interface AvatarRenderOpts {
  /** Сторона текстуры в пикселях. Для 3D держи степень двойки (128, 256, 512). */
  size?: number
  /** Какие слои рисовать. По умолчанию все, снизу вверх. */
  layers?: readonly AvatarLayer[]
  /** Залить фон (иначе прозрачный). */
  background?: string
  /** Фото-тело без фонового «студийного» квадрата: для спрайта в самой игре. */
  transparent?: boolean
}

const canvasCache = new Map<string, Promise<HTMLCanvasElement | null>>()

/**
 * Квадрат size×size с выбранными слоями образа. Результат кешируется по
 * «версия арта + образ + размер + слои», поэтому перерисовка бесплатна, а
 * переодевание игрока само даёт новый ключ.
 *
 * null - в этом образе выбранные слои пусты (нечего рисовать).
 */
export function ggAvatarCanvas(
  m: AvatarManifest, look: AvatarLook, opts: AvatarRenderOpts = {},
): Promise<HTMLCanvasElement | null> {
  const size = Math.max(16, Math.round(opts.size ?? 256))
  const layers = opts.layers ?? AVATAR_LAYERS
  const key = `${m.v}:${lookHash(look)}:${size}:${layers.join('')}:${opts.background ?? ''}:${opts.transparent ? 't' : ''}`
  let p = canvasCache.get(key)
  if (!p) { p = paint(m, look, size, layers, opts.background, opts.transparent); canvasCache.set(key, p) }
  return p
}

async function paint(
  m: AvatarManifest, look: AvatarLook, size: number,
  layers: readonly AvatarLayer[], background: string | undefined, transparent = false,
): Promise<HTMLCanvasElement | null> {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  let drew = false

  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); drew = true }

  for (const layer of AVATAR_LAYERS) {
    if (!layers.includes(layer)) continue

    if (layer === 'body' && m.v.endsWith('-original-photo')) {
      const body = makeCanvas(size)
      await drawAvatarPhoto(body, m.colors[look.color] ?? '#f3d9a4', look.recolors?.[look.color] ?? 0, photoMaterial(look.color), transparent)
      ctx.drawImage(body, 0, 0)
      drew = true
      continue
    }

    if (layer === 'body') {
      // Силуэт красим заливкой (source-in), затем тень и блик поверх - тот же
      // рецепт, что у <Character> в хабе, только без SVG-маски.
      const [mask, dark, light] = await Promise.all([
        loadImage(m.base + m.body.mask), loadImage(m.base + m.body.dark), loadImage(m.base + m.body.light),
      ]).catch(() => [null, null, null] as const)
      if (!mask || !dark || !light) continue
      const body = makeCanvas(size)
      const bctx = body.getContext('2d')
      if (!bctx) continue
      bctx.drawImage(mask, 0, 0, size, size)
      bctx.globalCompositeOperation = 'source-in'
      bctx.fillStyle = avatarBodyHex(m, look)
      bctx.fillRect(0, 0, size, size)
      bctx.globalCompositeOperation = 'source-over'
      bctx.drawImage(dark, 0, 0, size, size)
      bctx.drawImage(light, 0, 0, size, size)
      ctx.drawImage(body, 0, 0)
      drew = true
      continue
    }

    if (layer === 'face') {
      if (m.v.endsWith('-original-photo') && layers.includes('body')) continue // face is already in the photograph
      const markup = avatarFaceMarkup(m, look)
      if (!markup) continue
      const face = await loadImage(faceUrl(markup)).catch(() => null)
      if (!face) continue
      ctx.drawImage(face, 0, 0, size, size)
      drew = true
      continue
    }

    const id = look[layer]
    const item = id ? m.items[id] : undefined
    if (!item || item.slot !== layer) continue
    const img = await loadImage(m.base + item.url).catch(() => null)
    if (!img) continue
    const hue = look.recolors?.[id] ?? 0
    if (layer === 'top') {
      drawWornTop(ctx, img, id!, size, hue)
      drew = true
      continue
    }
    ctx.save()
    if (hue && supportsFilter(ctx)) ctx.filter = `hue-rotate(${((hue % 360) + 360) % 360}deg)`
    const placement = wearPlacement(id)
    ctx.drawImage(img, placement.x * size, placement.y * size, placement.width * size, placement.height * size)
    ctx.restore()
    drew = true
  }

  return drew ? canvas : null
}

/** <img> с образом - то, что нужно лобби, таблице лидеров и экрану результата. */
export async function ggAvatarImage(
  m: AvatarManifest, look: AvatarLook, opts: AvatarRenderOpts = {},
): Promise<HTMLImageElement | null> {
  const canvas = await ggAvatarCanvas(m, look, opts)
  if (!canvas) return null
  const img = new Image(canvas.width, canvas.height)
  img.src = canvas.toDataURL('image/png')
  img.alt = ''
  img.draggable = false
  return img
}

/** Куски для 3D-рига: лицо+очки, одежда, шляпа. Любой может быть null. */
export interface AvatarParts {
  /** Цвет меша тела. */
  bodyHex: string
  face: HTMLCanvasElement | null
  wear: HTMLCanvasElement | null
  hat: HTMLCanvasElement | null
}

/** Always available offline, with the exact photographed eyes and mouth. */
export async function defaultAvatarParts(size = 256): Promise<AvatarParts> {
  const source = makeCanvas(600)
  await drawAvatarPhoto(source, '#f3d9a4')
  const face = makeCanvas(size)
  const ctx = face.getContext('2d')!
  ctx.scale(size / 600, size / 600)
  ctx.beginPath()
  ctx.moveTo(171,194); ctx.lineTo(250,190); ctx.quadraticCurveTo(249,222,215,224); ctx.quadraticCurveTo(177,220,171,194)
  ctx.moveTo(350,190); ctx.lineTo(428,195); ctx.quadraticCurveTo(423,221,387,225); ctx.quadraticCurveTo(352,222,350,190)
  ctx.rect(276,283,53,9)
  ctx.clip()
  ctx.drawImage(source,0,0)
  return { bodyHex: '#08707b', face, wear: null, hat: null }
}

export async function ggAvatarParts(
  m: AvatarManifest, look: AvatarLook, size = 256,
): Promise<AvatarParts> {
  const fixed = await defaultAvatarParts(size)
  const [eyes, wear, hat] = await Promise.all([
    ggAvatarCanvas(m, look, { size, layers: ['eyewear'] }),
    ggAvatarCanvas(m, look, { size, layers: ['top'] }),
    ggAvatarCanvas(m, look, { size, layers: ['hat'] }),
  ])
  if (eyes) fixed.face!.getContext('2d')!.drawImage(eyes,0,0)
  const hex = avatarBodyHex(m, look)
  return { bodyHex: hex.toLowerCase() === '#f3d9a4' ? fixed.bodyHex : hex, face: fixed.face, wear, hat }
}

// ─── Одна ручка на всю интеграцию ──────────────────────────────────────────

export interface GGAvatars {
  /** null - хаб недоступен или арт не разложен: игра рисует как раньше. */
  manifest: AvatarManifest | null
  /** Образ самого игрока (дефолтный «Бубл», если игра открыта не из хаба). */
  me: AvatarLook
  /**
   * Откуда `me`: 'hub' - свежий с хаба, 'cache' - последний известный (хаб не
   * ответил или токен запуска истёк), 'default' - образа игрока мы не знаем.
   * На 'default' игра оставляет своего персонажа - как лобби и значок.
   */
  source: 'hub' | 'cache' | 'default'
  canvas(size?: number, look?: AvatarLook, opts?: AvatarRenderOpts): Promise<HTMLCanvasElement | null>
  image(size?: number, look?: AvatarLook): Promise<HTMLImageElement | null>
  parts(size?: number, look?: AvatarLook): Promise<AvatarParts | null>
  looks(uids: number[]): Promise<Record<number, AvatarLook>>
  /**
   * Перечитать свой образ с хаба. true - игрок переоделся с прошлого раза
   * (`me` уже обновлён, подписчики onChange уже позваны), false - ничего не
   * изменилось или хаб не ответил.
   */
  refresh(): Promise<boolean>
  /**
   * Подписка на переодевание. Хаб и игра - разные мини-приложения: игрок
   * уходит в хаб, покупает шляпу, возвращается - и ждёт увидеть её на себе.
   * Слушаем возврат фокуса, тихо перечитываем образ и зовём `cb` ТОЛЬКО если
   * он правда изменился (сравнение по lookHash - лишних перепеканий текстур
   * не будет). Возвращает отписку.
   */
  onChange(cb: (look: AvatarLook) => void): () => void
}

/**
 * Всё, что нужно игре, одним вызовом. Никогда не бросает и не задерживает
 * запуск: нет сети, арта или токена - вернётся дефолтный «Бубл» с manifest:
 * null, и игра идёт дальше.
 *
 * `hubUrl` - база для JSON-вызовов. Пустая строка = свой же origin: так игра
 * ходит через собственный прокси (см. server.mjs), а картинки всё равно едут
 * прямо с хаба по абсолютному manifest.base.
 */
export async function ggAvatar(hubUrl: string, launchToken: string | null | undefined): Promise<GGAvatars> {
  // Без токена (игру открыли из её бота, по ссылке комнаты или токен истёк)
  // образ всё равно находится по Telegram id - иначе игрок видел бы
  // кремового «Бубла» вместо своего цвета.
  const tg = tgUserId()
  const byTg = async (): Promise<AvatarLook | null> => (tg ? (await ggLooks(hubUrl, null, [tg]))[tg] ?? null : null)
  const [manifest, me] = await Promise.all([
    ggAvatarManifest(hubUrl),
    (launchToken ? ggLook(hubUrl, launchToken) : Promise.resolve(null)).then(l => l ?? byTg()),
  ])
  if (me) rememberLook(me)
  const recalled = me ? null : recallLook()
  let mine = me ?? recalled ?? { ...EMPTY_AVATAR_LOOK }
  let hash = lookHash(mine)
  // Подписчики переодевания - общие на всю ручку: в игре их бывает несколько
  // (риг в сцене + превью в меню), и переодеться должны все, а не тот, чей
  // запрос вернулся первым.
  const subs = new Set<(look: AvatarLook) => void>()

  const refresh = async (): Promise<boolean> => {
    if (!launchToken && !tg) return false
    const next = (launchToken ? await ggLook(hubUrl, launchToken) : null) ?? await byTg()
    if (!next) return false
    rememberLook(next)
    api.source = 'hub'
    const h = lookHash(next)
    if (h === hash) return false
    mine = next
    hash = h
    api.me = mine
    for (const cb of [...subs]) { try { cb(mine) } catch { /* чужая ошибка не валит остальных */ } }
    return true
  }

  // Возврат в игру (фокус/видимость) - один запрос на всех подписчиков.
  let busy = false
  const tick = () => {
    if (busy || document.visibilityState !== 'visible') return
    busy = true
    void refresh().catch(() => {}).finally(() => { busy = false })
  }

  const api: GGAvatars = {
    manifest,
    me: mine,
    source: me ? 'hub' : recalled ? 'cache' : 'default',
    canvas: (size = 256, look = mine, opts = {}) =>
      manifest ? ggAvatarCanvas(manifest, look, { ...opts, size }) : Promise.resolve(null),
    image: (size = 64, look = mine) =>
      manifest ? ggAvatarImage(manifest, look, { size }) : Promise.resolve(null),
    parts: (size = 256, look = mine) =>
      manifest ? ggAvatarParts(manifest, look, size) : Promise.resolve(null),
    looks: uids => ggLooks(hubUrl, launchToken, uids),
    refresh,
    onChange(cb) {
      if ((!launchToken && !tg) || typeof document === 'undefined') return () => {}
      if (!subs.size) {
        document.addEventListener('visibilitychange', tick)
        window.addEventListener('focus', tick)
      }
      subs.add(cb)
      return () => {
        if (!subs.delete(cb) || subs.size) return
        document.removeEventListener('visibilitychange', tick)
        window.removeEventListener('focus', tick)
      }
    },
  }
  return api
}

// ─── Последний известный образ ─────────────────────────────────────────────
// Токен запуска живёт два часа. Игрок, который потом открыл игру прямо из её
// бота, иначе увидел бы дефолтного кремового «Бубла» вместо своего - поэтому
// последний образ с хаба лежит в localStorage и подставляется, пока хаб не
// ответит свежим. Ключ - Telegram id: на общем устройстве чужой образ не всплывёт.

const LS_LOOK = 'gg_look'

function tgUserId(): number | null {
  const tg = (globalThis as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: unknown } } } } }).Telegram
  const id = tg?.WebApp?.initDataUnsafe?.user?.id
  if (typeof id === 'number') return id
  if (typeof location !== 'undefined') for (const p of [new URLSearchParams(location.search), new URLSearchParams(location.hash.replace(/^#/, ''))]) {
    try {
      const user = new URLSearchParams(p.get('tgWebAppData') ?? '').get('user')
      const fromUrl = user ? JSON.parse(user).id : null
      if (typeof fromUrl === 'number') return fromUrl
    } catch { /* optional Telegram bridge metadata */ }
  }
  return null
}

function rememberLook(look: AvatarLook): void {
  try { localStorage.setItem(LS_LOOK, JSON.stringify({ tg: tgUserId(), look })) } catch { /* приватный режим */ }
}

/**
 * Последний образ самого игрока, который видел этот клиент (null - не было).
 * Для лобби: своё место показываем даже когда хаб не ответил.
 */
export function ggLastLook(): { tg: number | null; look: AvatarLook } | null {
  const look = recallLook()
  return look ? { tg: tgUserId(), look } : null
}

function recallLook(): AvatarLook | null {
  try {
    const raw = localStorage.getItem(LS_LOOK)
    if (!raw) return null
    const j = JSON.parse(raw) as { tg?: number | null; look?: Partial<AvatarLook> }
    const tg = tgUserId()
    if (tg !== null && j.tg !== tg) return null
    return j.look ? normalizeLook(j.look) : null
  } catch { return null }
}

// ─── Токен запуска ─────────────────────────────────────────────────────────
// Игре не нужно ничего прокидывать: токен и так лежит в start_param webview.
// Кладём его ещё и в localStorage - игрок мог зайти в игру повторно уже без
// deep-link, а надетое показывать всё равно надо.

const LS_LAUNCH = 'gg_launch'

function decodeLaunchParam(startParam: string | undefined): string | null {
  if (!startParam) return null
  try {
    const token = atob(startParam.replace(/-/g, '+').replace(/_/g, '/'))
    // Токен запуска - JWT (три сегмента через точку). Иначе это обычный
    // deep-link (реф-код, id игры) - не токен.
    return token.split('.').length === 3 ? token : null
  } catch { return null }
}

/**
 * Токен запуска из Telegram, сам. null - игра открыта не из хаба: тогда
 * аватара просто не будет, всё остальное работает как раньше.
 */
export function ggLaunchToken(): string | null {
  // Telegram Web and browser previews may expose launch data only in the URL.
  // Prefer the current launch over a cached token from a previous account.
  const tg = (globalThis as any).Telegram?.WebApp
  const params = typeof location === 'undefined' ? [] : [
    new URLSearchParams(location.search), new URLSearchParams(location.hash.replace(/^#/, '')),
  ]
  const starts = params.flatMap(p => [p.get('tgWebAppStartParam'), new URLSearchParams(p.get('tgWebAppData') ?? '').get('start_param')])
  starts.push(tg?.initDataUnsafe?.start_param)
  const fresh = starts.map(p => decodeLaunchParam(p ?? undefined)).find(Boolean)
  if (fresh) {
    try {
      localStorage.setItem(LS_LAUNCH, fresh)
      localStorage.setItem('gg_launch_tg', String(tgUserId() ?? ''))
    } catch { /* приватный режим */ }
    return fresh
  }
  try {
    const cached = localStorage.getItem(LS_LAUNCH)
    if (!cached) return null
    const claims = JSON.parse(atob(cached.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (claims.exp && claims.exp * 1000 <= Date.now()) return null
    // Launch claims use the hub's internal uid, not the Telegram account id.
    // Keep account ownership separately instead of comparing unrelated ids.
    const user = tgUserId()
    if (user !== null && localStorage.getItem('gg_launch_tg') !== String(user)) return null
    return cached
  } catch { return null }
}

// ВНИМАНИЕ: копия GG/shared/avatarBadge.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
// Значок аватара — интеграция для игр, которым некуда вставить компонент:
// чистый canvas без React, старая игра, которую не хочется пересобирать, или
// просто нет лобби со списком мест.
//
// Одна строка в index.html, без сборки и зависимостей:
//
//   <script type="module">
//     import { ggAvatarBadge } from 'https://<хаб>/av/sdk/avatarBadge.js'
//     ggAvatarBadge({ hub: 'https://<хаб>' })
//   </script>
//
// Значок не кликается и не перехватывает ввод (pointer-events: none), знает
// про безопасные зоны устройства и кнопки полноэкранного Telegram и САМ прячется, если образ игрока неизвестен
// (игра открыта не из хаба и раньше из него не открывалась) - случайному
// игроку чужой «Бубл» показывать незачем.
import { GG_HUB_DEFAULT, ggAvatar, ggLaunchToken, type AvatarLook } from './avatarRender'

export interface BadgeOptions {
  /** База хаба. По умолчанию - боевой адрес; пустая строка = свой origin (прокси). */
  hub?: string
  /** Сторона значка в CSS-пикселях. */
  size?: number
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Отступ от края поверх безопасной зоны. */
  offset?: number
  /** Куда вставить. По умолчанию - в body. */
  parent?: HTMLElement
  /** Показывать подложку-кружок под аватаром. */
  plate?: boolean
}

// Отступ от края экрана по стороне. В полноэкранном режиме Telegram (Bot API
// 8.0, requestFullscreen) поверх игры лежат его кнопки «Закрыть» и «…» - их
// полосу клиент отдаёт CSS-переменной --tg-content-safe-area-inset-*, а
// вырез/чёлку устройства - --tg-safe-area-inset-*. Значок встаёт под обе,
// иначе в углу он ложится прямо на кнопку «Закрыть». Вне полноэкранного режима
// обе переменные нулевые, вне Telegram их нет - остаётся env() браузера.
const edge = (side: 'top' | 'bottom' | 'left' | 'right') =>
  `calc(var(--tg-safe-area-inset-${side}, env(safe-area-inset-${side}, 0px)) + ` +
  `var(--tg-content-safe-area-inset-${side}, 0px) + %O%)`

const CORNERS: Record<string, string> = {
  'top-left': `top:${edge('top')};left:${edge('left')}`,
  'top-right': `top:${edge('top')};right:${edge('right')}`,
  'bottom-left': `bottom:${edge('bottom')};left:${edge('left')}`,
  'bottom-right': `bottom:${edge('bottom')};right:${edge('right')}`,
}

let mounting = false

/**
 * Повесить значок. Возвращает функцию снятия — или null, когда вешать нечего
 * (игра открыта не из хаба, хаб недоступен, арт не разложен).
 */
export async function ggAvatarBadge(opts: BadgeOptions = {}): Promise<(() => void) | null> {
  if (typeof document === 'undefined') return null
  if (mounting || document.getElementById('gg-avatar-badge')) return null
  mounting = true

  const size = Math.max(24, Math.round(opts.size ?? 44))
  const offset = Math.round(opts.offset ?? 10)
  // Без токена значок всё равно встанет, если этот клиент уже знает образ
  // игрока (зашёл из хаба раньше); незнакомому игроку - не показываем.
  const av = await ggAvatar(opts.hub ?? GG_HUB_DEFAULT, ggLaunchToken())
  if (!av.manifest || av.source === 'default') { mounting = false; return null }

  const el = document.createElement('div')
  el.id = 'gg-avatar-badge'
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText =
    `position:fixed;z-index:2147483000;pointer-events:none;width:${size}px;height:${size}px;` +
    `${(CORNERS[opts.corner ?? 'top-left'] ?? CORNERS['top-left'] ?? '').replace(/%O%/g, `${offset}px`)};` +
    (opts.plate === false ? '' : 'border-radius:50%;background:radial-gradient(circle at 50% 30%,#fffdf7,#efe4cd);' +
      'box-shadow:0 1px 3px rgba(40,24,8,.22), inset 0 1px 0 rgba(255,255,255,.8);')

  let img: HTMLImageElement | null = null
  const draw = async (look: AvatarLook) => {
    const next = await av.image(size * 2, look).catch(() => null)
    if (!next) return
    next.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block'
    if (img) el.replaceChild(next, img); else el.appendChild(next)
    img = next
  }

  await draw(av.me)
  if (!img) { mounting = false; return null }
  // Put the profile portrait beside the pregame settings, in normal layout.
  // It must never cover Telegram's exit controls, scoreboards or touch sticks.
  const attach = () => {
    const parent = opts.parent ?? document.getElementById('gg-avatar-slot')
    if (parent && el.parentElement !== parent) {
      el.style.position = 'relative'
      el.style.top = el.style.right = el.style.bottom = el.style.left = 'auto'
      el.style.zIndex = 'auto'
      parent.appendChild(el)
    } else if (!parent && el.isConnected) el.remove()
  }
  const observer = new MutationObserver(attach)
  observer.observe(document.body, { childList: true, subtree: true })
  attach()

  // Купил шляпу в хабе, вернулся - значок обновится сам.
  const off = av.onChange(look => { void draw(look) })
  return () => { observer.disconnect(); off(); el.remove(); mounting = false }
}

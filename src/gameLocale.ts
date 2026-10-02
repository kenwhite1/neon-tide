/** Launch metadata is a UI hint. Servers still verify the signed launch token. */
export type GameLanguage = 'ru' | 'en'

export function launchStartParam(): string | undefined {
  const api = (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param
  for (const params of [new URLSearchParams(location.search), new URLSearchParams(location.hash.replace(/^#/, ''))]) {
    const explicit = params.get('tgWebAppStartParam')
    if (explicit) return explicit
    const data = params.get('tgWebAppData')
    if (data) {
      const start = new URLSearchParams(data).get('start_param')
      if (start) return start
    }
  }
  return api || undefined
}

export function hubLanguage(): GameLanguage | null {
  try {
    const param = launchStartParam()
    if (!param) return null
    const token = atob(param.replace(/-/g, '+').replace(/_/g, '/'))
    if (token.split('.').length !== 3) return null
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.lng === 'ru' || payload.lng === 'en' ? payload.lng : null
  } catch { return null }
}

function platformLanguage(): string | undefined {
  const code = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code
  if (code) return code
  for (const params of [new URLSearchParams(location.search), new URLSearchParams(location.hash.replace(/^#/, ''))]) {
    try {
      const user = new URLSearchParams(params.get('tgWebAppData') ?? '').get('user')
      if (user) return JSON.parse(user).language_code
    } catch { /* Malformed launch metadata must not prevent a game from booting. */ }
  }
  return undefined
}

/** A new hub launch overrides old game preferences; a reload preserves a new in-game choice. */
export function resolveGameLanguage(storageKey = 'gg_lang', fallback: GameLanguage = 'en'): GameLanguage {
  watchLaunchChanges()
  const forced = new URLSearchParams(location.search).get('lang')
  if (forced === 'ru' || forced === 'en') return forced
  const hub = hubLanguage()
  const start = launchStartParam()
  try {
    if (hub && start && localStorage.getItem('gg_locale_launch') !== start) {
      localStorage.setItem(storageKey, hub)
      localStorage.setItem('gg_locale_launch', start)
      return hub
    }
    const saved = localStorage.getItem(storageKey)
    if (saved === 'ru' || saved === 'en') return saved
  } catch { /* A blocked storage bucket still follows the current launch. */ }
  if (hub) return hub
  const code = platformLanguage() ?? navigator.language
  return code ? (code.toLowerCase().startsWith('ru') ? 'ru' : 'en') : fallback
}

let watching = false
function watchLaunchChanges(): void {
  if (watching) return
  watching = true
  const initial = launchStartParam()
  // Telegram Web can reuse a document and change only its launch hash. A
  // complete new launch must rebuild static menus and cached labels together.
  ;(window as any).addEventListener?.('hashchange', () => {
    const next = launchStartParam()
    if (next && next !== initial && hubLanguage()) location.reload()
  })
}

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

/** One accessible control for every game; the adapter updates the running game. */
export function installGameLanguagePicker(adapter: {
  get: () => GameLanguage
  set: (language: GameLanguage) => void | Promise<void>
  subscribe?: (changed: () => void) => (() => void)
}): void {
  if (typeof document === 'undefined') return
  const mount = () => {
    if (document.getElementById('gg-game-language')) return
    const picker = document.createElement('div')
    picker.id = 'gg-game-language'
    picker.setAttribute('role', 'group')
    picker.style.cssText = 'position:fixed;right:max(10px,env(safe-area-inset-right));top:max(10px,env(safe-area-inset-top));z-index:2147483000;display:flex;gap:2px;padding:3px;border:1px solid #ffffff40;border-radius:14px;background:#131923eF;box-shadow:0 2px 12px #0004;font:600 12px/1.2 system-ui;color:white;'
    const buttons = (['en', 'ru'] as const).map(language => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = language.toUpperCase()
      button.dataset.language = language
      button.style.cssText = 'border:0;border-radius:10px;padding:8px 10px;min-height:32px;color:white;font:inherit;cursor:pointer;'
      button.addEventListener('click', async () => {
        if (adapter.get() === language) return
        // A preview link with ?lang must follow an explicit choice too. Some
        // games rebuild cached canvas labels by reloading the same document.
        if (new URLSearchParams(location.search).has('lang')) {
          const url = new URL(location.href)
          url.searchParams.set('lang', language)
          history.replaceState(history.state, '', url)
        }
        buttons.forEach(b => { b.disabled = true })
        try { await adapter.set(language) } finally { buttons.forEach(b => { b.disabled = false }); paint() }
      })
      picker.append(button)
      return button
    })
    let paintedLanguage: GameLanguage | undefined
    const paint = () => {
      const language = adapter.get()
      document.documentElement.lang = language
      picker.setAttribute('aria-label', language === 'ru' ? 'Язык игры' : 'Game language')
      for (const button of buttons) {
        const active = button.dataset.language === language
        button.setAttribute('aria-pressed', String(active))
        button.style.background = active ? '#596cf0' : 'transparent'
        button.setAttribute('aria-label', button.dataset.language === 'ru' ? 'Русский' : 'English')
      }
      if (paintedLanguage !== language) {
        paintedLanguage = language
        window.dispatchEvent(new CustomEvent('gg:language-change', { detail: language }))
      }
    }
    document.body.append(picker)
    adapter.subscribe?.(paint)
    paint()
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
}

/** Only call for authored text, never player names, chat or user content. */
export function createGameTextTranslator(dictionary: Record<string, string>): (text: string, language: GameLanguage) => string {
  const reverse: Record<string, string> = Object.create(null)
  for (const [ru, en] of Object.entries(dictionary)) if (!(en in reverse)) reverse[en] = ru
  const patterns = [dictionary, reverse].map(map => {
    // Full paragraphs use the exact lookup above. Keeping the fragment pattern
    // small avoids compiling a multi-megabyte regular expression for a corpus.
    const keys = Object.keys(map).filter(key => key.length >= 3 && key.length <= 80 && !/[{}]/.test(key)).sort((a, b) => b.length - a.length)
    return keys.length ? new RegExp('(^|[^\\p{L}\\p{N}_])(' + keys.map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}_])', 'gu') : null
  })
  // Server-authored prose may arrive with names or scores already inserted.
  // Match the whole template and carry those values across unchanged.
  const templateRules = [dictionary, reverse].map(map => Object.keys(map)
    .filter(key => /\{[\p{L}_][\p{L}\p{N}_]*\}/u.test(key))
    .sort((a, b) => b.length - a.length)
    .map(key => {
      const names: string[] = []
      let pattern = '', end = 0
      for (const match of key.matchAll(/\{\{([\p{L}_][\p{L}\p{N}_]*)\}\}|\{([\p{L}_][\p{L}\p{N}_]*)\}/gu)) {
        pattern += key.slice(end, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(.+?)'
        names.push(match[1] ?? match[2]); end = match.index! + match[0].length
      }
      pattern += key.slice(end).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return { pattern: new RegExp('^' + pattern + '$', 'u'), prefix: key.slice(0, key.indexOf('{')), names, target: map[key] }
    }))
  return (text, language) => {
    const map = language === 'en' ? dictionary : reverse
    if (Object.prototype.hasOwnProperty.call(map, text)) return map[text]
    const trimmed = text.trim()
    if (trimmed && Object.prototype.hasOwnProperty.call(map, trimmed)) return text.replace(trimmed, () => map[trimmed])
    for (const rule of templateRules[language === 'en' ? 0 : 1]) {
      if (!trimmed.startsWith(rule.prefix)) continue
      const match = rule.pattern.exec(trimmed)
      if (!match) continue
      const values = Object.fromEntries(rule.names.map((name, i) => [name, match[i + 1]]))
      if (rule.names.some((name, i) => values[name] !== match[i + 1])) continue
      return text.replace(trimmed, () => rule.target.replace(/\{\{([\p{L}_][\p{L}\p{N}_]*)\}\}|\{([\p{L}_][\p{L}\p{N}_]*)\}/gu, (placeholder, doubleName, singleName) => values[doubleName ?? singleName] ?? placeholder))
    }
    const pattern = patterns[language === 'en' ? 0 : 1]
    return pattern ? text.replace(pattern, (_match, prefix, key) => prefix + map[key]) : text
  }
}

/** Repaint a game's authored DOM without replacing controls or their listeners. */
export function translateGameElement(root: Element, translate: (text: string) => string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if ((node.parentElement?.closest('script,style,input,textarea,[data-user-content],#gg-game-language'))) continue
    const current = node.textContent ?? ''
    const next = translate(current)
    if (next !== current) node.textContent = next
  }
  for (const element of root.querySelectorAll('[aria-label],[title],[placeholder]')) {
    if (element.closest('[data-user-content],#gg-game-language')) continue
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const text = element.getAttribute(attr)
      if (text !== null) element.setAttribute(attr, translate(text))
    }
  }
}

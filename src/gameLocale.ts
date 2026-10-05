import { GAME_MENU } from './gameMenu'
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

/** Menus own this control: removing/hiding a menu also removes/hides its settings. */
export function installGameLanguagePicker(adapter: {
  get: () => GameLanguage
  set: (language: GameLanguage) => void | Promise<void>
  subscribe?: (changed: () => void) => (() => void)
}): void {
  if (typeof document === 'undefined') return
  const boot = () => {
    if (document.getElementById('gg-menu-style')) return
    const style = document.createElement('style')
    style.id = 'gg-menu-style'
    style.textContent = `
      [data-gg-pregame]{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;width:100%;flex-shrink:0;box-sizing:border-box;padding-top:var(--gg-menu-inset,0px)}
      [data-gg-pregame]>button{flex-shrink:0;min-width:44px;min-height:44px}
      #gg-menu-tools{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;position:relative;margin:8px auto;max-width:480px;pointer-events:auto;font:600 13px/1.3 system-ui;color:#fff}
      #gg-menu-tools button{appearance:none;position:static;transform:none;min-width:44px;min-height:44px;margin:0;padding:10px 12px;border:1px solid #9b846638;border-radius:12px;background:#fffaf0;color:#5c4326;font:inherit;cursor:pointer;box-shadow:0 2px 0 #9b846638;touch-action:manipulation}
      #gg-menu-tools button:focus-visible{outline:3px solid #f4cf58;outline-offset:2px}
      #gg-game-language{display:flex;gap:3px}
      #gg-game-language button[aria-pressed=true]{background:var(--primary,#7fb069);color:white}
      #gg-avatar-slot{display:flex;align-items:center;justify-content:center;flex:0 0 auto}
      #gg-tutorial{position:fixed;inset:0;z-index:2147483001;display:grid;place-items:center;padding:calc(var(--gg-menu-safe-top,0px) + 16px) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom));background:#08101bdc;box-sizing:border-box}
      #gg-tutorial[hidden]{display:none}
      #gg-tutorial-card{width:min(420px,100%);max-height:100%;overflow:auto;box-sizing:border-box;border:1px solid #ffffff38;border-radius:20px;padding:24px;background:#172239;color:#fff;text-align:left;font:16px/1.6 system-ui}
      #gg-tutorial-card h2{font:700 22px/1.3 system-ui;color:#fff;margin:0 0 16px}
      #gg-tutorial-card p{white-space:normal;margin:12px 0 24px;color:#e8eef9}
      #gg-tutorial-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
    `
    document.head.append(style)
    void import('./gg/avatarBadge').then(m => m.ggAvatarBadge({ size: 40 })).catch(() => {})
    const safeMeasure = document.createElement('div')
    safeMeasure.style.cssText = 'position:fixed;top:0;left:0;width:0;height:var(--gg-menu-safe-top,0px);visibility:hidden;pointer-events:none'
    document.body.append(safeMeasure)
    const positionHost = () => {
      const host = document.querySelector<HTMLElement>(GAME_MENU.selector)
      const row = document.getElementById('gg-menu-tools')
      if (!host || !row?.getClientRects().length) return
      if (!safeMeasure.isConnected) document.body.append(safeMeasure)
      const safe = safeMeasure.getBoundingClientRect().height + 2
      // Centered menus move upward when their contents grow. Measure the actual
      // row after each adjustment so short screens and wrapped controls stay safe.
      for (let n = 0; n < 8; n++) {
        const missing = safe - row.getBoundingClientRect().top
        if (missing <= 0) break
        const padding = parseFloat(getComputedStyle(host).paddingTop) || 0
        host.style.setProperty('--gg-menu-inset', `${padding + Math.ceil(missing * 2)}px`)
      }
    }
    const hostSize = new ResizeObserver(positionHost)
    document.addEventListener('animationend', positionHost)
    void document.fonts?.ready.then(positionHost)
    const safeArea = () => {
      const tg = (window as any).Telegram?.WebApp
      const top = Math.max(0, Number(tg?.safeAreaInset?.top) || 0)
      const content = Math.max(0, Number(tg?.contentSafeAreaInset?.top ?? (tg?.isFullscreen ? 48 : 0)))
      document.documentElement.style.setProperty('--gg-menu-safe-top', `max(env(safe-area-inset-top, 0px), ${top + content}px)`)
      positionHost()
    }
    safeArea()
    const tg = (window as any).Telegram?.WebApp
    for (const event of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) tg?.onEvent?.(event, safeArea)
    window.addEventListener('resize', () => {
      document.querySelector<HTMLElement>(GAME_MENU.selector)?.style.setProperty('--gg-menu-inset', '0px')
      positionHost()
    })
    const tools = document.createElement('div')
    tools.id = 'gg-menu-tools'
    const slot = document.createElement('div')
    slot.id = 'gg-avatar-slot'
    const picker = document.createElement('div')
    picker.id = 'gg-game-language'
    picker.setAttribute('role', 'group')
    const buttons = (['en', 'ru'] as const).map(language => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = language.toUpperCase()
      button.dataset.language = language
      button.setAttribute('aria-label', language === 'ru' ? 'Русский' : 'English')
      button.addEventListener('click', async () => {
        if (adapter.get() === language) return
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
    const help = document.createElement('button')
    help.type = 'button'
    help.setAttribute('aria-haspopup', 'dialog')
    const dialog = document.createElement('div')
    dialog.id = 'gg-tutorial'
    dialog.hidden = true
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'gg-tutorial-title')
    const card = document.createElement('div')
    card.id = 'gg-tutorial-card'
    const title = document.createElement('h2')
    title.id = 'gg-tutorial-title'
    const stepText = document.createElement('p')
    const actions = document.createElement('div')
    actions.id = 'gg-tutorial-actions'
    const close = document.createElement('button'), back = document.createElement('button'), next = document.createElement('button')
    for (const button of [close, back, next]) button.type = 'button'
    actions.append(close, back, next)
    card.append(title, stepText, actions)
    dialog.append(card)
    let step = 0
    const closeGuide = () => { dialog.hidden = true; help.focus() }
    close.onclick = closeGuide
    back.onclick = () => { step = Math.max(0, step - 1); paint() }
    next.onclick = () => { if (step + 1 >= GAME_MENU.steps.en.length) closeGuide(); else { step++; paint() } }
    help.onclick = () => { step = 0; dialog.hidden = false; paint(); close.focus() }
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeGuide() }
      if (event.key === 'Tab') {
        const focusable = [close, ...(step > 0 ? [back] : []), next]
        const index = focusable.indexOf(document.activeElement as HTMLButtonElement)
        event.preventDefault()
        focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus()
      }
    })
    let paintedLanguage: GameLanguage | undefined
    const paint = () => {
      const language = adapter.get(), ru = language === 'ru'
      document.documentElement.lang = language
      picker.setAttribute('aria-label', ru ? 'Язык игры' : 'Game language')
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)))
      help.textContent = ru ? '? Как играть' : '? How to play'
      title.textContent = `${ru ? 'Как играть' : 'How to play'} · ${step + 1}/${GAME_MENU.steps[language].length}`
      stepText.textContent = GAME_MENU.steps[language][step]
      close.textContent = ru ? 'Закрыть' : 'Close'
      back.textContent = ru ? 'Назад' : 'Back'
      back.hidden = step === 0
      next.textContent = step + 1 === GAME_MENU.steps[language].length ? (ru ? 'Понятно' : 'Got it') : (ru ? 'Далее' : 'Next')
      if (paintedLanguage !== language) {
        paintedLanguage = language
        window.dispatchEvent(new CustomEvent('gg:language-change', { detail: language }))
      }
    }
    tools.append(slot, picker, help)
    // Home screens may animate with a transform, which makes a fixed child
    // relative to the menu instead of the viewport. Keep the modal at the root.
    document.body.append(dialog)
    const attach = () => {
      const host = document.querySelector<HTMLElement>(GAME_MENU.selector)
      if (host && tools.parentElement !== host) { dialog.hidden = true; hostSize.disconnect(); host.prepend(tools); hostSize.observe(host); positionHost() }
      else if (!host && tools.isConnected) { dialog.hidden = true; hostSize.disconnect(); tools.remove() }
    }
    // Route changes create new home nodes. Never keep a viewport-wide floating toggle.
    new MutationObserver(attach).observe(document.body, { childList: true, subtree: true })
    adapter.subscribe?.(paint)
    paint()
    attach()
  }
  if (document.body) boot()
  else document.addEventListener('DOMContentLoaded', boot, { once: true })
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

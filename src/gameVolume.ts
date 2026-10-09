/** Persistent master volume shared by audio engines and their controls. */
const KEY = 'gg_volume'
let volume = 1
let initialized = false
const listeners = new Set<(value: number) => void>()
const outputs = new Map<BaseAudioContext, GainNode>()
const buttons = new Set<HTMLElement>()
let panel: HTMLDivElement | null = null
let slider: HTMLInputElement
let label: HTMLSpanElement
let anchor: HTMLElement | null = null
let floating: HTMLButtonElement | null = null
let watchingLanguage = false

function storedVolume(): number | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw !== null && raw.trim() && Number.isFinite(Number(raw))) return Math.max(0, Math.min(1, Number(raw)))
  } catch { /* Private webview storage is optional. */ }
  return null
}
export function initGameVolume(fallback = 1): void {
  if (initialized) return
  initialized = true
  volume = storedVolume() ?? Math.max(0, Math.min(1, fallback))
}
export function getGameVolume(): number { return volume }
export function subscribeGameVolume(fn: (value: number) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function setGameVolume(value: number): void {
  if (!Number.isFinite(value)) return
  initialized = true
  volume = Math.max(0, Math.min(1, value))
  try { localStorage.setItem(KEY, String(volume)) } catch { /* Optional persistence. */ }
  for (const [context, gain] of outputs) {
    if (context.state === 'closed') { outputs.delete(context); continue }
    gain.gain.cancelScheduledValues(context.currentTime)
    gain.gain.setTargetAtTime(volume, context.currentTime, 0.01)
  }
  for (const fn of listeners) fn(volume)
  paint()
}
/** Preserve the engine's mix/envelopes while scaling its final output. */
export function gameAudioOutput(context: BaseAudioContext): GainNode {
  let gain = outputs.get(context)
  if (!gain) {
    initGameVolume()
    gain = context.createGain()
    gain.gain.value = volume
    gain.connect(context.destination)
    outputs.set(context, gain)
  }
  return gain
}
function russian(): boolean { return typeof document !== 'undefined' && document.documentElement.lang === 'ru' }
function paint(): void {
  const title = russian() ? 'Громкость' : 'Volume'
  for (const button of buttons) {
    button.textContent = volume === 0 ? '🔇' : '🔊'
    button.setAttribute('aria-label', `${title}: ${Math.round(volume * 100)}%`)
    button.setAttribute('title', title)
    button.setAttribute('aria-expanded', String(!!panel && !panel.hidden && anchor === button))
  }
  if (!panel) return
  slider.value = String(Math.round(volume * 100))
  label.textContent = `${title} ${slider.value}%`
}
function safeTop(): number {
  const tg = (window as any).Telegram?.WebApp
  return Math.max((tg?.safeAreaInset?.top ?? 0) + (tg?.contentSafeAreaInset?.top ?? 0),
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gg-menu-safe-top')) || 0)
}
function positionPanel(): void {
  if (!panel || panel.hidden) return
  const r = anchor?.isConnected ? anchor.getBoundingClientRect() : null
  panel.style.top = `${Math.max(safeTop() + 8, Math.min((r?.bottom ?? safeTop() + 52) + 8, innerHeight - panel.offsetHeight - 12))}px`
  panel.style.left = `${Math.max(8, Math.min(r?.left ?? innerWidth - panel.offsetWidth - 12, innerWidth - panel.offsetWidth - 8))}px`
}
function closePanel(): void { if (panel) panel.hidden = true; paint() }
function ensurePanel(): void {
  if (panel) return
  const style = document.createElement('style')
  style.textContent = '#gg-volume-panel[hidden]{display:none!important}'
  document.head.append(style)
  panel = document.createElement('div')
  panel.id = 'gg-volume-panel'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-labelledby', 'gg-volume-label')
  panel.style.cssText = 'position:fixed;z-index:2147483002;pointer-events:auto;padding:12px;border-radius:16px;background:#142238;color:white;font:14px system-ui;box-shadow:0 8px 30px #0006;max-width:calc(100vw - 40px);'
  const field = document.createElement('label')
  field.htmlFor = 'gg-volume-range'
  label = document.createElement('span'); label.id = 'gg-volume-label'
  slider = document.createElement('input')
  slider.id = 'gg-volume-range'; slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'
  slider.style.cssText = 'display:block;width:210px;max-width:100%;height:44px;touch-action:none;accent-color:#85bdff;cursor:pointer'
  slider.addEventListener('input', () => setGameVolume(Number(slider.value) / 100))
  field.append(label, slider); panel.append(field); document.body.append(panel)
  // Do not send slider gestures or arrow keys to the game's movement controls.
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'click']) panel.addEventListener(event, e => e.stopPropagation())
  panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { closePanel(); anchor?.focus() } })
  panel.addEventListener('keyup', e => e.stopPropagation())
  document.addEventListener('pointerdown', e => { if (e.target instanceof Node && !panel!.contains(e.target) && !anchor?.contains(e.target)) closePanel() })
  window.addEventListener('resize', positionPanel)
}
export function openGameVolume(button?: HTMLElement): void {
  initGameVolume()
  ensurePanel()
  const wasOpen = !panel!.hidden && anchor === (button ?? null)
  anchor = button ?? null
  panel!.hidden = wasOpen
  paint(); positionPanel()
  if (!panel!.hidden) slider.focus({ preventScroll: true })
}
export function bindGameVolumeButton(button: HTMLElement): () => void {
  if (!watchingLanguage) { watchingLanguage = true; window.addEventListener('gg:language-change', paint) }
  buttons.add(button)
  button.dataset.ggVolume = 'true'
  button.setAttribute('type', 'button')
  button.setAttribute('aria-controls', 'gg-volume-panel')
  const click = (e: Event) => { e.stopPropagation(); openGameVolume(button) }
  button.addEventListener('click', click)
  paint()
  return () => { buttons.delete(button); button.removeEventListener('click', click) }
}
/** A fallback remains available when a game has no visible settings button. */
export function installGameVolume(audio?: { volume: number; setVolume(value: number): void }, existing?: HTMLElement | null): void {
  if (typeof document === 'undefined') return
  initGameVolume(audio?.volume ?? 1)
  if (audio) { audio.setVolume(volume); subscribeGameVolume(v => audio.setVolume(v)) }
  const boot = () => {
    if (existing) { existing.onclick = null; bindGameVolumeButton(existing); return }
    if (floating) return
    floating = document.createElement('button'); floating.id = 'gg-volume-button'
    floating.style.cssText = 'position:fixed;right:max(12px,env(safe-area-inset-right));top:calc(var(--gg-menu-safe-top,0px) + 94px);z-index:1000;pointer-events:auto;min-width:44px;min-height:44px;border-radius:14px;border:1px solid #ffffff66;background:#142238;color:white;font-size:20px;'
    document.body.append(floating); bindGameVolumeButton(floating)
    // Inspect only registered controls, including menus that mount/unmount during play.
    const update = () => {
      for (const button of buttons) if (!button.isConnected) buttons.delete(button)
      if (floating) floating.style.display = [...buttons].some(b => b !== floating && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden') ? 'none' : ''
    }
    update(); window.setInterval(update, 500)
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot, { once: true })
}

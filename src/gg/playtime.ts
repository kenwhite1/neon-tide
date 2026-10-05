// ВНИМАНИЕ: копия GG/shared/playtime.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
/** Track visible gameplay using a signed hub launch token. No client duration
 * or user ID is accepted by the server. Hidden tabs end their session. */
export function trackGamePlaytime(hubUrl: string, launchToken: string | null | undefined): () => void {
  if (!launchToken) return () => {}
  let active = false
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let queue = Promise.resolve()
  const send = (event: 'start' | 'ping' | 'end') => {
    // Preserve end/start order when the player switches away and back quickly.
    queue = queue.then(async () => {
      await fetch(`${hubUrl.replace(/\/$/, '')}/api/sdk/presence`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-gg-launch': launchToken },
        body: JSON.stringify({ event }), keepalive: true,
      }).catch(() => {})
    })
  }
  const pause = () => {
    if (!active) return
    active = false
    clearInterval(timer)
    send('end')
  }
  const resume = () => {
    if (stopped || active || document.visibilityState === 'hidden') return
    active = true
    send('start')
    timer = setInterval(() => { if (active) send('ping') }, 30_000)
  }
  const visibility = () => document.visibilityState === 'hidden' ? pause() : resume()
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pagehide', pause)
  window.addEventListener('pageshow', resume)
  resume()
  return () => {
    stopped = true
    pause()
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('pagehide', pause)
    window.removeEventListener('pageshow', resume)
  }
}

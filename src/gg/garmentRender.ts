// ВНИМАНИЕ: копия GG/shared/garmentRender.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
import { wearPlacement } from './wearPlacement'

const FITTED_TOPS = new Set(['top_shirttie', 'top_turtleneck', 'top_robe', 'top_trench', 'top_lace', 'top_hawaiiwhite', 'top_s1_knit', 'top_s1_hoodie', 'top_plus_resort', 'top_onesie', 'top_hoodieblack'])

/** Bend sleeves onto the mascot's downward arms; the front panel stays in place. */
export function drawWornTop(ctx: CanvasRenderingContext2D, image: HTMLImageElement, id: string, size: number, hue = 0): void {
  const flat = document.createElement('canvas')
  flat.width = flat.height = size
  const paint = flat.getContext('2d')!
  paint.imageSmoothingEnabled = true
  paint.imageSmoothingQuality = 'high'
  if (hue) paint.filter = `hue-rotate(${((hue % 360) + 360) % 360}deg)`
  const p = wearPlacement(id)
  paint.drawImage(image, p.x * size, p.y * size, p.width * size, p.height * size)
  // Capes and the newly fitted windbreaker already have hanging sleeves.
  const drop = FITTED_TOPS.has(id) || /windbreaker|cape|cloak|furcoat|parka/.test(id) ? 0 : /hoodie|s1_|s2_|plus_/.test(id) ? .055 : .085
  if (!drop) { ctx.drawImage(flat, 0, 0); return }
  const strip = Math.max(1, Math.round(size / 300))
  for (let x = 0; x < size; x += strip) {
    const width = Math.min(strip, size - x)
    const distance = Math.abs((x + width / 2) / size - .5)
    const arm = Math.max(0, Math.min(1, (distance - .25) / .25))
    const dy = arm * arm * drop * size
    ctx.drawImage(flat, x, 0, width, size, x, dy, width, size)
  }
}

// ВНИМАНИЕ: копия GG/shared/photoRender.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
import { AVATAR_PHOTO } from './avatarPhoto'
import { hueRotateHex } from './avatar'

let photo: Promise<HTMLImageElement> | undefined
let cutout: Promise<HTMLCanvasElement> | undefined
export type PhotoMaterial = 'gold' | 'rosegold' | 'obsidian' | 'iris'
export function photoMaterial(id: string | undefined): PhotoMaterial | undefined {
  return ({ c_gold: 'gold', c_rosegold: 'rosegold', c_obsidian: 'obsidian', c_iris: 'iris' } as Record<string, PhotoMaterial>)[id ?? '']
}
export function loadAvatarPhoto(): Promise<HTMLImageElement> {
  return photo ??= new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('avatar_photo_unavailable'))
    img.src = AVATAR_PHOTO
  })
}

/** Only the photograph's teal body is tinted. Eyes, mouth and backdrop stay original. */
export function recolorPhotoPixels(pixels: Uint8ClampedArray, color: string, hue = 0, material?: PhotoMaterial): void {
  if (color.toLowerCase() === '#f3d9a4' && hue === 0) return
  const target = hueRotateHex(color, hue)
  const r = parseInt(target.slice(1, 3), 16) / 255
  const g = parseInt(target.slice(3, 5), 16) / 255
  const b = parseInt(target.slice(5, 7), 16) / 255
  for (let i = 0; i < pixels.length; i += 4) {
    const sr = pixels[i] / 255, sg = pixels[i + 1] / 255, sb = pixels[i + 2] / 255
    const max = Math.max(sr, sg, sb), min = Math.min(sr, sg, sb), delta = max - min
    if (max < 0.12 || delta / max < 0.2) continue
    const sourceHue = (max === sr ? ((sg - sb) / delta + 6) % 6 : max === sg ? (sb - sr) / delta + 2 : (sr - sg) / delta + 4) * 60
    if (sourceHue < 145 || sourceHue > 230) continue
    // Keep the photographed lighting and highlights instead of flattening the body.
    const shade = Math.min(1.4, max / 0.48)
    let tr = r * shade, tg = g * shade, tb = b * shade
    if (material === 'gold' || material === 'rosegold') {
      const shine = Math.pow(Math.min(1, Math.max(0, (max - .18) / .48)), 3) * .65
      tr = tr * (1 - shine) + shine
      tg = tg * (1 - shine) + shine * (material === 'gold' ? .94 : .89)
      tb = tb * (1 - shine) + shine * (material === 'gold' ? .73 : .86)
    } else if (material === 'obsidian') {
      const shine = Math.pow(max, 1.4) * .32
      tr += shine; tg += shine * 1.08; tb += shine * 1.24
    } else if (material === 'iris') {
      const sheen = Math.min(.55, Math.max(0, (max - .25) * 1.25))
      tr = tr * (1 - sheen) + .62 * sheen
      tg = tg * (1 - sheen) + .85 * sheen
      tb = tb * (1 - sheen) + sheen
    }
    pixels[i] = Math.min(255, tr * 255)
    pixels[i + 1] = Math.min(255, tg * 255)
    pixels[i + 2] = Math.min(255, tb * 255)
  }
}

/** Remove only warm background pixels connected to the photograph's border.
 * Enclosed eye whites, neutral irises and the teal body are left untouched. */
export function removePhotoBackdrop(pixels: Uint8ClampedArray, width: number, height: number): void {
  const count = width * height
  const visited = new Uint8Array(count)
  const queue = new Int32Array(count)
  let head = 0, tail = 0
  const visit = (p: number) => {
    if (visited[p]) return
    visited[p] = 1
    const i = p * 4
    if (pixels[i] < 150 || pixels[i] <= pixels[i + 1] || pixels[i + 1] <= pixels[i + 2] || pixels[i] - pixels[i + 2] < 20) return
    queue[tail++] = p
  }
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1) }
  while (head < tail) {
    const p = queue[head++], x = p % width, y = Math.floor(p / width)
    const i = p * 4
    pixels[i + 3] = 0
    if (x > 0) visit(p - 1)
    if (x + 1 < width) visit(p + 1)
    if (y > 0) visit(p - width)
    if (y + 1 < height) visit(p + width)
  }
}

/** Mask once at source resolution, then scale the transparent photo for clean edges. */
function loadAvatarCutout(): Promise<HTMLCanvasElement> {
  return cutout ??= loadAvatarPhoto().then(img => {
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = side
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, side, side)
    const data = ctx.getImageData(0, 0, side, side)
    removePhotoBackdrop(data.data, side, side)
    ctx.putImageData(data, 0, 0)
    return canvas
  })
}

export async function drawAvatarPhoto(canvas: HTMLCanvasElement, color: string, hue = 0, material?: PhotoMaterial, transparentBackground = false): Promise<void> {
  const img = await loadAvatarPhoto()
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (transparentBackground) {
    ctx.drawImage(await loadAvatarCutout(), 0, 0, canvas.width, canvas.height)
  } else {
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
  }
  if (color.toLowerCase() === '#f3d9a4' && hue === 0) return
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  recolorPhotoPixels(data.data, color, hue, material)
  ctx.putImageData(data, 0, 0)
}

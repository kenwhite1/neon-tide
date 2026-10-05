// ВНИМАНИЕ: копия GG/shared/avatarRig.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
// Avatar SDK, половина «3D»: «Бубл» из хаба как риг three.js - в цвете игрока
// и в купленных шмотках. Едет только в игры с three (scripts/sync-avatar-sdk.mjs
// смотрит на package.json), поэтому хаб его не собирает и не проверяет типами.
//
//   const av = await ggAvatar(GG_HUB_DEFAULT, ggLaunchToken())
//   const me = await mountAvatarRig(av, player.mesh, { height: 1.6, facing: '-z' })
//   if (me) oldModel.visible = false          // null - образа нет, свой персонаж
//   ...в кадре: me?.rig.walk(phase, speed01)
//
// Косметика - плоский арт 512×512 (вещь надета на «Бубла» анфас), 3D-моделей
// у неё нет и не будет: переводить 125 вещей в glTF дороже всего остального, а
// витрина ротируется каждую неделю. Поэтому тело - МЕШ, а вещи - декали на
// «оболочках», повторяющих его силуэт:
//
//   тело    лате по обмеру bubl-mask.webp + ручки-шарики + ножки
//   одежда  оболочка на передней полусфере: анфас вещь та же, что в 2D,
//           рукава на боках; сзади «спинка» в цвет вещи (см. backOf)
//   лицо    оболочка только спереди - лица на затылке быть не должно
//   шляпа   билборд, доворот к камере вокруг МЕСТНОЙ оси Y
//
// Рабочий пример и история решений - lavina/src/game/player.ts; тут то же
// самое, только без привязки к доске: рост, направление взгляда и подъём
// ступней задаются опциями.
import * as THREE from 'three'
import { defaultAvatarParts, type AvatarLook, type AvatarParts, type GGAvatars } from './avatarRender'

// ── Обмер эталона ─────────────────────────────────────────────────────────
// Полуширина силуэта на 25 равных высотах квадрата 512×512 (v=0 - верх).
// core - тело без рук (по нему лате), outer - вместе с руками и ногами (по
// нему оболочки, чтобы вещь не проваливалась внутрь). Снято скриптом с
// bubl-mask.webp: если маскота перерисуют, цифры пересчитать оттуда же.
const CORE = Array.from({ length: 49 }, (_, i) => {
  const v = i / 48, d = (v - .45) / .345
  return Math.abs(d) < 1 ? .325 * Math.sqrt(1 - d * d) : 0
})

/** Макушка маскота в квадрате (выше - поле под шляпу). */
const TOP_V = 0.105
/** Ножки: центр капсулы, её радиус и половина длины - в долях стороны квадрата. */
const LEG_V = 0.795, LEG_R = 0.058, LEG_HALF = 0.05
/** Низ ступней в квадрате. */
const FOOT_V = 0.93
/** Рост маскота (макушка → ступни) в долях стороны квадрата. */
const STATURE = FOOT_V - TOP_V

/** Лате отсчитывает угол от +Z, а маскот собран лицом в +X. */
const FRONT = Math.PI / 2

function sample(table: number[], v: number): number {
  const t = Math.min(1, Math.max(0, v)) * (table.length - 1)
  const i = Math.floor(t), f = t - i
  return (table[i] ?? 0) * (1 - f) + (table[Math.min(table.length - 1, i + 1)] ?? 0) * f
}

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 4
  return tex
}

function decalMaterial(tex: THREE.Texture, flat: boolean, exposure = 1): THREE.Material {
  const common = {
    map: tex, color: new THREE.Color(exposure, exposure, exposure),
    transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide,
  }
  return flat
    ? new THREE.MeshBasicMaterial(common)
    : new THREE.MeshStandardMaterial({ ...common, roughness: 0.75, metalness: 0 })
}

/**
 * Спинка одежды. Арт вещи нарисован только спереди, а в играх с камерой сзади
 * игрок смотрит как раз в спину. Поэтому сзади лежит спинка: построчно средний
 * цвет ткани и её покрытие. Меряем по бокам груди, а не по центру: в центре
 * вырез, пуговицы и принт, а бока - это ткань, и по ним же видно, докуда вещь
 * доходит сзади (капюшон закрывает затылок, рубашка - плечи).
 *
 * null - вещь не закрывает торс (жилетка, подтяжки): спинка не нужна.
 */
function backOf(art: HTMLCanvasElement): HTMLCanvasElement | null {
  const w = art.width, h = art.height
  const src = art.getContext('2d', { willReadFrequently: true })
  if (!src || !w || !h) return null
  // Две полосы между краем тела и центром - внутри силуэта, мимо рук и выреза.
  const bands = [[0.24, 0.38], [0.62, 0.76]].map(([a, b]) => [Math.round(w * (a ?? 0)), Math.round(w * (b ?? 0))] as const)
  let rows: Uint8ClampedArray[]
  try { rows = bands.map(([x0, x1]) => src.getImageData(x0, 0, x1 - x0, h).data) } catch { return null }   // tainted canvas
  const out = document.createElement('canvas')
  out.width = 4; out.height = h
  const dst = out.getContext('2d')
  if (!dst) return null
  const row = dst.createImageData(4, 1)
  let any = false
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0
    bands.forEach(([x0, x1], k) => {
      const px = rows[k]
      if (!px) return
      const bw = x1 - x0
      for (let x = 0; x < bw; x++) {
        const i = (y * bw + x) * 4
        const al = (px[i + 3] ?? 0) / 255
        r += (px[i] ?? 0) * al; g += (px[i + 1] ?? 0) * al; b += (px[i + 2] ?? 0) * al; a += al
      }
      n += bw
    })
    const cover = n ? a / n : 0
    // Край мягкий, но без полупрозрачной «вуали» посередине спины.
    const alpha = Math.min(1, Math.max(0, (cover - 0.35) / 0.3))
    if (alpha <= 0) continue
    any = true
    for (let k = 0; k < 4; k++) {
      row.data[k * 4] = r / a; row.data[k * 4 + 1] = g / a; row.data[k * 4 + 2] = b / a
      row.data[k * 4 + 3] = Math.round(alpha * 255)
    }
    dst.putImageData(row, 0, y)
  }
  return any ? out : null
}

// ─── Опции ────────────────────────────────────────────────────────────────

/** Куда смотрит лицо в локальных осях группы рига. */
export type RigFacing = '+x' | '-x' | '+z' | '-z'

const FACING_YAW: Record<RigFacing, number> = { '+x': 0, '-z': Math.PI / 2, '-x': Math.PI, '+z': -Math.PI / 2 }

export interface AvatarRigOptions {
  /** Рост от ступней до макушки в единицах мира (шляпа - сверх него). По умолчанию 1. */
  height?: number
  /**
   * Куда смотрит лицо. По умолчанию '+z' - так ставит объект `lookAt` в
   * three.js. Персонаж игры, который «идёт в -Z», - это '-z'.
   */
  facing?: RigFacing
  /** Подъём ступней над y=0 группы (доска, седло, постамент). */
  lift?: number
  /** Отбрасывать тень (если в игре включены тени). По умолчанию true. */
  castShadow?: boolean
  /**
   * Без освещения: MeshBasicMaterial вместо Standard. Для сцен, где света нет
   * или он стилизованный и маскот выходит чёрным.
   */
  flat?: boolean
  /**
   * Яркость материалов рига, 1 - как есть. Меньше единицы - для сцен с сильным
   * bloom (яркое солнце + низкий порог): там светлое тело «Бубла» целиком
   * уходит за порог и превращается в светящийся шар без формы и вещей.
   */
  exposure?: number
}

export interface AvatarRig {
  /** Корень рига: ставь туда, где стоял персонаж. Ступни на y = lift. */
  group: THREE.Group
  /**
   * Тело целиком (лицом в +X внутри группы). Наклоны, прыжки и сальто -
   * сюда; walk() качает его же.
   */
  body: THREE.Group
  arms: THREE.Mesh[]
  legs: THREE.Mesh[]
  /** Рост в единицах мира - как в опциях. */
  height: number
  /**
   * Точка на теле для своих накладок (маска, значок на груди): высота `v` в
   * долях квадрата аватара - та же сетка, что у 2D-арта и лиц (0 - верх
   * квадрата, глаза ≈ 0.32, ступни ≈ 0.9) - превращается в местную высоту `y`
   * и радиус тела `r` там же, в координатах `body` (перед - это +X).
   * Так накладка садится на «Бубла» без копирования обмеров рига.
   */
  at(v: number): { y: number; r: number }
  /**
   * Походка вразвалку. `phase` - фаза шага в радианах (растёт со скоростью),
   * `amount` 0..1 - сила: 0 ставит в стойку. Звать каждый кадр или когда
   * меняется фаза.
   */
  walk(phase: number, amount?: number): void
  /** Освободить геометрию, материалы и текстуры (снятый риг). */
  dispose(): void
}

// ─── Риг ──────────────────────────────────────────────────────────────────

/**
 * Шляпа - единственная вещь, которую оболочка не тянет: она сидит ВЫШЕ тела,
 * а любая дуга торчит по бокам срезом. Поэтому шляпа - билборд, доворот к
 * камере вокруг МЕСТНОЙ оси Y: с любого ракурса она такая же, как в хабе, но
 * при сальто переворачивается вместе с ригом.
 *
 * Доворот в onBeforeRender: three.js зовёт его ДО расчёта modelViewMatrix,
 * поэтому игре не нужно ничего знать про камеру.
 */
function hatBillboard(canvas: HTMLCanvasElement, H: number, y0: number, flat: boolean, exposure: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(H, H), decalMaterial(texture(canvas), flat, exposure))
  mesh.position.y = y0 + H / 2
  mesh.renderOrder = 5
  // Плоскость выносится к камере на радиус «Бубла»: иначе тело перекрывает
  // шляпу по глубине, и она повисает над головой.
  const LIFT = 0.40 * H
  const toCam = new THREE.Vector3()
  mesh.onBeforeRender = (_r, _s, camera) => {
    const parent = mesh.parent
    if (!parent) return
    toCam.setFromMatrixPosition(camera.matrixWorld)
    parent.worldToLocal(toCam)
    const flatLen = Math.hypot(toCam.x, toCam.z) || 1
    mesh.position.set((toCam.x / flatLen) * LIFT, y0 + H / 2, (toCam.z / flatLen) * LIFT)
    mesh.rotation.y = Math.atan2(toCam.x, toCam.z)
    mesh.updateMatrix()
    mesh.updateMatrixWorld(true)
  }
  return mesh
}

/** Собрать риг из кусков образа (`av.parts()`). */
export function buildAvatarRig(parts: AvatarParts, opts: AvatarRigOptions = {}): AvatarRig {
  const height = opts.height ?? 1
  const flat = opts.flat ?? false
  const exposure = opts.exposure ?? 1
  const shadow = opts.castShadow ?? true
  /** Сторона «квадрата аватара» в мире. */
  const H = height / STATURE
  /** Низ квадрата: так, чтобы ступни встали на y = lift. */
  const Y0 = (opts.lift ?? 0) - H * (1 - FOOT_V)
  const yAt = (v: number) => Y0 + H * (1 - v)

  const group = new THREE.Group()
  group.name = 'gg-avatar'
  const turn = new THREE.Group()
  turn.rotation.y = FACING_YAW[opts.facing ?? '+z']
  const body = new THREE.Group()

  const solid = (hex: THREE.ColorRepresentation, rough: number): THREE.Material => flat
    ? new THREE.MeshBasicMaterial({ color: hex })
    : new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 })
  const skin = solid(new THREE.Color(parts.bodyHex).multiplyScalar(exposure), 0.58)
  // Конечности чуть темнее тела - иначе «Бубл» читается одним пятном.
  const limb = solid(new THREE.Color(parts.bodyHex).multiplyScalar(0.86 * exposure), 0.62)

  // ── тело: лате по core-профилю, почти нулевые радиусы на концах закрывают
  // каплю сверху и снизу.
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.012 * H, yAt(TOP_V))]
  for (let i = 0; i < CORE.length; i++) {
    const r = CORE[i] ?? 0
    if (r <= 0) continue
    pts.push(new THREE.Vector2(r * H, yAt(i / (CORE.length - 1))))
  }
  pts.push(new THREE.Vector2(0.03 * H, yAt(0.79)))
  pts.reverse()                                     // снизу вверх
  const torso = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), skin)
  torso.castShadow = shadow
  body.add(torso)

  // ── ручки: два шарика по бокам, там же где на арте (v≈0.65).
  const arms: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.059 * H, 0.16 * H, 6, 16), limb)
    arm.position.set(0, yAt(0.595), side * 0.345 * H)
    arm.rotation.x = side * -0.16
    arm.castShadow = shadow
    body.add(arm)
    arms.push(arm)
  }

  // ── ножки: короткие капсулы от бёдер до ступней.
  const legs: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(LEG_R * H, 2 * LEG_HALF * H, 4, 8), limb)
    leg.position.set(0, yAt(LEG_V), side * 0.091 * H)
    leg.castShadow = shadow
    body.add(leg)
    legs.push(leg)
    const foot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), limb)
    foot.scale.set(.09 * H, .045 * H, .08 * H)
    foot.position.set(.025 * H, yAt(.885), side * .091 * H)
    foot.castShadow = shadow
    body.add(foot)
  }

  // ── вещи. Порядок слоёв тот же, что в хабе: одежда поверх лица, шляпа поверх
  // всего - поэтому и радиусы оболочек растут в этом же порядке.
  const shell = (canvas: HTMLCanvasElement, o: {
    from: number; to: number; inflate: number; floor: number; arc: number; order: number
    /** Центр дуги (угол лате). По умолчанию - перед маскота. */
    center?: number
    /**
     * Как раскладывать колонки арта по передней полусфере: 0 - проекция
     * спереди (анфас ровно как в 2D, но на боках край арта тянется полосой),
     * 1 - равномерно по дуге (бока получают свою долю арта - рукава, - а
     * середина шире). Нет - арт растянут по дуге как есть (однородная спинка).
     */
    spread?: number
  }): THREE.Mesh => {
    // Точки снизу вверх: у LatheGeometry uv.y растёт с индексом, так v=0 у
    // нижнего края полосы - как у текстуры.
    const STEPS = 22
    const p: THREE.Vector2[] = []
    for (let i = 0; i <= STEPS; i++) {
      const v = o.to + (o.from - o.to) * (i / STEPS)
      p.push(new THREE.Vector2(Math.max(sample(CORE, v), o.floor) * o.inflate * H, yAt(v)))
    }
    const geo = new THREE.LatheGeometry(p, 24, (o.center ?? FRONT) - o.arc / 2, o.arc)
    if (o.spread !== undefined) {
      // Маскот смотрит в +X; θ - угол от переда, зрителю анфас «вправо» - это
      // -Z. Колонка арта: u = 0.5 + r/H · смесь(sin θ, 2θ/π) - обе крайности
      // сходятся на боках в один и тот же край силуэта.
      const k = o.spread
      const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i)
        const r = Math.hypot(x, z)
        const th = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, Math.atan2(x, z) - FRONT))
        uv.setX(i, 0.5 + (r / H) * ((1 - k) * Math.sin(th) + k * (2 * th) / Math.PI))
      }
      uv.needsUpdate = true
    }
    const tex = texture(canvas)
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.repeat.set(1, o.to - o.from)
    tex.offset.set(0, 1 - o.to)
    const mesh = new THREE.Mesh(geo, decalMaterial(tex, flat, exposure))
    mesh.renderOrder = o.order
    return mesh
  }
  // Лицо и одежда - передняя полусфера. Лицо почти в проекции спереди (оно
  // читается анфас), одежда - ближе к равномерной раскладке: в играх её видят
  // и сбоку, а там нужен рукав, а не полоса. Спину закрывает спинка.
  if (parts.face) body.add(shell(parts.face, { from: 0.13, to: 0.62, inflate: 1.02, floor: 0.05, arc: Math.PI, order: 3, spread: 0.25 }))
  if (parts.wear) {
    const back = backOf(parts.wear)
    // Спинка чуть заходит на бока и лежит под передом: шов на боку прячется
    // под краем вещи.
    if (back) body.add(shell(back, { from: 0.13, to: 0.88, inflate: 1.035, floor: 0.05, arc: Math.PI * 1.15, center: FRONT + Math.PI, order: 3.5 }))
    body.add(shell(parts.wear, { from: 0.30, to: 0.88, inflate: 1.05, floor: 0.19, arc: Math.PI, order: 4, spread: 0.6 }))
  }
  if (parts.hat) body.add(hatBillboard(parts.hat, H, Y0, flat, exposure))

  turn.add(body)
  group.add(turn)

  const armRest = arms.map(a => a.position.clone())
  const legRest = legs.map(l => l.position.clone())

  // Метка «своих» мешей: dispose освобождает только их. Игры вешают на риг
  // оружие и накладки со своими (часто общими) материалами - их не трогаем.
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.ggRig = true })

  return {
    group, body, arms, legs, height,
    at: v => ({ y: yAt(v), r: sample(CORE, v) * H }),
    walk(phase, amount = 1) {
      const k = Math.min(1, Math.max(0, amount))
      const s = Math.sin(phase)
      // Вразвалку: тело подпрыгивает на каждом шаге и переваливается с боку на
      // бок, ножки ходят вперёд-назад, ручки - навстречу ножкам.
      body.position.y = Math.abs(s) * 0.035 * H * k
      body.rotation.x = s * 0.09 * k
      legs.forEach((leg, i) => {
        const rest = legRest[i]
        if (!rest) return
        const dir = i === 0 ? 1 : -1
        leg.position.x = rest.x + s * dir * 0.06 * H * k
        leg.position.y = rest.y + Math.max(0, s * dir) * 0.025 * H * k
      })
      arms.forEach((arm, i) => {
        const rest = armRest[i]
        if (!rest) return
        arm.position.x = rest.x - s * (i === 0 ? 1 : -1) * 0.05 * H * k
      })
    },
    dispose() { disposeAvatarRig(group) },
  }
}

/**
 * Освободить то, что риг создал сам, и снять его со сцены. Чужое, что игра
 * повесила на риг (оружие, маска), не освобождается: у него могут быть общие
 * материалы - пометь `userData.ggRig = true`, если оно должно уйти вместе с ригом.
 */
export function disposeAvatarRig(root: THREE.Object3D): void {
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.userData.ggRig) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      ;(m as THREE.MeshStandardMaterial).map?.dispose()
      m.dispose()
    }
  })
  root.removeFromParent()
}

// ─── Интеграция одной строкой ─────────────────────────────────────────────

export interface MountedAvatarRig {
  /** Текущий риг (после переодевания - уже новый). */
  readonly rig: AvatarRig
  /** Снять риг и отписаться от переодевания. */
  dispose(): void
}

export interface MountOptions extends AvatarRigOptions {
  /** Разрешение текстур вещей. 256 хватает персонажу на пол-экрана. */
  size?: number
  /** Позвать после каждой пересборки (переодевание): перепривязать анимацию. */
  onRig?: (rig: AvatarRig) => void
}

/**
 * Свой аватар в сцене, который сам переодевается: риг кладётся в `parent`
 * (группу персонажа), а когда игрок сменил образ в хабе и вернулся в игру,
 * пересобирается на месте - перезапускать игру не надо.
 *
 * null - образа игрока мы не знаем (игра открыта не из хаба, хаба нет, арт не
 * разложен): игра оставляет своего персонажа, ровно как было.
 */
export async function mountAvatarRig(
  av: GGAvatars | null | Promise<GGAvatars | null>, parent: THREE.Object3D, opts: MountOptions = {},
): Promise<MountedAvatarRig | null> {
  const size = opts.size ?? 256
  const deferred = av instanceof Promise ? av : null
  const source = av instanceof Promise ? null : av
  const parts = await source?.parts(size).catch(() => null) ?? await defaultAvatarParts(size)

  let rig = buildAvatarRig(parts, opts)
  parent.add(rig.group)
  opts.onRig?.(rig)

  let disposed = false
  let off = () => {}
  function refresh(source: GGAvatars) {
    void source.parts(size).then(p => {
      if (disposed) return
      if (!p) return
      const next = buildAvatarRig(p, opts)
      const holder = rig.group.parent ?? parent
      next.group.position.copy(rig.group.position)
      next.group.quaternion.copy(rig.group.quaternion)
      next.group.visible = rig.group.visible
      rig.dispose()
      holder.add(next.group)
      rig = next
      opts.onRig?.(next)
    }).catch(() => {})
  }
  if (source) off = source.onChange(() => refresh(source))
  // The physical mascot is visible before hub networking finishes. Equipped
  // cosmetics arrive later, with the same focus/re-dress updates as before.
  if (deferred) void deferred.then(source => {
    if (disposed || !source) return
    refresh(source)
    off = source.onChange(() => refresh(source))
  }).catch(() => {})

  return {
    get rig() { return rig },
    dispose() { disposed = true; off(); rig.dispose() },
  }
}

/**
 * Риги других игроков (соперники, соседи по лобби) по Telegram id - одним
 * запросом образов. Незнакомых id в ответе просто нет: им игра оставляет
 * свою модель.
 */
export async function buildAvatarRigs(
  av: GGAvatars | null, uids: number[], opts: AvatarRigOptions & { size?: number } = {},
): Promise<Map<number, AvatarRig>> {
  const out = new Map<number, AvatarRig>()
  if (!av?.manifest || !uids.length) return out
  const looks: Record<number, AvatarLook> = await av.looks(uids).catch(() => ({}))
  await Promise.all(Object.entries(looks).map(async ([uid, look]) => {
    const parts = await av.parts(opts.size ?? 128, look).catch(() => null)
    if (parts) out.set(Number(uid), buildAvatarRig(parts, opts))
  }))
  return out
}

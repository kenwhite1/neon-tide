// ВНИМАНИЕ: копия GG/shared/wearPlacement.ts. Не редактируй здесь -
// правь в хабе и раскатывай: node scripts/sync-avatar-sdk.mjs <папка игры>
/** Register isolated overlays to the exact 600px square crop of the original photo. */
export function wearPlacement(id: string | undefined) {
  if (id === 'top_s1_windbreaker') return { x: .09, y: .30, width: .82, height: .645 }
  if (id === 'hat_grad') return { x: 0, y: -.02, width: 1, height: 1 }
  if (id === 'hat_megaphone') return { x: .2, y: -.01, width: .6, height: .29 }
  return { x: 0, y: 0, width: 1, height: 1 }
}

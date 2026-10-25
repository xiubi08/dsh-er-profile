/** Font registration and family stacks. Korean needs an explicit fallback family. */

import { GlobalFonts } from '@napi-rs/canvas'
import { join } from 'node:path'

export const BODY_FONT = 'MiSans, NotoSansKR'
export const BOLD_FONT = 'MiSansBold, NotoSansKR'
export const SEMIBOLD_FONT = 'MiSansSemibold, NotoSansKR'

let registered = false

/** Register the bundled fonts once per process. */
export function registerFonts(fontDir: string): void {
  if (registered) return
  GlobalFonts.registerFromPath(join(fontDir, 'MiSans-Bold.ttf'), 'MiSansBold')
  GlobalFonts.registerFromPath(join(fontDir, 'MiSans-Semibold.ttf'), 'MiSansSemibold')
  GlobalFonts.registerFromPath(join(fontDir, 'NotoSansKR-Bold.ttf'), 'NotoSansKR')
  registered = true
}

/** Build a canvas font string with the CJK/Korean fallback stack. */
export function font(size: number, weight: 'body' | 'semibold' | 'bold' = 'body'): string {
  const family = weight === 'bold' ? BOLD_FONT : weight === 'semibold' ? SEMIBOLD_FONT : BODY_FONT
  return `${size}px ${family}`
}

import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Fill gradients used by the S/A/B/C/D rating hexagon. */
export const TIER_BADGE_GRADIENTS: Record<string, [string, string]> = {
  S: ['#c9a6ff', '#ff9fce'],
  A: ['#f7d56b', '#c88718'],
  B: ['#dfe6ee', '#8a97a5'],
  C: ['#e0a06a', '#9a5426'],
  D: ['#cfcfcf', '#7a7a7a'],
}

const badgeCache = new Map<string, Promise<Image | undefined>>()

/** Load a packaged rating badge image (`character-tier-S.png`, etc.). */
export function loadTierBadgeImage(label: string, dir: string): Promise<Image | undefined> {
  const grade = label.toUpperCase()
  const path = join(dir, `character-tier-${grade}.png`)
  let pending = badgeCache.get(path)
  if (pending === undefined) {
    pending = readFile(path).then(loadImage).catch(() => undefined)
    badgeCache.set(path, pending)
  }
  return pending
}

/**
 * Draw a packaged rating badge centered at the given point.
 *
 * @param ctx target canvas context
 * @param image loaded badge image
 * @param cx center x
 * @param cy center y
 * @param size rendered width and height
 */
export function drawTierBadgeImage(
  ctx: SKRSContext2D,
  image: Image,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size)
}

/**
 * Draw the shared S/A/B/C/D rating hexagon.
 *
 * @param ctx target canvas context
 * @param cx hexagon center x
 * @param cy hexagon center y
 * @param radius hexagon radius
 * @param label rating letter
 * @param font font factory for the rating letter
 */
export function drawTierBadge(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  radius: number,
  label: string,
  font: (size: number, weight: 'bold') => string,
  letterSize = 44,
): void {
  const [from, to] = TIER_BADGE_GRADIENTS[label.toUpperCase()] ?? TIER_BADGE_GRADIENTS.S ?? ['#c9a6ff', '#ff9fce']
  ctx.beginPath()
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI / 3 * index - Math.PI / 6
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  const gradient = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius)
  gradient.addColorStop(0, from)
  gradient.addColorStop(1, to)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = font(letterSize, 'bold')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx, cy + 2)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
}

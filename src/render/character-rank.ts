import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import { dirname, join } from 'node:path'
import type { CharacterRatingData } from '../data/rating.ts'
import { font, registerFonts } from './fonts.ts'
import { drawTierBadge, drawTierBadgeImage, loadTierBadgeImage } from './tier-badge.ts'

const WIDTH = 1080
const PAD = 20
const GAP = 10
const COLS = 10
const CARD_W = (WIDTH - PAD * 2 - GAP * (COLS - 1)) / COLS
const CARD_H = 150
const HEADER_H = 100
const FOOTER_H = 70

const COLORS = {
  page: '#fff8fa',
  card: '#ffffff',
  border: '#ffc9d6',
  text: '#3c1e2d',
  muted: '#8f6a78',
} as const

function rounded(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1)
  return `${value}…`
}

function drawPortrait(
  ctx: SKRSContext2D,
  image: Image | undefined,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#ffe4eb'
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  if (image !== undefined) {
    const scale = Math.max((radius * 2) / image.width, (radius * 2) / image.height)
    const dw = image.width * scale
    const dh = image.height * scale
    const offsetY = radius * 0.2
    ctx.drawImage(image, cx - dw / 2, cy - dh / 2 + offsetY, dw, dh)
  }
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = '#ff9fc0'
  ctx.lineWidth = 3
  ctx.shadowColor = 'rgba(255, 130, 170, 0.55)'
  ctx.shadowBlur = 7
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  ctx.strokeStyle = 'rgba(255, 245, 248, 0.95)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, radius - 1.5, 0, Math.PI * 2)
  ctx.stroke()
}

/**
 * Render the character rating grid.
 *
 * @param data rating rows built from the tier snapshot
 * @param assets character portrait and weapon icon loaders
 * @param fontDir bundled font directory
 * @returns PNG bytes and dimensions
 */
export async function renderCharacterRating(
  data: CharacterRatingData,
  assets: {
    characterImage: (id: number) => Promise<Image | undefined>
    masteryImage: (id: number) => Promise<Image | undefined>
  },
  fontDir: string,
): Promise<{ png: Buffer; width: number; height: number }> {
  registerFonts(fontDir)
  const rows = Math.max(1, Math.ceil(data.entries.length / COLS))
  const height = PAD + HEADER_H + rows * (CARD_H + GAP) + FOOTER_H + PAD
  const canvas = createCanvas(WIDTH, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.page
  ctx.fillRect(0, 0, WIDTH, height)

  ctx.fillStyle = COLORS.text
  ctx.font = font(30, 'bold')
  ctx.fillText('角色评级排行', PAD + 6, PAD + 34)
  ctx.font = font(15, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText(
    `${data.tierLabel} · 共 ${data.entries.length} 项 · 样本 ${data.totalSamples.toLocaleString()} 场`,
    PAD + 8,
    PAD + 66,
  )

  const portraits = await Promise.all(data.entries.map(async entry => [entry.characterId, await assets.characterImage(entry.characterId)] as const))
  const weapons = await Promise.all(data.entries.map(async entry => [entry.weaponId, await assets.masteryImage(entry.weaponId)] as const))
  const portraitMap = new Map<number, Image | undefined>(portraits)
  const weaponMap = new Map<number, Image | undefined>(weapons)
  const badgeDir = join(dirname(fontDir), 'tier-grade')
  const gradeBadges = new Map<string, Image | undefined>()
  for (const grade of new Set(data.entries.map(entry => entry.grade))) {
    gradeBadges.set(grade, await loadTierBadgeImage(grade, badgeDir))
  }

  data.entries.forEach((entry, index) => {
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const x = PAD + col * (CARD_W + GAP)
    const y = PAD + HEADER_H + row * (CARD_H + GAP)

    ctx.fillStyle = COLORS.card
    rounded(ctx, x, y, CARD_W, CARD_H, 10)
    ctx.fill()

    drawPortrait(ctx, portraitMap.get(entry.characterId), x + CARD_W / 2, y + 42, 40)

    rounded(ctx, x, y, CARD_W, CARD_H, 10)
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1.5
    ctx.stroke()

    const gradeBadge = gradeBadges.get(entry.grade)
    if (gradeBadge === undefined) {
      drawTierBadge(ctx, x + CARD_W - 18, y + 18, 12, entry.grade, (size, weight) => font(size, weight), 15)
    } else {
      drawTierBadgeImage(ctx, gradeBadge, x + CARD_W - 17, y + 17, 30)
    }

    ctx.fillStyle = '#1f1f1f'
    rounded(ctx, x + CARD_W - 27, y + 62, 23, 23, 6)
    ctx.fill()
    const weapon = weaponMap.get(entry.weaponId)
    if (weapon !== undefined) {
      const scale = Math.min(17 / weapon.width, 17 / weapon.height)
      ctx.drawImage(weapon, x + CARD_W - 24, y + 65, weapon.width * scale, weapon.height * scale)
    }
    rounded(ctx, x + CARD_W - 27, y + 62, 23, 23, 6)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.font = font(11, 'bold')
    ctx.fillStyle = '#d98aa5'
    ctx.fillText(fitText(ctx, entry.name, 88), x + CARD_W / 2, y + 100)
    ctx.font = font(12, 'semibold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(`伤害 ${Math.round(entry.damage).toLocaleString()}`, x + CARD_W / 2, y + 120)
    ctx.font = font(12, 'semibold')
    ctx.fillStyle = '#d07a3a'
    ctx.fillText(`RP +${entry.rpGain.toFixed(1)}`, x + CARD_W / 2, y + 140)
    ctx.textAlign = 'left'
  })

  ctx.textAlign = 'center'
  ctx.font = font(26, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText('Powered by 椛椿&小休比', WIDTH / 2, height - PAD - FOOTER_H / 2 + 8)
  ctx.textAlign = 'left'

  return { png: canvas.toBuffer('image/png'), width: WIDTH, height }
}

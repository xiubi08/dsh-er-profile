/** Character stats card renderer (Canvas / Skia). */

import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import { dirname, join } from 'node:path'
import type { CharacterCardData } from '../types.ts'
import { font as baseFont, registerFonts } from './fonts.ts'
import { drawTierBadge, drawTierBadgeImage, loadTierBadgeImage } from './tier-badge.ts'

const font = (size: number, weight: 'body' | 'semibold' | 'bold' = 'body'): string => baseFont(size + 2, weight)

const WIDTH = 1080
const PAD = 20
const HEADER_H = 220
const STATS_H = 388
const REC_H = 340
const TRAIT_H = 330
const ITEM_H = 560
const FOOTER_H = 60

const COLORS = {
  page: '#fff8fa',
  card: '#fff0f5',
  white: '#ffffff',
  text: '#3c1e2d',
  muted: '#a37b89',
  accent: '#ff5f83',
  accentSoft: '#ffd6e0',
  border: '#ffc9d6',
  green: '#238b62',
} as const

function rounded(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function card(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 18, fill: string = COLORS.white): void {
  ctx.save()
  ctx.shadowColor = 'rgba(190, 110, 135, 0.10)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 5
  ctx.fillStyle = fill
  rounded(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1.5
  rounded(ctx, x, y, w, h, r)
  ctx.stroke()
}

function containedImage(
  ctx: SKRSContext2D,
  image: Image | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (image === undefined) {
    ctx.fillStyle = COLORS.accentSoft
    rounded(ctx, x, y, w, h, 12)
    ctx.fill()
    return
  }
  const scale = Math.min(w / image.width, h / image.height)
  const dw = image.width * scale
  const dh = image.height * scale
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

function statRow(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
  rank?: string,
): void {
  ctx.font = font(14)
  ctx.fillStyle = COLORS.muted
  ctx.fillText(label, x, y)
  ctx.font = font(30, 'bold')
  ctx.fillStyle = COLORS.text
  ctx.fillText(value, x, y + 32)
  if (rank !== undefined) {
    ctx.font = font(12)
    ctx.fillStyle = COLORS.accent
    ctx.fillText(rank, x, y + 50)
  }
}

function section(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string): void {
  card(ctx, x, y, w, h, 18)
  ctx.font = font(18, 'bold')
  ctx.fillStyle = COLORS.text
  ctx.fillText(title, x + 24, y + 32)
}

function rateColor(value: number): string {
  if (value >= 30) return '#ff7a3d'
  if (value >= 15) return '#d8a640'
  return COLORS.text
}

function drawSkillsCard(
  ctx: SKRSContext2D,
  data: CharacterCardData,
  x: number,
  y: number,
  w: number,
  h: number,
  images: Map<number, Image | undefined>,
): void {
  section(ctx, x, y, w, h, '推荐技能')
  ctx.font = baseFont(13)
  ctx.fillStyle = COLORS.muted
  ctx.fillText('技能构建', x + 24, y + 58)
  ctx.fillText('选择率', x + w - 176, y + 58)
  ctx.fillText('胜率', x + w - 92, y + 58)

  const rows = data.recommendations.skillBuilds.slice(0, 5)
  if (rows.length === 0) {
    ctx.font = font(14)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('暂无数据', x + 24, y + 96)
    return
  }
  rows.forEach((row, index) => {
    const rowY = y + 76 + index * 46
    row.slots.slice(0, 4).forEach((slot, slotIndex) => {
      const ix = x + 24 + slotIndex * 40
      ctx.fillStyle = '#3c1e2d'
      rounded(ctx, ix, rowY, 36, 36, 6)
      ctx.fill()
      containedImage(ctx, images.get(slot.skillId), ix + 2, rowY + 2, 32, 32)
      const badge = 16
      ctx.fillStyle = '#2a1a21'
      rounded(ctx, ix + 36 - badge, rowY + 36 - badge, badge, badge, 3)
      ctx.fill()
      ctx.strokeStyle = '#8f6a78'
      ctx.lineWidth = 1
      rounded(ctx, ix + 36 - badge, rowY + 36 - badge, badge, badge, 3)
      ctx.stroke()
      ctx.font = font(10, 'bold')
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.fillText(slot.slot, ix + 36 - badge / 2, rowY + 33)
      ctx.textAlign = 'left'
    })
    ctx.font = baseFont(15, 'semibold')
    ctx.fillStyle = rateColor(row.selectionRate)
    ctx.fillText(`${row.selectionRate.toFixed(1)}%`, x + w - 176, rowY + 22)
    ctx.fillStyle = rateColor(row.winRate)
    ctx.fillText(`${row.winRate.toFixed(1)}%`, x + w - 92, rowY + 22)
  })
}

function drawTacticalCard(
  ctx: SKRSContext2D,
  data: CharacterCardData,
  x: number,
  y: number,
  w: number,
  h: number,
  images: Map<number, Image | undefined>,
  names: (id: number) => string,
): void {
  section(ctx, x, y, w, h, '推荐战术技能')
  ctx.font = font(13)
  ctx.fillStyle = COLORS.muted
  ctx.fillText('战术技能', x + 24, y + 58)
  ctx.fillText('选择率', x + w - 176, y + 58)
  ctx.fillText('胜率', x + w - 92, y + 58)

  const rows = data.recommendations.tactical.slice(0, 5)
  if (rows.length === 0) {
    ctx.font = font(14)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('暂无数据', x + 24, y + 96)
    return
  }
  rows.forEach((row, index) => {
    const rowY = y + 76 + index * 44
    containedImage(ctx, images.get(row.id), x + 24, rowY, 32, 32)
    ctx.font = font(14, 'semibold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(names(row.id), x + 66, rowY + 22)
    ctx.font = font(15, 'semibold')
    ctx.fillStyle = rateColor(row.selectionRate)
    ctx.fillText(`${row.selectionRate.toFixed(1)}%`, x + w - 176, rowY + 21)
    ctx.fillStyle = rateColor(row.winRate)
    ctx.fillText(`${row.winRate.toFixed(1)}%`, x + w - 92, rowY + 21)
  })
}

function drawTraitsCard(
  ctx: SKRSContext2D,
  data: CharacterCardData,
  x: number,
  y: number,
  w: number,
  h: number,
  images: Map<number, Image | undefined>,
  names: (id: number) => string,
): void {
  section(ctx, x, y, w, h, '推荐潜能')
  const groups = data.recommendations.traitGroups
  if (groups.length === 0) {
    ctx.font = font(14)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('暂无数据', x + 24, y + 72)
    return
  }
  const columnW = (w - 40) / 3
  const winColors = rankColorsFour(groups.map(group => group.winRate))
  groups.forEach((group, index) => {
    const cx = x + 16 + index * columnW
    const cy = y + 50
    const cw = columnW - 8
    card(ctx, cx, cy, cw, h - 66, 12, '#fff7fa')
    containedImage(ctx, images.get(group.coreId), cx + 12, cy + 12, 38, 38)
    ctx.font = font(16, 'bold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(names(group.coreId), cx + 58, cy + 36)
    ctx.font = font(13)
    let textX = cx + 12
    const textY = cy + 66
    ctx.fillStyle = COLORS.muted
    ctx.fillText('选择率', textX, textY)
    textX += ctx.measureText('选择率').width + 4
    ctx.fillStyle = '#111111'
    ctx.fillText(`${group.selectionRate.toFixed(1)}%`, textX, textY)
    textX += ctx.measureText(`${group.selectionRate.toFixed(1)}%`).width + 8
    ctx.fillStyle = COLORS.muted
    ctx.fillText('| 胜率', textX, textY)
    textX += ctx.measureText('| 胜率').width + 4
    ctx.fillStyle = winColors[index] ?? COLORS.text
    ctx.fillText(`${group.winRate.toFixed(1)}%`, textX, textY)

    group.combos.slice(0, 4).forEach((combo, comboIndex) => {
      const rowY = cy + 82 + comboIndex * 40
      combo.traitIds.slice(0, 4).forEach((traitId, traitIndex) => {
        containedImage(ctx, images.get(traitId), cx + 12 + traitIndex * 30, rowY, 26, 26)
      })
      ctx.font = font(14, 'semibold')
      ctx.fillStyle = '#111111'
      ctx.textAlign = 'right'
      ctx.fillText(`${combo.selectionRate.toFixed(1)}%`, cx + cw - 12, rowY + 18)
      ctx.textAlign = 'left'
    })
  })
}

const ITEM_GRADE_COLORS: Record<string, string> = {
  Mythic: '#e5484d',
  Legend: '#f0a43a',
  Legendary: '#f0a43a',
  Epic: '#9b59d0',
  Rare: '#3f8fd6',
  Uncommon: '#3fae5a',
  Common: '#9e9e9e',
}

function rankColors(values: number[]): string[] {
  const colors: string[] = values.map(() => COLORS.text)
  ;[...values.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([index], rank) => {
      colors[index] = rank === 0 ? '#d93025' : rank === 1 ? '#c98a00' : '#8a8a8a'
    })
  return colors
}

function rankColorsFour(values: number[]): string[] {
  const palette = ['#d93025', '#c98a00', '#111111', '#8a8a8a']
  const colors: string[] = values.map(() => '#111111')
  ;[...values.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([index], rank) => {
      colors[index] = palette[Math.min(rank, palette.length - 1)] ?? '#111111'
    })
  return colors
}

function drawItemStatCard(
  ctx: SKRSContext2D,
  item: { id: number; name: string; grade: string; selectionRate: number; winRate: number },
  image: Image | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  selectionColor: string,
  winColor: string,
): void {
  const color = ITEM_GRADE_COLORS[item.grade] ?? '#9e9e9e'
  ctx.save()
  ctx.fillStyle = '#ffffff'
  rounded(ctx, x, y, w, h, 8)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.shadowColor = color
  ctx.shadowBlur = 4
  rounded(ctx, x, y, w, h, 8)
  ctx.stroke()
  ctx.restore()
  containedImage(ctx, image, x + 6, y + 7, 42, 42)
  ctx.font = font(12, 'semibold')
  ctx.fillStyle = COLORS.text
  ctx.fillText(fitText(ctx, item.name, w - 104), x + 54, y + 22)
  ctx.font = font(11, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText('选择率', x + 54, y + 45)
  ctx.fillStyle = selectionColor
  ctx.fillText(`${item.selectionRate.toFixed(1)}%`, x + 98, y + 45)
  ctx.fillStyle = COLORS.muted
  ctx.fillText('胜率', x + 140, y + 45)
  ctx.fillStyle = winColor
  ctx.fillText(`${item.winRate.toFixed(1)}%`, x + 172, y + 45)
}

function drawItemsCard(
  ctx: SKRSContext2D,
  data: CharacterCardData,
  x: number,
  y: number,
  w: number,
  h: number,
  images: Map<number, Image | undefined>,
  names: (id: number) => string,
): void {
  section(ctx, x, y, w, h, '物品统计')
  const slots = data.recommendations.itemSlots
  if (slots.length === 0) {
    ctx.font = font(14)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('暂无数据', x + 24, y + 72)
    return
  }
  const slotW = (w - 60) / 2
  const slotH = 160
  slots.forEach((slot, index) => {
    const col = index < 3 ? 0 : 1
    const row = index < 3 ? index : index - 3
    const cx = x + 20 + col * (slotW + 20)
    const cy = y + 48 + row * 166
    card(ctx, cx, cy, slotW, slotH, 12, '#fff7fa')
    ctx.font = font(14, 'bold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(slot.slotName, cx + 14, cy + 22)

    const itemW = (slotW - 40) / 2
    const selectionColors = rankColors(slot.items.map(item => item.selectionRate))
    const winColors = rankColors(slot.items.map(item => item.winRate))
    slot.items.slice(0, 3).forEach((item, itemIndex) => {
      const ix = cx + 12 + (itemIndex % 2) * (itemW + 8)
      const iy = cy + 30 + Math.floor(itemIndex / 2) * 62
      drawItemStatCard(ctx, {
        id: item.id,
        name: names(item.id),
        grade: item.grade,
        selectionRate: item.selectionRate,
        winRate: item.winRate,
      }, images.get(item.id), ix, iy, itemW, 56, selectionColors[itemIndex] ?? COLORS.text, winColors[itemIndex] ?? COLORS.text)
    })
  })
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1)
  return `${value}…`
}

/** Render one character stats card to PNG bytes. */
export async function renderCharacterCard(
  data: CharacterCardData,
  assets: {
    characterImage: (id: number) => Promise<Image | undefined>
    skillImage: (id: number) => Promise<Image | undefined>
    tacticalImage: (id: number) => Promise<Image | undefined>
    traitImage: (id: number) => Promise<Image | undefined>
    itemImage: (id: number) => Promise<Image | undefined>
    itemName: (id: number) => string
    tacticalName: (id: number) => string
    traitName: (id: number) => string
  },
  characterId: number,
  fontDir: string,
): Promise<{ png: Buffer; width: number; height: number }> {
  registerFonts(fontDir)
  const tierImage = await loadTierBadgeImage(data.tierBadge, join(dirname(fontDir), 'tier-grade'))
  const height = PAD + HEADER_H + 20 + STATS_H + 20 + REC_H + 20 + TRAIT_H + 20 + ITEM_H + FOOTER_H + PAD
  const canvas = createCanvas(WIDTH, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.page
  ctx.fillRect(0, 0, WIDTH, height)

  const x = PAD
  const y = PAD
  const w = WIDTH - PAD * 2
  card(ctx, x, y, w, HEADER_H, 20, COLORS.card)
  containedImage(ctx, await assets.characterImage(characterId), x + 26, y + 26, 150, 160)

  ctx.save()
  ctx.strokeStyle = '#ff9fc0'
  ctx.lineWidth = 3
  ctx.shadowColor = 'rgba(255, 110, 160, 0.75)'
  ctx.shadowBlur = 16
  rounded(ctx, x + 35, y + 24, 132, 164, 12)
  ctx.stroke()
  ctx.shadowBlur = 6
  ctx.strokeStyle = 'rgba(255, 230, 240, 0.95)'
  ctx.lineWidth = 1.5
  rounded(ctx, x + 35, y + 24, 132, 164, 12)
  ctx.stroke()
  ctx.restore()

  ctx.fillStyle = COLORS.text
  ctx.font = font(40, 'bold')
  ctx.fillText(data.name, x + 200, y + 74)
  ctx.font = font(20, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText(`${data.weaponName} | ${data.tierLabel}`, x + 202, y + 112)
  ctx.font = font(14)
  ctx.fillText(`选择数: ${data.pickCount.toLocaleString()}`, x + 202, y + 152)
  ctx.fillText(`总样本场次: ${data.totalSamples.toLocaleString()}`, x + 202, y + 178)

  if (tierImage === undefined) {
    drawTierBadge(ctx, x + w - 96, y + 92, 62, data.tierBadge, (size, weight) => font(size, weight))
  } else {
    drawTierBadgeImage(ctx, tierImage, x + w - 96, y + 92, 124)
  }

  const statsY = y + HEADER_H + 20
  card(ctx, x, statsY, w, STATS_H, 20)
  ctx.font = font(18, 'bold')
  ctx.fillStyle = COLORS.text
  ctx.fillText('数据统计', x + 26, statsY + 34)

  const metricW = (w - 60) / 2
  const metricH = 68
  const metricGap = 8
  const metricStartY = statsY + 52
  const rankText = (rank: number, size: number): string => size > 0 ? `#${rank} / ${size}` : ''
  const metrics: { label: string; value: string; rank?: string }[] = [
    { label: '胜率', value: `${data.winRate.toFixed(1)}%`, rank: rankText(data.winRank, data.winRankSize) },
    { label: 'TOP 3', value: `${data.top3Rate.toFixed(1)}%`, rank: rankText(data.top3Rank, data.top3RankSize) },
    { label: '平均排名', value: `#${data.avgRank.toFixed(2)}`, rank: rankText(data.avgRankRank, data.avgRankRankSize) },
    { label: '平均击杀', value: data.avgKill.toFixed(2), rank: rankText(data.avgKillRank, data.avgKillRankSize) },
    { label: 'RP', value: data.rp.toFixed(1), rank: rankText(data.rpRank, data.rpRankSize) },
    { label: '选择率', value: `${data.pickRate.toFixed(2)}%`, rank: rankText(data.pickRank, data.pickRankSize) },
    { label: '平均伤害', value: Math.round(data.avgDamage).toLocaleString() },
    { label: '平均 TK', value: data.avgTk.toFixed(2) },
  ]
  metrics.forEach((metric, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const cx = x + 20 + col * (metricW + 20)
    const cy = metricStartY + row * (metricH + metricGap)
    card(ctx, cx, cy, metricW, metricH, 10, '#fff7fa')
    ctx.font = font(14)
    ctx.fillStyle = COLORS.muted
    ctx.fillText(metric.label, cx + 14, cy + 20)
    ctx.font = font(24, 'bold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(metric.value, cx + 14, cy + 48)
    if (metric.rank !== undefined) {
      ctx.font = font(11, 'semibold')
      ctx.fillStyle = COLORS.accent
      ctx.textAlign = 'right'
      ctx.fillText(metric.rank, cx + metricW - 14, cy + 48)
      ctx.textAlign = 'left'
    }
  })

  const skillIds = new Set<number>()
  for (const build of data.recommendations.skillBuilds) for (const slot of build.slots) skillIds.add(slot.skillId)
  const tacticalIds = new Set(data.recommendations.tactical.map(row => row.id))
  const traitIds = new Set<number>()
  for (const group of data.recommendations.traitGroups) {
    traitIds.add(group.coreId)
    for (const combo of group.combos) for (const traitId of combo.traitIds) traitIds.add(traitId)
  }
  const itemIds = new Set<number>()
  for (const slot of data.recommendations.itemSlots) for (const item of slot.items) itemIds.add(item.id)

  const [skillImages, tacticalImages, traitImages, itemImages] = await Promise.all([
    Promise.all([...skillIds].map(async id => [id, await assets.skillImage(id)] as const)),
    Promise.all([...tacticalIds].map(async id => [id, await assets.tacticalImage(id)] as const)),
    Promise.all([...traitIds].map(async id => [id, await assets.traitImage(id)] as const)),
    Promise.all([...itemIds].map(async id => [id, await assets.itemImage(id)] as const)),
  ])
  const skills = new Map<number, Image | undefined>(skillImages)
  const tacticals = new Map<number, Image | undefined>(tacticalImages)
  const traits = new Map<number, Image | undefined>(traitImages)
  const itemArt = new Map<number, Image | undefined>(itemImages)

  const recY = statsY + STATS_H + 20
  const halfW = (w - 20) / 2
  drawSkillsCard(ctx, data, x, recY, halfW, REC_H, skills)
  drawTacticalCard(ctx, data, x + halfW + 20, recY, halfW, REC_H, tacticals, id => assets.tacticalName(id))
  const traitY = recY + REC_H + 20
  drawTraitsCard(ctx, data, x, traitY, w, TRAIT_H, traits, id => assets.traitName(id))
  const itemY = traitY + TRAIT_H + 20
  drawItemsCard(ctx, data, x, itemY, w, ITEM_H, itemArt, id => assets.itemName(id))

  const footerY = height - PAD - FOOTER_H
  ctx.textAlign = 'center'
  ctx.font = baseFont(26, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText('Powered by 椛椿&小休比', WIDTH / 2, footerY + FOOTER_H / 2 + 8)
  ctx.textAlign = 'left'

  return { png: canvas.toBuffer('image/png'), width: WIDTH, height }
}

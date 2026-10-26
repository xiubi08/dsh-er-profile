/** Player profile card renderer (Canvas / Skia), aligned with the original AstrBot layout. */

import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import type { MatchData, PlayerCardData, TeammateData } from '../types.ts'
import { font, registerFonts } from './fonts.ts'

const WIDTH = 1080
const PAD = 20
const GAP = 20
const HEADER_H = 250
const SUMMARY_H = 250
const HERO_ROW_H = 100
const MATCH_H = 166
const MATCH_VALUE_FONT = 26
const MATCH_VALUE_BASELINE = 92
const MATCH_LABEL_BASELINE = 116
const MATCH_ITEM_TOP = 40
const TEAMMATE_HEADER_H = 28
const TEAMMATE_ROW_H = 112
const TEAMMATE_SCALE = 0.98
const TEAMMATE_SCALED_H = Math.round(TEAMMATE_ROW_H * TEAMMATE_SCALE)
const TEAMMATE_GAP = 8
const FOOTER_H = 70

const COLORS = {
  page: '#fff8fa',
  card: '#fff0f5',
  white: '#ffffff',
  text: '#3c1e2d',
  muted: '#a37b89',
  faint: '#c9a6b2',
  accent: '#ff5f83',
  accentSoft: '#ffd6e0',
  border: '#ffc9d6',
  green: '#238b62',
  red: '#cf3f56',
  gold: '#f3c64e',
} as const

const ITEM_GRADE_COLORS: Record<number, string> = {
  1: '#9e9e9e',
  2: '#3fae5a',
  3: '#3f8fd6',
  4: '#9b59d0',
  5: '#f0a43a',
  6: '#e5484d',
}

function teammateBlockHeight(count: number): number {
  return count > 0
    ? TEAMMATE_HEADER_H + count * TEAMMATE_SCALED_H + (count - 1) * TEAMMATE_GAP + 10
    : 0
}

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

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let result = text
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1)
  return `${result}…`
}

/** Scale to fit and center without cropping or stretching. */
function containedImage(
  ctx: SKRSContext2D,
  image: Image | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  border = false,
): void {
  if (image === undefined) {
    ctx.fillStyle = COLORS.accentSoft
    rounded(ctx, x, y, w, h, 10)
    ctx.fill()
    return
  }
  const scale = Math.min(w / image.width, h / image.height)
  const dw = image.width * scale
  const dh = image.height * scale
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  if (border) {
    ctx.strokeStyle = 'rgba(60, 30, 45, 0.38)'
    ctx.lineWidth = 2
    rounded(ctx, x, y, w, h, 10)
    ctx.stroke()
  }
}

/** Fill the frame without stretching: scale by the larger ratio and crop the overflow. */
function coverImage(
  ctx: SKRSContext2D,
  image: Image | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 10,
): void {
  ctx.save()
  rounded(ctx, x, y, w, h, r)
  ctx.clip()
  if (image === undefined) {
    ctx.fillStyle = COLORS.accentSoft
    ctx.fillRect(x, y, w, h)
  } else {
    const scale = Math.max(w / image.width, h / image.height)
    const sw = w / scale
    const sh = h / scale
    ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h)
  }
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = '#ff8fae'
  ctx.lineWidth = 2.5
  ctx.shadowColor = 'rgba(255, 110, 145, 0.55)'
  ctx.shadowBlur = 7
  rounded(ctx, x, y, w, h, r)
  ctx.stroke()
  ctx.restore()
}

function drawHeader(ctx: SKRSContext2D, data: PlayerCardData, tierImage: Image | undefined): void {
  const x = PAD
  const y = PAD
  const w = WIDTH - PAD * 2
  card(ctx, x, y, w, HEADER_H, 20, COLORS.card)

  const subY = y + 10
  const subH = 230

  ctx.fillStyle = COLORS.text
  ctx.font = font(44, 'bold')
  ctx.fillText(fitText(ctx, data.name, 210), x + 26, y + 68)

  ctx.font = font(20)
  ctx.fillStyle = COLORS.muted
  ctx.fillText(`Lv.${data.level}`, x + 28, y + 104)

  ctx.font = font(18, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText('MMR:', x + 28, y + 158)
  ctx.font = font(48, 'bold')
  ctx.fillStyle = COLORS.text
  ctx.fillText(String(data.mmr), x + 28, y + 208)

  ctx.font = font(15)
  ctx.fillStyle = COLORS.muted
  ctx.fillText(`永恒: ${data.immortalMmr > 0 ? data.immortalMmr.toLocaleString() : '—'}  |  半神: ${data.titanMmr > 0 ? data.titanMmr.toLocaleString() : '—'}`, x + 28, y + 232)

  card(ctx, x + 258, subY, 524, subH, 14, '#ffffff')
  drawMmrChart(ctx, data, x + 270, y + 55, 500, 140)

  containedImage(ctx, tierImage, x + w - 178, y + 30, 110, 136)

  ctx.textAlign = 'center'
  ctx.font = font(22, 'bold')
  ctx.fillStyle = COLORS.text
  ctx.fillText(data.hasRankedData ? data.tierName : '段位未鉴定', x + w - 123, y + 190)

  const ranks: string[] = []
  if (data.rankGlobal > 0) ranks.push(`Global ${data.rankGlobal.toLocaleString()}名 (上位 ${data.rankGlobalPercent.toFixed(2)}%)`)
  if (data.rankLocal > 0) ranks.push(`Asia ${data.rankLocal.toLocaleString()}名 (上位 ${data.rankLocalPercent.toFixed(2)}%)`)
  if (ranks.length === 0) ranks.push('暂无排名数据')
  ctx.font = font(13)
  ctx.fillStyle = COLORS.muted
  ranks.slice(0, 2).forEach((rank, index) => {
    ctx.fillText(rank, x + w - 123, y + 214 + index * 20)
  })
  ctx.textAlign = 'left'
}

function drawMmrChart(ctx: SKRSContext2D, data: PlayerCardData, x: number, y: number, w: number, h: number): void {
  const points = data.mmrChart
  if (points.length < 2) {
    ctx.font = font(14)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('MMR 趋势数据不足', x + 12, y + h / 2)
    return
  }
  const values = points.map(point => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const left = x + 48
  const top = y + 12
  const chartW = w - 56
  const chartH = h - 38

  ctx.strokeStyle = 'rgba(180, 140, 155, 0.28)'
  ctx.lineWidth = 1
  for (let index = 0; index <= 3; index += 1) {
    const lineY = top + (chartH * index) / 3
    ctx.beginPath()
    ctx.moveTo(left, lineY)
    ctx.lineTo(left + chartW, lineY)
    ctx.stroke()
    const value = Math.round(max - ((max - min) * index) / 3)
    ctx.font = font(12)
    ctx.fillStyle = COLORS.muted
    ctx.textAlign = 'right'
    ctx.fillText(value.toLocaleString(), left - 8, lineY + 4)
    ctx.textAlign = 'left'
  }

  ctx.strokeStyle = COLORS.accent
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.beginPath()
  points.forEach((point, index) => {
    const px = left + (chartW * index) / (points.length - 1)
    const py = top + chartH - ((point.value - min) / span) * chartH
    if (index === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()

  points.forEach((point, index) => {
    const px = left + (chartW * index) / (points.length - 1)
    const py = top + chartH - ((point.value - min) / span) * chartH
    ctx.beginPath()
    ctx.fillStyle = COLORS.accent
    ctx.arc(px, py, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = font(12)
    ctx.fillStyle = COLORS.muted
    ctx.textAlign = 'center'
    ctx.fillText(point.label, px, y + h + 2)
    ctx.textAlign = 'left'
  })
}

function drawSummary(ctx: SKRSContext2D, data: PlayerCardData, y: number): void {
  const x = PAD
  const w = WIDTH - PAD * 2
  card(ctx, x, y, w, SUMMARY_H, 20)
  ctx.fillStyle = COLORS.text
  ctx.font = font(20, 'bold')
  ctx.fillText('RANK 统计', x + 26, y + 38)

  const columns: [string, string][][] = [
    [
      ['平均 TK', data.summary.avgTk.toFixed(2)],
      ['平均击杀', data.summary.avgKill.toFixed(2)],
      ['平均助攻', data.summary.avgAssist.toFixed(2)],
      ['平均狩猎野生动物', data.summary.avgMonsterKill.toFixed(1)],
    ],
    [
      ['胜率', `${data.summary.winRate}%`],
      ['TOP 2', `${data.summary.top2Rate}%`],
      ['TOP 3', `${data.summary.top3Rate}%`],
      ['平均获得荣誉值', data.summary.avgVfCredit.toLocaleString()],
    ],
    [
      ['游戏场次', String(data.summary.play)],
      ['平均伤害', data.summary.avgDamage.toLocaleString()],
      ['平均排名', `#${data.summary.avgRank.toFixed(2)}`],
      ['平均视野贡献', data.summary.avgViewContribution.toFixed(1)],
    ],
  ]
  const columnX = [x + 26, x + 372, x + 700]
  columns.forEach((column, columnIndex) => {
    column.forEach(([label, value], rowIndex) => {
      const cx = columnX[columnIndex] ?? x + 26
      const cy = y + 86 + rowIndex * 42
      ctx.beginPath()
      ctx.fillStyle = COLORS.accent
      ctx.arc(cx + 4, cy - 5, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = font(18)
      ctx.fillStyle = COLORS.muted
      ctx.fillText(`${label}:`, cx + 16, cy)
      const valueX = cx + 16 + ctx.measureText(`${label}: `).width + 8
      ctx.font = font(22, 'bold')
      ctx.fillStyle = COLORS.text
      ctx.fillText(value, valueX, cy)
    })
  })
}

function drawHeroes(ctx: SKRSContext2D, data: PlayerCardData, y: number, images: Map<number, Image | undefined>): void {
  const x = PAD
  const w = WIDTH - PAD * 2
  ctx.fillStyle = COLORS.text
  ctx.font = font(20, 'bold')
  ctx.fillText('常用英雄', x + 8, y + 28)

  if (data.heroes.length === 0) {
    ctx.font = font(15)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('暂无英雄数据', x + 8, y + 60)
    return
  }

  data.heroes.forEach((hero, index) => {
    const rowY = y + 42 + index * HERO_ROW_H
    card(ctx, x, rowY, w, HERO_ROW_H - 8, 14)
    coverImage(ctx, images.get(hero.characterId), x + 12, rowY + 15, 62, 62, 12)

    const valueY = rowY + 46
    const labelY = rowY + 70
    ctx.font = font(20, 'bold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(fitText(ctx, hero.characterName, 140), x + 86, rowY + 40)
    ctx.font = font(13)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('英雄', x + 86, rowY + 64)

    ctx.font = font(18, 'semibold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(`${hero.play} 场 | ${hero.winRate}%`, x + 260, valueY)
    ctx.font = font(12)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('场次 / 胜率', x + 260, labelY)

    ctx.font = font(18, 'semibold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(`#${hero.avgRank.toFixed(2)}`, x + 420, valueY)
    ctx.font = font(12)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('场均排名', x + 420, labelY)

    ctx.font = font(17, 'semibold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(`${hero.avgKill.toFixed(2)} / ${hero.avgAssist.toFixed(2)}`, x + 550, valueY)
    ctx.font = font(12)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('平均击杀 / 助攻', x + 550, labelY)

    ctx.font = font(17, 'semibold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(hero.avgDamage.toLocaleString(), x + 710, valueY)
    ctx.font = font(12)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('平均伤害', x + 710, labelY)

    ctx.font = font(18, 'semibold')
    ctx.fillStyle = hero.mmrGain >= 0 ? COLORS.green : COLORS.red
    const gain = hero.mmrGain > 0 ? `+${hero.mmrGain}` : String(hero.mmrGain)
    ctx.textAlign = 'center'
    ctx.fillText(`${gain} RP`, x + 920, valueY)
    ctx.textAlign = 'left'
  })
}

function rankColor(rank: number): string {
  if (rank === 1) return COLORS.gold
  if (rank <= 3) return COLORS.accentSoft
  return '#ead9df'
}

function drawDamageBar(ctx: SKRSContext2D, x: number, y: number, damage: number, width = 130, maxDamage = 50_000): void {
  const ratio = Math.min(damage / Math.max(maxDamage, 1), 1)
  ctx.fillStyle = '#f0dfe5'
  rounded(ctx, x, y, width, 9, 5)
  ctx.fill()
  ctx.fillStyle = COLORS.accent
  rounded(ctx, x, y, Math.max(width * ratio, 5), 9, 5)
  ctx.fill()
  ctx.font = font(16, 'semibold')
  ctx.fillStyle = COLORS.text
  ctx.fillText(damage.toLocaleString(), x, y - 8)
  ctx.font = font(14)
  ctx.fillStyle = COLORS.muted
  ctx.fillText('伤害', x, y + 30)
}

function drawItem(ctx: SKRSContext2D, image: Image | undefined, grade: number, x: number, y: number, w: number, h: number): void {
  const color = ITEM_GRADE_COLORS[grade] ?? '#9e9e9e'
  ctx.save()
  ctx.fillStyle = 'rgba(60, 30, 45, 0.06)'
  rounded(ctx, x, y, w, h, 7)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.shadowColor = color
  ctx.shadowBlur = 6
  rounded(ctx, x, y, w, h, 7)
  ctx.stroke()
  ctx.restore()
  containedImage(ctx, image, x + 3, y + 3, w - 6, h - 6)
}

function drawMatches(
  ctx: SKRSContext2D,
  data: PlayerCardData,
  y: number,
  characters: Map<number, Image | undefined>,
  items: Map<number, Image | undefined>,
  weapons: Map<number, Image | undefined>,
  tacticals: Map<number, Image | undefined>,
  traits: Map<number, Image | undefined>,
  skins: Map<number, Image | undefined>,
): void {
  const x = PAD
  const w = WIDTH - PAD * 2
  const teammateOffset = teammateBlockHeight(data.firstMatchTeammates.length)

  data.matches.forEach((match: MatchData, index) => {
    const rowY = y + index * MATCH_H + (index > 0 ? teammateOffset : 0)
    const cardH = MATCH_H - 10
    card(ctx, x, rowY, w, cardH, 14)

    ctx.save()
    rounded(ctx, x, rowY, w, cardH, 14)
    ctx.clip()
    ctx.fillStyle = '#ffe4eb'
    ctx.fillRect(x, rowY, w, 30)
    ctx.restore()

    ctx.font = font(13)
    ctx.fillStyle = COLORS.muted
    ctx.fillText(`${match.startTime}   ${match.serverName}   ID:${match.gameId}`, x + 12, rowY + 19)

    ctx.textAlign = 'right'
    ctx.fillText(`#${match.gameRank} · ${match.modeLabel}`, x + w - 12, rowY + 19)
    ctx.textAlign = 'left'

    ctx.fillStyle = rankColor(match.gameRank)
    rounded(ctx, x + 14, rowY + 54, 64, 64, 10)
    ctx.fill()
    ctx.fillStyle = COLORS.text
    const cobaltBadge = match.modeLabel === '钴协议' || match.modeLabel === '钴联盟'
    if (cobaltBadge && (match.gameRank === 1 || match.gameRank === 2)) {
      ctx.font = font(18, 'bold')
      ctx.textAlign = 'center'
      ctx.fillText(match.gameRank === 1 ? '胜利' : '失败', x + 46, rowY + 82)
      ctx.font = font(13)
      ctx.fillText(match.modeLabel, x + 46, rowY + 104)
      ctx.textAlign = 'left'
    } else {
      ctx.font = font(24, 'bold')
      ctx.textAlign = 'center'
      ctx.fillText(`#${match.gameRank}`, x + 46, rowY + 82)
      ctx.font = font(13)
      ctx.fillText(match.modeLabel, x + 46, rowY + 104)
      ctx.textAlign = 'left'
    }

    coverImage(ctx, skins.get(match.skinId) ?? characters.get(match.characterId), x + 96, rowY + 54, 64, 64)
    ctx.font = font(16, 'semibold')
    ctx.fillStyle = COLORS.text
    ctx.textAlign = 'center'
    ctx.fillText(fitText(ctx, match.characterName, 96), x + 128, rowY + 134)
    ctx.textAlign = 'left'

    ctx.font = font(MATCH_VALUE_FONT, 'bold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(`${match.teamKill}/${match.kills}/${match.assists}`, x + 180, rowY + MATCH_VALUE_BASELINE)
    ctx.font = font(15)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('TK / K / A', x + 180, rowY + MATCH_LABEL_BASELINE)

    if (match.weaponId > 0) {
      ctx.fillStyle = '#1f1f1f'
      rounded(ctx, x + 300, rowY + 48, 28, 28, 6)
      ctx.fill()
      containedImage(ctx, weapons.get(match.weaponId), x + 303, rowY + 51, 22, 22)
    }
    if (match.tacticalSkillId > 0) {
      containedImage(ctx, tacticals.get(match.tacticalSkillId), x + 334, rowY + 48, 28, 28)
      if (match.tacticalSkillLevel > 0) {
        ctx.fillStyle = '#f5f5f5'
        rounded(ctx, x + 350, rowY + 62, 14, 14, 3)
        ctx.fill()
        ctx.strokeStyle = '#3c3c3c'
        ctx.lineWidth = 1
        rounded(ctx, x + 350, rowY + 62, 14, 14, 3)
        ctx.stroke()
        ctx.font = font(9, 'bold')
        ctx.fillStyle = '#1f1f1f'
        ctx.textAlign = 'center'
        ctx.fillText(String(match.tacticalSkillLevel), x + 357, rowY + 73)
        ctx.textAlign = 'left'
      }
    }
    if (match.traitCoreId > 0) {
      containedImage(ctx, traits.get(match.traitCoreId), x + 300, rowY + 79, 30, 30)
    }
    if (match.traitSubId > 0) {
      containedImage(ctx, traits.get(match.traitSubId), x + 334, rowY + 79, 30, 30)
    }

    ctx.font = font(MATCH_VALUE_FONT, 'bold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(match.damage.toLocaleString(), x + 400, rowY + MATCH_VALUE_BASELINE)
    ctx.font = font(15)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('伤害', x + 400, rowY + MATCH_LABEL_BASELINE)

    ctx.font = font(MATCH_VALUE_FONT, 'bold')
    ctx.fillStyle = COLORS.text
    ctx.fillText(match.kda.toFixed(2), x + 535, rowY + MATCH_VALUE_BASELINE)
    ctx.font = font(15)
    ctx.fillStyle = COLORS.muted
    ctx.fillText('KDA', x + 535, rowY + MATCH_LABEL_BASELINE)

    const cobaltMode = match.modeLabel === '钴协议' || match.modeLabel === '钴联盟'
    if (cobaltMode) {
      // Cobalt modes intentionally leave the old path/RP column empty.
    } else if (match.isRankMatch) {
      ctx.font = font(MATCH_VALUE_FONT, 'bold')
      const before = match.mmrBefore.toLocaleString()
      const gain = match.mmrGain
      const gainText = `${gain >= 0 ? '+' : ''}${gain}`
      const beforeWidth = ctx.measureText(before).width
      const gainWidth = ctx.measureText(gainText).width
      // Right-align the pair against the item column so a five-digit MMR plus
      // a two-digit gain never runs into the equipment grid.
      const right = x + w - 254
      const start = right - beforeWidth - 6 - gainWidth
      ctx.fillStyle = COLORS.text
      ctx.fillText(before, start, rowY + MATCH_VALUE_BASELINE)
      ctx.fillStyle = gain >= 0 ? '#d94a63' : '#4a7bd9'
      ctx.fillText(gainText, start + beforeWidth + 6, rowY + MATCH_VALUE_BASELINE)
      ctx.font = font(15)
      ctx.fillStyle = COLORS.muted
      ctx.fillText('RP', x + 665, rowY + MATCH_LABEL_BASELINE)
    } else {
      ctx.font = font(MATCH_VALUE_FONT, 'bold')
      ctx.fillStyle = COLORS.text
      ctx.fillText(match.pathId > 0 ? String(match.pathId) : '—', x + 665, rowY + MATCH_VALUE_BASELINE)
      ctx.font = font(15)
      ctx.fillStyle = COLORS.muted
      ctx.fillText('路径 ID', x + 665, rowY + MATCH_LABEL_BASELINE)
    }

    const totalItems = Math.min(match.items.length, 6)
    match.items.slice(0, 6).forEach((item, itemIndex) => {
      const col = itemIndex % 3
      const row = Math.floor(itemIndex / 3)
      const countInRow = row === 0 ? Math.min(totalItems, 3) : totalItems - 3
      const offset = ((3 - countInRow) * 76) / 2
      drawItem(
        ctx,
        items.get(item.id),
        item.grade,
        x + w - 248 + col * 76 + offset,
        rowY + MATCH_ITEM_TOP + row * 54,
        66,
        46,
      )
    })
  })

  if (data.firstMatchTeammates.length > 0) {
    drawTeammates(ctx, data.firstMatchTeammates, y + MATCH_H, characters, items, data.matches[0], data.teamMaxDamage, weapons, tacticals, traits, skins)
  }
}

function drawTeammates(
  ctx: SKRSContext2D,
  teammates: TeammateData[],
  y: number,
  characters: Map<number, Image | undefined>,
  items: Map<number, Image | undefined>,
  firstMatch: MatchData | undefined,
  teamMaxDamage: number,
  weapons: Map<number, Image | undefined>,
  tacticals: Map<number, Image | undefined>,
  traits: Map<number, Image | undefined>,
  skins: Map<number, Image | undefined>,
): void {
  const x = PAD + 40
  const w = WIDTH - PAD * 2 - 80
  const blockH = teammateBlockHeight(teammates.length)
  card(ctx, x, y, w, blockH, 14, '#fff7fa')

  ctx.save()
  rounded(ctx, x, y, w, blockH, 14)
  ctx.clip()
  ctx.fillStyle = '#ffe4eb'
  ctx.fillRect(x, y, w, TEAMMATE_HEADER_H)
  ctx.restore()

  ctx.font = font(13, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText('首局队友', x + 14, y + 19)

  ctx.font = font(13)
  ctx.fillStyle = COLORS.muted
  ctx.textAlign = 'right'
  ctx.fillText(`#${firstMatch?.gameRank ?? 1} · ${firstMatch?.modeLabel ?? ''}`, x + w - 14, y + 19)
  ctx.textAlign = 'left'

  const scaledW = Math.round(w * TEAMMATE_SCALE)
  teammates.forEach((mate, index) => {
    const temp = createCanvas(w, TEAMMATE_ROW_H)
    const rowCtx = temp.getContext('2d')
    card(rowCtx, 0, 0, w, TEAMMATE_ROW_H, 12, '#ffffff')

    coverImage(rowCtx, skins.get(mate.skinId) ?? characters.get(mate.characterId), 14, 14, 72, 72, 10)
    rowCtx.font = font(12)
    rowCtx.fillStyle = COLORS.muted
    rowCtx.textAlign = 'center'
    rowCtx.fillText(fitText(rowCtx, mate.characterName, 88), 50, 100)
    rowCtx.textAlign = 'left'

    rowCtx.font = font(22, 'bold')
    rowCtx.fillStyle = COLORS.text
    rowCtx.fillText(fitText(rowCtx, mate.nickname, 140), 100, 34)

    rowCtx.font = font(20, 'semibold')
    rowCtx.fillStyle = COLORS.text
    rowCtx.fillText(`${mate.teamKill}/${mate.kills}/${mate.assists}`, 100, 70)
    rowCtx.font = font(13)
    rowCtx.fillStyle = COLORS.muted
    rowCtx.fillText('TK / K / A', 100, 90)

    if (mate.weaponId > 0) {
      rowCtx.fillStyle = '#1f1f1f'
      rounded(rowCtx, 182, 38, 23, 23, 5)
      rowCtx.fill()
      containedImage(rowCtx, weapons.get(mate.weaponId), 184, 40, 19, 19)
    }
    if (mate.tacticalSkillId > 0) {
      containedImage(rowCtx, tacticals.get(mate.tacticalSkillId), 208, 38, 23, 23)
    }
    if (mate.traitCoreId > 0) {
      containedImage(rowCtx, traits.get(mate.traitCoreId), 183, 63, 26, 26)
    }
    if (mate.traitSubId > 0) {
      containedImage(rowCtx, traits.get(mate.traitSubId), 211, 63, 26, 26)
    }

    drawDamageBar(rowCtx, 262, 46, mate.damage, 105, teamMaxDamage)

    rowCtx.font = font(22, 'bold')
    rowCtx.fillStyle = COLORS.text
    rowCtx.fillText(mate.kda.toFixed(2), 408, 52)
    rowCtx.font = font(13)
    rowCtx.fillStyle = COLORS.muted
    rowCtx.fillText('KDA', 408, 74)

    const cobaltMode = firstMatch?.modeLabel === '钴协议' || firstMatch?.modeLabel === '钴联盟'
    if (cobaltMode) {
      // Cobalt teammates also hide the path/RP column.
    } else if (mate.isRankMatch) {
      rowCtx.font = font(18, 'bold')
      rowCtx.fillStyle = COLORS.text
      const before = mate.mmrBefore.toLocaleString()
      rowCtx.fillText(before, 548, 52)
      const gain = mate.mmrGain
      rowCtx.fillStyle = gain >= 0 ? '#d94a63' : '#4a7bd9'
      rowCtx.fillText(`${gain >= 0 ? '+' : ''}${gain}`, 548 + rowCtx.measureText(before).width + 5, 52)
      rowCtx.font = font(13)
      rowCtx.fillStyle = COLORS.muted
      rowCtx.fillText('RP', 548, 74)
    } else if (mate.pathId > 0) {
      rowCtx.font = font(20, 'semibold')
      rowCtx.fillStyle = COLORS.text
      rowCtx.fillText(String(mate.pathId), 548, 52)
      rowCtx.font = font(13)
      rowCtx.fillStyle = COLORS.muted
      rowCtx.fillText('路径 ID', 548, 74)
    } else {
      rowCtx.font = font(18, 'semibold')
      rowCtx.fillStyle = COLORS.muted
      rowCtx.fillText('私人路径', 548, 52)
    }

    const totalItems = Math.min(mate.items.length, 6)
    mate.items.slice(0, 6).forEach((item, itemIndex) => {
      const col = itemIndex % 3
      const row = Math.floor(itemIndex / 3)
      const countInRow = row === 0 ? Math.min(totalItems, 3) : totalItems - 3
      const offset = ((3 - countInRow) * 72) / 2
      drawItem(rowCtx, items.get(item.id), item.grade, w - 248 + col * 72 + offset, 6 + row * 51, 63, 44)
    })

    const pasteX = x + (w - scaledW) / 2
    const pasteY = y + TEAMMATE_HEADER_H + 5 + index * (TEAMMATE_SCALED_H + TEAMMATE_GAP)
    ctx.drawImage(
      temp,
      0, 0, w, TEAMMATE_ROW_H,
      pasteX, pasteY, scaledW, TEAMMATE_SCALED_H,
    )
  })
}

/** Render one player card to PNG bytes. */
export async function renderPlayerCard(
  data: PlayerCardData,
  assets: {
    characterImage: (id: number) => Promise<Image | undefined>
    tierFullImage: (id: number) => Promise<Image | undefined>
    itemImage: (id: number) => Promise<Image | undefined>
    masteryImage: (id: number) => Promise<Image | undefined>
    tacticalImage: (id: number) => Promise<Image | undefined>
    traitImage: (id: number) => Promise<Image | undefined>
    skinImage: (id: number) => Promise<Image | undefined>
  },
  fontDir: string,
): Promise<{ png: Buffer; width: number; height: number }> {
  registerFonts(fontDir)

  const heroesBlock = data.heroes.length === 0 ? 90 : 42 + data.heroes.length * HERO_ROW_H + 12
  const teammateBlock = teammateBlockHeight(data.firstMatchTeammates.length)
  const height = PAD + HEADER_H + GAP + SUMMARY_H + GAP + heroesBlock + GAP
    + data.matches.length * MATCH_H + teammateBlock + FOOTER_H + PAD
  const canvas = createCanvas(WIDTH, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.page
  ctx.fillRect(0, 0, WIDTH, height)

  const characterIds = new Set<number>()
  for (const hero of data.heroes) characterIds.add(hero.characterId)
  for (const match of data.matches) characterIds.add(match.characterId)
  for (const mate of data.firstMatchTeammates) characterIds.add(mate.characterId)
  const skinIds = new Set<number>()
  for (const match of data.matches) if (match.skinId > 0) skinIds.add(match.skinId)
  for (const mate of data.firstMatchTeammates) if (mate.skinId > 0) skinIds.add(mate.skinId)
  const itemIds = new Set<number>()
  for (const match of data.matches) for (const item of match.items) itemIds.add(item.id)
  for (const mate of data.firstMatchTeammates) for (const item of mate.items) itemIds.add(item.id)
  const weaponIds = new Set<number>()
  const tacticalIds = new Set<number>()
  const traitIds = new Set<number>()
  for (const match of data.matches) {
    if (match.weaponId > 0) weaponIds.add(match.weaponId)
    if (match.tacticalSkillId > 0) tacticalIds.add(match.tacticalSkillId)
    if (match.traitCoreId > 0) traitIds.add(match.traitCoreId)
    if (match.traitSubId > 0) traitIds.add(match.traitSubId)
  }
  for (const mate of data.firstMatchTeammates) {
    if (mate.weaponId > 0) weaponIds.add(mate.weaponId)
    if (mate.tacticalSkillId > 0) tacticalIds.add(mate.tacticalSkillId)
    if (mate.traitCoreId > 0) traitIds.add(mate.traitCoreId)
    if (mate.traitSubId > 0) traitIds.add(mate.traitSubId)
  }

  const [tierImage, characterImages, itemImages, weaponImages, tacticalImages, traitImages, skinImages] = await Promise.all([
    assets.tierFullImage(data.tierId),
    Promise.all([...characterIds].map(async id => [id, await assets.characterImage(id)] as const)),
    Promise.all([...itemIds].map(async id => [id, await assets.itemImage(id)] as const)),
    Promise.all([...weaponIds].map(async id => [id, await assets.masteryImage(id)] as const)),
    Promise.all([...tacticalIds].map(async id => [id, await assets.tacticalImage(id)] as const)),
    Promise.all([...traitIds].map(async id => [id, await assets.traitImage(id)] as const)),
    Promise.all([...skinIds].map(async id => [id, await assets.skinImage(id)] as const)),
  ])
  const characters = new Map<number, Image | undefined>(characterImages)
  const skins = new Map<number, Image | undefined>(skinImages)
  const items = new Map<number, Image | undefined>(itemImages)
  const weapons = new Map<number, Image | undefined>(weaponImages)
  const tacticals = new Map<number, Image | undefined>(tacticalImages)
  const traits = new Map<number, Image | undefined>(traitImages)

  drawHeader(ctx, data, tierImage)
  drawSummary(ctx, data, PAD + HEADER_H + GAP)
  const heroesY = PAD + HEADER_H + GAP + SUMMARY_H + GAP
  drawHeroes(ctx, data, heroesY, characters)
  const matchesY = heroesY + heroesBlock + GAP
  drawMatches(ctx, data, matchesY, characters, items, weapons, tacticals, traits, skins)

  const footerY = height - PAD - FOOTER_H
  ctx.textAlign = 'center'
  ctx.font = font(26, 'semibold')
  ctx.fillStyle = COLORS.muted
  ctx.fillText('Powered by 椛椿&小休比', WIDTH / 2, footerY + FOOTER_H / 2 + 8)
  ctx.textAlign = 'left'

  return { png: canvas.toBuffer('image/png'), width: WIDTH, height }
}

/** Maps dak.gg profile JSON to the player-card render model. */

import type { AssetStore } from './assets.ts'
import { seasonIdForKey, seasonShortLabel } from '../api/client.ts'
import type {
  MatchData,
  MatchEntry,
  PlayerCardData,
  PlayerSeasonOverview,
  Profile,
  SummaryData,
  TeammateData,
} from '../types.ts'

const GRADE_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }
const GRADE_TIER_IDS = new Set([1, 2, 3, 4, 5, 6])
const METEORITE_TIER_ID = 63
const MODE_LABELS: Record<number, string> = {
  2: '匹配',
  3: '排位',
  6: '钴协议',
  8: '联盟',
  9: '孤狼',
  11: '钴联盟',
}

function overviewFor(
  profile: Profile,
  seasonId: number,
  matchingModeId: number,
  teamModeId: number,
): PlayerSeasonOverview | undefined {
  return profile.playerSeasonOverviews.find(overview =>
    overview.seasonId === seasonId
    && overview.matchingModeId === matchingModeId
    && overview.teamModeId === teamModeId)
}

function overviewForMode(
  profile: Profile,
  seasonId: number,
  matchingModeId: number,
): PlayerSeasonOverview | undefined {
  return overviewFor(profile, seasonId, matchingModeId, 3)
    ?? profile.playerSeasonOverviews.find(overview =>
      overview.seasonId === seasonId && overview.matchingModeId === matchingModeId)
}

function average(value: number, play: number): number {
  return play > 0 ? value / play : 0
}

function buildSummary(overview: PlayerSeasonOverview | undefined): SummaryData {
  if (overview === undefined) {
    return {
      play: 0,
      winRate: 0,
      top2Rate: 0,
      top3Rate: 0,
      avgRank: 0,
      avgKill: 0,
      avgAssist: 0,
      avgTk: 0,
      avgDamage: 0,
      avgMonsterKill: 0,
      avgVfCredit: 0,
      avgViewContribution: 0,
    }
  }
  const play = Math.max(overview.play, 1)
  return {
    play: overview.play,
    winRate: Math.round(average(overview.win, play) * 1000) / 10,
    top2Rate: Math.round(average(overview.top2, play) * 1000) / 10,
    top3Rate: Math.round(average(overview.top3, play) * 1000) / 10,
    avgRank: Math.round(average(overview.place, play) * 100) / 100,
    avgKill: Math.round(average(overview.playerKill, play) * 100) / 100,
    avgAssist: Math.round(average(overview.playerAssistant, play) * 100) / 100,
    avgTk: Math.round(average(overview.teamKill, play) * 100) / 100,
    avgDamage: Math.round(average(overview.damageToPlayer, play)),
    avgMonsterKill: Math.round(average(overview.monsterKill, play) * 10) / 10,
    avgVfCredit: Math.round(average(overview.totalGainVFCredit, play)),
    avgViewContribution: Math.round(average(overview.viewContribution, play) * 100) / 100,
  }
}

function formatStartTime(value: string): string {
  if (value === '') return ''
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  const pad = (number: number): string => String(number).padStart(2, '0')
  return `${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
}

function buildMatches(matches: readonly MatchEntry[], limit: number, assets: AssetStore): MatchData[] {
  return matches.slice(0, limit).map(match => {
    const deaths = match.playerDeaths
    return {
      gameId: match.gameId,
      characterId: match.characterNum,
      characterName: assets.characterName(match.characterNum),
      skinId: match.skinCode ?? 0,
      gameRank: match.gameRank,
      kills: match.playerKill,
      assists: match.playerAssistant,
      deaths,
      teamKill: match.teamKill,
      damage: match.damageToPlayer,
      kda: deaths === 0 ? match.playerKill + match.playerAssistant : (match.playerKill + match.playerAssistant) / deaths,
      mmrGain: match.mmrGain ?? 0,
      mmrBefore: match.mmrBefore ?? 0,
      isRankMatch: match.matchingMode === 3,
      weaponId: match.bestWeapon ?? 0,
      tacticalSkillId: match.tacticalSkillGroup ?? 0,
      tacticalSkillLevel: match.tacticalSkillLevel ?? 0,
      traitCoreId: match.traitFirstCore ?? 0,
      traitSubId: match.traitFirstSub?.[0] ?? 0,
      modeLabel: MODE_LABELS[match.matchingMode] ?? `模式 ${match.matchingMode}`,
      win: match.gameRank === 1,
      startTime: formatStartTime(match.startDtm ?? ''),
      serverName: match.serverName ?? '',
      pathId: match.routeIdOfStart ?? 0,
      items: (match.equipment ?? []).map((id, index) => ({
        id,
        name: assets.itemName(id),
        grade: match.equipmentGrade?.[index] ?? 0,
      })),
    }
  })
}

function buildTeammates(
  detail: readonly MatchEntry[] | undefined,
  playerName: string,
  assets: AssetStore,
): TeammateData[] {
  if (detail === undefined || detail.length === 0) return []
  const first = detail[0]
  if (first === undefined) return []
  if (first.matchingMode === 9 || first.matchingTeamMode === 1) return []
  const self = detail.find(entry => entry.nickname === playerName)
  if (self === undefined || self.teamNumber === undefined) return []
  return detail
    .filter(entry => entry.teamNumber === self.teamNumber && entry.nickname !== playerName)
    .sort((a, b) => a.gameRank - b.gameRank)
    .map(entry => ({
      nickname: entry.nickname,
      characterId: entry.characterNum,
      characterName: assets.characterName(entry.characterNum),
      skinId: entry.skinCode ?? 0,
      gameRank: entry.gameRank,
      kills: entry.playerKill,
      assists: entry.playerAssistant,
      deaths: entry.playerDeaths,
      teamKill: entry.teamKill,
      damage: entry.damageToPlayer,
      kda: entry.playerDeaths === 0
        ? entry.playerKill + entry.playerAssistant
        : (entry.playerKill + entry.playerAssistant) / entry.playerDeaths,
      mmrGain: entry.mmrGain ?? 0,
      mmrBefore: entry.mmrBefore ?? 0,
      isRankMatch: entry.matchingMode === 3,
      weaponId: entry.bestWeapon ?? 0,
      tacticalSkillId: entry.tacticalSkillGroup ?? 0,
      tacticalSkillLevel: entry.tacticalSkillLevel ?? 0,
      traitCoreId: entry.traitFirstCore ?? 0,
      traitSubId: entry.traitFirstSub?.[0] ?? 0,
      pathId: entry.routeIdOfStart ?? 0,
      items: (entry.equipment ?? []).map((id, index) => ({
        id,
        name: assets.itemName(id),
        grade: entry.equipmentGrade?.[index] ?? 0,
      })),
    }))
}

/** Build one player card. Throws when the requested season has no overview at all. */
export function buildPlayerCard(
  profile: Profile,
  matches: readonly MatchEntry[],
  seasonKey: string,
  matchCount: number,
  assets: AssetStore,
  cutoffs?: { immortal: number; titan: number },
  firstMatchDetail?: readonly MatchEntry[],
  modeId?: number,
  modeLabel?: string,
): PlayerCardData {
  const seasonId = seasonIdForKey(seasonKey)
  if (seasonId === undefined) throw new Error(`unknown season key: ${seasonKey}`)

  const rank = overviewForMode(profile, seasonId, 3)
  const casual = overviewForMode(profile, seasonId, 2)
  const requestedId = modeId ?? 3
  let effective: PlayerSeasonOverview | undefined
  let effectiveLabel = modeLabel ?? '所有模式'

  if (requestedId === 3 || requestedId === 0) {
    if ((rank?.play ?? 0) === 0) {
      effective = casual
      effectiveLabel = '匹配'
    } else {
      effective = rank
    }
  } else {
    effective = overviewForMode(profile, seasonId, requestedId)
  }

  const seasonSummary = profile.playerSeasons.find(season => season.seasonId === seasonId)
  if (seasonSummary === undefined) throw new Error(`no season data in ${seasonKey}`)
  const tierId = seasonSummary?.tierId ?? 0
  const tierGradeId = seasonSummary?.tierGradeId ?? 0
  const mmr = seasonSummary?.mmr ?? effective?.mmr ?? 0
  const seasonNumber = Number(/^SEASON_(\d+)$/u.exec(seasonKey)?.[1] ?? 0)
  const hasGrade = (GRADE_TIER_IDS.has(tierId) || (tierId === METEORITE_TIER_ID && seasonNumber >= 19))
    && GRADE_ROMAN[tierGradeId] !== undefined
  const tierName = hasGrade
    ? `${assets.tierName(tierId)} ${GRADE_ROMAN[tierGradeId]}`
    : assets.tierName(tierId)

  const chartSource = effective === rank ? rank : undefined
  const chart = (chartSource?.mmrStats ?? [])
    .filter(row => row.length >= 2)
    .slice(0, 6)
    .reverse()
    .map(row => {
      const date = String(row[0])
      return {
        label: date.length === 8 ? `${date.slice(4, 6)}/${date.slice(6, 8)}` : date,
        value: Number(row[1]),
      }
    })

  const rankForHeader = effective === rank ? rank : undefined
  const rankGlobal = rankForHeader?.rank?.global?.rank ?? 0
  const rankGlobalSize = rankForHeader?.rank?.global?.rankSize ?? 0
  const rankLocal = rankForHeader?.rank?.local?.rank ?? 0
  const rankLocalSize = rankForHeader?.rank?.local?.rankSize ?? 0

  const teammates = buildTeammates(firstMatchDetail, profile.player.name, assets)
  const teamMaxDamage = Math.max(
    matches[0]?.damageToPlayer ?? 0,
    ...teammates.map(mate => mate.damage),
    1,
  )

  return {
    seasonLabel: seasonShortLabel(seasonKey),
    modeLabel: effectiveLabel,
    name: profile.player.name,
    level: profile.player.accountLevel,
    mmr,
    hasRankedData: tierId > 0 || mmr > 0,
    tierId,
    tierName,
    tierGradeId,
    tierMmr: seasonSummary?.tierMmr ?? 0,
    rankGlobal,
    rankGlobalSize,
    rankGlobalPercent: rankGlobal > 0 && rankGlobalSize > 0 ? (rankGlobal / rankGlobalSize) * 100 : 0,
    rankLocal,
    rankLocalSize,
    rankLocalPercent: rankLocal > 0 && rankLocalSize > 0 ? (rankLocal / rankLocalSize) * 100 : 0,
    immortalMmr: cutoffs?.immortal ?? 0,
    titanMmr: cutoffs?.titan ?? 0,
    mmrChart: chart,
    summary: buildSummary(effective),
    heroes: (effective?.characterStats ?? [])
      .filter(stat => stat.play > 0)
      .sort((a, b) => b.play - a.play)
      .slice(0, 5)
      .map(stat => ({
        characterId: stat.key,
        characterName: assets.characterName(stat.key),
        play: stat.play,
        win: stat.win,
        winRate: Math.round((stat.win / stat.play) * 1000) / 10,
        avgRank: Math.round(average(stat.place, stat.play) * 100) / 100,
        avgKill: Math.round(average(stat.playerKill, stat.play) * 100) / 100,
        avgAssist: Math.round(average(stat.playerAssistant, stat.play) * 100) / 100,
        avgDamage: Math.round(average(stat.damageToPlayer, stat.play)),
        mmrGain: stat.mmrGain,
      })),
    matches: buildMatches(matches, matchCount, assets),
    firstMatchTeammates: teammates,
    teamMaxDamage,
    generatedAt: Date.now(),
  }
}

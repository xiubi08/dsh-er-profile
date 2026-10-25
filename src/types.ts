/** Eternal Return API and render DTOs. */

export interface SeasonEntry {
  id: number
  key: string
  name: string
  isCurrent?: boolean
}

export interface PlayerSeasonSummary {
  seasonId: number
  mmr: number
  tierId: number
  tierGradeId: number
  tierMmr: number
}

export interface CharacterStat {
  key: number
  play: number
  win: number
  top2: number
  top3: number
  place: number
  playerKill: number
  playerAssistant: number
  teamKill: number
  monsterKill: number
  damageToPlayer: number
  damageToMonster: number
  mmrGain: number
  playTime: number
  playerDeaths: number
  totalGainVFCredit: number
  viewContribution: number
}

export interface RecentMatch {
  gameId: number
  seasonId: number
  matchingMode: number
  teamMode: number
  characterNum: number
  skinCode: number
  gameRank: number
  playerKill: number
  playerAssistant: number
  monsterKill: number
  bestWeapon: number
  mmrGain: number
  mmrBefore?: number
  tacticalSkillGroup?: number
  tacticalSkillLevel?: number
  traitFirstCore?: number
  traitFirstSub?: number[]
  preMade: number
  damageToPlayer: number
  damageToMonster: number
  giveUp: number
  teamKill: number
  playerDeaths: number
  escapeState: number
  totalGainVFCredit: number
  viewContribution: number
}

/** One row of the `/players/:name/matches` response. */
export interface MatchEntry extends RecentMatch {
  nickname: string
  teamNumber: number
  matchingTeamMode: number
  equipment: number[]
  equipmentGrade: number[]
  routeIdOfStart: number
  startDtm: string
  serverName: string
  duration: number
}

export interface RankScope {
  rank?: number
  rankSize?: number
}

export interface PlayerSeasonOverview {
  seasonId: number
  matchingModeId: number
  teamModeId: number
  updatedAt: number
  mmr: number
  play: number
  win: number
  top2: number
  top3: number
  place: number
  playerKill: number
  playerAssistant: number
  teamKill: number
  monsterKill: number
  damageToPlayer: number
  damageToMonster: number
  mmrGain: number
  playTime: number
  playerDeaths: number
  totalGainVFCredit: number
  viewContribution: number
  characterStats: CharacterStat[]
  serverStats: { key: string; play: number }[]
  mmrStats: number[][]
  duoStats: unknown[]
  recentMatches: RecentMatch[]
  rank?: { global?: RankScope; local?: RankScope }
}

export interface Profile {
  player: {
    name: string
    syncedAt: number
    lastPlayedSeasonId: number
    accountLevel: number
  }
  playerSeasons: PlayerSeasonSummary[]
  playerSeasonOverviews: PlayerSeasonOverview[]
}

export interface CharacterSkin {
  id: number
  name: string
  imageUrl: string
}

export interface CharacterEntry {
  id: number
  key: string
  name: string
  imageUrl: string
  skins?: CharacterSkin[]
}

export interface ItemEntry {
  id: number
  name: string
  imageUrl: string
  grade?: string
}

export interface MasteryEntry {
  id: number
  key: string
  name: string
  iconUrl?: string
}

export interface SkillEntry {
  id: number
  name: string
  characterId: number
  slot: string
  imageUrl: string
}

export interface TacticalEntry {
  id: number
  name: string
  imageUrl: string
}

export interface TraitEntry {
  id: number
  name: string
  imageUrl: string
  type?: string
}

export interface RecommendationRaw {
  skillBuildStats?: {
    key: string
    count: number
    win: number
  }[]
  traitStats?: {
    key: [number, number[], number[]]
    count: number
    win: number
  }[]
  tacticalSkillStats?: {
    key: number
    count: number
    win: number
  }[]
  itemStats?: {
    key: number
    count: number
    stats: { key: number; count: number; win: number }[]
  }[]
  tier?: string
}

export interface SkillBuildData {
  slots: { slot: string; skillId: number }[]
  selectionRate: number
  winRate: number
}

export interface TacticalData {
  id: number
  selectionRate: number
  winRate: number
}

export interface TraitComboData {
  traitIds: number[]
  selectionRate: number
  winRate: number
}

export interface TraitGroupData {
  coreId: number
  selectionRate: number
  winRate: number
  combos: TraitComboData[]
}

export interface ItemStatData {
  id: number
  selectionRate: number
  winRate: number
  grade: string
}

export interface ItemSlotData {
  slotName: string
  items: ItemStatData[]
}

export interface CharacterRecommendations {
  skillBuilds: SkillBuildData[]
  tactical: TacticalData[]
  traitGroups: TraitGroupData[]
  itemSlots: ItemSlotData[]
}

export interface WeaponStat {
  key: number
  count: number
  win: number
  top3: number
  place: number
  playerKill: number
  playerAssistant: number
  damageToPlayer: number
  teamKill: number
  mmrGain: number
  tier: string
  tierScore: number
  rank?: {
    size: number
    count: number
    win: number
    top3: number
    place: number
    playerKill: number
    mmrGain: number
  }
}

export interface CharacterStatEntry {
  key: number
  count: number
  weaponStats: WeaponStat[]
}

export interface CharacterStatsSnapshot {
  dt: number
  patch: number
  matchingMode: number
  teamMode: number
  tier: string
  tierCount: number
  tierGameCount: number
  characterStats: CharacterStatEntry[]
}

export interface CharacterCardData {
  name: string
  weaponName: string
  weaponId: number
  tierLabel: string
  tierBadge: string
  pickCount: number
  totalSamples: number
  winRate: number
  winRank: number
  winRankSize: number
  top3Rate: number
  top3Rank: number
  top3RankSize: number
  avgRank: number
  avgRankRank: number
  avgRankRankSize: number
  avgKill: number
  avgKillRank: number
  avgKillRankSize: number
  rp: number
  rpRank: number
  rpRankSize: number
  pickRate: number
  pickRank: number
  pickRankSize: number
  avgDamage: number
  avgTk: number
  recommendations: CharacterRecommendations
  generatedAt: number
}

export interface TierEntry {
  id: number
  key: string
  name: string
  iconUrl: string
  imageUrl?: string
}

export interface SummaryData {
  play: number
  winRate: number
  top2Rate: number
  top3Rate: number
  avgRank: number
  avgKill: number
  avgAssist: number
  avgTk: number
  avgDamage: number
  avgMonsterKill: number
  avgVfCredit: number
  avgViewContribution: number
}

export interface HeroData {
  characterId: number
  characterName: string
  play: number
  win: number
  winRate: number
  avgRank: number
  avgKill: number
  avgAssist: number
  avgDamage: number
  mmrGain: number
}

export interface MatchItem {
  id: number
  name: string
  grade: number
}

export interface MatchData {
  gameId: number
  characterId: number
  characterName: string
  skinId: number
  gameRank: number
  kills: number
  assists: number
  deaths: number
  teamKill: number
  damage: number
  kda: number
  mmrGain: number
  mmrBefore: number
  isRankMatch: boolean
  weaponId: number
  tacticalSkillId: number
  tacticalSkillLevel: number
  traitCoreId: number
  traitSubId: number
  modeLabel: string
  win: boolean
  startTime: string
  serverName: string
  pathId: number
  items: MatchItem[]
}

export interface TeammateData {
  nickname: string
  characterId: number
  characterName: string
  skinId: number
  gameRank: number
  kills: number
  assists: number
  deaths: number
  teamKill: number
  damage: number
  kda: number
  mmrGain: number
  mmrBefore: number
  isRankMatch: boolean
  weaponId: number
  tacticalSkillId: number
  tacticalSkillLevel: number
  traitCoreId: number
  traitSubId: number
  pathId: number
  items: MatchItem[]
}

export interface PlayerCardData {
  seasonLabel: string
  modeLabel: string
  name: string
  level: number
  mmr: number
  hasRankedData: boolean
  tierId: number
  tierName: string
  tierGradeId: number
  tierMmr: number
  rankGlobal: number
  rankGlobalSize: number
  rankGlobalPercent: number
  rankLocal: number
  rankLocalSize: number
  rankLocalPercent: number
  immortalMmr: number
  titanMmr: number
  mmrChart: { label: string; value: number }[]
  summary: SummaryData
  heroes: HeroData[]
  matches: MatchData[]
  firstMatchTeammates: TeammateData[]
  teamMaxDamage: number
  generatedAt: number
}

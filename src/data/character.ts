/** Maps `/character-stats` into the character card model. */

import type {
  CharacterCardData,
  CharacterEntry,
  CharacterRecommendations,
  CharacterStatsSnapshot,
  ItemSlotData,
  MasteryEntry,
  RecommendationRaw,
  SkillBuildData,
  TacticalData,
  TraitGroupData,
} from '../types.ts'
import type { AssetStore } from './assets.ts'

export const TIER_ALIASES: Record<string, string> = {
  in1000: 'in1000',
  in100: 'in1000',
  星陨: 'meteorite_plus',
  灭钻: 'diamond_plus',
  无瑕: 'mithril_plus',
  修罗: 'asura_plus',
}

export const TIER_LABELS: Record<string, string> = {
  in1000: '前 1000',
  meteorite_plus: '星陨+',
  diamond_plus: '灭钻+',
  mithril_plus: '无瑕+',
  asura_plus: '修罗+',
}

function rate(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

function emptyRecommendations(): CharacterRecommendations {
  return { skillBuilds: [], tactical: [], traitGroups: [], itemSlots: [] }
}

function buildRecommendations(
  raw: RecommendationRaw | undefined,
  characterId: number,
  assets: AssetStore,
): CharacterRecommendations {
  if (raw === undefined) return emptyRecommendations()

  const skills = assets.skillsFor(characterId)
  const skillBySlot = new Map(skills.map(skill => [skill.slot.toLowerCase(), skill]))
  const skillTotal = (raw.skillBuildStats ?? []).reduce((sum, row) => sum + row.count, 0) || 1
  const skillBuilds: SkillBuildData[] = (raw.skillBuildStats ?? []).slice(0, 5).map(row => ({
    slots: [...row.key.toUpperCase()].map(slot => ({
      slot,
      skillId: skillBySlot.get(slot.toLowerCase())?.id ?? 0,
    })),
    selectionRate: rate(row.count, skillTotal),
    winRate: rate(row.win, row.count),
  }))

  const tacticalTotal = (raw.tacticalSkillStats ?? []).reduce((sum, row) => sum + row.count, 0) || 1
  const tactical: TacticalData[] = (raw.tacticalSkillStats ?? []).slice(0, 6).map(row => ({
    id: row.key,
    selectionRate: rate(row.count, tacticalTotal),
    winRate: rate(row.win, row.count),
  }))

  const coreGroups = new Map<number, {
    total: number
    win: number
    combos: { traitIds: number[]; count: number; win: number }[]
  }>()
  for (const row of raw.traitStats ?? []) {
    const core = row.key[0]
    const group = coreGroups.get(core) ?? { total: 0, win: 0, combos: [] }
    group.total += row.count
    group.win += row.win
    group.combos.push({
      traitIds: [row.key[1][0] ?? 0, row.key[1][1] ?? 0, row.key[2][0] ?? 0, row.key[2][1] ?? 0].filter(Boolean),
      count: row.count,
      win: row.win,
    })
    coreGroups.set(core, group)
  }
  const traitTotal = [...coreGroups.values()].reduce((sum, group) => sum + group.total, 0) || 1
  const traitGroups: TraitGroupData[] = [...coreGroups.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 3)
    .map(([coreId, group]) => ({
      coreId,
      selectionRate: rate(group.total, traitTotal),
      winRate: rate(group.win, group.total),
      combos: group.combos
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)
        .map(combo => ({
          traitIds: combo.traitIds,
          selectionRate: rate(combo.count, group.total),
          winRate: rate(combo.win, combo.count),
        })),
    }))

  const slotNames: Record<number, string> = { 0: '武器', 1: '胸部', 2: '头部', 3: '手臂', 4: '腿部' }
  const order = [0, 3, 1, 4, 2]
  const itemSlots: ItemSlotData[] = order.flatMap(slotKey => {
    const slot = (raw.itemStats ?? []).find(entry => entry.key === slotKey)
    if (slot === undefined) return []
    const total = slot.stats.reduce((sum, item) => sum + item.count, 0) || 1
    return [{
      slotName: slotNames[slotKey] ?? `部位${slotKey}`,
      items: slot.stats.slice(0, 3).map(item => ({
        id: item.key,
        selectionRate: rate(item.count, total),
        winRate: rate(item.win, item.count),
        grade: assets.itemGrade(item.key),
      })),
    }]
  })

  return { skillBuilds, tactical, traitGroups, itemSlots }
}

/** Build one character card. Throws when the character has no sample in this tier. */
export function buildCharacterCard(
  character: CharacterEntry,
  snapshot: CharacterStatsSnapshot,
  masteries: readonly MasteryEntry[],
  tier: string,
  weaponQuery?: string,
  recommendations?: RecommendationRaw,
  assets?: AssetStore,
): CharacterCardData {
  const entry = snapshot.characterStats.find(stat => stat.key === character.id)
  if (entry === undefined || entry.weaponStats.length === 0) {
    throw new Error(`${character.name} 在该段位没有样本数据`)
  }

  const masteryByName = masteries.find(mastery =>
    mastery.name === weaponQuery || mastery.key === weaponQuery || String(mastery.id) === weaponQuery)
  const selected = masteryByName === undefined
    ? [...entry.weaponStats].sort((a, b) => b.count - a.count)[0]
    : entry.weaponStats.find(stat => stat.key === masteryByName.id) ?? entry.weaponStats[0]
  if (selected === undefined) throw new Error(`${character.name} 没有可用的武器样本`)

  const mastery = masteries.find(item => item.id === selected.key)
  const count = Math.max(selected.count, 1)
  const rank = selected.rank
  return {
    name: character.name,
    weaponName: mastery?.name ?? `武器 ${selected.key}`,
    weaponId: selected.key,
    tierLabel: TIER_LABELS[tier] ?? tier,
    tierBadge: selected.tier,
    pickCount: selected.count,
    totalSamples: snapshot.tierCount,
    winRate: rate(selected.win, count),
    winRank: rank?.win ?? 0,
    winRankSize: rank?.size ?? 0,
    top3Rate: rate(selected.top3, count),
    top3Rank: rank?.top3 ?? 0,
    top3RankSize: rank?.size ?? 0,
    avgRank: selected.place / count,
    avgRankRank: rank?.place ?? 0,
    avgRankRankSize: rank?.size ?? 0,
    avgKill: selected.playerKill / count,
    avgKillRank: rank?.playerKill ?? 0,
    avgKillRankSize: rank?.size ?? 0,
    rp: selected.mmrGain / count,
    rpRank: rank?.mmrGain ?? 0,
    rpRankSize: rank?.size ?? 0,
    pickRate: rate(selected.count, snapshot.tierCount),
    pickRank: rank?.count ?? 0,
    pickRankSize: rank?.size ?? 0,
    avgDamage: selected.damageToPlayer / count,
    avgTk: selected.teamKill / count,
    recommendations: assets === undefined
      ? emptyRecommendations()
      : buildRecommendations(recommendations, character.id, assets),
    generatedAt: Date.now(),
  }
}

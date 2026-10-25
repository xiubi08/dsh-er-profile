import { TIER_LABELS } from './character.ts'
import type { CharacterEntry, CharacterStatsSnapshot } from '../types.ts'

export interface CharacterRatingEntry {
  characterId: number
  name: string
  grade: string
  damage: number
  rpGain: number
  weaponId: number
  tierScore: number
}

export interface CharacterRatingData {
  tierLabel: string
  totalSamples: number
  entries: CharacterRatingEntry[]
}

const GRADE_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 }

/** Build one card per character + weapon pair, matching the original ranking. */
export function buildCharacterRating(
  snapshot: CharacterStatsSnapshot,
  characters: readonly CharacterEntry[],
  tier: string,
): CharacterRatingData {
  const byId = new Map(characters.map(character => [character.id, character]))
  const entries: CharacterRatingEntry[] = []
  for (const stat of snapshot.characterStats) {
    const character = byId.get(stat.key)
    if (character === undefined) continue
    for (const weapon of stat.weaponStats) {
      if (weapon.count <= 0) continue
      entries.push({
        characterId: character.id,
        name: character.name,
        grade: weapon.tier || 'D',
        damage: weapon.damageToPlayer / weapon.count,
        rpGain: weapon.mmrGain / weapon.count,
        weaponId: weapon.key,
        tierScore: weapon.tierScore,
      })
    }
  }
  entries.sort((a, b) => b.tierScore - a.tierScore || (GRADE_ORDER[a.grade] ?? 5) - (GRADE_ORDER[b.grade] ?? 5))
  return {
    tierLabel: TIER_LABELS[tier] ?? tier,
    totalSamples: snapshot.tierCount,
    entries,
  }
}

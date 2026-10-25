import { parentPort } from 'node:worker_threads'
import { AssetStore } from '../data/assets.ts'
import type { CharacterCardData, CharacterEntry, ItemEntry, MasteryEntry, PlayerCardData, SkillEntry, TacticalEntry, TierEntry, TraitEntry } from '../types.ts'
import type { CharacterRatingData } from '../data/rating.ts'
import { renderPlayerCard } from './profile.ts'
import { renderCharacterCard } from './character.ts'
import { renderCharacterRating } from './character-rank.ts'

interface WorkerDictionaries {
  characters: CharacterEntry[]
  tiers: TierEntry[]
  items: ItemEntry[]
  masteries: MasteryEntry[]
  skills: SkillEntry[]
  tactical: TacticalEntry[]
  traits: TraitEntry[]
}

interface RenderJob {
  id: number
  kind: 'player' | 'character' | 'rank'
  data: PlayerCardData | CharacterCardData | CharacterRatingData
  dictionaries: WorkerDictionaries
  dataDir: string
  fontDir: string
  characterId?: number
}

parentPort?.on('message', async (job: RenderJob) => {
  try {
    const assets = new AssetStore(
      job.dataDir,
      job.dictionaries.characters,
      job.dictionaries.tiers,
      job.dictionaries.items,
      job.dictionaries.skills,
      job.dictionaries.tactical,
      job.dictionaries.traits,
      job.dictionaries.masteries,
    )
    let rendered: { png: Buffer; width: number; height: number }
    if (job.kind === 'player') {
      rendered = await renderPlayerCard(job.data as PlayerCardData, assets, job.fontDir)
    } else if (job.kind === 'character') {
      rendered = await renderCharacterCard(job.data as CharacterCardData, assets, job.characterId ?? 0, job.fontDir)
    } else {
      rendered = await renderCharacterRating(job.data as CharacterRatingData, assets, job.fontDir)
    }
    const bytes = new Uint8Array(rendered.png)
    parentPort?.postMessage({
      id: job.id,
      png: bytes,
      width: rendered.width,
      height: rendered.height,
    }, [bytes.buffer])
  } catch (error) {
    parentPort?.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) })
  }
})

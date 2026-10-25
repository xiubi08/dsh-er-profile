/**
 * Persistent game-resource library. Downloaded files live under `dataDir/assets`
 * and grow across runs; they are data, not a cache and are never TTL-evicted.
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadImage, type Image } from '@napi-rs/canvas'
import type { CharacterEntry, ItemEntry, MasteryEntry, SkillEntry, TacticalEntry, TierEntry, TraitEntry } from '../types.ts'

function absoluteCdnUrl(value: string): string {
  return value.startsWith('//') ? `https:${value}` : value
}

async function ensureFile(url: string, path: string): Promise<boolean> {
  if (existsSync(path)) return true
  const response = await fetch(absoluteCdnUrl(url), {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) return false
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0) return false
  await writeFile(path, bytes)
  return true
}

/** Loads portraits and tier icons into a persistent on-disk resource library. */
export class AssetStore {
  private readonly characters = new Map<number, CharacterEntry>()
  private readonly skins = new Map<number, { id: number; imageUrl: string }>()
  private readonly tiers = new Map<number, TierEntry>()
  private readonly items = new Map<number, ItemEntry>()
  private readonly masteries = new Map<number, MasteryEntry>()
  private readonly skills = new Map<number, SkillEntry>()
  private readonly tactical = new Map<number, TacticalEntry>()
  private readonly traits = new Map<number, TraitEntry>()
  private readonly images = new Map<string, Promise<Image | undefined>>()

  constructor(
    private readonly dataDir: string,
    characters: readonly CharacterEntry[],
    tiers: readonly TierEntry[],
    items: readonly ItemEntry[] = [],
    skills: readonly SkillEntry[] = [],
    tactical: readonly TacticalEntry[] = [],
    traits: readonly TraitEntry[] = [],
    masteries: readonly MasteryEntry[] = [],
  ) {
    for (const character of characters) {
      this.characters.set(character.id, character)
      for (const skin of character.skins ?? []) this.skins.set(skin.id, { id: skin.id, imageUrl: skin.imageUrl })
    }
    for (const tier of tiers) this.tiers.set(tier.id, tier)
    for (const item of items) this.items.set(item.id, item)
    for (const mastery of masteries) this.masteries.set(mastery.id, mastery)
    for (const skill of skills) this.skills.set(skill.id, skill)
    for (const skill of tactical) this.tactical.set(skill.id, skill)
    for (const trait of traits) this.traits.set(trait.id, trait)
  }

  characterName(id: number): string {
    return this.characters.get(id)?.name ?? `#${id}`
  }

  tierName(id: number): string {
    return this.tiers.get(id)?.name ?? '段位未鉴定'
  }

  characterImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`character:${id}`, async () => {
      const entry = this.characters.get(id)
      if (entry === undefined || entry.imageUrl === '') return undefined
      return this.loadPng(entry.imageUrl, join(this.dataDir, 'assets', 'characters', `${id}.png`))
    })
  }

  tierImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`tier:${id}`, async () => {
      const entry = this.tiers.get(id)
      if (entry === undefined || entry.iconUrl === '') return undefined
      return this.loadPng(entry.iconUrl, join(this.dataDir, 'assets', 'tiers', `${id}.png`))
    })
  }

  tierFullImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`tier-full:${id}`, async () => {
      const entry = this.tiers.get(id)
      if (entry === undefined || entry.imageUrl === undefined || entry.imageUrl === '') return undefined
      return this.loadPng(entry.imageUrl, join(this.dataDir, 'assets', 'tiers_full', `${id}.png`))
    })
  }

  itemName(id: number): string {
    return this.items.get(id)?.name ?? `#${id}`
  }

  itemGrade(id: number): string {
    return this.items.get(id)?.grade ?? 'Common'
  }

  masteryName(id: number): string {
    return this.masteries.get(id)?.name ?? `武器 ${id}`
  }

  masteryImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`mastery:${id}`, async () => {
      const entry = this.masteries.get(id)
      if (entry === undefined || entry.iconUrl === undefined || entry.iconUrl === '') return undefined
      return this.loadPng(entry.iconUrl, join(this.dataDir, 'assets', 'masteries', `${id}.png`))
    })
  }

  skinImage(id: number): Promise<Image | undefined> {
    if (id <= 0) return Promise.resolve(undefined)
    return this.loadOnce(`skin:${id}`, async () => {
      const entry = this.skins.get(id)
      if (entry === undefined || entry.imageUrl === '') return undefined
      return this.loadPng(entry.imageUrl, join(this.dataDir, 'assets', 'character_skins', `${id}.png`))
    })
  }

  itemImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`item:${id}`, async () => {
      const entry = this.items.get(id)
      if (entry === undefined || entry.imageUrl === '') return undefined
      return this.loadPng(entry.imageUrl, join(this.dataDir, 'assets', 'items', `${id}.png`))
    })
  }

  skillsFor(characterId: number): SkillEntry[] {
    return [...this.skills.values()].filter(skill => skill.characterId === characterId)
  }

  skillImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`skill:${id}`, async () => {
      const entry = this.skills.get(id)
      if (entry === undefined || entry.imageUrl === '') return undefined
      return this.loadPng(entry.imageUrl, join(this.dataDir, 'assets', 'skills', `${id}.png`))
    })
  }

  tacticalName(id: number): string {
    return this.tactical.get(id)?.name ?? `战术 ${id}`
  }

  tacticalImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`tactical:${id}`, async () => {
      const entry = this.tactical.get(id)
      if (entry === undefined || entry.imageUrl === '') return undefined
      return this.loadPng(entry.imageUrl, join(this.dataDir, 'assets', 'tactical_skills', `${id}.png`))
    })
  }

  traitName(id: number): string {
    return this.traits.get(id)?.name ?? `潜能 ${id}`
  }

  traitImage(id: number): Promise<Image | undefined> {
    return this.loadOnce(`trait:${id}`, async () => {
      const entry = this.traits.get(id)
      if (entry === undefined || entry.imageUrl === '') return undefined
      return this.loadPng(entry.imageUrl, join(this.dataDir, 'assets', 'trait_skills', `${id}.png`))
    })
  }

  private loadOnce(key: string, load: () => Promise<Image | undefined>): Promise<Image | undefined> {
    const existing = this.images.get(key)
    if (existing !== undefined) return existing
    const pending = load().catch(() => undefined)
    this.images.set(key, pending)
    return pending
  }

  private async loadPng(url: string, path: string): Promise<Image | undefined> {
    await mkdir(dirname(path), { recursive: true })
    if (!(await ensureFile(url, path))) return undefined
    try {
      return await loadImage(path)
    } catch {
      return undefined
    }
  }

  /** Download every known asset; existing files are reused. */
  async prefetchAll(concurrency = 10): Promise<{ total: number; failed: number }> {
    const tasks: (() => Promise<Image | undefined>)[] = []
    for (const id of this.characters.keys()) tasks.push(() => this.characterImage(id))
    for (const id of this.skins.keys()) tasks.push(() => this.skinImage(id))
    for (const id of this.tiers.keys()) tasks.push(() => this.tierFullImage(id))
    for (const id of this.items.keys()) tasks.push(() => this.itemImage(id))
    for (const id of this.masteries.keys()) tasks.push(() => this.masteryImage(id))
    for (const id of this.skills.keys()) tasks.push(() => this.skillImage(id))
    for (const id of this.tactical.keys()) tasks.push(() => this.tacticalImage(id))
    for (const id of this.traits.keys()) tasks.push(() => this.traitImage(id))

    let cursor = 0
    let failed = 0
    const worker = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const index = cursor
        cursor += 1
        const task = tasks[index]
        if (task === undefined) continue
        const result = await task()
        if (result === undefined) failed += 1
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
    return { total: tasks.length, failed }
  }
}

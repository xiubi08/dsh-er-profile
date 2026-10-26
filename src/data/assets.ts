/**
 * Persistent game-resource library. Downloaded files live under `dataDir/assets`
 * and grow across runs; they are data, not a cache and are never TTL-evicted.
 *
 * An update follows the original plugin's resource check: every known asset is
 * classified as ok, changed, or missing from the URL index, and only changed
 * bytes are re-downloaded. HTTP validators distinguish a CDN version bump from
 * a real image change.
 */

import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadImage, type Image } from '@napi-rs/canvas'
import {
  loadAssetIndex, saveAssetIndex, type AssetIndexData, type AssetIndexEntry,
} from './asset-index.ts'
import type { CharacterEntry, ItemEntry, MasteryEntry, SkillEntry, TacticalEntry, TierEntry, TraitEntry } from '../types.ts'

const DOWNLOAD_TIMEOUT_MS = 20_000

interface DownloadMeta {
  etag?: string
  lastModified?: string
  size?: number
}

interface AssetTarget {
  category: string
  key: string
  url: string
  path: string
}

/** Per-category counts for one update. */
export interface AssetCategoryReport {
  key: string
  total: number
  ok: number
  changed: number
  missing: number
}

/** One asset that could not be downloaded during an update. */
export interface AssetFailure {
  category: string
  key: string
  url: string
}

/** One complete resource check/update result. */
export interface AssetUpdateReport {
  total: number
  ok: number
  changed: number
  missing: number
  downloaded: number
  adopted: number
  failed: number
  categories: AssetCategoryReport[]
  failures: AssetFailure[]
}

/** Caller controls for one update. */
export interface AssetUpdateOptions {
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

interface UpdateCounts {
  ok: number
  changed: number
  missing: number
  downloaded: number
  adopted: number
  failed: number
  categories: Map<string, AssetCategoryReport>
  failures: AssetFailure[]
}

function absoluteCdnUrl(value: string): string {
  return value.startsWith('//') ? `https:${value}` : value
}

function normalizedUrl(value: string): string {
  return absoluteCdnUrl(value.trim())
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

function metaFromHeaders(headers: Headers, fallbackSize?: number): DownloadMeta {
  const meta: DownloadMeta = {}
  const etag = headers.get('etag')
  if (etag !== null && etag !== '') meta.etag = etag
  const lastModified = headers.get('last-modified')
  if (lastModified !== null && lastModified !== '') meta.lastModified = lastModified
  const lengthHeader = headers.get('content-length')
  const length = lengthHeader === null ? Number.NaN : Number(lengthHeader)
  if (Number.isFinite(length) && length > 0) meta.size = length
  else if (fallbackSize !== undefined) meta.size = fallbackSize
  return meta
}

/**
 * Whether a changed URL still serves the bytes already on disk.
 * ETag wins; a missing validator falls back to the content length, matching
 * the original plugin's behavior.
 */
function sameContent(entry: AssetIndexEntry, meta: DownloadMeta | undefined, localSize: number): boolean {
  if (meta === undefined) return false
  if (entry.etag !== undefined && meta.etag !== undefined) return entry.etag === meta.etag
  return meta.size !== undefined && meta.size > 0 && localSize > 0 && meta.size === localSize
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path)
    return info.isFile() && info.size > 0 ? info.size : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** HEAD one remote asset; failure means "cannot prove it is unchanged". */
async function headMeta(url: string, signal: AbortSignal | undefined): Promise<DownloadMeta | undefined> {
  try {
    const response = await fetch(normalizedUrl(url), {
      method: 'HEAD',
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: requestSignal(signal),
    })
    if (!response.ok) return undefined
    return metaFromHeaders(response.headers)
  } catch {
    return undefined
  }
}

/** Download one file unless it already exists (or `force` is set). */
async function downloadFile(
  url: string,
  path: string,
  force: boolean,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; meta?: DownloadMeta }> {
  if (!force && await fileSize(path) !== undefined) return { ok: true }
  try {
    const response = await fetch(normalizedUrl(url), {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: requestSignal(signal),
    })
    if (!response.ok) return { ok: false }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0) return { ok: false }
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, bytes)
    try {
      await rename(temporary, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') {
        await rm(temporary, { force: true })
        throw error
      }
      await rm(path, { force: true })
      await rename(temporary, path)
    }
    return { ok: true, meta: metaFromHeaders(response.headers, bytes.byteLength) }
  } catch {
    return { ok: false }
  }
}

function entryFor(target: AssetTarget, meta: DownloadMeta | undefined): AssetIndexEntry {
  const entry: AssetIndexEntry = { url: normalizedUrl(target.url), file: target.path }
  if (meta?.etag !== undefined) entry.etag = meta.etag
  if (meta?.lastModified !== undefined) entry.lastModified = meta.lastModified
  if (meta?.size !== undefined) entry.size = meta.size
  return entry
}

function adoptEntry(previous: AssetIndexEntry, target: AssetTarget, meta: DownloadMeta | undefined): AssetIndexEntry {
  const entry: AssetIndexEntry = { ...previous, url: normalizedUrl(target.url), file: target.path }
  if (meta?.etag !== undefined) entry.etag = meta.etag
  if (meta?.lastModified !== undefined) entry.lastModified = meta.lastModified
  if (meta?.size !== undefined) entry.size = meta.size
  return entry
}

function categoryReport(counts: UpdateCounts, key: string): AssetCategoryReport {
  const existing = counts.categories.get(key)
  if (existing !== undefined) return existing
  const created: AssetCategoryReport = { key, total: 0, ok: 0, changed: 0, missing: 0 }
  counts.categories.set(key, created)
  return created
}

function recordFailure(counts: UpdateCounts, target: AssetTarget): void {
  counts.failed += 1
  counts.failures.push({ category: target.category, key: target.key, url: normalizedUrl(target.url) })
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
    const downloaded = await downloadFile(url, path, false, undefined)
    if (!downloaded.ok) return undefined
    try {
      return await loadImage(path)
    } catch {
      return undefined
    }
  }

  /** Every downloadable asset target in the order the update reports it. */
  private targets(): AssetTarget[] {
    const targets: AssetTarget[] = []
    const push = (category: string, key: number | string, url: string | undefined, folder: string): void => {
      if (url === undefined || url.trim() === '') return
      targets.push({
        category,
        key: String(key),
        url,
        path: join(this.dataDir, 'assets', folder, `${String(key)}.png`),
      })
    }
    for (const character of this.characters.values()) push('characters', character.id, character.imageUrl, 'characters')
    for (const skin of this.skins.values()) push('character_skins', skin.id, skin.imageUrl, 'character_skins')
    for (const item of this.items.values()) push('items', item.id, item.imageUrl, 'items')
    for (const tier of this.tiers.values()) {
      push('tiers', tier.id, tier.iconUrl, 'tiers')
      push('tiers_full', tier.id, tier.imageUrl, 'tiers_full')
    }
    for (const skill of this.tactical.values()) push('tactical_skills', skill.id, skill.imageUrl, 'tactical_skills')
    for (const trait of this.traits.values()) push('trait_skills', trait.id, trait.imageUrl, 'trait_skills')
    for (const mastery of this.masteries.values()) push('masteries', mastery.id, mastery.iconUrl, 'masteries')
    for (const skill of this.skills.values()) push('skills', skill.id, skill.imageUrl, 'skills')
    return targets
  }

  /**
   * Check every known asset against the persisted URL index and download only
   * missing or genuinely changed bytes.
   * @param options - concurrency, cancellation, and progress callback.
   * @returns per-category and aggregate counts.
   */
  async updateAll(options: AssetUpdateOptions = {}): Promise<AssetUpdateReport> {
    const targets = this.targets()
    const indexPath = join(this.dataDir, 'assets', 'index.json')
    const index: AssetIndexData = await loadAssetIndex(indexPath)
    const counts: UpdateCounts = {
      ok: 0, changed: 0, missing: 0, downloaded: 0, adopted: 0, failed: 0, categories: new Map(), failures: [],
    }
    const concurrency = Math.max(1, Math.min(32, Math.trunc(options.concurrency ?? 6)))
    let cursor = 0
    let done = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const position = cursor
        cursor += 1
        if (position >= targets.length || options.signal?.aborted === true) return
        const target = targets[position]
        if (target === undefined) continue
        await this.updateOne(target, index, counts, options.signal)
        done += 1
        options.onProgress?.(done, targets.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker))
    await saveAssetIndex(indexPath, index)
    return {
      total: targets.length,
      ok: counts.ok,
      changed: counts.changed,
      missing: counts.missing,
      downloaded: counts.downloaded,
      adopted: counts.adopted,
      failed: counts.failed,
      categories: [...counts.categories.values()],
      failures: counts.failures,
    }
  }

  private async updateOne(
    target: AssetTarget,
    index: AssetIndexData,
    counts: UpdateCounts,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (signal?.aborted === true) return
    const category = categoryReport(counts, target.category)
    category.total += 1
    const records = index.categories[target.category] ?? (index.categories[target.category] = {})
    const previous = records[target.key]
    const size = await fileSize(target.path)
    if (size === undefined) {
      category.missing += 1
      counts.missing += 1
      const downloaded = await downloadFile(target.url, target.path, true, signal)
      if (downloaded.ok) {
        counts.downloaded += 1
        records[target.key] = entryFor(target, downloaded.meta)
      } else {
        recordFailure(counts, target)
      }
      return
    }
    if (previous === undefined || normalizedUrl(previous.url) === normalizedUrl(target.url)) {
      category.ok += 1
      counts.ok += 1
      if (previous === undefined) records[target.key] = { url: normalizedUrl(target.url), file: target.path, size }
      else if (previous.file === undefined) previous.file = target.path
      return
    }
    category.changed += 1
    counts.changed += 1
    const remote = await headMeta(target.url, signal)
    if (sameContent(previous, remote, size)) {
      counts.adopted += 1
      records[target.key] = adoptEntry(previous, target, remote)
      return
    }
    const downloaded = await downloadFile(target.url, target.path, true, signal)
    if (downloaded.ok) {
      counts.downloaded += 1
      records[target.key] = entryFor(target, downloaded.meta)
    } else {
      recordFailure(counts, target)
    }
  }
}

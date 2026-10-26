/**
 * Persistent URL/metadata index for the downloadable asset library.
 *
 * The index records which remote URL produced each local file, plus the HTTP
 * validators that let an update distinguish "same bytes, new URL" from a real
 * content change. It is data, not a cache: losing it only means one update
 * rebuilds the baseline from the files already on disk.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** One downloaded file's source URL and HTTP validators. */
export interface AssetIndexEntry {
  url: string
  file?: string
  etag?: string
  lastModified?: string
  size?: number
}

/** The complete index, grouped by asset category then asset id/key. */
export interface AssetIndexData {
  version: 1
  categories: Record<string, Record<string, AssetIndexEntry>>
}

/** An empty index for a first run or a damaged index file. */
export function emptyAssetIndex(): AssetIndexData {
  return { version: 1, categories: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeEntry(value: unknown): AssetIndexEntry | undefined {
  if (!isRecord(value) || typeof value.url !== 'string' || value.url === '') return undefined
  const entry: AssetIndexEntry = { url: value.url }
  if (typeof value.file === 'string') entry.file = value.file
  if (typeof value.etag === 'string') entry.etag = value.etag
  if (typeof value.lastModified === 'string') entry.lastModified = value.lastModified
  if (typeof value.size === 'number' && Number.isFinite(value.size)) entry.size = value.size
  return entry
}

/**
 * Read one index file. A missing or damaged file yields an empty index so the
 * next update can rebuild it from the files on disk.
 * @param path - absolute index file path.
 * @returns the parsed index.
 */
export async function loadAssetIndex(path: string): Promise<AssetIndexData> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // A damaged index is discarded and rebuilt from the files on disk.
    }
    return emptyAssetIndex()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyAssetIndex()
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.categories)) return emptyAssetIndex()
  const categories: Record<string, Record<string, AssetIndexEntry>> = {}
  for (const [category, records] of Object.entries(parsed.categories)) {
    if (!isRecord(records)) continue
    const normalized: Record<string, AssetIndexEntry> = {}
    for (const [key, value] of Object.entries(records)) {
      const entry = normalizeEntry(value)
      if (entry !== undefined) normalized[key] = entry
    }
    categories[category] = normalized
  }
  return { version: 1, categories }
}

/**
 * Write the index atomically: a partial write never replaces a usable index.
 * @param path - absolute index file path.
 * @param index - complete index snapshot.
 */
export async function saveAssetIndex(path: string, index: AssetIndexData): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
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
}

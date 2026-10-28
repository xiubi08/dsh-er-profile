/** Short-lived PNG reuse for identical card inputs (avoids re-rendering a repeated query). */

import { createHash } from 'node:crypto'

interface CachedRender {
  png: Buffer
  width: number
  height: number
  expiresAt: number
}

/** In-memory LRU-ish cache keyed by a hash of the render inputs. */
export class RenderCache {
  private readonly entries = new Map<string, CachedRender>()

  constructor(private readonly maxEntries = 16) {}

  /** Hash a set of render inputs into a stable cache key. */
  static key(parts: readonly unknown[]): string {
    return createHash('sha1').update(JSON.stringify(parts)).digest('hex')
  }

  get(key: string): { png: Buffer; width: number; height: number } | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Refresh recency so the LRU order tracks actual use.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return { png: entry.png, width: entry.width, height: entry.height }
  }

  set(key: string, value: { png: Buffer; width: number; height: number }, ttlMs: number): void {
    if (ttlMs <= 0) return
    this.entries.delete(key)
    this.entries.set(key, { ...value, expiresAt: Date.now() + ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const renderCache = new RenderCache(16)

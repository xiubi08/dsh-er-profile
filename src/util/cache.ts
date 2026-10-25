interface CacheEntry<T> {
  value?: T
  expiresAt: number
  pending?: Promise<T>
}

/** Small in-memory TTL cache with in-flight request deduplication. */
export class TtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>()
  private readonly maxEntries: number

  constructor(maxEntries = 256) {
    this.maxEntries = maxEntries
  }

  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const entry = this.entries.get(key) as CacheEntry<T> | undefined
    if (entry !== undefined) {
      if (entry.value !== undefined && entry.expiresAt > now) return entry.value
      if (entry.pending !== undefined) return entry.pending
    }
    const pending = load()
    this.entries.set(key, { expiresAt: now + ttlMs, pending } as CacheEntry<unknown>)
    try {
      const value = await pending
      this.entries.set(key, { value, expiresAt: now + ttlMs } as CacheEntry<unknown>)
      this.evict()
      return value
    } catch (error) {
      this.entries.delete(key)
      throw error
    }
  }

  clear(prefix?: string): void {
    if (prefix === undefined) {
      this.entries.clear()
      return
    }
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  private evict(): void {
    if (this.entries.size <= this.maxEntries) return
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
    while (this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next().value
      if (first === undefined) break
      this.entries.delete(first)
    }
  }
}

export const queryCache = new TtlCache(256)

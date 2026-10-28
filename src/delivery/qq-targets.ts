/** Per-session QQ target bindings (`state/qq-targets.json`). */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface QqBinding {
  sessionId: string
  target: string
  updatedAt: number
}

interface StoreFile {
  version: 1
  bindings: Record<string, { target: string; updatedAt: number }>
}

function emptyStore(): StoreFile {
  return { version: 1, bindings: {} }
}

function normalize(value: unknown): StoreFile {
  if (typeof value !== 'object' || value === null) return emptyStore()
  const record = value as { bindings?: unknown }
  const bindings: StoreFile['bindings'] = {}
  if (typeof record.bindings === 'object' && record.bindings !== null) {
    for (const [sessionId, entry] of Object.entries(record.bindings)) {
      if (typeof entry !== 'object' || entry === null) continue
      const typed = entry as { target?: unknown; updatedAt?: unknown }
      if (typeof typed.target !== 'string' || typed.target.trim() === '') continue
      bindings[sessionId] = {
        target: typed.target.trim(),
        updatedAt: typeof typed.updatedAt === 'number' ? typed.updatedAt : 0,
      }
    }
  }
  return { version: 1, bindings }
}

/** Session → OneBot target bindings, written atomically. */
export class QqTargetStore {
  private cache: StoreFile | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly dataDir: string,
    private readonly pathOverride = '',
  ) {}

  private get path(): string {
    return this.pathOverride === '' ? join(this.dataDir, 'state', 'qq-targets.json') : this.pathOverride
  }

  async load(): Promise<StoreFile> {
    if (this.cache !== undefined) return this.cache
    try {
      this.cache = normalize(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A damaged binding file is discarded; bindings are cheap to re-create.
      }
      this.cache = emptyStore()
    }
    return this.cache
  }

  async list(): Promise<QqBinding[]> {
    const store = await this.load()
    return Object.entries(store.bindings)
      .map(([sessionId, entry]) => ({ sessionId, target: entry.target, updatedAt: entry.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(sessionId: string): Promise<string | undefined> {
    const store = await this.load()
    return store.bindings[sessionId]?.target
  }

  async bind(sessionId: string, target: string): Promise<void> {
    const store = await this.load()
    store.bindings[sessionId] = { target: target.trim(), updatedAt: Date.now() }
    await this.persist(store)
  }

  async unbind(sessionId: string): Promise<boolean> {
    const store = await this.load()
    const existed = store.bindings[sessionId] !== undefined
    delete store.bindings[sessionId]
    if (existed) await this.persist(store)
    return existed
  }

  private async persist(store: StoreFile): Promise<void> {
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
      await rename(temporary, this.path)
    })
    await this.queue
  }
}

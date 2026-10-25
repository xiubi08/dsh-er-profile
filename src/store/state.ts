import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface GroupSettings {
  defaultSeason?: string
  defaultMode?: string
}

export interface ErState {
  version: 1
  aliases: Record<string, string>
  groups: Record<string, GroupSettings>
}

function emptyState(): ErState {
  return { version: 1, aliases: {}, groups: {} }
}

function normalizeState(value: unknown): ErState {
  if (typeof value !== 'object' || value === null) return emptyState()
  const record = value as { aliases?: unknown; groups?: unknown }
  const aliases: Record<string, string> = {}
  if (typeof record.aliases === 'object' && record.aliases !== null) {
    for (const [key, alias] of Object.entries(record.aliases)) {
      if (typeof alias === 'string' && alias.trim() !== '') aliases[key.toLowerCase()] = alias
    }
  }
  const groups: Record<string, GroupSettings> = {}
  if (typeof record.groups === 'object' && record.groups !== null) {
    for (const [key, group] of Object.entries(record.groups)) {
      if (typeof group !== 'object' || group === null) continue
      const value = group as { defaultSeason?: unknown; defaultMode?: unknown }
      groups[key] = {
        ...(typeof value.defaultSeason === 'string' && value.defaultSeason !== '' ? { defaultSeason: value.defaultSeason } : {}),
        ...(typeof value.defaultMode === 'string' && value.defaultMode !== '' ? { defaultMode: value.defaultMode } : {}),
      }
    }
  }
  return { version: 1, aliases, groups }
}

/** Persistent alias and group settings store. */
export class StateStore {
  private cache: ErState | undefined
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly dataDir: string) {}

  private get path(): string {
    return join(this.dataDir, 'state', 'state.json')
  }

  async load(): Promise<ErState> {
    if (this.cache !== undefined) return this.cache
    try {
      const text = await readFile(this.path, 'utf8')
      this.cache = normalizeState(JSON.parse(text))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = emptyState()
    }
    return this.cache
  }

  private async save(state: ErState): Promise<void> {
    this.cache = state
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temp = `${this.path}.tmp`
      await writeFile(temp, JSON.stringify(state, null, 2), 'utf8')
      await rename(temp, this.path)
    })
    await this.writeQueue
  }

  async resolveAlias(name: string): Promise<string> {
    const state = await this.load()
    return state.aliases[name.trim().toLowerCase()] ?? name.trim()
  }

  async setAlias(alias: string, player: string): Promise<void> {
    const state = await this.load()
    state.aliases[alias.trim().toLowerCase()] = player.trim()
    await this.save(state)
  }

  async removeAlias(alias: string): Promise<boolean> {
    const state = await this.load()
    const key = alias.trim().toLowerCase()
    const existed = state.aliases[key] !== undefined
    delete state.aliases[key]
    await this.save(state)
    return existed
  }

  async listAliases(): Promise<{ alias: string; player: string }[]> {
    const state = await this.load()
    return Object.entries(state.aliases).map(([alias, player]) => ({ alias, player }))
  }

  async getGroup(groupId: string): Promise<GroupSettings> {
    const state = await this.load()
    return state.groups[groupId] ?? {}
  }

  async setGroup(groupId: string, patch: GroupSettings): Promise<GroupSettings> {
    const state = await this.load()
    const next = { ...state.groups[groupId], ...patch }
    state.groups[groupId] = next
    await this.save(state)
    return next
  }
}

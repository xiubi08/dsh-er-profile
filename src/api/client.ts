/** Minimal dak.gg client with retries, typed errors, and configurable timeouts. */

import { ErError, errorMessageOf } from '../util/errors.ts'
import type {
  CharacterEntry,
  CharacterStatsSnapshot,
  ItemEntry,
  MatchEntry,
  MasteryEntry,
  Profile,
  RecommendationRaw,
  SeasonEntry,
  SkillEntry,
  TacticalEntry,
  TierEntry,
  TraitEntry,
} from '../types.ts'

const BASE_URL = 'https://er.dakgg.io/api/v1'

/** Resolve the short season spelling used by users (`S10`, `PS10`) to an API key. */
export function normalizeSeason(input: string | undefined): string | undefined {
  if (input === undefined) return undefined
  const value = input.trim().toUpperCase()
  if (value === '') return undefined
  const season = /^S(\d+)$/u.exec(value)
  if (season !== null) return `SEASON_${Number(season[1]) + 9}`
  const pre = /^PS(\d+)$/u.exec(value)
  if (pre !== null) return `PRE_SEASON_${Number(pre[1]) + 9}`
  return value
}

/** Numeric season id used by `playerSeasonOverviews` for one API season key. */
export function seasonIdForKey(key: string): number | undefined {
  const match = /^(PRE_)?SEASON_(\d+)$/u.exec(key)
  if (match === null) return undefined
  const number = Number(match[2])
  return match[1] === undefined ? number * 2 - 1 : number * 2 - 2
}

/** Short display label for a season key (`SEASON_19` → `S10`). */
export function seasonShortLabel(key: string): string {
  const normal = /^SEASON_(\d+)$/u.exec(key)
  if (normal !== null) return `S${Number(normal[1]) - 9}`
  const pre = /^PRE_SEASON_(\d+)$/u.exec(key)
  if (pre !== null) return `PS${Number(pre[1]) - 9}`
  return key
}

export interface ApiOptions {
  readonly userAgent?: string
  /** Per-attempt HTTP timeout. */
  readonly timeoutMs?: number
  /** Total attempts per request (1 = no retry). */
  readonly retries?: number
}

interface JsonRecord {
  [key: string]: unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** One HTTP boundary: retries 5xx/429/network, refuses other 4xx immediately. */
async function request<T>(url: string, options: ApiOptions, signal?: AbortSignal): Promise<T> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 20_000)
  const attempts = Math.max(1, Math.min(6, Math.trunc(options.retries ?? 3)))
  let lastError: ErError | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'user-agent': options.userAgent ?? 'Mozilla/5.0',
          accept: 'application/json,text/plain,*/*',
        },
        signal: combined,
      })
    } catch (error) {
      if (signal?.aborted === true) throw new ErError('aborted', 'request aborted', { cause: error })
      lastError = timeout.aborted
        ? new ErError('timeout', `dak.gg request timed out after ${timeoutMs} ms`, { cause: error })
        : new ErError('network_error', `network error: ${errorMessageOf(error)}`, { cause: error })
      if (attempt < attempts) await sleep(Math.min(4_000, 500 * 2 ** (attempt - 1)))
      continue
    }
    if (response.ok) {
      try {
        return await response.json() as T
      } catch (error) {
        lastError = new ErError('http_error', `dak.gg sent invalid JSON (HTTP ${response.status})`, {
          status: response.status, cause: error,
        })
        if (attempt < attempts) await sleep(Math.min(4_000, 500 * 2 ** (attempt - 1)))
        continue
      }
    }
    const status = response.status
    if (status === 429 || status >= 500) {
      lastError = new ErError('http_error', `dak.gg returned HTTP ${status}`, { status })
      if (attempt < attempts) await sleep(Math.min(4_000, 500 * 2 ** (attempt - 1)))
      continue
    }
    throw new ErError('http_error', `dak.gg returned HTTP ${status}`, { status })
  }
  throw lastError ?? new ErError('network_error', 'dak.gg request failed')
}

/** Small typed wrapper around the public dak.gg endpoints. */
export class ErApi {
  constructor(private readonly options: ApiOptions = {}) {}

  private get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${BASE_URL}${path}`
    return request<T>(url, this.options, signal)
  }

  /** Current season list, including legacy and normal entries. */
  async getSeasons(signal?: AbortSignal): Promise<SeasonEntry[]> {
    const payload = await this.get<JsonRecord>('/data/seasons?hl=zh_CN', signal)
    return (payload.seasons ?? []) as SeasonEntry[]
  }

  /** Current season key, or `SEASON_21` as a safe fallback. */
  async getCurrentSeasonKey(signal?: AbortSignal): Promise<string> {
    const seasons = await this.getSeasons(signal)
    return seasons.find(season => season.isCurrent === true)?.key ?? 'SEASON_21'
  }

  async getProfile(player: string, season: string | undefined, signal?: AbortSignal): Promise<Profile> {
    const query = season === undefined ? '' : `?season=${encodeURIComponent(season)}`
    try {
      return await this.get<Profile>(`/players/${encodeURIComponent(player)}/profile${query}`, signal)
    } catch (error) {
      if (error instanceof ErError && error.status === 404) {
        throw new ErError('player_not_found', `player not found: ${player}`, { status: 404, cause: error })
      }
      throw error
    }
  }

  async getCharacters(signal?: AbortSignal): Promise<CharacterEntry[]> {
    const payload = await this.get<JsonRecord>('/data/characters?hl=zh_CN', signal)
    return (payload.characters ?? []) as CharacterEntry[]
  }

  async getItems(signal?: AbortSignal): Promise<ItemEntry[]> {
    const payload = await this.get<JsonRecord>('/data/items?hl=zh_CN', signal)
    return (payload.items ?? []) as ItemEntry[]
  }

  async getMatches(
    player: string,
    season: string | undefined,
    matchingMode = 'ALL',
    signal?: AbortSignal,
  ): Promise<MatchEntry[]> {
    const query = new URLSearchParams({ matchingMode, teamMode: 'ALL', page: '1' })
    if (season !== undefined) query.set('season', season)
    const payload = await this.get<JsonRecord>(
      `/players/${encodeURIComponent(player)}/matches?${query.toString()}`,
      signal,
    )
    return (payload.matches ?? []) as MatchEntry[]
  }

  /** All participants of one match, used for the first-match teammate panel. */
  async getMatchDetail(player: string, seasonId: number, gameId: number, signal?: AbortSignal): Promise<MatchEntry[]> {
    const payload = await this.get<JsonRecord>(
      `/players/${encodeURIComponent(player)}/matches/${seasonId}/${gameId}`,
      signal,
    )
    return (payload.matches ?? []) as MatchEntry[]
  }

  async getMasteries(signal?: AbortSignal): Promise<MasteryEntry[]> {
    const payload = await this.get<JsonRecord>('/data/masteries?hl=zh_CN', signal)
    return (payload.masteries ?? []) as MasteryEntry[]
  }

  async getSkills(signal?: AbortSignal): Promise<SkillEntry[]> {
    const payload = await this.get<JsonRecord>('/data/skills?hl=zh_CN', signal)
    return (payload.skills ?? []) as SkillEntry[]
  }

  async getTacticalSkills(signal?: AbortSignal): Promise<TacticalEntry[]> {
    const payload = await this.get<JsonRecord>('/data/tactical-skills?hl=zh_CN', signal)
    return (payload.tacticalSkills ?? []) as TacticalEntry[]
  }

  async getTraitSkills(signal?: AbortSignal): Promise<TraitEntry[]> {
    const payload = await this.get<JsonRecord>('/data/trait-skills?hl=zh_CN', signal)
    return (payload.traitSkills ?? []) as TraitEntry[]
  }

  /** Best-weapon recommendation sections from the analysis page's __NEXT_DATA__. */
  async getCharacterRecommendations(
    characterKey: string,
    tier: string,
    weaponId?: number,
    signal?: AbortSignal,
  ): Promise<RecommendationRaw> {
    const query = new URLSearchParams({
      hl: 'zh_CN',
      tab: 'introduction',
      teamMode: 'SQUAD',
      matchingMode: 'RANK',
      tier,
      dt: '7',
    })
    const url = `https://dak.gg/er/characters/${encodeURIComponent(characterKey)}?${query.toString()}`
    let lastError: Error | undefined
    const timeoutMs = Math.max(1_000, this.options.timeoutMs ?? 20_000)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            'user-agent': 'Mozilla/5.0',
            accept: 'text/html',
            'accept-language': 'zh-CN,zh;q=0.9',
          },
          signal: signal === undefined ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        })
        if (response.status === 404) return {}
        if (!response.ok) throw new Error(`character page HTTP ${response.status}`)
        const html = await response.text()
        const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/u)
        if (match === null) return {}
        const next = JSON.parse(match[1] ?? '{}') as {
          props?: { pageProps?: { dehydratedState?: { queries?: { queryKey?: unknown[]; state?: { data?: unknown } }[] } } }
        }
        const queries = next.props?.pageProps?.dehydratedState?.queries ?? []
        const target = queries.find(item =>
          Array.isArray(item.queryKey) && String(item.queryKey[0] ?? '') === 'getCharacterStatistics')
        const data = target?.state?.data as {
          characterDetailStatSnapshot?: {
            characterDetailStat?: { weaponStats?: (RecommendationRaw & { key?: number; count?: number })[] }
          }
        } | undefined
        const weapons = data?.characterDetailStatSnapshot?.characterDetailStat?.weaponStats ?? []
        if (weapons.length === 0) return {}
        const selected = weaponId === undefined
          ? [...weapons].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]
          : weapons.find(item => item.key === weaponId) ?? [...weapons].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]
        if (selected === undefined) return {}
        return {
          ...(selected.skillBuildStats === undefined ? {} : { skillBuildStats: selected.skillBuildStats }),
          ...(selected.traitStats === undefined ? {} : { traitStats: selected.traitStats }),
          ...(selected.tacticalSkillStats === undefined ? {} : { tacticalSkillStats: selected.tacticalSkillStats }),
          ...(selected.itemStats === undefined ? {} : { itemStats: selected.itemStats }),
          ...(selected.tier === undefined ? {} : { tier: selected.tier }),
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
      }
    }
    void lastError
    return {}
  }

  async getCharacterStats(
    tier: string,
    matchingMode = 'RANK',
    teamMode = 'SQUAD',
    dt = 7,
    signal?: AbortSignal,
  ): Promise<CharacterStatsSnapshot> {
    const query = new URLSearchParams({
      dt: String(dt),
      matchingMode,
      teamMode,
      tier,
    })
    const payload = await this.get<{ characterStatSnapshot: CharacterStatsSnapshot }>(
      `/character-stats?${query.toString()}`,
      signal,
    )
    return payload.characterStatSnapshot
  }

  /** Cutoff MMR values shown in the player card header. */
  async getCutoffs(seasonKey: string, signal?: AbortSignal): Promise<{ immortal: number; titan: number }> {
    const query = new URLSearchParams({
      page: '1',
      seasonKey,
      serverName: 'seoul',
      teamMode: 'SQUAD',
      hl: 'zh_CN',
    })
    const payload = await this.get<{ cutoffs?: { mmr?: number }[] }>(
      `https://er.dakgg.io/api/v0/leaderboard?${query.toString()}`,
      signal,
    )
    const values = (payload.cutoffs ?? [])
      .map(cutoff => cutoff.mmr ?? 0)
      .filter(value => value > 0)
      .sort((a, b) => b - a)
    return { immortal: values[0] ?? 0, titan: values[1] ?? 0 }
  }

  async getTiers(signal?: AbortSignal): Promise<TierEntry[]> {
    const payload = await this.get<JsonRecord>('/data/tiers?hl=zh_CN', signal)
    return (payload.tiers ?? []) as TierEntry[]
  }
}

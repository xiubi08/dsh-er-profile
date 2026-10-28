/**
 * Tool-argument parsing: validate, clamp only what is documented, and echo the
 * effective values back to the caller instead of silently rewriting them.
 */

import { TIER_ALIASES } from '../data/character.ts'
import { lookupMode, type ModeInfo } from '../data/modes.ts'
import { ErError } from '../util/errors.ts'

export const MATCH_COUNT_MIN = 10
export const MATCH_COUNT_MAX = 20

/** Accepted season spellings: S12, PS12, SEASON_21, PRE_SEASON_20. */
const SEASON_INPUT = /^(?:S|PS)\d+$|^(?:PRE_)?SEASON_\d+$/iu

export const SEASON_HINT = 'S12 / PS12 / SEASON_21 / PRE_SEASON_20'

export const TIER_HINT = 'diamond_plus/灭钻+, mithril_plus/无瑕+, meteorite_plus/星陨+, asura_plus/修罗+, in1000/前 1000'

export interface PlayerQueryArgs {
  player: string
  season?: string
  mode?: string
  groupId?: string
  matchCount: number
  /** Values actually used after validation/clamping, so the caller can report them. */
  applied: {
    matchCount: number
    matchCountClamped: boolean
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ErError('invalid_argument', 'arguments must be an object')
  }
  return raw as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ErError('invalid_argument', `${field} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.trim()
}

/** Validate a season spelling; returns the trimmed value for `normalizeSeason`. */
export function validateSeason(value: string | undefined): string | undefined {
  const season = optionalString(value)
  if (season === undefined) return undefined
  if (!SEASON_INPUT.test(season)) {
    throw new ErError('invalid_argument', `unknown season "${season}"`, {
      details: { field: 'season', value: season, accepted: SEASON_HINT },
    })
  }
  return season
}

export function resolveMode(value: string | undefined): ModeInfo {
  const raw = optionalString(value)
  if (raw === undefined) return lookupMode('') ?? { id: 3, api: 'ALL', label: '所有模式' }
  const mode = lookupMode(raw)
  if (mode === undefined) {
    throw new ErError('invalid_argument', `unknown mode "${raw}"`, {
      details: { field: 'mode', value: raw },
    })
  }
  return mode
}

/** Parse er_player_profile arguments. */
export function parsePlayerQuery(raw: unknown): PlayerQueryArgs {
  const args = asRecord(raw)
  const player = requiredString(args.player, 'player')
  const season = validateSeason(optionalString(args.season))
  const mode = optionalString(args.mode)
  const groupId = optionalString(args.groupId)

  const requested = typeof args.matchCount === 'number' && Number.isFinite(args.matchCount)
    ? Math.trunc(args.matchCount)
    : MATCH_COUNT_MIN
  const matchCount = Math.min(MATCH_COUNT_MAX, Math.max(MATCH_COUNT_MIN, requested))
  return {
    player,
    ...(season === undefined ? {} : { season }),
    ...(mode === undefined ? {} : { mode }),
    ...(groupId === undefined ? {} : { groupId }),
    matchCount,
    applied: { matchCount, matchCountClamped: matchCount !== requested },
  }
}

export interface CharacterQueryArgs {
  character: string
  weapon?: string
  tier: string
  applied: { tier: string }
}

/** Parse er_character_stats arguments. */
export function parseCharacterQuery(raw: unknown): CharacterQueryArgs {
  const args = asRecord(raw)
  const character = requiredString(args.character, 'character')
  const weapon = optionalString(args.weapon)
  const tier = resolveTier(optionalString(args.tier) ?? 'diamond_plus')
  return {
    character,
    ...(weapon === undefined ? {} : { weapon }),
    tier,
    applied: { tier },
  }
}

/** Resolve one tier label/alias; unknown labels are rejected with the accepted set. */
export function resolveTier(value: string): string {
  const input = value.trim()
  if (input === '') return 'diamond_plus'
  const tier = TIER_ALIASES[input] ?? TIER_ALIASES[input.toLowerCase()] ?? input
  if (!['diamond_plus', 'mithril_plus', 'meteorite_plus', 'asura_plus', 'in1000'].includes(tier)) {
    throw new ErError('invalid_argument', `unknown tier "${input}"`, {
      details: { field: 'tier', value: input },
    })
  }
  return tier
}

/** Parse er_character_rank arguments. */
export function parseRankQuery(raw: unknown): { tier: string; applied: { tier: string } } {
  const args = asRecord(raw)
  const tier = resolveTier(optionalString(args.tier) ?? 'diamond_plus')
  return { tier, applied: { tier } }
}

/** DSH tool surface for the Eternal Return profile plugin. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ErApi, normalizeSeason, seasonIdForKey, seasonShortLabel } from './api/client.ts'
import { OfficialApi } from './api/official.ts'
import { AssetStore, type AssetUpdateReport } from './data/assets.ts'
import { buildPlayerCard } from './data/mapper.ts'
import { buildCharacterCard, TIER_ALIASES, TIER_LABELS } from './data/character.ts'
import { buildCharacterRating } from './data/rating.ts'
import { renderPlayerCard } from './render/profile.ts'
import { renderCharacterCard } from './render/character.ts'
import { renderCharacterRating } from './render/character-rank.ts'
import { RenderWorkerPool } from './render/pool.ts'
import { resolveConfig, type ErConfigInput, type ResolvedConfig } from './config.ts'
import { resolveQqTarget, sendQqImage } from './delivery/qq.ts'
import { StateStore } from './store/state.ts'
import { queryCache } from './util/cache.ts'
import type {
  CharacterCardData,
  CharacterEntry,
  ItemEntry,
  MasteryEntry,
  PlayerCardData,
  RecommendationRaw,
  SkillEntry,
  TacticalEntry,
  TierEntry,
  TraitEntry,
} from './types.ts'
import type { Context, ImageAttachmentRef, ToolDefinition } from './dsh.ts'

export const inject = ['tools']

interface PlayerArgs {
  player: string
  season?: string
  matchCount: number
  mode?: string
  groupId?: string
}

let renderPool: RenderWorkerPool | undefined

const MODES: Record<string, { id: number; api: string; label: string }> = {  all: { id: 3, api: 'ALL', label: '所有模式' },
  所有: { id: 3, api: 'ALL', label: '所有模式' },
  所有模式: { id: 3, api: 'ALL', label: '所有模式' },
  rank: { id: 3, api: 'RANK', label: '排位' },
  排位: { id: 3, api: 'RANK', label: '排位' },
  normal: { id: 2, api: 'NORMAL', label: '匹配' },
  匹配: { id: 2, api: 'NORMAL', label: '匹配' },
  cobalt: { id: 6, api: 'COBALT', label: '钴协议' },
  钴协议: { id: 6, api: 'COBALT', label: '钴协议' },
  'squad-rumble': { id: 8, api: 'SQUAD_RUMBLE', label: '联盟' },
  联盟: { id: 8, api: 'SQUAD_RUMBLE', label: '联盟' },
  'lone-wolf': { id: 9, api: 'LONE_WOLF', label: '孤狼' },
  孤狼: { id: 9, api: 'LONE_WOLF', label: '孤狼' },
  'cobalt-rumble': { id: 11, api: 'SQUAD_RUMBLE_COBALT', label: '钴联盟' },
  钴联盟: { id: 11, api: 'SQUAD_RUMBLE_COBALT', label: '钴联盟' },
}

function parseMode(value: string | undefined): { id: number; api: string; label: string } {
  if (value === undefined || value.trim() === '') return MODES.all ?? { id: 3, api: 'ALL', label: '所有模式' }
  return MODES[value.trim().toLowerCase()] ?? MODES[value.trim()] ?? { id: 3, api: 'ALL', label: value.trim() }
}

interface DeliveredImage {
  path: string
  width: number
  height: number
  attachment?: ImageAttachmentRef
}

interface PlayerToolValue {
  player: { name: string; level: number; mmr: number; tier: string; season: string; mode: string }
  season: { key: string; label: string }
  mode: string
  summary: PlayerCardData['summary']
  matches: PlayerCardData['matches']
  image: DeliveredImage
  delivery: { web: 'attachment' | 'file'; qq: 'disabled' | 'failed' | 'sent' }
  warnings: string[]
}

interface CharacterToolValue {
  character: { name: string; weapon: string; tier: string; badge: string }
  stats: CharacterCardData
  image: DeliveredImage
  delivery: { web: 'attachment' | 'file'; qq: 'disabled' | 'failed' | 'sent' }
  warnings: string[]
}

let dictionaries: Promise<{
  characters: CharacterEntry[]
  tiers: TierEntry[]
  items: ItemEntry[]
  masteries: MasteryEntry[]
  skills: SkillEntry[]
  tactical: TacticalEntry[]
  traits: TraitEntry[]
}> | undefined

interface DictionaryBundle {
  characters: CharacterEntry[]
  tiers: TierEntry[]
  items: ItemEntry[]
  masteries: MasteryEntry[]
  skills: SkillEntry[]
  tactical: TacticalEntry[]
  traits: TraitEntry[]
}

function getDictionaries(api: ErApi, dataDir: string, force = false): Promise<DictionaryBundle> {
  if (force) {
    dictionaries = (async () => {
      const data = await fetchDictionaries(api)
      await writeDictionaryCache(dataDir, data)
      return data
    })().catch(error => {
      dictionaries = undefined
      throw error
    })
    return dictionaries
  }
  dictionaries ??= (async () => {
    const cachePath = join(dataDir, 'state', 'dictionaries.json')
    try {
      const parsed = JSON.parse(await readFile(cachePath, 'utf8')) as {
        version?: number
        fetchedAt?: number
        data?: DictionaryBundle
      }
      if (parsed.version === 1 && typeof parsed.fetchedAt === 'number'
        && Date.now() - parsed.fetchedAt < 12 * 60 * 60 * 1000 && parsed.data !== undefined
        && Array.isArray(parsed.data.characters) && Array.isArray(parsed.data.traits)) {
        return parsed.data
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A damaged cache is discarded and rebuilt below.
      }
    }
    const data = await fetchDictionaries(api)
    await writeDictionaryCache(dataDir, data)
    return data
  })().catch(error => {
    dictionaries = undefined
    throw error
  })
  return dictionaries
}

async function fetchDictionaries(api: ErApi): Promise<DictionaryBundle> {
  const [characters, tiers, items, masteries, skills, tactical, traits] = await Promise.all([
    api.getCharacters(),
    api.getTiers(),
    api.getItems(),
    api.getMasteries(),
    api.getSkills(),
    api.getTacticalSkills(),
    api.getTraitSkills(),
  ])
  return { characters, tiers, items, masteries, skills, tactical, traits }
}

async function writeDictionaryCache(dataDir: string, data: DictionaryBundle): Promise<void> {
  const cachePath = join(dataDir, 'state', 'dictionaries.json')
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify({ version: 1, fetchedAt: Date.now(), data }), 'utf8')
}

function parseArgs(raw: unknown): PlayerArgs {
  if (raw === null || typeof raw !== 'object') throw new Error('arguments must be an object')
  const args = raw as Record<string, unknown>
  if (typeof args.player !== 'string' || args.player.trim() === '') throw new Error('player must be a non-empty string')
  const matchCountRaw = typeof args.matchCount === 'number' ? args.matchCount : 10
  const matchCount = Math.min(20, Math.max(10, Math.trunc(matchCountRaw)))
  return {
    player: args.player.trim(),
    ...(typeof args.season === 'string' && args.season.trim() !== '' ? { season: args.season.trim() } : {}),
    ...(typeof args.mode === 'string' && args.mode.trim() !== '' ? { mode: args.mode.trim() } : {}),
    ...(typeof args.groupId === 'string' && args.groupId.trim() !== '' ? { groupId: args.groupId.trim() } : {}),
    matchCount,
  }
}

function textOf(value: PlayerToolValue): string {
  const wins = value.matches.filter(match => match.win).length
  const web = value.delivery.web === 'attachment' ? '，并已显示在 Web 中' : ''
  const qq = value.delivery.qq === 'sent' ? '，并已发送到 QQ' : ''
  return `${value.player.name} · ${value.season.label} ${value.mode}：MMR ${value.player.mmr}，${value.player.tier}；`
    + `近 ${value.matches.length} 场 ${wins} 胜，平均排名 ${value.summary.avgRank.toFixed(2)}，`
    + `平均击杀 ${value.summary.avgKill.toFixed(2)}。战绩图已生成${web}${qq}。`
}

async function deliverPng(
  ctx: Context,
  config: ResolvedConfig,
  png: Buffer,
  width: number,
  height: number,
  label: string,
  sessionId?: string,
): Promise<{
  image: DeliveredImage
  web: 'attachment' | 'file'
  qq: 'disabled' | 'failed' | 'sent'
  warnings: string[]
}> {
  const outputDir = join(config.dataDir, 'output')
  await mkdir(outputDir, { recursive: true })
  const fileName = `${label.replace(/[\\/:*?"<>|]/gu, '_')}-${randomUUID().slice(0, 8)}.png`
  const path = join(outputDir, fileName)
  await writeFile(path, png)

  let attachment: ImageAttachmentRef | undefined
  const warnings: string[] = []
  const attachments = ctx.get?.<Context['attachments']>('attachments') ?? ctx.attachments
  if (attachments !== undefined) {
    try {
      attachment = await attachments.saveImage({ data: png, mediaType: 'image/png', name: fileName })
    } catch (error) {
      warnings.push(`Web attachment failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let qq: 'disabled' | 'failed' | 'sent' = 'disabled'
  if (config.qqDelivery.enabled) {
    try {
      const target = await resolveQqTarget(config, sessionId)
      if (target === undefined) {
        qq = 'failed'
        warnings.push('QQ 推送失败：未找到当前会话的 QQ 目标')
      } else {
        await sendQqImage(config, target, png)
        qq = 'sent'
      }
    } catch (error) {
      qq = 'failed'
      warnings.push(`QQ 推送失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    image: { path, width, height, ...(attachment === undefined ? {} : { attachment }) },
    web: attachment === undefined ? 'file' : 'attachment',
    qq,
    warnings,
  }
}

async function runPlayerTool(
  ctx: Context,
  config: ResolvedConfig,
  state: StateStore,
  args: PlayerArgs,
  signal: AbortSignal,
  sessionId?: string,
): Promise<PlayerToolValue> {
  const api = new ErApi()
  const player = await state.resolveAlias(args.player)
  const group = args.groupId === undefined ? {} : await state.getGroup(args.groupId)
  const mode = parseMode(args.mode ?? group.defaultMode)
  const seasonKey = normalizeSeason(args.season ?? group.defaultSeason) ?? await api.getCurrentSeasonKey(signal)
  const [profile, matches, cutoffs, { characters, tiers, items, masteries, skills, tactical, traits }] = await Promise.all([
    queryCache.getOrLoad(`profile:${player}:${seasonKey}`, 60_000, () => api.getProfile(player, seasonKey, signal)),
    queryCache.getOrLoad(`matches:${player}:${seasonKey}:${mode.api}`, 60_000, () => api.getMatches(player, seasonKey, mode.api, signal)),
    queryCache.getOrLoad(`cutoffs:${seasonKey}`, 300_000, () => api.getCutoffs(seasonKey, signal).catch(() => ({ immortal: 0, titan: 0 }))),
    getDictionaries(api, config.dataDir),
  ])
  const assets = new AssetStore(config.dataDir, characters, tiers, items, skills, tactical, traits, masteries)
  if (config.officialApiKey !== '' && (mode.id === 3 || mode.id === 0)) {
    try {
      const seasonId = seasonIdForKey(seasonKey)
      const overview = profile.playerSeasonOverviews.find(item =>
        item.seasonId === seasonId && item.matchingModeId === 3 && item.teamModeId === 3)
      if (seasonId !== undefined && overview !== undefined) {
        const official = new OfficialApi(config.officialApiKey)
        const userId = await queryCache.getOrLoad(`official-uid:${player}`, 86_400_000, () => official.getUserId(player))
        const stats = await queryCache.getOrLoad(`official-stats:${userId}:${seasonId}`, 300_000, () =>
          official.getUserStats(userId, seasonId, 3))
        const ranked = stats.find(item => item.matchingMode === 3)
        if (ranked !== undefined) {
          const play = ranked.totalGames ?? overview.play
          overview.mmr = ranked.mmr ?? overview.mmr
          overview.play = play
          overview.win = ranked.totalWins ?? overview.win
          overview.teamKill = ranked.totalTeamKills ?? overview.teamKill
          overview.playerKill = Math.round((ranked.averageKills ?? 0) * play)
          overview.playerAssistant = Math.round((ranked.averageAssists ?? 0) * play)
          overview.playerDeaths = Math.round((ranked.averageDeaths ?? 0) * play)
          overview.place = Math.round((ranked.averagePlacement ?? 0) * play)
          if (ranked.top3 !== undefined) overview.top3 = ranked.top3
          const season = profile.playerSeasons.find(item => item.seasonId === seasonId)
          if (season !== undefined) season.mmr = overview.mmr
        }
      }
    } catch {
      // Official API is optional; fall back to dak.gg values.
    }
  }
  const firstMatch = matches[0]
  const firstDetail = firstMatch === undefined
    ? undefined
    : await queryCache.getOrLoad(
      `match-detail:${firstMatch.seasonId}:${firstMatch.gameId}`,
      600_000,
      () => api.getMatchDetail(player, firstMatch.seasonId, firstMatch.gameId, signal).catch(() => undefined as undefined),
    )
  const card = buildPlayerCard(
    profile,
    matches,
    seasonKey,
    args.matchCount,
    assets,
    cutoffs,
    firstDetail,
    mode.id,
    mode.label,
  )
  const rendered = renderPool === undefined
    ? await renderPlayerCard(card, assets, config.fontsDir)
    : await renderPool.render({
      kind: 'player',
      data: card,
      dictionaries: { characters, tiers, items, masteries, skills, tactical, traits },
      dataDir: config.dataDir,
      fontDir: config.fontsDir,
    })
  const delivered = await deliverPng(ctx, config, rendered.png, rendered.width, rendered.height, `${player}-${seasonKey}`, sessionId)

  return {
    player: {
      name: card.name,
      level: card.level,
      mmr: card.mmr,
      tier: card.tierName,
      season: seasonShortLabel(seasonKey),
      mode: card.modeLabel,
    },
    season: { key: seasonKey, label: seasonShortLabel(seasonKey) },
    mode: card.modeLabel,
    summary: card.summary,
    matches: card.matches,
    image: delivered.image,
    delivery: { web: delivered.web, qq: delivered.qq },
    warnings: delivered.warnings,
  }
}

interface CharacterArgs {
  character: string
  weapon?: string
  tier: string
}

function parseCharacterArgs(raw: unknown): CharacterArgs {
  if (raw === null || typeof raw !== 'object') throw new Error('arguments must be an object')
  const args = raw as Record<string, unknown>
  if (typeof args.character !== 'string' || args.character.trim() === '') {
    throw new Error('character must be a non-empty string')
  }
  const tierInput = typeof args.tier === 'string' && args.tier.trim() !== '' ? args.tier.trim() : 'diamond_plus'
  const tier = TIER_ALIASES[tierInput] ?? TIER_ALIASES[tierInput.toLowerCase()] ?? tierInput
  return {
    character: args.character.trim(),
    ...(typeof args.weapon === 'string' && args.weapon.trim() !== '' ? { weapon: args.weapon.trim() } : {}),
    tier,
  }
}

function characterText(value: CharacterToolValue): string {
  const stats = value.stats
  return `${value.character.name} · ${value.character.weapon} | ${value.character.tier}：`
    + `胜率 ${stats.winRate.toFixed(1)}%，TOP3 ${stats.top3Rate.toFixed(1)}%，`
    + `平均排名 #${stats.avgRank.toFixed(2)}，平均击杀 ${stats.avgKill.toFixed(2)}，`
    + `选择率 ${stats.pickRate.toFixed(2)}%。角色数据图已生成${value.delivery.web === 'attachment' ? '，并已显示在 Web 中' : ''}${value.delivery.qq === 'sent' ? '，并已发送到 QQ' : ''}。`
}

async function runCharacterTool(
  ctx: Context,
  config: ResolvedConfig,
  args: CharacterArgs,
  signal: AbortSignal,
  sessionId?: string,
): Promise<CharacterToolValue> {
  const api = new ErApi()
  const { characters, tiers, items, masteries, skills, tactical, traits } = await getDictionaries(api, config.dataDir)
  const characterQuery = config.characterAliases[args.character.trim().toLowerCase()] ?? args.character
  const character = characters.find(item =>
    item.name === characterQuery || item.key.toLowerCase() === characterQuery.toLowerCase())
  if (character === undefined) throw new Error(`未找到角色「${args.character}」`)
  const snapshot = await queryCache.getOrLoad(
    `character-stats:${args.tier}`,
    300_000,
    () => api.getCharacterStats(args.tier, 'RANK', 'SQUAD', 7, signal),
  )
  const assets = new AssetStore(config.dataDir, characters, tiers, items, skills, tactical, traits, masteries)
  const weaponQuery = args.weapon === undefined
    ? undefined
    : config.weaponAliases[args.weapon.trim().toLowerCase()] ?? args.weapon
  const base = buildCharacterCard(character, snapshot, masteries, args.tier, weaponQuery, undefined, assets)
  const recommendations: RecommendationRaw = await queryCache.getOrLoad(
    `recommendations:${character.key}:${args.tier}:${base.weaponId}`,
    1_800_000,
    () => api.getCharacterRecommendations(character.key, args.tier, base.weaponId, signal).catch(() => ({})),
  )
  const card = buildCharacterCard(character, snapshot, masteries, args.tier, weaponQuery, recommendations, assets)
  const rendered = renderPool === undefined
    ? await renderCharacterCard(card, assets, character.id, config.fontsDir)
    : await renderPool.render({
      kind: 'character',
      data: card,
      dictionaries: { characters, tiers, items, masteries, skills, tactical, traits },
      dataDir: config.dataDir,
      fontDir: config.fontsDir,
      characterId: character.id,
    })
  const delivered = await deliverPng(ctx, config, rendered.png, rendered.width, rendered.height, `${character.name}-${args.tier}`, sessionId)

  return {
    character: {
      name: card.name,
      weapon: card.weaponName,
      tier: card.tierLabel,
      badge: card.tierBadge,
    },
    stats: card,
    image: delivered.image,
    delivery: { web: delivered.web, qq: delivered.qq },
    warnings: delivered.warnings,
  }
}

function characterTool(ctx: Context, config: ResolvedConfig): ToolDefinition {
  return {
    name: 'er_character_stats',
    description: 'Look up Eternal Return character statistics, render a character card, and return a text summary. '
      + 'Before the first query in a fresh install, call er_update_assets first and remind the user that skipping it makes the first query much slower. '
      + 'Use it when the user asks for 查询角色 / character win rate, pick rate, TOP3, RP, or tier performance. '
      + 'The image is delivered to the Web UI separately; do not invent numbers.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['character'],
      properties: {
        character: { type: 'string', description: 'Character name in Chinese or English key, e.g. 扎希尔 or Zahir.' },
        weapon: { type: 'string', description: 'Optional weapon name/key, e.g. 投掷 or HighAngleFire.' },
        tier: {
          type: 'string',
          description: 'Optional tier: diamond_plus (default), mithril_plus, meteorite_plus, asura_plus, in1000.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          character: { type: 'object' },
          stats: { type: 'object' },
          image: { type: 'object' },
          delivery: { type: 'object' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: characterText(value as CharacterToolValue) }],
      presentationMeta: (_args, value) => {
        const typed = value as CharacterToolValue
        return {
          image: typed.image,
          character: typed.character,
          stats: typed.stats,
        }
      },
    },
    async execute(raw, exec) {
      return runCharacterTool(ctx, config, parseCharacterArgs(raw), exec.signal, exec.agent?.session?.id)
    },
  }
}

function playerTool(ctx: Context, config: ResolvedConfig, state: StateStore): ToolDefinition {
  const parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['player'],
    properties: {
      player: { type: 'string', description: 'Eternal Return player nickname, exactly as shown in game.' },
      season: { type: 'string', description: 'Optional season such as S10, PS10, or SEASON_19. Defaults to the current season.' },
      mode: {
        type: 'string',
        description: 'Optional mode: 排位/rank, 匹配/normal, 钴协议/cobalt, 联盟/squad-rumble, 孤狼/lone-wolf, 钴联盟/cobalt-rumble, or 所有模式/all (default).',
      },
      groupId: {
        type: 'string',
        description: 'Optional group id; when set, the group’s default season/mode are used for omitted arguments.',
      },
      matchCount: {
        type: 'integer',
        minimum: 10,
        maximum: 20,
        default: 10,
        description: 'How many recent matches to include (10–20).',
      },
    },
  }
  return {
    name: 'er_player_profile',
    description: 'Look up an Eternal Return player, render a profile card, and return a text summary. '
      + 'Before the first query in a fresh install, call er_update_assets first and remind the user that skipping it makes the first query much slower. '
      + 'Use it when the user asks for 永恒轮回 / Eternal Return player stats, MMR, tier, rank, or recent matches. '
      + 'The rendered image is delivered to the Web UI (and later QQ) separately; do not invent MMR or match data.',
    parameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          player: { type: 'object' },
          season: { type: 'object' },
          mode: { type: 'string' },
          summary: { type: 'object' },
          matches: { type: 'array' },
          image: { type: 'object' },
          delivery: { type: 'object' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: textOf(value as PlayerToolValue) }],
      presentationMeta: (_args, value) => {
        const typed = value as PlayerToolValue
        return {
          image: typed.image,
          player: typed.player,
          season: typed.season,
          mode: typed.mode,
          summary: typed.summary,
        }
      },
    },
    async execute(raw, exec) {
      const args = parseArgs(raw)
      return runPlayerTool(ctx, config, state, args, exec.signal, exec.agent?.session?.id)
    },
  }
}

interface CharacterRankToolValue {
  rank: { title: string; subtitle: string }
  entries: { name: string; grade: string; damage: number; rpGain: number }[]
  image: DeliveredImage
  delivery: { web: 'attachment' | 'file'; qq: 'disabled' | 'failed' | 'sent' }
  warnings: string[]
}

async function runCharacterRankTool(
  ctx: Context,
  config: ResolvedConfig,
  tierInput: string,
  signal: AbortSignal,
  sessionId?: string,
): Promise<CharacterRankToolValue> {
  const api = new ErApi()
  const tier = TIER_ALIASES[tierInput] ?? TIER_ALIASES[tierInput.toLowerCase()] ?? tierInput
  const { characters, tiers, items, masteries, skills, tactical, traits } = await getDictionaries(api, config.dataDir)
  const snapshot = await queryCache.getOrLoad(
    `character-rank:${tier}`,
    300_000,
    () => api.getCharacterStats(tier, 'RANK', 'SQUAD', 7, signal),
  )
  const data = buildCharacterRating(snapshot, characters, tier)
  const assets = new AssetStore(config.dataDir, characters, tiers, items, skills, tactical, traits, masteries)
  const rendered = renderPool === undefined
    ? await renderCharacterRating(data, assets, config.fontsDir)
    : await renderPool.render({
      kind: 'rank',
      data,
      dictionaries: { characters, tiers, items, masteries, skills, tactical, traits },
      dataDir: config.dataDir,
      fontDir: config.fontsDir,
    })
  const delivered = await deliverPng(ctx, config, rendered.png, rendered.width, rendered.height, `character-rank-${tier}`, sessionId)
  const subtitle = `${TIER_LABELS[tier] ?? data.tierLabel} · 共 ${data.entries.length} 项 · 样本 ${data.totalSamples.toLocaleString()} 场`
  return {
    rank: { title: '角色评级排行', subtitle },
    entries: data.entries.map(entry => ({
      name: entry.name,
      grade: entry.grade,
      damage: entry.damage,
      rpGain: entry.rpGain,
    })),
    image: delivered.image,
    delivery: { web: delivered.web, qq: delivered.qq },
    warnings: delivered.warnings,
  }
}

function characterRankText(value: CharacterRankToolValue): string {
  return `角色评级排行 · ${value.rank.subtitle}。评级图已生成${value.delivery.web === 'attachment' ? '，并已显示在 Web 中' : ''}${value.delivery.qq === 'sent' ? '，并已发送到 QQ' : ''}。`
}

function characterRankTool(ctx: Context, config: ResolvedConfig): ToolDefinition {
  return {
    name: 'er_character_rank',
    description: 'Render the Eternal Return character rating grid (S/A/B/C/D) for a tier. '
      + 'Before the first query in a fresh install, call er_update_assets first and remind the user that skipping it makes the first query much slower. '
      + 'Use it when the user asks for 角色评级 / character rankings / character tier list.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tier: {
          type: 'string',
          description: 'Optional tier: diamond_plus (default), mithril_plus, meteorite_plus, asura_plus, in1000.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          rank: { type: 'object' },
          entries: { type: 'array' },
          image: { type: 'object' },
          delivery: { type: 'object' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: characterRankText(value as CharacterRankToolValue) }],
      presentationMeta: (_args, value) => {
        const typed = value as CharacterRankToolValue
        return { image: typed.image, rank: typed.rank }
      },
    },
    async execute(raw, exec) {
      if (raw !== null && typeof raw !== 'object') throw new Error('arguments must be an object')
      const args = (raw ?? {}) as { tier?: unknown }
      const tier = typeof args.tier === 'string' && args.tier.trim() !== '' ? args.tier.trim() : 'diamond_plus'
      return runCharacterRankTool(ctx, config, tier, exec.signal, exec.agent?.session?.id)
    },
  }
}

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  characters: '角色头像',
  character_skins: '角色皮肤',
  items: '物品图标',
  tiers: '段位图标',
  tiers_full: '段位大图',
  tactical_skills: '战术技能',
  trait_skills: '特性技能',
  masteries: '武器熟练度',
  skills: '角色技能',
}

function formatAssetReport(report: AssetUpdateReport): string {
  const lines = [
    `资源库已更新：共 ${report.total} 项；正常 ${report.ok}，`
      + `变更 ${report.changed}（重下 ${report.downloaded}，仅更新 URL ${report.adopted}），`
      + `缺失 ${report.missing}，失败 ${report.failed}。`,
  ]
  for (const category of report.categories) {
    if (category.total === 0) continue
    lines.push(
      `${ASSET_CATEGORY_LABELS[category.key] ?? category.key}：`
        + `正常 ${category.ok} | 变更 ${category.changed} | 缺失 ${category.missing}`,
    )
  }
  if (report.failed > 0) {
    const shown = report.failures.slice(0, 5)
      .map(failure => `${ASSET_CATEGORY_LABELS[failure.category] ?? failure.category} #${failure.key}`)
    const suffix = report.failures.length > shown.length ? ` 等 ${report.failures.length} 项` : ''
    lines.push(`失败：${shown.join('、')}${suffix}，下次更新会重试。`)
  }
  return lines.join('\n')
}

function assetUpdateTool(ctx: Context, config: ResolvedConfig): ToolDefinition {
  return {
    name: 'er_update_assets',
    description: 'Download or refresh the local Eternal Return resource library (characters, skins, items, tiers, weapons, '
      + 'skills, tactical skills, traits). Call this before the first player/character query in a fresh install: '
      + 'without it, images download lazily and the first query is much slower. '
      + 'Also tell the user this is recommended before first use.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      render: (_args, value) => [{ type: 'text', text: (value as { message: string }).message }],
    },
    async execute(_raw, exec) {
      const api = new ErApi()
      ctx.logger.info('er-profile: refreshing dictionaries and checking asset differences')
      const { characters, tiers, items, masteries, skills, tactical, traits } =
        await getDictionaries(api, config.dataDir, true)
      const assets = new AssetStore(config.dataDir, characters, tiers, items, skills, tactical, traits, masteries)
      let logged = 0
      const report = await assets.updateAll({
        concurrency: config.assetDownloadConcurrency,
        signal: exec.signal,
        onProgress: (done, total) => {
          if (done - logged < 200 && done !== total) return
          logged = done
          ctx.logger.info(`er-profile: assets ${done}/${total}`)
        },
      })
      ctx.logger.info(
        `er-profile: assets done ok=${report.ok} changed=${report.changed} `
          + `missing=${report.missing} failed=${report.failed}`,
      )
      for (const failure of report.failures) {
        ctx.logger.warn(
          `er-profile: asset download failed ${failure.category}/${failure.key}: ${failure.url}`,
        )
      }
      return { message: formatAssetReport(report) }
    },
  }
}

function aliasTool(state: StateStore): ToolDefinition {
  return {
    name: 'er_alias',
    description: 'Manage player nickname aliases used by er_player_profile. '
      + 'Actions: set (alias -> player), remove, list.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['set', 'remove', 'list'] },
        alias: { type: 'string', description: 'Alias nickname.' },
        player: { type: 'string', description: 'Canonical in-game player nickname (set only).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      render: (_args, value) => [{ type: 'text', text: (value as { message: string }).message }],
    },
    async execute(raw) {
      if (raw === null || typeof raw !== 'object') throw new Error('arguments must be an object')
      const args = raw as { action?: unknown; alias?: unknown; player?: unknown }
      const action = typeof args.action === 'string' ? args.action : ''
      if (action === 'list') {
        const aliases = await state.listAliases()
        return {
          message: aliases.length === 0
            ? '暂无别名。'
            : `当前别名：${aliases.map(item => `${item.alias} → ${item.player}`).join('；')}`,
        }
      }
      if (typeof args.alias !== 'string' || args.alias.trim() === '') throw new Error('alias is required')
      if (action === 'set') {
        if (typeof args.player !== 'string' || args.player.trim() === '') throw new Error('player is required')
        await state.setAlias(args.alias, args.player)
        return { message: `已将别名「${args.alias.trim()}」指向「${args.player.trim()}」。` }
      }
      if (action === 'remove') {
        const existed = await state.removeAlias(args.alias)
        return { message: existed ? `已删除别名「${args.alias.trim()}」。` : `别名「${args.alias.trim()}」不存在。` }
      }
      throw new Error(`unknown action: ${action}`)
    },
  }
}

function groupConfigTool(state: StateStore): ToolDefinition {
  return {
    name: 'er_group_config',
    description: 'Read or update per-group defaults for er_player_profile. '
      + 'Actions: get, set (defaultSeason/defaultMode).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'groupId'],
      properties: {
        action: { type: 'string', enum: ['get', 'set'] },
        groupId: { type: 'string', description: 'Group id.' },
        defaultSeason: { type: 'string', description: 'Default season key, e.g. S12.' },
        defaultMode: { type: 'string', description: 'Default mode, e.g. 排位.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      render: (_args, value) => [{ type: 'text', text: (value as { message: string }).message }],
    },
    async execute(raw) {
      if (raw === null || typeof raw !== 'object') throw new Error('arguments must be an object')
      const args = raw as { action?: unknown; groupId?: unknown; defaultSeason?: unknown; defaultMode?: unknown }
      if (typeof args.groupId !== 'string' || args.groupId.trim() === '') throw new Error('groupId is required')
      if (args.action === 'get') {
        const group = await state.getGroup(args.groupId.trim())
        return {
          message: `群 ${args.groupId.trim()} 默认设置：赛季 ${group.defaultSeason ?? '未设置'}，模式 ${group.defaultMode ?? '未设置'}。`,
        }
      }
      if (args.action === 'set') {
        const patch = {
          ...(typeof args.defaultSeason === 'string' && args.defaultSeason.trim() !== '' ? { defaultSeason: args.defaultSeason.trim() } : {}),
          ...(typeof args.defaultMode === 'string' && args.defaultMode.trim() !== '' ? { defaultMode: args.defaultMode.trim() } : {}),
        }
        const group = await state.setGroup(args.groupId.trim(), patch)
        return {
          message: `已更新群 ${args.groupId.trim()}：赛季 ${group.defaultSeason ?? '未设置'}，模式 ${group.defaultMode ?? '未设置'}。`,
        }
      }
      throw new Error('unknown action')
    },
  }
}

/** Plugin entry: register the player-profile tool. */
export function apply(ctx: Context, input?: ErConfigInput): void {
  const config = resolveConfig(input)
  const state = new StateStore(config.dataDir)
  renderPool = new RenderWorkerPool(config.renderWorkers, config.renderTimeoutMs)
  ctx.logger.info(`er-profile: dataDir=${config.dataDir}`)
  const register = (): (() => void) => {
    const disposePlayer = ctx.tools.register(playerTool(ctx, config, state))
    const disposeCharacter = ctx.tools.register(characterTool(ctx, config))
    const disposeRank = ctx.tools.register(characterRankTool(ctx, config))
    const disposeAssets = ctx.tools.register(assetUpdateTool(ctx, config))
    const disposeAlias = ctx.tools.register(aliasTool(state))
    const disposeGroup = ctx.tools.register(groupConfigTool(state))
    return () => {
      disposeGroup()
      disposeAlias()
      disposeAssets()
      disposeRank()
      disposeCharacter()
      disposePlayer()
      void renderPool?.close()
      renderPool = undefined
    }
  }
  if (ctx.effect !== undefined) ctx.effect(register, 'er-profile: player tool')
  else register()
}

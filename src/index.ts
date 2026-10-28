/** DSH tool surface for the Eternal Return profile plugin. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ErApi, normalizeSeason, seasonIdForKey, seasonShortLabel } from './api/client.ts'
import { OfficialApi } from './api/official.ts'
import { AssetStore, type AssetUpdateReport } from './data/assets.ts'
import { buildPlayerCard } from './data/mapper.ts'
import { buildCharacterCard, TIER_LABELS } from './data/character.ts'
import { buildCharacterRating } from './data/rating.ts'
import { MODE_HINT, type ModeInfo } from './data/modes.ts'
import { renderPlayerCard } from './render/profile.ts'
import { renderCharacterCard } from './render/character.ts'
import { renderCharacterRating } from './render/character-rank.ts'
import { RenderWorkerPool, type RenderDictionaries } from './render/pool.ts'
import { resolveConfig, type ErConfigInput, type ResolvedConfig } from './config.ts'
import { assertAllowed, formatQqTarget, parseQqTarget, probeOneBot, resolveQqTarget, sendQqImage } from './delivery/qq.ts'
import { QqTargetStore } from './delivery/qq-targets.ts'
import { detectChannels } from './delivery/discovery.ts'
import { StateStore } from './store/state.ts'
import { queryCache } from './util/cache.ts'
import { RenderCache } from './util/render-cache.ts'
import { pruneOutput } from './util/output.ts'
import { ErError, errorCodeOf, errorMessageOf } from './util/errors.ts'
import { createTexts, type Texts } from './util/i18n.ts'
import {
  MATCH_COUNT_MIN, MATCH_COUNT_MAX, SEASON_HINT, TIER_HINT,
  parseCharacterQuery, parsePlayerQuery, parseRankQuery, resolveMode, validateSeason,
} from './tool/params.ts'
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

const renderCache = new RenderCache(16)

let renderPool: RenderWorkerPool | undefined

interface DictionaryBundle {
  characters: CharacterEntry[]
  tiers: TierEntry[]
  items: ItemEntry[]
  masteries: MasteryEntry[]
  skills: SkillEntry[]
  tactical: TacticalEntry[]
  traits: TraitEntry[]
}

interface DeliveredImage {
  path: string
  width: number
  height: number
  /**
   * Inline `data:` preview of the card. The Web tool view cannot rely on the
   * authenticated `api/file` route (a bare `<img src>` carries no connection
   * credential), so it renders this self-contained thumbnail instead.
   */
  preview?: string
  attachment?: ImageAttachmentRef
}

/** Absolute path of the rendered PNG, so an agent can forward it (e.g. QQ file send). */
function imagePathNote(path: string): string {
  return `\n图片文件：${path}`
}

/** Downscale a rendered card to a small self-contained data URL for the Web view. */
async function previewDataUrl(png: Buffer, maxWidth = 560): Promise<string | undefined> {
  try {
    const image = await loadImage(png)
    const scale = Math.min(1, maxWidth / image.width)
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const encoded = await canvas.encode('webp', 85)
    return `data:image/webp;base64,${Buffer.from(encoded).toString('base64')}`
  } catch {
    return undefined
  }
}

interface Rendered {
  png: Buffer
  width: number
  height: number
  missing: string[]
  missingCount: number
}

interface AssetsView {
  /** Assets missing from the card, 0 when the render was fully illustrated. */
  missing: number
  /** `category#key (reason)` samples. */
  sample: string[]
}

interface PlayerToolValue {
  player: { name: string; level: number; mmr: number; tier: string; season: string; mode: string }
  season: { key: string; label: string }
  mode: string
  applied: { season: string; mode: string; matchCount: number; matchCountClamped: boolean }
  summary: PlayerCardData['summary']
  matches: PlayerCardData['matches']
  assets: AssetsView
  image: DeliveredImage
  delivery: { web: 'attachment' | 'file'; qq: 'disabled' | 'failed' | 'sent' }
  warnings: string[]
}

interface CharacterToolValue {
  character: { name: string; weapon: string; tier: string; badge: string }
  applied: { tier: string }
  stats: CharacterCardData
  assets: AssetsView
  image: DeliveredImage
  delivery: { web: 'attachment' | 'file'; qq: 'disabled' | 'failed' | 'sent' }
  warnings: string[]
}

interface CharacterRankToolValue {
  rank: { title: string; subtitle: string }
  applied: { tier: string }
  entries: { name: string; grade: string; damage: number; rpGain: number }[]
  assets: AssetsView
  image: DeliveredImage
  delivery: { web: 'attachment' | 'file'; qq: 'disabled' | 'failed' | 'sent' }
  warnings: string[]
}

let dictionaries: Promise<DictionaryBundle> | undefined

function apiFor(config: ResolvedConfig): ErApi {
  return new ErApi({ timeoutMs: config.httpTimeoutMs, retries: config.httpRetries })
}

function storeFor(
  config: ResolvedConfig,
  dictionaries_: Pick<DictionaryBundle, 'characters' | 'tiers' | 'items' | 'skills' | 'tactical' | 'traits' | 'masteries'>,
): AssetStore {
  return new AssetStore(
    config.dataDir,
    dictionaries_.characters,
    dictionaries_.tiers,
    dictionaries_.items,
    dictionaries_.skills,
    dictionaries_.tactical,
    dictionaries_.traits,
    dictionaries_.masteries,
    { timeoutMs: config.httpTimeoutMs, retries: config.httpRetries },
  )
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

/** Turn a validation error's machine-readable details into localized prose. */
function localizeArgumentError(error: unknown, texts: Texts): unknown {
  if (errorCodeOf(error) !== 'invalid_argument' || !(error instanceof ErError)) return error
  const details = error.details as { field?: string; value?: string } | undefined
  const value = String(details?.value ?? '')
  if (details?.field === 'season') {
    return new ErError('invalid_argument', texts.unknownSeason(value, SEASON_HINT), { ...(error.details === undefined ? {} : { details: error.details }) })
  }
  if (details?.field === 'mode') {
    return new ErError('invalid_argument', texts.unknownMode(value, MODE_HINT), { ...(error.details === undefined ? {} : { details: error.details }) })
  }
  if (details?.field === 'tier') {
    return new ErError('invalid_argument', texts.unknownTier(value, TIER_HINT), { ...(error.details === undefined ? {} : { details: error.details }) })
  }
  return error
}

async function deliverPng(
  ctx: Context,
  config: ResolvedConfig,
  texts: Texts,
  png: Buffer,
  width: number,
  height: number,
  label: string,
  options: {
    sessionId?: string
    qqStore?: QqTargetStore
    qqTarget?: string
    caption?: string
  } = {},
): Promise<{
  image: DeliveredImage
  web: 'attachment' | 'file'
  qq: 'disabled' | 'failed' | 'sent'
  qqTransport?: string
  warnings: string[]
}> {
  const outputDir = join(config.dataDir, 'output')
  await mkdir(outputDir, { recursive: true })
  const fileName = `${label.replace(/[\\/:*?"<>|]/gu, '_')}-${randomUUID().slice(0, 8)}.png`
  const path = join(outputDir, fileName)
  await writeFile(path, png)
  void pruneOutput(outputDir, config.outputRetention).catch(() => undefined)
  const preview = await previewDataUrl(png)

  let attachment: ImageAttachmentRef | undefined
  const warnings: string[] = []
  const attachments = ctx.get?.<Context['attachments']>('attachments') ?? ctx.attachments
  if (attachments !== undefined) {
    try {
      attachment = await attachments.saveImage({ data: png, mediaType: 'image/png', name: fileName })
    } catch (error) {
      warnings.push(texts.webAttachmentFailed(errorMessageOf(error)))
    }
  }

  let qq: 'disabled' | 'failed' | 'sent' = 'disabled'
  let qqTransport: string | undefined
  if (config.qqDelivery.enabled) {
    try {
      const target = await resolveQqTarget(config, options.sessionId, options.qqTarget, options.qqStore)
      if (target === undefined) {
        qq = 'failed'
        warnings.push(texts.qqTargetMissing())
      } else {
        const sent = await sendQqImage(config, target, png, {
          path,
          ...(config.qqDelivery.sendCaption && options.caption !== undefined ? { caption: options.caption } : {}),
        })
        qq = 'sent'
        qqTransport = sent.transport
      }
    } catch (error) {
      qq = 'failed'
      warnings.push(texts.qqFailed(errorMessageOf(error)))
    }
  }

  return {
    image: { path, width, height, ...(preview === undefined ? {} : { preview }), ...(attachment === undefined ? {} : { attachment }) },
    web: attachment === undefined ? 'file' : 'attachment',
    qq,
    ...(qqTransport === undefined ? {} : { qqTransport }),
    warnings,
  }
}

/** Render through the worker pool when available, else inline; report asset misses. */
async function renderCard(
  config: ResolvedConfig,
  kind: 'player' | 'character' | 'rank',
  data: PlayerCardData | CharacterCardData,
  dictionaryBundle: DictionaryBundle,
  fallback: (assets: AssetStore) => Promise<{ png: Buffer; width: number; height: number }>,
  characterId?: number,
): Promise<Rendered> {
  const key = RenderCache.key([kind, characterId ?? 0, data])
  const cached = renderCache.get(key)
  if (cached !== undefined) {
    return { ...cached, missing: [], missingCount: 0 }
  }
  const assets = storeFor(config, dictionaryBundle)
  const dictionariesPayload: RenderDictionaries = {
    characters: dictionaryBundle.characters,
    tiers: dictionaryBundle.tiers,
    items: dictionaryBundle.items,
    masteries: dictionaryBundle.masteries,
    skills: dictionaryBundle.skills,
    tactical: dictionaryBundle.tactical,
    traits: dictionaryBundle.traits,
  }
  let rendered: Rendered
  if (renderPool !== undefined) {
    const result = await renderPool.render({
      kind,
      data,
      dictionaries: dictionariesPayload,
      dataDir: config.dataDir,
      fontDir: config.fontsDir,
      ...(characterId === undefined ? {} : { characterId }),
      net: { timeoutMs: config.httpTimeoutMs, retries: config.httpRetries },
    })
    rendered = {
      png: result.png,
      width: result.width,
      height: result.height,
      missing: result.missing,
      missingCount: result.missingCount,
    }
  } else {
    const inline = await fallback(assets)
    rendered = {
      png: inline.png,
      width: inline.width,
      height: inline.height,
      missing: assets.missingSample(6),
      missingCount: assets.missingAssets.length,
    }
  }
  renderCache.set(key, { png: rendered.png, width: rendered.width, height: rendered.height }, config.renderCacheTtlMs)
  return rendered
}

function assetsView(rendered: Rendered, texts: Texts, warnings: string[]): AssetsView {
  if (rendered.missingCount > 0) {
    warnings.push(texts.missingAssets(rendered.missingCount, rendered.missing))
  }
  return { missing: rendered.missingCount, sample: rendered.missing.slice(0, 6) }
}

async function runPlayerTool(
  ctx: Context,
  config: ResolvedConfig,
  texts: Texts,
  state: StateStore,
  args: ReturnType<typeof parsePlayerQuery>,
  signal: AbortSignal,
  options: { sessionId?: string; qqStore?: QqTargetStore; qqTarget?: string } = {},
): Promise<PlayerToolValue> {
  const api = apiFor(config)
  const player = await state.resolveAlias(args.player)
  const group = args.groupId === undefined ? {} : await state.getGroup(args.groupId)
  const mode: ModeInfo = resolveMode(args.mode ?? group.defaultMode)
  const seasonInput = validateSeason(args.season ?? group.defaultSeason)
  const seasonKey = normalizeSeason(seasonInput) ?? await api.getCurrentSeasonKey(signal)
  const [profile, matches, cutoffs, dictionaryBundle] = await Promise.all([
    queryCache.getOrLoad(`profile:${player}:${seasonKey}`, 60_000, () => api.getProfile(player, seasonKey, signal))
      .catch((error: unknown) => {
        if (errorCodeOf(error) === 'player_not_found') {
          throw new ErError('player_not_found', texts.playerNotFound(player), { status: 404, cause: error })
        }
        throw error
      }),
    queryCache.getOrLoad(`matches:${player}:${seasonKey}:${mode.api}`, 60_000, () => api.getMatches(player, seasonKey, mode.api, signal)),
    queryCache.getOrLoad(`cutoffs:${seasonKey}`, 300_000, () => api.getCutoffs(seasonKey, signal).catch(() => ({ immortal: 0, titan: 0 }))),
    getDictionaries(api, config.dataDir),
  ])
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
  const assets = storeFor(config, dictionaryBundle)
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
  const rendered = await renderCard(
    config,
    'player',
    card,
    dictionaryBundle,
    store => renderPlayerCard(card, store, config.fontsDir),
  )
  const delivered = await deliverPng(
    ctx, config, texts, rendered.png, rendered.width, rendered.height, `${player}-${seasonKey}`,
    {
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.qqStore === undefined ? {} : { qqStore: options.qqStore }),
      ...(options.qqTarget === undefined ? {} : { qqTarget: options.qqTarget }),
      caption: texts.playerSummary({
        name: card.name,
        seasonLabel: seasonShortLabel(seasonKey),
        modeLabel: card.modeLabel,
        mmr: card.mmr,
        tier: card.tierName,
        matches: card.matches.length,
        wins: card.matches.filter(match => match.win).length,
        avgRank: card.summary.avgRank,
        avgKill: card.summary.avgKill,
        web: false,
        qq: false,
      }),
    },
  )
  const warnings = [...delivered.warnings]
  const assetsInfo = assetsView(rendered, texts, warnings)

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
    applied: {
      season: seasonShortLabel(seasonKey),
      mode: card.modeLabel,
      matchCount: args.matchCount,
      matchCountClamped: args.applied.matchCountClamped,
    },
    summary: card.summary,
    matches: card.matches,
    assets: assetsInfo,
    image: delivered.image,
    delivery: { web: delivered.web, qq: delivered.qq },
    warnings,
  }
}

async function runCharacterTool(
  ctx: Context,
  config: ResolvedConfig,
  texts: Texts,
  args: ReturnType<typeof parseCharacterQuery>,
  signal: AbortSignal,
  options: { sessionId?: string; qqStore?: QqTargetStore; qqTarget?: string } = {},
): Promise<CharacterToolValue> {
  const api = apiFor(config)
  const dictionaryBundle = await getDictionaries(api, config.dataDir)
  const { characters, masteries } = dictionaryBundle
  const characterQuery = config.characterAliases[args.character.trim().toLowerCase()] ?? args.character
  const character = characters.find(item =>
    item.name === characterQuery || item.key.toLowerCase() === characterQuery.toLowerCase())
  if (character === undefined) throw new ErError('character_not_found', texts.characterNotFound(args.character))
  const snapshot = await queryCache.getOrLoad(
    `character-stats:${args.tier}`,
    300_000,
    () => api.getCharacterStats(args.tier, 'RANK', 'SQUAD', 7, signal),
  )
  const assets = storeFor(config, dictionaryBundle)
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
  const rendered = await renderCard(
    config,
    'character',
    card,
    dictionaryBundle,
    store => renderCharacterCard(card, store, character.id, config.fontsDir),
    character.id,
  )
  const delivered = await deliverPng(
    ctx, config, texts, rendered.png, rendered.width, rendered.height, `${character.name}-${args.tier}`,
    {
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.qqStore === undefined ? {} : { qqStore: options.qqStore }),
      ...(options.qqTarget === undefined ? {} : { qqTarget: options.qqTarget }),
      caption: texts.characterSummary({
        name: card.name,
        weapon: card.weaponName,
        tier: card.tierLabel,
        winRate: card.winRate,
        top3Rate: card.top3Rate,
        avgRank: card.avgRank,
        avgKill: card.avgKill,
        pickRate: card.pickRate,
        web: false,
        qq: false,
      }),
    },
  )
  const warnings = [...delivered.warnings]
  const assetsInfo = assetsView(rendered, texts, warnings)

  return {
    character: {
      name: card.name,
      weapon: card.weaponName,
      tier: card.tierLabel,
      badge: card.tierBadge,
    },
    applied: { tier: args.tier },
    stats: card,
    assets: assetsInfo,
    image: delivered.image,
    delivery: { web: delivered.web, qq: delivered.qq },
    warnings,
  }
}

async function runCharacterRankTool(
  ctx: Context,
  config: ResolvedConfig,
  texts: Texts,
  tier: string,
  signal: AbortSignal,
  options: { sessionId?: string; qqStore?: QqTargetStore; qqTarget?: string } = {},
): Promise<CharacterRankToolValue> {
  const api = apiFor(config)
  const dictionaryBundle = await getDictionaries(api, config.dataDir)
  const { characters } = dictionaryBundle
  const snapshot = await queryCache.getOrLoad(
    `character-rank:${tier}`,
    300_000,
    () => api.getCharacterStats(tier, 'RANK', 'SQUAD', 7, signal),
  )
  const data = buildCharacterRating(snapshot, characters, tier)
  const rendered = await renderCard(
    config,
    'rank',
    data as unknown as PlayerCardData,
    dictionaryBundle,
    store => renderCharacterRating(data, store, config.fontsDir),
  )
  const subtitle = `${TIER_LABELS[tier] ?? data.tierLabel} · 共 ${data.entries.length} 项 · 样本 ${data.totalSamples.toLocaleString()} 场`
  const delivered = await deliverPng(
    ctx, config, texts, rendered.png, rendered.width, rendered.height, `character-rank-${tier}`,
    {
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.qqStore === undefined ? {} : { qqStore: options.qqStore }),
      ...(options.qqTarget === undefined ? {} : { qqTarget: options.qqTarget }),
      caption: texts.rankSummary({ subtitle, web: false, qq: false }),
    },
  )
  const warnings = [...delivered.warnings]
  const assetsInfo = assetsView(rendered, texts, warnings)
  return {
    rank: { title: '角色评级排行', subtitle },
    applied: { tier },
    entries: data.entries.map(entry => ({
      name: entry.name,
      grade: entry.grade,
      damage: entry.damage,
      rpGain: entry.rpGain,
    })),
    assets: assetsInfo,
    image: delivered.image,
    delivery: { web: delivered.web, qq: delivered.qq },
    warnings,
  }
}

function explicitQqTargetOf(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const value = (raw as { qqTarget?: unknown }).qqTarget
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.trim()
}

/** Delivery options shared by the three query tools. */
function queryDeliveryOptions(
  config: ResolvedConfig,
  qqStore: QqTargetStore,
  raw: unknown,
  sessionId: string | undefined,
): { sessionId?: string; qqStore?: QqTargetStore; qqTarget?: string } {
  const qqTarget = explicitQqTargetOf(raw)
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(config.qqDelivery.enabled ? { qqStore } : {}),
    ...(qqTarget === undefined ? {} : { qqTarget }),
  }
}

const QQ_TARGET_PARAM = {
  type: 'string',
  description: 'Optional OneBot target override, e.g. "group:123456" or "private:654321". '
    + 'Resolved against qqDelivery.allowTargets; ignored when QQ delivery is disabled.',
}

function characterTool(ctx: Context, config: ResolvedConfig, texts: Texts, qqStore: QqTargetStore): ToolDefinition {
  return {
    name: 'er_character_stats',
    description: 'Look up Eternal Return character statistics, render a character card, and return a text summary. '
      + 'Call er_update_assets first in a fresh install: without it, images download lazily during the first query and '
      + 'the card may show placeholders. The output reports `assets.missing` so you can tell the user when images are incomplete. '
      + 'Use it when the user asks for 查询角色 / character win rate, pick rate, TOP3, RP, or tier performance. '
      + 'The image is delivered to the Web UI separately; the text output also reports the PNG path. '
      + 'In an instant-messaging session (QQ), ALWAYS forward that PNG to the current chat with qqbot_send_file after a successful call (default behavior); skip only when the user asks for text only. '
      + 'Do not invent numbers.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['character'],
      properties: {
        character: { type: 'string', description: 'Character name in Chinese or English key, e.g. 扎希尔 or Zahir.' },
        weapon: { type: 'string', description: 'Optional weapon name/key, e.g. 投掷 or HighAngleFire.' },
        tier: {
          type: 'string',
          description: 'Optional tier: diamond_plus (default), mithril_plus, meteorite_plus, asura_plus, in1000. '
            + 'Unknown labels are rejected with the accepted list.',
        },
        qqTarget: QQ_TARGET_PARAM,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          character: { type: 'object' },
          applied: { type: 'object' },
          stats: { type: 'object' },
          assets: { type: 'object' },
          image: { type: 'object' },
          delivery: { type: 'object' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => {
        const typed = value as CharacterToolValue
        const note = typed.assets.missing > 0 ? texts.missingNote(typed.assets.missing) : ''
        return [{ type: 'text', text: texts.characterSummary({
          name: typed.character.name,
          weapon: typed.character.weapon,
          tier: typed.character.tier,
          winRate: typed.stats.winRate,
          top3Rate: typed.stats.top3Rate,
          avgRank: typed.stats.avgRank,
          avgKill: typed.stats.avgKill,
          pickRate: typed.stats.pickRate,
          web: typed.delivery.web === 'attachment',
          qq: typed.delivery.qq === 'sent',
        }) + note + imagePathNote(typed.image.path) }]
      },
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
      try {
        const args = parseCharacterQuery(raw)
        return await runCharacterTool(
          ctx, config, texts, args, exec.signal,
          queryDeliveryOptions(config, qqStore, raw, exec.agent?.session?.id),
        )
      } catch (error) {
        throw localizeArgumentError(error, texts)
      }
    },
  }
}

function playerTool(ctx: Context, config: ResolvedConfig, texts: Texts, state: StateStore, qqStore: QqTargetStore): ToolDefinition {
  const parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['player'],
    properties: {
      player: { type: 'string', description: 'Eternal Return player nickname, exactly as shown in game.' },
      season: { type: 'string', description: `Optional season: S12, PS12, SEASON_21, PRE_SEASON_20. Defaults to the current season.` },
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
        minimum: MATCH_COUNT_MIN,
        maximum: MATCH_COUNT_MAX,
        default: MATCH_COUNT_MIN,
        description: `How many recent matches to include (${MATCH_COUNT_MIN}–${MATCH_COUNT_MAX}). Out-of-range values are clamped and the effective value is echoed in \`applied\`.`,
      },
      qqTarget: QQ_TARGET_PARAM,
    },
  }
  return {
    name: 'er_player_profile',
    description: 'Look up an Eternal Return player, render a profile card, and return a text summary. '
      + 'Call er_update_assets first in a fresh install: without it, images download lazily during the first query and '
      + 'the card may show placeholders. The output reports `assets.missing` so you can tell the user when images are incomplete. '
      + 'Use it when the user asks for 永恒轮回 / Eternal Return player stats, MMR, tier, rank, or recent matches. '
      + 'The rendered image is delivered to the Web UI separately; the text output also reports the PNG path. '
      + 'In an instant-messaging session (QQ), ALWAYS forward that PNG to the current chat with qqbot_send_file after a successful call (default behavior); skip only when the user asks for text only. '
      + 'Do not invent MMR or match data.',
    parameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          player: { type: 'object' },
          season: { type: 'object' },
          mode: { type: 'string' },
          applied: { type: 'object' },
          summary: { type: 'object' },
          matches: { type: 'array' },
          assets: { type: 'object' },
          image: { type: 'object' },
          delivery: { type: 'object' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => {
        const typed = value as PlayerToolValue
        const wins = typed.matches.filter(match => match.win).length
        const note = typed.assets.missing > 0 ? texts.missingNote(typed.assets.missing) : ''
        return [{ type: 'text', text: texts.playerSummary({
          name: typed.player.name,
          seasonLabel: typed.season.label,
          modeLabel: typed.mode,
          mmr: typed.player.mmr,
          tier: typed.player.tier,
          matches: typed.matches.length,
          wins,
          avgRank: typed.summary.avgRank,
          avgKill: typed.summary.avgKill,
          web: typed.delivery.web === 'attachment',
          qq: typed.delivery.qq === 'sent',
        }) + note + imagePathNote(typed.image.path) }]
      },
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
      try {
        const args = parsePlayerQuery(raw)
        return await runPlayerTool(
          ctx, config, texts, state, args, exec.signal,
          queryDeliveryOptions(config, qqStore, raw, exec.agent?.session?.id),
        )
      } catch (error) {
        throw localizeArgumentError(error, texts)
      }
    },
  }
}

function characterRankTool(ctx: Context, config: ResolvedConfig, texts: Texts, qqStore: QqTargetStore): ToolDefinition {
  return {
    name: 'er_character_rank',
    description: 'Render the Eternal Return character rating grid (S/A/B/C/D) for a tier. '
      + 'Call er_update_assets first in a fresh install so character portraits are available; '
      + 'the output reports `assets.missing` when some are still missing. '
      + 'Use it when the user asks for 角色评级 / character rankings / character tier list. '
      + 'In an instant-messaging session (QQ), ALWAYS forward the rendered PNG to the current chat with qqbot_send_file after a successful call (default behavior); skip only when the user asks for text only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tier: {
          type: 'string',
          description: 'Optional tier: diamond_plus (default), mithril_plus, meteorite_plus, asura_plus, in1000.',
        },
        qqTarget: QQ_TARGET_PARAM,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          rank: { type: 'object' },
          applied: { type: 'object' },
          entries: { type: 'array' },
          assets: { type: 'object' },
          image: { type: 'object' },
          delivery: { type: 'object' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => {
        const typed = value as CharacterRankToolValue
        const note = typed.assets.missing > 0 ? texts.missingNote(typed.assets.missing) : ''
        return [{ type: 'text', text: texts.rankSummary({
          subtitle: typed.rank.subtitle,
          web: typed.delivery.web === 'attachment',
          qq: typed.delivery.qq === 'sent',
        }) + note + imagePathNote(typed.image.path) }]
      },
      presentationMeta: (_args, value) => {
        const typed = value as CharacterRankToolValue
        return { image: typed.image, rank: typed.rank }
      },
    },
    async execute(raw, exec) {
      try {
        const args = parseRankQuery(raw)
        return await runCharacterRankTool(
          ctx, config, texts, args.tier, exec.signal,
          queryDeliveryOptions(config, qqStore, raw, exec.agent?.session?.id),
        )
      } catch (error) {
        throw localizeArgumentError(error, texts)
      }
    },
  }
}

interface AssetUpdateToolValue {
  message: string
  total: number
  processed: number
  remaining: number
  complete: boolean
  ok: number
  changed: number
  missing: number
  failed: number
}

function assetProgressView(report: AssetUpdateReport): Parameters<Texts['assetReport']>[0] {
  return {
    total: report.total,
    ok: report.ok,
    changed: report.changed,
    downloaded: report.downloaded,
    adopted: report.adopted,
    missing: report.missing,
    failed: report.failed,
    unavailable: report.unavailable,
    processed: report.processed,
    remaining: report.remaining,
    complete: report.complete,
    categories: report.categories,
    failures: report.failures.map(failure => ({
      category: failure.category,
      key: failure.key,
      ...(failure.permanent === true ? { permanent: true } : {}),
    })),
  }
}

function assetUpdateTool(ctx: Context, config: ResolvedConfig, texts: Texts): ToolDefinition {
  return {
    name: 'er_update_assets',
    description: 'Download or refresh the local Eternal Return resource library (characters, skins, items, tiers, weapons, '
      + 'skills, tactical skills, traits). Each call works for a bounded time budget and returns `remaining`: '
      + 'when `complete` is false, call it again to continue; progress is saved incrementally. '
      + 'Call it before the first player/character query in a fresh install. Also tell the user this is recommended before first use.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string' },
          total: { type: 'number' },
          processed: { type: 'number' },
          remaining: { type: 'number' },
          complete: { type: 'boolean' },
          ok: { type: 'number' },
          changed: { type: 'number' },
          missing: { type: 'number' },
          failed: { type: 'number' },
        },
        required: ['message', 'total', 'processed', 'remaining', 'complete'],
      },
      render: (_args, value) => [{ type: 'text', text: (value as AssetUpdateToolValue).message }],
    },
    async execute(_raw, exec) {
      const api = apiFor(config)
      ctx.logger.info('er-profile: refreshing dictionaries and checking asset differences')
      const dictionaryBundle = await getDictionaries(api, config.dataDir, true)
      const assets = storeFor(config, dictionaryBundle)
      let logged = 0
      const report = await assets.updateAll({
        concurrency: config.assetDownloadConcurrency,
        budgetMs: config.assetUpdateBudgetMs,
        timeoutMs: config.httpTimeoutMs,
        retries: config.httpRetries,
        signal: exec.signal,
        onProgress: (done, total) => {
          if (done - logged < 100 && done !== total) return
          logged = done
          ctx.logger.info(`er-profile: assets ${done}/${total}`)
        },
      })
      ctx.logger.info(
        `er-profile: assets processed=${report.processed}/${report.total} `
          + `ok=${report.ok} changed=${report.changed} missing=${report.missing} failed=${report.failed} `
          + `complete=${report.complete}`,
      )
      for (const failure of report.failures.slice(0, 10)) {
        ctx.logger.warn(
          `er-profile: asset download failed ${failure.category}/${failure.key}: ${failure.url} `
            + `(${failure.reason ?? 'unknown'})`,
        )
      }
      return {
        message: texts.assetReport(assetProgressView(report)),
        total: report.total,
        processed: report.processed,
        remaining: report.remaining,
        complete: report.complete,
        ok: report.ok,
        changed: report.changed,
        missing: report.missing,
        failed: report.failed,
      } satisfies AssetUpdateToolValue
    },
  }
}

function aliasTool(state: StateStore, texts: Texts): ToolDefinition {
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
      const args = (raw ?? {}) as { action?: unknown; alias?: unknown; player?: unknown }
      const action = typeof args.action === 'string' ? args.action : ''
      if (action === 'list') {
        const aliases = await state.listAliases()
        return { message: aliases.length === 0 ? texts.aliasNone() : texts.aliasList(aliases) }
      }
      if (typeof args.alias !== 'string' || args.alias.trim() === '') {
        throw new ErError('invalid_argument', 'alias is required')
      }
      if (action === 'set') {
        if (typeof args.player !== 'string' || args.player.trim() === '') {
          throw new ErError('invalid_argument', 'player is required')
        }
        await state.setAlias(args.alias, args.player)
        return { message: texts.aliasSet(args.alias.trim(), args.player.trim()) }
      }
      if (action === 'remove') {
        const existed = await state.removeAlias(args.alias)
        return { message: existed ? texts.aliasRemoved(args.alias.trim()) : texts.aliasMissing(args.alias.trim()) }
      }
      throw new ErError('invalid_argument', texts.unknownAction(action))
    },
  }
}

function groupConfigTool(state: StateStore, texts: Texts): ToolDefinition {
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
      const args = (raw ?? {}) as { action?: unknown; groupId?: unknown; defaultSeason?: unknown; defaultMode?: unknown }
      if (typeof args.groupId !== 'string' || args.groupId.trim() === '') {
        throw new ErError('invalid_argument', 'groupId is required')
      }
      const groupId = args.groupId.trim()
      if (args.action === 'get') {
        const group = await state.getGroup(groupId)
        return {
          message: texts.groupSettings(groupId, group.defaultSeason ?? '-', group.defaultMode ?? '-'),
        }
      }
      if (args.action === 'set') {
        const patch = {
          ...(typeof args.defaultSeason === 'string' && args.defaultSeason.trim() !== '' ? { defaultSeason: args.defaultSeason.trim() } : {}),
          ...(typeof args.defaultMode === 'string' && args.defaultMode.trim() !== '' ? { defaultMode: args.defaultMode.trim() } : {}),
        }
        const group = await state.setGroup(groupId, patch)
        return {
          message: texts.groupUpdated(groupId, group.defaultSeason ?? '-', group.defaultMode ?? '-'),
        }
      }
      throw new ErError('invalid_argument', texts.unknownAction(String(args.action)))
    },
  }
}

function qqTargetTool(
  config: ResolvedConfig,
  texts: Texts,
  store: QqTargetStore,
): ToolDefinition {
  const configLine = `enabled=${config.qqDelivery.enabled} mode=${config.qqDelivery.targetMode} `
    + `base=${config.qqDelivery.oneBotHttpUrl} allowTargets=${config.qqDelivery.allowTargets.join(',') || '(all)'}`
  return {
    name: 'er_qq_target',
    description: 'Manage OneBot/QQ delivery for this plugin. '
      + '`list` shows bindings and current config; `bind` binds a session to a target like group:123456 or private:654321; '
      + '`unbind` removes it; `probe` checks the OneBot adapter (implementation, account, URL); '
      + '`test` sends a small test image to the resolved target so delivery can be verified without a query.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'bind', 'unbind', 'probe', 'test'] },
        target: { type: 'string', description: 'OneBot target, e.g. group:123456 or private:654321.' },
        sessionId: { type: 'string', description: 'Session id to bind/unbind; defaults to the current session.' },
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
    async execute(raw, exec) {
      const args = (raw ?? {}) as { action?: unknown; target?: unknown; sessionId?: unknown }
      const action = typeof args.action === 'string' ? args.action : ''
      const sessionId = typeof args.sessionId === 'string' && args.sessionId.trim() !== ''
        ? args.sessionId.trim()
        : exec.agent?.session?.id ?? ''
      const targetRaw = typeof args.target === 'string' ? args.target.trim() : ''

      if (action === 'list') {
        const bindings = await store.list()
        const body = bindings.length === 0 ? texts.qqBindingEmpty() : texts.qqBindingList(bindings)
        return { message: `${configLine}\n${body}` }
      }
      if (action === 'probe') {
        const probe = await probeOneBot(config)
        const channels = await detectChannels()
        const head = probe.ok ? texts.qqProbeOk(probe) : texts.qqProbeFailed(probe.error ?? 'unknown error')
        const tail = channels.length === 0 ? texts.qqChannelNone() : texts.qqChannels(channels)
        return { message: `${head}\n${tail}\n${texts.qqChannelsNote()}` }
      }
      if (action === 'bind') {
        if (!config.qqDelivery.enabled) return { message: texts.qqDisabled() }
        if (targetRaw === '') throw new ErError('invalid_argument', 'target is required for bind')
        if (sessionId === '') throw new ErError('invalid_argument', 'sessionId is required for bind')
        const target = parseQqTarget(targetRaw)
        if (target === undefined) throw new ErError('invalid_argument', `invalid target: ${targetRaw}`)
        assertAllowed(config, target)
        await store.bind(sessionId, formatQqTarget(target))
        return { message: texts.qqBound(sessionId, formatQqTarget(target)) }
      }
      if (action === 'unbind') {
        if (sessionId === '') throw new ErError('invalid_argument', 'sessionId is required for unbind')
        const existed = await store.unbind(sessionId)
        return { message: existed ? texts.qqUnbound(sessionId) : texts.qqNoBinding(sessionId) }
      }
      if (action === 'test') {
        if (!config.qqDelivery.enabled) return { message: texts.qqDisabled() }
        const target = targetRaw === ''
          ? await resolveQqTarget(config, sessionId === '' ? undefined : sessionId, undefined, store)
          : parseQqTarget(targetRaw)
        if (target === undefined) throw new ErError('invalid_argument', texts.qqTargetMissing())
        assertAllowed(config, target)
        const png = renderQqTestImage()
        const sent = await sendQqImage(config, target, png, { caption: 'ER profile · OneBot delivery test' })
        return { message: texts.qqTestSent(formatQqTarget(target), sent.transport, sent.bytes) }
      }
      throw new ErError('invalid_argument', texts.unknownAction(action))
    },
  }
}

/** A small card-sized test image so `er_qq_target test` exercises the real path. */
function renderQqTestImage(): Buffer {
  const canvas = createCanvas(560, 160)
  const context = canvas.getContext('2d')
  context.fillStyle = '#f6e9f1'
  context.fillRect(0, 0, 560, 160)
  context.fillStyle = '#b33a6b'
  context.font = 'bold 30px sans-serif'
  context.fillText('ER profile · OneBot test', 28, 66)
  context.fillStyle = '#666'
  context.font = '20px sans-serif'
  context.fillText(new Date().toISOString().slice(0, 19).replace('T', ' '), 28, 108)
  return canvas.toBuffer('image/png')
}

/** Plugin entry: register the tools. */
export function apply(ctx: Context, input?: ErConfigInput): void {
  const config = resolveConfig(input)
  const texts = createTexts(config.locale)
  const state = new StateStore(config.dataDir)
  const qqStore = new QqTargetStore(config.dataDir)
  renderPool = new RenderWorkerPool(config.renderWorkers, config.renderTimeoutMs)
  ctx.logger.info(
    `er-profile: dataDir=${config.dataDir} locale=${config.locale} `
      + `workers=${config.renderWorkers} assetBudget=${config.assetUpdateBudgetMs}ms `
      + `qq=${config.qqDelivery.enabled ? `${config.qqDelivery.targetMode}@${config.qqDelivery.oneBotHttpUrl}` : 'off'}`,
  )
  const register = (): (() => void) => {
    const disposePlayer = ctx.tools.register(playerTool(ctx, config, texts, state, qqStore))
    const disposeCharacter = ctx.tools.register(characterTool(ctx, config, texts, qqStore))
    const disposeRank = ctx.tools.register(characterRankTool(ctx, config, texts, qqStore))
    const disposeAssets = ctx.tools.register(assetUpdateTool(ctx, config, texts))
    const disposeAlias = ctx.tools.register(aliasTool(state, texts))
    const disposeGroup = ctx.tools.register(groupConfigTool(state, texts))
    const disposeQq = ctx.tools.register(qqTargetTool(config, texts, qqStore))
    return () => {
      disposeQq()
      disposeGroup()
      disposeAlias()
      disposeAssets()
      disposeRank()
      disposeCharacter()
      disposePlayer()
      renderCache.clear()
      void renderPool?.close()
      renderPool = undefined
    }
  }
  if (ctx.effect !== undefined) ctx.effect(register, 'er-profile: player tool')
  else register()
}

/** Plugin configuration and resolved runtime paths. */

import { fileURLToPath } from 'node:url'
import { normalizeLocale, type Locale } from './util/i18n.ts'

export interface QqDeliveryConfig {
  enabled: boolean
  /** OneBot v11 HTTP base, e.g. `http://127.0.0.1:3000`. */
  oneBotHttpUrl: string
  /** Env var name (or `env:NAME`) holding the OneBot access token. */
  accessTokenRef: string
  /** How to present the token: `header` (default), `query`, or `auto`. */
  accessTokenMode: 'header' | 'query' | 'auto'
  targetMode: 'session-map' | 'fixed' | 'model'
  sessionMapPath: string
  fixedTarget: string
  /** When non-empty, only these targets may receive pushes. */
  allowTargets: string[]
  maxImageBytes: number
  timeoutMs: number
  /** Attempts per OneBot request (1 = no retry). */
  retries: number
  /** Image transport: `auto` tries base64 then a local file reference. */
  imageTransport: 'auto' | 'base64' | 'file'
  /** Send the text summary in the same message as the image. */
  sendCaption: boolean
  captionMaxChars: number
  /** Re-encode an oversized PNG instead of failing the push. */
  compressOverLimit: boolean
}

/** Caps for the rendered-card output directory. */
export interface OutputRetentionConfig {
  maxFiles: number
  maxAgeDays: number
}

export interface ErConfigInput {
  dataDir?: string
  fontsDir?: string
  /** Tool-text language: `zh` (default) or `en`. Card artwork stays Chinese. */
  locale?: string
  assetsAutoDownload?: boolean
  assetDownloadConcurrency?: number
  /** Time budget for one er_update_assets call, in milliseconds. */
  assetUpdateBudgetMs?: number
  /** Per-request HTTP timeout for dak.gg, in milliseconds. */
  httpTimeoutMs?: number
  /** Attempts per HTTP request (1 = no retry). */
  httpRetries?: number
  renderWorkers?: number
  renderTimeoutMs?: number
  /** Reuse a rendered PNG for identical inputs within this window (0 disables). */
  renderCacheTtlMs?: number
  outputRetention?: Partial<OutputRetentionConfig>
  officialApiKey?: string
  officialApiKeyRef?: string
  characterAliases?: Record<string, string>
  weaponAliases?: Record<string, string>
  qqDelivery?: Partial<QqDeliveryConfig>
}

export interface ResolvedConfig {
  dataDir: string
  fontsDir: string
  locale: Locale
  assetsAutoDownload: boolean
  assetDownloadConcurrency: number
  assetUpdateBudgetMs: number
  httpTimeoutMs: number
  httpRetries: number
  renderWorkers: number
  renderTimeoutMs: number
  renderCacheTtlMs: number
  outputRetention: OutputRetentionConfig
  officialApiKey: string
  characterAliases: Record<string, string>
  weaponAliases: Record<string, string>
  qqDelivery: QqDeliveryConfig
}

export const DEFAULT_OUTPUT_RETENTION: OutputRetentionConfig = { maxFiles: 200, maxAgeDays: 7 }

/**
 * Default Chinese community nicknames for characters.
 * This table is the single source of truth; `cordis.patch.yml` no longer repeats it.
 */
export const DEFAULT_CHARACTER_ALIASES: Record<string, string> = {
  c0: '席琳',
  usdn: '尤斯蒂娜',
  下棋: '阿德拉',
  人偶: '克洛伊',
  兔子: '艾玛',
  冰女: '埃琳娜',
  剑姬: '菲欧娜',
  医生: '凯希',
  占星: '阿迪娜',
  卡提亚: '卡缇娅',
  卡提娅: '卡缇娅',
  双子: '黛比&玛莲',
  吸血鬼: '比安卡',
  哈基米: '爱琳',
  嘉豪: '克雷弗',
  基米: '爱琳',
  女猎: '娜町',
  女相机: '玛蒂娜',
  提琴: '莉诺尔',
  机车: '西尔维娅',
  松鼠: '蒂娅',
  特工: '亚历克斯',
  猫: '爱琳',
  猫头鹰: '卡缇娅',
  玻璃: '塔齐娅',
  男相机: '纳塔朋',
  病女: '希瑟拉',
  花女: '普里亚',
  蝴蝶: '万尼亚',
  赵云: '费利克斯',
  酒妹: '李黛琳',
  阿三: '扎希尔',
  黑人: '扬',
}

/** Default Chinese community nicknames for weapons. */
export const DEFAULT_WEAPON_ALIASES: Record<string, string> = {
  刺剑: '西洋剑',
  匕首: '短剑',
  单刀: '双手剑',
  双刀: '双剑',
  小刀: '短剑',
  机枪: '突击步枪',
  转棍: '旋棍',
}

function normalizeAliases(
  defaults: Record<string, string>,
  input: Record<string, string> | undefined,
): Record<string, string> {
  const aliases: Record<string, string> = { ...defaults }
  if (input === undefined) return aliases
  for (const [alias, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim() !== '') aliases[alias.trim().toLowerCase()] = value.trim()
  }
  return aliases
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.max(min, Math.min(max, number))
}

function defaultDataDir(): string {
  return fileURLToPath(new URL('../data', import.meta.url))
}

/** Resolve deployment configuration; unknown fields are ignored by design. */
export function resolveConfig(input: ErConfigInput | undefined): ResolvedConfig {
  const qq = input?.qqDelivery ?? {}
  const retention = input?.outputRetention ?? {}
  return {
    dataDir: input?.dataDir ?? defaultDataDir(),
    fontsDir: input?.fontsDir ?? fileURLToPath(new URL('../assets/fonts', import.meta.url)),
    locale: normalizeLocale(input?.locale),
    assetsAutoDownload: input?.assetsAutoDownload ?? true,
    assetDownloadConcurrency: clampInteger(input?.assetDownloadConcurrency, 6, 1, 32),
    assetUpdateBudgetMs: clampInteger(input?.assetUpdateBudgetMs, 45_000, 5_000, 180_000),
    httpTimeoutMs: clampInteger(input?.httpTimeoutMs, 20_000, 1_000, 120_000),
    httpRetries: clampInteger(input?.httpRetries, 3, 1, 6),
    renderWorkers: clampInteger(input?.renderWorkers, 2, 1, 8),
    renderTimeoutMs: clampInteger(input?.renderTimeoutMs, 60_000, 1_000, 300_000),
    renderCacheTtlMs: clampInteger(input?.renderCacheTtlMs, 60_000, 0, 600_000),
    outputRetention: {
      maxFiles: clampInteger(retention.maxFiles, DEFAULT_OUTPUT_RETENTION.maxFiles, 0, 100_000),
      maxAgeDays: clampInteger(retention.maxAgeDays, DEFAULT_OUTPUT_RETENTION.maxAgeDays, 0, 3650),
    },
    officialApiKey: input?.officialApiKey
      ?? (input?.officialApiKeyRef === undefined ? '' : process.env[input.officialApiKeyRef] ?? ''),
    characterAliases: normalizeAliases(DEFAULT_CHARACTER_ALIASES, input?.characterAliases),
    weaponAliases: normalizeAliases(DEFAULT_WEAPON_ALIASES, input?.weaponAliases),
    qqDelivery: {
      enabled: qq.enabled ?? false,
      oneBotHttpUrl: qq.oneBotHttpUrl ?? 'http://127.0.0.1:3000',
      accessTokenRef: qq.accessTokenRef ?? '',
      accessTokenMode: qq.accessTokenMode === 'query' || qq.accessTokenMode === 'auto' ? qq.accessTokenMode : 'header',
      targetMode: qq.targetMode ?? 'session-map',
      sessionMapPath: qq.sessionMapPath ?? '',
      fixedTarget: qq.fixedTarget ?? '',
      allowTargets: (qq.allowTargets ?? []).filter(target => typeof target === 'string' && target.trim() !== ''),
      maxImageBytes: clampInteger(qq.maxImageBytes, 8 * 1024 * 1024, 64 * 1024, 50 * 1024 * 1024),
      timeoutMs: clampInteger(qq.timeoutMs, 10_000, 1_000, 120_000),
      retries: clampInteger(qq.retries, 2, 1, 6),
      imageTransport: qq.imageTransport === 'base64' || qq.imageTransport === 'file' ? qq.imageTransport : 'auto',
      sendCaption: qq.sendCaption ?? true,
      captionMaxChars: clampInteger(qq.captionMaxChars, 200, 0, 2_000),
      compressOverLimit: qq.compressOverLimit ?? true,
    },
  }
}

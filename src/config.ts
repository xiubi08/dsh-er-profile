/** Plugin configuration and resolved runtime paths. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface QqDeliveryConfig {
  enabled: boolean
  oneBotHttpUrl: string
  accessTokenRef: string
  targetMode: 'session-map' | 'fixed' | 'model'
  sessionMapPath: string
  fixedTarget: string
  allowTargets: string[]
  maxImageBytes: number
  timeoutMs: number
}

export interface ErConfigInput {
  dataDir?: string
  fontsDir?: string
  assetsAutoDownload?: boolean
  renderWorkers?: number
  renderTimeoutMs?: number
  officialApiKey?: string
  officialApiKeyRef?: string
  characterAliases?: Record<string, string>
  weaponAliases?: Record<string, string>
  qqDelivery?: Partial<QqDeliveryConfig>
}

export interface ResolvedConfig {
  dataDir: string
  fontsDir: string
  assetsAutoDownload: boolean
  renderWorkers: number
  renderTimeoutMs: number
  officialApiKey: string
  characterAliases: Record<string, string>
  weaponAliases: Record<string, string>
  qqDelivery: QqDeliveryConfig
}

/** Default Chinese community nicknames for characters. */
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

function defaultDataDir(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'er-profile')
}

/** Resolve deployment configuration; unknown fields are ignored by design. */
export function resolveConfig(input: ErConfigInput | undefined): ResolvedConfig {
  const qq = input?.qqDelivery ?? {}
  return {
    dataDir: input?.dataDir ?? defaultDataDir(),
    fontsDir: input?.fontsDir ?? fileURLToPath(new URL('../assets/fonts', import.meta.url)),
    assetsAutoDownload: input?.assetsAutoDownload ?? true,
    renderWorkers: Math.max(1, input?.renderWorkers ?? 1),
    renderTimeoutMs: Math.max(1_000, input?.renderTimeoutMs ?? 60_000),
    officialApiKey: input?.officialApiKey
      ?? (input?.officialApiKeyRef === undefined ? '' : process.env[input.officialApiKeyRef] ?? ''),
    characterAliases: normalizeAliases(DEFAULT_CHARACTER_ALIASES, input?.characterAliases),
    weaponAliases: normalizeAliases(DEFAULT_WEAPON_ALIASES, input?.weaponAliases),
    qqDelivery: {
      enabled: qq.enabled ?? false,
      oneBotHttpUrl: qq.oneBotHttpUrl ?? 'http://127.0.0.1:3000',
      accessTokenRef: qq.accessTokenRef ?? '',
      targetMode: qq.targetMode ?? 'session-map',
      sessionMapPath: qq.sessionMapPath ?? '',
      fixedTarget: qq.fixedTarget ?? '',
      allowTargets: qq.allowTargets ?? [],
      maxImageBytes: qq.maxImageBytes ?? 8 * 1024 * 1024,
      timeoutMs: qq.timeoutMs ?? 10_000,
    },
  }
}

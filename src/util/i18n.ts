/** Supported tool-text locales. Card artwork itself stays Chinese (its layout is fixed). */

export type Locale = 'zh' | 'en'

export const LOCALES: readonly Locale[] = ['zh', 'en']

export function normalizeLocale(input: string | undefined): Locale {
  const value = (input ?? '').trim().toLowerCase()
  return value === 'en' || value === 'en-us' || value === 'en_us' ? 'en' : 'zh'
}

export interface PlayerSummaryView {
  name: string
  seasonLabel: string
  modeLabel: string
  mmr: number
  tier: string
  matches: number
  wins: number
  avgRank: number
  avgKill: number
  web: boolean
  qq: boolean
}

export interface CharacterSummaryView {
  name: string
  weapon: string
  tier: string
  winRate: number
  top3Rate: number
  avgRank: number
  avgKill: number
  pickRate: number
  web: boolean
  qq: boolean
}

export interface RankSummaryView {
  subtitle: string
  web: boolean
  qq: boolean
}

export interface AssetProgressView {
  total: number
  ok: number
  changed: number
  downloaded: number
  adopted: number
  missing: number
  failed: number
  /** Subset of `failed` made of 404s (phantom dictionary entries). */
  unavailable: number
  processed: number
  remaining: number
  complete: boolean
  categories: { key: string; total: number; ok: number; changed: number; missing: number }[]
  failures: { category: string; key: string; permanent?: boolean }[]
}

export interface Texts {
  playerSummary(view: PlayerSummaryView): string
  characterSummary(view: CharacterSummaryView): string
  rankSummary(view: RankSummaryView): string
  assetReport(view: AssetProgressView): string
  assetCategoryLabel(key: string): string
  missingAssets(count: number, sample: string[]): string
  /** Short note appended to a summary when the card had to draw placeholder blocks. */
  missingNote(count: number): string
  webAttachmentFailed(message: string): string
  qqTargetMissing(): string
  qqFailed(message: string): string
  qqDisabled(): string
  qqProbeOk(probe: { base: string; implementation: string; appName: string; appVersion: string; userId: string; nickname: string; source: string }): string
  qqChannels(items: { name: string; detail: string }[]): string
  qqChannelNone(): string
  qqChannelsNote(): string
  qqProbeFailed(message: string): string
  qqBindingList(items: { sessionId: string; target: string }[]): string
  qqBindingEmpty(): string
  qqBound(sessionId: string, target: string): string
  qqUnbound(sessionId: string): string
  qqNoBinding(sessionId: string): string
  qqTestSent(target: string, transport: string, bytes: number): string
  qqTargetNotAllowed(target: string, allowed: string[]): string
  aliasList(items: { alias: string; player: string }[]): string
  aliasNone(): string
  aliasSet(alias: string, player: string): string
  aliasRemoved(alias: string): string
  aliasMissing(alias: string): string
  groupSettings(groupId: string, season: string, mode: string): string
  groupUpdated(groupId: string, season: string, mode: string): string
  unknownAction(action: string): string
  playerNotFound(player: string): string
  characterNotFound(character: string): string
  invalidArgument(detail: string): string
  unknownSeason(value: string, examples: string): string
  unknownMode(value: string, allowed: string): string
  unknownTier(value: string, allowed: string): string
  aborted(): string
}

const CATEGORY_LABELS_ZH: Record<string, string> = {
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

const CATEGORY_LABELS_EN: Record<string, string> = {
  characters: 'characters',
  character_skins: 'skins',
  items: 'items',
  tiers: 'tier icons',
  tiers_full: 'tier art',
  tactical_skills: 'tactical skills',
  trait_skills: 'trait skills',
  masteries: 'masteries',
  skills: 'skills',
}

function deliverySuffixZh(view: { web: boolean; qq: boolean }): string {
  const web = view.web ? '，并已显示在 Web 中' : ''
  const qq = view.qq ? '，并已发送到 QQ' : ''
  return `${web}${qq}`
}

function deliverySuffixEn(view: { web: boolean; qq: boolean }): string {
  const web = view.web ? ', shown in the Web UI' : ''
  const qq = view.qq ? ', sent to QQ' : ''
  return `${web}${qq}`
}

const zh: Texts = {
  playerSummary: view =>
    `${view.name} · ${view.seasonLabel} ${view.modeLabel}：MMR ${view.mmr}，${view.tier}；`
    + `近 ${view.matches} 场 ${view.wins} 胜，平均排名 ${view.avgRank.toFixed(2)}，`
    + `平均击杀 ${view.avgKill.toFixed(2)}。战绩图已生成${deliverySuffixZh(view)}。`,
  characterSummary: view =>
    `${view.name} · ${view.weapon} | ${view.tier}：`
    + `胜率 ${view.winRate.toFixed(1)}%，TOP3 ${view.top3Rate.toFixed(1)}%，`
    + `平均排名 #${view.avgRank.toFixed(2)}，平均击杀 ${view.avgKill.toFixed(2)}，`
    + `选择率 ${view.pickRate.toFixed(2)}%。角色数据图已生成${deliverySuffixZh(view)}。`,
  rankSummary: view =>
    `角色评级排行 · ${view.subtitle}。评级图已生成${deliverySuffixZh(view)}。`,
  assetReport: view => {
    const transientFailed = Math.max(0, view.failed - view.unavailable)
    const lines = [
      view.complete
        ? `资源库已更新：共 ${view.total} 项；正常 ${view.ok}，`
          + `变更 ${view.changed}（重下 ${view.downloaded}，仅更新 URL ${view.adopted}），`
          + `缺失 ${view.missing}，失败 ${transientFailed}。`
        : `资源库更新进行中：本轮处理 ${view.processed}/${view.total} 项，剩余 ${view.remaining} 项；`
          + `正常 ${view.ok}，变更 ${view.changed}，缺失 ${view.missing}，失败 ${transientFailed}。`
          + '再调用一次 er_update_assets 可继续。',
    ]
    for (const category of view.categories) {
      if (category.total === 0) continue
      lines.push(
        `${CATEGORY_LABELS_ZH[category.key] ?? category.key}：`
          + `正常 ${category.ok} | 变更 ${category.changed} | 缺失 ${category.missing}`,
      )
    }
    if (view.failed > 0) {
      const transient = view.failures.filter(failure => failure.permanent !== true)
      if (transient.length > 0) {
        const shown = transient.slice(0, 5)
          .map(failure => `${CATEGORY_LABELS_ZH[failure.category] ?? failure.category} #${failure.key}`)
        const suffix = transient.length > shown.length ? ` 等 ${transient.length} 项` : ''
        lines.push(`失败：${shown.join('、')}${suffix}，下次更新会重试。`)
      }
      if (view.unavailable > 0) {
        lines.push(`另有 ${view.unavailable} 项在 CDN 上不可用（HTTP 4xx，上游字典里的占位条目），可忽略。`)
      }
    }
    return lines.join('\n')
  },
  assetCategoryLabel: key => CATEGORY_LABELS_ZH[key] ?? key,
  missingAssets: (count, sample) =>
    `有 ${count} 项游戏资源未能下载（${sample.join('、')}${sample.length < count ? ' 等' : ''}），`
    + '图片对应位置显示为占位块。运行 er_update_assets 可补全。',
  missingNote: count => `\n注意：卡面有 ${count} 张图片缺失（显示为占位块），可再运行一次 er_update_assets 补齐。`,
  webAttachmentFailed: message => `Web attachment failed: ${message}`,
  qqTargetMissing: () => 'QQ 推送失败：未找到当前会话的 QQ 目标',
  qqFailed: message => `QQ 推送失败：${message}`,
  qqDisabled: () => 'QQ 推送未启用（qqDelivery.enabled = false）。',
  qqProbeOk: probe =>
    `OneBot 可用：${probe.implementation}（${probe.appName} ${probe.appVersion}），`
    + `账号 ${probe.nickname || '-'}(${probe.userId || '-'})，地址 ${probe.base}（来源 ${probe.source}）。`,
  qqChannels: items => `检测到其它 QQ 通道：\n${items.map(item => `- ${item.name}：${item.detail}`).join('\n')}`,
  qqChannelNone: () => '未检测到 qq-bridge / dsh-qqbot / SnowLuma。',
  qqChannelsNote: () => '说明：qq-bridge / dsh-qqbot 目前只能发文本，图片仍由本插件直连 OneBot 推送；QQ 官方通道已停用主动消息，无法用它推图。',
  qqProbeFailed: message => `OneBot 探测失败：${message}`,
  qqBindingList: items => `已绑定 ${items.length} 个会话：\n${items.map(item => `${item.sessionId} → ${item.target}`).join('\n')}`,
  qqBindingEmpty: () => '当前没有任何会话绑定 QQ 目标。',
  qqBound: (sessionId, target) => `已把会话 ${sessionId} 绑定到 ${target}。`,
  qqUnbound: sessionId => `已解除会话 ${sessionId} 的 QQ 绑定。`,
  qqNoBinding: sessionId => `会话 ${sessionId} 没有 QQ 绑定。`,
  qqTestSent: (target, transport, bytes) => `已向 ${target} 发送测试图（${transport}，${Math.round(bytes / 1024)} KB）。`,
  qqTargetNotAllowed: (target, allowed) => `目标 ${target} 不在 allowTargets 白名单（${allowed.join('、') || '空'}）中。`,
  aliasList: items => `当前别名：${items.map(item => `${item.alias} → ${item.player}`).join('；')}`,
  aliasNone: () => '暂无别名。',
  aliasSet: (alias, player) => `已将别名「${alias}」指向「${player}」。`,
  aliasRemoved: alias => `已删除别名「${alias}」。`,
  aliasMissing: alias => `别名「${alias}」不存在。`,
  groupSettings: (groupId, season, mode) => `群 ${groupId} 默认设置：赛季 ${season}，模式 ${mode}。`,
  groupUpdated: (groupId, season, mode) => `已更新群 ${groupId}：赛季 ${season}，模式 ${mode}。`,
  unknownAction: action => `未知操作：${action}`,
  playerNotFound: player => `未找到玩家「${player}」。请确认游戏昵称拼写（区分大小写与空格）。`,
  characterNotFound: character => `未找到角色「${character}」。`,
  invalidArgument: detail => `参数无效：${detail}`,
  unknownSeason: (value, examples) => `未知赛季「${value}」。可用格式：${examples}。`,
  unknownMode: (value, allowed) => `未知模式「${value}」。可用模式：${allowed}。`,
  unknownTier: (value, allowed) => `未知段位「${value}」。可用段位：${allowed}。`,
  aborted: () => '请求已取消。',
}

const en: Texts = {
  playerSummary: view =>
    `${view.name} · ${view.seasonLabel} ${view.modeLabel}: MMR ${view.mmr}, ${view.tier}; `
    + `${view.wins} wins in the last ${view.matches} matches, avg. rank ${view.avgRank.toFixed(2)}, `
    + `avg. kills ${view.avgKill.toFixed(2)}. Card rendered${deliverySuffixEn(view)}.`,
  characterSummary: view =>
    `${view.name} · ${view.weapon} | ${view.tier}: win rate ${view.winRate.toFixed(1)}%, `
    + `TOP3 ${view.top3Rate.toFixed(1)}%, avg. rank #${view.avgRank.toFixed(2)}, `
    + `avg. kills ${view.avgKill.toFixed(2)}, pick rate ${view.pickRate.toFixed(2)}%. Card rendered${deliverySuffixEn(view)}.`,
  rankSummary: view => `Character rating grid · ${view.subtitle}. Card rendered${deliverySuffixEn(view)}.`,
  assetReport: view => {
    const transientFailed = Math.max(0, view.failed - view.unavailable)
    const lines = [
      view.complete
        ? `Asset library updated: ${view.total} targets; ok ${view.ok}, `
          + `changed ${view.changed} (re-downloaded ${view.downloaded}, URL-only ${view.adopted}), `
          + `missing ${view.missing}, failed ${transientFailed}.`
        : `Asset update in progress: ${view.processed}/${view.total} processed, ${view.remaining} remaining; `
          + `ok ${view.ok}, changed ${view.changed}, missing ${view.missing}, failed ${transientFailed}. `
          + 'Call er_update_assets again to continue.',
    ]
    for (const category of view.categories) {
      if (category.total === 0) continue
      lines.push(
        `${CATEGORY_LABELS_EN[category.key] ?? category.key}: `
          + `ok ${category.ok} | changed ${category.changed} | missing ${category.missing}`,
      )
    }
    if (view.failed > 0) {
      const transient = view.failures.filter(failure => failure.permanent !== true)
      if (transient.length > 0) {
        const shown = transient.slice(0, 5)
          .map(failure => `${CATEGORY_LABELS_EN[failure.category] ?? failure.category} #${failure.key}`)
        const suffix = transient.length > shown.length ? ` and ${transient.length} more` : ''
        lines.push(`Failed: ${shown.join(', ')}${suffix}; retried on the next update.`)
      }
      if (view.unavailable > 0) {
        lines.push(`${view.unavailable} entries are unavailable on the CDN (HTTP 4xx placeholders in the upstream dictionary); safe to ignore.`)
      }
    }
    return lines.join('\n')
  },
  assetCategoryLabel: key => CATEGORY_LABELS_EN[key] ?? key,
  missingAssets: (count, sample) =>
    `${count} game assets could not be downloaded (${sample.join(', ')}${sample.length < count ? ', …' : ''}); `
    + 'their slots render as placeholder blocks. Run er_update_assets to fill them in.',
  missingNote: count => `\nNote: ${count} images are missing from this card (shown as placeholder blocks); run er_update_assets to fill them in.`,
  webAttachmentFailed: message => `Web attachment failed: ${message}`,
  qqTargetMissing: () => 'QQ delivery failed: no QQ target for this session',
  qqFailed: message => `QQ delivery failed: ${message}`,
  qqDisabled: () => 'QQ delivery is disabled (qqDelivery.enabled = false).',
  qqProbeOk: probe =>
    `OneBot reachable: ${probe.implementation} (${probe.appName} ${probe.appVersion}), `
    + `account ${probe.nickname || '-'}(${probe.userId || '-'}) at ${probe.base} (via ${probe.source}).`,
  qqChannels: items => `Other QQ channels detected:\n${items.map(item => `- ${item.name}: ${item.detail}`).join('\n')}`,
  qqChannelNone: () => 'No qq-bridge / dsh-qqbot / SnowLuma detected.',
  qqChannelsNote: () => 'Note: qq-bridge / dsh-qqbot only send text today, so images still go through this plugin own OneBot push; the QQ official channel has no proactive messages left, so it cannot carry cards either.',
  qqProbeFailed: message => `OneBot probe failed: ${message}`,
  qqBindingList: items => `${items.length} bound session(s):\n${items.map(item => `${item.sessionId} → ${item.target}`).join('\n')}`,
  qqBindingEmpty: () => 'No session is bound to a QQ target yet.',
  qqBound: (sessionId, target) => `Session ${sessionId} is now bound to ${target}.`,
  qqUnbound: sessionId => `Binding for session ${sessionId} removed.`,
  qqNoBinding: sessionId => `Session ${sessionId} has no QQ binding.`,
  qqTestSent: (target, transport, bytes) => `Sent a test image to ${target} (${transport}, ${Math.round(bytes / 1024)} KB).`,
  qqTargetNotAllowed: (target, allowed) => `Target ${target} is not in allowTargets (${allowed.join(', ') || 'empty'}).`,
  aliasList: items => `Aliases: ${items.map(item => `${item.alias} → ${item.player}`).join('; ')}`,
  aliasNone: () => 'No aliases defined.',
  aliasSet: (alias, player) => `Alias "${alias}" now points to "${player}".`,
  aliasRemoved: alias => `Alias "${alias}" removed.`,
  aliasMissing: alias => `Alias "${alias}" does not exist.`,
  groupSettings: (groupId, season, mode) => `Group ${groupId} defaults: season ${season}, mode ${mode}.`,
  groupUpdated: (groupId, season, mode) => `Group ${groupId} updated: season ${season}, mode ${mode}.`,
  unknownAction: action => `Unknown action: ${action}`,
  playerNotFound: player => `Player "${player}" not found. Check the exact in-game nickname (case and spaces matter).`,
  characterNotFound: character => `Character "${character}" not found.`,
  invalidArgument: detail => `Invalid argument: ${detail}`,
  unknownSeason: (value, examples) => `Unknown season "${value}". Accepted forms: ${examples}.`,
  unknownMode: (value, allowed) => `Unknown mode "${value}". Accepted modes: ${allowed}.`,
  unknownTier: (value, allowed) => `Unknown tier "${value}". Accepted tiers: ${allowed}.`,
  aborted: () => 'Request cancelled.',
}

/** Pick the tool-text bundle for one locale. */
export function createTexts(locale: Locale): Texts {
  return locale === 'en' ? en : zh
}

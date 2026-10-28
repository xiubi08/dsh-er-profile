# dsh-er-profile

DeepSeek Harness（DSH）的《永恒轮回》查询插件。提供玩家战绩卡、角色数据卡、角色评级排行，并支持 Web 图片展示与 QQ 图片直发。

本项目是 AstrBot 插件 `astrbot_plugin_ER_userinfo_get` 的 TypeScript / DSH 重写版本，渲染布局与数据口径尽量对齐原项目。

> [!IMPORTANT]
> **给 LLM / Agent 的提示**
>
> 第一次使用（或插件更新后）建议先调用 `er_update_assets` 准备资源库，否则首次查询会边渲染边下载图片，明显变慢。
>
> 每次调用有固定时间预算（默认 45 秒），结果会返回 `processed` / `remaining` / `complete`：
> **`complete` 为 `false` 时再调用一次继续**，进度是增量保存的，不需要一次性跑完。
>
> 查询结果里的 `assets.missing > 0` 表示卡面有图片没下下来（显示为占位块），这时提示用户运行 `er_update_assets` 补齐即可。

## 首次使用（重要）

1. 调用 `er_update_assets`，若返回 `complete: false` 就再调用一次，直到为 `true`。
2. 再调用玩家/角色/评级查询工具。
3. 资源会持久化到插件目录 `data/assets/`，后续查询和更新都会复用。

`er_update_assets` 只需要在首次使用、版本更新或资源缺失时执行；日常查询不需要每次调用。

## 功能

- **玩家查询** `er_player_profile`
  - MMR、段位、Global / Asia 排名、MMR 趋势
  - RANK 统计、常用英雄
  - 最近对局列表、首局队友整卡缩放
  - 排位显示 `MMR 前值 + 增减量 / RP`，普通模式显示路径 ID
  - 钴协议显示胜负，并隐藏路径/RP 列
- **角色查询** `er_character_stats`
  - 胜率、TOP3、平均排名、击杀、RP、选择率、伤害、TK
  - 推荐技能、战术技能、潜能组合、物品统计
- **角色评级** `er_character_rank`
  - 角色 × 武器维度，按 `tierScore` 排序
  - S/A/B/C/D 评级图、圆形头像、武器类型、伤害与 RP gain
- **其他工具**
  - `er_update_assets`：刷新字典并按 URL 索引增量更新资源库（分批执行）
  - `er_alias`：玩家昵称别名
  - `er_group_config`：按群设置默认赛季/模式
  - `er_qq_target`：QQ/OneBot 目标绑定、实现探测与测试图

## 环境要求

- Node.js >= 24
- DSH 0.2.x
- `@napi-rs/canvas`（安装依赖时自动安装）
- 首次使用需要联网访问 `dak.gg`；可选官方 Open API
- 需要代理时使用**系统代理**：插件本身不接管 HTTP 客户端，Node 24 下需要 `NODE_USE_ENV_PROXY=1` 才会读取 `HTTPS_PROXY` / `HTTP_PROXY`

## 安装

```sh
pnpm install
pnpm build
```

在 DSH 中将本目录作为 bundle 安装，或在 `cordis.patch.yml` 中加载。插件入口为 `lib/index.js`，客户端入口为 `client/client.js`。

包名是 `@local/dsh-er-profile`、`private: true`，**只能按目录 / bundle 安装**（没有发布到 npm 注册表）。

## 配置

配置写在 `cordis.patch.yml` 的 `er-profile.config` 下。所有字段都有默认值，只写要覆盖的即可。

```yaml
config:
  locale: zh                     # 工具文本语言：zh / en
  renderWorkers: 2               # 渲染 worker 数
  renderTimeoutMs: 60000         # 单次渲染超时
  renderCacheTtlMs: 60000        # 相同输入的 PNG 复用窗口，0 关闭
  assetDownloadConcurrency: 6    # 资源下载并发
  assetUpdateBudgetMs: 45000     # 单次 er_update_assets 时间预算
  httpTimeoutMs: 20000           # dak.gg 单请求超时
  httpRetries: 3                 # 单请求尝试次数（含首次）
  outputRetention:
    maxFiles: 200                # output/ 最多保留多少张 PNG，0 不限
    maxAgeDays: 7                # 超过多少天的 PNG 删除，0 不限

  # 昵称别名（默认表已内置，这里只写增量/覆盖）
  characterAliases:
    猫: 爱琳
  weaponAliases:
    刺剑: 西洋剑

  # 官方 Open API（可选）
  officialApiKeyRef: "ER_OPEN_API_KEY"

  # QQ 直发（可选，OneBot v11 HTTP）
  qqDelivery:
    enabled: false
    oneBotHttpUrl: "http://127.0.0.1:3000"   # 或 "auto"：从 SnowLuma / qq-bridge 配置自动发现
    accessTokenRef: "ONEBOT_TOKEN"      # 环境变量名，或 env:NAME
    accessTokenMode: "header"           # header / query / auto
    targetMode: "session-map"           # session-map / fixed / model
    fixedTarget: "group:123456789"
    allowTargets: []                    # 非空时只允许这些目标
    maxImageBytes: 5242880              # 超过则自动重编码（compressOverLimit）
    compressOverLimit: true
    imageTransport: "auto"              # auto / base64 / file
    sendCaption: true                   # 图片和文字摘要合并成一条消息
    captionMaxChars: 200
    timeoutMs: 10000
    retries: 2
```

角色/武器默认别名只在 `src/config.ts` 维护一份（`DEFAULT_CHARACTER_ALIASES` / `DEFAULT_WEAPON_ALIASES`），`cordis.patch.yml` 不再重复整表，避免两处漂移。

### 官方 Open API

`officialApiKey` 直接填 key，或 `officialApiKeyRef` 指定环境变量名。未配置时完全走 dak.gg；配置后只覆盖玩家排位统计，失败会自动回退。

### QQ 直发（OneBot）

通过 OneBot v11 HTTP 接口投递，兼容 NapCat / Lagrange / LLOneBot / go-cqhttp 等实现。

**目标解析优先级**：`qqTarget` 参数（显式指定）→ 会话绑定（`er_qq_target bind`）→ `state/sessions.json` → `fixedTarget`。`allowTargets` 非空时最后一道校验会拒掉不在白名单里的目标，避免绑定写错把消息推到别的群。

**能力差异的处理**：

| 场景 | 行为 |
|---|---|
| 适配器不认 `base64://` 图片 | `imageTransport: auto` 自动退回 `file:///绝对路径` 重发一次（要求 OneBot 与插件同机） |
| 图片超过 `maxImageBytes` | 默认用 canvas 等比缩小 + 重编码，而不是直接失败；关掉 `compressOverLimit` 则报错 |
| 鉴权方式不同 | `accessTokenMode: header` 用 `Authorization: Bearer`，`query` 用 `?access_token=`，`auto` 先 header，401/403 再换 query |
| 网络抖动 / 5xx / 429 | 按 `retries` 退避重试 |
| 业务错误 | 把 `retcode` 和 `message` 原样带回工具错误，例如 `retcode 1404: group not found` |
| 只发图没上下文 | `sendCaption: true` 把文字摘要和图片拼成同一条消息（`[text, image]` 消息段） |
| 失败 | 只写 warning，不影响 Web 结果 |

**`er_qq_target` 工具**（`list` / `bind` / `unbind` / `probe` / `test`）：DSH 里没有消息事件，所以会话到群的映射需要显式建立；没有绑定工具就只能手写 `state/sessions.json`。

```text
er_qq_target(action: "probe")                       # 探测实现名、账号、地址
er_qq_target(action: "bind", target: "group:123456") # 把当前会话绑到群
er_qq_target(action: "test")                         # 发一张测试图，验证整条链路
er_qq_target(action: "list")                         # 看绑定和当前配置
```

查询工具（`er_player_profile` / `er_character_stats` / `er_character_rank`）都接受可选的 `qqTarget` 参数，用于单次指定目标。

### 与 qq-bridge / dsh-qqbot 共存

DSH 里常见的两种 QQ 通道与本插件的关系：

| 通道 | 连接方式 | 能否发图 | 共存方式 |
|---|---|---|---|
| 本插件 | OneBot HTTP（`send_group_msg` / `send_private_msg`） | 能 | —— |
| `qq-bridge` | SnowLuma OneBot **WebSocket**（默认 3001） | 不能（MCP 发送工具只支持文本/语音/表情） | 同一 SnowLuma 同时开 WebSocket 与 HTTP 即可，互不冲突 |
| `dsh-qqbot` | OneBot WS 或 QQ 官方（`transport: official`） | 不能（只注册文本 `qq_send`） | 同上；它不对外暴露服务，别的插件也调不到它 |

因此**图片仍由本插件直连 OneBot HTTP 推送**，两个外部插件保持它们自己的文本通道。

`oneBotHttpUrl: "auto"` 时会自动发现端点，不用手抄端口和 token：

1. SnowLuma 每个账号的 `config/onebot_<QQ号>.json` → `networks.httpServers[0]`（host / port / accessToken）
2. `qq-bridge/config.json` → `snowluma.httpUrl` / `snowluma.accessToken`
3. 最后才退回常见端口 3000 / 3001 / 5700

每个候选都用 `get_login_info` 真调一次，谁通就用谁（HTTP token 与 WS token 不同，不能混用）。`er_qq_target probe` 会打印用的是哪个来源，以及检测到了哪些外部通道：

```
OneBot 可用：NapCat（NapCat 4.x），账号 ER-Bot(123456)，地址 http://127.0.0.1:3000（来源 onebot_123.json (SnowLuma)）。
检测到其它 QQ 通道：
- dsh-qqbot：profile "desktop" patch: id qqbot, transport=official
- qq-bridge：profile "desktop" MCP snowluma tools
```

**QQ 官方通道**：官方自 2025-04-21 起停用主动消息，而本插件是纯推送（没有入站事件，拿不到 `msg_id`），所以官方通道**无法承载卡片**；被动回复必须由持有 `msg_id` 的桥接在收到消息后发出。
**未支持：QQ 官方机器人（qq_official）**。参考项目的按钮（`keyboard`）、素材上传（`qqbot-media://`）、入群欢迎、指令面板都依赖 AstrBot 的 botpy 适配器，DSH 只暴露工具调用，没有事件与开放平台客户端，因此这些能力无法移植；对应的降级思路（失败不阻断、能力探测、单条图文）已经落在上面的 OneBot 实现里。

## 数据目录

默认使用插件目录下的 `data/`：

```
<plugin>/data/
  assets/          持久化图片资源（角色、皮肤、装备、段位、技能等）
  assets/index.json 资源 URL/ETag 索引
  state/           别名、群设置、字典缓存、QQ 会话绑定（qq-targets.json）
  output/          生成的 PNG（按 outputRetention 自动清理）
```

可通过 `dataDir` 覆盖。资源采用**按需下载**：卡面第一次用到某张图时才下载并持久化；`er_update_assets` 执行差异更新。

## 资源更新

`er_update_assets` 沿用旧 AstrBot 插件的资源比对逻辑：

1. 强制重新拉取全部字典（绕过 12 小时缓存），确保 URL 是最新的。
2. 读取 `assets/index.json`，逐项比对本地文件与远端 URL：
   - 文件缺失 → 下载；
   - URL 未变 → 视为正常，跳过（不发请求）；
   - URL 变化 → 先 `HEAD` 比对 `ETag`（没有 `ETag` 时比对 `Content-Length`）；内容未变只更新索引里的 URL，内容变化才重新下载；
   - 有文件但没有索引记录 → 视为正常并补写索引，避免首次升级时全量重下。
3. 单个文件失败会按 429 / 5xx / 网络错误自动退避重试（默认 3 次）；最终失败的条目带 `reason` 列在结果里，并在下次更新时自动重试。
4. 索引每处理 25 项或每 5 秒落盘一次，因此时间预算用完 / 被取消时，下一轮直接接着做，不会重头再来。

并发数由 `assetDownloadConcurrency` 控制（默认 6），时间预算由 `assetUpdateBudgetMs` 控制（默认 45 秒）。索引损坏或丢失时，更新会从磁盘上已有的文件重建基线。

## 缓存

- 玩家 profile / 对局列表：60 秒
- 单局详情：10 分钟
- 角色统计 / 角色评级快照：5 分钟
- 角色推荐：30 分钟
- 字典：12 小时（`state/dictionaries.json`）
- 渲染结果：内存里复用 60 秒内、输入完全相同的 PNG（`renderCacheTtlMs`）
- 相同并发请求会合并为同一个 Promise

## 渲染

渲染在 `worker_threads` 池中执行，`renderWorkers` 控制 worker 数量（默认 2），`renderTimeoutMs` 控制单任务超时。

渲染期间拿不到图片时不再静默：失败会带上 `category#key (reason)` 报进工具结果的 `warnings` 和 `assets.missing`。

## 开发与测试

```sh
pnpm typecheck   # src + test 两套 tsconfig
pnpm test        # node --test，23 个用例
pnpm build
```

- 测试数据全部是**合成 fixture**（`test/support/fixtures.ts`，玩家名 `TestPlayer`），仓库里不含真实玩家战绩。
- `test/render.test.ts` 是渲染回归：用固定卡片数据渲染三类卡，断言尺寸、PNG 签名、图片资源零缺失。
- 工具文本集中在 `src/util/i18n.ts`（`zh` / `en`），参数校验在 `src/tool/params.ts`，错误类型在 `src/util/errors.ts`。
- `locale/*.json` 是客户端 UI 的文案，和工具文本是两套，别混用。

## 说明

- 数据来自 dak.gg 非官方接口，接口结构可能变化。错误会区分「玩家不存在（404）」「接口/网络/超时」，不再统一包装成一句话。
- 参数不再静默改写：非法 `season` / `mode` / `tier` 会直接报错并列出可用值；`matchCount` 超出 10–20 会被 clamp，但实际生效值会通过 `applied` 回显。
- 官方 Open API 为可选功能，需要自行申请 key。
- Web 端卡片图由客户端使用已鉴权的 `/api/file?path=<绝对路径>` 路由直接读取 `output/` 下的 PNG；工具结果里的附件仅作为回退，因为会话附件授权只识别消息内容中的图片块，不识别 presentation meta。
- 角色评级图使用 `assets/tier-grade/` 下的 S/A/B/C/D 图片。
- 字体：MiSans（Bold / Semibold）与 Noto Sans KR，随包分发。字体版权归各自权利人所有；重新分发或商用前请自行确认 MiSans / Noto 的授权条款，这会直接影响 AGPL 之外的分发合规性。
- `locale: en` 只切换工具返回文本，卡片图内文字仍为中文（版面按中文排）。

## License

AGPL-3.0-only。本项目基于原 AstrBot 插件重写，保留相同许可证。

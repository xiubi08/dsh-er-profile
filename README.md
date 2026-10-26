# dsh-er-profile

DeepSeek Harness（DSH）的《永恒轮回》查询插件。提供玩家战绩卡、角色数据卡、角色评级排行，并支持 Web 图片展示与 QQ 图片直发。

本项目是 AstrBot 插件 `astrbot_plugin_ER_userinfo_get` 的 TypeScript / DSH 重写版本，渲染布局与数据口径尽量对齐原项目。

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
  - `er_update_assets`：刷新字典并按 URL 索引增量更新资源库
  - `er_alias`：玩家昵称别名
  - `er_group_config`：按群设置默认赛季/模式

## 环境要求

- Node.js >= 24
- DSH 0.2.x
- `@napi-rs/canvas`（安装依赖时自动安装）
- 首次使用需要联网访问 `dak.gg`；可选官方 Open API

## 安装

```sh
pnpm install
pnpm build
```

在 DSH 中将本目录作为 bundle 安装，或在 `cordis.patch.yml` 中加载。插件入口为 `lib/index.js`，客户端入口为 `client/client.js`。

## 配置

配置写在 `cordis.patch.yml` 的 `er-profile.config` 下。

```yaml
config:
  dataDir: "C:/Users/you/.dsh/er-profile"
  renderWorkers: 2
  renderTimeoutMs: 60000
  assetDownloadConcurrency: 6

  # 官方 Open API（可选）
  officialApiKeyRef: "ER_OPEN_API_KEY"

  # QQ 直发（可选）
  qqDelivery:
    enabled: false
    oneBotHttpUrl: "http://127.0.0.1:3000"
    accessTokenRef: "SNOWLUMA_TOKEN"
    targetMode: "fixed"
    fixedTarget: "group:123456789"
```

### 官方 Open API

`officialApiKey` 直接填 key，或 `officialApiKeyRef` 指定环境变量名。未配置时完全走 dak.gg；配置后只覆盖玩家排位统计，失败会自动回退。

### QQ 直发

通过 OneBot HTTP `send_group_msg` / `send_private_msg` 发送 `base64://` 图片。

- `targetMode: fixed`：使用 `fixedTarget`
- `targetMode: session-map`：读取 `state/sessions.json`，将 DSH session id 映射到 `group:123` / `private:456`
- QQ 发送失败只记录 warning，不影响 Web 结果

## 数据目录

默认 `~/.dsh/er-profile`：

```
assets/          持久化图片资源（角色、皮肤、装备、段位、技能等）
state/           别名、群设置、字典缓存
output/          生成的 PNG
```

资源采用**按需下载**：卡面第一次用到某张图时才下载并持久化；`er_update_assets` 执行差异更新。

## 资源更新

`er_update_assets` 沿用旧 AstrBot 插件的资源比对逻辑：

1. 强制重新拉取全部字典（绕过 12 小时缓存），确保 URL 是最新的。
2. 读取 `assets/index.json`，逐项比对本地文件与远端 URL：
   - 文件缺失 → 下载；
   - URL 未变 → 视为正常，跳过；
   - URL 变化 → 先 `HEAD` 比对 `ETag`（没有 `ETag` 时比对 `Content-Length`）；内容未变只更新索引里的 URL，内容变化才重新下载；
   - 有文件但没有索引记录 → 视为正常并补写索引，避免首次升级时全量重下。
3. 下载失败的条目会列在结果里，并在下次更新时自动重试。

并发数由 `assetDownloadConcurrency` 控制（默认 6）。索引损坏或丢失时，更新会从磁盘上已有的文件重建基线。

## 缓存

- 玩家 profile / 对局列表：60 秒
- 单局详情：10 分钟
- 角色统计 / 角色评级快照：5 分钟
- 角色推荐：30 分钟
- 字典：12 小时（`state/dictionaries.json`）
- 相同并发请求会合并为同一个 Promise

## 渲染

渲染在 `worker_threads` 池中执行，`renderWorkers` 控制 worker 数量，`renderTimeoutMs` 控制单任务超时。

## 说明

- 数据来自 dak.gg 非官方接口，接口结构可能变化。
- 官方 Open API 为可选功能，需要自行申请 key。
- Web 端卡片图由客户端使用已鉴权的 `/api/file?path=<绝对路径>` 路由直接读取 `output/` 下的 PNG；工具结果里的附件仅作为回退，因为会话附件授权只识别消息内容中的图片块，不识别 presentation meta。
- 角色评级图使用 `assets/tier-grade/` 下的 S/A/B/C/D 图片。
- 字体：MiSans（Bold / Semibold）与 Noto Sans KR。字体版权归各自权利人所有，发布前请确认授权。

## License

AGPL-3.0-only。本项目基于原 AstrBot 插件重写，保留相同许可证。

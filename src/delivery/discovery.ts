/**
 * Coexistence with other QQ channels installed in the same DSH.
 *
 * Two shapes exist today:
 *  - `dsh-qqbot` (Cordis plugin): owns a OneBot WS / QQ-official connection and
 *    registers a text-only `qq_send` tool. It exposes no service, so another
 *    plugin cannot deliver through it.
 *  - `qq-bridge` (standalone process): owns the SnowLuma OneBot WS connection,
 *    offers text-only MCP send tools, and stores the OneBot HTTP endpoint in
 *    SnowLuma's per-account config.
 *
 * Neither can push an image, so this plugin keeps its own OneBot HTTP channel and
 * uses the files below only to (a) discover the endpoint instead of asking the
 * user to copy it, and (b) report what else is installed.
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface OneBotEndpoint {
  base: string
  token: string
  /** Where the endpoint came from, for the probe report. */
  source: string
}

export interface DiscoveredChannel {
  name: string
  detail: string
}

const ONEBOT_FILE = /^onebot_(\d+)\.json$/iu

export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

async function safeText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/** `$DSH_HOME/profiles/*` directories that exist. */
export async function profileDirs(): Promise<string[]> {
  const root = join(dshHome(), 'profiles')
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name))
  } catch {
    return []
  }
}

/** Find qq-bridge roots referenced by profile MCP patches or known locations. */
export async function findQqBridgeDirs(): Promise<string[]> {
  const found = new Set<string>()
  const fromEnv = process.env.QQ_BRIDGE_DIR
  if (fromEnv !== undefined && fromEnv !== '') found.add(fromEnv)
  for (const dir of await profileDirs()) {
    const patch = await safeText(join(dir, 'cordis.patch.yml'))
    for (const match of patch.matchAll(/([A-Za-z]:[\\/][^\s'"*]*?|\/[^\s'"*]*?)mcp-snowluma-safe\.js/gu)) {
      const path = match[1]
      if (path !== undefined) found.add(dirname(dirname(path)))
    }
    const pkg = await readJson(join(dir, 'package.json'))
    const deps = (pkg?.dependencies ?? {}) as Record<string, unknown>
    for (const name of Object.keys(deps)) {
      if (name.toLowerCase() === 'qq-bridge') {
        const spec = String(deps[name])
        const local = /^(?:file|link):(.+)$/u.exec(spec)
        if (local !== null && local[1] !== undefined) found.add(local[1])
      }
    }
  }
  for (const guess of [join(homedir(), 'qq-bridge'), 'C:\\qq-bridge', '/opt/qq-bridge']) {
    if (existsSync(guess)) found.add(guess)
  }
  return [...found].filter(dir => existsSync(dir))
}

/** SnowLuma install roots worth scanning for per-account OneBot configs. */
export async function findSnowlumaHomes(): Promise<string[]> {
  const found = new Set<string>()
  const fromEnv = process.env.SNOWLUMA_HOME
  if (fromEnv !== undefined && fromEnv !== '') found.add(fromEnv)
  for (const bridge of await findQqBridgeDirs()) {
    const config = await readJson(join(bridge, 'config.json'))
    const snowluma = (config?.snowluma ?? {}) as Record<string, unknown>
    for (const key of ['homeDir', 'launcherPath'] as const) {
      const value = snowluma[key]
      if (typeof value === 'string' && value !== '') found.add(value)
    }
  }
  for (const guess of ['C:\\SnowLuma', join(homedir(), 'SnowLuma'), '/opt/SnowLuma']) {
    if (existsSync(guess)) found.add(guess)
  }
  return [...found].filter(dir => existsSync(dir))
}

/**
 * Read `config/onebot_<uin>.json` (SnowLuma layout) and return HTTP endpoints.
 * The HTTP port and token are per account and differ from the WebSocket ones.
 */
export async function readSnowlumaOneBotEndpoints(home: string): Promise<OneBotEndpoint[]> {
  const dir = join(home, 'config')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const endpoints: OneBotEndpoint[] = []
  for (const name of names.sort()) {
    if (!ONEBOT_FILE.test(name)) continue
    const raw = await readJson(join(dir, name))
    const networks = (raw?.networks ?? {}) as Record<string, unknown>
    const http = Array.isArray(networks.httpServers) ? networks.httpServers[0] as Record<string, unknown> | undefined : undefined
    if (http === undefined) continue
    const host = typeof http.host === 'string' && http.host !== '' ? http.host : '127.0.0.1'
    const port = Number(http.port ?? 3000)
    if (!Number.isFinite(port) || port <= 0) continue
    endpoints.push({
      base: `http://${host}:${port}`,
      token: typeof http.accessToken === 'string' ? http.accessToken : '',
      source: `${name} (SnowLuma)`,
    })
  }
  return endpoints
}

/** Candidate OneBot HTTP endpoints, most specific first. */
export async function candidateEndpoints(configUrl: string): Promise<OneBotEndpoint[]> {
  const explicit = configUrl !== '' && configUrl !== 'auto'
  const candidates: OneBotEndpoint[] = []
  if (explicit) candidates.push({ base: configUrl, token: '', source: 'config' })
  for (const home of await findSnowlumaHomes()) {
    candidates.push(...await readSnowlumaOneBotEndpoints(home))
  }
  for (const bridge of await findQqBridgeDirs()) {
    const config = await readJson(join(bridge, 'config.json'))
    const snowluma = (config?.snowluma ?? {}) as Record<string, unknown>
    const url = snowluma.httpUrl
    if (typeof url === 'string' && url.startsWith('http')) {
      candidates.push({
        base: url,
        token: typeof snowluma.accessToken === 'string' ? snowluma.accessToken : '',
        source: 'qq-bridge config.json',
      })
    }
  }
  for (const port of [3000, 3001, 5700]) {
    candidates.push({ base: `http://127.0.0.1:${port}`, token: '', source: 'default port scan' })
  }
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    const key = `${candidate.base}|${candidate.token}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Which other QQ channels are installed, for the probe report. */
export async function detectChannels(): Promise<DiscoveredChannel[]> {
  const channels: DiscoveredChannel[] = []
  const seen = new Set<string>()
  const push = (name: string, detail: string): void => {
    const key = `${name}|${detail}`
    if (!seen.has(key)) {
      seen.add(key)
      channels.push({ name, detail })
    }
  }
  for (const dir of await profileDirs()) {
    const profileName = dir.split(/[\\/]/u).pop() ?? dir
    const pkg = await readJson(join(dir, 'package.json'))
    const deps = Object.keys((pkg?.dependencies ?? {}) as Record<string, unknown>)
    for (const dep of deps) {
      const lower = dep.toLowerCase()
      if (lower.includes('qqbot') || lower.includes('qq-bot')) {
        push('dsh-qqbot', `profile "${profileName}" dependency ${dep}`)
      }
      if (lower.includes('qq-bridge') || lower.includes('openclaw')) {
        push('qq-bridge', `profile "${profileName}" dependency ${dep}`)
      }
    }
    const patch = await safeText(join(dir, 'cordis.patch.yml'))
    if (/^\s*-?\s*id:\s*qqbot\b/mu.test(patch)) {
      const transport = /^\s*transport:\s*['"]?(onebot|official)['"]?/mu.exec(patch)?.[1] ?? 'unknown'
      push('dsh-qqbot', `profile "${profileName}" patch: id qqbot, transport=${transport}`)
    }
    if (patch.includes('mcp-snowluma-safe.js')) {
      push('qq-bridge', `profile "${profileName}" MCP snowluma tools`)
    }
  }
  for (const bridge of await findQqBridgeDirs()) {
    push('qq-bridge', `config at ${bridge}`)
  }
  for (const home of await findSnowlumaHomes()) {
    push('SnowLuma', `home ${home}`)
  }
  return channels
}

/**
 * OneBot v11 delivery: target resolution, capability probing, and image push
 * with transport fallback.
 *
 * OneBot implementations disagree on how to accept an image. `auto` tries the
 * portable base64 payload first and falls back to a local file reference, which
 * matters when the bot runs on another machine or the adapter rejects big JSON.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { ResolvedConfig } from '../config.ts'
import { ErError, errorMessageOf } from '../util/errors.ts'
import type { QqTargetStore } from './qq-targets.ts'
import { candidateEndpoints } from './discovery.ts'

export interface QqTarget {
  kind: 'group' | 'private'
  id: string
}

/** Parse `group:123`, `private:456`, or a bare numeric group id. */
export function parseQqTarget(raw: string): QqTarget | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  const match = /^(group|private):(.+)$/u.exec(value)
  const kind: QqTarget['kind'] = match !== null && match[1] === 'private' ? 'private' : 'group'
  const id = (match?.[2] ?? value).trim()
  if (!/^\d{4,20}$/u.test(id)) {
    throw new ErError('invalid_argument', `QQ target id must be numeric, got "${id}"`)
  }
  return { kind, id }
}

export function formatQqTarget(target: QqTarget): string {
  return `${target.kind}:${target.id}`
}

/** Throw unless the target passes the `allowTargets` whitelist (empty = allow all). */
export function assertAllowed(config: ResolvedConfig, target: QqTarget): void {
  const allowed = config.qqDelivery.allowTargets
  if (allowed.length === 0) return
  const formatted = formatQqTarget(target)
  const normalized = allowed.map(entry => {
    const parsed = parseQqTarget(entry)
    return parsed === undefined ? entry : formatQqTarget(parsed)
  })
  if (!normalized.includes(formatted)) {
    throw new ErError('qq_target_not_allowed', `QQ target ${formatted} is not in allowTargets`)
  }
}

function tokenOf(config: ResolvedConfig): string {
  const ref = config.qqDelivery.accessTokenRef
  if (ref === '') return ''
  if (ref.startsWith('env:')) return process.env[ref.slice(4)] ?? ''
  return process.env[ref] ?? ref
}

interface ResolvedEndpoint {
  base: string
  token: string
  source: string
}

let endpointCache: (ResolvedEndpoint & { at: number }) | undefined
const ENDPOINT_TTL_MS = 60_000

/** `get_login_info` doubles as the endpoint probe used during discovery. */
async function verifyEndpoint(base: string, token: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${base}/get_login_info`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
      },
      body: '{}',
      signal: AbortSignal.timeout(Math.min(timeoutMs, 3_000)),
    })
    if (!response.ok) return false
    const body = await response.json() as OneBotResponse
    return body.status === 'ok' && (body.retcode ?? 0) === 0
  } catch {
    return false
  }
}

/**
 * Resolve the OneBot HTTP endpoint. An explicit URL wins; `auto` walks the
 * SnowLuma per-account configs and qq-bridge's config.json, verifying each
 * candidate with `get_login_info` instead of guessing a port.
 */
async function endpointFor(config: ResolvedConfig): Promise<ResolvedEndpoint> {
  const configured = config.qqDelivery.oneBotHttpUrl.trim()
  const explicitToken = tokenOf(config)
  if (configured !== '' && configured !== 'auto') {
    return { base: configured.replace(/\/+$/u, ''), token: explicitToken, source: 'config' }
  }
  if (endpointCache !== undefined && Date.now() - endpointCache.at < ENDPOINT_TTL_MS) {
    return endpointCache
  }
  const candidates = await candidateEndpoints(configured)
  for (const candidate of candidates) {
    const token = explicitToken !== '' ? explicitToken : candidate.token
    if (await verifyEndpoint(candidate.base, token, config.qqDelivery.timeoutMs)) {
      endpointCache = { base: candidate.base, token, source: candidate.source, at: Date.now() }
      return endpointCache
    }
  }
  const fallback = candidates[0] ?? { base: 'http://127.0.0.1:3000', token: '', source: 'fallback' }
  return {
    base: fallback.base.replace(/\/+$/u, ''),
    token: explicitToken !== '' ? explicitToken : fallback.token,
    source: fallback.source,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface OneBotResponse {
  status?: string
  retcode?: number
  message?: string
  data?: unknown
}

/** One OneBot HTTP call with retries; never throws for 4xx business errors. */
async function callOneBot(
  config: ResolvedConfig,
  action: string,
  payload: Record<string, unknown> | undefined,
  method: 'GET' | 'POST' = 'POST',
): Promise<{ ok: boolean; response: OneBotResponse; httpStatus: number }> {
  const endpoint = await endpointFor(config)
  const token = endpoint.token
  const mode = config.qqDelivery.accessTokenMode
  const attempts = config.qqDelivery.retries
  let lastStatus = 0
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const placement of mode === 'auto' ? ['header', 'query'] as const : [mode] as const) {
      const url = new URL(`${endpoint.base}/${action}`)
      if (token !== '' && placement === 'query') url.searchParams.set('access_token', token)
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(token !== '' && placement === 'header' ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(payload === undefined || method === 'GET' ? {} : { body: JSON.stringify(payload) }),
          signal: AbortSignal.timeout(config.qqDelivery.timeoutMs),
        })
        lastStatus = response.status
        if (response.status === 401 || response.status === 403) {
          // Try the other token placement before counting this as a failure.
          if (mode === 'auto' && placement === 'header') continue
          throw new ErError('qq_send_failed', `OneBot rejected the token (HTTP ${response.status})`, { status: response.status })
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new ErError('qq_send_failed', `OneBot HTTP ${response.status}`, { status: response.status })
          break
        }
        if (!response.ok) {
          return { ok: false, response: { message: `HTTP ${response.status}` }, httpStatus: response.status }
        }
        const body = await response.json() as OneBotResponse
        const retcode = body.retcode ?? 0
        return { ok: body.status !== 'failed' && retcode === 0, response: body, httpStatus: response.status }
      } catch (error) {
        if (error instanceof ErError) throw error
        lastError = new ErError('qq_send_failed', `OneBot request failed: ${errorMessageOf(error)}`)
        break
      }
    }
    if (attempt < attempts) await sleep(Math.min(2_000, 300 * 2 ** (attempt - 1)))
  }
  if (lastError instanceof ErError) throw lastError
  return { ok: false, response: { message: `HTTP ${lastStatus}` }, httpStatus: lastStatus }
}

export interface OneBotProbe {
  ok: boolean
  base: string
  implementation: string
  appName: string
  appVersion: string
  userId: string
  nickname: string
  source: string
  error?: string
}

function guessImplementation(appName: string, version: string): string {
  const haystack = `${appName} ${version}`.toLowerCase()
  if (haystack.includes('napcat')) return 'NapCat'
  if (haystack.includes('lagrange')) return 'Lagrange'
  if (haystack.includes('llonebot') || haystack.includes('llob')) return 'LLOneBot'
  if (haystack.includes('go-cqhttp') || haystack.includes('gocqhttp')) return 'go-cqhttp'
  if (haystack.includes('cononebot')) return 'ConoBot'
  if (haystack.includes('onebot')) return 'OneBot v11'
  return 'OneBot-compatible'
}

/** Ask the adapter who it is, so failures can name the real implementation. */
export async function probeOneBot(config: ResolvedConfig): Promise<OneBotProbe> {
  const resolved = await endpointFor(config)
  const base = resolved.base
  const result: OneBotProbe = {
    ok: false, base, implementation: 'unknown', appName: '', appVersion: '', userId: '', nickname: '', source: resolved.source,
  }
  try {
    const version = await callOneBot(config, 'get_version_info', undefined, 'GET')
    const versionData = (version.response.data ?? {}) as { app_name?: string; app_version?: string }
    result.appName = versionData.app_name ?? ''
    result.appVersion = versionData.app_version ?? ''
    const login = await callOneBot(config, 'get_login_info', undefined, 'GET')
    const loginData = (login.response.data ?? {}) as { user_id?: number | string; nickname?: string }
    result.userId = String(loginData.user_id ?? '')
    result.nickname = loginData.nickname ?? ''
    result.implementation = guessImplementation(result.appName, result.appVersion)
    result.ok = version.ok || login.ok
    if (!result.ok) {
      const message = version.response.message ?? login.response.message
      if (message !== undefined) result.error = message
      else result.error = `HTTP ${version.httpStatus}/${login.httpStatus}`
    }
  } catch (error) {
    result.error = errorMessageOf(error)
  }
  return result
}

/** Downscale a PNG until it fits `limit` bytes; returns the original when impossible. */
export async function shrinkPng(png: Buffer, limit: number): Promise<Buffer> {
  if (png.byteLength <= limit) return png
  let current = png
  let width = 0
  let height = 0
  try {
    const image = await loadImage(current)
    width = image.width
    height = image.height
  } catch {
    return current
  }
  for (let round = 0; round < 10 && current.byteLength > limit; round += 1) {
    const nextWidth = Math.max(200, Math.round(width * 0.8))
    const nextHeight = Math.max(200, Math.round(height * 0.8))
    if (nextWidth === width && nextHeight === height) break
    width = nextWidth
    height = nextHeight
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(await loadImage(current), 0, 0, width, height)
    current = canvas.toBuffer('image/png')
  }
  return current
}

export type QqTransport = 'base64' | 'file'

function messageSegments(
  transport: QqTransport,
  png: Buffer,
  path: string | undefined,
  caption: string | undefined,
): Record<string, unknown>[] {
  const segments: Record<string, unknown>[] = []
  if (caption !== undefined && caption !== '') segments.push({ type: 'text', data: { text: caption } })
  const file = transport === 'base64'
    ? `base64://${png.toString('base64')}`
    : `file:///${(path ?? '').replace(/\\/gu, '/')}`
  segments.push({ type: 'image', data: { file } })
  return segments
}

function actionFor(target: QqTarget): string {
  return target.kind === 'group' ? 'send_group_msg' : 'send_private_msg'
}

function payloadFor(target: QqTarget, segments: Record<string, unknown>[]): Record<string, unknown> {
  return target.kind === 'group'
    ? { group_id: Number(target.id), auto_escape: false, message: segments }
    : { user_id: Number(target.id), auto_escape: false, message: segments }
}

export interface SendQqImageOptions {
  /** Text sent in the same message, before the image. */
  caption?: string
  /** Local PNG path, enables the `file://` transport. */
  path?: string
}

/**
 * Push one PNG to a OneBot target.
 * @returns which transport worked, for logging/tool output.
 */
export async function sendQqImage(
  config: ResolvedConfig,
  target: QqTarget,
  png: Buffer,
  options: SendQqImageOptions = {},
): Promise<{ transport: QqTransport; bytes: number; retcode: number }> {
  let bytes = png
  if (bytes.byteLength > config.qqDelivery.maxImageBytes) {
    if (!config.qqDelivery.compressOverLimit) {
      throw new ErError('qq_image_too_large', `image is ${bytes.byteLength} bytes, over the ${config.qqDelivery.maxImageBytes} byte limit`)
    }
    bytes = await shrinkPng(bytes, config.qqDelivery.maxImageBytes)
    if (bytes.byteLength > config.qqDelivery.maxImageBytes) {
      throw new ErError('qq_image_too_large', `image is still ${bytes.byteLength} bytes after re-encoding`)
    }
  }
  const caption = options.caption === undefined
    ? undefined
    : options.caption.slice(0, Math.max(0, config.qqDelivery.captionMaxChars))
  const transports: QqTransport[] = config.qqDelivery.imageTransport === 'auto'
    ? (options.path === undefined ? ['base64'] : ['base64', 'file'])
    : [config.qqDelivery.imageTransport]
  let lastError: unknown
  for (const transport of transports) {
    if (transport === 'file' && options.path === undefined) continue
    const segments = messageSegments(transport, bytes, options.path, caption)
    try {
      const result = await callOneBot(config, actionFor(target), payloadFor(target, segments))
      if (result.ok) return { transport, bytes: bytes.byteLength, retcode: result.response.retcode ?? 0 }
      lastError = new ErError(
        'qq_send_failed',
        `OneBot rejected ${actionFor(target)} (retcode ${result.response.retcode ?? '-'}: ${result.response.message ?? 'no message'})`,
      )
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ErError('qq_send_failed', 'OneBot delivery failed for every transport')
}

async function sessionMapTarget(config: ResolvedConfig, sessionId: string | undefined): Promise<string | undefined> {
  if (sessionId === undefined) return undefined
  const path = config.qqDelivery.sessionMapPath === ''
    ? join(config.dataDir, 'state', 'sessions.json')
    : config.qqDelivery.sessionMapPath
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const entry = parsed[sessionId]
    if (typeof entry === 'string') return entry
    if (typeof entry === 'object' && entry !== null) {
      const target = (entry as { target?: unknown }).target
      if (typeof target === 'string') return target
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // An unreadable session map simply means "no target".
    }
  }
  return undefined
}

/**
 * Resolve the target for one push.
 *
 * Priority: explicit `qqTarget` (model mode) → session binding → session map →
 * fixed target. `allowTargets` is enforced last, so a mistyped binding cannot
 * leak messages to an unrelated group.
 */
export async function resolveQqTarget(
  config: ResolvedConfig,
  sessionId: string | undefined,
  explicitTarget?: string,
  store?: QqTargetStore,
): Promise<QqTarget | undefined> {
  if (!config.qqDelivery.enabled) return undefined
  const raw = explicitTarget
    ?? (sessionId === undefined ? undefined : await store?.get(sessionId))
    ?? await sessionMapTarget(config, sessionId)
    ?? (config.qqDelivery.fixedTarget === '' ? undefined : config.qqDelivery.fixedTarget)
  if (raw === undefined || raw.trim() === '') return undefined
  const target = parseQqTarget(raw)
  if (target === undefined) return undefined
  assertAllowed(config, target)
  return target
}

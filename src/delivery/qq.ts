import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResolvedConfig } from '../config.ts'

export interface QqTarget {
  kind: 'group' | 'private'
  id: string
}

/** Parse `group:123`, `private:456`, or a bare group id. */
export function parseQqTarget(raw: string): QqTarget | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  const match = /^(group|private):(.+)$/u.exec(value)
  if (match !== null) {
    return { kind: match[1] === 'private' ? 'private' : 'group', id: match[2]?.trim() ?? '' }
  }
  return { kind: 'group', id: value }
}

async function sessionTarget(config: ResolvedConfig, sessionId: string | undefined): Promise<QqTarget | undefined> {
  if (sessionId === undefined) return undefined
  const path = config.qqDelivery.sessionMapPath === ''
    ? join(config.dataDir, 'state', 'sessions.json')
    : config.qqDelivery.sessionMapPath
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const entry = parsed[sessionId]
    if (typeof entry === 'string') return parseQqTarget(entry)
    if (typeof entry === 'object' && entry !== null) {
      const target = (entry as { target?: unknown }).target
      if (typeof target === 'string') return parseQqTarget(target)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return undefined
}

/** Resolve the configured QQ target for the current session. */
export async function resolveQqTarget(
  config: ResolvedConfig,
  sessionId: string | undefined,
): Promise<QqTarget | undefined> {
  if (config.qqDelivery.targetMode === 'fixed') return parseQqTarget(config.qqDelivery.fixedTarget)
  if (config.qqDelivery.targetMode === 'session-map') return sessionTarget(config, sessionId)
  return undefined
}

function accessToken(config: ResolvedConfig): string {
  const ref = config.qqDelivery.accessTokenRef
  if (ref === '') return ''
  if (ref.startsWith('env:')) return process.env[ref.slice(4)] ?? ''
  return process.env[ref] ?? ref
}

/** Send one PNG through the OneBot HTTP API. */
export async function sendQqImage(
  config: ResolvedConfig,
  target: QqTarget,
  png: Buffer,
): Promise<void> {
  if (png.byteLength > config.qqDelivery.maxImageBytes) {
    throw new Error(`image is ${png.byteLength} bytes, over the configured limit`)
  }
  const endpoint = target.kind === 'group'
    ? `${config.qqDelivery.oneBotHttpUrl.replace(/\/+$/u, '')}/send_group_msg`
    : `${config.qqDelivery.oneBotHttpUrl.replace(/\/+$/u, '')}/send_private_msg`
  const body = target.kind === 'group'
    ? { group_id: Number(target.id), message: [{ type: 'image', data: { file: `base64://${png.toString('base64')}` } }] }
    : { user_id: Number(target.id), message: [{ type: 'image', data: { file: `base64://${png.toString('base64')}` } }] }
  if (!Number.isFinite(Number(target.id))) throw new Error(`invalid QQ target id: ${target.id}`)
  const token = accessToken(config)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.qqDelivery.timeoutMs),
  })
  if (!response.ok) throw new Error(`OneBot HTTP ${response.status}`)
  const result = await response.json() as { status?: string; retcode?: number; message?: string }
  if (result.status === 'failed' || (result.retcode !== undefined && result.retcode !== 0)) {
    throw new Error(result.message ?? `OneBot retcode ${result.retcode ?? 'unknown'}`)
  }
}

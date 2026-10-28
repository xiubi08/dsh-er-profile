import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { candidateEndpoints, detectChannels, findQqBridgeDirs, readSnowlumaOneBotEndpoints } from '../src/delivery/discovery.ts'
import { probeOneBot } from '../src/delivery/qq.ts'

interface Layout {
  root: string
  bridge: string
  snowluma: string
}

/** Build a fake DSH home + qq-bridge + SnowLuma layout on disk. */
async function makeLayout(): Promise<Layout> {
  const root = await mkdtemp(join(tmpdir(), 'er-discover-'))
  const bridge = join(root, 'qq-bridge')
  const snowluma = join(root, 'SnowLuma')
  const profile = join(root, 'dsh-home', 'profiles', 'desktop')
  await mkdir(join(bridge, 'src'), { recursive: true })
  await mkdir(join(snowluma, 'config'), { recursive: true })
  await mkdir(profile, { recursive: true })

  await writeFile(join(bridge, 'config.json'), JSON.stringify({
    dsh: { baseUrl: 'http://127.0.0.1:3080' },
    snowluma: { homeDir: snowluma, httpUrl: 'http://127.0.0.1:3000', accessToken: '' },
  }), 'utf8')
  await writeFile(join(bridge, 'src', 'mcp-snowluma-safe.js'), '// stub', 'utf8')

  await writeFile(join(snowluma, 'config', 'onebot_12345.json'), JSON.stringify({
    networks: {
      httpServers: [{ host: '127.0.0.1', port: 4321, accessToken: 'snow-token' }],
      wsServers: [{ host: '127.0.0.1', port: 3001, accessToken: 'ws-token' }],
    },
  }), 'utf8')

  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'desktop',
    dependencies: { 'dsh-qqbot': 'file:C:/plugins/dsh-qqbot' },
  }), 'utf8')
  await writeFile(join(profile, 'cordis.patch.yml'), [
    '- insert:',
    "    - id: qqbot",
    "      name: 'dsh-qqbot'",
    '      config:',
    '        transport: official',
    `- insert:`,
    `    - id: qq-bridge-mcp`,
    `      config:`,
    `        command: node`,
    `        args: ['${join(bridge, 'src', 'mcp-snowluma-safe.js')}']`,
  ].join('\n'), 'utf8')
  return { root, bridge, snowluma }
}

async function withLayout(run: (layout: Layout) => Promise<void>): Promise<void> {
  const layout = await makeLayout()
  const previous = { DSH_HOME: process.env.DSH_HOME, QQ_BRIDGE_DIR: process.env.QQ_BRIDGE_DIR }
  process.env.DSH_HOME = join(layout.root, 'dsh-home')
  process.env.QQ_BRIDGE_DIR = layout.bridge
  try {
    await run(layout)
  } finally {
    if (previous.DSH_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.DSH_HOME
    if (previous.QQ_BRIDGE_DIR === undefined) delete process.env.QQ_BRIDGE_DIR
    else process.env.QQ_BRIDGE_DIR = previous.QQ_BRIDGE_DIR
    await rm(layout.root, { recursive: true, force: true })
  }
}

test('qq-bridge and SnowLuma locations are discovered', async () => {
  await withLayout(async layout => {
    const dirs = await findQqBridgeDirs()
    assert.ok(dirs.includes(layout.bridge), `expected ${layout.bridge} in ${dirs.join(',')}`)
    const endpoints = await readSnowlumaOneBotEndpoints(layout.snowluma)
    assert.deepEqual(endpoints[0], {
      base: 'http://127.0.0.1:4321',
      token: 'snow-token',
      source: 'onebot_12345.json (SnowLuma)',
    })
  })
})

test('co-installed channels are reported with their transport', async () => {
  await withLayout(async () => {
    const channels = await detectChannels()
    assert.ok(channels.some(item => item.name === 'dsh-qqbot' && item.detail.includes('transport=official')))
    assert.ok(channels.some(item => item.name === 'qq-bridge'))
    assert.ok(channels.some(item => item.name === 'SnowLuma'))
  })
})

test('auto mode verifies the discovered SnowLuma endpoint and token', async () => {
  await withLayout(async () => {
    const config = resolveConfig({
      dataDir: 'unused',
      qqDelivery: { enabled: true, oneBotHttpUrl: 'auto', timeoutMs: 2_000, retries: 1 },
    })
    const candidates = await candidateEndpoints('auto')
    assert.equal(candidates[0]?.base, 'http://127.0.0.1:4321')

    const original = globalThis.fetch
    const calls: { url: string; auth: string }[] = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({
        url,
        auth: String((init?.headers as Record<string, string> | undefined)?.authorization ?? ''),
      })
      if (!url.startsWith('http://127.0.0.1:4321')) return new Response('nope', { status: 502 })
      return new Response(JSON.stringify({
        status: 'ok',
        retcode: 0,
        data: { user_id: 12345, nickname: 'bot' },
      }), { status: 200 })
    }) as typeof fetch
    try {
      const probe = await probeOneBot(config)
      assert.equal(probe.ok, true)
      assert.equal(probe.base, 'http://127.0.0.1:4321')
      assert.match(probe.source, /onebot_12345\.json/u)
      assert.equal(probe.nickname, 'bot')
      assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:4321')))
      assert.ok(calls.some(call => call.auth === 'Bearer snow-token'), 'discovered token is used')
    } finally {
      globalThis.fetch = original
    }
  })
})

test('an explicit URL bypasses discovery', async () => {
  await withLayout(async () => {
    const config = resolveConfig({
      dataDir: 'unused',
      qqDelivery: { enabled: true, oneBotHttpUrl: 'http://127.0.0.1:9999', timeoutMs: 1_000, retries: 1 },
    })
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push(url)
      return new Response(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 1, nickname: 'x' } }), { status: 200 })
    }) as typeof fetch
    try {
      const probe = await probeOneBot(config)
      assert.equal(probe.base, 'http://127.0.0.1:9999')
      assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:9999')))
    } finally {
      globalThis.fetch = original
    }
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig, type ErConfigInput } from '../src/config.ts'
import { QqTargetStore } from '../src/delivery/qq-targets.ts'
import {
  assertAllowed, formatQqTarget, parseQqTarget, resolveQqTarget, sendQqImage, shrinkPng,
} from '../src/delivery/qq.ts'
import { createCanvas } from '@napi-rs/canvas'
import { tinyPng } from './support/fixtures.ts'

interface Captured {
  url: string
  headers: Record<string, string>
  body: string
}

function stubFetch(responder: (call: Captured) => Response | Promise<Response>): { calls: Captured[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: Captured[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]))
    const call: Captured = { url, headers, body: typeof init?.body === 'string' ? init.body : '' }
    calls.push(call)
    return responder(call)
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

function configWith(input: Partial<ErConfigInput> & { dataDir: string }) {
  return resolveConfig({
    ...input,
    qqDelivery: {
      enabled: true,
      oneBotHttpUrl: 'http://onebot.test:3000',
      targetMode: 'fixed',
      fixedTarget: 'group:123456',
      ...(input.qqDelivery ?? {}),
    },
  })
}

test('target parsing accepts group/private/bare ids and rejects junk', () => {
  assert.deepEqual(parseQqTarget('group:123456'), { kind: 'group', id: '123456' })
  assert.deepEqual(parseQqTarget('private:654321'), { kind: 'private', id: '654321' })
  assert.deepEqual(parseQqTarget('987654'), { kind: 'group', id: '987654' })
  assert.equal(parseQqTarget('   '), undefined)
  assert.throws(() => parseQqTarget('group:abc'), /must be numeric/)
  assert.throws(() => parseQqTarget('group:12'), /must be numeric/)
})

test('allowTargets whitelist is enforced', () => {
  const config = resolveConfig({ dataDir: 'x', qqDelivery: { allowTargets: ['group:123456'] } })
  assertAllowed(config, { kind: 'group', id: '123456' })
  assert.throws(() => assertAllowed(config, { kind: 'group', id: '999999' }), /not in allowTargets/)
  const open = resolveConfig({ dataDir: 'x' })
  assertAllowed(open, { kind: 'private', id: '123456' })
})

test('resolveQqTarget follows model > binding > fixed, and respects enabled=false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'er-qq-'))
  try {
    const store = new QqTargetStore(dir)
    await store.bind('sess-1', 'private:777777')
    const config = resolveConfig({
      dataDir: dir,
      qqDelivery: { enabled: true, targetMode: 'fixed', fixedTarget: 'group:111111', allowTargets: [] },
    })
    assert.deepEqual(await resolveQqTarget(config, 'sess-1', undefined, store), { kind: 'private', id: '777777' })
    assert.deepEqual(await resolveQqTarget(config, 'sess-1', 'group:222222', store), { kind: 'group', id: '222222' })
    assert.deepEqual(await resolveQqTarget(config, 'unknown', undefined, store), { kind: 'group', id: '111111' })

    const disabled = resolveConfig({ dataDir: dir, qqDelivery: { enabled: false, fixedTarget: 'group:111111' } })
    assert.equal(await resolveQqTarget(disabled, 'sess-1', undefined, store), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('binding store round-trips and survives junk input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'er-qq-store-'))
  try {
    const store = new QqTargetStore(dir)
    assert.deepEqual(await store.list(), [])
    await store.bind('a', 'group:1')
    await store.bind('b', 'private:2')
    const listed = await store.list()
    assert.equal(listed.length, 2)
    assert.equal(await store.unbind('a'), true)
    assert.equal(await store.unbind('a'), false)
    assert.equal(await store.get('b'), 'private:2')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('image push sends caption and image in one message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'er-qq-send-'))
  const stub = stubFetch(() => new Response(JSON.stringify({ status: 'ok', retcode: 0 }), { status: 200 }))
  try {
    const config = configWith({ dataDir: dir, qqDelivery: { captionMaxChars: 12 } })
    const sent = await sendQqImage(config, { kind: 'group', id: '123456' }, tinyPng(), {
      caption: 'this caption is longer than twelve chars',
    })
    assert.equal(sent.transport, 'base64')
    const body = JSON.parse(stub.calls[0]?.body ?? '{}') as {
      group_id: number
      message: { type: string; data: Record<string, string> }[]
    }
    assert.equal(body.group_id, 123456)
    assert.equal(body.message[0]?.type, 'text')
    assert.equal(body.message[0]?.data.text, 'this caption')
    assert.equal(body.message[1]?.type, 'image')
    assert.match(body.message[1]?.data.file ?? '', /^base64:\/\//u)
  } finally {
    stub.restore()
    await rm(dir, { recursive: true, force: true })
  }
})

test('auto transport falls back to a file reference when base64 is rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'er-qq-fallback-'))
  let imageCalls = 0
  const stub = stubFetch(call => {
    const body = JSON.parse(call.body || '{}') as { message?: { type: string; data: { file: string } }[] }
    if (body.message?.[0]?.data?.file?.startsWith('base64://') === true) {
      imageCalls += 1
      return new Response(JSON.stringify({ status: 'failed', retcode: 100, message: 'base64 not supported' }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'ok', retcode: 0 }), { status: 200 })
  })
  try {
    const config = configWith({ dataDir: dir })
    const sent = await sendQqImage(config, { kind: 'group', id: '123456' }, tinyPng(), {
      path: 'D:\\tmp\\card.png',
    })
    assert.equal(imageCalls, 1)
    assert.equal(sent.transport, 'file')
    const second = JSON.parse(stub.calls[1]?.body ?? '{}') as { message: { data: { file: string } }[] }
    assert.equal(second.message[0]?.data.file, 'file:///D:/tmp/card.png')
  } finally {
    stub.restore()
    await rm(dir, { recursive: true, force: true })
  }
})

test('token placement can be header or query', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'er-qq-token-'))
  process.env.ER_TEST_ONEBOT_TOKEN = 'secret-token'
  const stub = stubFetch(() => new Response(JSON.stringify({ status: 'ok', retcode: 0 }), { status: 200 }))
  try {
    const headerConfig = configWith({ dataDir: dir, qqDelivery: { accessTokenRef: 'ER_TEST_ONEBOT_TOKEN' } })
    await sendQqImage(headerConfig, { kind: 'group', id: '123456' }, tinyPng())
    assert.equal(stub.calls[0]?.headers.authorization, 'Bearer secret-token')

    const queryConfig = configWith({
      dataDir: dir,
      qqDelivery: { accessTokenRef: 'ER_TEST_ONEBOT_TOKEN', accessTokenMode: 'query' },
    })
    await sendQqImage(queryConfig, { kind: 'group', id: '123456' }, tinyPng())
    assert.match(stub.calls[1]?.url ?? '', /access_token=secret-token/u)
    assert.equal(stub.calls[1]?.headers.authorization, undefined)
  } finally {
    stub.restore()
    delete process.env.ER_TEST_ONEBOT_TOKEN
    await rm(dir, { recursive: true, force: true })
  }
})

test('business failures surface the adapter retcode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'er-qq-fail-'))
  const stub = stubFetch(() => new Response(
    JSON.stringify({ status: 'failed', retcode: 1404, message: 'group not found' }), { status: 200 },
  ))
  try {
    const config = configWith({ dataDir: dir, qqDelivery: { imageTransport: 'base64' } })
    await assert.rejects(
      () => sendQqImage(config, { kind: 'group', id: '123456' }, tinyPng()),
      /retcode 1404: group not found/u,
    )
  } finally {
    stub.restore()
    await rm(dir, { recursive: true, force: true })
  }
})

test('formatQqTarget round-trips through the parser', () => {
  const target = { kind: 'private' as const, id: '654321' }
  assert.deepEqual(parseQqTarget(formatQqTarget(target)), target)
})

test('oversized PNGs are re-encoded under the limit instead of failing', async () => {
  const canvas = createCanvas(1200, 1200)
  const context = canvas.getContext('2d')
  const image = context.createImageData(1200, 1200)
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = Math.floor(Math.random() * 256)
    image.data[index + 1] = Math.floor(Math.random() * 256)
    image.data[index + 2] = Math.floor(Math.random() * 256)
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  const png = canvas.toBuffer('image/png')
  const limit = 300 * 1024
  assert.ok(png.byteLength > limit, `noise PNG is ${png.byteLength} bytes`)
  const shrunk = await shrinkPng(png, limit)
  assert.ok(shrunk.byteLength <= limit, `still ${shrunk.byteLength} bytes`)
  assert.equal(shrunk.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
})

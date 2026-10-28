import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore } from '../src/data/assets.ts'
import { makeDictionaries, tinyPng } from './support/fixtures.ts'

interface FetchCall {
  url: string
  method: string
}

/** Install a fake `fetch` and return the call log plus a restore handle. */
function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call = { url, method: init?.method ?? 'GET' }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

async function withStore(run: (store: AssetStore, dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'er-assets-'))
  const dictionaries = makeDictionaries()
  const store = new AssetStore(
    dataDir,
    dictionaries.characters,
    dictionaries.tiers,
    dictionaries.items,
    dictionaries.skills,
    dictionaries.tactical,
    dictionaries.traits,
    dictionaries.masteries,
    { retries: 1, timeoutMs: 5_000 },
  )
  try {
    await run(store, dataDir)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
}

test('a full update downloads every target and persists the index', async () => {
  const png = tinyPng()
  const stub = stubFetch(() => new Response(png, {
    status: 200,
    headers: { 'content-type': 'image/png', etag: '"v1"', 'content-length': String(png.byteLength) },
  }))
  try {
    await withStore(async (store, dataDir) => {
      const report = await store.updateAll({ concurrency: 4, timeoutMs: 5_000, retries: 1 })
      assert.equal(report.complete, true)
      assert.equal(report.remaining, 0)
      assert.equal(report.failed, 0)
      assert.equal(report.downloaded, report.total)
      assert.equal(report.processed, report.total)
      assert.ok(report.categories.length > 0)

      const index = JSON.parse(await readFile(join(dataDir, 'assets', 'index.json'), 'utf8')) as {
        version: number
        categories: Record<string, Record<string, { url: string; etag?: string }>>
      }
      assert.equal(index.version, 1)
      assert.equal(index.categories.characters?.['1']?.etag, '"v1"')
    })
  } finally {
    stub.restore()
  }
})

test('a resumed update skips the network for files already indexed', async () => {
  const png = tinyPng()
  const first = stubFetch(() => new Response(png, { status: 200, headers: { etag: '"v1"' } }))
  let firstCalls = 0
  try {
    await withStore(async (store, dataDir) => {
      await store.updateAll({ retries: 1 })
      firstCalls = first.calls.length
      assert.ok(firstCalls > 0)

      const second = stubFetch(() => new Response(png, { status: 200 }))
      try {
        const report = await store.updateAll({ retries: 1 })
        assert.equal(report.downloaded, 0)
        assert.equal(report.failed, 0)
        assert.equal(report.ok, report.total)
        assert.equal(second.calls.length, 0, 'no HTTP request is needed for indexed, unchanged assets')
      } finally {
        second.restore()
      }
      assert.ok(dataDir.length > 0)
    })
  } finally {
    first.restore()
  }
})

test('a time budget stops the run and reports what is left', async () => {
  const png = tinyPng()
  const stub = stubFetch(() => new Response(png, { status: 200 }))
  try {
    await withStore(async store => {
      const partial = await store.updateAll({ budgetMs: 1, retries: 1 })
      assert.equal(partial.complete, false)
      assert.equal(partial.remaining, partial.total - partial.processed)
      assert.ok(partial.remaining > 0)

      const rest = await store.updateAll({ retries: 1 })
      assert.equal(rest.complete, true)
      assert.equal(rest.downloaded, partial.remaining)
    })
  } finally {
    stub.restore()
  }
})

test('failures are recorded with a reason and count as missing art', async () => {
  const stub = stubFetch(() => new Response('nope', { status: 503 }))
  try {
    await withStore(async store => {
      const report = await store.updateAll({ retries: 1 })
      assert.equal(report.failed, report.total)
      assert.equal(report.unavailable, 0, '5xx is transient, not a phantom entry')
      assert.equal(report.failures[0]?.reason, 'HTTP 503')

      const image = await store.itemImage(1)
      assert.equal(image, undefined)
      assert.equal(store.missingAssets.length, 1)
      assert.equal(store.missingSample(1)[0]?.startsWith('items#1'), true)
    })
  } finally {
    stub.restore()
  }
})

test('404 is not retried and is reported verbatim', async () => {
  let calls = 0
  const stub = stubFetch(() => {
    calls += 1
    return new Response('gone', { status: 404 })
  })
  try {
    await withStore(async store => {
      const image = await store.characterImage(1)
      assert.equal(image, undefined)
      assert.equal(calls, 1, 'a 404 is permanent, so it must not be retried')
      assert.equal(store.missingAssets[0]?.reason, 'HTTP 404')
    })
  } finally {
    stub.restore()
  }
})

test('4xx targets are reported as unavailable, not as retryable failures', async () => {
  const stub = stubFetch(() => new Response('gone', { status: 404 }))
  try {
    await withStore(async store => {
      const report = await store.updateAll({ retries: 1 })
      assert.equal(report.complete, true)
      assert.equal(report.unavailable, report.total)
      assert.equal(report.failures.every(failure => failure.permanent === true), true)
    })
  } finally {
    stub.restore()
  }
})

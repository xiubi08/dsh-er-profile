import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssetStore } from '../src/data/assets.ts'
import { buildCharacterRating } from '../src/data/rating.ts'
import { renderPlayerCard } from '../src/render/profile.ts'
import { renderCharacterCard } from '../src/render/character.ts'
import { renderCharacterRating } from '../src/render/character-rank.ts'
import {
  makeCharacterCard, makeCharacterStats, makeDictionaries, makePlayerCard, materializeAssets,
} from './support/fixtures.ts'

const fontsDir = fileURLToPath(new URL('../assets/fonts', import.meta.url))

async function withStore(run: (store: AssetStore) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'er-render-'))
  const dictionaries = makeDictionaries()
  await materializeAssets(dataDir, dictionaries)
  const store = new AssetStore(
    dataDir,
    dictionaries.characters,
    dictionaries.tiers,
    dictionaries.items,
    dictionaries.skills,
    dictionaries.tactical,
    dictionaries.traits,
    dictionaries.masteries,
    { retries: 1, timeoutMs: 2_000 },
  )
  try {
    await run(store)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
}

function assertPng(png: Buffer, label: string): void {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label}: PNG signature`)
  assert.ok(png.byteLength > 20_000, `${label}: non-trivial PNG (${png.byteLength} bytes)`)
}

test('player card renders at the fixed width with no missing assets', async () => {
  await withStore(async store => {
    for (const matchCount of [10, 20]) {
      const card = makePlayerCard(matchCount)
      const rendered = await renderPlayerCard(card, store, fontsDir)
      assert.equal(rendered.width, 1080)
      assert.ok(rendered.height > 1200, `height scales with match count (${rendered.height})`)
      assertPng(rendered.png, `player/${matchCount}`)
      assert.deepEqual(store.missingAssets, [], 'every referenced asset exists')
    }
  })
})

test('character card renders with recommendations and art', async () => {
  await withStore(async store => {
    const card = makeCharacterCard()
    const rendered = await renderCharacterCard(card, store, 1, fontsDir)
    assert.ok(rendered.width > 0 && rendered.height > 0)
    assertPng(rendered.png, 'character')
  })
})

test('character rating grid renders one cell per entry', async () => {
  await withStore(async store => {
    const data = buildCharacterRating(makeCharacterStats(), makeDictionaries().characters, 'diamond_plus')
    const rendered = await renderCharacterRating(data, store, fontsDir)
    assert.ok(rendered.width > 0 && rendered.height > 0)
    assertPng(rendered.png, 'rank')
    assert.ok(data.entries.length > 0)
  })
})

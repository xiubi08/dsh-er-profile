import assert from 'node:assert/strict'
import test from 'node:test'
import { createTexts, normalizeLocale } from '../src/util/i18n.ts'

const playerView = {
  name: 'TestPlayer',
  seasonLabel: 'S12',
  modeLabel: '排位',
  mmr: 6556,
  tier: '星陨 IV',
  matches: 10,
  wins: 3,
  avgRank: 3.89,
  avgKill: 4.1,
  web: true,
  qq: false,
}

test('locale defaults to zh and only accepts known values', () => {
  assert.equal(normalizeLocale(undefined), 'zh')
  assert.equal(normalizeLocale('en'), 'en')
  assert.equal(normalizeLocale('zh-CN'), 'zh')
  assert.equal(normalizeLocale('klingon'), 'zh')
})

test('both locales render the same numbers', () => {
  const zh = createTexts('zh').playerSummary(playerView)
  const en = createTexts('en').playerSummary(playerView)
  for (const text of [zh, en]) {
    assert.match(text, /6556/u)
    assert.match(text, /3\.89/u)
    assert.match(text, /4\.10/u)
    assert.match(text, /TestPlayer/u)
  }
  assert.notEqual(zh, en)
})

test('asset report explains a partial run', () => {
  const texts = createTexts('zh')
  const partial = texts.assetReport({
    total: 100,
    ok: 40,
    changed: 2,
    downloaded: 3,
    adopted: 0,
    missing: 55,
    failed: 2,
    unavailable: 1,
    processed: 45,
    remaining: 55,
    complete: false,
    categories: [{ key: 'items', total: 60, ok: 30, changed: 1, missing: 29 }],
    failures: [{ category: 'items', key: '12' }, { category: 'skills', key: '999', permanent: true }],
  })
  assert.match(partial, /45\/100/u)
  assert.match(partial, /剩余 55/u)
  assert.match(partial, /再调用一次/u)
  assert.match(partial, /#12/u)
  assert.doesNotMatch(partial, /#999/u, '404 placeholders are summarized, not listed')
  assert.match(partial, /1 项在 CDN 上不可用/u)
})

test('missing-asset warning names the sample', () => {
  const text = createTexts('en').missingAssets(3, ['items#12 (HTTP 404)'])
  assert.match(text, /3 game assets/u)
  assert.match(text, /items#12/u)
})

test('a partial-art summary appends a visible note', () => {
  assert.match(createTexts('zh').missingNote(4), /4 张图片缺失/u)
  assert.match(createTexts('en').missingNote(4), /4 images are missing/u)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CHARACTER_ALIASES, resolveConfig } from '../src/config.ts'

test('defaults are stable and documented', () => {
  const config = resolveConfig(undefined)
  assert.equal(config.locale, 'zh')
  assert.equal(config.assetUpdateBudgetMs, 45_000)
  assert.equal(config.httpTimeoutMs, 20_000)
  assert.equal(config.httpRetries, 3)
  assert.equal(config.renderWorkers, 2)
  assert.equal(config.renderCacheTtlMs, 60_000)
  assert.deepEqual(config.outputRetention, { maxFiles: 200, maxAgeDays: 7 })
})

test('numeric options are clamped instead of trusted', () => {
  const config = resolveConfig({
    assetDownloadConcurrency: 999,
    assetUpdateBudgetMs: 1,
    httpTimeoutMs: 1,
    httpRetries: 0,
    renderWorkers: 0,
    renderCacheTtlMs: -5,
    outputRetention: { maxFiles: -1, maxAgeDays: 10_000 },
  })
  assert.equal(config.assetDownloadConcurrency, 32)
  assert.equal(config.assetUpdateBudgetMs, 5_000)
  assert.equal(config.httpTimeoutMs, 1_000)
  assert.equal(config.httpRetries, 1)
  assert.equal(config.renderWorkers, 1)
  assert.equal(config.renderCacheTtlMs, 0)
  assert.deepEqual(config.outputRetention, { maxFiles: 0, maxAgeDays: 3650 })
})

test('user aliases extend the defaults instead of replacing them', () => {
  const config = resolveConfig({ characterAliases: {  '新别名': 'Jackie', 猫: 'Aya' } })
  assert.equal(config.characterAliases['新别名'], 'Jackie')
  assert.equal(config.characterAliases['猫'], 'Aya')
  assert.equal(config.characterAliases['酒妹'], DEFAULT_CHARACTER_ALIASES['酒妹'])
})

test('locale normalizes to the supported set', () => {
  assert.equal(resolveConfig({ locale: 'EN' }).locale, 'en')
  assert.equal(resolveConfig({ locale: 'en-US' }).locale, 'en')
  assert.equal(resolveConfig({ locale: 'fr' }).locale, 'zh')
})

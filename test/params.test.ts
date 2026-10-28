import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MATCH_COUNT_MAX, MATCH_COUNT_MIN,
  parseCharacterQuery, parsePlayerQuery, parseRankQuery, resolveMode, validateSeason,
} from '../src/tool/params.ts'
import { ErError } from '../src/util/errors.ts'

test('season accepts the four documented spellings', () => {
  for (const value of ['S12', 'PS12', 'SEASON_21', 'PRE_SEASON_20', 's12']) {
    assert.equal(validateSeason(value), value)
  }
  assert.equal(validateSeason(undefined), undefined)
  assert.equal(validateSeason('   '), undefined)
})

test('season rejects free-form text instead of passing it to the API', () => {
  assert.throws(() => validateSeason('season 12'), error => {
    assert.ok(error instanceof ErError)
    assert.equal(error.code, 'invalid_argument')
    return true
  })
})

test('mode lookup is case-insensitive and rejects unknown values', () => {
  assert.equal(resolveMode('RANK').api, 'RANK')
  assert.equal(resolveMode('排位').api, 'RANK')
  assert.equal(resolveMode(undefined).api, 'ALL')
  assert.throws(() => resolveMode('arena'), /unknown mode/)
})

test('matchCount is clamped and the clamp is echoed', () => {
  const low = parsePlayerQuery({ player: 'P', matchCount: 1 })
  assert.equal(low.matchCount, MATCH_COUNT_MIN)
  assert.equal(low.applied.matchCountClamped, true)

  const high = parsePlayerQuery({ player: 'P', matchCount: 999 })
  assert.equal(high.matchCount, MATCH_COUNT_MAX)
  assert.equal(high.applied.matchCountClamped, true)

  const exact = parsePlayerQuery({ player: ' P ', matchCount: 15 })
  assert.equal(exact.player, 'P')
  assert.equal(exact.matchCount, 15)
  assert.equal(exact.applied.matchCountClamped, false)
})

test('player requires a non-empty name', () => {
  assert.throws(() => parsePlayerQuery({}), /player must be a non-empty string/)
  assert.throws(() => parsePlayerQuery({ player: '  ' }), /player must be a non-empty string/)
})

test('character tier aliases resolve to canonical keys', () => {
  assert.equal(parseCharacterQuery({ character: 'Jackie', tier: '灭钻' }).tier, 'diamond_plus')
  assert.equal(parseCharacterQuery({ character: 'Jackie' }).tier, 'diamond_plus')
  assert.throws(() => parseCharacterQuery({ character: 'Jackie', tier: 'bronze' }), /unknown tier/)
})

test('rank query reuses tier validation', () => {
  assert.deepEqual(parseRankQuery({ tier: 'in100' }), { tier: 'in1000', applied: { tier: 'in1000' } })
})

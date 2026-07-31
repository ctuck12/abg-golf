import { describe, it, expect } from 'vitest'

import { firstPlayedHole, isFirstPlayedHole, shouldOfferRandomBanker } from './banker-first-hole'

const front18 = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1 }))
const front9 = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1 }))
const back9 = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 10 }))

describe('which hole gets the roll', () => {
  it('is hole 1 on a full round', () => {
    expect(firstPlayedHole(front18)).toBe(1)
    expect(isFirstPlayedHole(front18, 1)).toBe(true)
    expect(isFirstPlayedHole(front18, 2)).toBe(false)
    expect(isFirstPlayedHole(front18, 10)).toBe(false)
  })

  it('is hole 10 on a back-nine round', () => {
    expect(firstPlayedHole(back9)).toBe(10)
    expect(isFirstPlayedHole(back9, 10)).toBe(true)
    expect(isFirstPlayedHole(back9, 1)).toBe(false)
    expect(isFirstPlayedHole(back9, 11)).toBe(false)
  })

  it('is hole 1 on a front-nine round', () => {
    expect(isFirstPlayedHole(front9, 1)).toBe(true)
    expect(isFirstPlayedHole(front9, 9)).toBe(false)
  })

  it('has no answer before the holes load', () => {
    expect(firstPlayedHole([])).toBeNull()
    expect(isFirstPlayedHole([], 1)).toBe(false)
  })
})

describe('when the Random button shows', () => {
  const base = { isFirstPlayedHole: true, bankerPlayerId: null, poolSize: 4 }

  it('shows on the opening hole with no banker yet', () => {
    expect(shouldOfferRandomBanker(base)).toBe(true)
  })

  it('goes away once a banker is set', () => {
    expect(shouldOfferRandomBanker({ ...base, bankerPlayerId: 'p1' })).toBe(false)
  })

  it('comes back if that banker is cleared', () => {
    const set = { ...base, bankerPlayerId: 'p1' }
    expect(shouldOfferRandomBanker(set)).toBe(false)
    const cleared = { ...set, bankerPlayerId: null }
    expect(shouldOfferRandomBanker(cleared)).toBe(true)
  })

  it('never shows on a later hole, banker or not', () => {
    expect(shouldOfferRandomBanker({ ...base, isFirstPlayedHole: false })).toBe(false)
    expect(shouldOfferRandomBanker({ ...base, isFirstPlayedHole: false, bankerPlayerId: 'p1' })).toBe(false)
  })

  it('stays hidden with nobody to draw from', () => {
    expect(shouldOfferRandomBanker({ ...base, poolSize: 0 })).toBe(false)
  })

  it('shows for a single-player pool', () => {
    expect(shouldOfferRandomBanker({ ...base, poolSize: 1 })).toBe(true)
  })
})

describe('the draw covers everyone offered', () => {
  // The pool passed to the roll is the same list rendered as chips, so every
  // player the scorekeeper can tap is a player the roll can land on.
  it('reaches every index over enough draws', () => {
    const pool = ['a', 'b', 'c', 'd']
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(pool[Math.floor(Math.random() * pool.length)])
    expect(seen.size).toBe(pool.length)
  })
})

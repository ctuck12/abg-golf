import { describe, it, expect } from 'vitest'

import { bankerDoubleScope, doublingAllowedOnHole } from './banker-doubles'

describe('bankerDoubleScope', () => {
  it('defaults to par 3s only when unset', () => {
    expect(bankerDoubleScope(null)).toBe('par3')
    expect(bankerDoubleScope(undefined)).toBe('par3')
    expect(bankerDoubleScope('')).toBe('par3')
  })

  it('reads a stored choice', () => {
    expect(bankerDoubleScope('par3')).toBe('par3')
    expect(bankerDoubleScope('all')).toBe('all')
  })

  it('falls back to the default on anything unrecognised', () => {
    expect(bankerDoubleScope('everything')).toBe('par3')
  })
})

describe('doublingAllowedOnHole', () => {
  it('par 3s only: offered on par 3, withheld on par 4 and 5', () => {
    expect(doublingAllowedOnHole('par3', 3)).toBe(true)
    expect(doublingAllowedOnHole('par3', 4)).toBe(false)
    expect(doublingAllowedOnHole('par3', 5)).toBe(false)
  })

  it('all holes: offered whatever the par', () => {
    for (const par of [3, 4, 5, 6]) expect(doublingAllowedOnHole('all', par)).toBe(true)
  })

  it('an unusual par 6 is not a par 3', () => {
    expect(doublingAllowedOnHole('par3', 6)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  generateBalancedTeams, teamsSignature, parseHcpInput, fmtHcp,
  type GeneratedPlayer,
} from './team-generator'

function pool(handicaps: (number | null)[]): GeneratedPlayer[] {
  return handicaps.map((h, i) => ({ id: `p${i}`, name: `Player ${i}`, handicap: h, source: 'roster' as const }))
}

describe('parseHcpInput', () => {
  it('stores plus handicaps as negative', () => {
    expect(parseHcpInput('+2')).toBe(-2)
    expect(parseHcpInput('+1.4')).toBe(-1.4)
  })
  it('reads ordinary and blank handicaps', () => {
    expect(parseHcpInput('14')).toBe(14)
    expect(parseHcpInput(' 8.4 ')).toBe(8.4)
    expect(parseHcpInput('')).toBeNull()
    expect(parseHcpInput('abc')).toBeNull()
  })
})

describe('fmtHcp', () => {
  it('renders negatives back as plus handicaps', () => {
    expect(fmtHcp(-2)).toBe('+2')
    expect(fmtHcp(0)).toBe('0')
    expect(fmtHcp(12.5)).toBe('12.5')
  })
})

describe('generateBalancedTeams', () => {
  it('places every player exactly once', () => {
    const players = pool([2, 5, 8, 11, 14, 17, 20, 23])
    const teams = generateBalancedTeams(players, 2)
    const ids = teams.flatMap(t => t.players.map(p => p.id)).sort()
    expect(ids).toEqual(players.map(p => p.id).sort())
  })

  it('splits as evenly as the player count allows', () => {
    const teams = generateBalancedTeams(pool([1, 4, 7, 10, 13, 16, 19, 22, 25]), 2)
    expect(teams.map(t => t.players.length).sort()).toEqual([4, 5])
  })

  it('balances team averages rather than clustering the low handicaps', () => {
    const teams = generateBalancedTeams(pool([0, 2, 4, 6, 18, 20, 22, 24]), 2)
    const avgs = teams.map(t => t.avgHandicap!)
    expect(Math.abs(avgs[0] - avgs[1])).toBeLessThanOrEqual(1)
  })

  it('leaves avgHandicap null when nobody on a team has one', () => {
    const teams = generateBalancedTeams(pool([null, null]), 2)
    expect(teams.every(t => t.avgHandicap === null)).toBe(true)
  })

  it('sorts players within a team best first, unknown handicaps last', () => {
    const teams = generateBalancedTeams(pool([10, 4, null, 7]), 1)
    expect(teams[0].players.map(p => p.handicap)).toEqual([4, 7, 10, null])
  })

  it('produces a different arrangement when re-rolled with an rng', () => {
    const players = pool([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23])
    const base = teamsSignature(generateBalancedTeams(players, 3))
    const rerolls = Array.from({ length: 15 }, () =>
      teamsSignature(generateBalancedTeams(players, 3, Math.random)))
    expect(rerolls.some(sig => sig !== base)).toBe(true)
  })
})

describe('teamsSignature', () => {
  it('ignores team order and within-team order', () => {
    const a = generateBalancedTeams(pool([2, 6, 10, 14]), 2)
    const b = [a[1], a[0]].map(t => ({ ...t, players: [...t.players].reverse() }))
    expect(teamsSignature(b)).toBe(teamsSignature(a))
  })
})

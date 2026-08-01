import { describe, it, expect } from 'vitest'

import { bankerStrokeMatrix, effectiveHcp, strokeHolesFor } from './banker-strokes'

// A real foursome: the handicaps from the group in the screenshots.
const PLAYERS = [
  { id: 'luke', name: 'Luke', handicap: 3.6 },
  { id: 'bacon', name: 'Bacon', handicap: 4.3 },
  { id: 'tyler', name: 'Tyler', handicap: 4.8 },
  { id: 'kirby', name: 'Kirby', handicap: 9.4 },
]

// Stroke indexes deliberately not in hole order, so "hardest holes" can't be
// confused with "first holes".
const HOLES = [
  { hole_number: 1, stroke_index: 7 },
  { hole_number: 2, stroke_index: 2 },
  { hole_number: 3, stroke_index: 4 },
  { hole_number: 4, stroke_index: 10 },
  { hole_number: 5, stroke_index: 1 },
  { hole_number: 6, stroke_index: 5 },
  { hole_number: 7, stroke_index: 3 },
  { hole_number: 8, stroke_index: 9 },
  { hole_number: 9, stroke_index: 6 },
]

const rowFor = (blocks: ReturnType<typeof bankerStrokeMatrix>, banker: string, opponent: string) =>
  blocks.find((b) => b.bankerId === banker)!.rows.find((r) => r.opponentId === opponent)!

describe('effectiveHcp', () => {
  it('rounds up at .5 under Round Up', () => {
    expect(effectiveHcp(4.8, 'nearest')).toBe(5)
    expect(effectiveHcp(3.6, 'nearest')).toBe(4)
  })

  it('truncates under Round Down', () => {
    expect(effectiveHcp(4.8, 'down')).toBe(4)
    expect(effectiveHcp(9.4, 'down')).toBe(9)
  })

  it('floors a plus handicap at scratch', () => {
    expect(effectiveHcp(-1.2, 'nearest')).toBe(0)
  })
})

describe('strokeHolesFor', () => {
  it('takes the hardest holes, listed in playing order', () => {
    // stroke index 1,2,3 → holes 5,2,7
    expect(strokeHolesFor(3, HOLES)).toEqual([2, 5, 7])
  })

  it('gives nothing for no difference', () => {
    expect(strokeHolesFor(0, HOLES)).toEqual([])
    expect(strokeHolesFor(-2, HOLES)).toEqual([])
  })

  it('never exceeds the holes that have an index', () => {
    expect(strokeHolesFor(50, HOLES)).toHaveLength(HOLES.length)
  })

  it('skips holes with no stroke index', () => {
    const partial = [{ hole_number: 1, stroke_index: 1 }, { hole_number: 2, stroke_index: null }]
    expect(strokeHolesFor(5, partial)).toEqual([1])
  })
})

describe('bankerStrokeMatrix', () => {
  const blocks = bankerStrokeMatrix(PLAYERS, HOLES, 'nearest')

  it('covers every player as banker', () => {
    expect(blocks.map((b) => b.bankerId)).toEqual(['luke', 'bacon', 'tyler', 'kirby'])
    for (const b of blocks) expect(b.rows).toHaveLength(3)
  })

  it('gives the shot to the higher handicap', () => {
    // Luke 4 banks, Kirby 9 gets 5
    const r = rowFor(blocks, 'luke', 'kirby')
    expect(r.direction).toBe('opponent')
    expect(r.strokes).toBe(5)
    expect(r.holes).toEqual([2, 3, 5, 6, 7])   // stroke index 1-5
  })

  it('gives the banker the shot when the banker is the higher handicap', () => {
    // Kirby 9 banks against Luke 4 — the banker strokes
    const r = rowFor(blocks, 'kirby', 'luke')
    expect(r.direction).toBe('banker')
    expect(r.strokes).toBe(5)
  })

  it('plays equal handicaps head up', () => {
    // Luke 3.6 and Bacon 4.3 both round to 4
    expect(rowFor(blocks, 'luke', 'bacon').direction).toBe('even')
    expect(rowFor(blocks, 'luke', 'bacon').holes).toEqual([])
    expect(rowFor(blocks, 'bacon', 'luke').direction).toBe('even')
  })

  it('is symmetric: each pair points the same way from both sides', () => {
    for (const b of blocks) {
      for (const r of b.rows) {
        const mirror = rowFor(blocks, r.opponentId, b.bankerId)
        expect(mirror.strokes).toBe(r.strokes)
        expect(mirror.direction).toBe(
          r.direction === 'even' ? 'even' : r.direction === 'opponent' ? 'banker' : 'opponent',
        )
      }
    }
  })

  it('reproduces the head-up case that prompted this', () => {
    // Kirby 9 banks: strokes on Luke and Bacon (both 4), but Tyler is 5 — so
    // Kirby is only 4 clear of Tyler and they play the 5th-hardest hole even.
    const vsTyler = rowFor(blocks, 'kirby', 'tyler')
    expect(vsTyler.direction).toBe('banker')
    expect(vsTyler.strokes).toBe(4)
    expect(vsTyler.holes).toEqual([2, 3, 5, 7])          // stroke index 1-4
    expect(rowFor(blocks, 'kirby', 'luke').holes).toEqual([2, 3, 5, 6, 7])  // 1-5
    // Hole 6 is stroke index 5: Kirby strokes Luke there but not Tyler.
    expect(vsTyler.holes).not.toContain(6)
  })

  it('leaves out players with no handicap on file', () => {
    const withUnknown = [...PLAYERS, { id: 'guest', name: 'Guest', handicap: null }]
    const b = bankerStrokeMatrix(withUnknown, HOLES, 'nearest')
    expect(b.map((x) => x.bankerId)).not.toContain('guest')
    for (const block of b) expect(block.rows.map((r) => r.opponentId)).not.toContain('guest')
  })

  it('follows the round’s rounding setting', () => {
    // Round Down: Tyler 4.8 -> 4, level with Bacon 4.3 -> 4
    const down = bankerStrokeMatrix(PLAYERS, HOLES, 'down')
    expect(rowFor(down, 'bacon', 'tyler').direction).toBe('even')
    // ...but Round Up makes Tyler 5, so he takes one
    expect(rowFor(blocks, 'bacon', 'tyler').direction).toBe('opponent')
    expect(rowFor(blocks, 'bacon', 'tyler').strokes).toBe(1)
  })
})

import { describe, it, expect } from 'vitest'
import {
  computeHoleDaytona,
  computeTeamDaytonaSummary,
  computeHoleBallScores,
  roundHcp,
  computeBBStrokeHoles,
  applyPlayerStrokesToScoreMap,
  playerCoversHole,
  sortPlayersForDisplay,
  sortRoundPlayersByTeam,
  MANUAL_ORDER_BASE,
  computeSkinsResults,
  computeSkinsPotResults,
  computePlayerDaytonaPointsSplit,
  daytonaAutoStrokeIds,
  bankerStrokeSplit,
} from './scoring'

// ── Helpers ──────────────────────────────────────────────────────────────────

const hole = (hole_number: number, par = 4) => ({ hole_number, par })
const score = (player_id: string, hole_number: number, strokes: number) => ({ player_id, hole_number, strokes })

// ── Daytona hole math ────────────────────────────────────────────────────────

describe('computeHoleDaytona', () => {
  it('returns null with fewer than two scores', () => {
    expect(computeHoleDaytona([4], 4)).toBeNull()
    expect(computeHoleDaytona([], 4)).toBeNull()
  })

  // Confirmed by the owner: the Daytona number is the leading ball × 10; the
  // second ball matters only through the flip rules. (4+5 → 40, flipped → 50.)
  it('uses the low ball × 10 when best score is par or better', () => {
    expect(computeHoleDaytona([4, 5], 4)).toBe(40)
    expect(computeHoleDaytona([3, 6], 4)).toBe(30)
  })

  it('rule 1: uses the high ball × 10 when best score is over par', () => {
    expect(computeHoleDaytona([5, 7], 4)).toBe(70)
    expect(computeHoleDaytona([5, 5], 4)).toBe(50)
  })

  it('rule 2: another team with a strictly better under-par score forces a flip', () => {
    expect(computeHoleDaytona([4, 5], 4, [3])).toBe(50)
  })

  it('rule 2: tied under-par levels cancel — no flip', () => {
    expect(computeHoleDaytona([3, 5], 4, [3])).toBe(30)
  })

  it('picks the two lowest of more than two scores', () => {
    expect(computeHoleDaytona([6, 4, 5], 4)).toBe(40)
  })
})

describe('computeTeamDaytonaSummary', () => {
  it('splits front and back totals and counts holes played', () => {
    const holes = [hole(1), hole(10)]
    const scores = [
      score('a', 1, 4), score('b', 1, 5),
      score('a', 10, 5), score('b', 10, 6),
    ]
    const s = computeTeamDaytonaSummary(holes, ['a', 'b'], scores)
    expect(s.frontTotal).toBe(40)
    expect(s.backTotal).toBe(60) // 5,6 on par 4 → over-par flip, high ball × 10
    expect(s.total).toBe(100)
    expect(s.holesPlayed).toBe(2)
  })

  it('skips holes where fewer than two players have scores', () => {
    const s = computeTeamDaytonaSummary([hole(1)], ['a', 'b'], [score('a', 1, 4)])
    expect(s.total).toBeNull()
    expect(s.holesPlayed).toBe(0)
  })
})

describe('computePlayerDaytonaPointsSplit', () => {
  const side = (player_id: string, hole_number: number, s: 'left' | 'right') => ({ player_id, hole_number, side: s })

  // A halved 5-man hole leaves every total at 0, and the 5-man branch only
  // records non-zero points — so the map comes back empty even though the hole
  // was played. Anything reading it must not treat "empty" as "nothing played".
  it('returns an empty map when a 5-man hole is halved by every pairing', () => {
    const assignments = [
      side('bacon', 1, 'left'), side('jon', 1, 'left'),
      side('chip', 1, 'right'), side('tyler', 1, 'right'), side('dillon', 1, 'right'),
    ]
    const netScores = [
      score('bacon', 1, 3), score('jon', 1, 4),
      score('chip', 1, 3), score('tyler', 1, 3), score('dillon', 1, 3),
    ]
    expect(computePlayerDaytonaPointsSplit([hole(1)], netScores, assignments, '5man-normal', null).size).toBe(0)
  })

  it('records points when the pairings are not halved', () => {
    const assignments = [
      side('bacon', 1, 'left'), side('jon', 1, 'left'),
      side('chip', 1, 'right'), side('tyler', 1, 'right'), side('dillon', 1, 'right'),
    ]
    const grossScores = [
      score('bacon', 1, 4), score('jon', 1, 5),
      score('chip', 1, 3), score('tyler', 1, 4), score('dillon', 1, 4),
    ]
    const pts = computePlayerDaytonaPointsSplit([hole(1)], grossScores, assignments, '5man-normal', null)
    expect(pts.get('bacon')).toBe(-40)
    expect(pts.get('jon')).toBe(-40)
    expect(pts.get('chip')).toBe(40)
  })
})

// ── Automatic stroke holes ───────────────────────────────────────────────────

describe('daytonaAutoStrokeIds', () => {
  // The group that surfaced this: rounding moves the low player, not the high
  // one, so it shifts everybody's allowance by a stroke.
  const group = [
    { id: 'chip', handicap: 2.7 },
    { id: 'bacon', handicap: 4.3 },
    { id: 'tyler', handicap: 4.8 },
    { id: 'dillon', handicap: 6.3 },
    { id: 'jon', handicap: 12.3 },
  ]
  const hcps = group.map((p) => p.handicap)
  const si = (stroke_index: number) => ({ hole_number: 5, par: 4, stroke_index })

  it('rounds down: low plays to 2, so the 12.3 gets 10 and strokes on SI 10', () => {
    expect(daytonaAutoStrokeIds(si(10), group, hcps, 'down')).toContain('jon')
  })

  it('rounds up: low plays to 3, so the 12.3 gets 9 and SI 10 is out of reach', () => {
    expect(daytonaAutoStrokeIds(si(10), group, hcps, 'nearest')).toEqual([])
    expect(daytonaAutoStrokeIds(si(9), group, hcps, 'nearest')).toEqual(['jon'])
  })

  it('gives the low player nothing and holes with no index nothing', () => {
    expect(daytonaAutoStrokeIds(si(1), group, hcps, 'down')).not.toContain('chip')
    expect(daytonaAutoStrokeIds({ hole_number: 5 }, group, hcps, 'down')).toEqual([])
  })

  it('strokes off the wider group when one is supplied', () => {
    const team = [{ id: 'jon', handicap: 12.3 }]
    // Alone, Jon is his own low; against the group he is 10 clear of Chip
    expect(daytonaAutoStrokeIds(si(10), team, [12.3], 'down')).toEqual([])
    expect(daytonaAutoStrokeIds(si(10), team, hcps, 'down')).toEqual(['jon'])
  })

  it('ignores players with no handicap on file', () => {
    const withUnknown = [...group, { id: 'ghost', handicap: null }]
    expect(daytonaAutoStrokeIds(si(10), withUnknown, hcps, 'down')).not.toContain('ghost')
  })
})

describe('bankerStrokeSplit', () => {
  const players = [
    { id: 'banker', handicap: 9 },
    { id: 'low', handicap: 4 },
    { id: 'high', handicap: 14 },
  ]
  const at = (stroke_index: number) => ({ hole_number: 3, par: 4, stroke_index })

  it('gives the shot to whoever of the pair is higher', () => {
    const s = bankerStrokeSplit(at(3), players, 'banker', 'down')
    expect(s.opponentsGetting).toEqual(['high'])   // 14 − 9 = 5, SI 3 ≤ 5
    expect(s.bankerGettingFrom).toEqual(['low'])   // 9 − 4 = 5, SI 3 ≤ 5
    // What gets stored: the opponent taking one, plus the banker taking one
    expect(s.all).toEqual(['high', 'banker'])
  })

  it('drops both sides once the hole is easier than the differential', () => {
    expect(bankerStrokeSplit(at(6), players, 'banker', 'down')).toEqual({
      opponentsGetting: [], bankerGettingFrom: [], all: [],
    })
  })

  it('is empty with no banker set or no index', () => {
    expect(bankerStrokeSplit(at(3), players, null, 'down').all).toEqual([])
    expect(bankerStrokeSplit({ hole_number: 3 }, players, 'banker', 'down').all).toEqual([])
  })
})

// ── Ball scores ──────────────────────────────────────────────────────────────

describe('computeHoleBallScores', () => {
  it('returns the N lowest strokes as balls, nulls when short of players', () => {
    expect(computeHoleBallScores([5, 3, 4, 6], 3)).toEqual([3, 4, 5])
    expect(computeHoleBallScores([5, 3], 3)).toEqual([3, 5, null])
  })
})

// ── Handicap rounding ────────────────────────────────────────────────────────

describe('roundHcp', () => {
  it('nearest rounds half-up', () => {
    expect(roundHcp(7.5, 'nearest')).toBe(8)
    expect(roundHcp(7.4, 'nearest')).toBe(7)
  })

  it('default mode floors', () => {
    expect(roundHcp(7.9, 'down')).toBe(7)
    expect(roundHcp(7.9, null)).toBe(7)
  })

  it('trunc fallback truncates', () => {
    expect(roundHcp(7.9, null, 'trunc')).toBe(7)
  })
})

// ── Best Ball stroke allocation ──────────────────────────────────────────────

describe('computeBBStrokeHoles', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, stroke_index: i + 1 }))

  it('allocates strokes to the hardest holes first', () => {
    const out = computeBBStrokeHoles({ p1: 2 }, holes)
    expect(out.p1).toEqual({ 1: 1, 2: 1 })
  })

  it('wraps past 18 strokes onto the hardest holes again', () => {
    const out = computeBBStrokeHoles({ p1: 20 }, holes)
    expect(out.p1[1]).toBe(2)
    expect(out.p1[2]).toBe(2)
    expect(out.p1[3]).toBe(1)
    expect(Object.values(out.p1).reduce((a, b) => a + b, 0)).toBe(20)
  })

  it('rounds fractional strokes per the rounding mode and skips zero', () => {
    expect(computeBBStrokeHoles({ p1: 0.9 }, holes)).toEqual({})
    expect(computeBBStrokeHoles({ p1: 0.9 }, holes, 'nearest').p1).toEqual({ 1: 1 })
  })
})

describe('applyPlayerStrokesToScoreMap', () => {
  it('subtracts strokes only on stroke holes for players who have them', () => {
    const adjusted = applyPlayerStrokesToScoreMap(
      { p1: { 1: 5, 2: 4 }, p2: { 1: 4 } },
      { p1: { 1: 1 } },
    )
    expect(adjusted.p1).toEqual({ 1: 4, 2: 4 })
    expect(adjusted.p2).toEqual({ 1: 4 })
  })
})

// ── Holes range ──────────────────────────────────────────────────────────────

describe('playerCoversHole', () => {
  it('front9 covers 1-9 only, back9 covers 10-18 only, anything else covers all', () => {
    expect(playerCoversHole('front9', 9)).toBe(true)
    expect(playerCoversHole('front9', 10)).toBe(false)
    expect(playerCoversHole('back9', 9)).toBe(false)
    expect(playerCoversHole('back9', 10)).toBe(true)
    expect(playerCoversHole('all', 18)).toBe(true)
    expect(playerCoversHole(null, 1)).toBe(true)
  })
})

// ── Display ordering ─────────────────────────────────────────────────────────

describe('sortPlayersForDisplay', () => {
  it('defaults to handicap low-to-high with nulls last', () => {
    const out = sortPlayersForDisplay([
      { position: 0, handicap: 12.3 },
      { position: 1, handicap: 3 },
      { position: 2, handicap: null },
      { position: 3, handicap: 4.8 },
    ])
    expect(out.map((p) => p.handicap)).toEqual([3, 4.8, 12.3, null])
  })

  it('uses position order once any position marks a manual drag', () => {
    const out = sortPlayersForDisplay([
      { position: MANUAL_ORDER_BASE + 1, handicap: 3 },
      { position: MANUAL_ORDER_BASE, handicap: 12.3 },
    ])
    expect(out.map((p) => p.handicap)).toEqual([12.3, 3])
  })
})

describe('sortRoundPlayersByTeam', () => {
  it('applies the rule per team, so one dragged team does not affect another', () => {
    const out = sortRoundPlayersByTeam([
      { team_id: 't1', position: 0, handicap: 9 },
      { team_id: 't1', position: 1, handicap: 3 },
      { team_id: 't2', position: MANUAL_ORDER_BASE + 1, handicap: 2 },
      { team_id: 't2', position: MANUAL_ORDER_BASE, handicap: 8 },
    ])
    const t1 = out.filter((p) => p.team_id === 't1').map((p) => p.handicap)
    const t2 = out.filter((p) => p.team_id === 't2').map((p) => p.handicap)
    expect(t1).toEqual([3, 9])   // HCP order (no manual positions)
    expect(t2).toEqual([8, 2])   // dragged order wins
  })
})

// ── Skins: per-hole mode ─────────────────────────────────────────────────────

describe('computeSkinsResults', () => {
  const players = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ]

  it('sole lowest at or under par wins the skin', () => {
    const res = computeSkinsResults([hole(1)], [score('a', 1, 3), score('b', 1, 4), score('c', 1, 5)], players, 0)
    expect(res.skins[0]).toMatchObject({ status: 'won', winnerId: 'a', winnerScore: 3 })
    expect(res.skinsWon).toBe(1)
  })

  it('a tie for lowest washes the hole', () => {
    const res = computeSkinsResults([hole(1)], [score('a', 1, 3), score('b', 1, 3)], players, 0)
    expect(res.skins[0].status).toBe('tied')
    expect(res.skinsWon).toBe(0)
  })

  it('no skin when every score is over par', () => {
    const res = computeSkinsResults([hole(1)], [score('a', 1, 5), score('b', 1, 6)], players, 0)
    expect(res.skins[0].status).toBe('no_qualifier')
  })

  it('holes with no scores are pending', () => {
    const res = computeSkinsResults([hole(1)], [], players, 0)
    expect(res.skins[0].status).toBe('pending')
  })

  it('winner collects the amount from every other participant', () => {
    const res = computeSkinsResults([hole(1)], [score('a', 1, 3), score('b', 1, 4), score('c', 1, 5)], players, 5)
    expect(res.playerNet).toEqual({ a: 10, b: -5, c: -5 })
    expect(res.settlements).toHaveLength(2)
    expect(res.settlements.every((s) => s.toId === 'a' && s.amount === 5)).toBe(true)
  })

  it('ignores scores on holes outside a participant\'s holes range', () => {
    // A was flipped to front9 after posting a 3 on hole 10 — the stale score
    // must not win (or block) the back-nine skin. Regression for the
    // holes_range filter added to skins.
    const ranged = [
      { id: 'a', name: 'A', holes_range: 'front9' },
      { id: 'b', name: 'B', holes_range: 'all' },
    ]
    const res = computeSkinsResults([hole(10)], [score('a', 10, 3), score('b', 10, 4)], ranged, 0)
    expect(res.skins[0]).toMatchObject({ status: 'won', winnerId: 'b' })
  })
})

// ── Skins: winner-take-pot mode ──────────────────────────────────────────────

describe('computeSkinsPotResults', () => {
  const players = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ]

  it('holds the money until every participant has completed their holes', () => {
    const res = computeSkinsPotResults([hole(1), hole(10)],
      [score('a', 1, 3), score('b', 1, 4), score('c', 1, 4), score('a', 10, 4), score('b', 10, 5)],
      players, 10)
    expect(res.complete).toBe(false)
    expect(res.playerNet).toEqual({ a: 0, b: 0, c: 0 })
  })

  it('a front9 participant only needs the front nine to count as complete', () => {
    const ranged = [
      { id: 'a', name: 'A', holes_range: 'front9' },
      { id: 'b', name: 'B', holes_range: 'all' },
    ]
    const res = computeSkinsPotResults([hole(1), hole(10)],
      [score('a', 1, 3), score('b', 1, 4), score('b', 10, 4)],
      ranged, 10)
    expect(res.complete).toBe(true)
  })

  it('most skins takes the whole pot once complete', () => {
    const res = computeSkinsPotResults([hole(1), hole(10)],
      [
        score('a', 1, 3), score('b', 1, 4), score('c', 1, 4),
        score('a', 10, 3), score('b', 10, 4), score('c', 10, 4),
      ],
      players, 10)
    expect(res.complete).toBe(true)
    expect(res.potTotal).toBe(30)
    expect(res.playerNet).toEqual({ a: 20, b: -10, c: -10 })
    expect(res.settlements.every((s) => s.toId === 'a' && s.amount === 10)).toBe(true)
  })

  it('a tie for most skins splits the pot evenly', () => {
    const res = computeSkinsPotResults([hole(1), hole(10)],
      [
        score('a', 1, 3), score('b', 1, 4), score('c', 1, 4),
        score('a', 10, 4), score('b', 10, 3), score('c', 10, 4),
      ],
      players, 12)
    expect(res.leaders.map((l) => l.id).sort()).toEqual(['a', 'b'])
    expect(res.playerNet).toEqual({ a: 6, b: 6, c: -12 })
  })
})

// ── GHIN index parsing ───────────────────────────────────────────────────────

import { parseGhinIndex } from './ghin'

describe('parseGhinIndex', () => {
  it('parses plain and plus handicaps, treats NH/blank as null', () => {
    expect(parseGhinIndex('5.2')).toBe(5.2)
    expect(parseGhinIndex('+1.4')).toBe(-1.4)
    expect(parseGhinIndex('NH')).toBeNull()
    expect(parseGhinIndex('')).toBeNull()
    expect(parseGhinIndex(null)).toBeNull()
    expect(parseGhinIndex(3)).toBe(3)
  })
})

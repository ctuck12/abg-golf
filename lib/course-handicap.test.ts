import { describe, it, expect } from 'vitest'
import {
  courseHandicap,
  scoreDifferential,
  netDoubleBogey,
  adjustedGrossScore,
  hasTeeRating,
} from './course-handicap'

// ACC North, the course this was built against: par 71
const tee = { courseRating: 71.2, slopeRating: 129, par: 71 }

describe('courseHandicap', () => {
  it('scales the index by slope and adds the rating-minus-par adjustment', () => {
    // 12.3 × (129/113) + 0.2 = 14.04… → 14
    expect(courseHandicap(12.3, tee)).toBe(14)
    // 2.7 × (129/113) + 0.2 = 3.28… → 3
    expect(courseHandicap(2.7, tee)).toBe(3)
  })

  it('keeps a plus handicap below scratch', () => {
    expect(courseHandicap(-1.4, tee)).toBe(-1)
  })

  it('is the index itself on a 113-slope tee rated at par', () => {
    expect(courseHandicap(9, { courseRating: 72, slopeRating: 113, par: 72 })).toBe(9)
  })

  it('carries the rating-minus-par term when a tee is rated above or below par', () => {
    expect(courseHandicap(0, { courseRating: 74.5, slopeRating: 113, par: 71 })).toBe(4)
    expect(courseHandicap(0, { courseRating: 68.1, slopeRating: 113, par: 71 })).toBe(-3)
  })
})

describe('scoreDifferential', () => {
  it('rounds to the nearest tenth', () => {
    // (113/129) × (85 − 71.2) = 12.08…
    expect(scoreDifferential(85, tee)).toBe(12.1)
  })

  it('is the raw difference on a 113-slope tee', () => {
    expect(scoreDifferential(85, { courseRating: 72, slopeRating: 113, par: 72 })).toBe(13)
  })

  it('goes negative when the round beats the rating', () => {
    expect(scoreDifferential(68, tee)).toBe(-2.8)
  })

  it('subtracts the playing conditions calculation when one is supplied', () => {
    expect(scoreDifferential(85, tee, 1)).toBe(11.2)
  })
})

describe('netDoubleBogey', () => {
  it('is par + 2 with no stroke', () => {
    expect(netDoubleBogey(4, 0)).toBe(6)
  })

  it('adds the strokes the player receives on the hole', () => {
    expect(netDoubleBogey(4, 1)).toBe(7)
    expect(netDoubleBogey(3, 2)).toBe(7)
  })

  it('ignores a negative stroke count rather than lowering the cap', () => {
    expect(netDoubleBogey(4, -1)).toBe(6)
  })
})

describe('adjustedGrossScore', () => {
  const holes = [
    { hole_number: 1, par: 4 },
    { hole_number: 2, par: 4 },
    { hole_number: 3, par: 3 },
  ]

  it('caps each hole at net double bogey and leaves the gross alone', () => {
    // Hole 1: 9 on a par 4 with a stroke → capped at 7. Others under the cap.
    const r = adjustedGrossScore(holes, (h) => ({ 1: 9, 2: 4, 3: 3 })[h], (h) => (h === 1 ? 1 : 0))
    expect(r.gross).toBe(16)
    expect(r.adjusted).toBe(14)
    expect(r.holesCounted).toBe(3)
  })

  it('leaves a clean round untouched', () => {
    const r = adjustedGrossScore(holes, (h) => ({ 1: 4, 2: 5, 3: 3 })[h], () => 0)
    expect(r.adjusted).toBe(r.gross)
    expect(r.adjusted).toBe(12)
  })

  // A round still being entered shouldn't look like a finished one
  it('skips unplayed holes and reports how many counted', () => {
    const r = adjustedGrossScore(holes, (h) => (h === 1 ? 4 : null), () => 0)
    expect(r.adjusted).toBe(4)
    expect(r.holesCounted).toBe(1)
  })
})

describe('hasTeeRating', () => {
  it('needs both a rating and a usable slope', () => {
    expect(hasTeeRating({ course_rating: 71.2, slope_rating: 129 })).toBe(true)
    expect(hasTeeRating({ course_rating: 71.2, slope_rating: null })).toBe(false)
    expect(hasTeeRating({ course_rating: null, slope_rating: 129 })).toBe(false)
    // A zero slope would divide by zero in every formula above
    expect(hasTeeRating({ course_rating: 71.2, slope_rating: 0 })).toBe(false)
  })
})

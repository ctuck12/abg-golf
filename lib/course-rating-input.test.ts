import { describe, it, expect } from 'vitest'
import { parseTees } from './course-rating-input'

const ok = (raw: unknown) => {
  const r = parseTees(raw)
  if ('error' in r) throw new Error(`unexpected error: ${r.error}`)
  return r.tees
}
const err = (raw: unknown) => {
  const r = parseTees(raw)
  return 'error' in r ? r.error : null
}

describe('parseTees', () => {
  it('takes a valid tee and normalises the rating to one decimal', () => {
    expect(ok([{ name: ' Blue ', course_rating: '71.23', slope_rating: '129' }])).toEqual([
      { name: 'Blue', course_rating: 71.2, slope_rating: 129, ghin_course_id: null, ghin_tee_set_id: null, position: 0 },
    ])
  })

  it('numbers the tees in the order given', () => {
    const tees = ok([
      { name: 'Blue', course_rating: '71.2', slope_rating: '129' },
      { name: 'White', course_rating: '69.4', slope_rating: '121' },
    ])
    expect(tees.map((t) => [t.name, t.position])).toEqual([['Blue', 0], ['White', 1]])
  })

  it('drops a blank spare row instead of failing', () => {
    expect(ok([{ name: 'Blue', course_rating: '71.2', slope_rating: '129' }, { name: '', course_rating: '', slope_rating: '' }]))
      .toHaveLength(1)
  })

  it('takes a tee with no rating yet', () => {
    expect(ok([{ name: 'Blue' }])[0]).toMatchObject({ name: 'Blue', course_rating: null, slope_rating: null })
  })

  it('needs a name once anything else is filled in', () => {
    expect(err([{ name: '', course_rating: '71.2', slope_rating: '129' }])).toMatch(/needs a name/)
  })

  it('rejects duplicate tee names, ignoring case', () => {
    expect(err([{ name: 'Blue' }, { name: 'blue' }])).toMatch(/two tees called/)
  })

  it('rejects ratings outside the plausible range', () => {
    expect(err([{ name: 'Blue', course_rating: '7.2', slope_rating: '129' }])).toMatch(/between 55 and 85/)
    expect(err([{ name: 'Blue', course_rating: '71.2', slope_rating: '400' }])).toMatch(/between 55 and 155/)
  })

  it('rejects a non-numeric rating and a fractional slope', () => {
    expect(err([{ name: 'Blue', course_rating: 'blue', slope_rating: '129' }])).toMatch(/must be a number/)
    expect(err([{ name: 'Blue', course_rating: '71.2', slope_rating: '129.5' }])).toMatch(/whole number/)
  })

  it('refuses half a tee — neither figure is usable alone', () => {
    expect(err([{ name: 'Blue', course_rating: '71.2' }])).toMatch(/needs a slope rating/)
    expect(err([{ name: 'Blue', slope_rating: '129' }])).toMatch(/needs a course rating/)
  })

  it('carries the GHIN identifiers through as trimmed text', () => {
    expect(ok([{ name: 'Blue', ghin_course_id: ' 12345 ', ghin_tee_set_id: '678' }])[0])
      .toMatchObject({ ghin_course_id: '12345', ghin_tee_set_id: '678' })
  })

  it('treats a missing list as no tees', () => {
    expect(ok(undefined)).toEqual([])
    expect(err('nope')).toMatch(/must be a list/)
  })
})

// Validating tee input on its way into course_tees.
//
// Both course routes go through this, so the create and edit paths can't accept
// different things. A rating that's out of range would produce a silently wrong
// Score Differential rather than an obvious failure, so it's rejected here as
// well as by the CHECK constraints in the database.

export type TeeRow = {
  name: string
  course_rating: number | null
  slope_rating: number | null
  ghin_course_id: string | null
  ghin_tee_set_id: string | null
  position: number
}

const RATING_MIN = 55, RATING_MAX = 85
const SLOPE_MIN = 55, SLOPE_MAX = 155

const text = (v: unknown): string => String(v ?? '').trim()
const optionalText = (v: unknown): string | null => text(v) === '' ? null : text(v)

/** Parses the tee list a course form submits. Rows with no name at all are
 *  dropped, so an empty spare row in the UI isn't an error. */
export function parseTees(raw: unknown): { tees: TeeRow[] } | { error: string } {
  if (raw === undefined) return { tees: [] }
  if (!Array.isArray(raw)) return { error: 'Tees must be a list.' }

  const tees: TeeRow[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>
    const name = text(e.name)
    const ratingRaw = text(e.course_rating)
    const slopeRaw = text(e.slope_rating)
    // Nothing filled in — a spare row, not a mistake
    if (!name && !ratingRaw && !slopeRaw) continue
    if (!name) return { error: 'Every tee needs a name, e.g. Blue.' }

    const key = name.toLowerCase()
    if (seen.has(key)) return { error: `There are two tees called ${name}.` }
    seen.add(key)

    let course_rating: number | null = null
    if (ratingRaw !== '') {
      const n = Number(ratingRaw)
      if (!isFinite(n)) return { error: `${name}: course rating must be a number, e.g. 71.2.` }
      if (n < RATING_MIN || n > RATING_MAX) {
        return { error: `${name}: course rating should be between ${RATING_MIN} and ${RATING_MAX}.` }
      }
      course_rating = Math.round(n * 10) / 10
    }

    let slope_rating: number | null = null
    if (slopeRaw !== '') {
      const n = Number(slopeRaw)
      if (!Number.isInteger(n)) return { error: `${name}: slope rating must be a whole number, e.g. 129.` }
      if (n < SLOPE_MIN || n > SLOPE_MAX) {
        return { error: `${name}: slope rating should be between ${SLOPE_MIN} and ${SLOPE_MAX}.` }
      }
      slope_rating = n
    }

    // One without the other can't produce a differential, and a half-filled tee
    // is more likely a slip than an intention.
    if (course_rating != null && slope_rating == null) return { error: `${name}: a course rating needs a slope rating too.` }
    if (slope_rating != null && course_rating == null) return { error: `${name}: a slope rating needs a course rating too.` }

    tees.push({
      name,
      course_rating,
      slope_rating,
      ghin_course_id: optionalText(e.ghin_course_id),
      ghin_tee_set_id: optionalText(e.ghin_tee_set_id),
      position: tees.length,
    })
  }
  return { tees }
}

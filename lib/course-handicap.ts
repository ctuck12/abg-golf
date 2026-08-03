// ── WHS course handicap / score differential ─────────────────────────────────
//
// The games in this app all work off raw index differences, which is why no
// rating or slope was needed until now. Anything that touches an official
// handicap does need them: a Score Differential is what GHIN stores for a
// posted round, and a Course Handicap is what a player actually plays off on a
// given tee.
//
// Nothing in the scoring path calls these yet — they exist so a course's rating
// and slope have a single correct interpretation once something does.

export type TeeRating = {
  /** Course Rating for the tee played, e.g. 71.2 */
  courseRating: number
  /** Slope Rating for the tee played, 55–155 */
  slopeRating: number
  /** Total par for the tee played, e.g. 71 */
  par: number
}

/** True when a course carries everything a GHIN post or a course handicap needs. */
export function hasTeeRating(c: {
  course_rating?: number | null
  slope_rating?: number | null
}): boolean {
  return c.course_rating != null && c.slope_rating != null && c.slope_rating > 0
}

/** Course Handicap = Index × (Slope ÷ 113) + (Course Rating − Par).
 *
 *  The strokes a player gets on this tee, to the nearest whole stroke. A plus
 *  handicap stays negative, which is how the rest of this codebase carries one.
 */
export function courseHandicap(handicapIndex: number, tee: TeeRating): number {
  const raw = handicapIndex * (tee.slopeRating / 113) + (tee.courseRating - tee.par)
  return Math.round(raw)
}

/** Score Differential = (113 ÷ Slope) × (Adjusted Gross − Course Rating − PCC).
 *
 *  What GHIN records for a round, to the nearest tenth. PCC (the playing
 *  conditions calculation) is computed by the association after the fact, so it
 *  is 0 for anything posted from here.
 */
export function scoreDifferential(adjustedGross: number, tee: TeeRating, pcc = 0): number {
  const raw = (113 / tee.slopeRating) * (adjustedGross - tee.courseRating - pcc)
  return Math.round(raw * 10) / 10
}

/** Net Double Bogey — the most a hole can count toward an adjusted gross score:
 *  par + 2 + the strokes the player receives on that hole. */
export function netDoubleBogey(par: number, strokesOnHole: number): number {
  return par + 2 + Math.max(0, strokesOnHole)
}

/** Adjusted Gross Score: every hole capped at net double bogey, which is what
 *  WHS posts rather than the raw total.
 *
 *  `strokesOnHole` is how many handicap strokes the player gets on that hole —
 *  the same allocation the score screens use, so a cap here can't disagree with
 *  the strokes shown there. Holes with no score are skipped, so a partial round
 *  returns a partial total; the caller decides whether that's postable.
 */
export function adjustedGrossScore(
  holes: { hole_number: number; par: number }[],
  scoreFor: (holeNumber: number) => number | null | undefined,
  strokesOnHole: (holeNumber: number) => number,
): { adjusted: number; gross: number; holesCounted: number } {
  let adjusted = 0
  let gross = 0
  let holesCounted = 0
  for (const h of holes) {
    const s = scoreFor(h.hole_number)
    if (s == null) continue
    holesCounted++
    gross += s
    adjusted += Math.min(s, netDoubleBogey(h.par, strokesOnHole(h.hole_number)))
  }
  return { adjusted, gross, holesCounted }
}

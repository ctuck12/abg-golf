// The banker on the round's opening hole is a toss-up — there are no standings
// yet to point at anyone. A Random button makes that draw visible instead of
// the app deciding quietly. Every later hole picks its banker from the running
// totals, so the button belongs to the opening hole alone.
//
// Shared by both score screens (team banker and playing-group banker) so the
// rule can't drift between them.

/** The first hole actually played, which is hole 10 for a back-nine round.
 *  Hole rows are stored from the round's start hole and queried in order, so
 *  the first row is the opening hole whatever the round's shape. */
export function firstPlayedHole(holes: { hole_number: number }[]): number | null {
  return holes.length > 0 ? holes[0].hole_number : null
}

export function isFirstPlayedHole(holes: { hole_number: number }[], holeNumber: number): boolean {
  const first = firstPlayedHole(holes)
  return first !== null && holeNumber === first
}

/** Offer the roll on the opening hole whenever it has no banker — including
 *  after one is cleared — and only when there's somebody to draw from. */
export function shouldOfferRandomBanker(args: {
  isFirstPlayedHole: boolean
  bankerPlayerId: string | null
  poolSize: number
}): boolean {
  return args.isFirstPlayedHole && !args.bankerPlayerId && args.poolSize > 0
}

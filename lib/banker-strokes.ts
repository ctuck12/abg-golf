// Who strokes on whom in Banker, for every possible banker.
//
// Banker strokes are pairwise: on each hole the banker is played separately
// against each opponent, and the shot goes to whichever of the two has the
// higher effective handicap — by the difference, taken on the hardest holes.
// So the whole picture is fixed for the round; only which pair is live changes
// with who takes the bank.
//
// This mirrors the rule the settlement already applies (bankerMatchupNets in
// the score screens, and the same test on the leaderboard), so the breakdown
// can't drift from the money.

import { roundHcp } from './scoring'

export type StrokeDirection = 'opponent' | 'banker' | 'even'

export type BankerStrokeRow = {
  opponentId: string
  opponentName: string
  /** 'opponent' — the opponent strokes on the banker
   *  'banker'   — the banker strokes on the opponent
   *  'even'     — same effective handicap, played head up */
  direction: StrokeDirection
  strokes: number
  /** Hole numbers where the shot falls, ascending. */
  holes: number[]
}

export type BankerStrokeBlock = {
  bankerId: string
  bankerName: string
  rows: BankerStrokeRow[]
}

type P = { id: string; name: string; handicap?: number | null }
type H = { hole_number: number; stroke_index?: number | null }

/** Matches the score screens: rounding applies, and a plus handicap stays
 *  below scratch so it gives the extra shot it should. */
export function effectiveHcp(handicap: number, rounding: string | null | undefined): number {
  return roundHcp(handicap, rounding, 'trunc')
}

/** The `diff` hardest holes — the same `stroke_index <= diff` test the game uses. */
export function strokeHolesFor(diff: number, holes: H[]): number[] {
  if (diff <= 0) return []
  return holes
    .filter((h) => h.stroke_index != null && h.stroke_index <= diff)
    .map((h) => h.hole_number)
    .sort((a, b) => a - b)
}

export function bankerStrokeMatrix(players: P[], holes: H[], rounding: string | null | undefined): BankerStrokeBlock[] {
  const withHcp = players.filter((p) => p.handicap != null)
  return withHcp.map((banker) => {
    const bHcp = effectiveHcp(banker.handicap!, rounding)
    const rows: BankerStrokeRow[] = withHcp
      .filter((p) => p.id !== banker.id)
      .map((opponent) => {
        const oHcp = effectiveHcp(opponent.handicap!, rounding)
        const diff = oHcp - bHcp
        const direction: StrokeDirection = diff > 0 ? 'opponent' : diff < 0 ? 'banker' : 'even'
        const strokes = Math.abs(diff)
        return {
          opponentId: opponent.id,
          opponentName: opponent.name,
          direction,
          strokes,
          holes: strokeHolesFor(strokes, holes),
        }
      })
    return { bankerId: banker.id, bankerName: banker.name, rows }
  })
}

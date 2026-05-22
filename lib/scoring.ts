export type BallScores = (number | null)[]

// Sort player scores ascending and return [1-ball, 2-ball, 3-ball, ...]
export function computeHoleBallScores(playerStrokes: number[], ballsCount: number): BallScores {
  const sorted = [...playerStrokes].sort((a, b) => a - b)
  return Array.from({ length: ballsCount }, (_, i) => sorted[i] ?? null)
}

export type TeamBallSummary = {
  ballTotals: (number | null)[]   // total strokes per ball type (null if incomplete)
  ballVsPar: (number | null)[]    // score vs par per ball type
  holesPerBall: number[]          // how many holes contributed to each ball
}

export function computeTeamBallSummary(
  holes: { hole_number: number; par: number }[],
  playerIds: string[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  ballsCount: number
): TeamBallSummary {
  const parMap = Object.fromEntries(holes.map((h) => [h.hole_number, h.par]))
  const ballTotals = Array(ballsCount).fill(0) as number[]
  const parTotals = Array(ballsCount).fill(0) as number[]
  const holesPerBall = Array(ballsCount).fill(0) as number[]

  for (const hole of holes) {
    const holeScores = playerIds
      .map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
      .map((s) => s.strokes)

    if (holeScores.length === 0) continue
    const ballScores = computeHoleBallScores(holeScores, ballsCount)
    const holePar = parMap[hole.hole_number] ?? 4

    ballScores.forEach((score, i) => {
      if (score !== null) {
        ballTotals[i] += score
        parTotals[i] += holePar
        holesPerBall[i]++
      }
    })
  }

  return {
    ballTotals: ballTotals.map((t, i) => (holesPerBall[i] === 0 ? null : t)),
    ballVsPar: ballTotals.map((t, i) => (holesPerBall[i] === 0 ? null : t - parTotals[i])),
    holesPerBall,
  }
}

export type PayoutEntry = {
  fromTeamId: string
  fromTeamName: string
  toTeamId: string
  toTeamName: string
  amount: number
}

export type BallHalfResult = {
  ball: number            // 1-indexed
  half: 'Front 9' | 'Back 9'
  winnerId: string | null
  winnerName: string | null
  winnerTotal: number | null
  winnerVsPar: number | null
  tied: boolean           // true = washes, no winner
  played: boolean         // false = no scores yet
}

// Front/Back format: for each ball × half, best score wins $ballValue from each other team.
// Ties wash. Returns per-ball results, each team's net, and minimized settlement list.
export function calculateFrontBackPayouts(
  teams: { id: string; name: string }[],
  frontSummaries: Map<string, TeamBallSummary>,
  backSummaries: Map<string, TeamBallSummary>,
  ballValues: number[],
  ballsCount: number
): {
  results: BallHalfResult[]
  net: Record<string, number>
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const net: Record<string, number> = {}
  for (const t of teams) net[t.id] = 0

  const results: BallHalfResult[] = []
  const halves: Array<['Front 9' | 'Back 9', Map<string, TeamBallSummary>]> = [
    ['Front 9', frontSummaries],
    ['Back 9', backSummaries],
  ]

  for (const [halfName, summaries] of halves) {
    for (let bi = 0; bi < ballsCount; bi++) {
      const ballValue = ballValues[bi] ?? 0
      const ballNum = bi + 1

      const teamScores = teams
        .map((t) => ({
          id: t.id,
          name: t.name,
          total: summaries.get(t.id)?.ballTotals[bi] ?? null,
          vsPar: summaries.get(t.id)?.ballVsPar[bi] ?? null,
        }))
        .filter((s): s is typeof s & { total: number } => s.total !== null)

      if (teamScores.length === 0) {
        results.push({ ball: ballNum, half: halfName, winnerId: null, winnerName: null, winnerTotal: null, winnerVsPar: null, tied: false, played: false })
        continue
      }

      const minTotal = Math.min(...teamScores.map((s) => s.total))
      const winners = teamScores.filter((s) => s.total === minTotal)
      const tied = winners.length > 1

      if (tied) {
        results.push({ ball: ballNum, half: halfName, winnerId: null, winnerName: null, winnerTotal: minTotal, winnerVsPar: null, tied: true, played: true })
      } else {
        const winner = winners[0]
        results.push({ ball: ballNum, half: halfName, winnerId: winner.id, winnerName: winner.name, winnerTotal: winner.total, winnerVsPar: winner.vsPar, tied: false, played: true })
        if (ballValue > 0) {
          for (const loser of teamScores.filter((s) => s.id !== winner.id)) {
            net[winner.id] += ballValue
            net[loser.id] -= ballValue
          }
        }
      }
    }
  }

  // Minimize settlements using greedy matching of biggest winner vs biggest loser
  const balances = teams.map((t) => ({ id: t.id, name: t.name, bal: net[t.id] ?? 0 }))
  const pos = balances.filter((b) => b.bal > 0).sort((a, b) => b.bal - a.bal)
  const neg = balances.filter((b) => b.bal < 0).sort((a, b) => a.bal - b.bal)
  const settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []

  let wi = 0, li = 0
  while (wi < pos.length && li < neg.length) {
    const w = pos[wi], l = neg[li]
    const amount = Math.min(w.bal, -l.bal)
    if (amount > 0) settlements.push({ fromId: l.id, fromName: l.name, toId: w.id, toName: w.name, amount })
    w.bal -= amount
    l.bal += amount
    if (w.bal === 0) wi++
    if (l.bal === 0) li++
  }

  return { results, net, settlements }
}

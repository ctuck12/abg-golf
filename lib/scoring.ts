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

// Round-robin stroke play payout: compare each team pair per ball type
export function calculatePayouts(
  teams: { id: string; name: string }[],
  summaries: Map<string, TeamBallSummary>,
  ballValues: number[],  // index = ball index (0 = 1-ball)
  ballsCount: number
): PayoutEntry[] {
  // net[teamId][otherTeamId] = positive means teamId owes otherTeamId
  const net: Record<string, Record<string, number>> = {}
  for (const t of teams) {
    net[t.id] = {}
    for (const o of teams) {
      if (o.id !== t.id) net[t.id][o.id] = 0
    }
  }

  for (let ballIdx = 0; ballIdx < ballsCount; ballIdx++) {
    const value = ballValues[ballIdx] ?? 0
    if (value === 0) continue

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const a = teams[i]
        const b = teams[j]
        const aTotal = summaries.get(a.id)?.ballTotals[ballIdx]
        const bTotal = summaries.get(b.id)?.ballTotals[ballIdx]

        if (aTotal == null || bTotal == null) continue
        if (aTotal === bTotal) continue // push

        if (aTotal < bTotal) {
          // A wins — B owes A
          net[b.id][a.id] += value
          net[a.id][b.id] -= value
        } else {
          // B wins — A owes B
          net[a.id][b.id] += value
          net[b.id][a.id] -= value
        }
      }
    }
  }

  // Build simplified list: only show where net > 0 (X owes Y)
  const entries: PayoutEntry[] = []
  const seen = new Set<string>()

  for (const a of teams) {
    for (const b of teams) {
      if (a.id === b.id) continue
      const key = [a.id, b.id].sort().join('-')
      if (seen.has(key)) continue
      seen.add(key)

      const aOwesB = net[a.id][b.id]
      if (aOwesB > 0) {
        entries.push({ fromTeamId: a.id, fromTeamName: a.name, toTeamId: b.id, toTeamName: b.name, amount: aOwesB })
      } else if (aOwesB < 0) {
        entries.push({ fromTeamId: b.id, fromTeamName: b.name, toTeamId: a.id, toTeamName: a.name, amount: -aOwesB })
      }
    }
  }

  return entries.sort((a, b) => b.amount - a.amount)
}

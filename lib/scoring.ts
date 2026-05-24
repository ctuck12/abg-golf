export type BallScores = (number | null)[]

// ── Daytona scoring ───────────────────────────────────────────────────────────

// Combine the 2 best scores on a hole into a Daytona number.
//
// Rule 1 — no par or better (self):
//   If the team's best score is still over par, flip: high digit first.
//   e.g. 5+7 on par-4 → 75 instead of 57.
//
// Rule 2 — birdie flip (inter-team):
//   If another team has a strictly better best score that is under par, flip.
//   Eagle beats birdie; tied levels cancel (both birdie → no flip).
//   Pass otherTeamsBestScores=[] (default) for single-team contexts (score entry).
export function computeHoleDaytona(
  myPlayerScores: number[],
  par: number,
  otherTeamsBestScores: number[] = []
): number | null {
  if (myPlayerScores.length < 2) return null
  const sorted = [...myPlayerScores].sort((a, b) => a - b)
  const low = sorted[0], high = sorted[1]
  let flip = low > par  // Rule 1
  if (!flip) {
    // Rule 2: any other team has a strictly better under-par score?
    flip = otherTeamsBestScores.some((ob) => ob < low && ob < par)
  }
  return flip ? high * 10 : low * 10
}

export type DaytonaSummary = {
  frontTotal: number | null
  backTotal: number | null
  total: number | null
  frontHolesPlayed: number
  backHolesPlayed: number
  holesPlayed: number
}

// Single-team summary — Rule 1 only (used in score entry / player scorecard).
export function computeTeamDaytonaSummary(
  holes: { hole_number: number; par: number }[],
  playerIds: string[],
  scores: { player_id: string; hole_number: number; strokes: number }[]
): DaytonaSummary {
  let frontTotal = 0, backTotal = 0, frontHolesPlayed = 0, backHolesPlayed = 0
  for (const hole of holes) {
    const holeScores = playerIds
      .map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes)
      .filter((s): s is number => s !== undefined)
    const dt = computeHoleDaytona(holeScores, hole.par)
    if (dt === null) continue
    if (hole.hole_number <= 9) { frontTotal += dt; frontHolesPlayed++ }
    else { backTotal += dt; backHolesPlayed++ }
  }
  return {
    frontTotal: frontHolesPlayed > 0 ? frontTotal : null,
    backTotal: backHolesPlayed > 0 ? backTotal : null,
    total: frontHolesPlayed + backHolesPlayed > 0 ? frontTotal + backTotal : null,
    frontHolesPlayed,
    backHolesPlayed,
    holesPlayed: frontHolesPlayed + backHolesPlayed,
  }
}

// All-teams summary — both rules applied (used in leaderboard / admin / payouts).
// Rule 2 requires knowing every team's best score per hole.
export function computeAllTeamsDaytonaSummaries(
  holes: { hole_number: number; par: number }[],
  teams: { id: string; playerIds: string[] }[],
  scores: { player_id: string; hole_number: number; strokes: number }[]
): Map<string, DaytonaSummary> {
  const sums: Record<string, { ft: number; bt: number; fh: number; bh: number }> = {}
  for (const t of teams) sums[t.id] = { ft: 0, bt: 0, fh: 0, bh: 0 }

  for (const hole of holes) {
    const teamData = teams.map((t) => {
      const ps = t.playerIds
        .map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes)
        .filter((s): s is number => s !== undefined)
      return { id: t.id, ps, best: ps.length > 0 ? Math.min(...ps) : null }
    })

    for (const td of teamData) {
      if (td.ps.length < 2) continue
      const otherBests = teamData
        .filter((d) => d.id !== td.id && d.best !== null)
        .map((d) => d.best as number)
      const dt = computeHoleDaytona(td.ps, hole.par, otherBests)
      if (dt === null) continue
      const s = sums[td.id]
      if (hole.hole_number <= 9) { s.ft += dt; s.fh++ } else { s.bt += dt; s.bh++ }
    }
  }

  const result = new Map<string, DaytonaSummary>()
  for (const t of teams) {
    const s = sums[t.id]
    result.set(t.id, {
      frontTotal: s.fh > 0 ? s.ft : null,
      backTotal: s.bh > 0 ? s.bt : null,
      total: s.fh + s.bh > 0 ? s.ft + s.bt : null,
      frontHolesPlayed: s.fh,
      backHolesPlayed: s.bh,
      holesPlayed: s.fh + s.bh,
    })
  }
  return result
}

export type DaytonaHalfResult = {
  half: 'Front 9' | 'Back 9'
  winnerId: string | null
  winnerName: string | null
  winnerTotal: number | null
  tied: boolean
  played: boolean
}

export function calculateDaytonaPayouts(
  teams: { id: string; name: string }[],
  summaries: Map<string, DaytonaSummary>,
  value: number
): {
  results: DaytonaHalfResult[]
  net: Record<string, number>
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const net: Record<string, number> = {}
  for (const t of teams) net[t.id] = 0
  const results: DaytonaHalfResult[] = []

  for (const half of ['Front 9', 'Back 9'] as const) {
    const teamScores = teams.map((t) => ({
      id: t.id, name: t.name,
      total: half === 'Front 9' ? (summaries.get(t.id)?.frontTotal ?? null) : (summaries.get(t.id)?.backTotal ?? null),
    })).filter((s): s is typeof s & { total: number } => s.total !== null)

    if (teamScores.length === 0) {
      results.push({ half, winnerId: null, winnerName: null, winnerTotal: null, tied: false, played: false })
      continue
    }
    const minTotal = Math.min(...teamScores.map((s) => s.total))
    const winners = teamScores.filter((s) => s.total === minTotal)
    if (winners.length > 1) {
      results.push({ half, winnerId: null, winnerName: null, winnerTotal: minTotal, tied: true, played: true })
    } else {
      const winner = winners[0]
      results.push({ half, winnerId: winner.id, winnerName: winner.name, winnerTotal: winner.total, tied: false, played: true })
      if (value > 0) {
        for (const loser of teamScores.filter((s) => s.id !== winner.id)) {
          net[winner.id] += value; net[loser.id] -= value
        }
      }
    }
  }

  const balances = teams.map((t) => ({ id: t.id, name: t.name, bal: net[t.id] ?? 0 }))
  const pos = balances.filter((b) => b.bal > 0).sort((a, b) => b.bal - a.bal)
  const neg = balances.filter((b) => b.bal < 0).sort((a, b) => a.bal - b.bal)
  const settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []
  let wi = 0, li = 0
  while (wi < pos.length && li < neg.length) {
    const w = pos[wi], l = neg[li]
    const amount = Math.min(w.bal, -l.bal)
    if (amount > 0) settlements.push({ fromId: l.id, fromName: l.name, toId: w.id, toName: w.name, amount })
    w.bal -= amount; l.bal += amount
    if (w.bal === 0) wi++; if (l.bal === 0) li++
  }
  return { results, net, settlements }
}


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
  half: 'Front 9' | 'Back 9' | 'Total 18'
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

// Pool format: one value per ball per player (e.g. $5). All players contribute that
// amount for every decided (non-tied) result. Total pot per result = perBallValue × totalPlayers.
// Winning team's players split that pot equally. Ties wash — no contribution, no payout.
// Returns per-PLAYER net and minimized settlement list.
export function calculatePoolPayouts(
  teams: { id: string; name: string }[],
  players: { id: string; team_id: string; name: string }[],
  frontSummaries: Map<string, TeamBallSummary>,
  backSummaries: Map<string, TeamBallSummary>,
  perBallValue: number,
  ballsCount: number,
  totalSummaries?: Map<string, TeamBallSummary>   // optional — adds 18-hole totals as a 3rd segment
): {
  results: BallHalfResult[]
  playerNet: Record<string, number>
  potTotal: number
  perBallResult: number
  perPlayerContribution: number
  numDecidedResults: number
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const totalPlayers = players.length
  const playerNet: Record<string, number> = {}
  for (const p of players) playerNet[p.id] = 0

  const results: BallHalfResult[] = []
  const halves: Array<['Front 9' | 'Back 9' | 'Total 18', Map<string, TeamBallSummary>]> = [
    ['Front 9', frontSummaries],
    ['Back 9', backSummaries],
  ]
  if (totalSummaries) halves.push(['Total 18', totalSummaries])

  let numDecidedResults = 0

  for (const [halfName, summaries] of halves) {
    for (let bi = 0; bi < ballsCount; bi++) {
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
        // Ties wash — no money moves
      } else {
        const winner = winners[0]
        results.push({ ball: ballNum, half: halfName, winnerId: winner.id, winnerName: winner.name, winnerTotal: winner.total, winnerVsPar: winner.vsPar, tied: false, played: true })

        numDecidedResults++

        if (perBallValue > 0 && totalPlayers > 0) {
          const resultPot = perBallValue * totalPlayers
          const winningPlayers = players.filter((p) => p.team_id === winner.id)
          const numWinners = winningPlayers.length

          // Every player contributes perBallValue
          for (const p of players) playerNet[p.id] -= perBallValue
          // Winning team's players split the pot
          if (numWinners > 0) {
            const share = resultPot / numWinners
            for (const p of winningPlayers) playerNet[p.id] += share
          }
        }
      }
    }
  }

  const perPlayerContribution = perBallValue * numDecidedResults
  const perBallResult = perBallValue * totalPlayers
  const potTotal = perPlayerContribution * totalPlayers

  // Minimize settlements using greedy matching of biggest winner vs biggest loser
  const balances = players.map((p) => ({ id: p.id, name: p.name, bal: playerNet[p.id] ?? 0 }))
  const pos = balances.filter((b) => b.bal > 0.001).sort((a, b) => b.bal - a.bal)
  const neg = balances.filter((b) => b.bal < -0.001).sort((a, b) => a.bal - b.bal)
  const settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []

  let wi = 0, li = 0
  while (wi < pos.length && li < neg.length) {
    const w = pos[wi], l = neg[li]
    const amount = Math.round(Math.min(w.bal, -l.bal) * 100) / 100
    if (amount > 0) settlements.push({ fromId: l.id, fromName: l.name, toId: w.id, toName: w.name, amount })
    w.bal -= amount
    l.bal += amount
    if (w.bal < 0.001) wi++
    if (l.bal > -0.001) li++
  }

  return { results, playerNet, potTotal, perBallResult, perPlayerContribution, numDecidedResults, settlements }
}

export type DaytonaSide = 'left' | 'right'
export type DaytonaHoleAssignment = { player_id: string; hole_number: number; side: DaytonaSide }

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [first, ...rest] = arr
  return [
    ...combinations(rest, k - 1).map((c) => [first, ...c]),
    ...combinations(rest, k),
  ]
}

export function computeHoleDaytonaWithSides(
  leftScores: number[],
  rightScores: number[],
  par: number
): { leftDt: number | null; rightDt: number | null } {
  if (leftScores.length < 2 || rightScores.length < 2) return { leftDt: null, rightDt: null }
  const leftDt = computeHoleDaytona(leftScores, par, rightScores)
  const rightDt = computeHoleDaytona(rightScores, par, leftScores)
  return { leftDt, rightDt }
}

export type DaytonaSidesSummary = {
  leftFront: number | null
  leftBack: number | null
  leftTotal: number | null
  rightFront: number | null
  rightBack: number | null
  rightTotal: number | null
  holesPlayed: number
}

export function computeDaytonaSidesSummary(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  assignments: DaytonaHoleAssignment[]
): DaytonaSidesSummary {
  let leftFront: number | null = null
  let leftBack: number | null = null
  let rightFront: number | null = null
  let rightBack: number | null = null
  let holesPlayed = 0

  for (const hole of holes) {
    const holeAssignments = assignments.filter((a) => a.hole_number === hole.hole_number)
    const leftIds = holeAssignments.filter((a) => a.side === 'left').map((a) => a.player_id)
    const rightIds = holeAssignments.filter((a) => a.side === 'right').map((a) => a.player_id)
    const leftScores = leftIds.map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== null && s !== undefined)
    const rightScores = rightIds.map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== null && s !== undefined)

    const { leftDt, rightDt } = computeHoleDaytonaWithSides(leftScores, rightScores, hole.par)
    if (leftDt === null || rightDt === null) continue

    holesPlayed++
    if (hole.hole_number <= 9) {
      leftFront = (leftFront ?? 0) + leftDt
      rightFront = (rightFront ?? 0) + rightDt
    } else {
      leftBack = (leftBack ?? 0) + leftDt
      rightBack = (rightBack ?? 0) + rightDt
    }
  }

  const leftTotal = leftFront !== null || leftBack !== null ? (leftFront ?? 0) + (leftBack ?? 0) : null
  const rightTotal = rightFront !== null || rightBack !== null ? (rightFront ?? 0) + (rightBack ?? 0) : null

  return { leftFront, leftBack, leftTotal, rightFront, rightBack, rightTotal, holesPlayed }
}

// 5-man: left plays every C(3,2)=3 pair from the right side simultaneously.
// Left players each earn/lose points from all 3 matchups; each right player
// participates in exactly 2 of the 3 matchups (the ones they're in).
export function computeHoleDaytonaPointsFiveMan(
  leftIds: string[],
  rightIds: string[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  holeNumber: number,
  par: number
): Map<string, number> {
  const pts = new Map<string, number>()
  for (const id of [...leftIds, ...rightIds]) pts.set(id, 0)
  const leftScores = leftIds
    .map((id) => scores.find((s) => s.player_id === id && s.hole_number === holeNumber)?.strokes)
    .filter((s): s is number => s !== undefined)
  if (leftScores.length < 2) return pts
  for (const [idA, idB] of combinations(rightIds, 2)) {
    const pairScores = [idA, idB]
      .map((id) => scores.find((s) => s.player_id === id && s.hole_number === holeNumber)?.strokes)
      .filter((s): s is number => s !== undefined)
    if (pairScores.length < 2) continue
    const { leftDt, rightDt } = computeHoleDaytonaWithSides(leftScores, pairScores, par)
    if (leftDt === null || rightDt === null) continue
    const diff = Math.abs(leftDt - rightDt)
    const leftWins = leftDt < rightDt
    const rightWins = rightDt < leftDt
    const leftPts = leftWins ? diff : rightWins ? -diff : 0
    const rightPts = -leftPts
    for (const id of leftIds) pts.set(id, (pts.get(id) ?? 0) + leftPts)
    pts.set(idA, (pts.get(idA) ?? 0) + rightPts)
    pts.set(idB, (pts.get(idB) ?? 0) + rightPts)
  }
  return pts
}

// Per-player Daytona point tracking.
// variant: '4man' (default), '5man-normal', or '5man-flares'
export function computePlayerDaytonaPoints(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  assignments: DaytonaHoleAssignment[],
  variant: string = '4man'
): Map<string, number> {
  const totals = new Map<string, number>()
  const is5Man = variant === '5man-normal' || variant === '5man-flares'

  for (const hole of holes) {
    const holeAssignments = assignments.filter((a) => a.hole_number === hole.hole_number)
    const leftIds = holeAssignments.filter((a) => a.side === 'left').map((a) => a.player_id)
    const rightIds = holeAssignments.filter((a) => a.side === 'right').map((a) => a.player_id)

    if (is5Man) {
      if (leftIds.length < 2 || rightIds.length < 3) continue
      const holePoints = computeHoleDaytonaPointsFiveMan(leftIds, rightIds, scores, hole.hole_number, hole.par)
      for (const [id, pts] of holePoints) {
        if (pts !== 0) totals.set(id, (totals.get(id) ?? 0) + pts)
      }
    } else {
      if (leftIds.length < 2 || rightIds.length < 2) continue
      const leftScores = leftIds
        .map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes)
        .filter((s): s is number => s !== undefined)
      const rightScores = rightIds
        .map((id) => scores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes)
        .filter((s): s is number => s !== undefined)
      if (leftScores.length < 2 || rightScores.length < 2) continue
      const { leftDt, rightDt } = computeHoleDaytonaWithSides(leftScores, rightScores, hole.par)
      if (leftDt === null || rightDt === null) continue
      const diff = Math.abs(leftDt - rightDt)
      const leftPoints = leftDt < rightDt ? diff : leftDt > rightDt ? -diff : 0
      const rightPoints = -leftPoints
      for (const id of leftIds) totals.set(id, (totals.get(id) ?? 0) + leftPoints)
      for (const id of rightIds) totals.set(id, (totals.get(id) ?? 0) + rightPoints)
    }
  }

  return totals
}

export function settleDaytonaPlayerPoints(
  players: { id: string; name: string }[],
  pointTotals: Map<string, number>,
  dollarPerPoint: number
): {
  net: Record<string, number>
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const net: Record<string, number> = {}
  for (const p of players) {
    net[p.id] = Math.round((pointTotals.get(p.id) ?? 0) * dollarPerPoint * 100) / 100
  }

  const balances = players.map((p) => ({ id: p.id, name: p.name, bal: net[p.id] ?? 0 }))
  const pos = balances.filter((b) => b.bal > 0).sort((a, b) => b.bal - a.bal)
  const neg = balances.filter((b) => b.bal < 0).sort((a, b) => a.bal - b.bal)
  const settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []

  let wi = 0, li = 0
  while (wi < pos.length && li < neg.length) {
    const w = pos[wi], l = neg[li]
    const amount = Math.round(Math.min(w.bal, -l.bal) * 100) / 100
    if (amount > 0) settlements.push({ fromId: l.id, fromName: l.name, toId: w.id, toName: w.name, amount })
    w.bal -= amount
    l.bal += amount
    if (Math.abs(w.bal) < 0.01) wi++
    if (Math.abs(l.bal) < 0.01) li++
  }

  return { net, settlements }
}

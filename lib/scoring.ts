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
    if (Math.round(amount) > 0) settlements.push({ fromId: l.id, fromName: l.name, toId: w.id, toName: w.name, amount })
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

// ── Handicap rounding ────────────────────────────────────────────────────────
// mode 'nearest' rounds half-up (7.4→7, 7.5→8); anything else keeps the
// legacy behavior (fallback 'floor' or 'trunc' per call site).
export function roundHcp(v: number, mode: string | null | undefined, fallback: 'floor' | 'trunc' = 'floor'): number {
  if (mode === 'nearest') return Math.round(v)
  return fallback === 'trunc' ? Math.trunc(v) : Math.floor(v)
}

// ── Best Ball per-player handicap strokes ────────────────────────────────────
// Allocates each player's stroke count across the hardest holes (lowest
// stroke_index first; holes without an index come last, then by hole number).
// Returns playerId → (hole_number → strokes received on that hole).
export function computeBBStrokeHoles(
  playerStrokes: Record<string, number> | null | undefined,
  holes: { hole_number: number; stroke_index?: number | null }[],
  handicapRounding?: string | null
): Record<string, Record<number, number>> {
  const out: Record<string, Record<number, number>> = {}
  if (!playerStrokes || holes.length === 0) return out
  const ordered = [...holes].sort((a, b) => {
    const ai = a.stroke_index ?? 999, bi = b.stroke_index ?? 999
    return ai !== bi ? ai - bi : a.hole_number - b.hole_number
  })
  for (const [pid, raw] of Object.entries(playerStrokes)) {
    const n = Math.max(0, roundHcp(Number(raw) || 0, handicapRounding))
    if (n === 0) continue
    const perHole: Record<number, number> = {}
    for (let i = 0; i < n; i++) {
      const h = ordered[i % ordered.length].hole_number
      perHole[h] = (perHole[h] ?? 0) + 1
    }
    out[pid] = perHole
  }
  return out
}

// Returns a copy of scoreMap with each player's strokes subtracted on their
// stroke holes. Players without strokes share the original references.
export function applyPlayerStrokesToScoreMap(
  scoreMap: Record<string, Record<number, number>>,
  strokeHoles: Record<string, Record<number, number>>
): Record<string, Record<number, number>> {
  const pids = Object.keys(strokeHoles)
  if (pids.length === 0) return scoreMap
  const adjusted: Record<string, Record<number, number>> = { ...scoreMap }
  for (const pid of pids) {
    const orig = scoreMap[pid]
    if (!orig) continue
    const copy: Record<number, number> = { ...orig }
    for (const [holeStr, s] of Object.entries(strokeHoles[pid])) {
      const h = Number(holeStr)
      if (copy[h] != null) copy[h] = copy[h] - s
    }
    adjusted[pid] = copy
  }
  return adjusted
}

// ── Medley matchups (3-5 players, low ball wins) ─────────────────────────────
export type MedleyPlayerEntry = { id: string; front?: number | null; back?: number | null; total?: number | null }
export type MedleyMatchup = { id: string; players: MedleyPlayerEntry[]; bet_type: string; amount: number }
export type MedleySegmentResult = {
  name: 'Front' | 'Back' | 'Total'
  settled: boolean
  winnerId: string | null   // null when pending or tied
  tied: boolean
  amount: number
}
export type MedleyPlayerLine = {
  id: string
  front: number | null; back: number | null; total: number | null   // handicap-adjusted vs par
  thru: number
  strokes: { front: number; back: number; total: number }
}

// Computes segment results, per-player display lines, and net dollar deltas.
// A segment settles when every participant has scored every one of its holes;
// the lowest adjusted vs-par wins and collects `amount` from EACH other player.
// Ties for low push (no money). Strokes subtract from segment totals directly.
export function computeMedley(
  m: MedleyMatchup,
  scoreMap: Record<string, Record<number, number>>,
  holes: { hole_number: number; par: number }[]
): { segments: MedleySegmentResult[]; lines: MedleyPlayerLine[]; netDelta: Record<string, number> } {
  const entries = (m.players ?? []).filter((p) => p && p.id)
  const netDelta: Record<string, number> = {}
  for (const e of entries) netDelta[e.id] = 0
  const amount = Number(m.amount) || 0
  const isNassau = m.bet_type === 'nassau'
  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number > 9)

  const strokesOf = (e: MedleyPlayerEntry) => {
    const f = Number(e.front) || 0
    const b = Number(e.back) || 0
    const t = e.total != null && !isNaN(Number(e.total)) && Number(e.total) !== 0 ? Number(e.total) : f + b
    return { front: f, back: b, total: t }
  }

  const segVsPar = (pid: string, segHoles: { hole_number: number; par: number }[]) => {
    let sum = 0, played = 0
    for (const h of segHoles) {
      const s = scoreMap[pid]?.[h.hole_number]
      if (s == null) continue
      sum += s - h.par; played++
    }
    return { vsPar: played > 0 ? sum : null, played, complete: segHoles.length > 0 && played === segHoles.length }
  }

  const lines: MedleyPlayerLine[] = entries.map((e) => {
    const st = strokesOf(e)
    const f = segVsPar(e.id, frontHoles)
    const b = segVsPar(e.id, backHoles)
    const t = segVsPar(e.id, holes)
    return {
      id: e.id,
      front: f.vsPar !== null ? f.vsPar - st.front : null,
      back: b.vsPar !== null ? b.vsPar - st.back : null,
      total: t.vsPar !== null ? t.vsPar - st.total : null,
      thru: t.played,
      strokes: st,
    }
  })

  const resolveSeg = (name: 'Front' | 'Back' | 'Total', segHoles: { hole_number: number; par: number }[], adjOf: (l: MedleyPlayerLine) => number | null): MedleySegmentResult => {
    const settled = segHoles.length > 0 && entries.every((e) => segVsPar(e.id, segHoles).complete)
    if (!settled || entries.length === 0) return { name, settled: false, winnerId: null, tied: false, amount }
    const adjs = lines.map((l) => ({ id: l.id, adj: adjOf(l) }))
    if (adjs.some((a) => a.adj === null)) return { name, settled: false, winnerId: null, tied: false, amount }
    const min = Math.min(...adjs.map((a) => a.adj as number))
    const winners = adjs.filter((a) => a.adj === min)
    if (winners.length > 1) return { name, settled: true, winnerId: null, tied: true, amount }
    const wId = winners[0].id
    for (const a of adjs) {
      if (a.id === wId) netDelta[a.id] = (netDelta[a.id] ?? 0) + amount * (adjs.length - 1)
      else netDelta[a.id] = (netDelta[a.id] ?? 0) - amount
    }
    return { name, settled: true, winnerId: wId, tied: false, amount }
  }

  const segments: MedleySegmentResult[] = []
  if (isNassau) {
    segments.push(resolveSeg('Front', frontHoles, (l) => l.front))
    segments.push(resolveSeg('Back', backHoles, (l) => l.back))
  }
  segments.push(resolveSeg('Total', holes, (l) => l.total))
  return { segments, lines, netDelta }
}

// ── Matchup press forfeits ───────────────────────────────────────────────────
// A press may forfeit segments of the original bet; the earliest forfeiting
// press per segment wins. Returns segment → press start hole.
export type PressForfeit = { by: string; segments: ('front' | 'back' | 'total')[] }
export function pressForfeitMap(
  press: { holeStart: number; forfeit?: PressForfeit | null }[] | null | undefined
): Partial<Record<'front' | 'back' | 'total', number>> {
  const out: Partial<Record<'front' | 'back' | 'total', number>> = {}
  for (const pr of press ?? []) {
    if (!pr.forfeit) continue
    for (const seg of pr.forfeit.segments) {
      if (out[seg] === undefined || pr.holeStart < out[seg]!) out[seg] = pr.holeStart
    }
  }
  return out
}

// Whether a player with the given holes_range plays the given hole.
export function playerCoversHole(range: string | null | undefined, holeNumber: number): boolean {
  if (range === 'front9') return holeNumber <= 9
  if (range === 'back9') return holeNumber > 9
  return true
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
        .filter((s): s is typeof s & { total: number; vsPar: number } => s.total !== null && s.vsPar !== null)

      if (teamScores.length === 0) {
        results.push({ ball: ballNum, half: halfName, winnerId: null, winnerName: null, winnerTotal: null, winnerVsPar: null, tied: false, played: false })
        continue
      }

      const minVsPar = Math.min(...teamScores.map((s) => s.vsPar))
      const winners = teamScores.filter((s) => s.vsPar === minVsPar)
      const tied = winners.length > 1

      if (tied) {
        results.push({ ball: ballNum, half: halfName, winnerId: null, winnerName: null, winnerTotal: minVsPar, winnerVsPar: null, tied: true, played: true })
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
    if (Math.round(amount) > 0) settlements.push({ fromId: l.id, fromName: l.name, toId: w.id, toName: w.name, amount })
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
  numPlayedResults: number
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const teamIdSet = new Set(teams.map((t) => t.id))
  const teamPlayers = players.filter((p) => teamIdSet.has(p.team_id))
  const totalPlayers = teamPlayers.length
  const playerNet: Record<string, number> = {}
  for (const p of teamPlayers) playerNet[p.id] = 0

  const results: BallHalfResult[] = []
  const halves: Array<['Front 9' | 'Back 9' | 'Total 18', Map<string, TeamBallSummary>]> = [
    ['Front 9', frontSummaries],
    ['Back 9', backSummaries],
  ]
  if (totalSummaries) halves.push(['Total 18', totalSummaries])

  let numDecidedResults = 0
  let numPlayedResults = 0

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
        .filter((s): s is typeof s & { total: number; vsPar: number } => s.total !== null && s.vsPar !== null)

      if (teamScores.length === 0) {
        results.push({ ball: ballNum, half: halfName, winnerId: null, winnerName: null, winnerTotal: null, winnerVsPar: null, tied: false, played: false })
        continue
      }

      // Ball is in play — every player contributes regardless of tie or win
      numPlayedResults++
      if (perBallValue > 0 && totalPlayers > 0) {
        for (const p of teamPlayers) playerNet[p.id] -= perBallValue
      }

      const minVsPar = Math.min(...teamScores.map((s) => s.vsPar))
      const winners = teamScores.filter((s) => s.vsPar === minVsPar)
      const tied = winners.length > 1

      if (tied) {
        results.push({ ball: ballNum, half: halfName, winnerId: null, winnerName: null, winnerTotal: minVsPar, winnerVsPar: null, tied: true, played: true })
        // Tied — pot splits equally between the tied teams' players
        if (perBallValue > 0 && totalPlayers > 0) {
          const resultPot = perBallValue * totalPlayers
          const potPerTiedTeam = resultPot / winners.length
          for (const winner of winners) {
            const winningPlayers = teamPlayers.filter((p) => p.team_id === winner.id)
            if (winningPlayers.length > 0) {
              const share = potPerTiedTeam / winningPlayers.length
              for (const p of winningPlayers) playerNet[p.id] += share
            }
          }
        }
      } else {
        const winner = winners[0]
        results.push({ ball: ballNum, half: halfName, winnerId: winner.id, winnerName: winner.name, winnerTotal: winner.total, winnerVsPar: winner.vsPar, tied: false, played: true })
        numDecidedResults++
        if (perBallValue > 0 && totalPlayers > 0) {
          const resultPot = perBallValue * totalPlayers
          const winningPlayers = teamPlayers.filter((p) => p.team_id === winner.id)
          if (winningPlayers.length > 0) {
            const share = resultPot / winningPlayers.length
            for (const p of winningPlayers) playerNet[p.id] += share
          }
        }
      }
    }
  }

  const perBallResult = perBallValue * totalPlayers
  const perPlayerContribution = perBallValue * numPlayedResults
  const potTotal = perPlayerContribution * totalPlayers

  // Minimize settlements using greedy matching of biggest winner vs biggest loser
  const balances = teamPlayers.map((p) => ({ id: p.id, name: p.name, bal: Math.round(playerNet[p.id] ?? 0) }))
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

  return { results, playerNet, potTotal, perBallResult, perPlayerContribution, numDecidedResults, numPlayedResults, settlements }
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
  const is5Man = variant.startsWith('5man')

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

// Compute per-player dollar totals where each hole may have its own value per point.
// Falls back to defaultDollarPerPoint for holes not in holeValueOverrides.
// Use settleDaytonaPlayerPoints(players, result, 1) to convert to net/settlements.
export function computePlayerDaytonaDollars(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  assignments: DaytonaHoleAssignment[],
  variant: string = '4man',
  defaultDollarPerPoint: number,
  holeValueOverrides: Record<number, number> = {}
): Map<string, number> {
  const dollarTotals = new Map<string, number>()
  const is5Man = variant.startsWith('5man')

  for (const hole of holes) {
    const dollarPerPoint = holeValueOverrides[hole.hole_number] ?? defaultDollarPerPoint
    const holeAssignments = assignments.filter((a) => a.hole_number === hole.hole_number)
    const leftIds = holeAssignments.filter((a) => a.side === 'left').map((a) => a.player_id)
    const rightIds = holeAssignments.filter((a) => a.side === 'right').map((a) => a.player_id)
    let holePoints: Map<string, number>

    if (is5Man) {
      if (leftIds.length < 2 || rightIds.length < 3) continue
      holePoints = computeHoleDaytonaPointsFiveMan(leftIds, rightIds, scores, hole.hole_number, hole.par)
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
      const leftPts = leftDt < rightDt ? diff : leftDt > rightDt ? -diff : 0
      holePoints = new Map<string, number>()
      for (const id of leftIds) holePoints.set(id, leftPts)
      for (const id of rightIds) holePoints.set(id, -leftPts)
    }

    for (const [id, pts] of holePoints) {
      if (pts !== 0) {
        dollarTotals.set(id, Math.round(((dollarTotals.get(id) ?? 0) + pts * dollarPerPoint) * 100) / 100)
      }
    }
  }

  return dollarTotals
}

// Like computePlayerDaytonaPoints, but supports a different variant on the back nine.
export function computePlayerDaytonaPointsSplit(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  assignments: DaytonaHoleAssignment[],
  variant: string = '4man',
  back9Variant: string | null | undefined
): Map<string, number> {
  if (!back9Variant || back9Variant === variant) {
    return computePlayerDaytonaPoints(holes, scores, assignments, variant)
  }
  const front = computePlayerDaytonaPoints(holes.filter((h) => h.hole_number <= 9), scores, assignments, variant)
  const back = computePlayerDaytonaPoints(holes.filter((h) => h.hole_number > 9), scores, assignments, back9Variant)
  const merged = new Map(front)
  for (const [id, pts] of back) merged.set(id, (merged.get(id) ?? 0) + pts)
  return merged
}

// Like computePlayerDaytonaDollars, but supports a different variant on the back nine.
// If back9Variant is null/empty or identical, behavior is unchanged.
export function computePlayerDaytonaDollarsSplit(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  assignments: DaytonaHoleAssignment[],
  variant: string = '4man',
  back9Variant: string | null | undefined,
  defaultDollarPerPoint: number,
  holeValueOverrides: Record<number, number> = {}
): Map<string, number> {
  if (!back9Variant || back9Variant === variant) {
    return computePlayerDaytonaDollars(holes, scores, assignments, variant, defaultDollarPerPoint, holeValueOverrides)
  }
  const front = computePlayerDaytonaDollars(holes.filter((h) => h.hole_number <= 9), scores, assignments, variant, defaultDollarPerPoint, holeValueOverrides)
  const back = computePlayerDaytonaDollars(holes.filter((h) => h.hole_number > 9), scores, assignments, back9Variant, defaultDollarPerPoint, holeValueOverrides)
  const merged = new Map(front)
  for (const [id, amt] of back) {
    merged.set(id, Math.round(((merged.get(id) ?? 0) + amt) * 100) / 100)
  }
  return merged
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

  const balances = players.map((p) => { const v = net[p.id] ?? 0; return { id: p.id, name: p.name, bal: v < 0 ? -Math.round(-v) : Math.round(v) } })
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

  return { net, settlements }
}

// ── Skins Game ────────────────────────────────────────────────────────────────


// ── Skins: winner-take-pot mode ───────────────────────────────────────────────
// Every participant antes buyIn; most skins over the round takes the pot,
// ties for most split it evenly. Money only moves once every participant has
// completed all the holes their range covers (the lead can change until then).
export function computeSkinsPotResults(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  participants: { id: string; name: string; holes_range?: string | null }[],
  buyIn: number
): {
  skins: SkinResult[]
  playerNet: Record<string, number>
  skinsWon: number
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
  potTotal: number
  complete: boolean
  leaders: { id: string; name: string; count: number }[]
} {
  const base = computeSkinsResults(holes, scores, participants, 0)
  const counts: Record<string, number> = {}
  for (const p of participants) counts[p.id] = 0
  for (const sk of base.skins) if (sk.status === 'won' && sk.winnerId && counts[sk.winnerId] !== undefined) counts[sk.winnerId]++

  const complete = holes.length > 0 && participants.length > 0 && participants.every((p) =>
    holes.filter((h) => playerCoversHole(p.holes_range, h.hole_number))
      .every((h) => scores.some((sc) => sc.player_id === p.id && sc.hole_number === h.hole_number))
  )

  const potTotal = Math.round(buyIn * participants.length * 100) / 100
  const playerNet: Record<string, number> = {}
  for (const p of participants) playerNet[p.id] = 0

  const maxCount = participants.length > 0 ? Math.max(...participants.map((p) => counts[p.id] ?? 0)) : 0
  const leaders = participants
    .filter((p) => (counts[p.id] ?? 0) === maxCount)
    .map((p) => ({ id: p.id, name: p.name, count: counts[p.id] ?? 0 }))

  if (complete && buyIn > 0 && participants.length > 1 && leaders.length > 0) {
    const share = potTotal / leaders.length
    const winnerIds = new Set(leaders.map((l) => l.id))
    for (const p of participants) {
      playerNet[p.id] = Math.round(((winnerIds.has(p.id) ? share : 0) - buyIn) * 100) / 100
    }
  }

  const pw = participants.map((p) => ({ id: p.id, name: p.name, bal: playerNet[p.id] ?? 0 })).filter((b) => b.bal > 0.005).sort((a, b) => b.bal - a.bal)
  const nw = participants.map((p) => ({ id: p.id, name: p.name, bal: playerNet[p.id] ?? 0 })).filter((b) => b.bal < -0.005).sort((a, b) => a.bal - b.bal)
  const settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []
  let wi = 0, li = 0
  while (wi < pw.length && li < nw.length) {
    const amount = Math.round(Math.min(pw[wi].bal, -nw[li].bal) * 100) / 100
    if (amount > 0) settlements.push({ fromId: nw[li].id, fromName: nw[li].name, toId: pw[wi].id, toName: pw[wi].name, amount })
    pw[wi].bal = Math.round((pw[wi].bal - amount) * 100) / 100
    nw[li].bal = Math.round((nw[li].bal + amount) * 100) / 100
    if (pw[wi].bal <= 0.005) wi++
    if (nw[li].bal >= -0.005) li++
  }

  return { skins: base.skins, playerNet, skinsWon: base.skinsWon, settlements, potTotal, complete, leaders }
}

export type SkinResult = {
  holeNumber: number
  par: number
  winnerId: string | null
  winnerName: string | null
  winnerScore: number | null
  /** won: sole lowest ≤ par  |  tied: 2+ tied for lowest ≤ par  |  no_qualifier: all > par  |  pending: no scores yet */
  status: 'won' | 'tied' | 'no_qualifier' | 'pending'
}

/**
 * Compute hole-by-hole skins results across all participating players.
 * Rules:
 *  - Lowest score on a hole ≤ par by exactly one participant → that player wins a skin.
 *  - 2+ tied for the lowest ≤ par score → washed, no skin.
 *  - All scores > par → no skin.
 *  - Skin payout: winner collects amountPerSkin from every other participant.
 */
export function computeSkinsResults(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  participants: { id: string; name: string }[],
  amountPerSkin: number
): {
  skins: SkinResult[]
  playerNet: Record<string, number>
  skinsWon: number
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const skins: SkinResult[] = []
  const playerNet: Record<string, number> = {}
  for (const p of participants) playerNet[p.id] = 0
  let skinsWon = 0

  for (const hole of holes) {
    const holeScores = participants
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: scores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes ?? null,
      }))
      .filter((s): s is typeof s & { score: number } => s.score !== null)

    if (holeScores.length === 0) {
      skins.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, winnerName: null, winnerScore: null, status: 'pending' })
      continue
    }

    const minScore = Math.min(...holeScores.map((s) => s.score))

    if (minScore > hole.par) {
      skins.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, winnerName: null, winnerScore: minScore, status: 'no_qualifier' })
      continue
    }

    const tiedPlayers = holeScores.filter((s) => s.score === minScore)

    if (tiedPlayers.length > 1) {
      skins.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: null, winnerName: null, winnerScore: minScore, status: 'tied' })
      continue
    }

    const winner = tiedPlayers[0]
    skinsWon++
    skins.push({ holeNumber: hole.hole_number, par: hole.par, winnerId: winner.id, winnerName: winner.name, winnerScore: winner.score, status: 'won' })

    if (amountPerSkin > 0 && participants.length > 1) {
      for (const p of participants) {
        if (p.id === winner.id) {
          playerNet[p.id] += amountPerSkin * (participants.length - 1)
        } else {
          playerNet[p.id] -= amountPerSkin
        }
      }
    }
  }

  // Minimize settlements
  const balances = participants.map((p) => { const v = playerNet[p.id] ?? 0; return { id: p.id, name: p.name, bal: v < 0 ? -Math.round(-v) : Math.round(v) } })
  const pos = balances.filter((b) => b.bal > 0).sort((a, b) => b.bal - a.bal).map((b) => ({ ...b }))
  const neg = balances.filter((b) => b.bal < 0).sort((a, b) => a.bal - b.bal).map((b) => ({ ...b }))
  const settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []
  let wi = 0, li = 0
  while (wi < pos.length && li < neg.length) {
    const w = pos[wi], l = neg[li]
    const amount = Math.min(w.bal, -l.bal)
    if (amount > 0) settlements.push({ fromId: l.id, fromName: l.name, toId: w.id, toName: w.name, amount })
    w.bal -= amount; l.bal += amount
    if (w.bal === 0) wi++; if (l.bal === 0) li++
  }

  return { skins, playerNet, skinsWon, settlements }
}

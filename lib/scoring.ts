export type BallScores = (number | null)[]

// ── Daytona scoring ───────────────────────────────────────────────────────────

// Combine the 2 best scores on a hole into a Daytona number: the leading ball
// × 10. The low ball leads normally; the second ball only matters through the
// flip rules, which put the high ball in front instead.
//
// Rule 1 — no par or better (self):
//   If the team's best score is still over par, flip: the high ball leads.
//   e.g. 5+7 on par-4 → 70 instead of 50.
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
export type MedleyPressEntry = { id: string; holeStart: number; holeEnd: number; amount: number; strokes?: Record<string, number> | null }
export type MedleyMatchup = { id: string; players: MedleyPlayerEntry[]; bet_type: string; amount: number; press?: MedleyPressEntry[] | null }
export type MedleyPressResult = {
  press: MedleyPressEntry
  adj: Record<string, number | null>   // running strokes-adjusted vs-par over the press holes
  complete: boolean
  winnerId: string | null              // set once complete and not tied
  tied: boolean
}
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
): { segments: MedleySegmentResult[]; lines: MedleyPlayerLine[]; netDelta: Record<string, number>; pressResults: MedleyPressResult[] } {
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

  // Presses: low ball over the press holes among all medley players; flat
  // per-player press strokes come off the stretch total. Winner collects the
  // press amount from each other player once everyone finishes the stretch;
  // ties wash (same as the main bet).
  const pressResults: MedleyPressResult[] = []
  for (const pr of m.press ?? []) {
    const prHoles = holes.filter((h) => h.hole_number >= pr.holeStart && h.hole_number <= pr.holeEnd)
    const adj: Record<string, number | null> = {}
    let complete = prHoles.length > 0 && entries.length > 1
    for (const e of entries) {
      let sum = 0, played = 0
      for (const h of prHoles) {
        const s = scoreMap[e.id]?.[h.hole_number]
        if (s == null) continue
        sum += s - h.par; played++
      }
      if (played < prHoles.length) complete = false
      adj[e.id] = played > 0 ? sum - (Number(pr.strokes?.[e.id]) || 0) : null
    }
    let winnerId: string | null = null
    let tied = false
    if (complete) {
      const vals = entries.map((e) => ({ id: e.id, v: adj[e.id] as number }))
      const min = Math.min(...vals.map((x) => x.v))
      const winners = vals.filter((x) => x.v === min)
      if (winners.length > 1) tied = true
      else {
        winnerId = winners[0].id
        const amt = Number(pr.amount) || 0
        for (const x of vals) {
          if (x.id === winnerId) netDelta[x.id] = (netDelta[x.id] ?? 0) + amt * (vals.length - 1)
          else netDelta[x.id] = (netDelta[x.id] ?? 0) - amt
        }
      }
    }
    pressResults.push({ press: pr, adj, complete, winnerId, tied })
  }

  return { segments, lines, netDelta, pressResults }
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

// ── Player display order ──────────────────────────────────────────────────────
// Positions >= MANUAL_ORDER_BASE mean the admin dragged the team into a custom
// order (see reorderTeamPlayers); otherwise lists display in handicap order.
export const MANUAL_ORDER_BASE = 100

export function sortPlayersForDisplay<T extends { position?: number | null; handicap?: number | null }>(list: T[]): T[] {
  if (list.some((p) => (p.position ?? 0) >= MANUAL_ORDER_BASE)) {
    return [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }
  return [...list].sort((a, b) => ((a.handicap ?? 999) - (b.handicap ?? 999)) || ((a.position ?? 0) - (b.position ?? 0)))
}

// Same rule applied per team across a whole round's flat player list, so
// consumers that filter by team_id see each team in its own display order.
export function sortRoundPlayersByTeam<T extends { team_id?: string | null; position?: number | null; handicap?: number | null }>(list: T[]): T[] {
  const byTeam = new Map<string, T[]>()
  for (const p of list) {
    const key = p.team_id ?? ''
    const bucket = byTeam.get(key)
    if (bucket) bucket.push(p)
    else byTeam.set(key, [p])
  }
  return [...byTeam.values()].flatMap((bucket) => sortPlayersForDisplay(bucket))
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
 *  - A participant only competes on holes their holes_range covers — stale
 *    scores left on excluded holes (range changed mid-round) never count.
 */
export function computeSkinsResults(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  participants: { id: string; name: string; holes_range?: string | null }[],
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
        score: playerCoversHole(p.holes_range, hole.hole_number)
          ? scores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes ?? null
          : null,
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

// ═══════════════════════════════════════════════════════════════════════════
// Canonical matchup payout engine — the ONLY implementation of matchup money
// math (H2H, 2v2 Best Ball, Medley: segments, sweeps, forfeits, presses,
// nets, settlements). MatchupClient, LeaderboardClient, ScoreEntry and
// AdminDashboard all call computeAllMatchupPayouts so the four views can
// never drift apart.
// ═══════════════════════════════════════════════════════════════════════════

type PayoutHole = { hole_number: number; par: number; stroke_index?: number | null }
export type MatchupPressEntry = { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: string; strokes?: number; forfeit?: PressForfeit | null }
export type PayoutH2HMatchup = { id: string; player1_id: string; player2_id: string; bet: string; press?: MatchupPressEntry[] | null; hole_range?: string | null }
export type PayoutBBMatchup = { id: string; team1_player1_id: string; team1_player2_id: string; team2_player1_id: string; team2_player2_id: string; bet: string; press?: MatchupPressEntry[] | null; hole_range?: string | null; player_strokes?: Record<string, number> | null }
export type MatchupPayoutSegment = {
  name: 'Front' | 'Back' | 'Total'
  settled: boolean
  winnerLabel: string | null   // player/team name, null = pending or tied
  tied: boolean
  amount: number               // bet amount for this segment (per-player for BB)
  perPlayer: boolean           // true for BB (label shows "$X/player")
  forfeited?: boolean          // settled early because a press forfeited this segment
}
export type MatchupPayoutRow = {
  id: string
  type: 'h2h' | 'bb' | 'medley'
  label: string
  betLabel: string
  segments: MatchupPayoutSegment[]
  nassauResult?: {
    winnerLabel: string | null   // net winner name, or null if tied/no data
    amount: number               // absolute net amount (sweepAmt when swept)
    perPlayer: boolean
    anySettled: boolean
    swept?: boolean              // one side won front+back+total and sweep is in effect
  }
}

function parseAmounts(raw: string): { frontAmount: number; backAmount: number; totalAmount: number } {
  const p = raw.split('|')
  if (p.length === 3) {
    const f = parseFloat(p[0]) || 0, b = parseFloat(p[1]) || 0, t = parseFloat(p[2]) || 0
    return { frontAmount: f, backAmount: b, totalAmount: t }
  }
  const a = parseFloat(raw) || 0
  return { frontAmount: a, backAmount: a, totalAmount: a }
}

function parseBet(bet: string): { betType: 'nassau' | 'straight' | ''; amount: string; scoringType: 'stroke' | 'match'; sweepAmount: string; handicapSide: string; handicapFront: string; handicapBack: string; handicapTotal: string; frontAmount: number; backAmount: number; totalAmount: number } {
  const empty = { betType: '' as 'nassau' | 'straight' | '', amount: '', scoringType: 'stroke' as 'stroke' | 'match', sweepAmount: '', handicapSide: '', handicapFront: '', handicapBack: '', handicapTotal: '', frontAmount: 0, backAmount: 0, totalAmount: 0 }
  if (!bet) return empty
  const parts = bet.split(':')
  // Structured: betType:amount:scoringType[:sweepAmount[:handicapSide:front:back:total]]
  if (parts.length >= 2 && (parts[0] === 'nassau' || parts[0] === 'straight')) {
    const rawAmt = parts[1] ?? ''
    return {
      betType: parts[0] as 'nassau' | 'straight',
      amount: rawAmt,
      scoringType: parts[2] === 'match' ? 'match' : 'stroke',
      sweepAmount: parts[3] ?? '',
      handicapSide: parts[4] ?? '',
      handicapFront: parts[5] ?? '',
      handicapBack: parts[6] ?? '',
      handicapTotal: parts[7] ?? '',
      ...parseAmounts(rawAmt),
    }
  }
  // Scoring-only: score:scoringType (no bet type chosen)
  if (parts[0] === 'score' && parts.length >= 2) {
    return { ...empty, scoringType: parts[1] === 'match' ? 'match' : 'stroke' }
  }
  // Legacy free text
  return { ...empty, amount: bet }
}

function formatBet(bet: string): string {
  if (!bet) return ''
  if (!bet.startsWith('nassau:') && !bet.startsWith('straight:') && !bet.startsWith('score:')) return bet // legacy free text
  const { betType, scoringType, sweepAmount, frontAmount, backAmount, totalAmount } = parseBet(bet)
  const scoringLabel = scoringType === 'match' ? 'Match Play' : 'Stroke Play'
  if (betType === 'nassau') {
    const sweepLabel = sweepAmount ? ` · Sweep $${sweepAmount}` : ''
    const allSame = frontAmount > 0 && frontAmount === backAmount && backAmount === totalAmount
    const anyAmt = frontAmount > 0 || backAmount > 0 || totalAmount > 0
    const amtLabel = allSame ? `$${frontAmount} ` : anyAmt ? `$${frontAmount}/$${backAmount}/$${totalAmount} ` : ''
    return `${amtLabel}Nassau${sweepLabel} · ${scoringLabel}`
  }
  if (betType === 'straight' && totalAmount > 0) return `$${totalAmount} Overall · ${scoringLabel}`
  if (betType === 'straight') return `Overall · ${scoringLabel}`
  return scoringLabel
}

function computeStats(
  p1Id: string, p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: PayoutHole[]
) {
  let p1Wins = 0, p2Wins = 0, ties = 0
  let p1FW = 0, p2FW = 0, p1BW = 0, p2BW = 0
  let p1F = 0, p2F = 0, fPar = 0, fPlayed = 0
  let p1B = 0, p2B = 0, bPar = 0, bPlayed = 0
  let p1T = 0, p2T = 0, tPar = 0, tPlayed = 0
  const rows: { hole: PayoutHole; s1: number | null; s2: number | null; result: 'win' | 'loss' | 'tie' | null }[] = []

  for (const hole of holes) {
    const s1 = scoreMap[p1Id]?.[hole.hole_number] ?? null
    const s2 = scoreMap[p2Id]?.[hole.hole_number] ?? null
    let result: 'win' | 'loss' | 'tie' | null = null
    if (s1 !== null && s2 !== null) {
      tPlayed++; p1T += s1; p2T += s2; tPar += hole.par
      if (hole.hole_number <= 9) { fPlayed++; p1F += s1; p2F += s2; fPar += hole.par }
      else { bPlayed++; p1B += s1; p2B += s2; bPar += hole.par }
      if (s1 < s2) { result = 'win'; p1Wins++; if (hole.hole_number <= 9) p1FW++; else p1BW++ }
      else if (s1 > s2) { result = 'loss'; p2Wins++; if (hole.hole_number <= 9) p2FW++; else p2BW++ }
      else { result = 'tie'; ties++ }
    }
    rows.push({ hole, s1, s2, result })
  }

  return {
    rows, p1Wins, p2Wins, ties, holesPlayed: tPlayed,
    p1FrontWins: p1FW, p2FrontWins: p2FW, p1BackWins: p1BW, p2BackWins: p2BW,
    p1Front: fPlayed > 0 ? p1F - fPar : null,
    p2Front: fPlayed > 0 ? p2F - fPar : null,
    p1Back: bPlayed > 0 ? p1B - bPar : null,
    p2Back: bPlayed > 0 ? p2B - bPar : null,
    p1Total: tPlayed > 0 ? p1T - tPar : null,
    p2Total: tPlayed > 0 ? p2T - tPar : null,
    p1TotalStrokes: p1T, p2TotalStrokes: p2T,
  }
}

type PayoutBBRow = {
  hole: PayoutHole
  t1p1: number | null; t1p2: number | null; t1Best: number | null
  t2p1: number | null; t2p2: number | null; t2Best: number | null
  result: 'team1' | 'team2' | 'tie' | null
}

function computeBestBall(
  t1p1Id: string, t1p2Id: string,
  t2p1Id: string, t2p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: PayoutHole[]
) {
  let t1Wins = 0, t2Wins = 0, ties = 0
  let t1FW = 0, t2FW = 0, t1BW = 0, t2BW = 0
  let t1F = 0, t2F = 0, fPar = 0, fPlayed = 0
  let t1B = 0, t2B = 0, bPar = 0, bPlayed = 0
  let t1T = 0, t2T = 0, tPar = 0, tPlayed = 0
  const rows: PayoutBBRow[] = []

  for (const hole of holes) {
    const t1p1 = scoreMap[t1p1Id]?.[hole.hole_number] ?? null
    const t1p2 = scoreMap[t1p2Id]?.[hole.hole_number] ?? null
    const t2p1 = scoreMap[t2p1Id]?.[hole.hole_number] ?? null
    const t2p2 = scoreMap[t2p2Id]?.[hole.hole_number] ?? null
    const t1Arr = ([t1p1, t1p2] as (number | null)[]).filter((s): s is number => s !== null)
    const t2Arr = ([t2p1, t2p2] as (number | null)[]).filter((s): s is number => s !== null)
    const t1Best = t1Arr.length > 0 ? Math.min(...t1Arr) : null
    const t2Best = t2Arr.length > 0 ? Math.min(...t2Arr) : null
    let result: 'team1' | 'team2' | 'tie' | null = null
    if (t1Best !== null && t2Best !== null) {
      tPlayed++; t1T += t1Best; t2T += t2Best; tPar += hole.par
      if (hole.hole_number <= 9) { fPlayed++; t1F += t1Best; t2F += t2Best; fPar += hole.par }
      else { bPlayed++; t1B += t1Best; t2B += t2Best; bPar += hole.par }
      if (t1Best < t2Best) { result = 'team1'; t1Wins++; if (hole.hole_number <= 9) t1FW++; else t1BW++ }
      else if (t1Best > t2Best) { result = 'team2'; t2Wins++; if (hole.hole_number <= 9) t2FW++; else t2BW++ }
      else { result = 'tie'; ties++ }
    }
    rows.push({ hole, t1p1, t1p2, t1Best, t2p1, t2p2, t2Best, result })
  }

  return {
    rows, t1Wins, t2Wins, ties, holesPlayed: tPlayed,
    t1FrontWins: t1FW, t2FrontWins: t2FW, t1BackWins: t1BW, t2BackWins: t2BW,
    t1Front: fPlayed > 0 ? t1F - fPar : null,
    t2Front: fPlayed > 0 ? t2F - fPar : null,
    t1Back: bPlayed > 0 ? t1B - bPar : null,
    t2Back: bPlayed > 0 ? t2B - bPar : null,
    t1Total: tPlayed > 0 ? t1T - tPar : null,
    t2Total: tPlayed > 0 ? t2T - tPar : null,
  }
}

export function computeAllMatchupPayouts(
  matchups: PayoutH2HMatchup[],
  bestBallMatchups: PayoutBBMatchup[],
  medleyMatchups: MedleyMatchup[],
  players: { id: string; name: string }[],
  scoreMap: Record<string, Record<number, number>>,
  holes: PayoutHole[],
  handicapRounding?: string | null
): {
  rows: MatchupPayoutRow[]
  net: Record<string, number>
  involvedIds: Set<string>
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const net: Record<string, number> = {}
  for (const p of players) net[p.id] = 0
  const rows: MatchupPayoutRow[] = []
  const involvedIds = new Set<string>()
  const lastHoleNumber = holes.length > 0 ? Math.max(...holes.map((h) => h.hole_number)) : 18

  // ── Head to Head ─────────────────────────────────────────────────
  for (const m of matchups) {
    const mp1 = players.find((p) => p.id === m.player1_id)
    const mp2 = players.find((p) => p.id === m.player2_id)
    if (!mp1 || !mp2) continue
    involvedIds.add(m.player1_id); involvedIds.add(m.player2_id)

    const { betType, scoringType, sweepAmount, handicapSide, handicapFront, handicapBack, handicapTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)

    if (!hasBet) {
      // Old matchup with no bet configured — show it but skip payout math
      rows.push({ id: m.id, type: 'h2h', label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }

    const matchupHoles = m.hole_range === 'front9'
      ? holes.filter(h => h.hole_number <= 9)
      : m.hole_range === 'back9'
      ? holes.filter(h => h.hole_number > 9)
      : holes
    const matchupLastHole = matchupHoles.length > 0 ? Math.max(...matchupHoles.map(h => h.hole_number)) : lastHoleNumber
    const stats = computeStats(m.player1_id, m.player2_id, scoreMap, matchupHoles)
    const hole9 = scoreMap[m.player1_id]?.[9] != null && scoreMap[m.player2_id]?.[9] != null
    const holeLastPlayed = scoreMap[m.player1_id]?.[matchupLastHole] != null && scoreMap[m.player2_id]?.[matchupLastHole] != null
    const p1 = m.player1_id, p2 = m.player2_id

    // Stroke handicap adjustments (stroke play only — match play handles strokes per-hole differently)
    const hf = scoringType === 'stroke' ? (parseFloat(handicapFront) || 0) : 0
    const hb = scoringType === 'stroke' ? (parseFloat(handicapBack) || 0) : 0
    const ht = scoringType === 'stroke' ? (parseFloat(handicapTotal) || 0) : 0
    const adjP1Front = stats.p1Front !== null ? stats.p1Front - (handicapSide === 'p1' ? hf : 0) : null
    const adjP2Front = stats.p2Front !== null ? stats.p2Front - (handicapSide === 'p2' ? hf : 0) : null
    const adjP1Back  = stats.p1Back  !== null ? stats.p1Back  - (handicapSide === 'p1' ? hb : 0) : null
    const adjP2Back  = stats.p2Back  !== null ? stats.p2Back  - (handicapSide === 'p2' ? hb : 0) : null
    const adjP1Total = stats.p1Total !== null ? stats.p1Total - (handicapSide === 'p1' ? ht : 0) : null
    const adjP2Total = stats.p2Total !== null ? stats.p2Total - (handicapSide === 'p2' ? ht : 0) : null

    const resolveH2H = (
      settled: boolean,
      sl: 'p1' | 'p2' | 'tie' | null,
      mpDiff: number,
      amt: number
    ): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const p1Wins = scoringType === 'match' ? mpDiff > 0 : sl === 'p1'
      const p2Wins = scoringType === 'match' ? mpDiff < 0 : sl === 'p2'
      if (p1Wins) { net[p1] += amt; net[p2] -= amt; return { winnerLabel: mp1.name, tied: false } }
      if (p2Wins) { net[p2] += amt; net[p1] -= amt; return { winnerLabel: mp2.name, tied: false } }
      return { winnerLabel: null, tied: true }
    }

    const strokeLeader = (a: number | null, b: number | null): 'p1' | 'p2' | 'tie' | null =>
      a === null || b === null ? null : a < b ? 'p1' : b < a ? 'p2' : 'tie'

    // Press-forfeited segments settle immediately to whoever led when the press began
    const forfeitAt = pressForfeitMap(m.press)
    const preSeg = (startHole: number, seg: 'front' | 'back' | 'total') => {
      const ps = computeStats(m.player1_id, m.player2_id, scoreMap, matchupHoles.filter(h => h.hole_number < startHole))
      if (seg === 'front') return { sl: strokeLeader(ps.p1Front !== null ? ps.p1Front - (handicapSide === 'p1' ? hf : 0) : null, ps.p2Front !== null ? ps.p2Front - (handicapSide === 'p2' ? hf : 0) : null), diff: ps.p1FrontWins - ps.p2FrontWins }
      if (seg === 'back') return { sl: strokeLeader(ps.p1Back !== null ? ps.p1Back - (handicapSide === 'p1' ? hb : 0) : null, ps.p2Back !== null ? ps.p2Back - (handicapSide === 'p2' ? hb : 0) : null), diff: ps.p1BackWins - ps.p2BackWins }
      return { sl: strokeLeader(ps.p1Total !== null ? ps.p1Total - (handicapSide === 'p1' ? ht : 0) : null, ps.p2Total !== null ? ps.p2Total - (handicapSide === 'p2' ? ht : 0) : null), diff: ps.p1Wins - ps.p2Wins }
    }

    const segments: MatchupPayoutSegment[] = []
    if (betType === 'nassau') {
      const fPre = forfeitAt.front !== undefined ? preSeg(forfeitAt.front, 'front') : null
      const fSett = fPre ? true : (hole9 && stats.p1Front !== null && stats.p2Front !== null)
      const { winnerLabel: fWL, tied: fT } = resolveH2H(fSett, fPre ? fPre.sl : strokeLeader(adjP1Front, adjP2Front), fPre ? fPre.diff : stats.p1FrontWins - stats.p2FrontWins, fBetAmt)
      segments.push({ name: 'Front', settled: fSett, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: false, forfeited: !!fPre })

      const bPre = forfeitAt.back !== undefined ? preSeg(forfeitAt.back, 'back') : null
      const bSett = bPre ? true : ((scoreMap[m.player1_id]?.[18] != null && scoreMap[m.player2_id]?.[18] != null) && stats.p1Back !== null && stats.p2Back !== null)
      const { winnerLabel: bWL, tied: bT } = resolveH2H(bSett, bPre ? bPre.sl : strokeLeader(adjP1Back, adjP2Back), bPre ? bPre.diff : stats.p1BackWins - stats.p2BackWins, bBetAmt)
      segments.push({ name: 'Back', settled: bSett, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: false, forfeited: !!bPre })
    }
    const tPre = forfeitAt.total !== undefined ? preSeg(forfeitAt.total, 'total') : null
    const tSett = tPre ? true : (holeLastPlayed && stats.p1Total !== null && stats.p2Total !== null)
    const { winnerLabel: tWL, tied: tT } = resolveH2H(tSett, tPre ? tPre.sl : strokeLeader(adjP1Total, adjP2Total), tPre ? tPre.diff : stats.p1Wins - stats.p2Wins, tBetAmt)
    segments.push({ name: 'Total', settled: tSett, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: false, forfeited: !!tPre })

    let nassauResult: MatchupPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const p1Net = segments.reduce((sum, s) => {
        if (!s.settled || s.tied || s.winnerLabel === null) return sum
        return sum + (s.winnerLabel === mp1.name ? s.amount : -s.amount)
      }, 0)
      nassauResult = {
        winnerLabel: p1Net > 0 ? mp1.name : p1Net < 0 ? mp2.name : null,
        amount: Math.abs(p1Net),
        perPlayer: false,
        anySettled: segments.some((s) => s.settled),
      }
      // Apply sweep: if one side wins all 3 settled segments, replace net with sweepAmt
      const sweepAmt = parseFloat(sweepAmount)
      if (!isNaN(sweepAmt) && sweepAmt > 0 && segments.length === 3) {
        const [fSeg, bSeg, tSeg] = segments
        if (fSeg.settled && bSeg.settled && tSeg.settled) {
          const p1Swept = fSeg.winnerLabel === mp1.name && bSeg.winnerLabel === mp1.name && tSeg.winnerLabel === mp1.name
          const p2Swept = fSeg.winnerLabel === mp2.name && bSeg.winnerLabel === mp2.name && tSeg.winnerLabel === mp2.name
          if (p1Swept || p2Swept) {
            const winner = p1Swept ? p1 : p2; const loser = p1Swept ? p2 : p1
            const normalTotal = fBetAmt + bBetAmt + tBetAmt
            const adj = sweepAmt - normalTotal
            net[winner] = (net[winner] ?? 0) + adj; net[loser] = (net[loser] ?? 0) - adj
            nassauResult = { ...nassauResult, amount: sweepAmt, swept: true }
          }
        }
      }
    }
    // ── Press bets ──────────────────────────────────────────────────────────
    let p1PressNet = 0
    for (const press of (m.press ?? [])) {
      const pressHoles = matchupHoles.filter(h => h.hole_number >= press.holeStart && h.hole_number <= press.holeEnd)
      if (pressHoles.length === 0) continue
      let p1Sum = 0, p2Sum = 0, parSum = 0, played = 0
      for (const h of pressHoles) {
        const s1 = scoreMap[p1]?.[h.hole_number] ?? null, s2 = scoreMap[p2]?.[h.hole_number] ?? null
        if (s1 === null || s2 === null) continue
        p1Sum += s1; p2Sum += s2; parSum += h.par; played++
      }
      if (played !== pressHoles.length || played === 0) continue
      const strokes = press.strokes ?? 0
      const adjP1 = (p1Sum - parSum) - (press.strokesSide === 'p1' ? strokes : 0)
      const adjP2 = (p2Sum - parSum) - (press.strokesSide === 'p2' ? strokes : 0)
      if (adjP1 < adjP2) { net[p1] = (net[p1] ?? 0) + press.amount; net[p2] = (net[p2] ?? 0) - press.amount; p1PressNet += press.amount }
      else if (adjP2 < adjP1) { net[p2] = (net[p2] ?? 0) + press.amount; net[p1] = (net[p1] ?? 0) - press.amount; p1PressNet -= press.amount }
    }
    // Fold settled presses into the displayed result so it matches the money
    if ((m.press ?? []).length > 0) {
      const totalSeg = segments[segments.length - 1]
      const baseNet = nassauResult
        ? (nassauResult.winnerLabel === mp1.name ? nassauResult.amount : nassauResult.winnerLabel === mp2.name ? -nassauResult.amount : 0)
        : (totalSeg.settled && !totalSeg.tied && totalSeg.winnerLabel !== null ? (totalSeg.winnerLabel === mp1.name ? totalSeg.amount : -totalSeg.amount) : 0)
      const anySettledBase = nassauResult ? nassauResult.anySettled : totalSeg.settled
      const combined = baseNet + p1PressNet
      const combinedWinner = combined > 0 ? mp1.name : combined < 0 ? mp2.name : null
      if (anySettledBase || p1PressNet !== 0) {
        nassauResult = {
          winnerLabel: combinedWinner,
          amount: Math.abs(combined),
          perPlayer: false,
          anySettled: true,
          ...(nassauResult?.swept && combinedWinner === nassauResult.winnerLabel ? { swept: true } : {}),
        }
      }
    }
    rows.push({ id: m.id, type: 'h2h', label: `${mp1.name} vs ${mp2.name}`, betLabel: formatBet(m.bet), segments, nassauResult })
  }

  // ── Best Ball ─────────────────────────────────────────────────────
  for (const m of bestBallMatchups) {
    const t1p1 = players.find((p) => p.id === m.team1_player1_id)
    const t1p2 = players.find((p) => p.id === m.team1_player2_id)
    const t2p1 = players.find((p) => p.id === m.team2_player1_id)
    const t2p2 = players.find((p) => p.id === m.team2_player2_id)
    if (!t1p1 || !t1p2 || !t2p1 || !t2p2) continue
    involvedIds.add(m.team1_player1_id); involvedIds.add(m.team1_player2_id)
    involvedIds.add(m.team2_player1_id); involvedIds.add(m.team2_player2_id)

    const { betType, scoringType, sweepAmount, handicapSide, handicapFront, handicapBack, handicapTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)
    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`
    const t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`

    if (!hasBet) {
      rows.push({ id: m.id, type: 'bb', label: `${t1Name} vs ${t2Name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }

    const bbMatchupHoles = m.hole_range === 'front9'
      ? holes.filter(h => h.hole_number <= 9)
      : m.hole_range === 'back9'
      ? holes.filter(h => h.hole_number > 9)
      : holes
    const bbMatchupLastHole = bbMatchupHoles.length > 0 ? Math.max(...bbMatchupHoles.map(h => h.hole_number)) : lastHoleNumber
    const bbScoreMap = applyPlayerStrokesToScoreMap(scoreMap, computeBBStrokeHoles(m.player_strokes, bbMatchupHoles, handicapRounding))
    const stats = computeBestBall(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, bbScoreMap, bbMatchupHoles)
    const t1Ids = [m.team1_player1_id, m.team1_player2_id]
    const t2Ids = [m.team2_player1_id, m.team2_player2_id]
    const bbHole9 = t1Ids.some((id) => scoreMap[id]?.[9] != null) && t2Ids.some((id) => scoreMap[id]?.[9] != null)
    const bbHole18 = t1Ids.some((id) => scoreMap[id]?.[18] != null) && t2Ids.some((id) => scoreMap[id]?.[18] != null)
    const bbHoleLastPlayed = t1Ids.some((id) => scoreMap[id]?.[bbMatchupLastHole] != null) && t2Ids.some((id) => scoreMap[id]?.[bbMatchupLastHole] != null)

    // Stroke handicap adjustments (stroke play only)
    const bbHf = scoringType === 'stroke' ? (parseFloat(handicapFront) || 0) : 0
    const bbHb = scoringType === 'stroke' ? (parseFloat(handicapBack) || 0) : 0
    const bbHt = scoringType === 'stroke' ? (parseFloat(handicapTotal) || 0) : 0
    const adjT1Front = stats.t1Front !== null ? stats.t1Front - (handicapSide === 't1' ? bbHf : 0) : null
    const adjT2Front = stats.t2Front !== null ? stats.t2Front - (handicapSide === 't2' ? bbHf : 0) : null
    const adjT1Back  = stats.t1Back  !== null ? stats.t1Back  - (handicapSide === 't1' ? bbHb : 0) : null
    const adjT2Back  = stats.t2Back  !== null ? stats.t2Back  - (handicapSide === 't2' ? bbHb : 0) : null
    const adjT1Total = stats.t1Total !== null ? stats.t1Total - (handicapSide === 't1' ? bbHt : 0) : null
    const adjT2Total = stats.t2Total !== null ? stats.t2Total - (handicapSide === 't2' ? bbHt : 0) : null

    const strokeLeaderBB = (a: number | null, b: number | null): 't1' | 't2' | 'tie' | null =>
      a === null || b === null ? null : a < b ? 't1' : b < a ? 't2' : 'tie'

    const resolveBB = (
      settled: boolean,
      sl: 't1' | 't2' | 'tie' | null,
      mpDiff: number,
      amt: number
    ): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const t1Wins = scoringType === 'match' ? mpDiff > 0 : sl === 't1'
      const t2Wins = scoringType === 'match' ? mpDiff < 0 : sl === 't2'
      if (t1Wins) {
        for (const id of t1Ids) net[id] = (net[id] ?? 0) + amt
        for (const id of t2Ids) net[id] = (net[id] ?? 0) - amt
        return { winnerLabel: t1Name, tied: false }
      }
      if (t2Wins) {
        for (const id of t2Ids) net[id] = (net[id] ?? 0) + amt
        for (const id of t1Ids) net[id] = (net[id] ?? 0) - amt
        return { winnerLabel: t2Name, tied: false }
      }
      return { winnerLabel: null, tied: true }
    }

    // Press-forfeited segments settle immediately to whoever led when the press began
    const bbForfeitAt = pressForfeitMap(m.press)
    const bbPreSeg = (startHole: number, seg: 'front' | 'back' | 'total') => {
      const ps = computeBestBall(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, bbScoreMap, bbMatchupHoles.filter(h => h.hole_number < startHole))
      if (seg === 'front') return { sl: strokeLeaderBB(ps.t1Front !== null ? ps.t1Front - (handicapSide === 't1' ? bbHf : 0) : null, ps.t2Front !== null ? ps.t2Front - (handicapSide === 't2' ? bbHf : 0) : null), diff: ps.t1FrontWins - ps.t2FrontWins }
      if (seg === 'back') return { sl: strokeLeaderBB(ps.t1Back !== null ? ps.t1Back - (handicapSide === 't1' ? bbHb : 0) : null, ps.t2Back !== null ? ps.t2Back - (handicapSide === 't2' ? bbHb : 0) : null), diff: ps.t1BackWins - ps.t2BackWins }
      return { sl: strokeLeaderBB(ps.t1Total !== null ? ps.t1Total - (handicapSide === 't1' ? bbHt : 0) : null, ps.t2Total !== null ? ps.t2Total - (handicapSide === 't2' ? bbHt : 0) : null), diff: ps.t1Wins - ps.t2Wins }
    }

    const segments: MatchupPayoutSegment[] = []
    if (betType === 'nassau') {
      const fPre = bbForfeitAt.front !== undefined ? bbPreSeg(bbForfeitAt.front, 'front') : null
      const fSett = fPre ? true : (bbHole9 && stats.t1Front !== null && stats.t2Front !== null)
      const { winnerLabel: fWL, tied: fT } = resolveBB(fSett, fPre ? fPre.sl : strokeLeaderBB(adjT1Front, adjT2Front), fPre ? fPre.diff : stats.t1FrontWins - stats.t2FrontWins, fBetAmt)
      segments.push({ name: 'Front', settled: fSett, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: true, forfeited: !!fPre })

      const bPre = bbForfeitAt.back !== undefined ? bbPreSeg(bbForfeitAt.back, 'back') : null
      const bSett = bPre ? true : (bbHole18 && stats.t1Back !== null && stats.t2Back !== null)
      const { winnerLabel: bWL, tied: bT } = resolveBB(bSett, bPre ? bPre.sl : strokeLeaderBB(adjT1Back, adjT2Back), bPre ? bPre.diff : stats.t1BackWins - stats.t2BackWins, bBetAmt)
      segments.push({ name: 'Back', settled: bSett, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: true, forfeited: !!bPre })
    }
    const tPre = bbForfeitAt.total !== undefined ? bbPreSeg(bbForfeitAt.total, 'total') : null
    const tSett = tPre ? true : (bbHoleLastPlayed && stats.t1Total !== null && stats.t2Total !== null)
    const { winnerLabel: tWL, tied: tT } = resolveBB(tSett, tPre ? tPre.sl : strokeLeaderBB(adjT1Total, adjT2Total), tPre ? tPre.diff : stats.t1Wins - stats.t2Wins, tBetAmt)
    segments.push({ name: 'Total', settled: tSett, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: true, forfeited: !!tPre })

    let nassauResult: MatchupPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const t1Net = segments.reduce((sum, s) => {
        if (!s.settled || s.tied || s.winnerLabel === null) return sum
        return sum + (s.winnerLabel === t1Name ? s.amount : -s.amount)
      }, 0)
      nassauResult = {
        winnerLabel: t1Net > 0 ? t1Name : t1Net < 0 ? t2Name : null,
        amount: Math.abs(t1Net),
        perPlayer: true,
        anySettled: segments.some((s) => s.settled),
      }
      // Apply sweep: if one team wins all 3 settled segments, replace net with sweepAmt
      const sweepAmt = parseFloat(sweepAmount)
      if (!isNaN(sweepAmt) && sweepAmt > 0 && segments.length === 3) {
        const [fSeg, bSeg, tSeg] = segments
        if (fSeg.settled && bSeg.settled && tSeg.settled) {
          const t1Swept = fSeg.winnerLabel === t1Name && bSeg.winnerLabel === t1Name && tSeg.winnerLabel === t1Name
          const t2Swept = fSeg.winnerLabel === t2Name && bSeg.winnerLabel === t2Name && tSeg.winnerLabel === t2Name
          if (t1Swept || t2Swept) {
            const wIds = t1Swept ? t1Ids : t2Ids; const lIds = t1Swept ? t2Ids : t1Ids
            const normalTotal = fBetAmt + bBetAmt + tBetAmt
            const adj = sweepAmt - normalTotal
            for (const id of wIds) net[id] = (net[id] ?? 0) + adj
            for (const id of lIds) net[id] = (net[id] ?? 0) - adj
            nassauResult = { ...nassauResult, amount: sweepAmt, swept: true }
          }
        }
      }
    }
    // BB press bets
    let t1PressNet = 0
    for (const press of (m.press ?? [])) {
      const pressHoles = bbMatchupHoles.filter(h => h.hole_number >= press.holeStart && h.hole_number <= press.holeEnd)
      if (pressHoles.length === 0) continue
      let t1Sum = 0, t2Sum = 0, parSum = 0, played = 0
      for (const h of pressHoles) {
        const t1Arr = ([bbScoreMap[t1Ids[0]]?.[h.hole_number] ?? null, bbScoreMap[t1Ids[1]]?.[h.hole_number] ?? null] as (number | null)[]).filter((s): s is number => s !== null)
        const t2Arr = ([bbScoreMap[t2Ids[0]]?.[h.hole_number] ?? null, bbScoreMap[t2Ids[1]]?.[h.hole_number] ?? null] as (number | null)[]).filter((s): s is number => s !== null)
        if (t1Arr.length === 0 || t2Arr.length === 0) continue
        t1Sum += Math.min(...t1Arr); t2Sum += Math.min(...t2Arr); parSum += h.par; played++
      }
      if (played !== pressHoles.length || played === 0) continue
      const strokes = press.strokes ?? 0
      const adjT1 = (t1Sum - parSum) - (press.strokesSide === 'p1' ? strokes : 0)
      const adjT2 = (t2Sum - parSum) - (press.strokesSide === 'p2' ? strokes : 0)
      if (adjT1 < adjT2) { for (const id of t1Ids) net[id] = (net[id] ?? 0) + press.amount; for (const id of t2Ids) net[id] = (net[id] ?? 0) - press.amount; t1PressNet += press.amount }
      else if (adjT2 < adjT1) { for (const id of t2Ids) net[id] = (net[id] ?? 0) + press.amount; for (const id of t1Ids) net[id] = (net[id] ?? 0) - press.amount; t1PressNet -= press.amount }
    }
    // Fold settled presses into the displayed result so it matches the money
    if ((m.press ?? []).length > 0) {
      const totalSeg = segments[segments.length - 1]
      const baseNet = nassauResult
        ? (nassauResult.winnerLabel === t1Name ? nassauResult.amount : nassauResult.winnerLabel === t2Name ? -nassauResult.amount : 0)
        : (totalSeg.settled && !totalSeg.tied && totalSeg.winnerLabel !== null ? (totalSeg.winnerLabel === t1Name ? totalSeg.amount : -totalSeg.amount) : 0)
      const anySettledBase = nassauResult ? nassauResult.anySettled : totalSeg.settled
      const combined = baseNet + t1PressNet
      const combinedWinner = combined > 0 ? t1Name : combined < 0 ? t2Name : null
      if (anySettledBase || t1PressNet !== 0) {
        nassauResult = {
          winnerLabel: combinedWinner,
          amount: Math.abs(combined),
          perPlayer: true,
          anySettled: true,
          ...(nassauResult?.swept && combinedWinner === nassauResult.winnerLabel ? { swept: true } : {}),
        }
      }
    }
    rows.push({ id: m.id, type: 'bb', label: `${t1Name} vs ${t2Name}`, betLabel: formatBet(m.bet), segments, nassauResult })
  }

  // ── Medley (3-5 players, low ball) ────────────────────────────────
  for (const mm of medleyMatchups) {
    const entries = (mm.players ?? []).filter((e) => e && e.id && players.some((p) => p.id === e.id))
    if (entries.length < 2) continue
    for (const e of entries) involvedIds.add(e.id)
    const { segments: medSegs, netDelta } = computeMedley({ ...mm, players: entries }, scoreMap, holes)
    for (const [id, amt] of Object.entries(netDelta)) net[id] = (net[id] ?? 0) + amt
    const names = entries.map((e) => players.find((p) => p.id === e.id)?.name.split(' ')[0] ?? '?')
    const amtNum = Number(mm.amount) || 0
    rows.push({
      id: mm.id, type: 'medley',
      label: names.join(' vs '),
      betLabel: amtNum > 0 ? `$${amtNum} ${mm.bet_type === 'nassau' ? 'Nassau' : 'Overall'} · Low Ball` : 'No bet configured',
      // Display the winner's TOTAL take (amount from each other player)
      segments: amtNum > 0 ? medSegs.map((s) => ({
        name: s.name, settled: s.settled, tied: s.tied, amount: s.amount * (entries.length - 1), perPlayer: false,
        winnerLabel: s.winnerId ? (players.find((p) => p.id === s.winnerId)?.name ?? null) : null,
      })) : [],
    })
  }

  // ── Minimize settlements ──────────────────────────────────────────
  const pw = players.map((p) => ({ id: p.id, name: p.name, bal: Math.round((net[p.id] ?? 0) * 100) / 100 }))
    .filter((b) => b.bal > 0.005).sort((a, b) => b.bal - a.bal).map((b) => ({ ...b }))
  const nw = players.map((p) => ({ id: p.id, name: p.name, bal: Math.round((net[p.id] ?? 0) * 100) / 100 }))
    .filter((b) => b.bal < -0.005).sort((a, b) => a.bal - b.bal).map((b) => ({ ...b }))
  const settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []
  let wi = 0, li = 0
  while (wi < pw.length && li < nw.length) {
    const amount = Math.round(Math.min(pw[wi].bal, -nw[li].bal) * 100) / 100
    if (Math.round(amount) > 0) settlements.push({ fromId: nw[li].id, fromName: nw[li].name, toId: pw[wi].id, toName: pw[wi].name, amount })
    pw[wi].bal = Math.round((pw[wi].bal - amount) * 100) / 100
    nw[li].bal = Math.round((nw[li].bal + amount) * 100) / 100
    if (pw[wi].bal <= 0.005) wi++
    if (nw[li].bal >= -0.005) li++
  }

  return { rows, net, involvedIds, settlements }
}

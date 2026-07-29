// Balanced team/group generation, shared by the Admin Hub's round-building
// generator and the standalone preview generator in the Player Roster section.

export type GeneratedPlayer = { id: string; name: string; handicap: number | null; source: 'roster' | 'manual' }
export type GeneratedTeam = { name: string; pin: string; players: GeneratedPlayer[]; avgHandicap: number | null }

// Plus handicaps are stored negative (+2 → -2); accept "+2", "2", "14.5", blank
export function parseHcpInput(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const n = s.startsWith('+') ? -parseFloat(s.slice(1)) : parseFloat(s)
  return isNaN(n) ? null : n
}

export function fmtHcp(h: number): string {
  return h < 0 ? `+${Math.abs(h)}` : `${h}`
}

// Auto-generated PINs always default to 1234 — admins change them if they want
export function randomPin(): string {
  return '1234'
}

// Membership fingerprint so Re-generate can guarantee a different arrangement
export function teamsSignature(ts: GeneratedTeam[]): string {
  return ts.map(t => t.players.map(p => p.id).sort().join(',')).sort().join('|')
}

export function generateBalancedTeams(players: GeneratedPlayer[], numTeams: number, rng?: () => number): GeneratedTeam[] {
  // Sort best to worst. Plus handicaps are stored as negative numbers (e.g. +2.3 = -2.3),
  // so ascending sort correctly places the best players first.
  // With an rng, each handicap gets a small jitter before sorting — the draft starts
  // from a different order, and the swap optimizer then lands in a different (still
  // near-balanced) local optimum, so Re-generate produces genuinely different teams.
  const jitter = rng ? () => (rng() - 0.5) * 4 : () => 0
  const keyed = players.map((p) => ({ p, key: p.handicap == null ? Number.POSITIVE_INFINITY : p.handicap + jitter() }))
  keyed.sort((a, b) => a.key - b.key)
  const sorted = keyed.map((k) => k.p)

  const n = sorted.length
  const smallSize = Math.floor(n / numTeams)
  const slots: GeneratedPlayer[][] = Array.from({ length: numTeams }, () => [])

  // Phase 1: snake draft fills every team to smallSize.
  const phase1Total = smallSize * numTeams
  for (let i = 0; i < phase1Total; i++) {
    const round = Math.floor(i / numTeams)
    const pos = i % numTeams
    const teamIdx = round % 2 === 0 ? pos : numTeams - 1 - pos
    slots[teamIdx].push(sorted[i])
  }

  // Phase 2: remaining players (worst-ranked) go to the weakest teams.
  // Larger teams have a structural advantage in best-ball, so they should
  // have the weakest players to compensate.
  for (let i = phase1Total; i < n; i++) {
    let target = 0, worstSum = -Infinity
    for (let t = 0; t < numTeams; t++) {
      if (slots[t].length > smallSize) continue
      const sum = slots[t].reduce((s, p) => s + (p.handicap ?? 0), 0)
      if (sum > worstSum) { worstSum = sum; target = t }
    }
    slots[target].push(sorted[i])
  }

  // Phase 3: swap optimization — find cross-team player swaps that improve balance.
  // Metric: variance in "effective average" = average of the best smallSize players
  // on each team. This accounts for extra-player structural advantage in best-ball:
  // a 5-player team effectively plays their best 4 balls, so we compare on that basis.
  const effectiveAvg = (team: GeneratedPlayer[]) => {
    const hcps = team.map(p => p.handicap ?? 0).sort((a, b) => a - b)
    const best = hcps.slice(0, smallSize)
    return best.reduce((s, h) => s + h, 0) / (smallSize || 1)
  }
  const variance = () => {
    const avgs = slots.map(effectiveAvg)
    const mean = avgs.reduce((s, a) => s + a, 0) / numTeams
    return avgs.reduce((s, a) => s + (a - mean) ** 2, 0)
  }

  let improved = true
  while (improved) {
    improved = false
    outer: for (let t1 = 0; t1 < numTeams; t1++) {
      for (let t2 = t1 + 1; t2 < numTeams; t2++) {
        for (let i = 0; i < slots[t1].length; i++) {
          for (let j = 0; j < slots[t2].length; j++) {
            const before = variance()
            ;[slots[t1][i], slots[t2][j]] = [slots[t2][j], slots[t1][i]]
            if (variance() < before - 1e-9) {
              improved = true
              break outer  // restart with the improved assignment
            }
            ;[slots[t1][i], slots[t2][j]] = [slots[t2][j], slots[t1][i]]
          }
        }
      }
    }
  }

  return slots.map((teamPlayers, i) => {
    const sorted = [...teamPlayers].sort((a, b) => {
      if (a.handicap == null && b.handicap == null) return 0
      if (a.handicap == null) return 1
      if (b.handicap == null) return -1
      return a.handicap - b.handicap
    })
    const withHcp = sorted.filter(p => p.handicap != null)
    const avg = withHcp.length
      ? +(withHcp.reduce((s, p) => s + p.handicap!, 0) / withHcp.length).toFixed(1)
      : null
    return { name: `Team ${i + 1}`, pin: randomPin(), players: sorted, avgHandicap: avg }
  })
}

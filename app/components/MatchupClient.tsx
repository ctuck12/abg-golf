'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import {
  saveMatchup, deleteMatchup, updateMatchupBet,
  saveBestBallMatchup, deleteBestBallMatchup, updateBestBallBet,
} from '@/app/actions'

type Player = { id: string; name: string; teamName: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string }
type BestBallMatchup = {
  id: string
  team1_player1_id: string; team1_player2_id: string
  team2_player1_id: string; team2_player2_id: string
  bet: string
}
type ScorecardTarget =
  | { type: 'player'; id: string; name: string }
  | { type: 'h2h'; p1Id: string; p2Id: string; p1Name: string; p2Name: string; scoringType: ScoringType; betType: BetType | '' }
  | { type: 'bestball'; p1Id: string; p2Id: string; teamName: string }
  | { type: 'bb-scorecards'; t1p1Id: string; t1p2Id: string; t2p1Id: string; t2p2Id: string; t1p1Name: string; t1p2Name: string; t2p1Name: string; t2p2Name: string; t1Name: string; t2Name: string; scoringType: ScoringType; betType: BetType | '' }

const navy = '#0f172a'
const gold = '#f59e0b'

function ScoreCell({ strokes, par }: { strokes: number; par: number }) {
  const diff = strokes - par
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, color: '#111827', minWidth: '1.5em', height: '1.5em',
    lineHeight: 1, fontSize: 'inherit',
  }
  // Par – no decoration
  if (diff === 0) return <span style={{ fontWeight: 700, color: '#111827' }}>{strokes}</span>
  // Under par → circles
  if (diff === -1) // birdie – 1 circle
    return <span style={{ ...base, border: '1.5px solid #111827', borderRadius: '50%' }}>{strokes}</span>
  if (diff === -2) // eagle – 2 circles
    return <span style={{ ...base, border: '1.5px solid #111827', borderRadius: '50%', outline: '1.5px solid #111827', outlineOffset: '2px' }}>{strokes}</span>
  if (diff <= -3) // albatross+ – 3 circles
    return (
      <span style={{ display: 'inline-flex', border: '1.5px solid #111827', borderRadius: '50%', padding: '2px' }}>
        <span style={{ ...base, border: '1.5px solid #111827', borderRadius: '50%', outline: '1.5px solid #111827', outlineOffset: '1.5px' }}>{strokes}</span>
      </span>
    )
  // Over par → squares
  if (diff === 1) // bogey – 1 square
    return <span style={{ ...base, border: '1.5px solid #111827' }}>{strokes}</span>
  if (diff === 2) // double bogey – 2 squares
    return <span style={{ ...base, border: '1.5px solid #111827', outline: '1.5px solid #111827', outlineOffset: '2px' }}>{strokes}</span>
  // triple bogey+ – 3 squares
  return (
    <span style={{ display: 'inline-flex', border: '1.5px solid #111827', padding: '2px' }}>
      <span style={{ ...base, border: '1.5px solid #111827', outline: '1.5px solid #111827', outlineOffset: '1.5px' }}>{strokes}</span>
    </span>
  )
}

function fmtVsPar(n: number | null): string {
  if (n === null) return '–'
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : String(n)
}

// Two-slot inline-flex: a fixed 1ch sign slot + the value.
// Every value has the same total width, so they all center under the column
// header identically. tabular-nums keeps multi-digit values aligned too.
function VsParDisplay({ n }: { n: number | null }) {
  if (n === null) return <span>–</span>
  const sign  = n > 0 ? '+' : n < 0 ? '-' : ''
  const value = n === 0 ? 'E' : String(Math.abs(n))
  return (
    <span style={{ display: 'inline-flex', fontVariantNumeric: 'tabular-nums' }}>
      {/* sign slot — always 1ch wide so +3 / -2 / E share the same indent */}
      <span style={{ display: 'inline-block', width: '1ch', textAlign: 'right', flexShrink: 0 }}>
        {sign}
      </span>
      <span>{value}</span>
    </span>
  )
}

function vpColor(n: number | null): string {
  if (n === null) return '#9ca3af'
  if (n < 0) return '#dc2626'
  return '#374151'
}

function fmtMatchDiff(diff: number): string {
  if (diff === 0) return 'AS'
  return `${Math.abs(diff)}UP`
}
function matchDiffColor(diff: number): string {
  if (diff === 0) return '#6b7280'
  return diff > 0 ? '#16a34a' : '#dc2626'
}

type BetType = 'nassau' | 'straight'
type ScoringType = 'stroke' | 'match'

function parseBet(bet: string): { betType: BetType | ''; amount: string; scoringType: ScoringType } {
  if (!bet) return { betType: '', amount: '', scoringType: 'stroke' }
  const parts = bet.split(':')
  // Structured: betType:amount:scoringType
  if (parts.length >= 2 && (parts[0] === 'nassau' || parts[0] === 'straight')) {
    return {
      betType: parts[0] as BetType,
      amount: parts[1] ?? '',
      scoringType: parts[2] === 'match' ? 'match' : 'stroke',
    }
  }
  // Scoring-only: score:scoringType (no bet type chosen)
  if (parts[0] === 'score' && parts.length >= 2) {
    return { betType: '', amount: '', scoringType: parts[1] === 'match' ? 'match' : 'stroke' }
  }
  // Legacy free text
  return { betType: '', amount: bet, scoringType: 'stroke' }
}

function composeBet(betType: BetType | '', amount: string, scoringType: ScoringType): string {
  if (!betType) return `score:${scoringType}`
  return `${betType}:${amount.trim()}:${scoringType}`
}

function formatBet(bet: string): string {
  if (!bet) return ''
  if (!bet.startsWith('nassau:') && !bet.startsWith('straight:') && !bet.startsWith('score:')) return bet // legacy free text
  const { betType, amount, scoringType } = parseBet(bet)
  const scoringLabel = scoringType === 'match' ? 'Match Play' : 'Stroke Play'
  if (betType === 'nassau' && amount) return `$${amount} Nassau · ${scoringLabel}`
  if (betType === 'nassau') return `Nassau · ${scoringLabel}`
  if (betType === 'straight' && amount) return `$${amount} Overall · ${scoringLabel}`
  if (betType === 'straight') return `Overall · ${scoringLabel}`
  return scoringLabel
}

function computeStats(
  p1Id: string, p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[]
) {
  let p1Wins = 0, p2Wins = 0, ties = 0
  let p1FW = 0, p2FW = 0, p1BW = 0, p2BW = 0
  let p1F = 0, p2F = 0, fPar = 0, fPlayed = 0
  let p1B = 0, p2B = 0, bPar = 0, bPlayed = 0
  let p1T = 0, p2T = 0, tPar = 0, tPlayed = 0
  const rows: { hole: Hole; s1: number | null; s2: number | null; result: 'win' | 'loss' | 'tie' | null }[] = []

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

type BBRow = {
  hole: Hole
  t1p1: number | null; t1p2: number | null; t1Best: number | null
  t2p1: number | null; t2p2: number | null; t2Best: number | null
  result: 'team1' | 'team2' | 'tie' | null
}

function computeBestBall(
  t1p1Id: string, t1p2Id: string,
  t2p1Id: string, t2p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[]
) {
  let t1Wins = 0, t2Wins = 0, ties = 0
  let t1FW = 0, t2FW = 0, t1BW = 0, t2BW = 0
  let t1F = 0, t2F = 0, fPar = 0, fPlayed = 0
  let t1B = 0, t2B = 0, bPar = 0, bPlayed = 0
  let t1T = 0, t2T = 0, tPar = 0, tPlayed = 0
  const rows: BBRow[] = []

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

// ── Payout types ─────────────────────────────────────────────────────────────
type PayoutSegment = {
  name: 'Front' | 'Back' | 'Total'
  settled: boolean
  winnerLabel: string | null   // player/team name, null = pending or tied
  tied: boolean
  amount: number               // bet amount per this segment (per-player for BB)
  perPlayer: boolean           // true for BB (label shows "$X/player")
}
type PayoutRow = {
  id: string
  label: string
  betLabel: string
  segments: PayoutSegment[]
  nassauResult?: {
    winnerLabel: string | null   // net winner name, or null if tied/no data
    amount: number               // absolute net amount
    perPlayer: boolean
    anySettled: boolean
  }
}

function computeMatchupPayouts(
  matchups: SavedMatchup[],
  bestBallMatchups: BestBallMatchup[],
  players: Player[],
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[]
): {
  rows: PayoutRow[]
  net: Record<string, number>
  involvedIds: Set<string>
  settlements: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[]
} {
  const net: Record<string, number> = {}
  for (const p of players) net[p.id] = 0
  const rows: PayoutRow[] = []
  const involvedIds = new Set<string>()

  // ── Head to Head ─────────────────────────────────────────────────
  for (const m of matchups) {
    const mp1 = players.find((p) => p.id === m.player1_id)
    const mp2 = players.find((p) => p.id === m.player2_id)
    if (!mp1 || !mp2) continue
    involvedIds.add(m.player1_id); involvedIds.add(m.player2_id)

    const { betType, amount, scoringType } = parseBet(m.bet)
    const betAmt = parseFloat(amount)
    const hasBet = betType !== '' && !isNaN(betAmt) && betAmt > 0

    if (!hasBet) {
      // Old matchup with no bet configured — show it but skip payout math
      rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }

    const stats = computeStats(m.player1_id, m.player2_id, scoreMap, holes)
    const hole9 = scoreMap[m.player1_id]?.[9] != null && scoreMap[m.player2_id]?.[9] != null
    const hole18 = scoreMap[m.player1_id]?.[18] != null && scoreMap[m.player2_id]?.[18] != null
    const p1 = m.player1_id, p2 = m.player2_id

    const resolveH2H = (
      settled: boolean,
      sl: 'p1' | 'p2' | 'tie' | null,
      mpDiff: number
    ): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const p1Wins = scoringType === 'match' ? mpDiff > 0 : sl === 'p1'
      const p2Wins = scoringType === 'match' ? mpDiff < 0 : sl === 'p2'
      if (p1Wins) { net[p1] += betAmt; net[p2] -= betAmt; return { winnerLabel: mp1.name, tied: false } }
      if (p2Wins) { net[p2] += betAmt; net[p1] -= betAmt; return { winnerLabel: mp2.name, tied: false } }
      return { winnerLabel: null, tied: true }
    }

    const strokeLeader = (a: number | null, b: number | null): 'p1' | 'p2' | 'tie' | null =>
      a === null || b === null ? null : a < b ? 'p1' : b < a ? 'p2' : 'tie'

    const segments: PayoutSegment[] = []
    if (betType === 'nassau') {
      const fSett = hole9 && stats.p1Front !== null && stats.p2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveH2H(fSett, strokeLeader(stats.p1Front, stats.p2Front), stats.p1FrontWins - stats.p2FrontWins)
      segments.push({ name: 'Front', settled: fSett, winnerLabel: fWL, tied: fT, amount: betAmt, perPlayer: false })

      const bSett = hole18 && stats.p1Back !== null && stats.p2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveH2H(bSett, strokeLeader(stats.p1Back, stats.p2Back), stats.p1BackWins - stats.p2BackWins)
      segments.push({ name: 'Back', settled: bSett, winnerLabel: bWL, tied: bT, amount: betAmt, perPlayer: false })
    }
    const tSett = hole18 && stats.p1Total !== null && stats.p2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveH2H(tSett, strokeLeader(stats.p1Total, stats.p2Total), stats.p1Wins - stats.p2Wins)
    segments.push({ name: 'Total', settled: tSett, winnerLabel: tWL, tied: tT, amount: betAmt, perPlayer: false })

    let nassauResult: PayoutRow['nassauResult']
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
    }
    rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: formatBet(m.bet), segments, nassauResult })
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

    const { betType, amount, scoringType } = parseBet(m.bet)
    const betAmt = parseFloat(amount)
    const hasBet = betType !== '' && !isNaN(betAmt) && betAmt > 0
    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`
    const t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`

    if (!hasBet) {
      rows.push({ id: m.id, label: `${t1Name} vs ${t2Name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }

    const stats = computeBestBall(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
    const t1Ids = [m.team1_player1_id, m.team1_player2_id]
    const t2Ids = [m.team2_player1_id, m.team2_player2_id]
    const hole9 = t1Ids.some((id) => scoreMap[id]?.[9] != null) && t2Ids.some((id) => scoreMap[id]?.[9] != null)
    const hole18 = t1Ids.some((id) => scoreMap[id]?.[18] != null) && t2Ids.some((id) => scoreMap[id]?.[18] != null)

    const strokeLeaderBB = (a: number | null, b: number | null): 't1' | 't2' | 'tie' | null =>
      a === null || b === null ? null : a < b ? 't1' : b < a ? 't2' : 'tie'

    const resolveBB = (
      settled: boolean,
      sl: 't1' | 't2' | 'tie' | null,
      mpDiff: number
    ): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const t1Wins = scoringType === 'match' ? mpDiff > 0 : sl === 't1'
      const t2Wins = scoringType === 'match' ? mpDiff < 0 : sl === 't2'
      if (t1Wins) {
        for (const id of t1Ids) net[id] = (net[id] ?? 0) + betAmt
        for (const id of t2Ids) net[id] = (net[id] ?? 0) - betAmt
        return { winnerLabel: t1Name, tied: false }
      }
      if (t2Wins) {
        for (const id of t2Ids) net[id] = (net[id] ?? 0) + betAmt
        for (const id of t1Ids) net[id] = (net[id] ?? 0) - betAmt
        return { winnerLabel: t2Name, tied: false }
      }
      return { winnerLabel: null, tied: true }
    }

    const segments: PayoutSegment[] = []
    if (betType === 'nassau') {
      const fSett = hole9 && stats.t1Front !== null && stats.t2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveBB(fSett, strokeLeaderBB(stats.t1Front, stats.t2Front), stats.t1FrontWins - stats.t2FrontWins)
      segments.push({ name: 'Front', settled: fSett, winnerLabel: fWL, tied: fT, amount: betAmt, perPlayer: true })

      const bSett = hole18 && stats.t1Back !== null && stats.t2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveBB(bSett, strokeLeaderBB(stats.t1Back, stats.t2Back), stats.t1BackWins - stats.t2BackWins)
      segments.push({ name: 'Back', settled: bSett, winnerLabel: bWL, tied: bT, amount: betAmt, perPlayer: true })
    }
    const tSett = hole18 && stats.t1Total !== null && stats.t2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveBB(tSett, strokeLeaderBB(stats.t1Total, stats.t2Total), stats.t1Wins - stats.t2Wins)
    segments.push({ name: 'Total', settled: tSett, winnerLabel: tWL, tied: tT, amount: betAmt, perPlayer: true })

    let nassauResult: PayoutRow['nassauResult']
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
    }
    rows.push({ id: m.id, label: `${t1Name} vs ${t2Name}`, betLabel: formatBet(m.bet), segments, nassauResult })
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
    if (amount > 0) settlements.push({ fromId: nw[li].id, fromName: nw[li].name, toId: pw[wi].id, toName: pw[wi].name, amount })
    pw[wi].bal = Math.round((pw[wi].bal - amount) * 100) / 100
    nw[li].bal = Math.round((nw[li].bal + amount) * 100) / 100
    if (pw[wi].bal <= 0.005) wi++
    if (nw[li].bal >= -0.005) li++
  }

  return { rows, net, involvedIds, settlements }
}

export default function MatchupClient({
  roundId, players, holes, scores: initialScores, roundName, initialMatchups, initialBestBallMatchups,
}: {
  roundId: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  roundName: string
  initialMatchups: SavedMatchup[]
  initialBestBallMatchups: BestBallMatchup[]
}) {
  const [scores, setScores] = useState(initialScores)
  const [matchups, setMatchups] = useState(initialMatchups)
  const [bestBallMatchups, setBestBallMatchups] = useState(initialBestBallMatchups)

  const [newP1, setNewP1] = useState('')
  const [newP2, setNewP2] = useState('')
  const [newBetType, setNewBetType] = useState<BetType | ''>('')
  const [newBetAmount, setNewBetAmount] = useState('')
  const [newScoringType, setNewScoringType] = useState<ScoringType>('stroke')
  const [savingH2H, setSavingH2H] = useState(false)

  const [editingH2H, setEditingH2H] = useState<string | null>(null)
  const [editH2HBetType, setEditH2HBetType] = useState<BetType | ''>('')
  const [editH2HBetAmount, setEditH2HBetAmount] = useState('')
  const [editH2HScoringType, setEditH2HScoringType] = useState<ScoringType>('stroke')

  const [bbT1P1, setBbT1P1] = useState('')
  const [bbT1P2, setBbT1P2] = useState('')
  const [bbT2P1, setBbT2P1] = useState('')
  const [bbT2P2, setBbT2P2] = useState('')
  const [bbBetType, setBbBetType] = useState<BetType | ''>('')
  const [bbBetAmount, setBbBetAmount] = useState('')
  const [bbScoringType, setBbScoringType] = useState<ScoringType>('stroke')
  const [savingBB, setSavingBB] = useState(false)

  const [editingBB, setEditingBB] = useState<string | null>(null)
  const [editBBBetType, setEditBBBetType] = useState<BetType | ''>('')
  const [editBBBetAmount, setEditBBBetAmount] = useState('')
  const [editBBScoringType, setEditBBScoringType] = useState<ScoringType>('stroke')

  const [showScorecardFor, setShowScorecardFor] = useState<ScorecardTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showH2HForm, setShowH2HForm] = useState(false)
  const [showBBForm, setShowBBForm] = useState(false)
  const [showPayouts, setShowPayouts] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string; type: 'h2h' | 'bb' } | null>(null)
  const [showDuplicateAlert, setShowDuplicateAlert] = useState(false)

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    if (!playerIds.length) return
    async function refetchScores() {
      const { data } = await supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds)
      if (data) setScores(data)
    }
    const ch1 = supabase.channel('matchup-scores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, refetchScores)
      .subscribe()
    const ch4 = supabase.channel('score-updates')
      .on('broadcast', { event: 'refresh' }, refetchScores)
      .subscribe()
    const ch2 = supabase.channel('matchup-matchups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchups' }, async () => {
        const { data } = await supabase.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', roundId).order('created_at')
        if (data) setMatchups(data)
      }).subscribe()
    const ch3 = supabase.channel('matchup-bestball')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'best_ball_matchups' }, async () => {
        const { data } = await supabase.from('best_ball_matchups')
          .select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet')
          .eq('round_id', roundId).order('created_at')
        if (data) setBestBallMatchups(data)
      }).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3); supabase.removeChannel(ch4) }
  }, [players, roundId])

  const scoreMap = useMemo(() => {
    const m: Record<string, Record<number, number>> = {}
    for (const s of scores) {
      if (!m[s.player_id]) m[s.player_id] = {}
      m[s.player_id][s.hole_number] = s.strokes
    }
    return m
  }, [scores])

  async function handleCreateH2H() {
    if (!newP1 || !newP2 || newP1 === newP2 || !newBetType || !newBetAmount.trim()) return
    const isDuplicateH2H = matchups.some((m) =>
      (m.player1_id === newP1 && m.player2_id === newP2) ||
      (m.player1_id === newP2 && m.player2_id === newP1)
    )
    if (isDuplicateH2H) { setShowDuplicateAlert(true); return }
    setSavingH2H(true)
    const bet = composeBet(newBetType, newBetAmount, newScoringType)
    const result = await saveMatchup(roundId, newP1, newP2, bet)
    if (!result.error && result.id) {
      setMatchups((prev) => [...prev, { id: result.id!, player1_id: newP1, player2_id: newP2, bet }])
      setNewP1(''); setNewP2(''); setNewBetAmount('')
      setShowH2HForm(false)
    }
    setSavingH2H(false)
  }

  async function handleDeleteH2H(id: string) {
    setMatchups((prev) => prev.filter((m) => m.id !== id))
    await deleteMatchup(id)
  }


  async function handleSaveH2HBet(id: string) {
    const bet = composeBet(editH2HBetType, editH2HBetAmount, editH2HScoringType)
    setMatchups((prev) => prev.map((m) => m.id === id ? { ...m, bet } : m))
    setEditingH2H(null)
    await updateMatchupBet(id, bet)
  }

  async function handleCreateBB() {
    const ids = [bbT1P1, bbT1P2, bbT2P1, bbT2P2]
    if (ids.some((id) => !id) || new Set(ids).size !== 4 || !bbBetType || !bbBetAmount.trim()) return
    const newSet = new Set(ids)
    const isDuplicateBB = bestBallMatchups.some((m) => {
      const ex = new Set([m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id])
      return ex.size === newSet.size && [...newSet].every((id) => ex.has(id))
    })
    if (isDuplicateBB) { setShowDuplicateAlert(true); return }
    setSavingBB(true)
    const bet = composeBet(bbBetType, bbBetAmount, bbScoringType)
    const result = await saveBestBallMatchup(roundId, bbT1P1, bbT1P2, bbT2P1, bbT2P2, bet)
    if (!result.error && result.id) {
      setBestBallMatchups((prev) => [...prev, {
        id: result.id!, team1_player1_id: bbT1P1, team1_player2_id: bbT1P2,
        team2_player1_id: bbT2P1, team2_player2_id: bbT2P2, bet,
      }])
      setBbT1P1(''); setBbT1P2(''); setBbT2P1(''); setBbT2P2(''); setBbBetAmount('')
      setShowBBForm(false)
    }
    setSavingBB(false)
  }

  async function handleDeleteBB(id: string) {
    setBestBallMatchups((prev) => prev.filter((m) => m.id !== id))
    await deleteBestBallMatchup(id)
  }

  async function handleSaveBBBet(id: string) {
    const bet = composeBet(editBBBetType, editBBBetAmount, editBBScoringType)
    setBestBallMatchups((prev) => prev.map((m) => m.id === id ? { ...m, bet } : m))
    setEditingBB(null)
    await updateBestBallBet(id, bet)
  }

  const searchLower = searchQuery.toLowerCase().trim()
  const bbSelected = [bbT1P1, bbT1P2, bbT2P1, bbT2P2].filter(Boolean)
  const isComplete = holes.length > 0 && players.every((p) => Object.keys(scoreMap[p.id] ?? {}).length >= holes.length)

  const payouts = useMemo(
    () => computeMatchupPayouts(matchups, bestBallMatchups, players, scoreMap, holes),
    [matchups, bestBallMatchups, players, scoreMap, holes]
  )

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>

      {/* ── Delete Confirmation Modal ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-base mb-1">Delete Matchup</h3>
            <p className="text-sm text-gray-500 mb-5">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-gray-800">&ldquo;{confirmDelete.label}&rdquo;</span>?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmDelete.type === 'h2h') handleDeleteH2H(confirmDelete.id)
                  else handleDeleteBB(confirmDelete.id)
                  setConfirmDelete(null)
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: '#ef4444' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate Matchup Alert ── */}
      {showDuplicateAlert && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowDuplicateAlert(false)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-base mb-1">Matchup Already Exists</h3>
            <p className="text-sm text-gray-500 mb-5">
              A matchup with these players already exists. Remove the existing one first if you'd like to change it.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowDuplicateAlert(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scorecard Modal ── */}
      {showScorecardFor && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowScorecardFor(null)}>
          <div className="bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h3 className="font-bold text-gray-900 text-base">
                {showScorecardFor.type === 'player' ? showScorecardFor.name
                  : showScorecardFor.type === 'h2h' ? `${showScorecardFor.p1Name} vs ${showScorecardFor.p2Name}`
                  : showScorecardFor.type === 'bb-scorecards' ? `${showScorecardFor.t1Name} vs ${showScorecardFor.t2Name}`
                  : showScorecardFor.teamName}
              </h3>
              <button onClick={() => setShowScorecardFor(null)}
                className="text-gray-400 text-2xl font-bold leading-none">×</button>
            </div>
            <div className="px-4 py-4 overflow-x-auto">
              {showScorecardFor.type === 'player' ? (
                <HorizontalScorecardTable
                  rows={[{ label: 'Score', scoreMap: scoreMap[showScorecardFor.id] ?? {} }]}
                  holes={holes}
                />
              ) : showScorecardFor.type === 'h2h' ? (() => {
                const target = showScorecardFor
                return (
                  <HorizontalScorecardTable
                    rows={[
                      { label: target.p1Name, scoreMap: scoreMap[target.p1Id] ?? {} },
                      { label: target.p2Name, scoreMap: scoreMap[target.p2Id] ?? {} },
                    ]}
                    holes={holes}
                    showMatchPlay={target.scoringType === 'match'}
                    betType={target.betType}
                  />
                )
              })() : showScorecardFor.type === 'bb-scorecards' ? (() => {
                const target = showScorecardFor
                // Build per-hole best-ball score map for each team
                const t1Map: Record<number, number> = {}
                const t2Map: Record<number, number> = {}
                for (const hole of holes) {
                  const t1s1 = scoreMap[target.t1p1Id]?.[hole.hole_number]
                  const t1s2 = scoreMap[target.t1p2Id]?.[hole.hole_number]
                  const t1Arr = ([t1s1, t1s2] as (number | undefined)[]).filter((s): s is number => s !== undefined)
                  if (t1Arr.length > 0) t1Map[hole.hole_number] = Math.min(...t1Arr)

                  const t2s1 = scoreMap[target.t2p1Id]?.[hole.hole_number]
                  const t2s2 = scoreMap[target.t2p2Id]?.[hole.hole_number]
                  const t2Arr = ([t2s1, t2s2] as (number | undefined)[]).filter((s): s is number => s !== undefined)
                  if (t2Arr.length > 0) t2Map[hole.hole_number] = Math.min(...t2Arr)
                }
                return (
                  <HorizontalScorecardTable
                    rows={[
                      { label: target.t1Name, scoreMap: t1Map },
                      { label: target.t2Name, scoreMap: t2Map },
                    ]}
                    holes={holes}
                    showMatchPlay={target.scoringType === 'match'}
                    betType={target.betType}
                  />
                )
              })() : (() => {
                const target = showScorecardFor
                const p1Map = scoreMap[target.p1Id] ?? {}
                const p2Map = scoreMap[target.p2Id] ?? {}
                const bestMap: Record<number, number> = {}
                for (const hole of holes) {
                  const s1: number | undefined = p1Map[hole.hole_number]
                  const s2: number | undefined = p2Map[hole.hole_number]
                  const arr = [s1, s2].filter((s): s is number => s !== undefined)
                  if (arr.length > 0) bestMap[hole.hole_number] = Math.min(...arr)
                }
                return (
                  <HorizontalScorecardTable
                    rows={[{ label: 'Score', scoreMap: bestMap }]}
                    holes={holes}
                  />
                )
              })()}
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: gold }}>Matchups</p>
            <h1 className="font-bold text-lg">{roundName}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span className={`w-2 h-2 rounded-full inline-block ${isComplete ? 'bg-red-500' : 'bg-green-400 animate-pulse'}`} />
              {isComplete ? 'Complete' : 'Live'}
            </div>
            <a href="/leaderboard" className="text-sm font-semibold px-3 py-1.5 rounded-lg" style={{ background: gold, color: navy }}>Leaderboard</a>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">

        {/* ── Search ── */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search by player name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
          )}
        </div>

        {/* ── Head to Head ── */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Head to Head</p>
            {showH2HForm
              ? <button onClick={() => setShowH2HForm(false)} className="text-xs font-semibold text-gray-400 hover:text-gray-600 px-2 py-1">✕ Cancel</button>
              : <button onClick={() => setShowH2HForm(true)} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: navy, color: 'white' }}>+ Add</button>
            }
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {showH2HForm && <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Player 1</label>
                    <select value={newP1} onChange={(e) => { setNewP1(e.target.value); if (e.target.value === newP2) setNewP2('') }}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="">Select…</option>
                      {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === newP2}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Player 2</label>
                    <select value={newP2} onChange={(e) => setNewP2(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="">Select…</option>
                      {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === newP1}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Scoring</label>
                    <select value={newScoringType} onChange={(e) => setNewScoringType(e.target.value as ScoringType)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="stroke">Stroke Play</option>
                      <option value="match">Match Play</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Bet <span className="text-red-400">*</span></label>
                    <select value={newBetType} onChange={(e) => setNewBetType(e.target.value as BetType | '')}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="" disabled>Select…</option>
                      <option value="nassau">Nassau</option>
                      <option value="straight">Overall</option>
                    </select>
                  </div>
                  <div className="w-20 flex-shrink-0">
                    <label className="block text-xs text-gray-500 mb-1">Amount ($) <span className="text-red-400">*</span></label>
                    <input type="number" min="0" step="1" placeholder="10"
                      value={newBetAmount} onChange={(e) => setNewBetAmount(e.target.value)}
                      disabled={!newBetType}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none disabled:opacity-40" />
                  </div>
                  <button onClick={handleCreateH2H} disabled={!newP1 || !newP2 || newP1 === newP2 || !newBetType || !newBetAmount.trim() || savingH2H}
                    className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex-shrink-0"
                    style={{ background: navy, color: 'white' }}>
                    {savingH2H ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>}

            {(() => {
              const filtered = searchLower
                ? matchups.filter((m) => {
                    const mp1 = players.find((p) => p.id === m.player1_id)
                    const mp2 = players.find((p) => p.id === m.player2_id)
                    return mp1?.name.toLowerCase().includes(searchLower) || mp2?.name.toLowerCase().includes(searchLower)
                  })
                : matchups
              if (filtered.length === 0) return (
                <p className="text-center text-sm text-gray-400 py-6">
                  {searchLower ? 'No matchups found for that player' : 'No head to head matchups saved yet'}
                </p>
              )
              return (
                <div className="divide-y divide-gray-100">
                  {filtered.map((m) => {
                    const mp1 = players.find((p) => p.id === m.player1_id)
                    const mp2 = players.find((p) => p.id === m.player2_id)
                    if (!mp1 || !mp2) return null
                    const stats = computeStats(m.player1_id, m.player2_id, scoreMap, holes)
                    const isFinal = stats.holesPlayed === holes.length && holes.length > 0
                    const leader = stats.p1Wins > stats.p2Wins ? mp1 : stats.p2Wins > stats.p1Wins ? mp2 : null
                    const isEditing = editingH2H === m.id
                    const p1First = mp1.name.split(' ')[0]
                    const p2First = mp2.name.split(' ')[0]
                    const h2hHole9 = (scoreMap[m.player1_id]?.[9] != null) && (scoreMap[m.player2_id]?.[9] != null)
                    const h2hHole18 = (scoreMap[m.player1_id]?.[18] != null) && (scoreMap[m.player2_id]?.[18] != null)
                    const p1WinsFront = stats.p1Front !== null && stats.p2Front !== null && stats.p1Front < stats.p2Front
                    const p2WinsFront = stats.p1Front !== null && stats.p2Front !== null && stats.p2Front < stats.p1Front
                    const p1WinsBack = stats.p1Back !== null && stats.p2Back !== null && stats.p1Back < stats.p2Back
                    const p2WinsBack = stats.p1Back !== null && stats.p2Back !== null && stats.p2Back < stats.p1Back
                    const p1WinsTotal = stats.p1Total !== null && stats.p2Total !== null && stats.p1Total < stats.p2Total
                    const p2WinsTotal = stats.p1Total !== null && stats.p2Total !== null && stats.p2Total < stats.p1Total
                    const { scoringType: h2hScoringType, betType: h2hBetType } = parseBet(m.bet)
                    const isMatchPlay = h2hScoringType === 'match'
                    const isOverallBet = h2hBetType === 'straight'

                    return (
                      <div key={m.id}>
                        <div className="px-4 py-3">
                          {/* Bet + status + controls row */}
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 flex-wrap">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <select value={editH2HScoringType} onChange={(e) => setEditH2HScoringType(e.target.value as ScoringType)}
                                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none">
                                  <option value="stroke">Stroke Play</option>
                                  <option value="match">Match Play</option>
                                </select>
                                <select value={editH2HBetType} onChange={(e) => setEditH2HBetType(e.target.value as BetType | '')}
                                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none">
                                  <option value="">No bet</option>
                                  <option value="nassau">Nassau</option>
                                  <option value="straight">Overall</option>
                                </select>
                                {editH2HBetType && (
                                  <input autoFocus type="number" min="0" step="1" placeholder="amt"
                                    value={editH2HBetAmount} onChange={(e) => setEditH2HBetAmount(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveH2HBet(m.id); if (e.key === 'Escape') setEditingH2H(null) }}
                                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none w-14" />
                                )}
                                <button onClick={() => handleSaveH2HBet(m.id)} className="text-xs font-semibold text-green-600">Save</button>
                                <button onClick={() => setEditingH2H(null)} className="text-xs text-gray-400">Cancel</button>
                              </div>
                            ) : (
                              <span className="flex items-center gap-1">
                                {m.bet
                                  ? <span className="font-medium" style={{ color: gold }}>Bet: {formatBet(m.bet)}</span>
                                  : <span className="text-gray-300">No bet</span>}
                                <button onClick={() => { setEditingH2H(m.id); const p = parseBet(m.bet); setEditH2HBetType(p.betType); setEditH2HBetAmount(p.amount); setEditH2HScoringType(p.scoringType) }}
                                  className="text-gray-300 hover:text-gray-500 ml-0.5">✎</button>
                              </span>
                            )}
                            <button
                              onClick={() => setShowScorecardFor({ type: 'h2h', p1Id: m.player1_id, p2Id: m.player2_id, p1Name: p1First, p2Name: p2First, scoringType: parseBet(m.bet).scoringType, betType: parseBet(m.bet).betType })}
                              className="text-xs font-medium px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400 transition">
                              Scorecards
                            </button>
                            <span className="flex-1" />
                            <button onClick={() => setConfirmDelete({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, type: 'h2h' })} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                          </div>

                          {/* 5-column summary table */}
                          <div className="rounded-lg border border-gray-100 overflow-hidden">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr style={{ background: '#f9fafb' }}>
                                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500">Player</th>
                                  {!isOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Front</th>}
                                  {!isOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Back</th>}
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Total</th>
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Thru</th>
                                </tr>
                              </thead>
                              <tbody>
                                {([
                                  { player: mp1, front: stats.p1Front, back: stats.p1Back, total: stats.p1Total, wFront: p1WinsFront, wBack: p1WinsBack, wTotal: p1WinsTotal, mFront: stats.p1FrontWins - stats.p2FrontWins, mBack: stats.p1BackWins - stats.p2BackWins, mTotal: stats.p1Wins - stats.p2Wins },
                                  { player: mp2, front: stats.p2Front, back: stats.p2Back, total: stats.p2Total, wFront: p2WinsFront, wBack: p2WinsBack, wTotal: p2WinsTotal, mFront: stats.p2FrontWins - stats.p1FrontWins, mBack: stats.p2BackWins - stats.p1BackWins, mTotal: stats.p2Wins - stats.p1Wins },
                                ] as const).map(({ player, front, back, total, wFront, wBack, wTotal, mFront, mBack, mTotal }, rowIdx) => {
                                  const thru = Object.keys(scoreMap[player.id] ?? {}).length
                                  const isFirstRow = rowIdx === 0
                                  const mpCol = (diff: number, hasData: boolean) => {
                                    if (!hasData) return <span style={{ color: '#d1d5db' }}>–</span>
                                    if (diff > 0) return <span style={{ color: '#16a34a' }}>{diff}UP</span>
                                    if (diff < 0) return null
                                    return null
                                  }
                                  const asLabelStyle: React.CSSProperties = { position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 700, color: '#6b7280', background: 'white', padding: '0 3px', lineHeight: 1, whiteSpace: 'nowrap', zIndex: 1 }
                                  return (
                                    <tr key={player.id} className="border-t border-gray-100">
                                      <td className="px-3 py-2">
                                        <span className="text-xs font-semibold text-gray-800">{player.name}</span>
                                      </td>
                                      {!isOverallBet && <td className="px-3 py-2 text-center text-xs font-semibold" style={{ position: 'relative', color: isMatchPlay ? undefined : vpColor(front) }}>
                                        {isMatchPlay && !isFirstRow && mFront === 0 && front !== null && <span style={asLabelStyle}>AS</span>}
                                        <span style={{ position: 'relative', display: 'inline-block' }}>
                                          {isMatchPlay ? mpCol(mFront, front !== null) : <VsParDisplay n={front} />}
                                          {isMatchPlay
                                            ? (h2hHole9 && mFront > 0 && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)
                                            : (h2hHole9 && wFront && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)}
                                        </span>
                                      </td>}
                                      {!isOverallBet && <td className="px-3 py-2 text-center text-xs font-semibold" style={{ position: 'relative', color: isMatchPlay ? undefined : vpColor(back) }}>
                                        {isMatchPlay && !isFirstRow && mBack === 0 && back !== null && <span style={asLabelStyle}>AS</span>}
                                        <span style={{ position: 'relative', display: 'inline-block' }}>
                                          {isMatchPlay ? mpCol(mBack, back !== null) : <VsParDisplay n={back} />}
                                          {isMatchPlay
                                            ? (h2hHole18 && mBack > 0 && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)
                                            : (h2hHole18 && wBack && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)}
                                        </span>
                                      </td>}
                                      <td className="px-3 py-2 text-center text-xs font-semibold" style={{ position: 'relative', color: isMatchPlay ? undefined : vpColor(total) }}>
                                        {isMatchPlay && !isFirstRow && mTotal === 0 && total !== null && <span style={asLabelStyle}>AS</span>}
                                        <span style={{ position: 'relative', display: 'inline-block' }}>
                                          {isMatchPlay ? mpCol(mTotal, total !== null) : <VsParDisplay n={total} />}
                                          {isMatchPlay
                                            ? (h2hHole18 && mTotal > 0 && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)
                                            : (h2hHole18 && wTotal && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-center text-xs text-gray-500">{thru === 0 ? '–' : thru === 18 ? 'F' : thru}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>

        {/* ── 2 v 2 Best Ball ── */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">2 v 2 Best Ball</p>
            {showBBForm
              ? <button onClick={() => setShowBBForm(false)} className="text-xs font-semibold text-gray-400 hover:text-gray-600 px-2 py-1">✕ Cancel</button>
              : <button onClick={() => setShowBBForm(true)} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: navy, color: 'white' }}>+ Add</button>
            }
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {showBBForm && <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <p className="text-xs font-semibold text-blue-600 mb-1">Team 1</p>
                  <div className="space-y-1.5">
                    <select value={bbT1P1} onChange={(e) => setBbT1P1(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="">Player 1…</option>
                      {players.map((p) => <option key={p.id} value={p.id}
                        disabled={p.id !== bbT1P1 && bbSelected.includes(p.id)}>{p.name}</option>)}
                    </select>
                    <select value={bbT1P2} onChange={(e) => setBbT1P2(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="">Player 2…</option>
                      {players.map((p) => <option key={p.id} value={p.id}
                        disabled={p.id !== bbT1P2 && bbSelected.includes(p.id)}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-amber-600 mb-1">Team 2</p>
                  <div className="space-y-1.5">
                    <select value={bbT2P1} onChange={(e) => setBbT2P1(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="">Player 1…</option>
                      {players.map((p) => <option key={p.id} value={p.id}
                        disabled={p.id !== bbT2P1 && bbSelected.includes(p.id)}>{p.name}</option>)}
                    </select>
                    <select value={bbT2P2} onChange={(e) => setBbT2P2(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="">Player 2…</option>
                      {players.map((p) => <option key={p.id} value={p.id}
                        disabled={p.id !== bbT2P2 && bbSelected.includes(p.id)}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Scoring</label>
                  <select value={bbScoringType} onChange={(e) => setBbScoringType(e.target.value as ScoringType)}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                    <option value="stroke">Stroke Play</option>
                    <option value="match">Match Play</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Bet <span className="text-red-400">*</span></label>
                  <select value={bbBetType} onChange={(e) => setBbBetType(e.target.value as BetType | '')}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                    <option value="" disabled>Select…</option>
                    <option value="nassau">Nassau</option>
                    <option value="straight">Overall</option>
                  </select>
                </div>
                <div className="w-20 flex-shrink-0">
                  <label className="block text-xs text-gray-500 mb-1">Amount ($) <span className="text-red-400">*</span></label>
                  <input type="number" min="0" step="1" placeholder="10"
                    value={bbBetAmount} onChange={(e) => setBbBetAmount(e.target.value)}
                    disabled={!bbBetType}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none disabled:opacity-40" />
                </div>
                <button onClick={handleCreateBB}
                  disabled={!bbT1P1 || !bbT1P2 || !bbT2P1 || !bbT2P2 || new Set([bbT1P1, bbT1P2, bbT2P1, bbT2P2]).size !== 4 || !bbBetType || !bbBetAmount.trim() || savingBB}
                  className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex-shrink-0"
                  style={{ background: navy, color: 'white' }}>
                  {savingBB ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>}

            {(() => {
              const filtered = searchLower
                ? bestBallMatchups.filter((m) => {
                    const names = [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id]
                      .map((id) => players.find((p) => p.id === id)?.name.toLowerCase() ?? '')
                    return names.some((n) => n.includes(searchLower))
                  })
                : bestBallMatchups
              if (filtered.length === 0) return (
                <p className="text-center text-sm text-gray-400 py-6">
                  {searchLower ? 'No matchups found for that player' : 'No best ball matchups saved yet'}
                </p>
              )
              return (
                <div className="divide-y divide-gray-100">
                  {filtered.map((m) => {
                    const t1p1 = players.find((p) => p.id === m.team1_player1_id)
                    const t1p2 = players.find((p) => p.id === m.team1_player2_id)
                    const t2p1 = players.find((p) => p.id === m.team2_player1_id)
                    const t2p2 = players.find((p) => p.id === m.team2_player2_id)
                    if (!t1p1 || !t1p2 || !t2p1 || !t2p2) return null
                    const stats = computeBestBall(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
                    const isFinal = stats.holesPlayed === holes.length && holes.length > 0
                    const leader = stats.t1Wins > stats.t2Wins ? 'team1' : stats.t2Wins > stats.t1Wins ? 'team2' : null
                    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`
                    const t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`
                    const isEditingBB = editingBB === m.id
                    const bbHole9 = (scoreMap[m.team1_player1_id]?.[9] != null || scoreMap[m.team1_player2_id]?.[9] != null) && (scoreMap[m.team2_player1_id]?.[9] != null || scoreMap[m.team2_player2_id]?.[9] != null)
                    const bbHole18 = (scoreMap[m.team1_player1_id]?.[18] != null || scoreMap[m.team1_player2_id]?.[18] != null) && (scoreMap[m.team2_player1_id]?.[18] != null || scoreMap[m.team2_player2_id]?.[18] != null)
                    const t1WinsFront = stats.t1Front !== null && stats.t2Front !== null && stats.t1Front < stats.t2Front
                    const t2WinsFront = stats.t1Front !== null && stats.t2Front !== null && stats.t2Front < stats.t1Front
                    const t1WinsBack = stats.t1Back !== null && stats.t2Back !== null && stats.t1Back < stats.t2Back
                    const t2WinsBack = stats.t1Back !== null && stats.t2Back !== null && stats.t2Back < stats.t1Back
                    const t1WinsTotal = stats.t1Total !== null && stats.t2Total !== null && stats.t1Total < stats.t2Total
                    const t2WinsTotal = stats.t1Total !== null && stats.t2Total !== null && stats.t2Total < stats.t1Total
                    const { scoringType: bbScoringTypeParsed, betType: bbBetTypeParsed } = parseBet(m.bet)
                    const isBBMatchPlay = bbScoringTypeParsed === 'match'
                    const isBBOverallBet = bbBetTypeParsed === 'straight'

                    return (
                      <div key={m.id}>
                        <div className="px-4 py-3">
                          {/* Bet + status + controls row */}
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 flex-wrap">
                            {isEditingBB ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <select value={editBBScoringType} onChange={(e) => setEditBBScoringType(e.target.value as ScoringType)}
                                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none">
                                  <option value="stroke">Stroke Play</option>
                                  <option value="match">Match Play</option>
                                </select>
                                <select value={editBBBetType} onChange={(e) => setEditBBBetType(e.target.value as BetType | '')}
                                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none">
                                  <option value="">No bet</option>
                                  <option value="nassau">Nassau</option>
                                  <option value="straight">Overall</option>
                                </select>
                                {editBBBetType && (
                                  <input autoFocus type="number" min="0" step="1" placeholder="amt"
                                    value={editBBBetAmount} onChange={(e) => setEditBBBetAmount(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveBBBet(m.id); if (e.key === 'Escape') setEditingBB(null) }}
                                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none w-14" />
                                )}
                                <button onClick={() => handleSaveBBBet(m.id)} className="text-xs font-semibold text-green-600">Save</button>
                                <button onClick={() => setEditingBB(null)} className="text-xs text-gray-400">Cancel</button>
                              </div>
                            ) : (
                              <span className="flex items-center gap-1">
                                {m.bet
                                  ? <span className="font-medium" style={{ color: gold }}>Bet: {formatBet(m.bet)}</span>
                                  : <span className="text-gray-300">No bet</span>}
                                <button onClick={() => { setEditingBB(m.id); const p = parseBet(m.bet); setEditBBBetType(p.betType); setEditBBBetAmount(p.amount); setEditBBScoringType(p.scoringType) }}
                                  className="text-gray-300 hover:text-gray-500 ml-0.5">✎</button>
                              </span>
                            )}
                            <button
                              onClick={() => setShowScorecardFor({
                                type: 'bb-scorecards',
                                t1p1Id: m.team1_player1_id, t1p2Id: m.team1_player2_id,
                                t2p1Id: m.team2_player1_id, t2p2Id: m.team2_player2_id,
                                t1p1Name: t1p1.name.split(' ')[0], t1p2Name: t1p2.name.split(' ')[0],
                                t2p1Name: t2p1.name.split(' ')[0], t2p2Name: t2p2.name.split(' ')[0],
                                t1Name, t2Name,
                                scoringType: bbScoringTypeParsed,
                                betType: bbBetTypeParsed,
                              })}
                              className="text-xs font-medium px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400 transition">
                              Scorecards
                            </button>
                            <span className="flex-1" />
                            <button onClick={() => setConfirmDelete({ id: m.id, label: `${t1Name} vs ${t2Name}`, type: 'bb' })} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                          </div>

                          {/* 5-column summary table */}
                          <div className="rounded-lg border border-gray-100 overflow-hidden">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr style={{ background: '#f9fafb' }}>
                                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500">Team</th>
                                  {!isBBOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Front</th>}
                                  {!isBBOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Back</th>}
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Total</th>
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-500">Thru</th>
                                </tr>
                              </thead>
                              <tbody>
                                {([
                                  { tName: t1Name, front: stats.t1Front, back: stats.t1Back, total: stats.t1Total, p1Id: m.team1_player1_id, p2Id: m.team1_player2_id, color: '#2563eb', wFront: t1WinsFront, wBack: t1WinsBack, wTotal: t1WinsTotal, mFront: stats.t1FrontWins - stats.t2FrontWins, mBack: stats.t1BackWins - stats.t2BackWins, mTotal: stats.t1Wins - stats.t2Wins },
                                  { tName: t2Name, front: stats.t2Front, back: stats.t2Back, total: stats.t2Total, p1Id: m.team2_player1_id, p2Id: m.team2_player2_id, color: '#92400e', wFront: t2WinsFront, wBack: t2WinsBack, wTotal: t2WinsTotal, mFront: stats.t2FrontWins - stats.t1FrontWins, mBack: stats.t2BackWins - stats.t1BackWins, mTotal: stats.t2Wins - stats.t1Wins },
                                ] as const).map(({ tName, front, back, total, p1Id, p2Id, color, wFront, wBack, wTotal, mFront, mBack, mTotal }, rowIdx) => {
                                  const thru = holes.filter((h) =>
                                    (scoreMap[p1Id]?.[h.hole_number] != null) ||
                                    (scoreMap[p2Id]?.[h.hole_number] != null)
                                  ).length
                                  const isFirstRow = rowIdx === 0
                                  const mpCol = (diff: number, hasData: boolean) => {
                                    if (!hasData) return <span style={{ color: '#d1d5db' }}>–</span>
                                    if (diff > 0) return <span style={{ color: '#16a34a' }}>{diff}UP</span>
                                    if (diff < 0) return null
                                    return null
                                  }
                                  const asLabelStyle: React.CSSProperties = { position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 700, color: '#6b7280', background: 'white', padding: '0 3px', lineHeight: 1, whiteSpace: 'nowrap', zIndex: 1 }
                                  return (
                                    <tr key={tName} className="border-t border-gray-100">
                                      <td className="px-3 py-2">
                                        <button
                                          onClick={() => setShowScorecardFor({ type: 'bestball', p1Id, p2Id, teamName: tName })}
                                          className="text-xs font-semibold hover:underline text-left"
                                          style={{ color }}>
                                          {tName}
                                        </button>
                                      </td>
                                      {!isBBOverallBet && <td className="px-3 py-2 text-center text-xs font-semibold" style={{ position: 'relative', color: isBBMatchPlay ? undefined : vpColor(front) }}>
                                        {isBBMatchPlay && !isFirstRow && mFront === 0 && front !== null && <span style={asLabelStyle}>AS</span>}
                                        <span style={{ position: 'relative', display: 'inline-block' }}>
                                          {isBBMatchPlay ? mpCol(mFront, front !== null) : <VsParDisplay n={front} />}
                                          {isBBMatchPlay
                                            ? (bbHole9 && mFront > 0 && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)
                                            : (bbHole9 && wFront && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)}
                                        </span>
                                      </td>}
                                      {!isBBOverallBet && <td className="px-3 py-2 text-center text-xs font-semibold" style={{ position: 'relative', color: isBBMatchPlay ? undefined : vpColor(back) }}>
                                        {isBBMatchPlay && !isFirstRow && mBack === 0 && back !== null && <span style={asLabelStyle}>AS</span>}
                                        <span style={{ position: 'relative', display: 'inline-block' }}>
                                          {isBBMatchPlay ? mpCol(mBack, back !== null) : <VsParDisplay n={back} />}
                                          {isBBMatchPlay
                                            ? (bbHole18 && mBack > 0 && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)
                                            : (bbHole18 && wBack && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)}
                                        </span>
                                      </td>}
                                      <td className="px-3 py-2 text-center text-xs font-semibold" style={{ position: 'relative', color: isBBMatchPlay ? undefined : vpColor(total) }}>
                                        {isBBMatchPlay && !isFirstRow && mTotal === 0 && total !== null && <span style={asLabelStyle}>AS</span>}
                                        <span style={{ position: 'relative', display: 'inline-block' }}>
                                          {isBBMatchPlay ? mpCol(mTotal, total !== null) : <VsParDisplay n={total} />}
                                          {isBBMatchPlay
                                            ? (bbHole18 && mTotal > 0 && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)
                                            : (bbHole18 && wTotal && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-center text-xs text-gray-500">{thru === 0 ? '–' : thru === 18 ? 'F' : thru}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>

        {/* ── Matchup Results ── */}
        {payouts.rows.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowPayouts((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm font-semibold text-gray-800">Matchup Results</span>
              <span className="text-gray-400 text-xs">{showPayouts ? '▲ Hide' : '▼ Show'}</span>
            </button>
            {showPayouts && (
              <div className="border-t border-gray-100 space-y-3 p-3">

                {/* Per-matchup breakdown */}
                {payouts.rows.map((row) => {
                  const h2hMatch = matchups.find((m) => m.id === row.id)
                  const bbMatch = bestBallMatchups.find((m) => m.id === row.id)
                  const involvedPlayerIds = h2hMatch
                    ? [h2hMatch.player1_id, h2hMatch.player2_id]
                    : bbMatch
                      ? [bbMatch.team1_player1_id, bbMatch.team1_player2_id, bbMatch.team2_player1_id, bbMatch.team2_player2_id]
                      : []
                  const allFinished = involvedPlayerIds.length > 0 && holes.length > 0 &&
                    involvedPlayerIds.every((id) => Object.keys(scoreMap[id] ?? {}).length >= holes.length)

                  return (
                    <div key={row.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="px-4 pt-3 pb-1 border-b border-gray-100">
                        <p className="text-xs font-bold text-gray-800">{row.label}</p>
                        <p className="text-xs" style={{ color: row.segments.length === 0 ? '#9ca3af' : gold }}>
                          {row.betLabel}
                        </p>
                      </div>
                      {row.segments.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-gray-400">
                          No bet amount set — use the ✎ button above to add one.
                        </div>
                      ) : !allFinished ? (
                        <div className="px-4 py-3 text-xs text-gray-400 italic">
                          Round in progress — result pending
                        </div>
                      ) : (
                        <table className="w-full border-collapse">
                          <tbody>
                            {/* For Nassau bets show only the Result summary row; for Overall show the single segment */}
                            {!row.nassauResult && row.segments.map((seg) => (
                              <tr key={seg.name} className="border-t border-gray-100 bg-gray-50">
                                <td className="px-4 py-2 text-xs font-semibold text-gray-500 w-14">Result</td>
                                <td className="px-2 py-2 text-xs flex-1">
                                  {seg.settled
                                    ? seg.tied
                                      ? <span className="text-gray-400 italic">Tied — push</span>
                                      : <span className="font-semibold text-green-700">{seg.winnerLabel}</span>
                                    : <span className="text-gray-300">Pending</span>}
                                </td>
                                <td className="px-4 py-2 text-xs font-bold text-right whitespace-nowrap">
                                  {seg.settled && !seg.tied
                                    ? <span className="text-green-600">+${seg.amount}{seg.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span>
                                    : <span className="font-normal text-gray-300">${seg.amount}{seg.perPlayer ? '/player' : ''}</span>}
                                </td>
                              </tr>
                            ))}
                            {row.nassauResult && (() => {
                              const nr = row.nassauResult!
                              const fmtAmt = nr.amount % 1 === 0 ? String(nr.amount) : nr.amount.toFixed(2)
                              return (
                                <tr className="border-t border-gray-100 bg-gray-50">
                                  <td className="px-4 py-2 text-xs font-bold text-gray-500 w-14">Result</td>
                                  <td className="px-2 py-2 text-xs font-semibold">
                                    {!nr.anySettled
                                      ? <span className="text-gray-300">Pending</span>
                                      : nr.winnerLabel === null
                                        ? <span className="text-gray-400 italic">Tied — push</span>
                                        : <span className="text-green-700 font-semibold">{nr.winnerLabel}</span>}
                                  </td>
                                  <td className="px-4 py-2 text-xs font-bold text-right whitespace-nowrap">
                                    {nr.anySettled && nr.winnerLabel !== null
                                      ? <span className="text-green-600">+${fmtAmt}{nr.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span>
                                      : null}
                                  </td>
                                </tr>
                              )
                            })()}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}

              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HorizontalScorecardTable({
  rows, holes, showMatchPlay = false, betType = '',
}: {
  rows: { label: string; scoreMap: Partial<Record<number, number>> }[]
  holes: Hole[]
  showMatchPlay?: boolean
  betType?: BetType | ''
}) {
  const frontNine = holes.filter((h) => h.hole_number <= 9)
  const backNine = holes.filter((h) => h.hole_number >= 10)
  const frontPar = frontNine.reduce((s, h) => s + h.par, 0)
  const backPar = backNine.reduce((s, h) => s + h.par, 0)
  const totalPar = frontPar + backPar

  // Match play running standings.
  // Nassau: front-9 and back-9 reset independently; Overall: cumulative across all 18 holes.
  const matchHole: Record<number, number> = {}
  let frontMatchCum = 0, backMatchCum = 0, totalMatchCum = 0
  if (showMatchPlay && rows.length === 2) {
    const [r1, r2] = rows
    const isOverall = betType === 'straight'
    let runningFront = 0, runningBack = 0, frontSnapshot = 0
    for (const hole of [...holes].sort((a, b) => a.hole_number - b.hole_number)) {
      const s1 = r1.scoreMap[hole.hole_number] ?? null
      const s2 = r2.scoreMap[hole.hole_number] ?? null
      if (s1 !== null && s2 !== null) {
        const d = s1 < s2 ? 1 : s2 < s1 ? -1 : 0
        totalMatchCum += d
        if (hole.hole_number <= 9) {
          runningFront += d
          // Overall: per-hole cell shows running total across all 18; Nassau: front-only running total
          matchHole[hole.hole_number] = isOverall ? totalMatchCum : runningFront
          frontSnapshot = totalMatchCum  // capture standing at the turn for F summary
        } else {
          runningBack += d
          // Overall: carry the front lead forward; Nassau: back-9 restarts from 0
          matchHole[hole.hole_number] = isOverall ? totalMatchCum : runningBack
        }
      }
    }
    // F summary: overall standing at turn (Overall) or front-only (Nassau)
    frontMatchCum = isOverall ? frontSnapshot : runningFront
    // B summary: back-9 standalone in both cases (for Overall it's informational; no checkmark shown)
    backMatchCum = runningBack
  }

  // Pre-compute per-row stroke totals so we can mark section winners (2-row comparisons only)
  const _rowStrokeStats = rows.map(({ scoreMap }) => {
    const fScored = frontNine.filter((h) => scoreMap[h.hole_number] != null)
    const bScored = backNine.filter((h) => scoreMap[h.hole_number] != null)
    const fStrokes = fScored.reduce((s, h) => s + (scoreMap[h.hole_number] ?? 0), 0)
    const bStrokes = bScored.reduce((s, h) => s + (scoreMap[h.hole_number] ?? 0), 0)
    return { fScored, bScored, fStrokes, bStrokes }
  })
  let frontWinnerIdx: number | null = null
  let backWinnerIdx: number | null = null
  let totalWinnerIdx: number | null = null
  if (rows.length === 2 && !showMatchPlay) {
    const [s0, s1] = _rowStrokeStats
    const showSectionChk = betType !== 'straight'
    if (showSectionChk && s0.fScored.length > 0 && s1.fScored.length > 0 && s0.fStrokes !== s1.fStrokes)
      frontWinnerIdx = s0.fStrokes < s1.fStrokes ? 0 : 1
    if (showSectionChk && s0.bScored.length > 0 && s1.bScored.length > 0 && s0.bStrokes !== s1.bStrokes)
      backWinnerIdx = s0.bStrokes < s1.bStrokes ? 0 : 1
    const t0 = s0.fStrokes + s0.bStrokes, t1 = s1.fStrokes + s1.bStrokes
    if ((s0.fScored.length + s0.bScored.length) > 0 && (s1.fScored.length + s1.bScored.length) > 0 && t0 !== t1)
      totalWinnerIdx = t0 < t1 ? 0 : 1
  }
  const chk = <span style={{ color: '#16a34a', fontSize: '0.6rem', marginLeft: '1px', lineHeight: 1 }}>✓</span>

  const hdr = (highlight?: boolean): React.CSSProperties => ({
    background: highlight ? '#4a7fa5' : navy,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: 700,
    fontSize: '0.6rem',
    textAlign: 'center',
    padding: '0.35rem 0.2rem',
    minWidth: '1.8rem',
    whiteSpace: 'nowrap',
  })
  const cell = (highlight?: boolean): React.CSSProperties => ({
    textAlign: 'center',
    padding: '0.3rem 0.2rem',
    fontSize: '0.72rem',
    borderTop: '1px solid #e5e7eb',
    background: highlight ? '#dbeafe' : 'white',
    color: highlight ? '#1e40af' : undefined,
    fontWeight: highlight ? 700 : undefined,
    minWidth: '1.8rem',
  })

  return (
    <table style={{ borderCollapse: 'collapse', minWidth: '540px', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...hdr(), textAlign: 'left', paddingLeft: '0.5rem', minWidth: '5rem' }}>HOLE</th>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <th key={n} style={hdr()}>{n}</th>)}
          <th style={hdr(true)}>F</th>
          {[10, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => <th key={n} style={hdr()}>{n}</th>)}
          <th style={hdr(true)}>B</th>
          <th style={hdr()}>Tot</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={{ ...cell(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151' }}>Par</td>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
            const hole = holes.find((h) => h.hole_number === n)
            return <td key={n} style={{ ...cell(), color: '#6b7280' }}>{hole?.par ?? '–'}</td>
          })}
          <td style={cell(true)}>{frontNine.length > 0 ? frontPar : '–'}</td>
          {[10, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => {
            const hole = holes.find((h) => h.hole_number === n)
            return <td key={n} style={{ ...cell(), color: '#6b7280' }}>{hole?.par ?? '–'}</td>
          })}
          <td style={cell(true)}>{backNine.length > 0 ? backPar : '–'}</td>
          <td style={{ ...cell(), fontWeight: 700, color: '#111827' }}>{totalPar}</td>
        </tr>
        {showMatchPlay && rows.length === 2 && (() => {
          const hasFront = Object.keys(matchHole).some((k) => Number(k) <= 9)
          const hasBack = Object.keys(matchHole).some((k) => Number(k) >= 10)
          const hasAny = Object.keys(matchHole).length > 0
          const mpCell: React.CSSProperties = { textAlign: 'center', padding: '0.3rem 0.2rem', fontSize: '0.65rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb', minWidth: '1.8rem' }
          const upperHole = (n: number): React.ReactNode => {
            if (!(n in matchHole)) return <span style={{ color: '#d1d5db' }}>–</span>
            const d = matchHole[n]
            if (d > 0) return <span style={{ fontWeight: 700, color: '#16a34a' }}>{d}UP</span>
            if (d === 0) return <span style={{ fontWeight: 700, color: '#6b7280' }}>AS</span>
            return null
          }
          const upperSum = (cum: number, hasData: boolean, showChk = true): React.ReactNode => {
            if (!hasData) return <span style={{ color: '#d1d5db' }}>–</span>
            if (cum > 0) return <span style={{ fontWeight: 700, color: '#16a34a' }}>{cum}UP{showChk && chk}</span>
            if (cum === 0) return <span style={{ fontWeight: 700, color: '#6b7280' }}>AS</span>
            return null
          }
          return (
            <tr>
              <td style={{ textAlign: 'left', paddingLeft: '0.5rem', fontSize: '0.72rem', padding: '0.3rem 0.2rem 0.3rem 0.5rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb', whiteSpace: 'nowrap', minWidth: '5rem' }}></td>
              {[1,2,3,4,5,6,7,8,9].map((n) => <td key={n} style={mpCell}>{upperHole(n)}</td>)}
              <td style={{ ...mpCell, background: '#dbeafe' }}>{upperSum(frontMatchCum, hasFront, betType !== 'straight')}</td>
              {[10,11,12,13,14,15,16,17,18].map((n) => <td key={n} style={mpCell}>{upperHole(n)}</td>)}
              <td style={{ ...mpCell, background: '#dbeafe' }}>{upperSum(backMatchCum, hasBack, betType !== 'straight')}</td>
              <td style={{ ...mpCell, fontWeight: 700 }}>{upperSum(totalMatchCum, hasAny)}</td>
            </tr>
          )
        })()}
        {rows.map(({ label, scoreMap }, rowIdx) => {
          const frontScored = frontNine.filter((h) => scoreMap[h.hole_number] != null)
          const backScored = backNine.filter((h) => scoreMap[h.hole_number] != null)
          const frontStrokes = frontScored.reduce((s, h) => s + (scoreMap[h.hole_number] ?? 0), 0)
          const backStrokes = backScored.reduce((s, h) => s + (scoreMap[h.hole_number] ?? 0), 0)
          const totalStrokes = frontStrokes + backStrokes
          const anyScored = frontScored.length + backScored.length > 0
          const wonFront = frontWinnerIdx === rowIdx
          const wonBack  = backWinnerIdx  === rowIdx
          const wonTotal = totalWinnerIdx === rowIdx
          return (
            <tr key={label}>
              <td style={{ ...cell(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>{label}</td>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
                const hole = holes.find((h) => h.hole_number === n)
                const s = scoreMap[n] ?? null
                return (
                  <td key={n} style={cell()}>
                    {s != null && hole
                      ? <ScoreCell strokes={s} par={hole.par} />
                      : <span style={{ color: '#d1d5db' }}>–</span>}
                  </td>
                )
              })}
              <td style={cell(true)}>
                {frontScored.length > 0
                  ? <span style={{ position: 'relative', display: 'inline-block' }}>
                      {frontStrokes}
                      {wonFront && <span style={{ position: 'absolute', left: '100%', paddingLeft: '1px', top: '50%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.6rem', lineHeight: 1 }}>✓</span>}
                    </span>
                  : '–'}
              </td>
              {[10, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => {
                const hole = holes.find((h) => h.hole_number === n)
                const s = scoreMap[n] ?? null
                return (
                  <td key={n} style={cell()}>
                    {s != null && hole
                      ? <ScoreCell strokes={s} par={hole.par} />
                      : <span style={{ color: '#d1d5db' }}>–</span>}
                  </td>
                )
              })}
              <td style={cell(true)}>
                {backScored.length > 0
                  ? <span style={{ position: 'relative', display: 'inline-block' }}>
                      {backStrokes}
                      {wonBack && <span style={{ position: 'absolute', left: '100%', paddingLeft: '1px', top: '50%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.6rem', lineHeight: 1 }}>✓</span>}
                    </span>
                  : '–'}
              </td>
              <td style={{ ...cell(), fontWeight: 700 }}>
                {anyScored
                  ? <span style={{ position: 'relative', display: 'inline-block', fontWeight: 700, color: '#111827' }}>
                      {totalStrokes}
                      {wonTotal && <span style={{ position: 'absolute', left: '100%', paddingLeft: '1px', top: '50%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.6rem', lineHeight: 1 }}>✓</span>}
                    </span>
                  : '–'}
              </td>
            </tr>
          )
        })}
        {showMatchPlay && rows.length === 2 && (() => {
          const hasFront = Object.keys(matchHole).some((k) => Number(k) <= 9)
          const hasBack = Object.keys(matchHole).some((k) => Number(k) >= 10)
          const hasAny = Object.keys(matchHole).length > 0
          const mpCell: React.CSSProperties = { textAlign: 'center', padding: '0.3rem 0.2rem', fontSize: '0.65rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb', minWidth: '1.8rem' }
          const lowerHole = (n: number): React.ReactNode => {
            if (!(n in matchHole)) return <span style={{ color: '#d1d5db' }}>–</span>
            const d = matchHole[n]
            if (d < 0) return <span style={{ fontWeight: 700, color: '#16a34a' }}>{-d}UP</span>
            return null
          }
          const lowerSum = (cum: number, hasData: boolean, showChk = true): React.ReactNode => {
            if (!hasData) return <span style={{ color: '#d1d5db' }}>–</span>
            if (cum < 0) return <span style={{ fontWeight: 700, color: '#16a34a' }}>{-cum}UP{showChk && chk}</span>
            return null
          }
          return (
            <tr>
              <td style={{ textAlign: 'left', paddingLeft: '0.5rem', fontSize: '0.72rem', padding: '0.3rem 0.2rem 0.3rem 0.5rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb', whiteSpace: 'nowrap', minWidth: '5rem' }}></td>
              {[1,2,3,4,5,6,7,8,9].map((n) => <td key={n} style={mpCell}>{lowerHole(n)}</td>)}
              <td style={{ ...mpCell, background: '#dbeafe' }}>{lowerSum(frontMatchCum, hasFront, betType !== 'straight')}</td>
              {[10,11,12,13,14,15,16,17,18].map((n) => <td key={n} style={mpCell}>{lowerHole(n)}</td>)}
              <td style={{ ...mpCell, background: '#dbeafe' }}>{lowerSum(backMatchCum, hasBack, betType !== 'straight')}</td>
              <td style={{ ...mpCell, fontWeight: 700 }}>{lowerSum(totalMatchCum, hasAny)}</td>
            </tr>
          )
        })()}
      </tbody>
    </table>
  )
}

function H2HHoleTable({ stats, p1, p2, holes }: {
  stats: ReturnType<typeof computeStats>
  p1: Player; p2: Player
  holes: Hole[]
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr style={{ background: navy }}>
          <th className="px-3 py-2 text-left text-xs font-semibold w-10" style={{ color: 'rgba(255,255,255,0.6)' }}>Hole</th>
          <th className="px-2 py-2 text-center text-xs font-semibold w-8" style={{ color: 'rgba(255,255,255,0.6)' }}>Par</th>
          <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>{p1.name.split(' ')[0]}</th>
          <th className="px-2 py-2 w-8" />
          <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>{p2.name.split(' ')[0]}</th>
        </tr>
      </thead>
      <tbody>
        {stats.rows.map(({ hole, s1, s2, result }) => {
          const rowBg = result === 'win' ? '#f0fdf4' : result === 'loss' ? '#fff1f2' : result === 'tie' ? '#f9fafb' : 'white'
          return (
            <tr key={hole.hole_number} style={{ background: rowBg }} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-2.5 font-bold text-gray-900">{hole.hole_number}</td>
              <td className="px-2 py-2.5 text-center text-gray-400">{hole.par}</td>
              <td className="px-3 py-2.5 text-center">
                {s1 != null ? <ScoreCell strokes={s1} par={hole.par} /> : <span className="text-gray-300">–</span>}
              </td>
              <td className="px-2 py-2.5 text-center text-xs font-bold">
                {result === 'win' && <span className="text-green-600">W</span>}
                {result === 'loss' && <span className="text-red-500">L</span>}
                {result === 'tie' && <span className="text-gray-400">T</span>}
                {result === null && <span className="text-gray-200">–</span>}
              </td>
              <td className="px-3 py-2.5 text-center">
                {s2 != null ? <ScoreCell strokes={s2} par={hole.par} /> : <span className="text-gray-300">–</span>}
              </td>
            </tr>
          )
        })}
        <tr className="border-t-2 border-gray-200 font-bold" style={{ background: '#f9fafb' }}>
          <td colSpan={2} className="px-3 py-2.5 text-gray-700">Total</td>
          <td className="px-3 py-2.5 text-center">
            {stats.p1TotalStrokes > 0
              ? <span style={{ color: vpColor(stats.p1Total) }}>{stats.p1TotalStrokes} ({fmtVsPar(stats.p1Total)})</span>
              : '–'}
          </td>
          <td className="px-2 py-2.5 text-center text-xs"
            style={{ color: stats.p1Wins > stats.p2Wins ? '#16a34a' : stats.p2Wins > stats.p1Wins ? '#dc2626' : '#6b7280' }}>
            {stats.p1Wins}–{stats.p2Wins}–{stats.ties}
          </td>
          <td className="px-3 py-2.5 text-center">
            {stats.p2TotalStrokes > 0
              ? <span style={{ color: vpColor(stats.p2Total) }}>{stats.p2TotalStrokes} ({fmtVsPar(stats.p2Total)})</span>
              : '–'}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function BBMatchTable({ stats, t1Name, t2Name, holes }: {
  stats: ReturnType<typeof computeBestBall>
  t1Name: string; t2Name: string
  holes: Hole[]
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr style={{ background: navy }}>
          <th className="px-3 py-2 text-left text-xs font-semibold w-10" style={{ color: 'rgba(255,255,255,0.6)' }}>Hole</th>
          <th className="px-2 py-2 text-center text-xs w-8" style={{ color: 'rgba(255,255,255,0.6)' }}>Par</th>
          <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: '#93c5fd' }}>{t1Name}</th>
          <th className="px-2 py-2 w-8" />
          <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: '#fcd34d' }}>{t2Name}</th>
        </tr>
      </thead>
      <tbody>
        {stats.rows.map(({ hole, t1Best, t2Best, result }) => {
          const rowBg = result === 'team1' ? '#f0fdf4' : result === 'team2' ? '#fff1f2' : result === 'tie' ? '#f9fafb' : 'white'
          return (
            <tr key={hole.hole_number} style={{ background: rowBg }} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-2.5 font-bold text-gray-900">{hole.hole_number}</td>
              <td className="px-2 py-2.5 text-center text-gray-400">{hole.par}</td>
              <td className="px-3 py-2.5 text-center">
                {t1Best != null ? <ScoreCell strokes={t1Best} par={hole.par} /> : <span className="text-gray-300">–</span>}
              </td>
              <td className="px-2 py-2.5 text-center text-xs font-bold">
                {result === 'team1' && <span className="text-green-600">W</span>}
                {result === 'team2' && <span className="text-red-500">L</span>}
                {result === 'tie' && <span className="text-gray-400">T</span>}
                {result === null && <span className="text-gray-200">–</span>}
              </td>
              <td className="px-3 py-2.5 text-center">
                {t2Best != null ? <ScoreCell strokes={t2Best} par={hole.par} /> : <span className="text-gray-300">–</span>}
              </td>
            </tr>
          )
        })}
        <tr className="border-t-2 border-gray-200 font-bold" style={{ background: '#f9fafb' }}>
          <td colSpan={2} className="px-3 py-2.5 text-gray-700">Total</td>
          <td className="px-3 py-2.5 text-center"><span style={{ color: vpColor(stats.t1Total) }}>{fmtVsPar(stats.t1Total)}</span></td>
          <td className="px-2 py-2.5 text-center text-xs"
            style={{ color: stats.t1Wins > stats.t2Wins ? '#16a34a' : stats.t2Wins > stats.t1Wins ? '#dc2626' : '#6b7280' }}>
            {stats.t1Wins}–{stats.t2Wins}–{stats.ties}
          </td>
          <td className="px-3 py-2.5 text-center"><span style={{ color: vpColor(stats.t2Total) }}>{fmtVsPar(stats.t2Total)}</span></td>
        </tr>
      </tbody>
    </table>
  )
}

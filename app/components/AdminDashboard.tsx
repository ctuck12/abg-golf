'use client'

import { useActionState, useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  createRound, addTeam, addPlayer, deleteTeam, deletePlayer,
  toggleTeamAdmin, resetTeamScores, activateRound, updateHolePars, updateBallValues,
  adminLogout, renameTeam, renamePlayer, movePlayer,
  updateSkinsSettings, updatePlayerSkinsParticipation, updateTeamSettings,
  updatePlayerHandicap,
  updateRoundAutoHandicap,
  toggleMixedGroups,
  createPlayingGroup,
  deletePlayingGroup,
  setPlayerGroup,
  createRosterPlayer,
  updateRosterPlayer,
  deleteRosterPlayer,
  addRosterPlayerToTeam,
  createHammerMatchup,
  deleteHammerMatchup,
  bulkCreateTeams,
} from '@/app/actions'
import {
  computeTeamBallSummary, calculatePoolPayouts,
  computeDaytonaSidesSummary, computePlayerDaytonaPoints, settleDaytonaPlayerPoints,
  computePlayerDaytonaDollars,
  computeSkinsResults,
  type DaytonaHoleAssignment, type BallHalfResult, type SkinResult,
} from '@/lib/scoring'
import PinLoginModal from './PinLoginModal'
import { supabase } from '@/lib/supabase'

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function generateBalancedTeams(players: GeneratedPlayer[], numTeams: number): GeneratedTeam[] {
  const sorted = [...players].sort((a, b) => {
    if (a.handicap == null && b.handicap == null) return 0
    if (a.handicap == null) return 1
    if (b.handicap == null) return -1
    return a.handicap - b.handicap
  })

  const n = sorted.length
  const slots: GeneratedPlayer[][] = Array.from({ length: numTeams }, () => [])

  if (n % numTeams === 0) {
    // Even split — snake draft is optimal: pairs best+worst, 2nd+2nd-worst, etc.
    sorted.forEach((player, i) => {
      const round = Math.floor(i / numTeams)
      const pos = i % numTeams
      const idx = round % 2 === 0 ? pos : numTeams - 1 - pos
      slots[idx].push(player)
    })
  } else {
    // Uneven split — greedy min-sum assignment handles remainders far better than snake.
    // Each player goes to the team with the lowest handicap total so far (capped at ceil size).
    const maxSize = Math.ceil(n / numTeams)
    const sums: number[] = Array(numTeams).fill(0)
    for (const player of sorted) {
      let bestTeam = 0
      let bestSum = Infinity
      for (let t = 0; t < numTeams; t++) {
        if (slots[t].length >= maxSize) continue
        if (sums[t] < bestSum) { bestSum = sums[t]; bestTeam = t }
      }
      slots[bestTeam].push(player)
      sums[bestTeam] += player.handicap ?? 0
    }
  }

  return slots.map((teamPlayers, i) => {
    const withHcp = teamPlayers.filter(p => p.handicap != null)
    const avg = withHcp.length
      ? +(withHcp.reduce((s, p) => s + p.handicap!, 0) / withHcp.length).toFixed(1)
      : null
    return { name: `Team ${i + 1}`, pin: randomPin(), players: teamPlayers, avgHandicap: avg }
  })
}

// Match the server-side constants for course par preview
const COURSE_PARS_CLIENT: Record<string, number[]> = {
  south:      [4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5, 4, 3, 4, 5],
  north:      [4, 4, 4, 3, 4, 4, 5, 3, 5, 3, 4, 4, 5, 3, 5, 4, 3, 4],
  liveoak:    [4, 3, 4, 4, 3, 4, 4, 5, 4, 4, 5, 3, 4, 4, 5, 4, 3, 4],
  maxwell:    [4, 5, 4, 4, 4, 4, 3, 4, 3, 5, 4, 4, 4, 3, 4, 5, 3, 4],
  shadyoaks:  [4, 3, 4, 5, 4, 4, 3, 3, 4, 5, 4, 4, 3, 4, 4, 3, 5, 4],
  hideout:    [5, 3, 4, 4, 3, 4, 5, 4, 5, 4, 4, 4, 3, 4, 3, 5, 4, 4],
  canyonwest: [4, 4, 4, 5, 4, 3, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5],
}

type Round = { id: string; name: string; date: string; course: string; balls_count: number; format: string; daytona_variant: string | null; is_started: boolean; include_total: boolean; skins_enabled: boolean; skins_amount: number; auto_handicap?: boolean; banker_min_bet?: number | null; mixed_groups?: boolean } | null
type PlayingGroup = { id: string; name: string; pin: string }
type PlayingGroupPlayer = { playing_group_id: string; player_id: string }
type RosterPlayer = { id: string; name: string; ghin_number?: string | null; handicap_index?: number | null; email?: string | null }
type HammerMatchup = { id: string; team1_id: string; team2_id: string; base_bet: number; auto_handicap: boolean }
type Team = { id: string; name: string; pin: string; is_admin: boolean; daytona_variant?: string | null; banker_side_game?: boolean; banker_side_game_min_bet?: number | null }
type Player = { id: string; team_id: string; name: string; position: number | null; skins_participant: boolean; handicap?: number | null }
type Hole = { hole_number: number; par: number }
type BallValue = { ball_number: number; value_dollars: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type PressEntry = { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: 'p1' | 'p2'; strokes?: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string; press: PressEntry[] }
type BestBallMatchup = {
  id: string
  team1_player1_id: string; team1_player2_id: string
  team2_player1_id: string; team2_player2_id: string
  bet: string
}
type GeneratedPlayer = { id: string; name: string; handicap: number | null; source: 'roster' | 'manual' }
type GeneratedTeam = { name: string; pin: string; players: GeneratedPlayer[]; avgHandicap: number | null }

type MatchupBetType = 'nassau' | 'straight'
type MatchupScoringType = 'stroke' | 'match'
type MatchupPayoutSegment = {
  name: 'Front' | 'Back' | 'Total'
  settled: boolean
  winnerLabel: string | null
  tied: boolean
  amount: number
  perPlayer: boolean
}
type MatchupPayoutRow = {
  id: string
  type: 'h2h' | 'bb'
  label: string
  betLabel: string
  segments: MatchupPayoutSegment[]
  nassauResult?: {
    winnerLabel: string | null
    amount: number
    perPlayer: boolean
    anySettled: boolean
    swept?: boolean
  }
}

// ── Matchup payout helpers ────────────────────────────────────────────────────
function parseMatchupAmounts(raw: string): { frontAmount: number; backAmount: number; totalAmount: number } {
  const p = raw.split('|')
  if (p.length === 3) {
    const f = parseFloat(p[0]) || 0, b = parseFloat(p[1]) || 0, t = parseFloat(p[2]) || 0
    return { frontAmount: f, backAmount: b, totalAmount: t }
  }
  const a = parseFloat(raw) || 0
  return { frontAmount: a, backAmount: a, totalAmount: a }
}

function parseMatchupBet(bet: string): { betType: MatchupBetType | ''; amount: string; scoringType: MatchupScoringType; sweepAmount: string; handicapSide: string; handicapFront: string; handicapBack: string; handicapTotal: string; frontAmount: number; backAmount: number; totalAmount: number } {
  const empty = { betType: '' as MatchupBetType | '', amount: '', scoringType: 'stroke' as MatchupScoringType, sweepAmount: '', handicapSide: '', handicapFront: '', handicapBack: '', handicapTotal: '', frontAmount: 0, backAmount: 0, totalAmount: 0 }
  if (!bet) return empty
  const parts = bet.split(':')
  if (parts.length >= 2 && (parts[0] === 'nassau' || parts[0] === 'straight')) {
    const rawAmt = parts[1] ?? ''
    return { betType: parts[0] as MatchupBetType, amount: rawAmt, scoringType: parts[2] === 'match' ? 'match' : 'stroke', sweepAmount: parts[3] ?? '', handicapSide: parts[4] ?? '', handicapFront: parts[5] ?? '', handicapBack: parts[6] ?? '', handicapTotal: parts[7] ?? '', ...parseMatchupAmounts(rawAmt) }
  }
  if (parts[0] === 'score' && parts.length >= 2) {
    return { ...empty, scoringType: parts[1] === 'match' ? 'match' : 'stroke' }
  }
  return empty
}

function formatMatchupBet(bet: string): string {
  const { betType, scoringType, sweepAmount, frontAmount, backAmount, totalAmount } = parseMatchupBet(bet)
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

function computeH2HStats(
  p1Id: string, p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[]
) {
  let p1Wins = 0, p2Wins = 0
  let p1FW = 0, p2FW = 0, p1BW = 0, p2BW = 0
  let p1F = 0, p2F = 0, fPar = 0, fPlayed = 0
  let p1B = 0, p2B = 0, bPar = 0, bPlayed = 0
  let p1T = 0, p2T = 0, tPar = 0, tPlayed = 0
  for (const hole of holes) {
    const s1 = scoreMap[p1Id]?.[hole.hole_number] ?? null
    const s2 = scoreMap[p2Id]?.[hole.hole_number] ?? null
    if (s1 !== null && s2 !== null) {
      tPlayed++; p1T += s1; p2T += s2; tPar += hole.par
      if (hole.hole_number <= 9) { fPlayed++; p1F += s1; p2F += s2; fPar += hole.par }
      else { bPlayed++; p1B += s1; p2B += s2; bPar += hole.par }
      if (s1 < s2) { p1Wins++; if (hole.hole_number <= 9) p1FW++; else p1BW++ }
      else if (s1 > s2) { p2Wins++; if (hole.hole_number <= 9) p2FW++; else p2BW++ }
    }
  }
  return {
    holesPlayed: tPlayed,
    p1Wins, p2Wins,
    p1FrontWins: p1FW, p2FrontWins: p2FW, p1BackWins: p1BW, p2BackWins: p2BW,
    p1Front: fPlayed > 0 ? p1F - fPar : null, p2Front: fPlayed > 0 ? p2F - fPar : null,
    p1Back: bPlayed > 0 ? p1B - bPar : null, p2Back: bPlayed > 0 ? p2B - bPar : null,
    p1Total: tPlayed > 0 ? p1T - tPar : null, p2Total: tPlayed > 0 ? p2T - tPar : null,
  }
}

function computeBBStats(
  t1p1Id: string, t1p2Id: string,
  t2p1Id: string, t2p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[]
) {
  let t1Wins = 0, t2Wins = 0
  let t1FW = 0, t2FW = 0, t1BW = 0, t2BW = 0
  let t1F = 0, t2F = 0, fPar = 0, fPlayed = 0
  let t1B = 0, t2B = 0, bPar = 0, bPlayed = 0
  let t1T = 0, t2T = 0, tPar = 0, tPlayed = 0
  for (const hole of holes) {
    const t1p1 = scoreMap[t1p1Id]?.[hole.hole_number] ?? null
    const t1p2 = scoreMap[t1p2Id]?.[hole.hole_number] ?? null
    const t2p1 = scoreMap[t2p1Id]?.[hole.hole_number] ?? null
    const t2p2 = scoreMap[t2p2Id]?.[hole.hole_number] ?? null
    const t1Arr = [t1p1, t1p2].filter((s): s is number => s !== null)
    const t2Arr = [t2p1, t2p2].filter((s): s is number => s !== null)
    const t1Best = t1Arr.length > 0 ? Math.min(...t1Arr) : null
    const t2Best = t2Arr.length > 0 ? Math.min(...t2Arr) : null
    if (t1Best !== null && t2Best !== null) {
      tPlayed++; t1T += t1Best; t2T += t2Best; tPar += hole.par
      if (hole.hole_number <= 9) { fPlayed++; t1F += t1Best; t2F += t2Best; fPar += hole.par }
      else { bPlayed++; t1B += t1Best; t2B += t2Best; bPar += hole.par }
      if (t1Best < t2Best) { t1Wins++; if (hole.hole_number <= 9) t1FW++; else t1BW++ }
      else if (t1Best > t2Best) { t2Wins++; if (hole.hole_number <= 9) t2FW++; else t2BW++ }
    }
  }
  return {
    holesPlayed: tPlayed,
    t1Wins, t2Wins,
    t1FrontWins: t1FW, t2FrontWins: t2FW, t1BackWins: t1BW, t2BackWins: t2BW,
    t1Front: fPlayed > 0 ? t1F - fPar : null, t2Front: fPlayed > 0 ? t2F - fPar : null,
    t1Back: bPlayed > 0 ? t1B - bPar : null, t2Back: bPlayed > 0 ? t2B - bPar : null,
    t1Total: tPlayed > 0 ? t1T - tPar : null, t2Total: tPlayed > 0 ? t2T - tPar : null,
  }
}

function slH2H(a: number | null, b: number | null): 'p1' | 'p2' | 'tie' | null {
  if (a === null || b === null) return null
  return a < b ? 'p1' : b < a ? 'p2' : 'tie'
}
function slBB(a: number | null, b: number | null): 't1' | 't2' | 'tie' | null {
  if (a === null || b === null) return null
  return a < b ? 't1' : b < a ? 't2' : 'tie'
}

function minimizeSettlements(
  players: { id: string; name: string }[],
  net: Record<string, number>
): { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] {
  const pw = players.map((p) => ({ id: p.id, name: p.name, bal: Math.round((net[p.id] ?? 0) * 100) / 100 }))
    .filter((b) => b.bal > 0.005).sort((a, b) => b.bal - a.bal).map((b) => ({ ...b }))
  const nw = players.map((p) => ({ id: p.id, name: p.name, bal: Math.round((net[p.id] ?? 0) * 100) / 100 }))
    .filter((b) => b.bal < -0.005).sort((a, b) => a.bal - b.bal).map((b) => ({ ...b }))
  const out: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []
  let wi = 0, li = 0
  while (wi < pw.length && li < nw.length) {
    const amount = Math.round(Math.min(pw[wi].bal, -nw[li].bal) * 100) / 100
    if (amount > 0) out.push({ fromId: nw[li].id, fromName: nw[li].name, toId: pw[wi].id, toName: pw[wi].name, amount })
    pw[wi].bal = Math.round((pw[wi].bal - amount) * 100) / 100
    nw[li].bal = Math.round((nw[li].bal + amount) * 100) / 100
    if (pw[wi].bal <= 0.005) wi++
    if (nw[li].bal >= -0.005) li++
  }
  return out
}

function computePressResult(
  p1Id: string, p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[],
  press: PressEntry
): { p1Wins: boolean; p2Wins: boolean; holesComplete: boolean } {
  const pressHoles = holes.filter(h => h.hole_number >= press.holeStart && h.hole_number <= press.holeEnd)
  if (pressHoles.length === 0) return { p1Wins: false, p2Wins: false, holesComplete: false }
  let p1Sum = 0, p2Sum = 0, parSum = 0, played = 0
  for (const h of pressHoles) {
    const s1 = scoreMap[p1Id]?.[h.hole_number] ?? null
    const s2 = scoreMap[p2Id]?.[h.hole_number] ?? null
    if (s1 === null || s2 === null) continue
    p1Sum += s1; p2Sum += s2; parSum += h.par; played++
  }
  const holesComplete = played === pressHoles.length
  if (!holesComplete || played === 0) return { p1Wins: false, p2Wins: false, holesComplete }
  const strokes = press.strokes ?? 0
  const adjP1 = (p1Sum - parSum) - (press.strokesSide === 'p1' ? strokes : 0)
  const adjP2 = (p2Sum - parSum) - (press.strokesSide === 'p2' ? strokes : 0)
  return { p1Wins: adjP1 < adjP2, p2Wins: adjP2 < adjP1, holesComplete }
}

function computeAdminMatchupPayouts(
  matchups: SavedMatchup[],
  bestBallMatchups: BestBallMatchup[],
  players: { id: string; name: string }[],
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[]
): { rows: MatchupPayoutRow[]; net: Record<string, number>; involvedIds: Set<string> } {
  const net: Record<string, number> = {}
  for (const p of players) net[p.id] = 0
  const rows: MatchupPayoutRow[] = []
  const involvedIds = new Set<string>()

  for (const m of matchups) {
    const mp1 = players.find((p) => p.id === m.player1_id)
    const mp2 = players.find((p) => p.id === m.player2_id)
    if (!mp1 || !mp2) continue
    involvedIds.add(m.player1_id); involvedIds.add(m.player2_id)
    const { betType, scoringType, sweepAmount, handicapSide, handicapFront, handicapBack, handicapTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseMatchupBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)
    if (!hasBet) {
      rows.push({ id: m.id, type: 'h2h', label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }
    const stats = computeH2HStats(m.player1_id, m.player2_id, scoreMap, holes)
    const hole9 = scoreMap[m.player1_id]?.[9] != null && scoreMap[m.player2_id]?.[9] != null
    const hole18 = scoreMap[m.player1_id]?.[18] != null && scoreMap[m.player2_id]?.[18] != null
    const p1 = m.player1_id, p2 = m.player2_id
    // Stroke handicap adjustments (stroke play only)
    const hf = scoringType === 'stroke' ? (parseFloat(handicapFront) || 0) : 0
    const hb = scoringType === 'stroke' ? (parseFloat(handicapBack) || 0) : 0
    const ht = scoringType === 'stroke' ? (parseFloat(handicapTotal) || 0) : 0
    const adjP1Front = stats.p1Front !== null ? stats.p1Front - (handicapSide === 'p1' ? hf : 0) : null
    const adjP2Front = stats.p2Front !== null ? stats.p2Front - (handicapSide === 'p2' ? hf : 0) : null
    const adjP1Back  = stats.p1Back  !== null ? stats.p1Back  - (handicapSide === 'p1' ? hb : 0) : null
    const adjP2Back  = stats.p2Back  !== null ? stats.p2Back  - (handicapSide === 'p2' ? hb : 0) : null
    const adjP1Total = stats.p1Total !== null ? stats.p1Total - (handicapSide === 'p1' ? ht : 0) : null
    const adjP2Total = stats.p2Total !== null ? stats.p2Total - (handicapSide === 'p2' ? ht : 0) : null
    const resolveH2H = (settled: boolean, sl: 'p1' | 'p2' | 'tie' | null, mpDiff: number, amt: number): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const p1w = scoringType === 'match' ? mpDiff > 0 : sl === 'p1'
      const p2w = scoringType === 'match' ? mpDiff < 0 : sl === 'p2'
      if (p1w) { net[p1] = (net[p1] ?? 0) + amt; net[p2] = (net[p2] ?? 0) - amt; return { winnerLabel: mp1.name, tied: false } }
      if (p2w) { net[p2] = (net[p2] ?? 0) + amt; net[p1] = (net[p1] ?? 0) - amt; return { winnerLabel: mp2.name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segments: MatchupPayoutSegment[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.p1Front !== null && stats.p2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveH2H(fS, slH2H(adjP1Front, adjP2Front), stats.p1FrontWins - stats.p2FrontWins, fBetAmt)
      segments.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: false })
      const bS = hole18 && stats.p1Back !== null && stats.p2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveH2H(bS, slH2H(adjP1Back, adjP2Back), stats.p1BackWins - stats.p2BackWins, bBetAmt)
      segments.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: false })
    }
    const tS = hole18 && stats.p1Total !== null && stats.p2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveH2H(tS, slH2H(adjP1Total, adjP2Total), stats.p1Wins - stats.p2Wins, tBetAmt)
    segments.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: false })
    let nassauResult: MatchupPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const p1Net = segments.reduce((sum, s) => {
        if (!s.settled || s.tied || s.winnerLabel === null) return sum
        return sum + (s.winnerLabel === mp1.name ? s.amount : -s.amount)
      }, 0)
      nassauResult = { winnerLabel: p1Net > 0 ? mp1.name : p1Net < 0 ? mp2.name : null, amount: Math.abs(p1Net), perPlayer: false, anySettled: segments.some((s) => s.settled) }
      // Sweep: if all 3 segments settled and same winner, replace net with sweepAmt
      const sweepAmt = parseFloat(sweepAmount)
      if (!isNaN(sweepAmt) && sweepAmt > 0 && segments.length === 3) {
        const [fSeg, bSeg, tSeg] = segments
        if (fSeg.settled && bSeg.settled && tSeg.settled) {
          const p1Swept = fSeg.winnerLabel === mp1.name && bSeg.winnerLabel === mp1.name && tSeg.winnerLabel === mp1.name
          const p2Swept = fSeg.winnerLabel === mp2.name && bSeg.winnerLabel === mp2.name && tSeg.winnerLabel === mp2.name
          if (p1Swept || p2Swept) {
            const winner = p1Swept ? p1 : p2
            const loser = p1Swept ? p2 : p1
            const normalTotal = fBetAmt + bBetAmt + tBetAmt
            const adj = sweepAmt - normalTotal
            net[winner] = (net[winner] ?? 0) + adj
            net[loser] = (net[loser] ?? 0) - adj
            nassauResult = { ...nassauResult, amount: sweepAmt, swept: true }
          }
        }
      }
    }
    // ── Press bets ──────────────────────────────────────────────────────────
    for (const press of (m.press ?? [])) {
      const pressHoles = holes.filter(h => h.hole_number >= press.holeStart && h.hole_number <= press.holeEnd)
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
      if (adjP1 < adjP2) { net[p1] = (net[p1] ?? 0) + press.amount; net[p2] = (net[p2] ?? 0) - press.amount }
      else if (adjP2 < adjP1) { net[p2] = (net[p2] ?? 0) + press.amount; net[p1] = (net[p1] ?? 0) - press.amount }
    }
    rows.push({ id: m.id, type: 'h2h', label: `${mp1.name} vs ${mp2.name}`, betLabel: formatMatchupBet(m.bet), segments, nassauResult })
  }

  for (const m of bestBallMatchups) {
    const t1p1 = players.find((p) => p.id === m.team1_player1_id)
    const t1p2 = players.find((p) => p.id === m.team1_player2_id)
    const t2p1 = players.find((p) => p.id === m.team2_player1_id)
    const t2p2 = players.find((p) => p.id === m.team2_player2_id)
    if (!t1p1 || !t1p2 || !t2p1 || !t2p2) continue
    involvedIds.add(m.team1_player1_id); involvedIds.add(m.team1_player2_id)
    involvedIds.add(m.team2_player1_id); involvedIds.add(m.team2_player2_id)
    const { betType, scoringType, sweepAmount, handicapSide, handicapFront, handicapBack, handicapTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseMatchupBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)
    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`
    const t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`
    if (!hasBet) {
      rows.push({ id: m.id, type: 'bb', label: `${t1Name} vs ${t2Name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }
    const stats = computeBBStats(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
    const t1Ids = [m.team1_player1_id, m.team1_player2_id]
    const t2Ids = [m.team2_player1_id, m.team2_player2_id]
    const hole9 = t1Ids.some((id) => scoreMap[id]?.[9] != null) && t2Ids.some((id) => scoreMap[id]?.[9] != null)
    const hole18 = t1Ids.some((id) => scoreMap[id]?.[18] != null) && t2Ids.some((id) => scoreMap[id]?.[18] != null)
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
    const resolveBB = (settled: boolean, sl: 't1' | 't2' | 'tie' | null, mpDiff: number, amt: number): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const t1w = scoringType === 'match' ? mpDiff > 0 : sl === 't1'
      const t2w = scoringType === 'match' ? mpDiff < 0 : sl === 't2'
      if (t1w) { for (const id of t1Ids) net[id] = (net[id] ?? 0) + amt; for (const id of t2Ids) net[id] = (net[id] ?? 0) - amt; return { winnerLabel: t1Name, tied: false } }
      if (t2w) { for (const id of t2Ids) net[id] = (net[id] ?? 0) + amt; for (const id of t1Ids) net[id] = (net[id] ?? 0) - amt; return { winnerLabel: t2Name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segments: MatchupPayoutSegment[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.t1Front !== null && stats.t2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveBB(fS, slBB(adjT1Front, adjT2Front), stats.t1FrontWins - stats.t2FrontWins, fBetAmt)
      segments.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: true })
      const bS = hole18 && stats.t1Back !== null && stats.t2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveBB(bS, slBB(adjT1Back, adjT2Back), stats.t1BackWins - stats.t2BackWins, bBetAmt)
      segments.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: true })
    }
    const tS = hole18 && stats.t1Total !== null && stats.t2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveBB(tS, slBB(adjT1Total, adjT2Total), stats.t1Wins - stats.t2Wins, tBetAmt)
    segments.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: true })
    let nassauResultBB: MatchupPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const t1Net = segments.reduce((sum, s) => {
        if (!s.settled || s.tied || s.winnerLabel === null) return sum
        return sum + (s.winnerLabel === t1Name ? s.amount : -s.amount)
      }, 0)
      nassauResultBB = { winnerLabel: t1Net > 0 ? t1Name : t1Net < 0 ? t2Name : null, amount: Math.abs(t1Net), perPlayer: true, anySettled: segments.some((s) => s.settled) }
      // Sweep: if all 3 segments settled and same winner, replace net with sweepAmt
      const sweepAmt = parseFloat(sweepAmount)
      if (!isNaN(sweepAmt) && sweepAmt > 0 && segments.length === 3) {
        const [fSeg, bSeg, tSeg] = segments
        if (fSeg.settled && bSeg.settled && tSeg.settled) {
          const t1Swept = fSeg.winnerLabel === t1Name && bSeg.winnerLabel === t1Name && tSeg.winnerLabel === t1Name
          const t2Swept = fSeg.winnerLabel === t2Name && bSeg.winnerLabel === t2Name && tSeg.winnerLabel === t2Name
          if (t1Swept || t2Swept) {
            const winIds = t1Swept ? t1Ids : t2Ids
            const loseIds = t1Swept ? t2Ids : t1Ids
            const normalTotal = fBetAmt + bBetAmt + tBetAmt
            const adj = sweepAmt - normalTotal
            for (const id of winIds) net[id] = (net[id] ?? 0) + adj
            for (const id of loseIds) net[id] = (net[id] ?? 0) - adj
            nassauResultBB = { ...nassauResultBB, amount: sweepAmt, swept: true }
          }
        }
      }
    }
    rows.push({ id: m.id, type: 'bb', label: `${t1Name} vs ${t2Name}`, betLabel: formatMatchupBet(m.bet), segments, nassauResult: nassauResultBB })
  }

  return { rows, net, involvedIds }
}

export default function AdminDashboard({
  orgSlug, orgId, orgName, isMaster = false,
  round, teams, players, holes, ballValues, scores, scorecardTeamId = null, dtAssignments = [],
  matchups = [], bestBallMatchups = [], initialHoleValues = {}, courses = [],
  playingGroups = [], playingGroupPlayers = [], roster = [], hammerMatchups = [],
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster?: boolean
  round: Round; teams: Team[]; players: Player[]; holes: Hole[]; ballValues: BallValue[]; scores: Score[]; scorecardTeamId?: string | null; dtAssignments?: DaytonaHoleAssignment[]
  matchups?: SavedMatchup[]; bestBallMatchups?: BestBallMatchup[]; initialHoleValues?: Record<string, Record<number, number>>
  courses?: { name: string; slug: string; pars: number[] }[]
  playingGroups?: PlayingGroup[]
  playingGroupPlayers?: PlayingGroupPlayer[]
  roster?: RosterPlayer[]
  hammerMatchups?: HammerMatchup[]
}) {
  const router = useRouter()
  const [showPinModal, setShowPinModal] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [renamingTeam, setRenamingTeam] = useState<string | null>(null)
  const [renamingPlayer, setRenamingPlayer] = useState<string | null>(null)
  const [editingHandicapId, setEditingHandicapId] = useState<string | null>(null)
  const [handicapDraft, setHandicapDraft] = useState('')
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [confirmRemoveTeamId, setConfirmRemoveTeamId] = useState<string | null>(null)
  const [confirmRemoveRosterId, setConfirmRemoveRosterId] = useState<string | null>(null)
  const [showAddRosterForm, setShowAddRosterForm] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPin, setEditPin] = useState('')
  const [editDaytonaEnabled, setEditDaytonaEnabled] = useState(false)
  const [editDaytonaType, setEditDaytonaType] = useState('')
  const [editDaytonaSubVariant, setEditDaytonaSubVariant] = useState('')
  const [editDaytonaPayout, setEditDaytonaPayout] = useState('')
  const [selectedCourse, setSelectedCourse] = useState('')
  const [selectedFormat, setSelectedFormat] = useState('')
  const [showNewRoundForm, setShowNewRoundForm] = useState(!round)
  const [showNewRoundWarning, setShowNewRoundWarning] = useState(false)
  const [showCreateConfirm, setShowCreateConfirm] = useState(false)
  const createFormRef = useRef<HTMLFormElement>(null)
  const [selectedBallsCount, setSelectedBallsCount] = useState('3')
  const [createIncludeTotal, setCreateIncludeTotal] = useState(false)
  const [selectedHoleCount, setSelectedHoleCount] = useState('18')
  const [selectedStartHole, setSelectedStartHole] = useState('1')
  const [showDaytonaResults, setShowDaytonaResults] = useState(false)
  const [showMatchupResults, setShowMatchupResults] = useState(false)
  const [showSkinsResults, setShowSkinsResults] = useState(false)
  const [showSkinsParticipants, setShowSkinsParticipants] = useState(false)
  const [showSkinsNetPositions, setShowSkinsNetPositions] = useState(false)
  const [showMatchupNetPositions, setShowMatchupNetPositions] = useState(false)
  const [showDaytonaSettlements, setShowDaytonaSettlements] = useState(false)
  const [showMatchupSettlements, setShowMatchupSettlements] = useState(false)
  const [showSkinsSettlements, setShowSkinsSettlements] = useState(false)
  const [newRoundName, setNewRoundName] = useState('')
  const [newRoundDate, setNewRoundDate] = useState('')
  const [valueSaved, setValueSaved] = useState(false)
  const [showStartTooltip, setShowStartTooltip] = useState(false)
  const [showAddTeamForm, setShowAddTeamForm] = useState(false)
  const [skinsSaved, setSkinsSaved] = useState(false)
  const [payoutSaved, setPayoutSaved] = useState(false)
  const [teamsSaved, setTeamsSaved] = useState(false)
  const [showActivateTooltip, setShowActivateTooltip] = useState(false)
  const [resetConfirmTeamId, setResetConfirmTeamId] = useState<string | null>(null)
  const [showSkinsSuccess, setShowSkinsSuccess] = useState(false)
  const [showBallSuccess, setShowBallSuccess] = useState(false)
  const [showAddTeamSuccess, setShowAddTeamSuccess] = useState(false)
  const [newTeamDaytonaType, setNewTeamDaytonaType] = useState('')
  const [newTeamSubVariant, setNewTeamSubVariant] = useState('')
  const [newTeamDaytonaEnabled, setNewTeamDaytonaEnabled] = useState(false)
  const [newTeamDaytonaPayout, setNewTeamDaytonaPayout] = useState('')
  const [newTeamBankerEnabled, setNewTeamBankerEnabled] = useState(false)
  const [newTeamBankerMinBet, setNewTeamBankerMinBet] = useState('2')
  const [editBankerEnabled, setEditBankerEnabled] = useState(false)
  const [editBankerMinBet, setEditBankerMinBet] = useState('2')
  // Roster state
  const [liveRoster, setLiveRoster] = useState<RosterPlayer[]>(roster)
  const [showRoster, setShowRoster] = useState(false)
  const [editingRosterId, setEditingRosterId] = useState<string | null>(null)
  const [rosterForm, setRosterForm] = useState({ name: '', ghin: '', handicap: '', email: '' })
  const [rosterPending, setRosterPending] = useState(false)
  const [rosterError, setRosterError] = useState('')
  const [rosterPickerTeamId, setRosterPickerTeamId] = useState<string | null>(null)
  const [rosterSearch, setRosterSearch] = useState('')

  // Team Generator state
  const [showTeamGenerator, setShowTeamGenerator] = useState(false)
  const [genSelectedRosterIds, setGenSelectedRosterIds] = useState<Set<string>>(new Set())
  const [genManualPlayers, setGenManualPlayers] = useState<{ tempId: string; name: string; handicap: string }[]>([])
  const [genManualName, setGenManualName] = useState('')
  const [genManualHcp, setGenManualHcp] = useState('')
  const [genNumTeams, setGenNumTeams] = useState('2')
  const [generatedTeams, setGeneratedTeams] = useState<GeneratedTeam[] | null>(null)
  const [genEditNames, setGenEditNames] = useState<string[]>([])
  const [genEditPins, setGenEditPins] = useState<string[]>([])
  const [genPending, setGenPending] = useState(false)
  const [genError, setGenError] = useState('')
  const [confirmGenUse, setConfirmGenUse] = useState(false)
  const [genRosterSearch, setGenRosterSearch] = useState('')

  const [liveHammerMatchups, setLiveHammerMatchups] = useState<HammerMatchup[]>(hammerMatchups)
  const [newHammerTeam1, setNewHammerTeam1] = useState('')
  const [newHammerTeam2, setNewHammerTeam2] = useState('')
  const [newHammerBet, setNewHammerBet] = useState('1')
  const [newHammerAutoHcp, setNewHammerAutoHcp] = useState(false)
  const [hammerPending, setHammerPending] = useState(false)
  const [hammerError, setHammerError] = useState('')

  const [bankerMinBetInput, setBankerMinBetInput] = useState('2')
  const [autoHandicap, setAutoHandicap] = useState(round?.auto_handicap ?? false)
  const [mixedGroups, setMixedGroups] = useState(round?.mixed_groups ?? false)
  const [livePlayingGroups, setLivePlayingGroups] = useState<PlayingGroup[]>(playingGroups)
  const [liveGroupPlayers, setLiveGroupPlayers] = useState<PlayingGroupPlayer[]>(playingGroupPlayers)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupPin, setNewGroupPin] = useState('')
  const [newGroupPending, setNewGroupPending] = useState(false)
  const [showNewGroupPin, setShowNewGroupPin] = useState(false)
  const [groupError, setGroupError] = useState('')

  const [createState, createAction, createPending] = useActionState(createRound, null)
  const [addTeamState, addTeamAction, addTeamPending] = useActionState(addTeam, null)
  const [addPlayerState, addPlayerAction, addPlayerPending] = useActionState(addPlayer, null)
  const [parState, parAction, parPending] = useActionState(updateHolePars, null)
  const [ballState, ballAction, ballPending] = useActionState(updateBallValues, null)
  const [renameState, renameAction, renamePending] = useActionState(renameTeam, null)
  const [renamePlayerState, renamePlayerAction, renamePlayerPending] = useActionState(renamePlayer, null)
  const [updateTeamState, updateTeamAction, updateTeamPending] = useActionState(updateTeamSettings, null)
  const [skinsState, skinsAction, skinsPending] = useActionState(updateSkinsSettings, null)

  const roundIsSettingUp = !!(round && !round.is_started)
  const effectivePendingId = null
  const isSettingUp = roundIsSettingUp || createPending

  useEffect(() => {
    if ((createState as { success?: boolean } | null)?.success) {
      window.location.href = `/${orgSlug}/admin/dashboard`
    }
  }, [createState, orgSlug])
  useEffect(() => {
    if (addTeamState?.success) {
      router.refresh()
      setNewTeamDaytonaType('')
      setNewTeamSubVariant('')
      setNewTeamDaytonaEnabled(false)
      setNewTeamDaytonaPayout('')
      setNewTeamBankerEnabled(false)
      setNewTeamBankerMinBet('2')
      setShowAddTeamForm(false)
      setShowAddTeamSuccess(true)
      const t = setTimeout(() => setShowAddTeamSuccess(false), 5000)
      return () => clearTimeout(t)
    }
  }, [addTeamState])
  useEffect(() => {
    if (addPlayerState?.success) router.refresh()
  }, [addPlayerState])
  useEffect(() => {
    if (renameState?.success) { router.refresh(); setRenamingTeam(null) }
  }, [renameState])
  useEffect(() => {
    if (updateTeamState?.success) { router.refresh(); setEditingTeamId(null) }
  }, [updateTeamState])
  useEffect(() => {
    if (renamePlayerState?.success) { router.refresh(); setRenamingPlayer(null) }
  }, [renamePlayerState])
  useEffect(() => {
    if (parState?.success) router.refresh()
  }, [parState])
  useEffect(() => {
    if (ballState?.success) {
      router.refresh()
      setPayoutSaved(true)
      setShowBallSuccess(true)
    }
  }, [ballState])
  useEffect(() => {
    if (skinsState?.success) {
      router.refresh()
      setSkinsSaved(true)
      setShowSkinsSuccess(true)
    }
  }, [skinsState])

  // When the active round changes (new round created + router.refresh() delivers new props),
  // sync local UI state so skins/ball values always reflect what's in the DB for the new round.
  useEffect(() => {
    setSkinsEnabled(round && !round.is_started ? null : (round?.skins_enabled ?? false))
    setSkinsAmount(round?.skins_amount ?? 0)
    setBallVals(
      ballValues.length > 0
        ? Object.fromEntries(ballValues.map((bv) => [bv.ball_number, bv.value_dollars]))
        : { 1: 0 }
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id])

  useEffect(() => {
    setValueSaved(false)
    if (!selectedFormat) return  // No format selected yet — don't auto-reset ball values
    if (selectedFormat !== 'daytona') {
      // If the stored value looks like a Daytona per-point amount (< $1), reset to the $5 standard default
      setBallVals((prev) => {
        const cur = prev[1] ?? 0
        return cur < 1 ? { ...prev, 1: 5 } : prev
      })
    } else {
      // If the stored value looks like a Standard per-ball amount (>= $1), reset to the $0.25 daytona default
      setBallVals((prev) => {
        const cur = prev[1] ?? 0
        return cur >= 1 ? { ...prev, 1: 0.25 } : prev
      })
    }
  }, [selectedFormat])

  const [liveHoleValues, setLiveHoleValues] = useState<Record<string, Record<number, number>>>(initialHoleValues)

  // Sync live state when server props refresh (router.refresh triggers re-render with new props)
  useEffect(() => { setLiveMatchups(matchups) }, [matchups])
  useEffect(() => { setLiveBestBallMatchups(bestBallMatchups) }, [bestBallMatchups])
  useEffect(() => { setLiveScores(scores) }, [scores])
  useEffect(() => { setLiveHoleValues(initialHoleValues) }, [initialHoleValues])


  // Real-time subscriptions — auto-recalculate settlements on any matchup or score change
  useEffect(() => {
    if (!round?.id) return
    const rid = round.id
    const playerIds = players.map((p) => p.id)

    const ch1 = supabase.channel('admin-live-matchups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchups' }, async () => {
        const { data } = await supabase.from('matchups').select('id, player1_id, player2_id, bet, press').eq('round_id', rid).order('created_at')
        if (data) setLiveMatchups(data)
      }).subscribe()

    const ch2 = supabase.channel('admin-live-bestball')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'best_ball_matchups' }, async () => {
        const { data } = await supabase.from('best_ball_matchups')
          .select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet')
          .eq('round_id', rid).order('created_at')
        if (data) setLiveBestBallMatchups(data)
      }).subscribe()

    const ch3 = supabase.channel('admin-live-scores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        if (!playerIds.length) return
        const { data } = await supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds)
        if (data) setLiveScores(data)
      }).subscribe()

    const ch4 = supabase.channel('admin-score-updates')
      .on('broadcast', { event: 'refresh' }, async () => {
        if (!playerIds.length) return
        const [scoresRes, hvRes] = await Promise.all([
          supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds),
          supabase.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', rid),
        ])
        if (scoresRes.data) setLiveScores(scoresRes.data)
        if (hvRes.data) {
          const map: Record<string, Record<number, number>> = {}
          for (const hv of hvRes.data as { team_id: string; hole_number: number; value_per_point: number }[]) {
            if (!map[hv.team_id]) map[hv.team_id] = {}
            map[hv.team_id][hv.hole_number] = hv.value_per_point
          }
          setLiveHoleValues(map)
        }
      }).subscribe()

    return () => {
      supabase.removeChannel(ch1)
      supabase.removeChannel(ch2)
      supabase.removeChannel(ch3)
      supabase.removeChannel(ch4)
    }
  }, [round?.id])

  const [pars, setPars] = useState<Record<number, number>>(
    Object.fromEntries(holes.map((h) => [h.hole_number, h.par]))
  )
  const [ballVals, setBallVals] = useState<Record<number, number>>(
    Object.fromEntries(ballValues.map((bv) => [bv.ball_number, bv.value_dollars]))
  )
  const [skinsEnabled, setSkinsEnabled] = useState<boolean | null>(
    round && !round.is_started ? null : (round?.skins_enabled ?? false)
  )
  const [skinsAmount, setSkinsAmount] = useState(round?.skins_amount ?? 0)

  // Live state — kept in sync with server props and updated by real-time subscriptions
  const [liveMatchups, setLiveMatchups] = useState(matchups)
  const [liveBestBallMatchups, setLiveBestBallMatchups] = useState(bestBallMatchups)
  const [liveScores, setLiveScores] = useState(scores)

  const parTotal = Object.values(pars).reduce((a, b) => a + b, 0)
  const ballsCount = round?.balls_count ?? 3
  const isDaytona = round?.format === 'daytona'
  const isTraditional = round?.format === 'traditional'
  const isStandard = round?.format === 'standard'
  const roundHoleCount = holes.length  // 9 or 18
  const roundStartHole = holes.length > 0 ? holes[0].hole_number : 1
  const is9HoleRound = (isDaytona || isTraditional) && roundHoleCount === 9
  const roundIncludeTotal = round?.include_total ?? false
  const numSegments = roundIncludeTotal ? 3 : 2          // Front + Back [+ Total]
  const isComplete = players.length > 0 && holes.length > 0 && players.every((p) => liveScores.filter((s) => s.player_id === p.id).length === holes.length)

  // Standard ball payouts
  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)
  const frontSummaries = !isDaytona ? new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(frontHoles, tp.map((p) => p.id), liveScores, ballsCount)]
  })) : new Map()
  const backSummaries = !isDaytona ? new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(backHoles, tp.map((p) => p.id), liveScores, ballsCount)]
  })) : new Map()
  const totalSummaries = (!isDaytona && roundIncludeTotal) ? new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(holes, tp.map((p) => p.id), liveScores, ballsCount)]
  })) : undefined

  const perBallValue = ballVals[1] ?? 5
  const emptyPoolResult: ReturnType<typeof calculatePoolPayouts> = { results: [] as BallHalfResult[], playerNet: {} as Record<string, number>, potTotal: 0, perBallResult: 0, perPlayerContribution: 0, numDecidedResults: 0, settlements: [] }
  const poolResults = !isDaytona
    ? calculatePoolPayouts(teams, players, frontSummaries, backSummaries, perBallValue, ballsCount, totalSummaries)
    : emptyPoolResult
  const ballResults = poolResults.results

  // Daytona Left/Right summaries per team
  const dtSummaries = isDaytona
    ? new Map(teams.map((team) => {
        const teamPlayerIds = players.filter((p) => p.team_id === team.id).map((p) => p.id)
        const teamAssignments = dtAssignments.filter((a) => teamPlayerIds.includes(a.player_id))
        return [team.id, computeDaytonaSidesSummary(holes, liveScores, teamAssignments)]
      }))
    : new Map()
  const dtPayoutValue = ballVals[1] ?? 0

  const scoreMap = useMemo(() => {
    const m: Record<string, Record<number, number>> = {}
    for (const s of liveScores) {
      if (!m[s.player_id]) m[s.player_id] = {}
      m[s.player_id][s.hole_number] = s.strokes
    }
    return m
  }, [liveScores])

  const matchupData = useMemo(
    () => computeAdminMatchupPayouts(liveMatchups, liveBestBallMatchups, players, scoreMap, holes),
    [liveMatchups, liveBestBallMatchups, players, scoreMap, holes]
  )

  // Skins — declared before combinedDaytonaNet / combinedStandardNet which consume playerNet
  const skinsParticipants = useMemo(() => players.filter((p) => p.skins_participant), [players])
  const skinsResults = useMemo(
    () => skinsEnabled && skinsParticipants.length > 0
      ? computeSkinsResults(holes, liveScores, skinsParticipants, skinsAmount)
      : { skins: [] as SkinResult[], playerNet: {} as Record<string, number>, skinsWon: 0, settlements: [] },
    [skinsEnabled, skinsParticipants, holes, liveScores, skinsAmount]
  )

  const combinedDaytonaNet = useMemo(() => {
    if (!isDaytona) return {}
    const allNet: Record<string, number> = {}
    for (const team of teams) {
      const tp = players.filter((p) => p.team_id === team.id)
      const tpIds = tp.map((p) => p.id)
      const tAssign = dtAssignments.filter((a) => tpIds.includes(a.player_id))
      const tScores = liveScores.filter((s) => tpIds.includes(s.player_id))
      const tHoleVals = liveHoleValues[team.id] ?? {}
      const dollarTotals = computePlayerDaytonaDollars(holes, tScores, tAssign, team.daytona_variant ?? round?.daytona_variant ?? '4man', dtPayoutValue, tHoleVals)
      const { net: pNet } = settleDaytonaPlayerPoints(tp, dollarTotals, 1)
      for (const [id, amt] of Object.entries(pNet)) allNet[id] = (allNet[id] ?? 0) + amt
    }
    for (const p of players) {
      allNet[p.id] = (allNet[p.id] ?? 0) + (matchupData.net[p.id] ?? 0) + (skinsResults.playerNet[p.id] ?? 0)
    }
    return allNet
  }, [isDaytona, teams, players, dtAssignments, liveScores, holes, dtPayoutValue, liveHoleValues, matchupData, round, skinsResults])

  const combinedSettlements = useMemo(
    () => minimizeSettlements(players, combinedDaytonaNet),
    [players, combinedDaytonaNet]
  )

  const combinedStandardNet = useMemo(() => {
    if (isDaytona) return {} as Record<string, number>
    const net: Record<string, number> = {}
    for (const p of players) {
      net[p.id] = (poolResults.playerNet[p.id] ?? 0) + (matchupData.net[p.id] ?? 0) + (skinsResults.playerNet[p.id] ?? 0)
    }
    return net
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDaytona, players, poolResults.playerNet, matchupData.net, skinsResults.playerNet])

  const combinedStandardSettlements = useMemo(
    () => (!isDaytona ? minimizeSettlements(players, combinedStandardNet) : []),
    [isDaytona, players, combinedStandardNet]
  )

  const matchupOnlySettlements = useMemo(
    () => minimizeSettlements(players, matchupData.net),
    [players, matchupData.net]
  )

  async function handleDeleteTeam(teamId: string) {
    await deleteTeam(teamId)
    router.refresh()
  }

  function handleGenerateTeams() {
    const numTeams = parseInt(genNumTeams, 10)
    if (isNaN(numTeams) || numTeams < 2) { setGenError('Enter at least 2 teams.'); return }

    const rosterPlayers: GeneratedPlayer[] = liveRoster
      .filter(rp => genSelectedRosterIds.has(rp.id))
      .map(rp => ({ id: rp.id, name: rp.name, handicap: rp.handicap_index ?? null, source: 'roster' as const }))

    const manualPlayersConverted: GeneratedPlayer[] = genManualPlayers.map(p => ({
      id: p.tempId, name: p.name,
      handicap: p.handicap !== '' ? parseFloat(p.handicap) : null,
      source: 'manual' as const,
    }))

    const allPlayers = [...rosterPlayers, ...manualPlayersConverted]
    if (allPlayers.length < numTeams) {
      setGenError(`Need at least ${numTeams} players to fill ${numTeams} teams.`)
      return
    }

    setGenError('')
    setConfirmGenUse(false)
    const result = generateBalancedTeams(allPlayers, numTeams)
    setGeneratedTeams(result)
    setGenEditNames(result.map(t => t.name))
    setGenEditPins(result.map(t => t.pin))
  }

  async function handleUseGeneratedTeams() {
    if (!round || !generatedTeams) return
    setGenPending(true)
    setGenError('')
    const teamsToCreate = generatedTeams.map((t, i) => ({
      name: genEditNames[i] || t.name,
      pin: genEditPins[i] || t.pin,
      players: t.players.map(p => ({ name: p.name, handicap: p.handicap })),
    }))
    const result = await bulkCreateTeams(round.id, teamsToCreate)
    setGenPending(false)
    if (result.error) { setGenError(result.error); return }
    router.refresh()
    setShowTeamGenerator(false)
    setGeneratedTeams(null)
    setGenSelectedRosterIds(new Set())
    setGenManualPlayers([])
    setConfirmGenUse(false)
    setGenEditNames([])
    setGenEditPins([])
  }
  async function handleToggleAdmin(teamId: string, isAdmin: boolean) {
    await toggleTeamAdmin(teamId, isAdmin)
    router.refresh()
  }
  async function handleResetScores(teamId: string) {
    await resetTeamScores(teamId)
    router.refresh()
  }
  async function handleDeletePlayer(playerId: string) {
    await deletePlayer(playerId)
    router.refresh()
  }
  async function handleSaveRosterPlayer() {
    if (!rosterForm.name.trim()) { setRosterError('Name is required.'); return }
    setRosterError(''); setRosterPending(true)
    const hcp = (() => {
      const s = rosterForm.handicap.trim()
      if (!s) return null
      if (s.startsWith('+')) { const n = parseFloat(s.slice(1)); return isNaN(n) ? null : -n }
      const n = parseFloat(s); return isNaN(n) ? null : n
    })()
    if (editingRosterId) {
      const res = await updateRosterPlayer(editingRosterId, rosterForm.name, rosterForm.ghin || null, hcp, rosterForm.email || null)
      if (res.error) { setRosterError(res.error); setRosterPending(false); return }
      setLiveRoster((prev) => prev.map((p) => p.id === editingRosterId ? { ...p, name: rosterForm.name, ghin_number: rosterForm.ghin || null, handicap_index: hcp, email: rosterForm.email || null } : p))
      setEditingRosterId(null)
    } else {
      const res = await createRosterPlayer(orgId, rosterForm.name, rosterForm.ghin || null, hcp, rosterForm.email || null)
      if (res.error) { setRosterError(res.error); setRosterPending(false); return }
      setLiveRoster((prev) => [...prev, { id: res.id!, name: rosterForm.name, ghin_number: rosterForm.ghin || null, handicap_index: hcp, email: rosterForm.email || null }])
      setShowAddRosterForm(false)
    }
    setRosterForm({ name: '', ghin: '', handicap: '', email: '' }); setRosterPending(false)
  }
  async function handleDeleteRosterPlayer(id: string) {
    await deleteRosterPlayer(id)
    setLiveRoster((prev) => prev.filter((p) => p.id !== id))
  }
  async function handleAddFromRoster(teamId: string, rosterPlayerId: string) {
    const res = await addRosterPlayerToTeam(teamId, rosterPlayerId)
    if (res.error) { alert(res.error); return }
    setRosterPickerTeamId(null); router.refresh()
  }

  async function handleCreateHammerMatchup() {
    if (!round || !newHammerTeam1 || !newHammerTeam2 || newHammerTeam1 === newHammerTeam2) { setHammerError('Select two different teams.'); return }
    setHammerError(''); setHammerPending(true)
    const res = await createHammerMatchup(round.id, newHammerTeam1, newHammerTeam2, parseFloat(newHammerBet) || 1, newHammerAutoHcp)
    setHammerPending(false)
    if (res.error) { setHammerError(res.error); return }
    setLiveHammerMatchups((prev) => [...prev, { id: res.id!, team1_id: newHammerTeam1, team2_id: newHammerTeam2, base_bet: parseFloat(newHammerBet) || 1, auto_handicap: newHammerAutoHcp }])
    setNewHammerTeam1(''); setNewHammerTeam2(''); setNewHammerBet('1'); setNewHammerAutoHcp(false)
  }
  async function handleDeleteHammerMatchup(id: string) {
    await deleteHammerMatchup(id)
    setLiveHammerMatchups((prev) => prev.filter((m) => m.id !== id))
  }

  async function handleToggleMixedGroups() {
    if (!round) return
    const next = !mixedGroups
    setMixedGroups(next)
    await toggleMixedGroups(round.id, next)
    router.refresh()
  }
  async function handleCreateGroup() {
    if (!round || !newGroupName.trim() || !newGroupPin.trim()) return
    if (!/^\d{4}$/.test(newGroupPin)) { setGroupError('PIN must be exactly 4 digits.'); return }
    setGroupError(''); setNewGroupPending(true)
    const res = await createPlayingGroup(round.id, newGroupName.trim(), newGroupPin.trim())
    setNewGroupPending(false)
    if (res.error) { setGroupError(res.error); return }
    setLivePlayingGroups((prev) => [...prev, { id: res.id!, name: newGroupName.trim(), pin: newGroupPin.trim() }])
    setNewGroupName(''); setNewGroupPin('')
  }
  async function handleDeleteGroup(groupId: string) {
    await deletePlayingGroup(groupId)
    setLivePlayingGroups((prev) => prev.filter((g) => g.id !== groupId))
    setLiveGroupPlayers((prev) => prev.filter((gp) => gp.playing_group_id !== groupId))
  }
  async function handleSetPlayerGroup(playerId: string, groupId: string | null) {
    setLiveGroupPlayers((prev) => {
      const filtered = prev.filter((gp) => gp.player_id !== playerId)
      return groupId ? [...filtered, { playing_group_id: groupId, player_id: playerId }] : filtered
    })
    await setPlayerGroup(playerId, groupId)
  }

  async function handleToggleAutoHandicap() {
    if (!round) return
    const next = !autoHandicap
    setAutoHandicap(next)
    await updateRoundAutoHandicap(round.id, next)
    router.refresh()
  }

  async function handleUpdateHandicap(playerId: string) {
    const val = handicapDraft.trim()
    await updatePlayerHandicap(playerId, val === '' ? null : parseFloat(val))
    setEditingHandicapId(null)
    router.refresh()
  }
  async function handleToggleSkinsParticipant(playerId: string, current: boolean) {
    await updatePlayerSkinsParticipation(playerId, !current)
    router.refresh()
  }
  async function handleMovePlayer(playerId: string, direction: 'up' | 'down') {
    await movePlayer(playerId, direction)
    router.refresh()
  }

  function handleCourseChange(courseKey: string) {
    setSelectedCourse(courseKey)
    const presetPars = COURSE_PARS_CLIENT[courseKey]
    if (presetPars) {
      setPars(Object.fromEntries(presetPars.map((par, i) => [i + 1, par])))
    }
  }

  const startMissingItems: string[] = []
  if (!newRoundName.trim()) startMissingItems.push('Round Name')
  if (!newRoundDate) startMissingItems.push('Date')
  if (!selectedFormat) startMissingItems.push('Scoring Format')
  if (!selectedCourse) startMissingItems.push('Course')
  const canStartRound = startMissingItems.length === 0

  // ── Setup wizard lock states ──────────────────────────────────────────────
  // Only enforce locks during new-round setup (roundIsSettingUp). When live/complete,
  // everything is fully editable.
  const effectivePayoutSaved = payoutSaved || isTraditional   // Traditional has no payout step
  const skinsAndPayoutEnabled = !!(round?.is_started) || (roundIsSettingUp && !createPending && !effectivePendingId)
  const teamsAddEnabled = !!(round?.is_started) || (roundIsSettingUp && !createPending && !effectivePendingId && skinsSaved && effectivePayoutSaved)

  // ── Player count requirements per format ──────────────────────────────────
  // Daytona 4-Man: exactly 4 · Daytona 5-Man: exactly 5 (per group's own type)
  // Traditional: 2–5 players per group
  // 3/4-ball: ≥balls_count and ≤5 players per team
  const allTeamsMeetRequirement = teams.length > 0 && teams.every(team => {
    const count = players.filter(p => p.team_id === team.id).length
    if (isDaytona) {
      const teamVariant = team.daytona_variant ?? '4man'
      const required = teamVariant.startsWith('5man') ? 5 : 4
      return count === required
    }
    if (isTraditional) return count >= 2 && count <= 5
    return count >= (round?.balls_count ?? 3) && count <= 5
  })

  const canActivate = roundIsSettingUp && skinsSaved && effectivePayoutSaved && teamsSaved && allTeamsMeetRequirement
  const activateMissingItems: string[] = []
  if (roundIsSettingUp) {
    if (!skinsSaved) activateMissingItems.push('Save Skins Settings')
    if (!effectivePayoutSaved) activateMissingItems.push('Save Payout Value')
    if (!teamsSaved) activateMissingItems.push((isDaytona || isTraditional) ? 'Save Group(s)' : 'Save Teams')
    if (teamsSaved && !allTeamsMeetRequirement) {
      if (isDaytona) {
        activateMissingItems.push('Each group needs the correct number of players')
      } else if (isTraditional) {
        activateMissingItems.push('Each group needs 2–5 players')
      } else {
        activateMissingItems.push(`Each team needs at least ${round?.balls_count ?? 3} and no more than 5 players`)
      }
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>

      {/* ── Roster picker modal ── */}
      {rosterPickerTeamId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => { setRosterPickerTeamId(null); setRosterSearch('') }}>
          <div className="bg-white rounded-t-3xl w-full max-w-lg p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">Pick from Roster</h3>
              <button onClick={() => { setRosterPickerTeamId(null); setRosterSearch('') }} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <input value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)}
              placeholder="Search players…" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none mb-3" />
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {liveRoster
                .filter((rp) => rp.name.toLowerCase().includes(rosterSearch.toLowerCase()))
                .map((rp) => (
                  <button key={rp.id} type="button"
                    onClick={() => handleAddFromRoster(rosterPickerTeamId, rp.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-gray-100 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition text-left">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{rp.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {rp.handicap_index != null && <span className="text-xs text-gray-500">HCP {rp.handicap_index < 0 ? `+${Math.abs(rp.handicap_index)}` : rp.handicap_index}</span>}
                        {rp.ghin_number && <span className="text-xs font-mono text-blue-500">GHIN {rp.ghin_number}</span>}
                      </div>
                    </div>
                    <span className="text-blue-500 text-sm font-semibold">Add →</span>
                  </button>
                ))}
              {liveRoster.filter((rp) => rp.name.toLowerCase().includes(rosterSearch.toLowerCase())).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No players found</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New Round confirmation modal ── */}
      {showNewRoundWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            {/* Icon + heading */}
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 text-lg font-bold">!</div>
              <div>
                <h2 className="font-semibold text-gray-900 text-base leading-snug">End current round?</h2>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  Starting a new round will permanently close the current round. All scores, matchups, and settings for this round will be preserved in history, but it will no longer be active.
                </p>
              </div>
            </div>
            {/* Divider */}
            <div className="border-t border-gray-100" />
            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowNewRoundWarning(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewRoundWarning(false)
                  setNewRoundName('')
                  setNewRoundDate('')
                  setSelectedFormat('')
                  setSelectedCourse('')
                  setCreateIncludeTotal(false)
                  setShowNewRoundForm(true)
                  setSkinsSaved(false)
                  setPayoutSaved(false)
                  setTeamsSaved(false)
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                style={{ background: '#b91c1c' }}>
                Yes, Start New Round
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Create Round confirmation modal ── */}
      {showCreateConfirm && (() => {
        const courseLabels: Record<string, string> = {
          south: 'ACC South Course (Par 72)',
          north: 'ACC North Course (Par 71)',
          liveoak: 'Live Oak Golf Club (Par 71)',
          maxwell: 'Maxwell Golf Course (Par 71)',
          shadyoaks: 'Shady Oaks Golf Course (Par 70)',
          hideout: 'The Hideout Golf Club (Par 72)',
          canyonwest: 'Canyon West Golf Course (Par 72)',
        }
        const formatLabels: Record<string, string> = {
          standard: '3/4 Balls',
          daytona: 'Daytona',
          traditional: 'Traditional',
          banker: 'Banker',
        }
        const formattedDate = newRoundDate
          ? new Date(newRoundDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : '—'
        const rows: { label: string; value: string }[] = [
          { label: 'Round Name', value: newRoundName || '—' },
          { label: 'Date', value: formattedDate },
          { label: 'Format', value: formatLabels[selectedFormat] ?? selectedFormat },
          ...(selectedFormat === 'standard' ? [
            { label: 'Balls in Play', value: `${selectedBallsCount} Balls` },
            { label: 'Include Overall', value: createIncludeTotal ? 'Yes' : 'No' },
          ] : []),
          { label: 'Course', value: courseLabels[selectedCourse] ?? selectedCourse },
        ]
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
              <div>
                <h2 className="font-semibold text-gray-900 text-base">Confirm New Round</h2>
                <p className="text-xs text-gray-500 mt-0.5">Review your settings before creating.</p>
              </div>
              <div className="border-t border-gray-100" />
              <div className="space-y-2.5">
                {rows.map(({ label, value }) => (
                  <div key={label} className="flex items-start justify-between gap-3">
                    <span className="text-xs font-medium text-gray-500 flex-shrink-0">{label}</span>
                    <span className="text-xs text-gray-900 font-semibold text-right">{value}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100" />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                  Edit
                </button>
                <button
                  type="submit"
                  form="create-round-form"
                  disabled={createPending}
                  onClick={() => setShowCreateConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-60"
                  style={{ background: navy }}>
                  {createPending ? 'Creating…' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Reset Scores confirmation modal ── */}
      {resetConfirmTeamId && (() => {
        const teamName = teams.find(t => t.id === resetConfirmTeamId)?.name ?? 'this team'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-lg font-bold">!</div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-base leading-snug">Reset all scores?</h2>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    This will permanently delete all hole scores for <span className="font-semibold text-gray-800">{teamName}</span>. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-100" />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setResetConfirmTeamId(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setResetConfirmTeamId(null)
                    await handleResetScores(resetConfirmTeamId)
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                  style={{ background: '#ea580c' }}>
                  Yes, Reset Scores
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Remove Roster Player confirmation modal ── */}
      {confirmRemoveRosterId && (() => {
        const playerName = liveRoster.find(rp => rp.id === confirmRemoveRosterId)?.name ?? 'this player'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg font-bold">!</div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-base leading-snug">Remove from roster?</h2>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    This will permanently remove <span className="font-semibold text-gray-800">{playerName}</span> from your player roster. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-100" />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmRemoveRosterId(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const id = confirmRemoveRosterId
                    setConfirmRemoveRosterId(null)
                    await handleDeleteRosterPlayer(id)
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                  style={{ background: '#dc2626' }}>
                  Yes, Remove
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {showPinModal && <PinLoginModal teams={teams} onClose={() => setShowPinModal(false)} orgSlug={orgSlug} isGroup={isDaytona || isTraditional} />}
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Admin</p>
            <h1 className="font-bold text-lg">{orgName}</h1>
          </div>
          <div className="flex items-center gap-2">
            {scorecardTeamId ? (
              <a href={`/${orgSlug}/score/${scorecardTeamId}`}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ background: gold, color: navy }}>
                {isComplete ? 'Edit Scores' : 'Enter Scores'}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setShowPinModal(true)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ background: gold, color: navy }}>
                Enter Pin
              </button>
            )}
            {isMaster && (
              <a href="/master/dashboard" className="text-xs px-3 py-1.5 rounded-lg font-semibold border" style={{ borderColor: '#f59e0b', color: '#fbbf24' }}>← Master Admin</a>
            )}
            <a href={`/${orgSlug}`} className="text-xs px-3 py-1.5 rounded-lg border border-white/30 hover:bg-white/10 text-white">Leaderboard</a>
            <form action={adminLogout.bind(null, orgSlug, orgId)}>
              <button type="submit" className="text-xs px-3 py-1.5 rounded-lg border border-white/30 hover:bg-white/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-4">

        {/* No-round notice */}
        {!round && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-amber-800 font-medium text-sm">No active round. Use the form below to create one.</p>
          </div>
        )}

        {/* Admin Hub header */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Admin Hub</h2>

        {/* ── CONTENT ──────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* ── Player Roster ── */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <button type="button" onClick={() => setShowRoster((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-900 text-sm">Player Roster</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{liveRoster.length} players</span>
              </div>
              <span className="text-gray-400 text-sm">{showRoster ? '▲' : '▼'}</span>
            </button>

            {showRoster && (
              <div className="border-t border-gray-100 px-5 pb-5 space-y-4">

                {/* Add new roster player — top of section */}
                {editingRosterId === null && (
                  showAddRosterForm ? (
                    <div className="border border-dashed border-gray-200 rounded-xl p-3 space-y-2 mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add to Roster</p>
                        <button type="button" onClick={() => { setShowAddRosterForm(false); setRosterForm({ name: '', ghin: '', handicap: '', email: '' }); setRosterError('') }}
                          className="text-xs text-gray-400 hover:text-gray-600">✕ Cancel</button>
                      </div>
                      {rosterError && <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{rosterError}</p>}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 mb-0.5 block">Name <span className="text-red-400">*</span></label>
                          <input value={rosterForm.name} onChange={(e) => setRosterForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="Full name" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" autoFocus />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-0.5 block">Handicap Index</label>
                          <input type="text" value={rosterForm.handicap} onChange={(e) => setRosterForm((f) => ({ ...f, handicap: e.target.value }))}
                            placeholder="e.g. 8.4 or +2"
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-0.5 block">GHIN # <span className="text-gray-400 font-normal">(optional)</span></label>
                          <input value={rosterForm.ghin} onChange={(e) => setRosterForm((f) => ({ ...f, ghin: e.target.value }))}
                            placeholder="e.g. 1234567" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none font-mono" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-0.5 block">Email <span className="text-gray-400 font-normal">(optional)</span></label>
                          <input type="email" value={rosterForm.email} onChange={(e) => setRosterForm((f) => ({ ...f, email: e.target.value }))}
                            placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                        </div>
                      </div>
                      <button type="button" onClick={handleSaveRosterPlayer} disabled={rosterPending || !rosterForm.name.trim()}
                        className="w-full py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60 mt-1" style={{ background: navy }}>
                        {rosterPending ? 'Adding…' : '+ Add to Roster'}
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setShowAddRosterForm(true)}
                      className="w-full py-2 mt-3 rounded-xl text-sm font-semibold text-white transition"
                      style={{ background: navy }}>
                      Add Player +
                    </button>
                  )
                )}

                {/* Roster list */}
                {liveRoster.length > 0 && (
                  <div className="space-y-2">
                    {liveRoster.map((rp) => (
                      <div key={rp.id} className="bg-gray-50 rounded-xl border border-gray-100">
                        {editingRosterId === rp.id ? (
                          <div className="p-3 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500 mb-0.5 block">Name</label>
                                <input value={rosterForm.name} onChange={(e) => setRosterForm((f) => ({ ...f, name: e.target.value }))}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 mb-0.5 block">Handicap</label>
                                <input type="text" value={rosterForm.handicap} onChange={(e) => setRosterForm((f) => ({ ...f, handicap: e.target.value }))}
                                  placeholder="e.g. 8.4 or +2"
                                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 mb-0.5 block">GHIN #</label>
                                <input value={rosterForm.ghin} onChange={(e) => setRosterForm((f) => ({ ...f, ghin: e.target.value }))}
                                  placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none font-mono" />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 mb-0.5 block">Email</label>
                                <input type="email" value={rosterForm.email} onChange={(e) => setRosterForm((f) => ({ ...f, email: e.target.value }))}
                                  placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button type="button" onClick={handleSaveRosterPlayer} disabled={rosterPending}
                                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ background: navy }}>
                                {rosterPending ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" onClick={() => { setEditingRosterId(null); setRosterForm({ name: '', ghin: '', handicap: '', email: '' }) }}
                                className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-600">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800">{rp.name}</p>
                              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                {rp.handicap_index != null && (
                                  <span className="text-xs text-gray-500">HCP {rp.handicap_index < 0 ? `+${Math.abs(rp.handicap_index)}` : rp.handicap_index}</span>
                                )}
                                {rp.ghin_number && (
                                  <span className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">GHIN {rp.ghin_number}</span>
                                )}
                                {rp.email && (
                                  <span className="text-xs text-gray-400">{rp.email}</span>
                                )}
                              </div>
                            </div>
                            <button type="button" onClick={() => { setEditingRosterId(rp.id); setRosterForm({ name: rp.name, ghin: rp.ghin_number ?? '', handicap: rp.handicap_index != null ? String(rp.handicap_index) : '', email: rp.email ?? '' }) }}
                              className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
                            <button type="button" onClick={() => setConfirmRemoveRosterId(rp.id)}
                              className="text-xs text-red-500 hover:text-red-700">Remove</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}


                {liveRoster.length === 0 && editingRosterId === null && (
                  <p className="text-xs text-gray-400 text-center py-1">No players in roster yet — add them above</p>
                )}
              </div>
            )}
          </div>
            {/* Create round */}
            {/* Collapse immediately on submit (createPending) or while refresh is pending (effectivePendingId) */}
            {round && (!showNewRoundForm || createPending || !!effectivePendingId) ? (
              /* Collapsed state — just show the button */
              <div className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setShowNewRoundWarning(true)}
                  className="text-white px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: navy }}>
                  New Round +
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-gray-900 text-sm">
                    {round ? 'Start New Round' : 'Set Up Round'}
                  </h3>
                  {round && (
                    <button type="button" onClick={() => setShowNewRoundForm(false)}
                      className="text-xs text-gray-400 hover:text-gray-600">✕ Cancel</button>
                  )}
                </div>
                {round && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3">
                    This will end the current round and start a new one.
                  </p>
                )}
                {(createState as { error?: string } | null)?.error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mb-2">{(createState as { error?: string } | null)?.error}</p>}
                <form id="create-round-form" ref={createFormRef} action={createAction} className="space-y-3">
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Round Name</label>
                    <input type="text" name="name" placeholder="e.g. Saturday Scramble" required
                      value={newRoundName}
                      onChange={(e) => setNewRoundName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                      <input type="date" name="date" required
                        value={newRoundDate}
                        onChange={(e) => setNewRoundDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Scoring Format</label>
                      <select name="format" value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                        <option value="" disabled>Select format…</option>
                        <option value="standard">3/4 Balls</option>
                        <option value="daytona">Daytona</option>
                        <option value="traditional">Traditional</option>
                        <option value="banker">Banker</option>
                        <option value="hammer">Hammer</option>
                      </select>
                    </div>
                  </div>
                  {(selectedFormat === 'daytona' || selectedFormat === 'traditional') && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Holes</label>
                        <div className="flex gap-2">
                          {(['18', '9'] as const).map((hc) => (
                            <button
                              key={hc}
                              type="button"
                              onClick={() => setSelectedHoleCount(hc)}
                              className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition ${
                                selectedHoleCount === hc
                                  ? 'border-gray-700 bg-gray-100 text-gray-800'
                                  : 'border-gray-200 bg-white text-gray-500'
                              }`}>
                              {hc === '18' ? '18 Holes' : '9 Holes'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {selectedHoleCount === '9' && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">Starting Hole</label>
                          <div className="flex gap-2">
                            {([['1', 'Hole 1 (Front 9)'], ['10', 'Hole 10 (Back 9)']] as const).map(([val, label]) => (
                              <button
                                key={val}
                                type="button"
                                onClick={() => setSelectedStartHole(val)}
                                className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition ${
                                  selectedStartHole === val
                                    ? 'border-gray-700 bg-gray-100 text-gray-800'
                                    : 'border-gray-200 bg-white text-gray-500'
                                }`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <input type="hidden" name="holeCount" value={selectedHoleCount} />
                      <input type="hidden" name="startHole" value={selectedStartHole} />
                    </div>
                  )}
                  {selectedFormat === 'banker' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Minimum Bet ($)</label>
                      <input type="number" name="banker_min_bet" value={bankerMinBetInput} onChange={(e) => setBankerMinBetInput(e.target.value)}
                        min="0.5" step="0.5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      <p className="text-xs text-gray-400 mt-0.5">Minimum bet each player must put up against the banker</p>
                    </div>
                  )}
                  {selectedFormat === 'standard' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Balls in Play</label>
                        <select name="ballsCount" value={selectedBallsCount} onChange={(e) => setSelectedBallsCount(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                          <option value="3">3 Balls</option>
                          <option value="4">4 Balls</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200 cursor-pointer"
                        onClick={() => setCreateIncludeTotal((v) => !v)}>
                        <div className={`w-8 h-5 rounded-full transition-colors flex-shrink-0 flex items-center ${createIncludeTotal ? 'bg-green-500' : 'bg-gray-300'}`}>
                          <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${createIncludeTotal ? 'translate-x-3' : 'translate-x-0'}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">Include Overall (18-hole total)</p>
                          <p className="text-xs text-gray-400">Adds a Total result for each ball · {createIncludeTotal ? 'Front + Back + Total' : 'Front + Back only'}</p>
                        </div>
                        {createIncludeTotal && <input type="hidden" name="include_total" value="true" />}
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Choose Course</label>
                    <select
                      name="course"
                      value={selectedCourse}
                      onChange={(e) => handleCourseChange(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    >
                      <option value="" disabled>Select course…</option>
                      {courses.length > 0 ? courses.map((c) => {
                        const pars: number[] = Array.isArray(c.pars) ? c.pars : JSON.parse(String(c.pars))
                        const total = pars.reduce((a, b) => a + b, 0)
                        return <option key={c.slug} value={c.slug}>{c.name} (Par {total})</option>
                      }) : (
                        <>
                          <option value="south">ACC South Course (Par 72)</option>
                          <option value="north">ACC North Course (Par 71)</option>
                          <option value="liveoak">Live Oak Golf Club (Par 71)</option>
                          <option value="maxwell">Maxwell Golf Course (Par 71)</option>
                          <option value="shadyoaks">Shady Oaks Golf Course (Par 70)</option>
                          <option value="hideout">The Hideout Golf Club (Par 72)</option>
                          <option value="canyonwest">Canyon West Golf Course (Par 72)</option>
                        </>
                      )}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Course pars auto-load — edit them in the Par Per Hole section after creating.</p>
                  </div>
                  <div
                    className="relative"
                    onMouseEnter={() => { if (!canStartRound) setShowStartTooltip(true) }}
                    onMouseLeave={() => setShowStartTooltip(false)}
                  >
                    {showStartTooltip && !canStartRound && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 w-56 shadow-lg pointer-events-none">
                        <p className="font-semibold mb-1">Still needed:</p>
                        <ul className="space-y-0.5 text-gray-300">
                          {startMissingItems.map((item) => (
                            <li key={item}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={!canStartRound || createPending}
                      onClick={() => setShowCreateConfirm(true)}
                      className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition"
                      style={{ background: navy, cursor: !canStartRound ? 'not-allowed' : undefined }}>
                      {createPending ? 'Creating…' : round ? 'Save' : 'Create Round'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ── Active Round info card ── */}
            {/* Show immediately on submit using optimistic values; switches to real data after router.refresh() */}
            {(round && (!showNewRoundForm || createPending || !!effectivePendingId)) && (
              <div className="bg-white border-l-4 rounded-xl px-4 py-3 shadow-sm" style={{ borderColor: isSettingUp ? '#d97706' : isComplete ? '#dc2626' : '#16a34a' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {/* During transition, show the new round's name from form state */}
                      <p className="font-semibold text-gray-900 truncate">
                        {(createPending || !!effectivePendingId) && newRoundName ? newRoundName : round.name}
                      </p>
                      {isSettingUp ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>● Setting Up</span>
                      ) : (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={isComplete ? { background: '#fee2e2', color: '#dc2626' } : { background: '#dcfce7', color: '#15803d' }}>
                          {isComplete ? '● Complete' : '● Active'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {round.course && `${round.course} · `}
                      {new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {' · '}{teams.length} {isDaytona ? 'groups' : 'teams'} · Par {parTotal}
                      {' · '}{isDaytona ? 'Daytona' : isTraditional ? 'Traditional' : `${ballsCount}-ball${roundIncludeTotal ? ' + total' : ''}`}
                      {is9HoleRound && ` · 9 Holes (${roundStartHole === 10 ? 'Back 9' : 'Front 9'})`}
                    </p>
                  </div>
                </div>
                {isSettingUp && (
                  <p className="text-xs text-amber-700 mt-2">
                    Add teams and configure settings below, then click &quot;Activate Round&quot; at the bottom to make the leaderboard live.
                  </p>
                )}
              </div>
            )}

            {/* ── Per Ball / Per Point Payout Value ── */}
            {round && !isTraditional && (
              <div className={`bg-white rounded-2xl border border-gray-200 p-5 transition-opacity ${!skinsAndPayoutEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {!skinsAndPayoutEnabled && roundIsSettingUp && (
                  <p className="text-xs text-gray-400 mb-3 bg-gray-50 rounded px-2 py-1.5 border border-gray-100 text-center">
                    Complete the round form above to unlock
                  </p>
                )}
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">
                  {isDaytona ? 'Per Point Payout Value' : 'Per Ball Payout Value'}
                </h3>
                <form action={ballAction} className="space-y-3">
                  <input type="hidden" name="roundId" value={round.id} />
                  <input type="hidden" name="ballsCount" value={isDaytona ? 1 : round.balls_count} />
                  {showBallSuccess && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Values saved!</p>}
                  {isDaytona ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Value Per Point ($)</label>
                      <input type="number" name="ball_1" min="0" step="0.25"
                        value={ballVals[1] ?? 0.25}
                        onChange={(e) => setBallVals((v) => ({ ...v, 1: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      <p className="text-xs text-gray-400 mt-1">Each point = this dollar amount. Points are the DT score difference per hole per player.</p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Value Per Ball ($)</label>
                      <input type="number" name="ball_1" min="0" step="1"
                        value={ballVals[1] ?? 5}
                        onChange={(e) => setBallVals((v) => ({ ...v, 1: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      <p className="text-xs text-gray-400 mt-1">Dollar amount each ball result is worth per player. Winning team splits the pot. Ties wash.</p>
                    </div>
                  )}
                  <button type="submit" disabled={ballPending}
                    className="w-full text-white py-2 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                    style={{ background: navy }}>
                    {ballPending ? 'Saving…' : 'Save Values'}
                  </button>
                </form>
              </div>
            )}

            {/* ── Skins Game ── */}
            {round && (
              <div className={`bg-white rounded-2xl border border-gray-200 p-5 transition-opacity ${!skinsAndPayoutEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {!skinsAndPayoutEnabled && roundIsSettingUp && (
                  <p className="text-xs text-gray-400 mb-3 bg-gray-50 rounded px-2 py-1.5 border border-gray-100 text-center">
                    Complete the round form above to unlock
                  </p>
                )}
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">Skins Game</h3>
                <form action={skinsAction} className="space-y-4">
                  <input type="hidden" name="roundId" value={round.id} />
                  <input type="hidden" name="skins_enabled" value={String(skinsEnabled ?? false)} />
                  {skinsState?.error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{skinsState.error}</p>}
                  {showSkinsSuccess && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Skins settings saved!</p>}
                  {/* Yes / No toggle */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Is there a skins game?</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSkinsEnabled(true)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                          skinsEnabled === true
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                        }`}>
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setSkinsEnabled(false)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                          skinsEnabled === false
                            ? 'border-gray-700 bg-gray-100 text-gray-800'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                        }`}>
                        No
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">Lowest individual score ≤ par on each hole wins a skin from every other participant.</p>
                  </div>
                  {/* Amount per skin */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount Per Skin ($)</label>
                    <input
                      type="number" name="skins_amount" min="0" step="1"
                      value={skinsAmount}
                      onChange={(e) => setSkinsAmount(parseFloat(e.target.value) || 0)}
                      onFocus={(e) => { if (skinsAmount === 0) e.target.value = '' }}
                      disabled={!skinsEnabled}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-40 disabled:bg-gray-50" />
                    <p className="text-xs text-gray-400 mt-1">Each other participant owes this amount to the skin winner per hole won.</p>
                  </div>
                  <button type="submit" disabled={skinsPending || (roundIsSettingUp && skinsEnabled === null)}
                    className="w-full text-white py-2 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                    style={{ background: navy }}>
                    {skinsPending ? 'Saving…' : 'Save Skins Settings'}
                  </button>
                </form>
                {skinsEnabled && skinsAndPayoutEnabled && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mt-3">
                    Mark each player as a skins participant using the Skins toggle in the Teams / Groups → Players section below.
                  </p>
                )}
              </div>
            )}

            {/* ── Auto Handicap toggle (Daytona / Banker) ── */}
            {round && (isDaytona || round.format === 'banker') && round.is_started && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 text-sm mb-3">Handicap Settings</h3>
                <div className="flex items-center gap-3 cursor-pointer" onClick={handleToggleAutoHandicap}>
                  <div className={`w-8 h-5 rounded-full transition-colors flex-shrink-0 flex items-center ${autoHandicap ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${autoHandicap ? 'translate-x-3' : 'translate-x-0'}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Auto Handicap</p>
                    <p className="text-xs text-gray-400">Automatically pre-fill strokes on each hole based on player handicaps and course stroke indexes</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Hammer Matchups (Standard + Traditional, and standalone Hammer format) ── */}
            {round && (isStandard || isTraditional || round.format === 'hammer') && round.is_started && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
                <h3 className="font-semibold text-gray-900 text-sm">Hammer Matchups</h3>
                {hammerError && <p className="text-xs text-red-500 bg-red-50 rounded px-3 py-2">{hammerError}</p>}

                {liveHammerMatchups.map((m) => {
                  const t1 = teams.find((t) => t.id === m.team1_id)
                  const t2 = teams.find((t) => t.id === m.team2_id)
                  return (
                    <div key={m.id} className="flex items-center justify-between bg-orange-50 rounded-xl px-3 py-2.5 border border-orange-100">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{t1?.name ?? '?'} vs {t2?.name ?? '?'}</p>
                        <p className="text-xs text-gray-500">Base bet ${m.base_bet}{m.auto_handicap ? ' · Auto HCP' : ''}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={`/${orgSlug}/score/hammer/${m.id}`} className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white" style={{ background: '#ea580c' }}>Open</a>
                        <button type="button" onClick={() => handleDeleteHammerMatchup(m.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      </div>
                    </div>
                  )
                })}

                <div className="border border-dashed border-gray-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">New Hammer Matchup</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 mb-0.5 block">Team 1</label>
                      <select value={newHammerTeam1} onChange={(e) => setNewHammerTeam1(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none bg-white">
                        <option value="" disabled>Select…</option>
                        {teams.filter((t) => !t.is_admin).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-0.5 block">Team 2</label>
                      <select value={newHammerTeam2} onChange={(e) => setNewHammerTeam2(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none bg-white">
                        <option value="" disabled>Select…</option>
                        {teams.filter((t) => !t.is_admin && t.id !== newHammerTeam1).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-0.5 block">Base Bet ($)</label>
                      <input type="number" value={newHammerBet} onChange={(e) => setNewHammerBet(e.target.value)} min="0.5" step="0.5"
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                    </div>
                    <div className="flex items-center gap-2 self-end pb-1.5">
                      <div className={`w-8 h-5 rounded-full transition-colors flex-shrink-0 flex items-center cursor-pointer ${newHammerAutoHcp ? 'bg-green-500' : 'bg-gray-300'}`}
                        onClick={() => setNewHammerAutoHcp((v) => !v)}>
                        <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${newHammerAutoHcp ? 'translate-x-3' : 'translate-x-0'}`} />
                      </div>
                      <label className="text-xs text-gray-600 cursor-pointer" onClick={() => setNewHammerAutoHcp((v) => !v)}>Auto HCP</label>
                    </div>
                  </div>
                  <button type="button" onClick={handleCreateHammerMatchup} disabled={hammerPending || !newHammerTeam1 || !newHammerTeam2}
                    className="w-full py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#ea580c' }}>
                    {hammerPending ? 'Creating…' : '+ Add Hammer Matchup'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Mixed Groups toggle (standard format only) ── */}
            {round && round.format === 'standard' && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                <div className="flex items-center gap-3 cursor-pointer" onClick={handleToggleMixedGroups}>
                  <div className={`w-8 h-5 rounded-full transition-colors flex-shrink-0 flex items-center ${mixedGroups ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${mixedGroups ? 'translate-x-3' : 'translate-x-0'}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Mixed Groups</p>
                    <p className="text-xs text-gray-400">Playing groups on the course are different from the ball-game teams — each group gets its own scorekeeper PIN</p>
                  </div>
                </div>

                {mixedGroups && (
                  <div className="space-y-3 border-t border-gray-100 pt-3">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Playing Groups</p>
                    {groupError && <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1.5">{groupError}</p>}

                    {/* Create group form */}
                    <div className="flex gap-2 flex-wrap">
                      <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Group name" className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                      <div className="relative">
                        <input type={showNewGroupPin ? 'text' : 'password'} value={newGroupPin} onChange={(e) => setNewGroupPin(e.target.value)}
                          placeholder="4-digit PIN" maxLength={4} inputMode="numeric"
                          className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 pr-8 text-sm focus:outline-none" />
                        <button type="button" tabIndex={-1} onClick={() => setShowNewGroupPin(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                          {showNewGroupPin ? '🙈' : '👁'}
                        </button>
                      </div>
                      <button type="button" onClick={handleCreateGroup} disabled={newGroupPending || !newGroupName.trim() || !newGroupPin.trim()}
                        className="text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60" style={{ background: navy }}>
                        + Add
                      </button>
                    </div>

                    {/* Group list */}
                    {livePlayingGroups.map((g) => {
                      const assignedPlayerIds = liveGroupPlayers.filter((gp) => gp.playing_group_id === g.id).map((gp) => gp.player_id)
                      const assignedPlayers = players.filter((p) => assignedPlayerIds.includes(p.id))
                      return (
                        <div key={g.id} className="bg-gray-50 rounded-xl border border-gray-200 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{g.name}</p>
                              <p className="text-xs text-gray-400 font-mono">PIN: {g.pin}</p>
                            </div>
                            <button type="button" onClick={() => handleDeleteGroup(g.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {assignedPlayers.map((p) => (
                              <span key={p.id} className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: '#dbeafe', color: '#1e40af' }}>
                                {p.name}
                                <button type="button" onClick={() => handleSetPlayerGroup(p.id, null)} className="ml-0.5 hover:text-red-600">×</button>
                              </span>
                            ))}
                            {assignedPlayers.length === 0 && <p className="text-xs text-gray-400">No players assigned</p>}
                          </div>
                        </div>
                      )
                    })}

                    {/* Unassigned players */}
                    {(() => {
                      const assignedIds = new Set(liveGroupPlayers.map((gp) => gp.player_id))
                      const unassigned = players.filter((p) => !assignedIds.has(p.id))
                      if (unassigned.length === 0) return null
                      return (
                        <div className="bg-amber-50 rounded-xl border border-amber-200 p-3">
                          <p className="text-xs font-semibold text-amber-700 mb-2">Unassigned Players — assign to a group:</p>
                          <div className="space-y-1.5">
                            {unassigned.map((p) => (
                              <div key={p.id} className="flex items-center gap-2">
                                <span className="text-sm text-gray-700 flex-1">{p.name}</span>
                                <select defaultValue="" onChange={(e) => { if (e.target.value) handleSetPlayerGroup(p.id, e.target.value) }}
                                  className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none">
                                  <option value="" disabled>Assign to…</option>
                                  {livePlayingGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {livePlayingGroups.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-2">Create playing groups above, then assign players</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Teams / Groups section ── */}
            {round && (
              <div className={`bg-white rounded-2xl border border-gray-200 overflow-hidden ${!teamsAddEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {/* Header */}
                <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-gray-900 text-sm">Teams / Groups</h3>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showTeamGenerator}
                        onChange={e => {
                          setShowTeamGenerator(e.target.checked)
                          if (e.target.checked) {
                            setGenSelectedRosterIds(new Set(liveRoster.map(r => r.id)))
                            setShowAddTeamForm(false)
                          } else {
                            setGeneratedTeams(null)
                            setConfirmGenUse(false)
                            setGenError('')
                          }
                        }}
                        className="w-3.5 h-3.5 accent-indigo-600"
                      />
                      <span className="text-xs font-medium text-indigo-700">Team Generator</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowAddTeamForm((v) => !v); setSelectedTeam(null) }}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition text-white"
                    style={{ background: navy }}>
                    {(round.format === 'daytona' || round.format === 'traditional') ? 'Add Group +' : 'Add Team +'}
                  </button>
                </div>
                {!teamsAddEnabled && roundIsSettingUp && (
                  <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
                    <p className="text-xs text-gray-400 text-center">Save skins and payout settings above to unlock</p>
                  </div>
                )}

                {/* ── Team Generator panel ── */}
                {showTeamGenerator && (
                  <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-4 space-y-4">
                    <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Team Generator</p>

                    {/* Player pool */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Select Players for the Round</p>

                      {/* Roster search + list */}
                      {liveRoster.length > 0 && (
                        <div className="bg-white rounded-xl border border-indigo-200 p-3 space-y-2 max-h-52 overflow-y-auto">
                          <input
                            type="text"
                            placeholder="Search roster…"
                            value={genRosterSearch}
                            onChange={e => setGenRosterSearch(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                          />
                          <div className="flex gap-3 mb-1">
                            <button type="button" onClick={() => setGenSelectedRosterIds(new Set(liveRoster.map(r => r.id)))}
                              className="text-xs text-indigo-600 hover:underline">Select all</button>
                            <button type="button" onClick={() => setGenSelectedRosterIds(new Set())}
                              className="text-xs text-gray-400 hover:underline">Clear</button>
                          </div>
                          {liveRoster
                            .filter(rp => !genRosterSearch || rp.name.toLowerCase().includes(genRosterSearch.toLowerCase()))
                            .map(rp => (
                              <label key={rp.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                                <input
                                  type="checkbox"
                                  checked={genSelectedRosterIds.has(rp.id)}
                                  onChange={e => {
                                    setGenSelectedRosterIds(prev => {
                                      const next = new Set(prev)
                                      e.target.checked ? next.add(rp.id) : next.delete(rp.id)
                                      return next
                                    })
                                    setGeneratedTeams(null)
                                  }}
                                  className="w-3.5 h-3.5 accent-indigo-600 flex-shrink-0"
                                />
                                <span className="text-sm text-gray-800 flex-1">{rp.name}</span>
                                <span className="text-xs text-gray-400 whitespace-nowrap">
                                  {rp.handicap_index != null
                                    ? rp.handicap_index < 0
                                      ? `+${Math.abs(rp.handicap_index)} HCP`
                                      : `HCP ${rp.handicap_index}`
                                    : 'No HCP'}
                                </span>
                              </label>
                            ))}
                          {liveRoster.filter(rp => !genRosterSearch || rp.name.toLowerCase().includes(genRosterSearch.toLowerCase())).length === 0 && (
                            <p className="text-xs text-gray-400">No matches.</p>
                          )}
                        </div>
                      )}
                      {liveRoster.length === 0 && (
                        <p className="text-xs text-gray-400">No roster players. Add players manually below.</p>
                      )}

                      {/* Manual add */}
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1.5">Add player not in roster:</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Name"
                            value={genManualName}
                            onChange={e => setGenManualName(e.target.value)}
                            className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="HCP (e.g. +2 or 14)"
                            value={genManualHcp}
                            onChange={e => setGenManualHcp(e.target.value)}
                            className="w-32 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!genManualName.trim()) return
                              const hcpStr = genManualHcp.trim()
                              const handicap = (() => {
                                if (!hcpStr) return ''
                                if (hcpStr.startsWith('+')) {
                                  const n = parseFloat(hcpStr.slice(1))
                                  return isNaN(n) ? '' : String(-n)
                                }
                                const n = parseFloat(hcpStr)
                                return isNaN(n) ? '' : String(n)
                              })()
                              setGenManualPlayers(prev => [...prev, {
                                tempId: `manual-${Date.now()}`,
                                name: genManualName.trim(),
                                handicap,
                              }])
                              setGenManualName('')
                              setGenManualHcp('')
                              setGeneratedTeams(null)
                            }}
                            className="text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                            style={{ background: navy }}>
                            Add
                          </button>
                        </div>
                        {genManualPlayers.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {genManualPlayers.map(p => (
                              <div key={p.tempId} className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-1.5">
                                <span className="text-sm text-gray-800 flex-1">{p.name}</span>
                                <span className="text-xs text-gray-400">
                                  {p.handicap !== ''
                                    ? parseFloat(p.handicap) < 0
                                      ? `+${Math.abs(parseFloat(p.handicap))} HCP`
                                      : `HCP ${p.handicap}`
                                    : 'No HCP'}
                                </span>
                                <button type="button"
                                  onClick={() => { setGenManualPlayers(prev => prev.filter(x => x.tempId !== p.tempId)); setGeneratedTeams(null) }}
                                  className="text-xs text-red-400 hover:text-red-600 ml-1">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Player count summary */}
                      {(() => {
                        const count = genSelectedRosterIds.size + genManualPlayers.length
                        return count > 0 ? (
                          <p className="text-xs text-indigo-600 font-medium">{count} player{count !== 1 ? 's' : ''} selected</p>
                        ) : null
                      })()}
                    </div>

                    {/* Config row */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-4 items-end">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Number of Teams</label>
                          <input
                            type="number"
                            min="2" max="20"
                            value={genNumTeams}
                            onChange={e => { setGenNumTeams(e.target.value); setGeneratedTeams(null) }}
                            className="w-20 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                          />
                        </div>

                        {/* Live distribution summary */}
                        {(() => {
                          const total = genSelectedRosterIds.size + genManualPlayers.length
                          const n = parseInt(genNumTeams, 10)
                          if (total < 2 || isNaN(n) || n < 2) return null
                          const floor = Math.floor(total / n)
                          const ceil = Math.ceil(total / n)
                          const extras = total % n
                          const distText = extras === 0
                            ? `${n} teams of ${floor}`
                            : `${extras} team${extras > 1 ? 's' : ''} of ${ceil} + ${n - extras} of ${floor}`
                          const tooSmall = floor < 4
                          const tooBig = ceil > 5
                          const ok = !tooSmall && !tooBig
                          return (
                            <div className={`self-end pb-0.5 px-3 py-2 rounded-lg text-xs font-semibold border ${ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                              {distText}
                              {tooSmall && <span className="ml-1 font-normal">— some teams under 4</span>}
                              {tooBig && <span className="ml-1 font-normal">— some teams over 5</span>}
                            </div>
                          )
                        })()}
                      </div>

                      {/* Valid 4–5 player/team suggestions */}
                      {(() => {
                        const total = genSelectedRosterIds.size + genManualPlayers.length
                        if (total < 4) return null
                        const validCounts = [2,3,4,5,6,7,8].filter(t => {
                          const f = Math.floor(total / t), c = Math.ceil(total / t)
                          return f >= 4 && c <= 5
                        })
                        if (validCounts.length === 0) return (
                          <p className="text-xs text-amber-600">
                            No clean 4–5 player/team split for {total} players. Try adding or removing a player.
                          </p>
                        )
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-gray-500">Valid 4–5/team splits:</span>
                            {validCounts.map(t => {
                              const c = Math.ceil(total / t), f = Math.floor(total / t)
                              const extras = total % t
                              const label = extras === 0 ? `${t} teams of ${f}` : `${t} teams (${extras}×${c} + ${t-extras}×${f})`
                              const active = parseInt(genNumTeams, 10) === t
                              return (
                                <button key={t} type="button"
                                  onClick={() => { setGenNumTeams(String(t)); setGeneratedTeams(null) }}
                                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'}`}>
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>

                    {genError && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{genError}</p>}

                    <button
                      type="button"
                      onClick={handleGenerateTeams}
                      className="w-full py-2 rounded-xl font-semibold text-sm text-white transition"
                      style={{ background: '#4f46e5' }}>
                      Generate Balanced Teams
                    </button>

                    {/* Generated preview */}
                    {generatedTeams && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Preview — edit names &amp; PINs</p>
                          <button type="button" onClick={handleGenerateTeams}
                            className="text-xs text-indigo-600 border border-indigo-200 px-2 py-1 rounded hover:bg-indigo-50">
                            Re-generate
                          </button>
                        </div>

                        {generatedTeams.map((team, i) => (
                          <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
                            <div className="flex gap-2 items-center">
                              <input
                                type="text"
                                value={genEditNames[i] ?? team.name}
                                onChange={e => setGenEditNames(prev => {
                                  const next = [...prev]
                                  next[i] = e.target.value
                                  return next
                                })}
                                className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold focus:outline-none"
                                placeholder="Team name"
                              />
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-xs text-gray-500">PIN</span>
                                <input
                                  type="text"
                                  value={genEditPins[i] ?? team.pin}
                                  onChange={e => setGenEditPins(prev => {
                                    const next = [...prev]
                                    next[i] = e.target.value.replace(/\D/g, '').slice(0, 4)
                                    return next
                                  })}
                                  maxLength={4}
                                  inputMode="numeric"
                                  className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center font-mono focus:outline-none"
                                />
                              </div>
                              {team.avgHandicap != null && (
                                <span className="text-xs text-gray-400 flex-shrink-0">avg {team.avgHandicap < 0 ? `+${Math.abs(team.avgHandicap)}` : team.avgHandicap} HCP</span>
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {team.players.map(p => (
                                <div key={p.id} className="flex items-center gap-2 text-sm text-gray-700 py-0.5 border-b border-gray-50 last:border-0">
                                  <span className="flex-1">{p.name}</span>
                                  <span className="text-xs text-gray-400">
                                    {p.handicap != null
                                      ? p.handicap < 0
                                        ? `+${Math.abs(p.handicap)} HCP`
                                        : `HCP ${p.handicap}`
                                      : '—'}
                                  </span>
                                  {p.source === 'manual' && (
                                    <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">manual</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}

                        {teams.length > 0 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            <p className="text-xs text-amber-700 font-medium">
                              Warning: this will replace the {teams.length} existing team{teams.length !== 1 ? 's' : ''} and all their players.
                            </p>
                          </div>
                        )}

                        {confirmGenUse ? (
                          <div className="flex gap-2 items-center">
                            <span className="text-sm text-gray-600 flex-1">Replace existing teams?</span>
                            <button type="button" onClick={handleUseGeneratedTeams} disabled={genPending}
                              className="text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                              style={{ background: '#059669' }}>
                              {genPending ? 'Creating…' : 'Yes, use these teams'}
                            </button>
                            <button type="button" onClick={() => setConfirmGenUse(false)}
                              className="text-gray-500 px-3 py-2 rounded-lg text-sm border border-gray-300">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => teams.length > 0 ? setConfirmGenUse(true) : handleUseGeneratedTeams()}
                            disabled={genPending}
                            className="w-full py-2.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-60"
                            style={{ background: '#059669' }}>
                            {genPending ? 'Creating teams…' : 'Use These Teams'}
                          </button>
                        )}

                        {genError && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{genError}</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsible add form */}
                {showAddTeamForm && (
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <form action={addTeamAction} className="space-y-2">
                      {/* Use the new round's ID as soon as it's available (before router.refresh() completes) */}
                      <input type="hidden" name="roundId" value={effectivePendingId ?? round.id} />
                      {addTeamState?.error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{addTeamState.error}</p>}
                      {showAddTeamSuccess && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">{(isDaytona || isTraditional) ? 'Group' : 'Team'} added!</p>}
                      {isDaytona && (
                        <div className="flex gap-2">
                          <select value={newTeamDaytonaType} onChange={(e) => { setNewTeamDaytonaType(e.target.value); setNewTeamSubVariant('') }} required
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                            <option value="" disabled>Daytona Type…</option>
                            <option value="4">4-Man</option>
                            <option value="5">5-Man</option>
                          </select>
                          {newTeamDaytonaType === '5' && (
                            <select value={newTeamSubVariant} onChange={(e) => setNewTeamSubVariant(e.target.value)} required
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                              <option value="" disabled>Variant…</option>
                              <option value="normal">Normal</option>
                              <option value="flares">Flares</option>
                            </select>
                          )}
                          <input type="hidden" name="daytona_variant" value={
                            newTeamDaytonaType === '4' ? '4man' :
                            newTeamDaytonaType === '5' ? `5man-${newTeamSubVariant || 'normal'}` : ''
                          } />
                        </div>
                      )}
                      {(isTraditional || isStandard) && (
                        <div className="space-y-2">
                          {/* Daytona Side Game */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600">Daytona Side Game</span>
                            <button type="button"
                              onClick={() => { setNewTeamDaytonaEnabled(v => !v); setNewTeamDaytonaType(''); setNewTeamSubVariant('') }}
                              className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${newTeamDaytonaEnabled ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                              {newTeamDaytonaEnabled ? 'On' : 'Off'}
                            </button>
                          </div>
                          {newTeamDaytonaEnabled && (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <select value={newTeamDaytonaType} onChange={(e) => { setNewTeamDaytonaType(e.target.value); setNewTeamSubVariant('') }}
                                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                                  <option value="" disabled>Type…</option>
                                  <option value="4">4-Man</option>
                                  <option value="5">5-Man</option>
                                </select>
                                {newTeamDaytonaType === '5' && (
                                  <select value={newTeamSubVariant} onChange={(e) => setNewTeamSubVariant(e.target.value)}
                                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                                    <option value="" disabled>Variant…</option>
                                    <option value="normal">Normal</option>
                                    <option value="flares">Flares</option>
                                  </select>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-500 whitespace-nowrap">Amt./point ($)</label>
                                <input type="number" min="0" step="0.25" placeholder="e.g. 0.25"
                                  value={newTeamDaytonaPayout} onChange={(e) => setNewTeamDaytonaPayout(e.target.value)}
                                  onFocus={(e) => { if (e.target.value === '0') e.target.value = '' }}
                                  className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                              </div>
                              <input type="hidden" name="daytona_variant" value={
                                newTeamDaytonaType === '4' ? `4man|${newTeamDaytonaPayout || '0'}` :
                                newTeamDaytonaType === '5' ? `5man-${newTeamSubVariant || 'normal'}|${newTeamDaytonaPayout || '0'}` : ''
                              } />
                            </div>
                          )}
                          {/* Banker Side Game */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600">Banker Side Game</span>
                            <button type="button"
                              onClick={() => setNewTeamBankerEnabled(v => !v)}
                              className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${newTeamBankerEnabled ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                              {newTeamBankerEnabled ? 'On' : 'Off'}
                            </button>
                          </div>
                          {newTeamBankerEnabled && (
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-gray-500 whitespace-nowrap">Min bet ($)</label>
                              <input type="number" min="0.5" step="0.5" placeholder="e.g. 2"
                                value={newTeamBankerMinBet} onChange={(e) => setNewTeamBankerMinBet(e.target.value)}
                                className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                            </div>
                          )}
                          <input type="hidden" name="banker_side_game" value={newTeamBankerEnabled ? 'true' : 'false'} />
                          {newTeamBankerEnabled && <input type="hidden" name="banker_side_game_min_bet" value={newTeamBankerMinBet} />}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input type="text" name="name" placeholder={(isDaytona || isTraditional) ? 'Group name' : 'Team name'} required
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                        <input type="text" name="pin" placeholder="PIN" maxLength={4} inputMode="numeric" required
                          className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none" />
                        {/* Disabled only while the create action is in-flight (roundId not known yet) */}
                        <button type="submit"
                          disabled={addTeamPending || createPending || (isDaytona && (!newTeamDaytonaType || (newTeamDaytonaType === '5' && !newTeamSubVariant))) || (isTraditional && newTeamDaytonaEnabled && (!newTeamDaytonaType || (newTeamDaytonaType === '5' && !newTeamSubVariant) || !newTeamDaytonaPayout))}
                          className="text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                          style={{ background: navy }}>{createPending ? '…' : 'Add'}</button>
                      </div>
                      <p className="text-xs text-gray-400">PIN must be 4 digits — share with the {isDaytona || isTraditional ? 'group scorekeeper' : 'team'}.</p>
                    </form>
                  </div>
                )}

                {/* Teams list */}
                {teams.length === 0 && (
                  <div className="px-4 py-4 text-sm text-gray-400 text-center">{(isDaytona || isTraditional) ? 'No groups added yet.' : 'No teams added yet.'}</div>
                )}
                <div className="p-3 space-y-2">
                {teams.map((team) => {
                  const teamPlayers = players.filter((p) => p.team_id === team.id)
                  const isSelected = selectedTeam === team.id
                  const isRenaming = renamingTeam === team.id
                  return (
                    <div key={team.id} className="border-2 border-gray-300 rounded-xl overflow-hidden">
                      <div className="px-4 py-3">
                        {editingTeamId === team.id ? (
                          <form action={updateTeamAction} className="space-y-2" onSubmit={() => setEditingTeamId(null)}>
                            <input type="hidden" name="teamId" value={team.id} />
                            {updateTeamState?.error && <p className="text-xs text-red-500">{updateTeamState.error}</p>}
                            <div className="flex gap-2">
                              <input type="text" name="name" value={editName} onChange={(e) => setEditName(e.target.value)} required placeholder="Group name"
                                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                              <input type="text" name="pin" value={editPin} onChange={(e) => setEditPin(e.target.value)} placeholder="PIN" maxLength={4} inputMode="numeric"
                                className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none" />
                            </div>
                            {(isTraditional || isStandard) && (
                              <div className="space-y-2">
                                {/* Daytona Side Game */}
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-600">Daytona Side Game</span>
                                  <button type="button"
                                    onClick={() => { setEditDaytonaEnabled(v => !v); setEditDaytonaType(''); setEditDaytonaSubVariant(''); setEditDaytonaPayout('') }}
                                    className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${editDaytonaEnabled ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                    {editDaytonaEnabled ? 'On' : 'Off'}
                                  </button>
                                </div>
                                {editDaytonaEnabled && (
                                  <div className="space-y-2">
                                    <div className="flex gap-2">
                                      <select value={editDaytonaType} onChange={(e) => { setEditDaytonaType(e.target.value); setEditDaytonaSubVariant('') }}
                                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                                        <option value="" disabled>Type…</option>
                                        <option value="4">4-Man</option>
                                        <option value="5">5-Man</option>
                                      </select>
                                      {editDaytonaType === '5' && (
                                        <select value={editDaytonaSubVariant} onChange={(e) => setEditDaytonaSubVariant(e.target.value)}
                                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                                          <option value="" disabled>Variant…</option>
                                          <option value="normal">Normal</option>
                                          <option value="flares">Flares</option>
                                        </select>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <label className="text-xs text-gray-500 whitespace-nowrap">Amt./point ($)</label>
                                      <input type="number" min="0" step="0.25" placeholder="e.g. 0.25"
                                        value={editDaytonaPayout} onChange={(e) => setEditDaytonaPayout(e.target.value)}
                                        onFocus={(e) => { if (e.target.value === '0') e.target.value = '' }}
                                        className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                                    </div>
                                  </div>
                                )}
                                <input type="hidden" name="daytona_variant" value={
                                  editDaytonaEnabled && editDaytonaType === '4' ? `4man|${editDaytonaPayout || '0'}` :
                                  editDaytonaEnabled && editDaytonaType === '5' ? `5man-${editDaytonaSubVariant || 'normal'}|${editDaytonaPayout || '0'}` : ''
                                } />
                                {/* Banker Side Game */}
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-600">Banker Side Game</span>
                                  <button type="button"
                                    onClick={() => setEditBankerEnabled(v => !v)}
                                    className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${editBankerEnabled ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                    {editBankerEnabled ? 'On' : 'Off'}
                                  </button>
                                </div>
                                {editBankerEnabled && (
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-500 whitespace-nowrap">Min bet ($)</label>
                                    <input type="number" min="0.5" step="0.5" placeholder="e.g. 2"
                                      value={editBankerMinBet} onChange={(e) => setEditBankerMinBet(e.target.value)}
                                      className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                                  </div>
                                )}
                                <input type="hidden" name="banker_side_game" value={editBankerEnabled ? 'true' : 'false'} />
                                {editBankerEnabled && <input type="hidden" name="banker_side_game_min_bet" value={editBankerMinBet} />}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button type="submit" disabled={updateTeamPending || (isTraditional && editDaytonaEnabled && (!editDaytonaType || (editDaytonaType === '5' && !editDaytonaSubVariant)))}
                                className="text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
                                style={{ background: navy }}>Save</button>
                              <button type="button" onClick={() => setEditingTeamId(null)}
                                className="text-gray-500 px-3 py-1.5 rounded-lg text-sm border border-gray-300">Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 text-sm">{team.name}</p>
                              <p className="text-xs text-gray-500">
                                PIN: <span className="font-mono font-bold text-gray-800">{team.pin}</span>
                                {team.daytona_variant && (() => {
                                  const [v, p] = team.daytona_variant!.split('|')
                                  const label = v === '5man-flares' ? 'Daytona 5-Man Flares' : v === '5man-normal' ? 'Daytona 5-Man Normal' : 'Daytona 4-Man'
                                  return <> · <span className="font-medium text-gray-700">{label}{p && p !== '0' ? ` · $${p}/pt` : ''}</span></>
                                })()}
                                {team.is_admin && <span className="ml-1 text-amber-600 font-medium">· Admin</span>}
                              </p>
                              <p className="text-xs mt-0.5">
                                {(() => {
                                  if (isTraditional) {
                                    if (team.daytona_variant) {
                                      const required = team.daytona_variant.split('|')[0].startsWith('5man') ? 5 : 4
                                      const ok = teamPlayers.length === required
                                      const over = teamPlayers.length > required
                                      return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length}/{required} players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                    }
                                    const ok = teamPlayers.length >= 2 && teamPlayers.length <= 5
                                    const over = teamPlayers.length > 5
                                    return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length}/2–5 players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                  }
                                  if (isDaytona) {
                                    const teamVariant = (team.daytona_variant ?? '4man').split('|')[0]
                                    const required = teamVariant.startsWith('5man') ? 5 : 4
                                    const ok = teamPlayers.length === required
                                    const over = teamPlayers.length > required
                                    return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length}/{required} players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                  }
                                  const required = round?.balls_count ?? 3
                                  const ok = teamPlayers.length >= required && teamPlayers.length <= 5
                                  const over = teamPlayers.length > 5
                                  return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length}/{required} players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                })()}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 flex-shrink-0">
                              <button onClick={() => {
                                const v = team.daytona_variant ?? ''
                                const [variant, payout] = v.includes('|') ? v.split('|') : [v, '']
                                setEditingTeamId(team.id)
                                setEditName(team.name)
                                setEditPin(team.pin)
                                setEditDaytonaEnabled(!!v)
                                setEditDaytonaType(variant.startsWith('5man') ? '5' : variant === '4man' ? '4' : '')
                                setEditDaytonaSubVariant(variant === '5man-flares' ? 'flares' : variant === '5man-normal' ? 'normal' : '')
                                setEditDaytonaPayout(payout || '')
                                setEditBankerEnabled(!!team.banker_side_game)
                                setEditBankerMinBet(team.banker_side_game_min_bet != null ? String(team.banker_side_game_min_bet) : '2')
                              }}
                                className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                                Edit
                              </button>
                              <button onClick={() => setSelectedTeam(isSelected ? null : team.id)}
                                className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                                {isSelected ? 'Close' : 'Players'}
                              </button>

                              {confirmRemoveTeamId === team.id ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="text-xs text-gray-500">Remove?</span>
                                  <button type="button" onClick={async () => { setConfirmRemoveTeamId(null); await handleDeleteTeam(team.id) }}
                                    className="text-xs font-semibold text-red-600 hover:text-red-800 transition">Yes</button>
                                  <button type="button" onClick={() => setConfirmRemoveTeamId(null)}
                                    className="text-xs text-gray-400 hover:text-gray-600 transition">Cancel</button>
                                </span>
                              ) : (
                                <button type="button" onClick={() => setConfirmRemoveTeamId(team.id)}
                                  className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-50">
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Animated expand/collapse via grid-template-rows */}
                      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isSelected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="border-t border-gray-100 px-4 py-3 space-y-2 bg-gray-50">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Players on {team.name}</p>
                            {teamPlayers.length === 0 && (
                              <p className="text-xs text-gray-400">No players added yet.</p>
                            )}
                            {teamPlayers.map((p, pi) => (
                              <div key={p.id} className="bg-white rounded-lg border border-gray-100">
                                {renamingPlayer === p.id ? (
                                  <form action={renamePlayerAction} className="flex gap-2 px-3 py-2" onSubmit={() => setRenamingPlayer(null)}>
                                    <input type="hidden" name="playerId" value={p.id} />
                                    <input type="text" name="name" defaultValue={p.name} required autoFocus
                                      className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                                    <button type="submit" disabled={renamePlayerPending}
                                      className="text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
                                      style={{ background: navy }}>Save</button>
                                    <button type="button" onClick={() => setRenamingPlayer(null)}
                                      className="text-xs text-gray-500 hover:text-gray-700 px-2">Cancel</button>
                                  </form>
                                ) : (
                                  <div className="flex items-center gap-1.5 px-3 py-2">
                                    <span className="text-xs font-semibold text-gray-400 w-4 text-right flex-shrink-0">{pi + 1}</span>
                                    <div className="flex flex-col gap-0.5 mr-1">
                                      <button type="button" disabled={pi === 0}
                                        onClick={() => handleMovePlayer(p.id, 'up')}
                                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition text-xs leading-none">▲</button>
                                      <button type="button" disabled={pi === teamPlayers.length - 1}
                                        onClick={() => handleMovePlayer(p.id, 'down')}
                                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition text-xs leading-none">▼</button>
                                    </div>
                                    <span className="flex-1 text-sm text-gray-800 font-medium">{p.name}</span>
                                    {editingHandicapId === p.id ? (
                                      <div className="flex items-center gap-1">
                                        <input type="number" value={handicapDraft} onChange={(e) => setHandicapDraft(e.target.value)}
                                          autoFocus min="0" max="54" step="0.1" placeholder="HCP"
                                          className="w-14 border border-blue-300 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                                          onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateHandicap(p.id); if (e.key === 'Escape') setEditingHandicapId(null) }} />
                                        <button type="button" onClick={() => handleUpdateHandicap(p.id)} className="text-xs text-blue-600 font-medium">✓</button>
                                        <button type="button" onClick={() => setEditingHandicapId(null)} className="text-xs text-gray-400">✕</button>
                                      </div>
                                    ) : (
                                      <button type="button" onClick={() => { setEditingHandicapId(p.id); setHandicapDraft(p.handicap != null ? String(p.handicap) : '') }}
                                        className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition">
                                        {p.handicap != null ? `HCP ${p.handicap}` : 'HCP —'}
                                      </button>
                                    )}
                                    {skinsEnabled && (
                                      <button type="button"
                                        onClick={() => handleToggleSkinsParticipant(p.id, p.skins_participant)}
                                        className={`text-xs px-2 py-0.5 rounded border transition ${p.skins_participant ? 'bg-amber-100 border-amber-400 text-amber-800 font-semibold' : 'border-gray-300 text-gray-400 hover:border-amber-300 hover:text-amber-600'}`}>
                                        Skins
                                      </button>
                                    )}
                                    <button type="button" onClick={() => setRenamingPlayer(p.id)}
                                      className="text-xs text-blue-500 hover:text-blue-700">Rename</button>
                                    <button type="button" onClick={() => handleDeletePlayer(p.id)}
                                      className="text-xs text-red-500 hover:text-red-700 ml-1">Remove</button>
                                  </div>
                                )}
                              </div>
                            ))}
                            {(() => {
                              const maxPlayers = (isDaytona || (isTraditional && team.daytona_variant))
                                ? (team.daytona_variant ?? '4man').split('|')[0].startsWith('5man') ? 5 : 4
                                : 5
                              if (teamPlayers.length >= maxPlayers) return null
                              return (
                                <>
                                {liveRoster.length > 0 && (
                                  <button type="button" onClick={() => { setRosterPickerTeamId(team.id); setRosterSearch('') }}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 font-medium mt-2 hover:bg-blue-50 transition">
                                    Pick from Roster
                                  </button>
                                )}
                                <form action={addPlayerAction} className="flex flex-wrap gap-2 mt-1">
                                  <input type="hidden" name="teamId" value={team.id} />
                                  {addPlayerState?.error && <p className="text-xs text-red-500 w-full">{addPlayerState.error}</p>}
                                  <input type="text" name="name" placeholder="Or enter name manually" required
                                    className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                                  <input type="number" name="handicap" placeholder="HCP" min="0" max="54" step="0.1"
                                    className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                                  {skinsEnabled && (
                                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer self-center whitespace-nowrap">
                                      <input type="checkbox" name="skins_participant" value="true"
                                        className="w-3.5 h-3.5 accent-amber-500" />
                                      In Skins
                                    </label>
                                  )}
                                  <button type="submit" disabled={addPlayerPending}
                                    className="text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
                                    style={{ background: navy }}>Add</button>
                                </form>
                                </>
                              )
                            })()}
                            <button type="button" onClick={() => setResetConfirmTeamId(team.id)}
                              className="text-xs text-orange-600 border border-orange-200 px-2 py-1 rounded hover:bg-orange-50 mt-1">
                              Reset All Scores
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                </div>

                {/* Save Teams / Save Groups button — setup wizard only */}
                {roundIsSettingUp && (
                  <div className="px-4 py-3 border-t border-gray-100">
                    {teamsSaved && (
                      <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2 mb-2">
                        {(isDaytona || isTraditional) ? 'Group(s) saved!' : 'Teams saved!'}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setTeamsSaved(true)}
                      disabled={teams.length === 0 || !allTeamsMeetRequirement}
                      className="w-full py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed text-white"
                      style={{ background: navy }}>
                      {(isDaytona || isTraditional) ? 'Save Group(s)' : 'Save Teams'}
                    </button>
                    {teams.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center mt-1.5">Add at least one {(isDaytona || isTraditional) ? 'group' : 'team'} first</p>
                    ) : !allTeamsMeetRequirement ? (
                      <p className="text-xs text-red-500 text-center mt-1.5">
                        {isDaytona
                          ? 'Each group needs the correct number of players'
                          : isTraditional
                          ? 'Each group needs 2–5 players'
                          : `Each team needs at least ${round?.balls_count ?? 3} and no more than 5 players`}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* ── Activate Round (bottom) — only when round exists but not yet started ── */}
            {roundIsSettingUp && round && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 text-sm mb-2">Activate Round</h3>
                <p className="text-xs text-gray-500 mb-3">
                  {canActivate
                    ? 'Teams and settings are configured. Click below to make the leaderboard live — players can then enter scores.'
                    : 'Complete the required steps above before activating the round.'}
                </p>
                {activateMissingItems.length > 0 && (
                  <div className="mb-3 bg-amber-50 rounded-lg px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-800 mb-1">Still needed:</p>
                    <ul className="space-y-0.5">
                      {activateMissingItems.map((item) => (
                        <li key={item} className="text-xs text-amber-700">• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div
                  className="relative"
                  onMouseEnter={() => { if (!canActivate) setShowActivateTooltip(true) }}
                  onMouseLeave={() => setShowActivateTooltip(false)}
                >
                  {showActivateTooltip && !canActivate && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 w-60 shadow-lg pointer-events-none">
                      <p className="font-semibold mb-1">Complete these steps first:</p>
                      <ul className="space-y-0.5 text-gray-300">
                        {activateMissingItems.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <form action={activateRound.bind(null, round.id, orgSlug)}>
                    <button type="submit"
                      disabled={!canActivate}
                      className="w-full text-white py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#16a34a' }}>
                      Activate Round
                    </button>
                  </form>
                </div>
              </div>
            )}

        </div>{/* end outer content space-y-4 */}

        <div className="h-8" />
      </div>
    </div>
  )
}

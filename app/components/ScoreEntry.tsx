'use client'

import { useState, useEffect, useRef, Fragment, useMemo } from 'react'
import { submitHoleScores, saveDaytonaAssignments, saveDaytonaHoleValues, saveHoleStrokes, saveBankerHole, saveBankerBets } from '@/app/actions'
import { supabase } from '@/lib/supabase'
import {
  computeHoleBallScores, computeTeamBallSummary,
  computeHoleDaytonaWithSides, computeDaytonaSidesSummary, computePlayerDaytonaPoints,
  computeHoleDaytonaPointsFiveMan, computePlayerDaytonaDollars,
  calculatePoolPayouts, settleDaytonaPlayerPoints,
  type DaytonaHoleAssignment, type DaytonaSide,
} from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'
import ScorecardBottomSheet from './ScorecardBottomSheet'

type Player = { id: string; name: string; handicap?: number | null }
type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }
type Team = { id: string; name: string }
type AssignmentMap = Record<number, Record<string, DaytonaSide>>
type AllTeam = { id: string; name: string; daytona_variant?: string | null }
type AllPlayer = { id: string; team_id: string; name: string; position: number | null }
type BallValue = { ball_number: number; value_dollars: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string }
type BestBallMatchup = { id: string; team1_player1_id: string; team1_player2_id: string; team2_player1_id: string; team2_player2_id: string; bet: string }
type MatchupBetType = 'nassau' | 'straight'
type MatchupScoringType = 'stroke' | 'match'
type MPayoutSeg = { name: 'Front' | 'Back' | 'Total'; settled: boolean; winnerLabel: string | null; tied: boolean; amount: number; perPlayer: boolean }
type MPayoutRow = { id: string; label: string; betLabel: string; segments: MPayoutSeg[]; nassauResult?: { winnerLabel: string | null; amount: number; perPlayer: boolean; anySettled: boolean; swept?: boolean } }
type PayoutsData = {
  teams: AllTeam[]; players: AllPlayer[]; scores: Score[]; ballValues: BallValue[]
  assignments: DaytonaHoleAssignment[]; matchups: SavedMatchup[]; bestBallMatchups: BestBallMatchup[]
  holeValues: Record<string, Record<number, number>>
  bankerHolesAll: { team_id: string; hole_number: number; banker_player_id: string | null; max_bet: number }[]
  bankerBetsAll: { team_id: string; hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[]
  holeStrokesAll: { hole_number: number; player_id: string }[]
}

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

function formatHoleRateBreakdown(holes: { hole_number: number }[], overrides: Record<number, number>, defaultRate: number): string {
  if (Object.keys(overrides).length === 0) return `$${defaultRate}/point`
  const sorted = [...holes].sort((a, b) => a.hole_number - b.hole_number)
  const ranges: { start: number; end: number; rate: number }[] = []
  for (const hole of sorted) {
    const rate = overrides[hole.hole_number] ?? defaultRate
    const last = ranges[ranges.length - 1]
    if (last && last.rate === rate && last.end === hole.hole_number - 1) { last.end = hole.hole_number }
    else { ranges.push({ start: hole.hole_number, end: hole.hole_number, rate }) }
  }
  return ranges.map(r => `Holes ${r.start === r.end ? r.start : `${r.start}–${r.end}`}: $${r.rate}/pt`).join(' · ')
}

type SegBreak = { label: string; rate: number; ptsByPlayer: Map<string, number> }
function buildSegmentBreakdown(
  holes: { hole_number: number; par: number }[],
  scores: { player_id: string; hole_number: number; strokes: number }[],
  assignments: DaytonaHoleAssignment[],
  variant: string,
  overrides: Record<number, number>,
  defaultRate: number
): SegBreak[] {
  if (Object.keys(overrides).length === 0) return []
  const sorted = [...holes].sort((a, b) => a.hole_number - b.hole_number)
  type S = { start: number; end: number; rate: number; holeObjs: typeof holes }
  const segs: S[] = []
  for (const hole of sorted) {
    const rate = overrides[hole.hole_number] ?? defaultRate
    const last = segs[segs.length - 1]
    if (last && last.rate === rate && last.end === hole.hole_number - 1) { last.end = hole.hole_number; last.holeObjs.push(hole) }
    else segs.push({ start: hole.hole_number, end: hole.hole_number, rate, holeObjs: [hole] })
  }
  if (segs.length <= 1) return []
  return segs.map(seg => ({
    label: seg.start === seg.end ? `H${seg.start}` : `H${seg.start}–${seg.end}`,
    rate: seg.rate,
    ptsByPlayer: computePlayerDaytonaPoints(seg.holeObjs, scores, assignments, variant),
  }))
}

// ── Matchup helpers (mirrors LeaderboardClient) ───────────────────────────────
function parseMBetAmounts(raw: string): { frontAmount: number; backAmount: number; totalAmount: number } {
  const p = raw.split('|')
  if (p.length === 3) { const f = parseFloat(p[0]) || 0, b = parseFloat(p[1]) || 0, t = parseFloat(p[2]) || 0; return { frontAmount: f, backAmount: b, totalAmount: t } }
  const a = parseFloat(raw) || 0; return { frontAmount: a, backAmount: a, totalAmount: a }
}
function parseMBet(bet: string): { betType: MatchupBetType | ''; amount: string; scoringType: MatchupScoringType; sweepAmount: string; handicapSide: string; handicapFront: string; handicapBack: string; handicapTotal: string; frontAmount: number; backAmount: number; totalAmount: number } {
  const empty = { betType: '' as MatchupBetType | '', amount: '', scoringType: 'stroke' as MatchupScoringType, sweepAmount: '', handicapSide: '', handicapFront: '', handicapBack: '', handicapTotal: '', frontAmount: 0, backAmount: 0, totalAmount: 0 }
  if (!bet) return empty
  const p = bet.split(':')
  if (p.length >= 2 && (p[0] === 'nassau' || p[0] === 'straight')) { const rawAmt = p[1] ?? ''; return { betType: p[0] as MatchupBetType, amount: rawAmt, scoringType: p[2] === 'match' ? 'match' : 'stroke', sweepAmount: p[3] ?? '', handicapSide: p[4] ?? '', handicapFront: p[5] ?? '', handicapBack: p[6] ?? '', handicapTotal: p[7] ?? '', ...parseMBetAmounts(rawAmt) } }
  return empty
}
function formatMBet(bet: string): string {
  const { betType, scoringType, sweepAmount, frontAmount, backAmount, totalAmount } = parseMBet(bet)
  const sl = scoringType === 'match' ? 'Match Play' : 'Stroke Play'
  if (betType === 'nassau') {
    const sweepLabel = sweepAmount ? ` · Sweep $${sweepAmount}` : ''
    const allSame = frontAmount > 0 && frontAmount === backAmount && backAmount === totalAmount
    const anyAmt = frontAmount > 0 || backAmount > 0 || totalAmount > 0
    const amtLabel = allSame ? `$${frontAmount} ` : anyAmt ? `$${frontAmount}/$${backAmount}/$${totalAmount} ` : ''
    return `${amtLabel}Nassau${sweepLabel} · ${sl}`
  }
  if (betType === 'straight' && totalAmount > 0) return `$${totalAmount} Overall · ${sl}`
  if (betType === 'straight') return `Overall · ${sl}`
  return sl
}
function h2hStats(p1Id: string, p2Id: string, sm: Record<string, Record<number, number>>, holes: { hole_number: number; par: number }[]) {
  let p1W = 0, p2W = 0, p1FW = 0, p2FW = 0, p1BW = 0, p2BW = 0
  let p1F = 0, p2F = 0, fPar = 0, fP = 0, p1B = 0, p2B = 0, bPar = 0, bP = 0, p1T = 0, p2T = 0, tPar = 0, tP = 0
  for (const h of holes) {
    const s1 = sm[p1Id]?.[h.hole_number] ?? null, s2 = sm[p2Id]?.[h.hole_number] ?? null
    if (s1 !== null && s2 !== null) {
      tP++; p1T += s1; p2T += s2; tPar += h.par
      if (h.hole_number <= 9) { fP++; p1F += s1; p2F += s2; fPar += h.par } else { bP++; p1B += s1; p2B += s2; bPar += h.par }
      if (s1 < s2) { p1W++; if (h.hole_number <= 9) p1FW++; else p1BW++ } else if (s1 > s2) { p2W++; if (h.hole_number <= 9) p2FW++; else p2BW++ }
    }
  }
  return { p1Wins: p1W, p2Wins: p2W, p1FrontWins: p1FW, p2FrontWins: p2FW, p1BackWins: p1BW, p2BackWins: p2BW, p1Front: fP > 0 ? p1F - fPar : null, p2Front: fP > 0 ? p2F - fPar : null, p1Back: bP > 0 ? p1B - bPar : null, p2Back: bP > 0 ? p2B - bPar : null, p1Total: tP > 0 ? p1T - tPar : null, p2Total: tP > 0 ? p2T - tPar : null }
}
function bbStats(t1p1: string, t1p2: string, t2p1: string, t2p2: string, sm: Record<string, Record<number, number>>, holes: { hole_number: number; par: number }[]) {
  let t1W = 0, t2W = 0, t1FW = 0, t2FW = 0, t1BW = 0, t2BW = 0
  let t1F = 0, t2F = 0, fPar = 0, fP = 0, t1B = 0, t2B = 0, bPar = 0, bP = 0, t1T = 0, t2T = 0, tPar = 0, tP = 0
  for (const h of holes) {
    const a1 = sm[t1p1]?.[h.hole_number] ?? null, a2 = sm[t1p2]?.[h.hole_number] ?? null
    const b1 = sm[t2p1]?.[h.hole_number] ?? null, b2 = sm[t2p2]?.[h.hole_number] ?? null
    const t1b = [a1, a2].filter((s): s is number => s !== null)
    const t2b = [b1, b2].filter((s): s is number => s !== null)
    const t1v = t1b.length > 0 ? Math.min(...t1b) : null, t2v = t2b.length > 0 ? Math.min(...t2b) : null
    if (t1v !== null && t2v !== null) {
      tP++; t1T += t1v; t2T += t2v; tPar += h.par
      if (h.hole_number <= 9) { fP++; t1F += t1v; t2F += t2v; fPar += h.par } else { bP++; t1B += t1v; t2B += t2v; bPar += h.par }
      if (t1v < t2v) { t1W++; if (h.hole_number <= 9) t1FW++; else t1BW++ } else if (t1v > t2v) { t2W++; if (h.hole_number <= 9) t2FW++; else t2BW++ }
    }
  }
  return { t1Wins: t1W, t2Wins: t2W, t1FrontWins: t1FW, t2FrontWins: t2FW, t1BackWins: t1BW, t2BackWins: t2BW, t1Front: fP > 0 ? t1F - fPar : null, t2Front: fP > 0 ? t2F - fPar : null, t1Back: bP > 0 ? t1B - bPar : null, t2Back: bP > 0 ? t2B - bPar : null, t1Total: tP > 0 ? t1T - tPar : null, t2Total: tP > 0 ? t2T - tPar : null }
}
function slH2H(a: number | null, b: number | null): 'p1' | 'p2' | 'tie' | null { if (a === null || b === null) return null; return a < b ? 'p1' : b < a ? 'p2' : 'tie' }
function slBB(a: number | null, b: number | null): 't1' | 't2' | 'tie' | null { if (a === null || b === null) return null; return a < b ? 't1' : b < a ? 't2' : 'tie' }
function minimizeSettlements(players: { id: string; name: string }[], net: Record<string, number>) {
  const pw = players.map((p) => ({ id: p.id, name: p.name, bal: Math.round((net[p.id] ?? 0) * 100) / 100 })).filter((b) => b.bal > 0.005).sort((a, b) => b.bal - a.bal).map((b) => ({ ...b }))
  const nw = players.map((p) => ({ id: p.id, name: p.name, bal: Math.round((net[p.id] ?? 0) * 100) / 100 })).filter((b) => b.bal < -0.005).sort((a, b) => a.bal - b.bal).map((b) => ({ ...b }))
  const out: { fromId: string; fromName: string; toId: string; toName: string; amount: number }[] = []
  let wi = 0, li = 0
  while (wi < pw.length && li < nw.length) {
    const amount = Math.round(Math.min(pw[wi].bal, -nw[li].bal) * 100) / 100
    if (amount > 0) out.push({ fromId: nw[li].id, fromName: nw[li].name, toId: pw[wi].id, toName: pw[wi].name, amount })
    pw[wi].bal = Math.round((pw[wi].bal - amount) * 100) / 100; nw[li].bal = Math.round((nw[li].bal + amount) * 100) / 100
    if (pw[wi].bal <= 0.005) wi++; if (nw[li].bal >= -0.005) li++
  }
  return out
}
function computeMatchupPayouts(matchups: SavedMatchup[], bestBallMatchups: BestBallMatchup[], players: { id: string; name: string }[], scoreMap: Record<string, Record<number, number>>, holes: { hole_number: number; par: number }[]): { rows: MPayoutRow[]; net: Record<string, number>; involvedIds: Set<string> } {
  const net: Record<string, number> = {}
  for (const p of players) net[p.id] = 0
  const rows: MPayoutRow[] = []
  const involvedIds = new Set<string>()
  for (const m of matchups) {
    const mp1 = players.find((p) => p.id === m.player1_id), mp2 = players.find((p) => p.id === m.player2_id)
    if (!mp1 || !mp2) continue
    involvedIds.add(m.player1_id); involvedIds.add(m.player2_id)
    const { betType, scoringType, sweepAmount, handicapSide, handicapFront, handicapBack, handicapTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseMBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)
    if (!hasBet) { rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] }); continue }
    const stats = h2hStats(m.player1_id, m.player2_id, scoreMap, holes)
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
      const p1w = scoringType === 'match' ? mpDiff > 0 : sl === 'p1', p2w = scoringType === 'match' ? mpDiff < 0 : sl === 'p2'
      if (p1w) { net[p1] = (net[p1] ?? 0) + amt; net[p2] = (net[p2] ?? 0) - amt; return { winnerLabel: mp1.name, tied: false } }
      if (p2w) { net[p2] = (net[p2] ?? 0) + amt; net[p1] = (net[p1] ?? 0) - amt; return { winnerLabel: mp2.name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segs: MPayoutSeg[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.p1Front !== null && stats.p2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveH2H(fS, slH2H(adjP1Front, adjP2Front), stats.p1FrontWins - stats.p2FrontWins, fBetAmt)
      segs.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: false })
      const bS = hole18 && stats.p1Back !== null && stats.p2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveH2H(bS, slH2H(adjP1Back, adjP2Back), stats.p1BackWins - stats.p2BackWins, bBetAmt)
      segs.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: false })
    }
    const tS = hole18 && stats.p1Total !== null && stats.p2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveH2H(tS, slH2H(adjP1Total, adjP2Total), stats.p1Wins - stats.p2Wins, tBetAmt)
    segs.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: false })
    let nassauResult: MPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const p1Net = segs.reduce((s, seg) => s + (seg.settled && !seg.tied && seg.winnerLabel !== null ? (seg.winnerLabel === mp1.name ? seg.amount : -seg.amount) : 0), 0)
      nassauResult = { winnerLabel: p1Net > 0 ? mp1.name : p1Net < 0 ? mp2.name : null, amount: Math.abs(p1Net), perPlayer: false, anySettled: segs.some((s) => s.settled) }
      const sweepAmt = parseFloat(sweepAmount)
      if (!isNaN(sweepAmt) && sweepAmt > 0 && segs.length === 3) {
        const [fSeg, bSeg, tSeg] = segs
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
    rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: formatMBet(m.bet), segments: segs, nassauResult })
  }
  for (const m of bestBallMatchups) {
    const t1p1 = players.find((p) => p.id === m.team1_player1_id), t1p2 = players.find((p) => p.id === m.team1_player2_id)
    const t2p1 = players.find((p) => p.id === m.team2_player1_id), t2p2 = players.find((p) => p.id === m.team2_player2_id)
    if (!t1p1 || !t1p2 || !t2p1 || !t2p2) continue
    involvedIds.add(m.team1_player1_id); involvedIds.add(m.team1_player2_id); involvedIds.add(m.team2_player1_id); involvedIds.add(m.team2_player2_id)
    const { betType, scoringType, sweepAmount: bbSweepAmt, handicapSide: bbHcpSide, handicapFront: bbHcpFront, handicapBack: bbHcpBack, handicapTotal: bbHcpTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseMBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)
    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`, t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`
    if (!hasBet) { rows.push({ id: m.id, label: `${t1Name} vs ${t2Name}`, betLabel: 'No bet configured', segments: [] }); continue }
    const stats = bbStats(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
    const t1Ids = [m.team1_player1_id, m.team1_player2_id], t2Ids = [m.team2_player1_id, m.team2_player2_id]
    const hole9 = t1Ids.some((id) => scoreMap[id]?.[9] != null) && t2Ids.some((id) => scoreMap[id]?.[9] != null)
    const hole18 = t1Ids.some((id) => scoreMap[id]?.[18] != null) && t2Ids.some((id) => scoreMap[id]?.[18] != null)
    // Stroke handicap adjustments (stroke play only)
    const bbHf = scoringType === 'stroke' ? (parseFloat(bbHcpFront) || 0) : 0
    const bbHb = scoringType === 'stroke' ? (parseFloat(bbHcpBack) || 0) : 0
    const bbHt = scoringType === 'stroke' ? (parseFloat(bbHcpTotal) || 0) : 0
    const adjT1Front = stats.t1Front !== null ? stats.t1Front - (bbHcpSide === 't1' ? bbHf : 0) : null
    const adjT2Front = stats.t2Front !== null ? stats.t2Front - (bbHcpSide === 't2' ? bbHf : 0) : null
    const adjT1Back  = stats.t1Back  !== null ? stats.t1Back  - (bbHcpSide === 't1' ? bbHb : 0) : null
    const adjT2Back  = stats.t2Back  !== null ? stats.t2Back  - (bbHcpSide === 't2' ? bbHb : 0) : null
    const adjT1Total = stats.t1Total !== null ? stats.t1Total - (bbHcpSide === 't1' ? bbHt : 0) : null
    const adjT2Total = stats.t2Total !== null ? stats.t2Total - (bbHcpSide === 't2' ? bbHt : 0) : null
    const resolveBB = (settled: boolean, sl: 't1' | 't2' | 'tie' | null, mpDiff: number, amt: number): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const t1w = scoringType === 'match' ? mpDiff > 0 : sl === 't1', t2w = scoringType === 'match' ? mpDiff < 0 : sl === 't2'
      if (t1w) { for (const id of t1Ids) net[id] = (net[id] ?? 0) + amt; for (const id of t2Ids) net[id] = (net[id] ?? 0) - amt; return { winnerLabel: t1Name, tied: false } }
      if (t2w) { for (const id of t2Ids) net[id] = (net[id] ?? 0) + amt; for (const id of t1Ids) net[id] = (net[id] ?? 0) - amt; return { winnerLabel: t2Name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segs: MPayoutSeg[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.t1Front !== null && stats.t2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveBB(fS, slBB(adjT1Front, adjT2Front), stats.t1FrontWins - stats.t2FrontWins, fBetAmt)
      segs.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: true })
      const bS = hole18 && stats.t1Back !== null && stats.t2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveBB(bS, slBB(adjT1Back, adjT2Back), stats.t1BackWins - stats.t2BackWins, bBetAmt)
      segs.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: true })
    }
    const tS = hole18 && stats.t1Total !== null && stats.t2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveBB(tS, slBB(adjT1Total, adjT2Total), stats.t1Wins - stats.t2Wins, tBetAmt)
    segs.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: true })
    let nassauResult: MPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const t1Net = segs.reduce((s, seg) => s + (seg.settled && !seg.tied && seg.winnerLabel !== null ? (seg.winnerLabel === t1Name ? seg.amount : -seg.amount) : 0), 0)
      nassauResult = { winnerLabel: t1Net > 0 ? t1Name : t1Net < 0 ? t2Name : null, amount: Math.abs(t1Net), perPlayer: true, anySettled: segs.some((s) => s.settled) }
      const sweepAmt = parseFloat(bbSweepAmt)
      if (!isNaN(sweepAmt) && sweepAmt > 0 && segs.length === 3) {
        const [fSeg, bSeg, tSeg] = segs
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
            nassauResult = { ...nassauResult, amount: sweepAmt, swept: true }
          }
        }
      }
    }
    rows.push({ id: m.id, label: `${t1Name} vs ${t2Name}`, betLabel: formatMBet(m.bet), segments: segs, nassauResult })
  }
  return { rows, net, involvedIds }
}

function defaultAssignmentForHole(players: Player[], holeNumber: number, existing: AssignmentMap): Record<string, DaytonaSide> {
  // Use most-recent saved hole's assignments as default
  const savedHoleNumbers = Object.keys(existing).map(Number).filter((n) => n < holeNumber).sort((a, b) => b - a)
  if (savedHoleNumbers.length > 0) {
    return { ...existing[savedHoleNumbers[0]] }
  }
  // Fallback: first 2 players = left, rest = right
  const m: Record<string, DaytonaSide> = {}
  players.forEach((p, i) => { m[p.id] = i < 2 ? 'left' : 'right' })
  return m
}

export default function ScoreEntry({
  orgSlug, orgId, orgName, isMaster = false,
  team, players, holes, initialScores, ballsCount, format = 'standard', daytonaVariant = '4man', isAdmin, isStarted = true, roundId = '', initialAssignments = [], roundPlayerIds = [], includeTotal = false, initialHoleValues = {}, defaultDtPayoutValue = 0.25, isDaytonaSideGame = false, autoHandicap = false, allRoundPlayerHandicaps = {}, initialHoleStrokes = {}, bankerMinBet = 2, bankerSideGame = false, initialBankerHoles = {}, initialBankerBets = {}, sideGameGroupScores,
}: {
  orgSlug: string
  orgId: string
  orgName: string
  isMaster?: boolean
  team: Team
  players: Player[]
  holes: Hole[]
  initialScores: Score[]
  ballsCount: number
  format?: string
  daytonaVariant?: string
  isAdmin: boolean
  isStarted?: boolean
  roundId?: string
  initialAssignments?: DaytonaHoleAssignment[]
  roundPlayerIds?: string[]
  includeTotal?: boolean
  initialHoleValues?: Record<number, number>
  defaultDtPayoutValue?: number
  isDaytonaSideGame?: boolean
  autoHandicap?: boolean
  allRoundPlayerHandicaps?: Record<string, number | null>
  initialHoleStrokes?: Record<number, string[]>
  bankerMinBet?: number
  bankerSideGame?: boolean
  initialBankerHoles?: Record<number, { bankerPlayerId: string | null; maxBet: number }>
  initialBankerBets?: Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>
  sideGameGroupScores?: { player_id: string; hole_number: number; strokes: number }[]
}) {
  const isDaytona = format === 'daytona'
  const isDaytonaMode = isDaytona || !!isDaytonaSideGame
  const isFlares = daytonaVariant === '5man-flares'
  const is5Man = isDaytonaMode && (daytonaVariant === '5man-normal' || daytonaVariant === '5man-flares')
  const leftLabel = isFlares ? 'Out' : 'Left'
  const rightLabel = isFlares ? 'In' : 'Right'

  const [strokes, setStrokes] = useState<Record<string, Record<number, number>>>(() => {
    const s: Record<string, Record<number, number>> = {}
    for (const sc of initialScores) {
      if (!s[sc.player_id]) s[sc.player_id] = {}
      s[sc.player_id][sc.hole_number] = sc.strokes
    }
    return s
  })

  const [savedHoles, setSavedHoles] = useState<Set<number>>(() => {
    const saved = new Set<number>()
    for (let h = 1; h <= 18; h++) {
      if (players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h))) {
        saved.add(h)
      }
    }
    return saved
  })

  const [savedScores, setSavedScores] = useState<Score[]>(initialScores)
  const [pendingHoles, setPendingHoles] = useState<Set<number>>(new Set())
  const [expandedHole, setExpandedHole] = useState<number | null>(() => {
    // Auto-expand the current (first unsaved) hole when the page loads
    const saved = new Set<number>()
    for (let h = 1; h <= 18; h++) {
      if (players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h))) {
        saved.add(h)
      }
    }
    return holes.find((h) => !saved.has(h.hole_number))?.hole_number ?? null
  })
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [roundComplete, setRoundComplete] = useState(false)
  const [showPayoutsModal, setShowPayoutsModal] = useState(false)
  const [playerPopup, setPlayerPopup] = useState<string | null>(null)
  const [popupShowScorecard, setPopupShowScorecard] = useState(false)
  const [payoutsData, setPayoutsData] = useState<PayoutsData | null>(null)
  const [payoutsLoading, setPayoutsLoading] = useState(false)
  const [showDaytonaResultsModal, setShowDaytonaResultsModal] = useState(false)
  const [showBankerResultsModal, setShowBankerResultsModal] = useState(false)
  const [showMatchupResultsModal, setShowMatchupResultsModal] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [showScorecards, setShowScorecards] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [showStrokesPanel, setShowStrokesPanel] = useState<number | null>(null)
  const [holeStrokes, setHoleStrokes] = useState<Record<number, string[]>>(initialHoleStrokes)
  const [strokesPending, setStrokesPending] = useState(false)

  const isBanker = format === 'banker' || bankerSideGame

  function bankerMultiplier(net: number, par: number): number {
    if (net <= par - 2) return 3  // eagle or better → 3×
    if (net === par - 1) return 2  // birdie → 2×
    return 1
  }
  const [bankerHoles, setBankerHoles] = useState<Record<number, { bankerPlayerId: string | null; maxBet: number }>>(initialBankerHoles)
  const [bankerBets, setBankerBets] = useState<Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>>(initialBankerBets)

  function netSaved(playerId: string, holeNumber: number): number | undefined {
    const gross = savedScores.find((s) => s.player_id === playerId && s.hole_number === holeNumber)?.strokes
    if (gross === undefined) return undefined
    return gross - ((holeStrokes[holeNumber] ?? []).includes(playerId) ? 1 : 0)
  }
  function netEdit(playerId: string, holeNumber: number, par: number): number {
    const gross = strokes[playerId]?.[holeNumber] ?? par
    return gross - ((holeStrokes[holeNumber] ?? []).includes(playerId) ? 1 : 0)
  }

  const bankerRunningTotals = useMemo(() => {
    if (!isBanker) return {}
    const totals: Record<string, number> = {}
    for (const p of players) totals[p.id] = 0
    for (const hole of holes) {
      if (!savedHoles.has(hole.hole_number)) continue
      const hd = bankerHoles[hole.hole_number]
      if (!hd?.bankerPlayerId) continue
      const bankerId = hd.bankerPlayerId
      const bankerNet = netSaved(bankerId, hole.hole_number)
      if (bankerNet === undefined) continue
      for (const p of players) {
        if (p.id === bankerId) continue
        const playerNet = netSaved(p.id, hole.hole_number)
        if (playerNet === undefined) continue
        const bet = bankerBets[hole.hole_number]?.[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
        if (bet.baseBet <= 0) continue
        const effective = bet.baseBet * (bet.playerDoubled ? 2 : 1) * (bet.bankerDoubled ? 2 : 1)
        let result = 0
        if (playerNet < bankerNet) result = effective * bankerMultiplier(playerNet, hole.par)
        else if (playerNet > bankerNet) result = -effective * bankerMultiplier(bankerNet, hole.par)
        totals[p.id] = (totals[p.id] ?? 0) + result
        totals[bankerId] = (totals[bankerId] ?? 0) - result
      }
    }
    return totals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBanker, savedHoles, bankerHoles, bankerBets, bankerMinBet, savedScores, holeStrokes, holes, players])

  async function handleSaveBankerHole(holeNumber: number, bankerPlayerId: string | null, maxBet: number) {
    setBankerHoles((prev) => ({ ...prev, [holeNumber]: { bankerPlayerId, maxBet } }))
    await saveBankerHole(roundId, team.id, holeNumber, bankerPlayerId, maxBet)
  }
  async function handleSaveBankerBets(holeNumber: number, bets: Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>) {
    setBankerBets((prev) => ({ ...prev, [holeNumber]: bets }))
    const arr = Object.entries(bets).map(([pid, b]) => ({ playerId: pid, baseBet: b.baseBet, playerDoubled: b.playerDoubled, bankerDoubled: b.bankerDoubled }))
    await saveBankerBets(roundId, team.id, holeNumber, arr)
  }

  async function handleBankerDoubleAll(holeNumber: number, currentlyDoubled: boolean) {
    const hd = bankerHoles[holeNumber]
    if (!hd?.bankerPlayerId) return
    const currentBets = bankerBets[holeNumber] ?? {}
    const newBets: Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }> = {}
    for (const p of players) {
      if (p.id === hd.bankerPlayerId) continue
      const pb = currentBets[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
      newBets[p.id] = { ...pb, bankerDoubled: !currentlyDoubled }
    }
    await handleSaveBankerBets(holeNumber, newBets)
  }

  function getAutoStrokes(holeNumber: number): string[] {
    if (!autoHandicap) return []
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole?.stroke_index) return []
    const allHandicaps = Object.values(allRoundPlayerHandicaps).filter((h): h is number => h != null)
    if (allHandicaps.length === 0) return []
    const effHcp = (h: number) => Math.max(0, Math.trunc(h))
    const minHcp = Math.min(...allHandicaps.map(effHcp))
    return players.filter((p) => {
      const hcp = allRoundPlayerHandicaps[p.id] ?? null
      if (hcp == null) return false
      const strokes = effHcp(hcp) - minHcp
      return strokes > 0 && hole.stroke_index! <= strokes
    }).map((p) => p.id)
  }

  function getBankerAutoStrokes(holeNumber: number): string[] {
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole?.stroke_index) return []
    const bankerPlayerId = bankerHoles[holeNumber]?.bankerPlayerId ?? null
    if (!bankerPlayerId) return []
    const bankerHcpRaw = allRoundPlayerHandicaps[bankerPlayerId] ?? null
    if (bankerHcpRaw == null) return []
    const effHcp = (h: number) => Math.max(0, Math.trunc(h))
    const bankerHcp = effHcp(bankerHcpRaw)
    return players.filter((p) => {
      if (p.id === bankerPlayerId) return false
      const hcp = allRoundPlayerHandicaps[p.id] ?? null
      if (hcp == null) return false
      const diff = effHcp(hcp) - bankerHcp
      return diff > 0 && hole.stroke_index! <= diff
    }).map((p) => p.id)
  }

  async function handleStrokesToggle(holeNumber: number, playerId: string) {
    const current = holeStrokes[holeNumber] ?? []
    const next = current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    const updated = { ...holeStrokes, [holeNumber]: next }
    setHoleStrokes(updated)
    setStrokesPending(true)
    await saveHoleStrokes(roundId, holeNumber, next)
    setStrokesPending(false)
  }
  const [showEnterPinModal, setShowEnterPinModal] = useState(false)
  const [pinTeams, setPinTeams] = useState<{ id: string; name: string }[]>([])
  const [pinTeamId, setPinTeamId] = useState('')
  const [pinValue, setPinValue] = useState('')
  const [showPinValue, setShowPinValue] = useState(false)
  const [pinError, setPinError] = useState('')
  const [pinPending, setPinPending] = useState(false)

  async function openEnterPinModal() {
    setShowOptions(false)
    setPinTeamId(''); setPinValue(''); setPinError(''); setShowPinValue(false)
    setShowEnterPinModal(true)
    if (pinTeams.length === 0) {
      const { data } = await supabase.from('teams').select('id, name').eq('round_id', roundId).order('name')
      setPinTeams(data ?? [])
    }
  }

  async function handleEnterPin(e: React.FormEvent) {
    e.preventDefault()
    setPinError(''); setPinPending(true)
    try {
      const res = await fetch('/api/team-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: pinTeamId, pin: pinValue }),
      })
      const data = await res.json()
      if (!data.success) { setPinError(data.error ?? 'Incorrect PIN. Try again.'); return }
      await fetch('/api/team-logout', { method: 'POST', credentials: 'include' })
      window.location.href = `/${orgSlug}/score/${data.teamId}`
    } catch { setPinError('Network error. Please try again.') }
    finally { setPinPending(false) }
  }

  async function handleSignOut() {
    await fetch('/api/org-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })
    window.location.href = isMaster ? '/master/dashboard' : '/'
  }

  // First hole that hasn't been saved yet — holes beyond this cannot be opened
  const currentHole = holes.find((h) => !savedHoles.has(h.hole_number))?.hole_number ?? null

  async function openPayoutsModal() {
    setShowPayoutsModal(true)
    if (payoutsData) return
    setPayoutsLoading(true)
    const { data: teams } = await supabase.from('teams').select('id, name, daytona_variant').eq('round_id', roundId)
    const allTeamIds = (teams ?? []).map((t) => t.id)
    const [{ data: allPlayers }, { data: allScores }, { data: ballValues }, { data: dtAssignments }, { data: matchupsData }, { data: bbMatchupsData }, { data: dtHoleValuesRaw }, { data: bankerHolesRaw }, { data: bankerBetsRaw }, { data: holeStrokesRaw }] = await Promise.all([
      supabase.from('players').select('id, team_id, name, position').in('team_id', allTeamIds.length ? allTeamIds : ['']).order('position', { ascending: true }),
      supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', roundPlayerIds.length ? roundPlayerIds : ['']),
      supabase.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId).order('ball_number'),
      (isDaytona || isDaytonaSideGame)
        ? supabase.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
        : Promise.resolve({ data: [] }),
      supabase.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', roundId),
      supabase.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', roundId),
      (isDaytona || isDaytonaSideGame) ? supabase.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', roundId) : Promise.resolve({ data: [] }),
      bankerSideGame && allTeamIds.length ? supabase.from('banker_holes').select('team_id, hole_number, banker_player_id, max_bet').eq('round_id', roundId).in('team_id', allTeamIds) : Promise.resolve({ data: [] }),
      bankerSideGame && allTeamIds.length ? supabase.from('banker_bets').select('team_id, hole_number, player_id, base_bet, player_doubled, banker_doubled').eq('round_id', roundId).in('team_id', allTeamIds) : Promise.resolve({ data: [] }),
      bankerSideGame && roundPlayerIds.length ? supabase.from('hole_strokes').select('hole_number, player_id').eq('round_id', roundId).in('player_id', roundPlayerIds) : Promise.resolve({ data: [] }),
    ])
    const payoutsHoleValues: Record<string, Record<number, number>> = {}
    for (const hv of (dtHoleValuesRaw ?? []) as { team_id: string; hole_number: number; value_per_point: number }[]) {
      if (!payoutsHoleValues[hv.team_id]) payoutsHoleValues[hv.team_id] = {}
      payoutsHoleValues[hv.team_id][hv.hole_number] = hv.value_per_point
    }
    setPayoutsData({
      teams: teams ?? [],
      players: allPlayers ?? [],
      scores: allScores ?? [],
      ballValues: ballValues ?? [],
      assignments: (dtAssignments ?? []) as DaytonaHoleAssignment[],
      matchups: (matchupsData ?? []) as SavedMatchup[],
      bestBallMatchups: (bbMatchupsData ?? []) as BestBallMatchup[],
      holeValues: payoutsHoleValues,
      bankerHolesAll: (bankerHolesRaw ?? []) as { team_id: string; hole_number: number; banker_player_id: string | null; max_bet: number }[],
      bankerBetsAll: (bankerBetsRaw ?? []) as { team_id: string; hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[],
      holeStrokesAll: (holeStrokesRaw ?? []) as { hole_number: number; player_id: string }[],
    })
    setPayoutsLoading(false)
  }

  async function checkRoundComplete() {
    if (roundPlayerIds.length === 0) return
    const { count } = await supabase
      .from('scores')
      .select('*', { count: 'exact', head: true })
      .in('player_id', roundPlayerIds)
    setRoundComplete(count !== null && count >= roundPlayerIds.length * holes.length)
  }

  const broadcastChannel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    const ch = supabase.channel('score-updates')
      .on('broadcast', { event: 'refresh' }, async () => {
        const [scoresRes, assignRes] = await Promise.all([
          supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds),
          isDaytonaMode && roundId && playerIds.length
            ? supabase.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId).in('player_id', playerIds)
            : Promise.resolve({ data: null }),
        ])
        if (scoresRes.data) {
          setSavedScores(scoresRes.data)
          setSavedHoles(() => {
            const saved = new Set<number>()
            for (let h = 1; h <= 18; h++) {
              if (players.every((p) => scoresRes.data!.some((s) => s.player_id === p.id && s.hole_number === h))) {
                saved.add(h)
              }
            }
            return saved
          })
        }
        if (assignRes.data) {
          setAssignments(() => {
            const m: AssignmentMap = {}
            for (const a of assignRes.data!) {
              if (!m[a.hole_number]) m[a.hole_number] = {}
              m[a.hole_number][a.player_id] = a.side as DaytonaSide
            }
            return m
          })
        }
        checkRoundComplete()
      })
      .subscribe()
    broadcastChannel.current = ch
    return () => { supabase.removeChannel(ch); broadcastChannel.current = null }
  }, [players])

  useEffect(() => {
    checkRoundComplete()
  }, [])

  // Scroll a hole card into view just below the sticky header with a small gap
  function scrollHoleIntoView(holeNumber: number, behavior: ScrollBehavior) {
    const el = document.getElementById(`hole-${holeNumber}`)
    if (!el) return
    const header = document.querySelector('header')
    const headerHeight = header?.offsetHeight ?? 96
    const top = el.getBoundingClientRect().top + window.scrollY - headerHeight - 8
    window.scrollTo({ top, behavior })
  }

  // On page load, scroll so the last saved hole (just above the current hole) is visible
  const didInitialScrollRef = useRef(false)
  useEffect(() => {
    if (didInitialScrollRef.current || expandedHole === null) return
    didInitialScrollRef.current = true
    setTimeout(() => {
      const holeNums = holes.map((h) => h.hole_number)
      const currentIdx = holeNums.indexOf(expandedHole)
      // If there's a previous hole, scroll to it so saved ✓ + current are both visible
      const scrollTarget = currentIdx > 0 ? holeNums[currentIdx - 1] : expandedHole
      scrollHoleIntoView(scrollTarget, 'auto')
    }, 50)
  }, [expandedHole])

  // Per-hole press (custom payout value) state
  const [holeValues, setHoleValues] = useState<Record<number, number>>(initialHoleValues)
  const [pressShowInput, setPressShowInput] = useState<Record<number, boolean>>({})
  const [pressValueStr, setPressValueStr] = useState<Record<number, string>>({})
  const [pressScope, setPressScope] = useState<Record<number, 'this' | 'forward'>>({})
  const [pressConfirmHole, setPressConfirmHole] = useState<number | null>(null)

  // Daytona Left/Right assignments per hole
  const [assignments, setAssignments] = useState<AssignmentMap>(() => {
    const m: AssignmentMap = {}
    for (const a of initialAssignments) {
      if (!m[a.hole_number]) m[a.hole_number] = {}
      m[a.hole_number][a.player_id] = a.side as DaytonaSide
    }
    // Pre-initialize an empty assignment map for the current hole so side buttons show immediately
    if (isDaytonaMode) {
      const saved = new Set<number>()
      for (let h = 1; h <= 18; h++) {
        if (players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h))) {
          saved.add(h)
        }
      }
      const firstUnsaved = holes.find((h) => !saved.has(h.hole_number))?.hole_number
      if (firstUnsaved !== undefined && !m[firstUnsaved]) m[firstUnsaved] = {}
    }
    return m
  })

  function setStroke(playerId: string, hole: number, val: number) {
    setStrokes((s) => ({ ...s, [playerId]: { ...s[playerId], [hole]: Math.max(1, Math.min(20, val)) } }))
  }

  function setSideExplicit(holeNumber: number, playerId: string, side: DaytonaSide) {
    setAssignments((prev) => {
      const holeMap = prev[holeNumber] ?? {}
      return { ...prev, [holeNumber]: { ...holeMap, [playerId]: side } }
    })
  }

  function expandHole(holeNumber: number) {
    // Block holes beyond the current (first unsaved) hole
    if (!savedHoles.has(holeNumber) && currentHole !== null && holeNumber > currentHole) return
    setExpandedHole((prev) => {
      if (prev === holeNumber) return null
      if (isDaytonaMode && !assignments[holeNumber]) {
        if (savedHoles.has(holeNumber)) {
          // Re-editing a saved hole that lost its assignment data — restore defaults
          const def = defaultAssignmentForHole(players, holeNumber, assignments)
          setAssignments((a) => ({ ...a, [holeNumber]: def }))
        } else {
          // New hole: start with no assignments so user must explicitly select each side
          setAssignments((a) => ({ ...a, [holeNumber]: {} }))
        }
      }
      return holeNumber
    })
  }

  async function saveHole(holeNumber: number) {
    const holeAssignments = assignments[holeNumber] ?? {}
    const leftCount = Object.values(holeAssignments).filter((s) => s === 'left').length

    if (isDaytonaMode && leftCount !== 2) {
      setErrors((e) => ({ ...e, [holeNumber]: 'Assign exactly 2 players to Left before saving.' }))
      return
    }

    const playerScores = players.map((p) => ({
      playerId: p.id,
      strokes: strokes[p.id]?.[holeNumber] ?? holes.find((h) => h.hole_number === holeNumber)?.par ?? 4,
    }))

    setPendingHoles((p) => new Set([...p, holeNumber]))

    // Determine press value entries to save alongside this hole
    const pressEntries: { holeNumber: number; valuePerPoint: number | null }[] = []
    if (isDaytonaMode && roundId) {
      if (pressShowInput[holeNumber]) {
        const rawVal = parseFloat(pressValueStr[holeNumber] ?? '')
        const pressVal = isNaN(rawVal) || rawVal <= 0 ? null : rawVal
        const scope = pressScope[holeNumber] ?? 'this'
        const affectedHoles = scope === 'forward'
          ? holes.filter((h) => h.hole_number >= holeNumber).map((h) => h.hole_number)
          : [holeNumber]
        for (const hn of affectedHoles) pressEntries.push({ holeNumber: hn, valuePerPoint: pressVal })
      }
    }

    const [result, , pressRes] = await Promise.all([
      submitHoleScores(team.id, holeNumber, playerScores),
      isDaytonaMode && roundId
        ? saveDaytonaAssignments(
            roundId,
            holeNumber,
            Object.entries(holeAssignments).map(([playerId, side]) => ({ playerId, side }))
          )
        : Promise.resolve(),
      isDaytonaMode && roundId && pressEntries.length > 0
        ? saveDaytonaHoleValues(roundId, team.id, pressEntries)
        : Promise.resolve(null),
    ])

    setPendingHoles((p) => { const n = new Set(p); n.delete(holeNumber); return n })

    if (result.error) {
      setErrors((e) => ({ ...e, [holeNumber]: result.error! }))
    } else if (pressRes && typeof pressRes === 'object' && 'error' in pressRes && pressRes.error) {
      setErrors((e) => ({ ...e, [holeNumber]: `Press save failed: ${pressRes.error}` }))
    } else {
      // Commit press values to local state
      if (pressEntries.length > 0) {
        setHoleValues((prev) => {
          const next = { ...prev }
          for (const e of pressEntries) {
            if (e.valuePerPoint === null) delete next[e.holeNumber]
            else next[e.holeNumber] = e.valuePerPoint
          }
          return next
        })
        setPressShowInput((prev) => { const n = { ...prev }; delete n[holeNumber]; return n })
        setPressValueStr((prev) => { const n = { ...prev }; delete n[holeNumber]; return n })
        setPressScope((prev) => { const n = { ...prev }; delete n[holeNumber]; return n })
      }
      setSavedHoles((s) => new Set([...s, holeNumber]))
      setSavedScores((prev) => {
        const ids = players.map((p) => p.id)
        const without = prev.filter((s) => !(ids.includes(s.player_id) && s.hole_number === holeNumber))
        const added = playerScores.map(({ playerId, strokes: st }) => ({
          player_id: playerId, hole_number: holeNumber, strokes: st,
        }))
        return [...without, ...added]
      })
      setErrors((e) => { const n = { ...e }; delete n[holeNumber]; return n })
      // Auto-advance to the next unsaved hole
      const nextHole = holes.find((h) => !savedHoles.has(h.hole_number) && h.hole_number !== holeNumber)?.hole_number ?? null
      if (isDaytonaMode && nextHole !== null && !assignments[nextHole]) {
        setAssignments((a) => ({ ...a, [nextHole]: {} }))
      }
      setExpandedHole(nextHole)
      const justFinished = !nextHole && !savedHoles.has(holeNumber)
      if (justFinished) {
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100)
      } else {
        setTimeout(() => scrollHoleIntoView(holeNumber, 'smooth'), 100)
      }
      broadcastChannel.current?.send({ type: 'broadcast', event: 'refresh', payload: {} })
      checkRoundComplete()
    }
  }

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)
  const playerIds = players.map((p) => p.id)

  const frontSummary = !isDaytonaMode ? computeTeamBallSummary(frontHoles, playerIds, savedScores, ballsCount) : null
  const backSummary = !isDaytonaMode ? computeTeamBallSummary(backHoles, playerIds, savedScores, ballsCount) : null

  // Convert assignments map to flat array for summary functions
  const flatAssignments: DaytonaHoleAssignment[] = isDaytonaMode
    ? Object.entries(assignments).flatMap(([hn, map]) =>
        Object.entries(map).map(([pid, side]) => ({ player_id: pid, hole_number: Number(hn), side }))
      )
    : []

  const dtSummary = isDaytonaMode ? computeDaytonaSidesSummary(holes, savedScores, flatAssignments) : null
  const playerPointTotals = isDaytonaMode ? computePlayerDaytonaPoints(holes, savedScores, flatAssignments, daytonaVariant) : new Map<string, number>()

  const frontBallTotals = !isDaytonaMode
    ? Array.from({ length: ballsCount }, (_, bi) =>
        frontHoles.reduce((sum, h) => {
          const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
          return sum + (computeHoleBallScores(hps, ballsCount)[bi] ?? h.par)
        }, 0)
      )
    : []
  const backBallTotals = !isDaytonaMode
    ? Array.from({ length: ballsCount }, (_, bi) =>
        backHoles.reduce((sum, h) => {
          const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
          return sum + (computeHoleBallScores(hps, ballsCount)[bi] ?? h.par)
        }, 0)
      )
    : []

  const savedCount = savedHoles.size

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {showOptions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowOptions(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Options</h2>
              <button onClick={() => setShowOptions(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              <button onClick={() => { setShowOptions(false); setShowScorecards(true) }}
                className="w-full text-center py-3 rounded-xl font-semibold text-sm"
                style={{ background: gold, color: navy }}>
                Scorecards
              </button>
              {isAdmin ? (
                <>
                  <a href={`/${orgSlug}/admin/dashboard`} className="w-full text-center py-3 rounded-xl font-semibold text-sm" style={{ background: navy, color: 'white' }}>
                    Admin Hub
                  </a>
                  <button onClick={openEnterPinModal} className="w-full py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: navy, color: navy }}>
                    Enter New PIN
                  </button>
                </>
              ) : (
                <a href={`/${orgSlug}/admin`} className="w-full text-center py-3 rounded-xl font-semibold text-sm" style={{ background: navy, color: 'white' }}>
                  Admin Login
                </a>
              )}
              {isMaster && (
                <a href="/master/dashboard" className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: '#f59e0b', color: '#92400e', background: '#fffbeb' }}>
                  ← Master Admin
                </a>
              )}
              {!isMaster && (showSignOutConfirm ? (
                <div className="space-y-2">
                  <p className="text-sm text-center text-gray-700 font-medium">Sign out of this group?</p>
                  <div className="flex gap-2">
                    <button onClick={handleSignOut} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white" style={{ background: '#dc2626' }}>Sign Out</button>
                    <button onClick={() => setShowSignOutConfirm(false)} className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowSignOutConfirm(true)} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#6b7280' }}>
                  Sign Out of {orgName}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showScorecards && (
        <ScorecardBottomSheet
          title={team.name}
          players={players}
          holes={holes}
          scores={savedScores}
          onClose={() => setShowScorecards(false)}
          isDaytonaMode={isDaytonaMode}
          assignments={assignments}
          holeStrokes={holeStrokes}
          holeValues={holeValues}
          dtPayoutValue={defaultDtPayoutValue}
          is5Man={is5Man}
          isFlares={isFlares}
          isBankerMode={isBanker}
          bankerHoles={bankerHoles}
          bankerBets={bankerBets}
          bankerMinBet={bankerMinBet}
        />
      )}

      {/* Enter New PIN modal */}
      {showEnterPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => !pinPending && setShowEnterPinModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Enter New PIN</h2>
              <button onClick={() => setShowEnterPinModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleEnterPin} className="space-y-3">
              {pinError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pinError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team</label>
                <select value={pinTeamId} onChange={(e) => setPinTeamId(e.target.value)} required className="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-gray-900 text-sm focus:outline-none">
                  <option value="" disabled>Select your team…</option>
                  {pinTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team PIN</label>
                <div className="relative">
                  <input
                    type={showPinValue ? 'text' : 'password'}
                    value={pinValue}
                    onChange={(e) => setPinValue(e.target.value)}
                    inputMode="numeric"
                    maxLength={4}
                    required
                    placeholder="4-digit PIN"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-gray-900 text-sm focus:outline-none"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPinValue(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none">
                    {showPinValue
                      ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'1rem',height:'1rem'}}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={pinPending} className="w-full text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-60 transition active:scale-95" style={{ background: navy }}>
                {pinPending ? 'Verifying…' : 'Open Scorecard'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="text-white px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Score Entry</p>
              <h1 className="font-bold text-lg">
                {team.name}
                {daytonaVariant === '5man-flares' && isDaytonaSideGame && (
                  <span className="ml-1.5 text-sm font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>(Flares)</span>
                )}
              </h1>
              <div className="flex items-center gap-1.5 mt-1">
                {isAdmin && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>Admin</span>}
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>Scorer</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowScorecards(true)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold border"
                style={{ background: navy, color: '#9ca3af', borderColor: '#6b7280' }}>
                Scorecards
              </button>
              <a href={`/${orgSlug}`} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: gold, color: navy }}>Leaderboard</a>
            </div>
          </div>
          {!isDaytonaMode && format !== 'traditional' && (
            <div className="flex gap-3">
              {([{ label: 'Front 9', s: frontSummary }, { label: 'Back 9', s: backSummary }] as const).map(({ label, s }) => (
                <div key={label} className="flex-1">
                  <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
                  <div className="flex gap-3">
                    {Array.from({ length: ballsCount }, (_, i) => {
                      const vp = s?.ballVsPar[i] ?? null
                      return (
                        <div key={i} className="text-center">
                          <p className="text-xs" style={{ color: gold }}>{i + 1}B</p>
                          <p className="font-bold text-sm" style={{ color: vp == null ? 'rgba(255,255,255,0.35)' : 'white' }}>
                            {vp == null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Player score to par — Traditional (no side game) */}
          {format === 'traditional' && !isDaytonaSideGame && (
            <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-1">
              {players.map((p) => {
                const pScores = savedScores.filter((s) => s.player_id === p.id)
                const pStrokes = pScores.reduce((sum, s) => sum + s.strokes, 0)
                const pPar = holes.filter((h) => pScores.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
                const vspar = pScores.length > 0 ? pStrokes - pPar : null
                const vsparStr = vspar === null ? '–' : vspar === 0 ? 'E' : vspar > 0 ? `+${vspar}` : String(vspar)
                return (
                  <div key={p.id} className="flex items-center gap-1 text-xs">
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>{p.name.split(' ')[0]}:</span>
                    <span className="font-bold" style={{ color: vspar === null ? 'rgba(255,255,255,0.35)' : vspar < 0 ? '#4ade80' : vspar > 0 ? '#f87171' : 'rgba(255,255,255,0.55)' }}>
                      {vsparStr}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Banker running totals */}
          {isBanker && Object.keys(bankerRunningTotals).length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-1">
              {players.map((p) => {
                const amt = bankerRunningTotals[p.id] ?? 0
                return (
                  <div key={p.id} className="flex items-center gap-1 text-xs">
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>{p.name.split(' ')[0]}:</span>
                    <span className="font-bold" style={{ color: amt > 0 ? '#4ade80' : amt < 0 ? '#f87171' : 'rgba(255,255,255,0.4)' }}>
                      {amt > 0 ? `+$${amt.toFixed(2)}` : amt < 0 ? `-$${Math.abs(amt).toFixed(2)}` : '$0'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Player running point totals — Daytona / side game */}
          {isDaytonaMode && playerPointTotals.size > 0 && (
            <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-1">
              {players.map((p) => {
                const pts = playerPointTotals.get(p.id) ?? 0
                return (
                  <div key={p.id} className="flex items-center gap-1 text-xs">
                    <button
                      onClick={() => { setPopupShowScorecard(false); setPlayerPopup((prev) => prev === p.id ? null : p.id) }}
                      className="font-medium underline-offset-2 hover:underline"
                      style={{ color: 'rgba(255,255,255,0.55)' }}>
                      {p.name.split(' ')[0]}:
                    </button>
                    <span className="font-bold" style={{ color: pts > 0 ? '#4ade80' : pts < 0 ? '#f87171' : 'rgba(255,255,255,0.4)' }}>
                      {pts > 0 ? `+${pts}` : pts}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </header>

      {playerPopup && (() => {
        const p = players.find((pl) => pl.id === playerPopup)
        if (!p) return null
        const pScores = savedScores.filter((s) => s.player_id === p.id)
        const scoreMap = Object.fromEntries(pScores.map((s) => [s.hole_number, s.strokes]))
        const frontHoles = holes.filter((h) => h.hole_number <= 9).sort((a, b) => a.hole_number - b.hole_number)
        const backHoles = holes.filter((h) => h.hole_number >= 10).sort((a, b) => a.hole_number - b.hole_number)
        const frontScores = pScores.filter((s) => s.hole_number <= 9)
        const backScores = pScores.filter((s) => s.hole_number >= 10)
        const fStrokes = frontScores.reduce((s, sc) => s + sc.strokes, 0)
        const bStrokes = backScores.reduce((s, sc) => s + sc.strokes, 0)
        const fPar = holes.filter((h) => h.hole_number <= 9 && frontScores.some((s) => s.hole_number === h.hole_number)).reduce((s, h) => s + h.par, 0)
        const bPar = holes.filter((h) => h.hole_number >= 10 && backScores.some((s) => s.hole_number === h.hole_number)).reduce((s, h) => s + h.par, 0)
        const tStrokes = pScores.reduce((s, sc) => s + sc.strokes, 0)
        const tPar = holes.filter((h) => pScores.some((s) => s.hole_number === h.hole_number)).reduce((s, h) => s + h.par, 0)
        const fVp = frontScores.length > 0 ? fStrokes - fPar : null
        const bVp = backScores.length > 0 ? bStrokes - bPar : null
        const tVp = pScores.length > 0 ? tStrokes - tPar : null
        const fmt = (v: number | null) => v === null ? '–' : v === 0 ? 'E' : v > 0 ? `+${v}` : String(v)
        const col = (v: number | null) => v === null ? '#9ca3af' : v < 0 ? '#16a34a' : v > 0 ? '#dc2626' : '#111827'

        // Hole points map for Daytona
        const holePtsMaps = new Map<number, Map<string, number>>()
        if (isDaytonaMode) {
          for (const hole of holes) {
            const ha = flatAssignments.filter((a) => a.hole_number === hole.hole_number)
            const leftIds = ha.filter((a) => a.side === 'left').map((a) => a.player_id)
            const rightIds = ha.filter((a) => a.side === 'right').map((a) => a.player_id)
            if (is5Man) {
              if (leftIds.length >= 2 && rightIds.length >= 3)
                holePtsMaps.set(hole.hole_number, computeHoleDaytonaPointsFiveMan(leftIds, rightIds, savedScores, hole.hole_number, hole.par))
            } else if (leftIds.length >= 2 && rightIds.length >= 2) {
              const lSc = leftIds.map((id) => savedScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
              const rSc = rightIds.map((id) => savedScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
              if (lSc.length >= 2 && rSc.length >= 2) {
                const { leftDt, rightDt } = computeHoleDaytonaWithSides(lSc, rSc, hole.par)
                if (leftDt !== null && rightDt !== null) {
                  const diff = Math.abs(leftDt - rightDt)
                  const lW = leftDt < rightDt, rW = rightDt < leftDt
                  const m = new Map<string, number>()
                  for (const id of leftIds) m.set(id, lW ? diff : rW ? -diff : 0)
                  for (const id of rightIds) m.set(id, rW ? diff : lW ? -diff : 0)
                  holePtsMaps.set(hole.hole_number, m)
                }
              }
            }
          }
        }
        const frontPts = frontHoles.some((h) => holePtsMaps.get(h.hole_number)?.has(p.id))
          ? frontHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(p.id) ?? 0), 0) : null
        const backPts = backHoles.some((h) => holePtsMaps.get(h.hole_number)?.has(p.id))
          ? backHoles.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(p.id) ?? 0), 0) : null
        const totalPts = holePtsMaps.size > 0 && [...holePtsMaps.values()].some((m) => m.has(p.id))
          ? [...holePtsMaps.values()].reduce((s, m) => s + (m.get(p.id) ?? 0), 0) : null
        const pStr = (v: number | null) => v === null ? '–' : v === 0 ? '0' : v > 0 ? `+${v}` : String(v)
        const pCol = (v: number | null) => v === null ? '#d1d5db' : v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#374151'

        const thSt = (hi?: boolean, isHole?: boolean): React.CSSProperties => ({
          background: hi ? '#4a7fa5' : isHole ? '#dde4ee' : navy,
          color: hi ? 'white' : isHole ? navy : 'white',
          fontWeight: 700, fontSize: '0.6rem', textAlign: 'center', padding: '0.35rem 0.2rem', whiteSpace: 'nowrap',
        })
        const tdP = (hi?: boolean): React.CSSProperties => ({
          background: hi ? '#dbeafe' : 'white', color: hi ? '#1e40af' : '#6b7280',
          fontWeight: hi ? 700 : 400, fontSize: '0.65rem', textAlign: 'center', padding: '0.3rem 0.2rem',
        })
        const tdC = (hi?: boolean): React.CSSProperties => ({
          background: hi ? '#dbeafe' : 'white', fontWeight: hi ? 700 : 400,
          color: hi ? '#1e40af' : undefined, fontSize: '0.65rem', textAlign: 'center', padding: '0.2rem 0.15rem',
        })
        const isFlares = daytonaVariant === '5man-flares'
        const frontPar = frontHoles.reduce((s, h) => s + h.par, 0)
        const backPar = backHoles.reduce((s, h) => s + h.par, 0)
        const totalPar = holes.reduce((s, h) => s + h.par, 0)

        return (
          <div className="fixed inset-0 z-40" onClick={() => setPlayerPopup(null)}>
            <div
              className={`absolute bg-white rounded-2xl shadow-xl border border-gray-200 ${popupShowScorecard ? 'left-2 right-2' : 'left-4 right-4 max-w-xs mx-auto'}`}
              style={{ top: '5rem' }}
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-gray-900 text-sm">{p.name}</p>
                  <button
                    onClick={() => setPopupShowScorecard((v) => !v)}
                    className="text-xs font-semibold px-2 py-0.5 rounded-md border transition"
                    style={popupShowScorecard
                      ? { background: navy, color: 'white', borderColor: navy }
                      : { background: 'white', color: '#6b7280', borderColor: '#d1d5db' }}>
                    Scorecard
                  </button>
                </div>
                <button onClick={() => setPlayerPopup(null)} className="text-gray-400 text-lg font-bold leading-none">×</button>
              </div>
              <div className="flex justify-around text-center px-4 pb-4">
                {[{ label: 'Front 9', v: fVp }, { label: 'Back 9', v: bVp }, { label: 'Total', v: tVp }].map(({ label, v }) => (
                  <div key={label}>
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    <p className="text-lg font-bold" style={{ color: col(v) }}>{fmt(v)}</p>
                  </div>
                ))}
              </div>
              {popupShowScorecard && (
                <div className="border-t border-gray-100 overflow-x-auto">
                  <table className="border-collapse" style={{ minWidth: '520px', width: '100%' }}>
                    <thead style={{ borderTop: '1px solid #e5e7eb' }}>
                      <tr>
                        <th style={{ ...thSt(false, true), textAlign: 'left', paddingLeft: '0.5rem', minWidth: '3rem' }}>HOLE</th>
                        {frontHoles.map((h) => <th key={h.hole_number} style={{ ...thSt(false, true), minWidth: '1.75rem' }}>{h.hole_number}</th>)}
                        {frontHoles.length > 0 && <th style={thSt(true)}>Out</th>}
                        {backHoles.map((h) => <th key={h.hole_number} style={{ ...thSt(false, true), minWidth: '1.75rem' }}>{h.hole_number}</th>)}
                        {backHoles.length > 0 && <th style={thSt(true)}>In</th>}
                        <th style={thSt()}>TOT</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ ...tdP(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151' }}>PAR</td>
                        {frontHoles.map((h) => <td key={h.hole_number} style={tdP()}>{h.par}</td>)}
                        {frontHoles.length > 0 && <td style={tdP(true)}>{frontPar}</td>}
                        {backHoles.map((h) => <td key={h.hole_number} style={tdP()}>{h.par}</td>)}
                        {backHoles.length > 0 && <td style={tdP(true)}>{backPar}</td>}
                        <td style={{ ...tdP(), fontWeight: 700, color: '#111827' }}>{totalPar}</td>
                      </tr>
                      <tr style={{ borderBottom: isDaytonaMode ? '1px solid #e5e7eb' : undefined }}>
                        <td style={{ ...tdC(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151' }}>SCORE</td>
                        {frontHoles.map((h) => {
                          const s = scoreMap[h.hole_number] ?? null
                          const hasStroke = (holeStrokes[h.hole_number] ?? []).includes(p.id)
                          return <td key={h.hole_number} style={tdC()}>{s != null ? <><ScoreNotation strokes={s} par={h.par} size="sm" />{hasStroke && <span style={{ color: '#16a34a', fontSize: '0.55rem', fontWeight: 900, verticalAlign: 'super', lineHeight: 0 }}>*</span>}</> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                        })}
                        {frontHoles.length > 0 && <td style={tdC(true)}>{frontScores.length > 0 ? fStrokes : '–'}</td>}
                        {backHoles.map((h) => {
                          const s = scoreMap[h.hole_number] ?? null
                          const hasStroke = (holeStrokes[h.hole_number] ?? []).includes(p.id)
                          return <td key={h.hole_number} style={tdC()}>{s != null ? <><ScoreNotation strokes={s} par={h.par} size="sm" />{hasStroke && <span style={{ color: '#16a34a', fontSize: '0.55rem', fontWeight: 900, verticalAlign: 'super', lineHeight: 0 }}>*</span>}</> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                        })}
                        {backHoles.length > 0 && <td style={tdC(true)}>{backScores.length > 0 ? bStrokes : '–'}</td>}
                        <td style={{ ...tdC(), fontWeight: 700, color: '#111827' }}>{pScores.length > 0 ? tStrokes : '–'}</td>
                      </tr>
                      {isDaytonaMode && <>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdC(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151' }}>PTS</td>
                          {frontHoles.map((h) => {
                            const pts = holePtsMaps.get(h.hole_number)?.has(p.id) ? holePtsMaps.get(h.hole_number)!.get(p.id)! : null
                            return <td key={h.hole_number} style={tdC()}><span style={{ fontWeight: 600, color: pCol(pts), fontSize: '0.65rem' }}>{pStr(pts)}</span></td>
                          })}
                          <td style={tdC(true)}><span style={{ fontWeight: 700, color: pCol(frontPts) }}>{pStr(frontPts)}</span></td>
                          {backHoles.map((h) => {
                            const pts = holePtsMaps.get(h.hole_number)?.has(p.id) ? holePtsMaps.get(h.hole_number)!.get(p.id)! : null
                            return <td key={h.hole_number} style={tdC()}><span style={{ fontWeight: 600, color: pCol(pts), fontSize: '0.65rem' }}>{pStr(pts)}</span></td>
                          })}
                          <td style={tdC(true)}><span style={{ fontWeight: 700, color: pCol(backPts) }}>{pStr(backPts)}</span></td>
                          <td style={{ ...tdC(), fontWeight: 700, color: pCol(totalPts) }}>{pStr(totalPts)}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ ...tdC(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151' }}>TEAM</td>
                          {frontHoles.map((h) => {
                            const side = assignments[h.hole_number]?.[p.id] ?? null
                            const lC = isFlares ? (h.par === 3 ? 'C' : 'O') : 'L'
                            const rC = isFlares ? (h.par === 3 ? 'F' : 'I') : 'R'
                            return <td key={h.hole_number} style={tdC()}>{side ? <span style={{ fontWeight: 700, fontSize: '0.65rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? lC : rC}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdC(true)} />
                          {backHoles.map((h) => {
                            const side = assignments[h.hole_number]?.[p.id] ?? null
                            const lC = isFlares ? (h.par === 3 ? 'C' : 'O') : 'L'
                            const rC = isFlares ? (h.par === 3 ? 'F' : 'I') : 'R'
                            return <td key={h.hole_number} style={tdC()}>{side ? <span style={{ fontWeight: 700, fontSize: '0.65rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? lC : rC}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdC(true)} /><td style={tdC()} />
                        </tr>
                        <tr>
                          <td style={{ ...tdC(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151' }}>PRESS</td>
                          {frontHoles.map((h) => {
                            const pressRate = initialHoleValues[h.hole_number]
                            return <td key={h.hole_number} style={tdC()}>{pressRate !== undefined ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color: '#f59e0b' }}>${pressRate}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdC(true)} />
                          {backHoles.map((h) => {
                            const pressRate = initialHoleValues[h.hole_number]
                            return <td key={h.hole_number} style={tdC()}>{pressRate !== undefined ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color: '#f59e0b' }}>${pressRate}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                          })}
                          <td style={tdC(true)} /><td style={tdC()} />
                        </tr>
                      </>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {showPayoutsModal && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowPayoutsModal(false)}>
          <div className="bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h3 className="font-bold text-gray-900 text-base">{roundComplete ? 'Final Payouts' : 'Payouts'}</h3>
              <button onClick={() => setShowPayoutsModal(false)} className="text-gray-400 text-xl font-bold leading-none">×</button>
            </div>
            <div className="px-4 py-4 space-y-4">
              {payoutsLoading || !payoutsData ? (
                <p className="text-center text-gray-500 text-sm py-8">Loading payouts…</p>
              ) : (() => {
                const frontHolesP = holes.filter((h) => h.hole_number <= 9)
                const backHolesP = holes.filter((h) => h.hole_number >= 10)
                const perBallValue = payoutsData.ballValues.find((bv) => bv.ball_number === 1)?.value_dollars ?? 5
                const dtPayoutValue = perBallValue
                const numSegments = includeTotal ? 3 : 2

                // Score map for matchup computations
                const scoreMapM: Record<string, Record<number, number>> = {}
                for (const s of payoutsData.scores) {
                  if (!scoreMapM[s.player_id]) scoreMapM[s.player_id] = {}
                  scoreMapM[s.player_id][s.hole_number] = s.strokes
                }
                const matchupPayoutsResult = computeMatchupPayouts(payoutsData.matchups, payoutsData.bestBallMatchups, payoutsData.players, scoreMapM, holes)
                const matchupOnlySettlements = minimizeSettlements(payoutsData.players, matchupPayoutsResult.net)

                // Ball/Daytona pool payouts
                const frontSummaries = !isDaytona ? new Map(payoutsData.teams.map((t) => {
                  const tp = payoutsData.players.filter((p) => p.team_id === t.id)
                  return [t.id, computeTeamBallSummary(frontHolesP, tp.map((p) => p.id), payoutsData.scores, ballsCount)]
                })) : new Map()
                const backSummaries = !isDaytona ? new Map(payoutsData.teams.map((t) => {
                  const tp = payoutsData.players.filter((p) => p.team_id === t.id)
                  return [t.id, computeTeamBallSummary(backHolesP, tp.map((p) => p.id), payoutsData.scores, ballsCount)]
                })) : new Map()
                const totalSummaries = (!isDaytona && includeTotal) ? new Map(payoutsData.teams.map((t) => {
                  const tp = payoutsData.players.filter((p) => p.team_id === t.id)
                  return [t.id, computeTeamBallSummary(holes, tp.map((p) => p.id), payoutsData.scores, ballsCount)]
                })) : undefined
                const poolResults = !isDaytona
                  ? calculatePoolPayouts(payoutsData.teams, payoutsData.players, frontSummaries, backSummaries, perBallValue, ballsCount, totalSummaries)
                  : { results: [], playerNet: {} as Record<string, number>, settlements: [] }
                const ballResults = poolResults.results

                // Daytona side game net (reused for both isDaytona and isDaytonaSideGame)
                const isDaytonaShowing = isDaytona || isDaytonaSideGame
                const daytonaNetByPlayer: Record<string, number> = {}
                if (isDaytonaShowing) {
                  for (const t of payoutsData.teams) {
                    const tp = payoutsData.players.filter((p) => p.team_id === t.id)
                    const tpIds = tp.map((p) => p.id)
                    const tAssign = payoutsData.assignments.filter((a) => tpIds.includes(a.player_id))
                    const tScores = payoutsData.scores.filter((s) => tpIds.includes(s.player_id))
                    const tHoleVals = payoutsData.holeValues[t.id] ?? {}
                    const dollarTotals = computePlayerDaytonaDollars(holes, tScores, tAssign, t.daytona_variant ?? daytonaVariant, dtPayoutValue, tHoleVals)
                    const { net: pNet } = settleDaytonaPlayerPoints(tp, dollarTotals, 1)
                    for (const [id, amt] of Object.entries(pNet)) daytonaNetByPlayer[id] = (daytonaNetByPlayer[id] ?? 0) + amt
                  }
                }

                // Banker side game net per player
                const bankerNetByPlayer: Record<string, number> = {}
                if (bankerSideGame) {
                  for (const p of payoutsData.players) bankerNetByPlayer[p.id] = 0
                  for (const t of payoutsData.teams) {
                    const tp = payoutsData.players.filter((p) => p.team_id === t.id)
                    for (const hole of holes) {
                      const hd = payoutsData.bankerHolesAll.find((bh) => bh.team_id === t.id && bh.hole_number === hole.hole_number)
                      if (!hd?.banker_player_id) continue
                      const bankerId = hd.banker_player_id
                      const bankerGross = payoutsData.scores.find((s) => s.player_id === bankerId && s.hole_number === hole.hole_number)?.strokes
                      if (bankerGross === undefined) continue
                      const bankerAdj = payoutsData.holeStrokesAll.some((hs) => hs.hole_number === hole.hole_number && hs.player_id === bankerId) ? 1 : 0
                      const bankerNet = bankerGross - bankerAdj
                      for (const p of tp) {
                        if (p.id === bankerId) continue
                        const pGross = payoutsData.scores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes
                        if (pGross === undefined) continue
                        const pAdj = payoutsData.holeStrokesAll.some((hs) => hs.hole_number === hole.hole_number && hs.player_id === p.id) ? 1 : 0
                        const pNet = pGross - pAdj
                        const bet = payoutsData.bankerBetsAll.find((bb) => bb.team_id === t.id && bb.hole_number === hole.hole_number && bb.player_id === p.id)
                        const baseBet = bet?.base_bet ?? bankerMinBet
                        if (baseBet <= 0) continue
                        const effective = baseBet * (bet?.player_doubled ? 2 : 1) * (bet?.banker_doubled ? 2 : 1)
                        let result = 0
                        if (pNet < bankerNet) result = effective * bankerMultiplier(pNet, hole.par)
                        else if (pNet > bankerNet) result = -effective * bankerMultiplier(bankerNet, hole.par)
                        bankerNetByPlayer[p.id] = (bankerNetByPlayer[p.id] ?? 0) + result
                        bankerNetByPlayer[bankerId] = (bankerNetByPlayer[bankerId] ?? 0) - result
                      }
                    }
                  }
                }

                // Combined net
                const combinedNet: Record<string, number> = {}
                for (const p of payoutsData.players) {
                  const ballNet = isDaytona ? 0 : (poolResults.playerNet[p.id] ?? 0)
                  combinedNet[p.id] = ballNet + (matchupPayoutsResult.net[p.id] ?? 0) + (daytonaNetByPlayer[p.id] ?? 0) + (bankerNetByPlayer[p.id] ?? 0)
                }
                const combinedSettlements = minimizeSettlements(payoutsData.players, combinedNet)

                return (
                  <>
                    {/* ── Daytona Results (collapsible) ── */}
                    {isDaytonaShowing && (
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <button onClick={() => setShowDaytonaResultsModal((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                          <span className="text-sm font-semibold text-gray-800">Daytona Results</span>
                          <span className="text-gray-400 text-xs">{showDaytonaResultsModal ? '▲ Hide' : '▼ Show'}</span>
                        </button>
                        {showDaytonaResultsModal && (
                          <div className="border-t border-gray-100">
                            {payoutsData.teams.map((t, ti) => {
                              const teamPlayers = payoutsData.players.filter((p) => p.team_id === t.id)
                              const tpIds = teamPlayers.map((p) => p.id)
                              const tAssign = payoutsData.assignments.filter((a) => tpIds.includes(a.player_id))
                              const tScores = payoutsData.scores.filter((s) => tpIds.includes(s.player_id))
                              const tHoleVals = payoutsData.holeValues[t.id] ?? {}
                              const dtVariant = t.daytona_variant ?? daytonaVariant
                              const pointTotals = computePlayerDaytonaPoints(holes, tScores, tAssign, dtVariant)
                              const dollarTotals = computePlayerDaytonaDollars(holes, tScores, tAssign, dtVariant, dtPayoutValue, tHoleVals)
                              const { net: playerNet, settlements: playerSettlements } = settleDaytonaPlayerPoints(teamPlayers, dollarTotals, 1)
                              const segments = buildSegmentBreakdown(holes, tScores, tAssign, dtVariant, tHoleVals, dtPayoutValue)
                              return (
                                <div key={t.id} className={ti > 0 ? 'border-t border-gray-100' : ''}>
                                  <div className="px-4 py-2.5"><p className="font-semibold text-gray-900 text-sm">{t.name}</p><p className="text-xs text-gray-400">{formatHoleRateBreakdown(holes, tHoleVals, dtPayoutValue)}</p></div>
                                  <div className="divide-y divide-gray-100">
                                    {teamPlayers.map((p) => { const pts = pointTotals.get(p.id) ?? 0; const dollars = playerNet[p.id] ?? 0; return (
                                      <div key={p.id}>
                                        <div className={`flex items-center px-4 gap-2 ${segments.length > 0 ? 'pt-2 pb-1' : 'py-2.5'}`}>
                                          <span className="flex-1 text-sm text-gray-900">{p.name}</span>
                                          {segments.length === 0 && <span className="text-sm font-semibold tabular-nums w-16 text-right" style={{ color: pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#6b7280' }}>{pts > 0 ? `+${pts}` : pts === 0 ? '0' : pts} pts</span>}
                                          <span className="text-sm font-bold tabular-nums w-20 text-right" style={{ color: dollars > 0 ? '#16a34a' : dollars < 0 ? '#dc2626' : '#6b7280' }}>{dollars > 0 ? `+$${dollars.toFixed(2)}` : dollars < 0 ? `-$${Math.abs(dollars).toFixed(2)}` : 'Even'}</span>
                                        </div>
                                        {segments.length > 0 && (
                                          <div className="px-4 pb-2 flex gap-x-3" style={{ fontSize: segments.length <= 2 ? '12px' : segments.length === 3 ? '10px' : '9px' }}>
                                            {segments.map((seg, si) => { const sp = seg.ptsByPlayer.get(p.id) ?? 0; const sd = Math.round(sp * seg.rate * 100) / 100; return (
                                              <span key={si} className="tabular-nums text-gray-400 whitespace-nowrap">
                                                {seg.label}:{' '}
                                                <span style={{ color: sp > 0 ? '#16a34a' : sp < 0 ? '#dc2626' : '#6b7280' }}>{sp > 0 ? `+${sp}` : sp}pts</span>
                                                {' ('}
                                                <span style={{ color: sd > 0 ? '#16a34a' : sd < 0 ? '#dc2626' : '#6b7280' }}>{sd > 0 ? `+$${sd.toFixed(2)}` : sd < 0 ? `-$${Math.abs(sd).toFixed(2)}` : '$0.00'}</span>
                                                {')'}
                                              </span>
                                            )})}
                                          </div>
                                        )}
                                      </div>
                                    )})}
                                  </div>
                                  {playerSettlements.length > 0 && (<div className="border-t border-gray-100 px-4 py-3"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Settlement</p>{playerSettlements.map((s, i) => (<div key={i} className="flex items-center py-1 gap-2 text-sm"><span className="flex-1"><span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span></span><span className="font-bold text-gray-900">${s.amount.toFixed(2)}</span></div>))}</div>)}
                                  {playerSettlements.length === 0 && teamPlayers.length > 0 && (<p className="text-xs text-gray-400 text-center py-3">{[...pointTotals.values()].every((v) => v === 0) ? 'No holes scored yet.' : 'All even — no payments needed.'}</p>)}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Banker Results (collapsible) ── */}
                    {bankerSideGame && (
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <button onClick={() => setShowBankerResultsModal((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                          <span className="text-sm font-semibold text-gray-800">Banker Results</span>
                          <span className="text-gray-400 text-xs">{showBankerResultsModal ? '▲ Hide' : '▼ Show'}</span>
                        </button>
                        {showBankerResultsModal && (
                          <div className="border-t border-gray-100">
                            {payoutsData.teams.map((t, ti) => {
                              const teamPlayers = payoutsData.players.filter((p) => p.team_id === t.id)
                              const tBankerHoles = payoutsData.bankerHolesAll.filter((bh) => bh.team_id === t.id && !!bh.banker_player_id)
                              if (tBankerHoles.length === 0) return null
                              const tNet: Record<string, number> = {}
                              for (const p of teamPlayers) tNet[p.id] = 0
                              for (const hole of holes) {
                                const hd = tBankerHoles.find((bh) => bh.hole_number === hole.hole_number)
                                if (!hd?.banker_player_id) continue
                                const bankerId = hd.banker_player_id
                                const bankerGross = payoutsData.scores.find((s) => s.player_id === bankerId && s.hole_number === hole.hole_number)?.strokes
                                if (bankerGross === undefined) continue
                                const bankerAdj = payoutsData.holeStrokesAll.some((hs) => hs.hole_number === hole.hole_number && hs.player_id === bankerId) ? 1 : 0
                                const bankerNet = bankerGross - bankerAdj
                                for (const p of teamPlayers) {
                                  if (p.id === bankerId) continue
                                  const pGross = payoutsData.scores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes
                                  if (pGross === undefined) continue
                                  const pAdj = payoutsData.holeStrokesAll.some((hs) => hs.hole_number === hole.hole_number && hs.player_id === p.id) ? 1 : 0
                                  const pNet = pGross - pAdj
                                  const bet = payoutsData.bankerBetsAll.find((bb) => bb.team_id === t.id && bb.hole_number === hole.hole_number && bb.player_id === p.id)
                                  const baseBet = bet?.base_bet ?? bankerMinBet
                                  if (baseBet <= 0) continue
                                  const effective = baseBet * (bet?.player_doubled ? 2 : 1) * (bet?.banker_doubled ? 2 : 1)
                                  let result = 0
                                  if (pNet < bankerNet) result = effective * bankerMultiplier(pNet, hole.par)
                                  else if (pNet > bankerNet) result = -effective * bankerMultiplier(bankerNet, hole.par)
                                  tNet[p.id] = (tNet[p.id] ?? 0) + result
                                  tNet[bankerId] = (tNet[bankerId] ?? 0) - result
                                }
                              }
                              const tSettlements = minimizeSettlements(teamPlayers, tNet)
                              return (
                                <div key={t.id} className={ti > 0 ? 'border-t border-gray-100' : ''}>
                                  <div className="px-4 py-2.5"><p className="font-semibold text-gray-900 text-sm">{t.name}</p></div>
                                  <div className="divide-y divide-gray-100">
                                    {teamPlayers.map((p) => {
                                      const v = Math.round((tNet[p.id] ?? 0) * 100) / 100
                                      return (
                                        <div key={p.id} className="flex items-center px-4 py-2.5 gap-2">
                                          <span className="flex-1 text-sm text-gray-900">{p.name}</span>
                                          <span className="text-sm font-bold tabular-nums w-20 text-right" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>{v > 0 ? `+$${v.toFixed(2)}` : v < 0 ? `-$${Math.abs(v).toFixed(2)}` : 'Even'}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                  {tSettlements.length > 0 && (<div className="border-t border-gray-100 px-4 py-3"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Settlement</p>{tSettlements.map((s, i) => (<div key={i} className="flex items-center py-1 gap-2 text-sm"><span className="flex-1"><span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span></span><span className="font-bold text-gray-900">${s.amount.toFixed(2)}</span></div>))}</div>)}
                                  {tSettlements.length === 0 && teamPlayers.length > 0 && (<p className="text-xs text-gray-400 text-center py-3">All even — no payments needed.</p>)}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Ball Results (standard, not collapsible) ── */}
                    {!isDaytona && (
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100">
                          <h4 className="font-semibold text-gray-900 text-sm">Ball Results</h4>
                          <p className="text-xs text-gray-500">{ballsCount * numSegments} results · ties wash · ${perBallValue}/player</p>
                        </div>
                        <div className="px-4 py-4 space-y-4">
                          {Array.from({ length: ballsCount }, (_, bi) => {
                            const front = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Front 9')
                            const back = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Back 9')
                            const total = includeTotal ? ballResults.find((r) => r.ball === bi + 1 && r.half === 'Total 18') : undefined
                            const segs = includeTotal ? [front, back, total] : [front, back]
                            return (
                              <div key={bi}>
                                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: gold }}>{BALL_NAMES[bi]}</p>
                                <div className={`grid gap-2 ${includeTotal ? 'grid-cols-3' : 'grid-cols-2'}`}>
                                  {segs.map((result, hi) => {
                                    if (!result) return <div key={hi} />
                                    const vp = result.winnerVsPar
                                    const vpStr = vp == null ? '' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                                    const halfLabel = result.half === 'Total 18' ? 'Total' : result.half === 'Front 9' ? 'Front' : 'Back'
                                    return (
                                      <div key={hi} className="bg-gray-50 rounded-lg px-3 py-2">
                                        <p className="text-xs text-gray-500 mb-0.5">{halfLabel}</p>
                                        {!result.played ? <p className="text-sm text-gray-300 font-medium">–</p> : result.tied ? <p className="text-sm text-gray-500 font-medium">Tie</p> : (<><p className="text-sm font-semibold text-green-700 truncate">{result.winnerName}</p>{vpStr && <p className="text-xs text-gray-400">{vpStr}</p>}</>)}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── Matchup Results (collapsible) ── */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <button onClick={() => setShowMatchupResultsModal((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                        <span className="text-sm font-semibold text-gray-800">Matchup Results</span>
                        <span className="text-gray-400 text-xs">{showMatchupResultsModal ? '▲ Hide' : '▼ Show'}</span>
                      </button>
                      {showMatchupResultsModal && (
                        <div className="border-t border-gray-100">
                          {matchupPayoutsResult.rows.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-4">No matchups added yet.</p>
                          ) : (<>
                            {matchupPayoutsResult.rows.map((row, rowIdx) => {
                              const nr = row.nassauResult
                              const fmtAmt = nr ? (nr.amount % 1 === 0 ? String(nr.amount) : nr.amount.toFixed(2)) : ''
                              const overallSeg = !nr && row.segments.length === 1 ? row.segments[0] : null
                              return (
                                <div key={row.id} className={rowIdx > 0 ? 'border-t border-gray-100' : ''}>
                                  <div className="px-4 pt-3 pb-1">
                                    <p className="text-sm font-bold text-gray-800 leading-snug">{row.label}</p>
                                    <p className="text-xs font-medium mt-0.5" style={{ color: row.segments.length === 0 ? '#9ca3af' : gold }}>{row.betLabel}</p>
                                  </div>
                                  {row.segments.length === 0 ? <p className="px-4 pb-3 text-xs text-gray-400 italic">No bet amount set</p> : (
                                    <div className="flex items-center justify-between px-4 pb-3 pt-1 bg-gray-50 mx-3 mb-3 rounded-lg">
                                      <span className="text-xs font-bold text-gray-400 mr-3">Result</span>
                                      <span className="text-xs font-semibold flex-1">
                                        {nr ? (!nr.anySettled ? <span className="text-gray-300">Pending</span> : nr.winnerLabel === null ? <span className="text-gray-400 italic">Tied — push</span> : <span className="text-green-700">{nr.winnerLabel}{nr.swept && <span className="ml-1.5 text-xs font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">SWEEP</span>}</span>) : overallSeg ? (overallSeg.settled ? overallSeg.tied ? <span className="text-gray-400 italic">Tied — push</span> : <span className="text-green-700">{overallSeg.winnerLabel}</span> : <span className="text-gray-300">Pending</span>) : null}
                                      </span>
                                      <span className="text-xs font-bold whitespace-nowrap">
                                        {nr && nr.anySettled && nr.winnerLabel !== null ? <span className="text-green-600">+${fmtAmt}{nr.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span> : overallSeg && overallSeg.settled && !overallSeg.tied ? <span className="text-green-600">+${overallSeg.amount % 1 === 0 ? overallSeg.amount : overallSeg.amount.toFixed(2)}{overallSeg.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span> : null}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                            {matchupPayoutsResult.rows.some((r) => r.segments.some((s) => s.settled)) && (
                              <>
                                <div className="border-t-2 border-gray-200 px-4 pt-3 pb-2">
                                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Net Positions</p>
                                  <div className="space-y-1">
                                    {[...payoutsData.players].filter((p) => matchupPayoutsResult.involvedIds.has(p.id)).sort((a, b) => (matchupPayoutsResult.net[b.id] ?? 0) - (matchupPayoutsResult.net[a.id] ?? 0)).map((p) => {
                                      const v = Math.round((matchupPayoutsResult.net[p.id] ?? 0) * 100) / 100
                                      return (<div key={p.id} className="flex items-center justify-between"><span className="text-xs text-gray-700">{p.name}</span><span className="text-xs font-bold tabular-nums" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>{v > 0 ? `+$${v.toFixed(2)}` : v < 0 ? `-$${Math.abs(v).toFixed(2)}` : 'Even'}</span></div>)
                                    })}
                                  </div>
                                </div>
                                <div className="border-t border-gray-100 px-4 py-3">
                                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Settlements</p>
                                  {matchupOnlySettlements.length === 0 ? <p className="text-xs text-gray-400 text-center">All even — no payments needed</p> : matchupOnlySettlements.map((s, i) => (<div key={i} className="flex items-center justify-between py-1"><span className="text-xs text-gray-800"><span className="font-semibold text-red-500">{s.fromName}</span><span className="text-gray-400"> pays </span><span className="font-semibold text-green-600">{s.toName}</span></span><span className="text-xs font-bold text-gray-900">${s.amount.toFixed(2)}</span></div>))}
                                </div>
                              </>
                            )}
                          </>)}
                        </div>
                      )}
                    </div>

                    {/* ── Combined Settlements ── */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <h4 className="font-semibold text-gray-900 text-sm">Combined Settlements</h4>
                        <p className="text-xs text-gray-500">{isDaytona ? 'Daytona game' : 'Ball game'}{isDaytonaSideGame ? ' + Daytona side game' : ''}{bankerSideGame ? ' + Banker side game' : ''} + all matchup bets</p>
                      </div>
                      <div className="px-4 pt-3 pb-2">
                        <div className="space-y-1">
                          {[...payoutsData.players].sort((a, b) => (combinedNet[b.id] ?? 0) - (combinedNet[a.id] ?? 0)).map((p) => {
                            const v = Math.round((combinedNet[p.id] ?? 0) * 100) / 100
                            return (<div key={p.id} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0"><span className="text-sm text-gray-900">{p.name}</span><span className="text-sm font-bold tabular-nums" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>{v > 0 ? `+$${v.toFixed(2)}` : v < 0 ? `-$${Math.abs(v).toFixed(2)}` : 'Even'}</span></div>)
                          })}
                        </div>
                      </div>
                      <div className="border-t border-gray-200 px-4 py-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Who Pays Who</p>
                        {combinedSettlements.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">No payouts yet</p> : combinedSettlements.map((s, i) => (<div key={i} className="flex items-center justify-between py-1"><span className="text-sm text-gray-800"><span className="font-semibold text-red-500">{s.fromName}</span><span className="text-gray-500"> pays </span><span className="font-semibold text-green-600">{s.toName}</span></span><span className="text-sm font-bold text-gray-900">${s.amount.toFixed(2)}</span></div>))}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      <main className="max-w-lg mx-auto px-3 py-4 space-y-2 pb-24">
        {!isStarted && (
          <div className="bg-amber-50 rounded-xl border-2 border-amber-300 px-4 py-4 text-center">
            <p className="font-semibold text-amber-800">Waiting for Admin to Activate Round</p>
            <p className="text-xs text-amber-600 mt-1">Score entry will be unlocked once the admin activates the round.</p>
          </div>
        )}
        {isStarted && savedHoles.size === holes.length && holes.length > 0 && (
          <div className="rounded-xl border-2 px-4 py-4 flex items-center gap-4" style={{ borderColor: gold, background: '#fffbeb' }}>
            <span className="text-4xl flex-shrink-0">⛳</span>
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="font-bold text-gray-900">All {holes.length} holes submitted!</p>
              {roundComplete ? (
                <button onClick={openPayoutsModal} className="text-sm font-bold underline" style={{ color: '#92400e' }}>View Final Payouts →</button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                  <p className="text-sm text-gray-500">Waiting for other groups to finish…</p>
                </div>
              )}
            </div>
          </div>
        )}

        {holes.map((hole) => {
          const isSaved = savedHoles.has(hole.hole_number)
          const isPending = pendingHoles.has(hole.hole_number)
          const isExpanded = isStarted && expandedHole === hole.hole_number
          const isLocked = !isStarted || (!isSaved && currentHole !== null && hole.hole_number > currentHole)
          const error = errors[hole.hole_number]
          const holeLeftLabel = isFlares && hole.par === 3 ? 'Close' : leftLabel
          const holeRightLabel = isFlares && hole.par === 3 ? 'Far' : rightLabel

          const savedHolePlayerScores = players.map((p) => {
            const sc = savedScores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)
            return sc?.strokes ?? hole.par
          })
          const holeBalls = !isDaytonaMode ? computeHoleBallScores(savedHolePlayerScores, ballsCount) : []

          // Compute Left/Right DT for collapsed row using saved data (net scores)
          const holeAssignments = assignments[hole.hole_number] ?? {}
          // For side games, use all group players from the assignments map; for pure Daytona use team players
          const allHoleLeftIds = Object.entries(holeAssignments).filter(([, s]) => s === 'left').map(([id]) => id)
          const allHoleRightIds = Object.entries(holeAssignments).filter(([, s]) => s === 'right').map(([id]) => id)
          const groupScoreSource = sideGameGroupScores ?? savedScores
          const netGroup = (pid: string) => {
            const gross = groupScoreSource.find((s) => s.player_id === pid && s.hole_number === hole.hole_number)?.strokes
            if (gross === undefined) return undefined
            return gross - ((holeStrokes[hole.hole_number] ?? []).includes(pid) ? 1 : 0)
          }
          const savedLeftScores = allHoleLeftIds.map(netGroup).filter((s): s is number => s !== undefined)
          const savedRightScores = allHoleRightIds.map(netGroup).filter((s): s is number => s !== undefined)
          const { leftDt, rightDt } = isDaytonaMode
            ? computeHoleDaytonaWithSides(savedLeftScores, savedRightScores, hole.par)
            : { leftDt: null, rightDt: null }

          // For 5-man: compute DT for each of the 3 right-side pairs (and corresponding left scores)
          const savedRightPairDts: (number | null)[] = (() => {
            if (!is5Man || allHoleRightIds.length !== 3) return []
            return ([[0,1],[0,2],[1,2]] as [number,number][]).map(([a, b]) => {
              const pScores = [allHoleRightIds[a], allHoleRightIds[b]].map(netGroup).filter((s): s is number => s !== undefined)
              return computeHoleDaytonaWithSides(savedLeftScores, pScores, hole.par).rightDt
            })
          })()
          const savedLeftPairDts: (number | null)[] = (() => {
            if (!is5Man || allHoleRightIds.length !== 3) return []
            return ([[0,1],[0,2],[1,2]] as [number,number][]).map(([a, b]) => {
              const pScores = [allHoleRightIds[a], allHoleRightIds[b]].map(netGroup).filter((s): s is number => s !== undefined)
              return computeHoleDaytonaWithSides(savedLeftScores, pScores, hole.par).leftDt
            })
          })()

          // Per-player points for this hole (saved only)
          const holePlayerPoints: Map<string, number> = (() => {
            if (!isDaytonaMode || !isSaved) return new Map()
            const leftIds = players.filter((p) => holeAssignments[p.id] === 'left').map((p) => p.id)
            const rightIds = players.filter((p) => holeAssignments[p.id] === 'right').map((p) => p.id)
            if (is5Man) {
              if (leftIds.length < 2 || rightIds.length < 3) return new Map()
              const netScores = savedScores.map((s) => ({ ...s, strokes: s.strokes - ((holeStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
              return computeHoleDaytonaPointsFiveMan(leftIds, rightIds, netScores, hole.hole_number, hole.par)
            }
            const lScores = leftIds.map((id) => netSaved(id, hole.hole_number)).filter((s): s is number => s !== undefined)
            const rScores = rightIds.map((id) => netSaved(id, hole.hole_number)).filter((s): s is number => s !== undefined)
            if (lScores.length < 2 || rScores.length < 2) return new Map()
            const { leftDt, rightDt } = computeHoleDaytonaWithSides(lScores, rScores, hole.par)
            if (leftDt === null || rightDt === null) return new Map()
            const diff = Math.abs(leftDt - rightDt)
            const leftPts = leftDt < rightDt ? diff : leftDt > rightDt ? -diff : 0
            const map = new Map<string, number>()
            for (const id of leftIds) map.set(id, leftPts)
            for (const id of rightIds) map.set(id, -leftPts)
            return map
          })()

          // Live preview during edit (net scores)
          const editLeftScores = players
            .filter((p) => holeAssignments[p.id] === 'left')
            .map((p) => netEdit(p.id, hole.hole_number, hole.par))
          const editRightScores = players
            .filter((p) => holeAssignments[p.id] === 'right')
            .map((p) => netEdit(p.id, hole.hole_number, hole.par))
          const { leftDt: liveLeftDt, rightDt: liveRightDt } = isDaytonaMode
            ? computeHoleDaytonaWithSides(editLeftScores, editRightScores, hole.par)
            : { leftDt: null, rightDt: null }

          const liveRightPairDts: (number | null)[] = (() => {
            if (!is5Man) return []
            const rightPlayers = players.filter((p) => holeAssignments[p.id] === 'right')
            if (rightPlayers.length !== 3) return []
            return ([[0,1],[0,2],[1,2]] as [number,number][]).map(([a, b]) => {
              const pScores = [rightPlayers[a], rightPlayers[b]]
                .map((p) => strokes[p.id]?.[hole.hole_number] ?? hole.par)
              return computeHoleDaytonaWithSides(editLeftScores, pScores, hole.par).rightDt
            })
          })()

          const leftCount = Object.values(holeAssignments).filter((s) => s === 'left').length

          return (
            <Fragment key={hole.hole_number}>
            <div
              id={`hole-${hole.hole_number}`}
              className="bg-white rounded-xl border overflow-hidden"
              style={{ borderColor: isSaved ? gold : '#e5e7eb' }}>
              {/* Hole row */}
              <button
                type="button"
                className={`w-full flex items-center px-4 py-3 gap-3 text-left${isLocked ? ' cursor-not-allowed opacity-50' : ''}`}
                onClick={() => expandHole(hole.hole_number)}>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Hole</p>
                  <p className="font-bold text-gray-900">{hole.hole_number}</p>
                </div>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Par</p>
                  <p className="font-semibold text-gray-600">{hole.par}</p>
                </div>
                {hole.stroke_index != null && (
                  <div className="text-center flex-shrink-0">
                    <p className="text-xs text-gray-400">HCP</p>
                    <p className="text-xs font-semibold text-gray-500">{hole.stroke_index}</p>
                  </div>
                )}
                {isBanker && bankerHoles[hole.hole_number]?.bankerPlayerId && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                    🏦 {players.find((p) => p.id === bankerHoles[hole.hole_number].bankerPlayerId)?.name.split(' ')[0] ?? 'Banker'}
                  </span>
                )}
                <div className="flex-1" />
                {isDaytonaMode && isSaved && holeValues[hole.hole_number] !== undefined && (
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded-full mr-1 flex-shrink-0" style={{ background: '#fef3c7', color: '#92400e' }}>
                    ↑${holeValues[hole.hole_number]}
                  </span>
                )}
                {isSaved && (
                  <div className="flex items-center gap-3 mr-2">
                    {isDaytonaMode ? (
                      <>
                        {is5Man && savedLeftPairDts.length === 3 ? (
                          <div className="text-center mr-3">
                            <p className="text-xs" style={{ color: '#2563eb' }}>{holeLeftLabel}</p>
                            <p className="font-bold text-sm text-gray-900">
                              {[...savedLeftPairDts].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)).map((dt) => dt ?? '–').join('/')}
                            </p>
                          </div>
                        ) : (
                          <div className="text-center mr-3">
                            <p className="text-xs" style={{ color: '#2563eb' }}>{holeLeftLabel}</p>
                            <p className="font-bold text-sm text-gray-900">{leftDt ?? '–'}</p>
                          </div>
                        )}
                        {is5Man && savedRightPairDts.length === 3 ? (
                          <div className="text-center">
                            <p className="text-xs" style={{ color: '#92400e' }}>{holeRightLabel}</p>
                            <p className="font-bold text-sm text-gray-900">
                              {[...savedRightPairDts].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)).map((dt) => dt ?? '–').join('/')}
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="text-center">
                              <p className="text-xs" style={{ color: '#92400e' }}>{holeRightLabel}</p>
                              <p className="font-bold text-sm text-gray-900">{rightDt ?? '–'}</p>
                            </div>
                            {is5Man && leftDt != null && rightDt != null && leftDt !== rightDt && (
                              <div className="text-center">
                                <p className="text-xs text-gray-400">Pts</p>
                                <p className="font-bold text-sm" style={{ color: leftDt < rightDt ? '#16a34a' : '#dc2626' }}>
                                  {leftDt < rightDt ? `${holeLeftLabel[0]} +${rightDt - leftDt}` : `${holeRightLabel[0]} +${leftDt - rightDt}`}
                                </p>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      holeBalls.map((score, i) => (
                        <div key={i} className="text-center">
                          <p className="text-xs text-gray-400">{i + 1}B</p>
                          <ScoreNotation strokes={score ?? hole.par} par={hole.par} size="sm" />
                        </div>
                      ))
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isSaved && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>✓</span>}
                  {isLocked
                    ? <span className="text-gray-300 text-sm">🔒</span>
                    : <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>}
                </div>
              </button>

              {/* Expanded score entry */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2">

                  {/* ── Banker hole setup ── */}
                  {isBanker && (() => {
                    const hd = bankerHoles[hole.hole_number] ?? { bankerPlayerId: null, maxBet: 5 }
                    const bets = bankerBets[hole.hole_number] ?? {}
                    const isLastTwo = hole.hole_number >= (holes.length > 9 ? 17 : holes[holes.length - 2]?.hole_number ?? 17)
                    const suggestedBankerId = isLastTwo
                      ? Object.entries(bankerRunningTotals).sort((a, b) => (a[1] as number) - (b[1] as number))[0]?.[0] ?? null
                      : null
                    return (
                      <div className="bg-blue-50 rounded-xl p-3 space-y-3 border border-blue-100">
                        {/* Banker selector */}
                        <div>
                          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">
                            Select Banker{isLastTwo ? ' (auto: most down)' : ''}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {players.map((p) => {
                              const isBankerPlayer = hd.bankerPlayerId === p.id
                              const isSuggested = suggestedBankerId === p.id && !hd.bankerPlayerId
                              return (
                                <button key={p.id} type="button"
                                  onClick={() => handleSaveBankerHole(hole.hole_number, p.id, hd.maxBet)}
                                  className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold border transition ${isBankerPlayer ? 'text-white border-transparent' : 'border-gray-300 text-gray-600 bg-white'}`}
                                  style={isBankerPlayer ? { background: navy } : isSuggested ? { borderColor: '#f59e0b', color: '#92400e' } : {}}>
                                  {p.name}{isSuggested && !isBankerPlayer ? ' ★' : ''}
                                </button>
                              )
                            })}
                            {hd.bankerPlayerId && (
                              <button type="button" onClick={() => handleSaveBankerHole(hole.hole_number, null, hd.maxBet)}
                                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-400">Clear</button>
                            )}
                          </div>
                        </div>

                        {/* Max bet */}
                        {hd.bankerPlayerId && (
                          <div>
                            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">
                              Banker Sets Max Bet (min ${bankerMinBet})
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-500">$</span>
                              <input type="number" value={hd.maxBet} min={bankerMinBet} step="1"
                                onChange={(e) => handleSaveBankerHole(hole.hole_number, hd.bankerPlayerId, Math.round(parseFloat(e.target.value) || bankerMinBet))}
                                className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                              <span className="text-xs text-gray-400">Range: ${bankerMinBet}–${hd.maxBet}</span>
                            </div>
                          </div>
                        )}

                        {/* Player bets */}
                        {hd.bankerPlayerId && (
                          <div>
                            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">Player Bets</p>
                            <div className="space-y-2">
                              {players.filter((p) => p.id !== hd.bankerPlayerId).map((p) => {
                                const pb = bets[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
                                const effective = pb.baseBet * (pb.playerDoubled ? 2 : 1) * (pb.bankerDoubled ? 2 : 1)
                                return (
                                  <div key={p.id} className="bg-white rounded-lg p-2 border border-gray-100">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-gray-700 flex-1">{p.name}</span>
                                      <div className="flex items-center gap-1">
                                        <span className="text-xs text-gray-500">$</span>
                                        <input type="number" value={pb.baseBet} min={bankerMinBet} max={hd.maxBet} step="1"
                                          onChange={(e) => {
                                            const v = Math.min(Math.max(Math.round(parseFloat(e.target.value) || bankerMinBet), bankerMinBet), hd.maxBet)
                                            handleSaveBankerBets(hole.hole_number, { ...bets, [p.id]: { ...pb, baseBet: v } })
                                          }}
                                          className="w-16 border border-gray-300 rounded px-1.5 py-1 text-sm focus:outline-none" />
                                      </div>
                                      <button type="button"
                                        onClick={() => handleSaveBankerBets(hole.hole_number, { ...bets, [p.id]: { ...pb, playerDoubled: !pb.playerDoubled } })}
                                        className={`text-xs px-2 py-1 rounded border font-semibold transition ${pb.playerDoubled ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>
                                        {pb.playerDoubled ? '2× ✓' : '2×'}
                                      </button>
                                    </div>
                                    {(pb.playerDoubled || pb.bankerDoubled) && (
                                      <p className="text-xs text-amber-700 font-semibold mt-0.5">
                                        {pb.playerDoubled && pb.bankerDoubled ? '×4' : '×2'} → ${Math.round(effective)}
                                      </p>
                                    )}
                                  </div>
                                )
                              })}
                              {/* Banker doubles ALL bets */}
                              {(() => {
                                const isDoubled = Object.values(bets).some((b) => b.bankerDoubled)
                                return (
                                  <button type="button"
                                    onClick={() => handleBankerDoubleAll(hole.hole_number, isDoubled)}
                                    className={`w-full text-xs py-1.5 rounded-lg border font-semibold transition mt-1 ${isDoubled ? 'bg-orange-500 text-white border-orange-500' : 'border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100'}`}>
                                    {isDoubled ? 'Banker 2× All ✓ (tap to undo)' : 'Banker 2× All Bets'}
                                  </button>
                                )
                              })()}
                            </div>
                          </div>
                        )}

                        {/* Hole result preview */}
                        {hd.bankerPlayerId && Object.keys(bets).length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Projected Result (saved scores)</p>
                            {isSaved && (() => {
                              const bankerId = hd.bankerPlayerId!
                              const bankerNet = netSaved(bankerId, hole.hole_number)
                              if (bankerNet === undefined) return <p className="text-xs text-gray-400">Enter scores to see result</p>
                              return (
                                <div className="space-y-1">
                                  {players.filter((p) => p.id !== bankerId).map((p) => {
                                    const playerNet = netSaved(p.id, hole.hole_number)
                                    if (playerNet === undefined) return null
                                    const pb = bets[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
                                    const effective = pb.baseBet * (pb.playerDoubled ? 2 : 1) * (pb.bankerDoubled ? 2 : 1)
                                    let result = 0
                                    if (playerNet < bankerNet) result = effective * bankerMultiplier(playerNet, hole.par)
                                    else if (playerNet > bankerNet) result = -effective * bankerMultiplier(bankerNet, hole.par)
                                    const label = result === 0 ? 'Push' : result > 0 ? `+$${Math.round(result)}` : `-$${Math.round(Math.abs(result))}`
                                    return (
                                      <div key={p.id} className="flex items-center justify-between text-xs">
                                        <span className="text-gray-600">{p.name}</span>
                                        <span className={`font-semibold ${result > 0 ? 'text-green-600' : result < 0 ? 'text-red-600' : 'text-gray-400'}`}>{label}</span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {players.map((player, playerIdx) => {
                    const val = strokes[player.id]?.[hole.hole_number] ?? hole.par
                    const side = holeAssignments[player.id] as DaytonaSide | undefined
                    const isAssigned = player.id in holeAssignments
                    // Default to 'left' (Out) until 2 left slots are filled, then 'right' (In)
                    const defaultSide: DaytonaSide = leftCount < 2 ? 'left' : 'right'
                    const displaySide: DaytonaSide = side ?? defaultSide
                    // Colors for Out (left) and In (right) sides
                    const outBg = '#2563eb', inBg = '#b45309'
                    const outBgFaint = '#dbeafe', inBgFaint = '#fef3c7'
                    const outBorder = '#93c5fd', inBorder = '#fcd34d'
                    return (
                      <div key={player.id} className="flex items-center gap-2">
                        {isDaytonaMode && (
                          <button
                            type="button"
                            onClick={() => {
                              setAssignments((prev) => {
                                const holeMap = { ...(prev[hole.hole_number] ?? {}) }
                                if (!isAssigned) {
                                  holeMap[player.id] = displaySide
                                } else {
                                  holeMap[player.id] = side === 'left' ? 'right' : 'left'
                                }
                                // Once exactly 2 are on 'left' (Out/Close), auto-assign all remaining unassigned to 'right' (In/Far)
                                const newLeftCount = Object.values(holeMap).filter(s => s === 'left').length
                                if (newLeftCount === 2) {
                                  for (const p of players) {
                                    if (!(p.id in holeMap)) holeMap[p.id] = 'right'
                                  }
                                }
                                // Once the right-side target is reached (3 for 5-man variants, 2 for 4-man),
                                // auto-assign all remaining unassigned to 'left'
                                const newRightCount = Object.values(holeMap).filter(s => s === 'right').length
                                const rightTarget = is5Man ? 3 : 2
                                if (newRightCount === rightTarget) {
                                  for (const p of players) {
                                    if (!(p.id in holeMap)) holeMap[p.id] = 'left'
                                  }
                                }
                                return { ...prev, [hole.hole_number]: holeMap }
                              })
                            }}
                            className="flex-shrink-0 text-xs font-bold px-2 rounded-lg border transition flex items-center justify-center"
                            style={{
                              background: !isAssigned
                                ? (defaultSide === 'left' ? outBgFaint : inBgFaint)
                                : (side === 'left' ? outBg : inBg),
                              color: !isAssigned
                                ? (defaultSide === 'left' ? '#2563eb' : '#b45309')
                                : 'white',
                              borderColor: !isAssigned
                                ? (defaultSide === 'left' ? outBorder : inBorder)
                                : (side === 'left' ? outBg : inBg),
                              minWidth: '3rem',
                              height: '1.5rem',
                            }}>
                            {isAssigned ? (side === 'left' ? holeLeftLabel : holeRightLabel) : '+'}
                          </button>
                        )}
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate min-w-0">
                          {player.name}{(holeStrokes[hole.hole_number] ?? []).includes(player.id) ? <span className="text-blue-500 font-bold">*</span> : ''}
                          {isDaytonaMode && isSaved && (() => {
                            const pts = holePlayerPoints.get(player.id)
                            if (!pts) return null
                            return (
                              <span className="ml-1.5 text-xs font-semibold" style={{ color: pts > 0 ? '#16a34a' : '#dc2626' }}>
                                {pts > 0 ? `+${pts}` : pts}
                              </span>
                            )
                          })()}
                        </span>
                        {(() => {
                          const allAssigned = !isDaytonaMode || players.every((p) => p.id in holeAssignments)
                          const scoreActive = !isDaytonaMode || allAssigned
                          const canInteract = allAssigned
                          return (
                            <>
                              <button
                                type="button"
                                disabled={!canInteract}
                                onClick={() => setStroke(player.id, hole.hole_number, scoreActive ? val - 1 : hole.par)}
                                className={`w-8 h-8 rounded-full bg-gray-100 font-bold flex items-center justify-center flex-shrink-0 transition${canInteract ? ' hover:bg-gray-200 active:scale-90' : ' cursor-not-allowed'}`}
                                style={{ color: scoreActive && canInteract ? '#374151' : '#d1d5db' }}>
                                −
                              </button>
                              <div className="w-11 flex items-center justify-center flex-shrink-0"
                                style={{ color: scoreActive ? undefined : '#d1d5db' }}>
                                <ScoreNotation strokes={val} par={hole.par} />
                              </div>
                              <button
                                type="button"
                                disabled={!canInteract}
                                onClick={() => setStroke(player.id, hole.hole_number, scoreActive ? val + 1 : hole.par)}
                                className={`w-8 h-8 rounded-full bg-gray-100 font-bold flex items-center justify-center flex-shrink-0 transition${canInteract ? ' hover:bg-gray-200 active:scale-90' : ' cursor-not-allowed'}`}
                                style={{ color: scoreActive && canInteract ? '#374151' : '#d1d5db' }}>
                                +
                              </button>
                            </>
                          )
                        })()}
                      </div>
                    )
                  })}

                  {/* ── Daytona assignment validation ── */}
                  {isDaytonaMode && (() => {
                    const allAssigned = players.every((p) => p.id in holeAssignments)
                    return (
                      <>
                        {!allAssigned && (
                          <p className="text-xs text-red-500 mt-1">{isFlares && hole.par === 3 ? "Select 2 Closest Players" : isFlares ? "Select 2 Outside Players" : "Select 2 Left Players"}</p>
                        )}
                        {allAssigned && leftCount !== 2 && (
                          <p className="text-xs text-red-500 mt-1">{isFlares && hole.par === 3 ? "Need exactly 2 Close & 3 Far" : isFlares ? "Need exactly 2 Out & 3 In" : is5Man ? "Need exactly 2 Left & 3 Right" : "Need exactly 2 Left & 2 Right"}</p>
                        )}
                      </>
                    )
                  })()}

                  {/* ── Press (custom payout) UI ── */}
                  {isDaytonaMode && (() => {
                    const isActive = !!pressShowInput[hole.hole_number]
                    const existingVal = holeValues[hole.hole_number]
                    const currentScope = pressScope[hole.hole_number] ?? 'this'
                    return (
                      <div className="mt-1 border-t border-gray-100 pt-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (isActive) {
                                // Toggle off — close input but don't clear committed value
                                setPressShowInput((p) => { const n = { ...p }; delete n[hole.hole_number]; return n })
                                setPressValueStr((p) => { const n = { ...p }; delete n[hole.hole_number]; return n })
                              } else {
                                // Toggle on — open input prefilled with current value or default
                                const prefill = existingVal !== undefined ? String(existingVal) : String(defaultDtPayoutValue)
                                setPressShowInput((p) => ({ ...p, [hole.hole_number]: true }))
                                setPressValueStr((p) => ({ ...p, [hole.hole_number]: prefill }))
                                setPressScope((p) => ({ ...p, [hole.hole_number]: 'this' }))
                              }
                            }}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg border transition"
                            style={isActive || existingVal !== undefined
                              ? { background: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' }
                              : { background: 'white', color: '#6b7280', borderColor: '#e5e7eb' }}>
                            {existingVal !== undefined && !isActive ? `↑ Press $${existingVal}` : isActive ? '✕ Press' : '↑ Press'}
                          </button>
                          {existingVal !== undefined && !isActive && (
                            pressConfirmHole === hole.hole_number ? (
                              <span className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">Remove press?</span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!roundId) return
                                    await saveDaytonaHoleValues(roundId, team.id, [{ holeNumber: hole.hole_number, valuePerPoint: null }])
                                    setHoleValues((p) => { const n = { ...p }; delete n[hole.hole_number]; return n })
                                    setPressConfirmHole(null)
                                  }}
                                  className="text-xs font-semibold text-red-500 hover:text-red-700 transition">
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPressConfirmHole(null)}
                                  className="text-xs text-gray-400 hover:text-gray-600 transition">
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPressConfirmHole(hole.hole_number)}
                                className="text-xs text-gray-400 hover:text-red-500 transition">
                                Clear
                              </button>
                            )
                          )}
                        </div>
                        {isActive && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 flex-shrink-0">$/pt:</span>
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={pressValueStr[hole.hole_number] ?? ''}
                                onChange={(e) => setPressValueStr((p) => ({ ...p, [hole.hole_number]: e.target.value }))}
                                className="w-20 text-xs border border-gray-300 rounded px-2 py-1 text-center"
                                placeholder={String(defaultDtPayoutValue)}
                              />
                            </div>
                            <div className="flex gap-2">
                              {(['this', 'forward'] as const).map((scope) => (
                                <button
                                  key={scope}
                                  type="button"
                                  onClick={() => setPressScope((p) => ({ ...p, [hole.hole_number]: scope }))}
                                  className="text-xs px-2.5 py-1 rounded-lg border font-medium transition"
                                  style={currentScope === scope
                                    ? { background: navy, color: 'white', borderColor: navy }
                                    : { background: 'white', color: '#374151', borderColor: '#d1d5db' }}>
                                  {scope === 'this' ? 'Just this hole' : 'All going forward'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* ── Strokes panel ── */}
                  {(() => {
                    const suggestedIds = isBanker ? getBankerAutoStrokes(hole.hole_number) : (autoHandicap ? getAutoStrokes(hole.hole_number) : [])
                    const activeStrokeIds = holeStrokes[hole.hole_number] ?? []
                    const visiblePlayers = players.filter((p) => suggestedIds.includes(p.id) || activeStrokeIds.includes(p.id))
                    if (visiblePlayers.length === 0) return null
                    const hasBankerSet = isBanker && !!bankerHoles[hole.hole_number]?.bankerPlayerId
                    const canAutoFill = (isBanker && hasBankerSet) || autoHandicap
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Handicap Strokes</p>
                        <div className="flex flex-wrap gap-2">
                          {visiblePlayers.map((p) => {
                            const hasStroke = activeStrokeIds.includes(p.id)
                            const isSuggested = suggestedIds.includes(p.id)
                            return (
                              <button key={p.id} type="button"
                                onClick={() => handleStrokesToggle(hole.hole_number, p.id)}
                                disabled={strokesPending}
                                className="text-xs px-2.5 py-1 rounded-full border font-medium transition"
                                style={hasStroke
                                  ? { background: '#16a34a', color: 'white', borderColor: 'transparent' }
                                  : isSuggested
                                    ? { background: '#f0fdf4', color: '#15803d', borderColor: '#86efac' }
                                    : { borderColor: '#d1d5db', color: '#6b7280' }}>
                                {p.name}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {(() => {
                    const allAssigned = !isDaytonaMode || players.every((p) => p.id in holeAssignments)
                    const daytonaReady = !isDaytonaMode || (allAssigned && leftCount === 2)
                    return (
                      <>
                        {error && <p className="text-xs text-red-500">{error}</p>}
                        <button
                          type="button"
                          onClick={() => saveHole(hole.hole_number)}
                          disabled={isPending || !daytonaReady}
                          className="w-full mt-2 text-white py-2 rounded-lg font-semibold text-sm disabled:opacity-60 transition"
                          style={{ background: navy }}>
                          {isPending ? 'Saving…' : 'Save Hole'}
                        </button>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>

              {hole.hole_number === 9 && !isDaytonaMode && (
                <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: navy }}>
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Front 9 Total</p>
                    {savedHoles.has(9) && (
                      <div className="flex items-center gap-3 mr-8">
                        {isDaytonaMode ? (
                          <>
                            <div className="text-center">
                              <p className="text-xs" style={{ color: '#2563eb' }}>{leftLabel}</p>
                              <p className="font-bold text-sm text-gray-900">{dtSummary?.leftFront ?? '–'}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-xs" style={{ color: '#92400e' }}>{rightLabel}</p>
                              <p className="font-bold text-sm text-gray-900">{dtSummary?.rightFront ?? '–'}</p>
                            </div>
                          </>
                        ) : (
                          frontBallTotals.map((total, i) => (
                            <div key={i} className="text-center">
                              <p className="text-xs text-gray-400">{i + 1}B</p>
                              <p className="font-bold text-sm text-gray-900">{total}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {hole.hole_number === 18 && !isDaytonaMode && (
                <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: navy }}>
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Back 9 Total</p>
                    {savedHoles.has(18) && (
                      <div className="flex items-center gap-3 mr-8">
                        {isDaytonaMode ? (
                          <>
                            <div className="text-center">
                              <p className="text-xs" style={{ color: '#2563eb' }}>{leftLabel}</p>
                              <p className="font-bold text-sm text-gray-900">{dtSummary?.leftBack ?? '–'}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-xs" style={{ color: '#92400e' }}>{rightLabel}</p>
                              <p className="font-bold text-sm text-gray-900">{dtSummary?.rightBack ?? '–'}</p>
                            </div>
                          </>
                        ) : (
                          backBallTotals.map((total, i) => (
                            <div key={i} className="text-center">
                              <p className="text-xs text-gray-400">{i + 1}B</p>
                              <p className="font-bold text-sm text-gray-900">{total}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          )
        })}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-center text-sm">
          <p className="text-xs text-gray-400">{savedCount}/18 holes saved</p>
        </div>
      </div>
    </div>
  )
}

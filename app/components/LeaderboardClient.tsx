'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  computeTeamBallSummary, computePlayerDaytonaPoints,
  calculatePoolPayouts, settleDaytonaPlayerPoints, computeSkinsResults,
  computePlayerDaytonaDollars, computeHoleDaytonaWithSides, computeHoleDaytonaPointsFiveMan,
  type DaytonaHoleAssignment, type SkinResult,
} from '@/lib/scoring'
import PinLoginModal from './PinLoginModal'
import { ScoreNotation } from './ScoreNotation'

type Team = { id: string; name: string; daytona_variant?: string | null; exclude_matchups?: boolean | null }
type Player = { id: string; team_id: string; name: string; position: number | null; skins_participant: boolean; handicap?: number | null }
type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }
type BallValue = { ball_number: number; value_dollars: number }

const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']
const navy = '#0f172a'
const gold = '#f59e0b'
// Display helpers — keep all internal math at full precision; round only at render
const fmtDollars = (v: number) => { const r = Math.round(Math.abs(v)); return r === 0 ? 'Even' : `$${r}` }
const fmtNetSigned = (v: number) => { const r = Math.round(Math.abs(v)); return r === 0 ? 'Even' : `$${r}` }
const fmtSettle = (v: number) => `$${Math.round(Math.abs(v))}`

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

// ── Matchup payout types + helpers ───────────────────────────────────────────
type PressEntry = { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: 'p1' | 'p2'; strokes?: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string; press: PressEntry[] }
type BestBallMatchup = { id: string; team1_player1_id: string; team1_player2_id: string; team2_player1_id: string; team2_player2_id: string; bet: string }
type HammerMatchup = { id: string; team1_id: string; team2_id: string; base_bet: number; auto_handicap: boolean }
type HammerHoleState = { stake: number; lastHammerTeam: 1 | 2 | null; foldedTeam: 1 | 2 | null; preTeeUsed: boolean }
type MatchupBetType = 'nassau' | 'straight'
type MatchupScoringType = 'stroke' | 'match'
type MPayoutSeg = { name: 'Front' | 'Back' | 'Total'; settled: boolean; winnerLabel: string | null; tied: boolean; amount: number; perPlayer: boolean }
type MPayoutRow = { id: string; type: 'h2h' | 'bb'; label: string; betLabel: string; segments: MPayoutSeg[]; nassauResult?: { winnerLabel: string | null; amount: number; perPlayer: boolean; anySettled: boolean; swept?: boolean } }

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
function h2hStats(p1Id: string, p2Id: string, sm: Record<string, Record<number, number>>, holes: Hole[]) {
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
function bbStats(t1p1: string, t1p2: string, t2p1: string, t2p2: string, sm: Record<string, Record<number, number>>, holes: Hole[]) {
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
    if (Math.round(amount) > 0) out.push({ fromId: nw[li].id, fromName: nw[li].name, toId: pw[wi].id, toName: pw[wi].name, amount })
    pw[wi].bal = Math.round((pw[wi].bal - amount) * 100) / 100; nw[li].bal = Math.round((nw[li].bal + amount) * 100) / 100
    if (pw[wi].bal <= 0.005) wi++; if (nw[li].bal >= -0.005) li++
  }
  return out
}
function computeMatchupPayouts(matchups: SavedMatchup[], bestBallMatchups: BestBallMatchup[], players: { id: string; name: string }[], scoreMap: Record<string, Record<number, number>>, holes: Hole[]): { rows: MPayoutRow[]; net: Record<string, number>; involvedIds: Set<string> } {
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
    if (!hasBet) { rows.push({ id: m.id, type: 'h2h', label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] }); continue }
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
      if (played !== pressHoles.length || played === 0) continue // not yet complete
      const strokes = press.strokes ?? 0
      const adjP1 = (p1Sum - parSum) - (press.strokesSide === 'p1' ? strokes : 0)
      const adjP2 = (p2Sum - parSum) - (press.strokesSide === 'p2' ? strokes : 0)
      if (adjP1 < adjP2) { net[p1] = (net[p1] ?? 0) + press.amount; net[p2] = (net[p2] ?? 0) - press.amount }
      else if (adjP2 < adjP1) { net[p2] = (net[p2] ?? 0) + press.amount; net[p1] = (net[p1] ?? 0) - press.amount }
      // tie: no net change
    }
    rows.push({ id: m.id, type: 'h2h', label: `${mp1.name} vs ${mp2.name}`, betLabel: formatMBet(m.bet), segments: segs, nassauResult })
  }
  for (const m of bestBallMatchups) {
    const t1p1 = players.find((p) => p.id === m.team1_player1_id), t1p2 = players.find((p) => p.id === m.team1_player2_id)
    const t2p1 = players.find((p) => p.id === m.team2_player1_id), t2p2 = players.find((p) => p.id === m.team2_player2_id)
    if (!t1p1 || !t1p2 || !t2p1 || !t2p2) continue
    involvedIds.add(m.team1_player1_id); involvedIds.add(m.team1_player2_id); involvedIds.add(m.team2_player1_id); involvedIds.add(m.team2_player2_id)
    const { betType, scoringType, sweepAmount, handicapSide, handicapFront, handicapBack, handicapTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseMBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)
    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`, t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`
    if (!hasBet) { rows.push({ id: m.id, type: 'bb', label: `${t1Name} vs ${t2Name}`, betLabel: 'No bet configured', segments: [] }); continue }
    const stats = bbStats(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
    const t1Ids = [m.team1_player1_id, m.team1_player2_id], t2Ids = [m.team2_player1_id, m.team2_player2_id]
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
      const sweepAmt = parseFloat(sweepAmount)
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
    rows.push({ id: m.id, type: 'bb', label: `${t1Name} vs ${t2Name}`, betLabel: formatMBet(m.bet), segments: segs, nassauResult })
  }
  return { rows, net, involvedIds }
}

function ScoreCell({ vp, gold }: { vp: number | null; gold?: boolean }) {
  if (vp === null) return <span className="text-gray-300">–</span>
  const val = vp < 0 ? String(vp) : vp === 0 ? 'E' : `+${vp}`
  if (gold) return <span className="font-semibold" style={{ color: '#b45309' }}>{val}</span>
  if (vp < 0) return <span className="font-semibold text-red-600">{val}</span>
  return <span className="font-semibold text-gray-900">{val}</span>
}

function vpDisplay(vp: number | null): string {
  if (vp === null) return '–'
  if (vp === 0) return 'E'
  return vp > 0 ? `+${vp}` : `${vp}`
}

function vpColor(vp: number | null): string {
  return vp !== null && vp < 0 ? '#dc2626' : '#111827'
}

export default function LeaderboardClient({
  orgSlug, orgId, orgName, isMaster = false,
  initialTeams, players, holes, initialScores, ballsCount, ballValues = [], roundName, roundDate, roundCourse, format = 'standard', daytonaVariant = '4man', viewOnly = false, scorecardTeamId: scorecardTeamIdProp = null, isAdmin: isAdminProp = false, roundId = '', initialAssignments = [], includeTotal = false, matchups = [], bestBallMatchups = [], skinsEnabled = false, skinsAmount = 0, initialHoleValues = {}, scorecardGroupId = null, isMixedGroups = false, excludeMatchups = false, playingGroups = [], groupPlayerMap = {}, groupHoleStrokes = {}, bankerHolesMap = {}, bankerBetsMap = {}, hammerMatchups = [], hammerHolesMap = {},
}: {
  orgSlug: string
  orgId: string
  orgName: string
  isMaster?: boolean
  initialTeams: Team[]
  players: Player[]
  holes: Hole[]
  initialScores: Score[]
  ballsCount: number
  ballValues?: BallValue[]
  roundName: string
  roundDate: string
  roundCourse: string
  format?: string
  daytonaVariant?: string
  viewOnly?: boolean
  scorecardTeamId?: string | null
  scorecardGroupId?: string | null
  isMixedGroups?: boolean
  excludeMatchups?: boolean
  playingGroups?: { id: string; name: string; daytona_variant?: string | null; banker_side_game?: boolean | null; banker_side_game_min_bet?: number | null; auto_strokes?: boolean | null }[]
  groupPlayerMap?: Record<string, string[]>
  groupHoleStrokes?: Record<number, string[]>
  bankerHolesMap?: Record<string, Record<number, { bankerPlayerId: string | null }>>
  bankerBetsMap?: Record<string, Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>>
  isAdmin?: boolean
  roundId?: string
  initialAssignments?: DaytonaHoleAssignment[]
  includeTotal?: boolean
  matchups?: SavedMatchup[]
  bestBallMatchups?: BestBallMatchup[]
  skinsEnabled?: boolean
  skinsAmount?: number
  initialHoleValues?: Record<string, Record<number, number>>
  hammerMatchups?: HammerMatchup[]
  hammerHolesMap?: Record<string, Record<number, HammerHoleState>>
}) {
  const [mixedTab, setMixedTab] = useState<'team' | 'group' | 'individual'>('team')
  const [scores, setScores] = useState<Score[]>(initialScores)
  const [assignments, setAssignments] = useState<DaytonaHoleAssignment[]>(initialAssignments)
  const [liveHoleStrokes, setLiveHoleStrokes] = useState<Record<number, string[]>>(groupHoleStrokes)
  const [liveHoleValues, setLiveHoleValues] = useState<Record<string, Record<number, number>>>(initialHoleValues)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [showPin, setShowPin] = useState(false)
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [showPayouts, setShowPayouts] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('payouts') === '1')
  const [showAllScorecards, setShowAllScorecards] = useState(false)
  const [allScorecardsGroupId, setAllScorecardsGroupId] = useState<string | null>(null)
  const [allScorecardsFilter, setAllScorecardsFilter] = useState<'all' | 'skins'>('all')
  const [hcpVisible, setHcpVisible] = useState<Set<string>>(new Set())
  const toggleHcp = (id: string) => setHcpVisible((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const [showBallResults, setShowBallResults] = useState(false)
  const [showBallNetPositions, setShowBallNetPositions] = useState(false)
  const [showBallSettlements, setShowBallSettlements] = useState(false)
  const [showBallPotBreakdown, setShowBallPotBreakdown] = useState(false)
  const [showDaytonaResults, setShowDaytonaResults] = useState(false)
  const [showDaytonaSideResults, setShowDaytonaSideResults] = useState(false)
  const [showDaytonaSideSettlements, setShowDaytonaSideSettlements] = useState(false)
  const [showBankerResults, setShowBankerResults] = useState(false)
  const [showBankerSettlements, setShowBankerSettlements] = useState(false)
  const [showHammerResults, setShowHammerResults] = useState(false)
  const [showMatchupResults, setShowMatchupResults] = useState(false)
  const [showSkinsResults, setShowSkinsResults] = useState(false)
  const [showSkinsParticipants, setShowSkinsParticipants] = useState(false)
  const [showSkinsNetPositions, setShowSkinsNetPositions] = useState(false)
  const [showMatchupNetPositions, setShowMatchupNetPositions] = useState(false)
  const [showDaytonaSettlements, setShowDaytonaSettlements] = useState(false)
  const [showMatchupSettlements, setShowMatchupSettlements] = useState(false)
  const [showSkinsSettlements, setShowSkinsSettlements] = useState(false)
  const [isAdmin, setIsAdmin] = useState(isAdminProp)
  const [scorecardTeamId, setScorecardTeamId] = useState(scorecardTeamIdProp)
  const [showOptions, setShowOptions] = useState(false)
  const [rosterPopup, setRosterPopup] = useState<{ name: string; handicap: number | null; frontVP: number | null; backVP: number | null; totalVP: number | null; thru: number } | null>(null)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [breakdownPlayerId, setBreakdownPlayerId] = useState<string | null>(null)
  const [leaderboardView, setLeaderboardView] = useState<'group' | 'team' | 'individual'>(() => {
    const defaultView = format === 'daytona' ? 'group' : format === 'traditional' ? 'individual' : 'team'
    if (typeof window === 'undefined') return defaultView
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type === 'reload') return defaultView
    const saved = sessionStorage.getItem('leaderboardView')
    if (saved === 'group' || saved === 'team' || saved === 'individual') return saved
    return defaultView
  })

  const isDaytona = format === 'daytona'
  const isTraditional = format === 'traditional'
  const [traditionalGroupView, setTraditionalGroupView] = useState<Record<string, 'score' | 'points'>>({})
  const [groupBankerView, setGroupBankerView] = useState<Record<string, 'score' | 'dollars'>>({})
  const [liveBankerHoles, setLiveBankerHoles] = useState<Record<string, Record<number, { bankerPlayerId: string | null }>>>(bankerHolesMap)
  const [liveBankerBets, setLiveBankerBets] = useState<Record<string, Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>>>(bankerBetsMap)

  function lbBankerMultiplier(net: number, par: number): number {
    if (net <= par - 2) return 3
    if (net === par - 1) return 2
    return 1
  }


  function handleChangeTeam() {
    setShowOptions(false)
    setShowPin(true)
  }

  async function logoutCurrentTeam() {
    await fetch('/api/team-logout', { method: 'POST', credentials: 'include' })
    setScorecardTeamId(null)
  }

  async function handleSignOut() {
    await fetch('/api/org-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })
    window.location.href = isMaster ? '/master/dashboard' : '/'
  }

  async function handleGroupSignOut() {
    await fetch('/api/playing-group-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: scorecardGroupId }) })
    window.location.href = `/${orgSlug}`
  }

  // Re-fetch auth state on mount so navigating back from another page doesn't
  // show stale RSC props.  credentials:'include' + cache:'no-store' ensures the
  // browser always sends cookies and never returns a cached response.
  useEffect(() => {
    fetch(`/api/auth-status?orgId=${orgId}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then(({ isAdmin: a, scorecardTeamId: t }: { isAdmin: boolean; scorecardTeamId: string | null }) => {
        setIsAdmin(a)
        setScorecardTeamId(t)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    const bankerGidsForScores = (playingGroups ?? [])
      .filter((g) => (g as { banker_side_game?: boolean | null }).banker_side_game)
      .map((g) => g.id)
    async function refetchScores() {
      if (playerIds.length > 0) {
        const scoresData = await fetch('/api/scores?playerIds=' + playerIds.join(',')).then((r) => r.json()).catch(() => null)
        if (scoresData) { setScores(scoresData); setLastUpdated(new Date()) }
      }
      if ((isDaytona || isMixedGroups) && roundId) {
        const hvData = await fetch('/api/daytona-hole-values?roundId=' + roundId).then((r) => r.json()).catch(() => null)
        if (hvData) {
          const newHoleValues: Record<string, Record<number, number>> = {}
          for (const hv of hvData as { team_id: string; hole_number: number; value_per_point: number }[]) {
            if (!newHoleValues[hv.team_id]) newHoleValues[hv.team_id] = {}
            newHoleValues[hv.team_id][hv.hole_number] = hv.value_per_point
          }
          setLiveHoleValues(newHoleValues)
        }
      }
      if (isMixedGroups && roundId && bankerGidsForScores.length > 0) {
        const bankerData = await fetch('/api/banker-data?roundId=' + roundId + '&teamIds=' + bankerGidsForScores.join(',')).then((r) => r.json()).catch(() => null)
        if (bankerData?.holes) {
          const newHoles: Record<string, Record<number, { bankerPlayerId: string | null }>> = {}
          for (const bh of bankerData.holes as { team_id: string; hole_number: number; banker_player_id: string | null }[]) {
            if (!newHoles[bh.team_id]) newHoles[bh.team_id] = {}
            newHoles[bh.team_id][bh.hole_number] = { bankerPlayerId: bh.banker_player_id }
          }
          setLiveBankerHoles(newHoles)
        }
        if (bankerData?.bets) {
          const newBets: Record<string, Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>> = {}
          for (const bb of bankerData.bets as { team_id: string; hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[]) {
            if (!newBets[bb.team_id]) newBets[bb.team_id] = {}
            if (!newBets[bb.team_id][bb.hole_number]) newBets[bb.team_id][bb.hole_number] = {}
            newBets[bb.team_id][bb.hole_number][bb.player_id] = { baseBet: bb.base_bet, playerDoubled: bb.player_doubled, bankerDoubled: bb.banker_doubled }
          }
          setLiveBankerBets(newBets)
        }
      }
    }

    const interval = setInterval(refetchScores, 3000)

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refetchScores()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [players])

  // Live-update banker holes and bets when they change
  useEffect(() => {
    const bankerGids = (playingGroups ?? [])
      .filter((g) => (g as { banker_side_game?: boolean | null }).banker_side_game)
      .map((g) => g.id)
    if (!isMixedGroups || !roundId || bankerGids.length === 0) return

    async function refetchBankerData() {
      const bankerData = await fetch('/api/banker-data?roundId=' + roundId + '&teamIds=' + bankerGids.join(',')).then((r) => r.json()).catch(() => null)
      if (bankerData?.holes) {
        const newHoles: Record<string, Record<number, { bankerPlayerId: string | null }>> = {}
        for (const bh of bankerData.holes as { team_id: string; hole_number: number; banker_player_id: string | null }[]) {
          if (!newHoles[bh.team_id]) newHoles[bh.team_id] = {}
          newHoles[bh.team_id][bh.hole_number] = { bankerPlayerId: bh.banker_player_id }
        }
        setLiveBankerHoles(newHoles)
      }
      if (bankerData?.bets) {
        const newBets: Record<string, Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>> = {}
        for (const bb of bankerData.bets as { team_id: string; hole_number: number; player_id: string; base_bet: number; player_doubled: boolean; banker_doubled: boolean }[]) {
          if (!newBets[bb.team_id]) newBets[bb.team_id] = {}
          if (!newBets[bb.team_id][bb.hole_number]) newBets[bb.team_id][bb.hole_number] = {}
          newBets[bb.team_id][bb.hole_number][bb.player_id] = { baseBet: bb.base_bet, playerDoubled: bb.player_doubled, bankerDoubled: bb.banker_doubled }
        }
        setLiveBankerBets(newBets)
      }
    }

    refetchBankerData()
    const bankerInterval = setInterval(refetchBankerData, 3000)
    function onVisibilityChangeBanker() {
      if (document.visibilityState === 'visible') refetchBankerData()
    }
    document.addEventListener('visibilitychange', onVisibilityChangeBanker)
    return () => {
      clearInterval(bankerInterval)
      document.removeEventListener('visibilitychange', onVisibilityChangeBanker)
    }
  }, [isMixedGroups, roundId, playingGroups])

  // Reset all collapsed-by-default sub-states when Payouts panel is closed
  useEffect(() => {
    if (!showPayouts) {
      setShowBallResults(false)
      setShowDaytonaResults(false)
      setShowMatchupResults(false)
      setShowSkinsResults(false)
      setShowSkinsParticipants(false)
      setShowSkinsNetPositions(false)
      setShowMatchupNetPositions(false)
      setShowDaytonaSettlements(false)
      setShowMatchupSettlements(false)
      setShowSkinsSettlements(false)
      setShowBankerSettlements(false)
    }
  }, [showPayouts])

  useEffect(() => {
    if (!roundId) return
    const fetchAssignments = async () => {
      const [assignData, hsData] = await Promise.all([
        fetch('/api/daytona-assignments?roundId=' + roundId).then((r) => r.json()).catch(() => null),
        fetch('/api/hole-strokes?roundId=' + roundId).then((r) => r.json()).catch(() => null),
      ])
      if (assignData && assignData.length > 0) { setAssignments(assignData as DaytonaHoleAssignment[]); setLastUpdated(new Date()) }
      if (hsData) {
        const m: Record<number, string[]> = {}
        for (const hs of hsData as { hole_number: number; player_id: string }[]) {
          if (!m[hs.hole_number]) m[hs.hole_number] = []
          m[hs.hole_number].push(hs.player_id)
        }
        setLiveHoleStrokes(m)
      }
    }
    fetchAssignments()
    const interval = setInterval(fetchAssignments, 5000)
    return () => { clearInterval(interval) }
  }, [roundId])

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)

  const rows = (isDaytona || isTraditional) ? [] : initialTeams.map((team) => {
    const teamPlayers = players.filter((p) => p.team_id === team.id)
    const playerIds = teamPlayers.map((p) => p.id)
    const summary = computeTeamBallSummary(holes, playerIds, scores, ballsCount)
    const frontSummary = computeTeamBallSummary(frontHoles, playerIds, scores, ballsCount)
    const backSummary = computeTeamBallSummary(backHoles, playerIds, scores, ballsCount)
    return { team, summary, frontSummary, backSummary }
  }).sort((a, b) => {
    for (let i = 0; i < ballsCount; i++) {
      const av = a.summary?.ballVsPar[i] ?? null
      const bv = b.summary?.ballVsPar[i] ?? null
      if (av == null && bv == null) continue
      if (av == null) return 1
      if (bv == null) return -1
      if (av !== bv) return av - bv
    }
    return a.team.name.localeCompare(b.team.name)
  })

  const dtGroupRows = isDaytona ? initialTeams.map((team) => {
    const teamPlayers = players.filter((p) => p.team_id === team.id)
    const tpIds = teamPlayers.map((p) => p.id)
    const tAssign = assignments.filter((a) => tpIds.includes(a.player_id))
    const tScores = scores.filter((s) => tpIds.includes(s.player_id))
      .map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
    const variant = team.daytona_variant ?? daytonaVariant
    const groupPointsMap = computePlayerDaytonaPoints(holes, tScores, tAssign, variant)
    const groupRows = teamPlayers.map((p) => ({
      player: p,
      points: groupPointsMap.get(p.id) ?? 0,
      thru: scores.filter((s) => s.player_id === p.id && tpIds.includes(s.player_id)).length,
    })).sort((a, b) => {
      const aHas = a.thru > 0; const bHas = b.thru > 0
      if (!aHas && !bHas) return a.player.name.localeCompare(b.player.name)
      if (!aHas) return 1; if (!bHas) return -1
      return b.points - a.points
    })
    return { team, variant, rows: groupRows }
  }) : []

  const traditionalPlayerRows = isTraditional ? players.map((p) => {
    const playerScores = scores.filter((s) => s.player_id === p.id)
    const totalStrokes = playerScores.reduce((sum, s) => sum + s.strokes, 0)
    const holesPlayed = playerScores.length
    const totalPar = holes
      .filter((h) => playerScores.some((s) => s.hole_number === h.hole_number))
      .reduce((sum, h) => sum + h.par, 0)
    const vspar = holesPlayed > 0 ? totalStrokes - totalPar : null
    return { player: p, totalStrokes, holesPlayed, vspar }
  }).sort((a, b) => {
    const aHas = a.holesPlayed > 0
    const bHas = b.holesPlayed > 0
    if (!aHas && !bHas) return a.player.name.localeCompare(b.player.name)
    if (!aHas) return 1
    if (!bHas) return -1
    if (a.vspar !== b.vspar) return (a.vspar ?? 999) - (b.vspar ?? 999)
    return a.player.name.localeCompare(b.player.name)
  }) : []

  // Daytona: flat cross-group individual ranking by stroke score vs par
  const dtIndividualRows = isDaytona
    ? players
        .map((p) => {
          const ps = scores.filter((s) => s.player_id === p.id)
          const holesPlayed = ps.length
          const totalStrokes = ps.reduce((sum, s) => sum + s.strokes, 0)
          const totalPar = holes.filter((h) => ps.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
          const vspar = holesPlayed > 0 ? totalStrokes - totalPar : null
          const groupName = dtGroupRows.find((g) => g.rows.some((r) => r.player.id === p.id))?.team.name ?? ''
          return { player: p, holesPlayed, vspar, groupName }
        })
        .sort((a, b) => {
          const aHas = a.holesPlayed > 0, bHas = b.holesPlayed > 0
          if (!aHas && !bHas) return a.player.name.localeCompare(b.player.name)
          if (!aHas) return 1; if (!bHas) return -1
          if (a.vspar !== b.vspar) return (a.vspar ?? 999) - (b.vspar ?? 999)
          return a.player.name.localeCompare(b.player.name)
        })
    : []

  // Ball game: individual stroke-play ranking
  const ballIndividualRows = !isDaytona && !isTraditional
    ? players
        .map((p) => {
          const ps = scores.filter((s) => s.player_id === p.id)
          const holesPlayed = ps.length
          const totalStrokes = ps.reduce((sum, s) => sum + s.strokes, 0)
          const totalPar = holes.filter((h) => ps.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
          return { player: p, holesPlayed, vspar: holesPlayed > 0 ? totalStrokes - totalPar : null }
        })
        .sort((a, b) => {
          const aHas = a.holesPlayed > 0, bHas = b.holesPlayed > 0
          if (!aHas && !bHas) return a.player.name.localeCompare(b.player.name)
          if (!aHas) return 1; if (!bHas) return -1
          if (a.vspar !== b.vspar) return (a.vspar ?? 999) - (b.vspar ?? 999)
          return a.player.name.localeCompare(b.player.name)
        })
    : []

  // Traditional: players grouped by team (for group view), with optional Daytona points
  const traditionalGroupRows = isTraditional
    ? initialTeams
        .map((team) => {
          const rows = traditionalPlayerRows.filter((r) => r.player.team_id === team.id)
          const hasDaytona = !!team.daytona_variant
          let pointsMap: Map<string, number> | null = null
          if (hasDaytona) {
            const tpIds = rows.map((r) => r.player.id)
            const tAssign = assignments.filter((a) => tpIds.includes(a.player_id))
            const tScores = scores.filter((s) => tpIds.includes(s.player_id))
              .map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
            pointsMap = computePlayerDaytonaPoints(holes, tScores, tAssign, team.daytona_variant!.split('|')[0])
          }
          return { team, rows, hasDaytona, pointsMap }
        })
        .filter((g) => g.rows.length > 0)
        .sort((a, b) => a.team.name.localeCompare(b.team.name, undefined, { numeric: true, sensitivity: 'base' }))
    : []

  const hasStandardGroupView = !isDaytona && !isTraditional && (isMixedGroups || initialTeams.some((t) => !!t.daytona_variant))

  const standardGroupRows = hasStandardGroupView
    ? isMixedGroups
      ? (playingGroups ?? []).map((pg) => {
          const pids = groupPlayerMap[pg.id] ?? []
          const groupPlayers = players.filter((p) => pids.includes(p.id))
          const rows = groupPlayers.map((p) => {
            const ps = scores.filter((s) => s.player_id === p.id)
            const holesPlayed = ps.length
            const totalStrokes = ps.reduce((sum, s) => sum + s.strokes, 0)
            const totalPar = holes.filter((h) => ps.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
            return { player: p, holesPlayed, vspar: holesPlayed > 0 ? totalStrokes - totalPar : null }
          }).sort((a, b) => {
            if (!a.holesPlayed && !b.holesPlayed) return a.player.name.localeCompare(b.player.name)
            if (!a.holesPlayed) return 1; if (!b.holesPlayed) return -1
            return (a.vspar ?? 999) - (b.vspar ?? 999)
          })
          const hasDaytona = !!pg.daytona_variant
          let pointsMap: Map<string, number> | null = null
          if (hasDaytona) {
            const tAssign = assignments.filter((a) => pids.includes(a.player_id))
            const tScores = scores.filter((s) => pids.includes(s.player_id))
            const variant = pg.daytona_variant!.split('|')[0]
            const is5ManGroup = variant.startsWith('5man')
            const ptsMap = new Map<string, number>()
            const assignedIds = new Set<string>()
            for (const hole of holes) {
              const ha = tAssign.filter((a) => a.hole_number === hole.hole_number)
              if (!ha.length) continue
              const leftIds = ha.filter((a) => a.side === 'left').map((a) => a.player_id)
              const rightIds = ha.filter((a) => a.side === 'right').map((a) => a.player_id)
              for (const id of [...leftIds, ...rightIds]) assignedIds.add(id)
              const strokeIds = liveHoleStrokes[hole.hole_number] ?? []
              const netScores = tScores.map((s) => ({
                ...s,
                strokes: s.strokes - (strokeIds.includes(s.player_id) ? 1 : 0),
              }))
              if (is5ManGroup) {
                if (leftIds.length < 2 || rightIds.length < 3) continue
                const holePts = computeHoleDaytonaPointsFiveMan(leftIds, rightIds, netScores, hole.hole_number, hole.par)
                for (const [id, pts] of holePts) ptsMap.set(id, (ptsMap.get(id) ?? 0) + pts)
              } else {
                if (leftIds.length < 2 || rightIds.length < 2) continue
                const lSc = leftIds.map((id) => netScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
                const rSc = rightIds.map((id) => netScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
                if (lSc.length < 2 || rSc.length < 2) continue
                const { leftDt, rightDt } = computeHoleDaytonaWithSides(lSc, rSc, hole.par)
                if (leftDt === null || rightDt === null) continue
                const diff = Math.abs(leftDt - rightDt)
                const leftPts = leftDt < rightDt ? diff : leftDt > rightDt ? -diff : 0
                for (const id of leftIds) ptsMap.set(id, (ptsMap.get(id) ?? 0) + leftPts)
                for (const id of rightIds) ptsMap.set(id, (ptsMap.get(id) ?? 0) - leftPts)
              }
            }
            for (const id of assignedIds) { if (!ptsMap.has(id)) ptsMap.set(id, 0) }
            pointsMap = ptsMap
          }
          const hasBanker = !!(pg as { banker_side_game?: boolean | null }).banker_side_game
          const bankerTotals: Record<string, number> = {}
          if (hasBanker) {
            const bHoles = liveBankerHoles[pg.id] ?? {}
            const bBets = liveBankerBets[pg.id] ?? {}
            const pgAutoStrokes = !!(pg as { auto_strokes?: boolean | null }).auto_strokes
            const pgMinBet = (pg as { banker_side_game_min_bet?: number | null }).banker_side_game_min_bet ?? 2
            const effHcp = (h: number) => Math.max(0, Math.trunc(h))
            for (const pid of pids) bankerTotals[pid] = 0
            for (const hole of holes) {
              const hd = bHoles[hole.hole_number]
              if (!hd?.bankerPlayerId) continue
              const bankerId = hd.bankerPlayerId
              const bankerPlayer = groupPlayers.find((p) => p.id === bankerId)
              if (!bankerPlayer) continue
              const bankerGross = scores.find((s) => s.player_id === bankerId && s.hole_number === hole.hole_number)?.strokes
              if (bankerGross === undefined) continue
              // Effective stroke IDs: manual override takes precedence; auto-compute if enabled
              const manualStrokes = liveHoleStrokes[hole.hole_number]
              let effIds: string[]
              if (manualStrokes !== undefined) {
                effIds = manualStrokes
              } else if (pgAutoStrokes) {
                const bHcpVal = bankerPlayer.handicap != null ? effHcp(bankerPlayer.handicap) : null
                const si = hole.stroke_index ?? 999
                const playerAutoIds: string[] = bHcpVal != null
                  ? groupPlayers.filter((p) => {
                      if (p.id === bankerId) return false
                      const ph = p.handicap != null ? effHcp(p.handicap) : null
                      if (ph == null) return false
                      return ph - bHcpVal > 0 && si <= ph - bHcpVal
                    }).map((p) => p.id)
                  : []
                const bankerReceives = bHcpVal != null && groupPlayers.some((p) => {
                  if (p.id === bankerId) return false
                  const ph = p.handicap != null ? effHcp(p.handicap) : null
                  if (ph == null) return false
                  return bHcpVal - ph > 0 && si <= bHcpVal - ph
                })
                effIds = [...playerAutoIds, ...(bankerReceives ? [bankerId] : [])]
              } else {
                effIds = []
              }
              for (const pid of pids) {
                if (pid === bankerId) continue
                const player = groupPlayers.find((p) => p.id === pid)
                if (!player) continue
                const playerGross = scores.find((s) => s.player_id === pid && s.hole_number === hole.hole_number)?.strokes
                if (playerGross === undefined) continue
                const playerNet = playerGross - (effIds.includes(pid) ? 1 : 0)
                // Per-matchup banker stroke: banker gets stroke only against players where bHcp > pHcp
                const si = hole.stroke_index ?? 999
                const bHcp = bankerPlayer.handicap != null ? effHcp(bankerPlayer.handicap) : null
                const pHcp = player.handicap != null ? effHcp(player.handicap) : null
                const bankerInStrokes = effIds.includes(bankerId)
                const bankerStroke = bankerInStrokes && bHcp != null && pHcp != null && bHcp > pHcp && si <= bHcp - pHcp ? 1 : 0
                const bankerNet = bankerGross - bankerStroke
                const bet = bBets[hole.hole_number]?.[pid] ?? { baseBet: pgMinBet, playerDoubled: false, bankerDoubled: false }
                if (bet.baseBet <= 0) continue
                const eff = bet.baseBet * (bet.playerDoubled ? 2 : 1) * (bet.bankerDoubled ? 2 : 1)
                let result = 0
                if (playerNet < bankerNet) result = eff * lbBankerMultiplier(playerNet, hole.par)
                else if (playerNet > bankerNet) result = -eff * lbBankerMultiplier(bankerNet, hole.par)
                bankerTotals[pid] = (bankerTotals[pid] ?? 0) + result
                bankerTotals[bankerId] = (bankerTotals[bankerId] ?? 0) - result
              }
            }
          }
          return { id: pg.id, name: pg.name, daytona_variant: pg.daytona_variant ?? null, rows, hasDaytona, hasBanker, pointsMap, bankerTotals }
        }).filter((g) => g.rows.length > 0)
      : initialTeams
          .map((team) => {
            const rows = ballIndividualRows.filter((r) => r.player.team_id === team.id)
            const hasDaytona = !!team.daytona_variant
            let pointsMap: Map<string, number> | null = null
            if (hasDaytona) {
              const tpIds = rows.map((r) => r.player.id)
              const tAssign = assignments.filter((a) => tpIds.includes(a.player_id))
              const tScores = scores.filter((s) => tpIds.includes(s.player_id))
                .map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
              pointsMap = computePlayerDaytonaPoints(holes, tScores, tAssign, team.daytona_variant!.split('|')[0])
            }
            return { id: team.id, name: team.name, daytona_variant: team.daytona_variant ?? null, rows, hasDaytona, hasBanker: false, pointsMap, bankerTotals: {} as Record<string, number> }
          })
          .filter((g) => g.rows.length > 0)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    : []

  // Payout computations (mirrors AdminDashboard)
  const frontHolesForPayouts = holes.filter((h) => h.hole_number <= 9)
  const backHolesForPayouts = holes.filter((h) => h.hole_number >= 10)
  const dtPayoutValue = ballValues.find((bv) => bv.ball_number === 1)?.value_dollars ?? 0
  const perBallValue = ballValues.find((bv) => bv.ball_number === 1)?.value_dollars ?? 5

  const frontSummaries = (!isDaytona && !isTraditional) ? new Map(initialTeams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(frontHolesForPayouts, tp.map((p) => p.id), scores, ballsCount)]
  })) : new Map()
  const backSummaries = (!isDaytona && !isTraditional) ? new Map(initialTeams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(backHolesForPayouts, tp.map((p) => p.id), scores, ballsCount)]
  })) : new Map()
  const totalSummaries = (!isDaytona && !isTraditional && includeTotal) ? new Map(initialTeams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(holes, tp.map((p) => p.id), scores, ballsCount)]
  })) : undefined
  const poolResults = (!isDaytona && !isTraditional)
    ? calculatePoolPayouts(initialTeams, players, frontSummaries, backSummaries, perBallValue, ballsCount, totalSummaries)
    : { results: [], playerNet: {} as Record<string, number>, settlements: [], potTotal: 0, perBallResult: 0, perPlayerContribution: 0, numDecidedResults: 0, numPlayedResults: 0 }

  // Score map for matchup computations
  const scoreMapForMatchups: Record<string, Record<number, number>> = {}
  for (const s of scores) {
    if (!scoreMapForMatchups[s.player_id]) scoreMapForMatchups[s.player_id] = {}
    scoreMapForMatchups[s.player_id][s.hole_number] = s.strokes
  }
  const matchupPayouts = computeMatchupPayouts(matchups, bestBallMatchups, players, scoreMapForMatchups, holes)

  // Players whose groups have "Exclude Matchups from Payouts" toggled on
  const visibleMatchupPayouts = excludeMatchups
    ? { rows: [], net: {} as Record<string, number>, involvedIds: new Set<string>() }
    : matchupPayouts

  // Hole splits for All Scorecards panel
  const scFrontNine = holes.filter((h) => h.hole_number <= 9).sort((a, b) => a.hole_number - b.hole_number)
  const scBackNine = holes.filter((h) => h.hole_number >= 10).sort((a, b) => a.hole_number - b.hole_number)
  const scFrontPar = scFrontNine.reduce((s, h) => s + h.par, 0)
  const scBackPar = scBackNine.reduce((s, h) => s + h.par, 0)
  const scTotalPar = holes.reduce((s, h) => s + h.par, 0)

  // Skins
  const skinsParticipants = players.filter((p) => p.skins_participant)
  const skinsResults = skinsEnabled && skinsParticipants.length > 0
    ? computeSkinsResults(holes, scores, skinsParticipants, skinsAmount)
    : { skins: [] as SkinResult[], playerNet: {} as Record<string, number>, skinsWon: 0, settlements: [] }

  // Combined net (ball/daytona + matchups + skins)
  type PlayerBreakdown = { ball: number; daytona: number; banker: number; matchups: number; skins: number; hammer: number }
  const playerBreakdown: Record<string, PlayerBreakdown> = {}
  for (const p of players) playerBreakdown[p.id] = { ball: 0, daytona: 0, banker: 0, matchups: 0, skins: 0, hammer: 0 }
  const combinedNet: Record<string, number> = {}
  for (const p of players) {
    const ballNet = (isDaytona || isTraditional) ? 0 : (poolResults.playerNet[p.id] ?? 0)
    const mNet = visibleMatchupPayouts.net[p.id] ?? 0
    const sNet = skinsResults.playerNet[p.id] ?? 0
    combinedNet[p.id] = ballNet + mNet + sNet
    playerBreakdown[p.id].ball = ballNet
    playerBreakdown[p.id].matchups = mNet
    playerBreakdown[p.id].skins = sNet
  }
  // For Daytona main format: add daytona per-group net
  if (isDaytona) {
    for (const group of dtGroupRows) {
      const tp = group.rows.map((r) => r.player)
      const tpIds = tp.map((p) => p.id)
      const tAssign = assignments.filter((a) => tpIds.includes(a.player_id))
      const tScores = scores.filter((s) => tpIds.includes(s.player_id))
      const netTScores = tScores.map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
      const tHoleVals = liveHoleValues[group.team.id] ?? {}
      const dollarTotals = computePlayerDaytonaDollars(holes, netTScores, tAssign, group.variant, dtPayoutValue, tHoleVals)
      const { net: pNet } = settleDaytonaPlayerPoints(tp, dollarTotals, 1)
      for (const [id, amt] of Object.entries(pNet)) {
        combinedNet[id] = (combinedNet[id] ?? 0) + amt
        if (playerBreakdown[id]) playerBreakdown[id].daytona += amt
      }
    }
  }
  // Daytona side game: groups in standardGroupRows or traditionalGroupRows with hasDaytona
  for (const group of standardGroupRows) {
    if (!group.hasDaytona) continue
    const raw = group.daytona_variant!
    const variant = raw.split('|')[0]
    const payoutStr = raw.includes('|') ? raw.split('|')[1] : null
    const groupPayoutValue = payoutStr ? (parseFloat(payoutStr) || dtPayoutValue) : dtPayoutValue
    const pids = group.rows.map((r) => r.player.id)
    const groupPlayers = players.filter((p) => pids.includes(p.id))
    const tAssign = assignments.filter((a) => pids.includes(a.player_id))
    const tScores = scores.filter((s) => pids.includes(s.player_id))
    const netTScores = tScores.map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
    const tHoleVals = liveHoleValues[group.id] ?? {}
    const dollarTotals = computePlayerDaytonaDollars(holes, netTScores, tAssign, variant, groupPayoutValue, tHoleVals)
    const { net: pNet } = settleDaytonaPlayerPoints(groupPlayers, dollarTotals, 1)
    for (const [id, amt] of Object.entries(pNet)) {
      combinedNet[id] = (combinedNet[id] ?? 0) + amt
      if (playerBreakdown[id]) playerBreakdown[id].daytona += amt
    }
  }
  for (const group of traditionalGroupRows) {
    if (!group.hasDaytona) continue
    const raw = group.team.daytona_variant!
    const variant = raw.split('|')[0]
    const payoutStr = raw.includes('|') ? raw.split('|')[1] : null
    const groupPayoutValue = payoutStr ? (parseFloat(payoutStr) || dtPayoutValue) : dtPayoutValue
    const pids = group.rows.map((r) => r.player.id)
    const groupPlayers = players.filter((p) => pids.includes(p.id))
    const tAssign = assignments.filter((a) => pids.includes(a.player_id))
    const tScores = scores.filter((s) => pids.includes(s.player_id))
    const netTScores = tScores.map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
    const tHoleVals = liveHoleValues[group.team.id] ?? {}
    const dollarTotals = computePlayerDaytonaDollars(holes, netTScores, tAssign, variant, groupPayoutValue, tHoleVals)
    const { net: pNet } = settleDaytonaPlayerPoints(groupPlayers, dollarTotals, 1)
    for (const [id, amt] of Object.entries(pNet)) {
      combinedNet[id] = (combinedNet[id] ?? 0) + amt
      if (playerBreakdown[id]) playerBreakdown[id].daytona += amt
    }
  }
  // Banker side game
  for (const group of standardGroupRows) {
    if (!group.hasBanker) continue
    for (const [id, amt] of Object.entries(group.bankerTotals)) {
      combinedNet[id] = (combinedNet[id] ?? 0) + amt
      if (playerBreakdown[id]) playerBreakdown[id].banker += amt
    }
  }
  // Hammer matchup payouts
  const isHammer = format === 'hammer'
  if (isHammer) {
    for (const matchup of hammerMatchups) {
      const t1Players = players.filter((p) => p.team_id === matchup.team1_id)
      const t2Players = players.filter((p) => p.team_id === matchup.team2_id)
      const matchupHoles = hammerHolesMap[matchup.id] ?? {}
      let t1 = 0, t2 = 0
      for (const hole of holes) {
        const allMatchupPlayers = [...t1Players, ...t2Players]
        if (!allMatchupPlayers.every((p) => scores.some((s) => s.player_id === p.id && s.hole_number === hole.hole_number))) continue
        const hs = matchupHoles[hole.hole_number] ?? { stake: matchup.base_bet, lastHammerTeam: null, foldedTeam: null, preTeeUsed: false }
        if (hs.foldedTeam === 1) { t2 += hs.stake; t1 -= hs.stake }
        else if (hs.foldedTeam === 2) { t1 += hs.stake; t2 -= hs.stake }
        else {
          const getNet = (pId: string, hNum: number) => { const g = scores.find((s) => s.player_id === pId && s.hole_number === hNum)?.strokes; if (g === undefined) return undefined; return g - ((liveHoleStrokes[hNum] ?? []).includes(pId) ? 1 : 0) }
          const t1Nets = t1Players.map((p) => getNet(p.id, hole.hole_number)).filter((s): s is number => s !== undefined)
          const t2Nets = t2Players.map((p) => getNet(p.id, hole.hole_number)).filter((s): s is number => s !== undefined)
          if (t1Nets.length === 0 || t2Nets.length === 0) continue
          const t1Best = Math.min(...t1Nets); const t2Best = Math.min(...t2Nets)
          if (t1Best === t2Best) continue
          const winner = t1Best < t2Best ? 1 : 2
          const winnerBest = winner === 1 ? t1Best : t2Best
          const mult = winnerBest <= hole.par - 2 ? 3 : winnerBest === hole.par - 1 ? 2 : 1
          const amount = hs.stake * mult
          if (winner === 1) { t1 += amount; t2 -= amount } else { t2 += amount; t1 -= amount }
        }
      }
      if (t1Players.length > 0) { const share = t1 / t1Players.length; for (const p of t1Players) { combinedNet[p.id] = (combinedNet[p.id] ?? 0) + share; if (playerBreakdown[p.id]) playerBreakdown[p.id].hammer += share } }
      if (t2Players.length > 0) { const share = t2 / t2Players.length; for (const p of t2Players) { combinedNet[p.id] = (combinedNet[p.id] ?? 0) + share; if (playerBreakdown[p.id]) playerBreakdown[p.id].hammer += share } }
    }
  }
  const combinedSettlements = minimizeSettlements(players, combinedNet)
  const matchupOnlySettlements = minimizeSettlements(players, visibleMatchupPayouts.net)
  const numSegments = includeTotal ? 3 : 2
  const ballResults = poolResults.results

  const isComplete = players.length > 0 && holes.length > 0 &&
    players.every((p) => scores.filter((s) => s.player_id === p.id).length === holes.length)

  const formattedDate = new Date(roundDate + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  useEffect(() => {
    const locked = showOptions || showPayouts || showAllScorecards || !!showPin || !!breakdownPlayerId || !!rosterPopup
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [showOptions, showPayouts, showAllScorecards, showPin, breakdownPlayerId, rosterPopup])

  const headerRef = useRef<HTMLElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const ro = new ResizeObserver(() => {
      if (spacerRef.current) spacerRef.current.style.height = `${header.offsetHeight}px`
    })
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  const scoreColW = '2rem'
  const dtColW = '3rem'

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {showPin && <PinLoginModal teams={initialTeams} onClose={() => setShowPin(false)} isGroup={isDaytona || isTraditional} orgSlug={orgSlug} onBeforeNavigate={scorecardTeamId ? logoutCurrentTeam : undefined} playingGroups={isMixedGroups ? (playingGroups ?? []) : undefined} />}

      {showOptions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => { setShowOptions(false); setShowSignOutConfirm(false) }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Options</h2>
              <button onClick={() => { setShowOptions(false); setShowSignOutConfirm(false) }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              {isAdmin ? (
                <>
                  <a href={`/${orgSlug}/admin/dashboard`} className="w-full text-center py-3 rounded-xl font-semibold text-sm" style={{ background: navy, color: 'white' }}>
                    Admin Hub
                  </a>
                  {scorecardTeamId && (
                    <button onClick={handleChangeTeam} className="w-full py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: navy, color: navy }}>
                      Enter New PIN
                    </button>
                  )}
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
              {showSignOutConfirm ? (
                <div className="space-y-2">
                  <p className="text-sm text-center text-gray-700 font-medium">
                    {isMixedGroups && scorecardGroupId
                      ? `Sign out of ${playingGroups?.find((g) => g.id === scorecardGroupId)?.name ?? 'this group'}?`
                      : 'Sign out of this group?'}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={isMixedGroups && scorecardGroupId ? handleGroupSignOut : handleSignOut} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white" style={{ background: '#dc2626' }}>
                      Sign Out
                    </button>
                    <button onClick={() => setShowSignOutConfirm(false)} className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowSignOutConfirm(true)}
                  className="w-full py-3 rounded-xl font-semibold text-sm text-white"
                  style={{ background: '#6b7280' }}
                >
                  {isMixedGroups && scorecardGroupId
                    ? `Sign Out of ${playingGroups?.find((g) => g.id === scorecardGroupId)?.name ?? 'Group'}`
                    : `Sign Out of ${orgName}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showPayouts && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowPayouts(false)}>
          <div className="bg-white rounded-t-2xl max-h-[85vh] flex flex-col" style={{ animation: 'slideUp 0.28s ease-out', boxShadow: '0 0 0 2px rgba(255,255,255,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-4 flex-shrink-0" style={{ background: navy, borderBottom: '1px solid rgba(255,255,255,0.35)' }}>
              <h3 className="font-bold text-white text-base">Payouts</h3>
              <button onClick={() => setShowPayouts(false)} className="text-xl font-bold leading-none" style={{ color: 'rgba(255,255,255,0.7)' }}>×</button>
            </div>
            <div className="px-4 py-4 space-y-4 overflow-y-auto flex-1">
              {/* ── Daytona Results (collapsible) ── */}
              {isDaytona && (
                <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                  <button onClick={() => setShowDaytonaResults((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <span className="text-sm font-semibold text-gray-800">Daytona Results</span>
                    <span className="text-gray-400 text-xs">{showDaytonaResults ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showDaytonaResults && (
                    <div className="border-t border-gray-100">
                      {dtGroupRows.map((group, ti) => {
                        const teamPlayers = group.rows.map((r) => r.player)
                        const tpIds = teamPlayers.map((p) => p.id)
                        const tAssign = assignments.filter((a) => tpIds.includes(a.player_id))
                        const tScores = scores.filter((s) => tpIds.includes(s.player_id))
                        const netTScores2 = tScores.map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
                        const tHoleVals2 = liveHoleValues[group.team.id] ?? {}
                        const pointTotals = computePlayerDaytonaPoints(holes, netTScores2, tAssign, group.variant)
                        const dollarTotals2 = computePlayerDaytonaDollars(holes, netTScores2, tAssign, group.variant, dtPayoutValue, tHoleVals2)
                        const { net: playerNet, settlements: playerSettlements } = settleDaytonaPlayerPoints(teamPlayers, dollarTotals2, 1)
                        const variantLabel = group.variant?.startsWith('5man-flares') ? '5-Man Flares' : group.variant?.startsWith('5man') ? '5-Man Normal' : '4-Man'
                        const segments = buildSegmentBreakdown(holes, netTScores2, tAssign, group.variant, tHoleVals2, dtPayoutValue)
                        return (
                          <div key={group.team.id} className={ti > 0 ? 'border-t-2 border-gray-200' : ''}>
                            <div className="px-4 py-2 bg-gray-50 flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{group.team.name}</span>
                              <span className="text-xs text-gray-400">· Daytona {variantLabel}</span>
                            </div>
                            <div className="px-4 py-2"><p className="text-xs text-gray-400">{formatHoleRateBreakdown(holes, tHoleVals2, dtPayoutValue)}</p></div>
                            <div className="divide-y divide-gray-100">
                              {[...teamPlayers].sort((a, b) => (playerNet[b.id] ?? 0) - (playerNet[a.id] ?? 0)).map((p) => { const pts = pointTotals.get(p.id) ?? 0; const dollars = playerNet[p.id] ?? 0; return (
                                <div key={p.id}>
                                  <div className={`flex items-center px-4 gap-2 ${segments.length > 0 ? 'pt-2 pb-1' : 'py-2.5'}`}>
                                    <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{p.name}</span>
                                    {segments.length === 0 && <span className="text-sm font-semibold tabular-nums w-16 text-right" style={{ color: pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#6b7280' }}>{pts > 0 ? `+${pts}` : pts === 0 ? '0' : pts} pts</span>}
                                    <span className="text-sm font-bold tabular-nums w-20 text-right" style={{ color: dollars > 0 ? '#16a34a' : dollars < 0 ? '#dc2626' : '#6b7280' }}>{fmtDollars(dollars)}</span>
                                  </div>
                                  {segments.length > 0 && (
                                    <div className="px-4 pb-2 flex gap-x-3" style={{ fontSize: segments.length <= 2 ? '12px' : segments.length === 3 ? '10px' : '9px' }}>
                                      {segments.map((seg, si) => { const sp = seg.ptsByPlayer.get(p.id) ?? 0; const sd = Math.round(sp * seg.rate * 100) / 100; return (
                                        <span key={si} className="tabular-nums text-gray-400 whitespace-nowrap">
                                          {seg.label}:{' '}
                                          <span style={{ color: sp > 0 ? '#16a34a' : sp < 0 ? '#dc2626' : '#6b7280' }}>{sp > 0 ? `+${sp}` : sp}pts</span>
                                          {' ('}
                                          <span style={{ color: sd > 0 ? '#16a34a' : sd < 0 ? '#dc2626' : '#6b7280' }}>{sd > 0 ? `$${Math.round(sd)}` : sd < 0 ? `$${Math.round(Math.abs(sd))}` : '$0'}</span>
                                          {')'}
                                        </span>
                                      )})}
                                    </div>
                                  )}
                                </div>
                              )})}
                            </div>
                            {(playerSettlements.length > 0 || (playerSettlements.length === 0 && teamPlayers.length > 0)) && (
                              <div className="border-t border-gray-100 px-4 py-3">
                                <button
                                  onClick={() => setShowDaytonaSettlements((v) => !v)}
                                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"
                                >
                                  <span>Settlement</span>
                                  <span className="text-gray-400 text-[10px]">{showDaytonaSettlements ? '▲' : '▼'}</span>
                                </button>
                                {showDaytonaSettlements && (
                                  playerSettlements.length === 0
                                    ? <p className="text-xs text-gray-400 text-center">{[...pointTotals.values()].every((v) => v === 0) ? 'No holes scored yet.' : 'All even — no payments needed.'}</p>
                                    : playerSettlements.map((s, i) => (
                                      <div key={i} className="flex items-center py-1 gap-2 text-sm">
                                        <span className="flex-1 min-w-0 truncate"><span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span></span>
                                        <span className="font-bold text-gray-900">{fmtSettle(s.amount)}</span>
                                      </div>
                                    ))
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Ball Results (collapsible) ── */}
              {!isDaytona && !isTraditional && (
                <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                  <button onClick={() => setShowBallResults((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <h4 className="font-semibold text-gray-900 text-sm">Ball Results</h4>
                    <span className="text-gray-400 text-xs flex-shrink-0 ml-2">{showBallResults ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showBallResults && <div className="border-t border-gray-100">
                    <div className="px-4 pt-3 pb-3">
                      {(() => {
                        const ballsByTeam: Record<string, { id: string; name: string; balls: number }> = {}
                        for (const r of ballResults) {
                          if (!r.played) continue
                          if (!r.tied && r.winnerId && r.winnerName) {
                            if (!ballsByTeam[r.winnerId]) ballsByTeam[r.winnerId] = { id: r.winnerId, name: r.winnerName, balls: 0 }
                            ballsByTeam[r.winnerId].balls += 1
                          } else if (r.tied) {
                            const summaryMap = r.half === 'Front 9' ? frontSummaries : r.half === 'Back 9' ? backSummaries : (totalSummaries ?? new Map())
                            const bi = r.ball - 1
                            for (const t of initialTeams) {
                              const total = summaryMap.get(t.id)?.ballTotals[bi] ?? null
                              if (total !== null && total === r.winnerTotal) {
                                if (!ballsByTeam[t.id]) ballsByTeam[t.id] = { id: t.id, name: t.name, balls: 0 }
                                ballsByTeam[t.id].balls += 0.5
                              }
                            }
                          }
                        }
                        const tallyEntries = Object.values(ballsByTeam).sort((a, b) => b.balls - a.balls)
                        const colClass = includeTotal ? 'grid-cols-[5rem_1fr_1fr_1fr]' : 'grid-cols-[5rem_1fr_1fr]'
                        const getTiedInfo = (result: (typeof ballResults)[number]) => {
                          const summaryMap = result.half === 'Front 9' ? frontSummaries : result.half === 'Back 9' ? backSummaries : (totalSummaries ?? new Map())
                          const bi = result.ball - 1
                          const tiedTeams = initialTeams.filter((t) => {
                            const total = summaryMap.get(t.id)?.ballTotals[bi] ?? null
                            return total !== null && total === result.winnerTotal
                          })
                          const vsPar = tiedTeams.length > 0 ? (summaryMap.get(tiedTeams[0].id)?.ballVsPar[bi] ?? null) : null
                          return { names: tiedTeams.map((t) => t.name), vsPar }
                        }
                        const vpColor = (vp: number | null) => vp == null ? '#9ca3af' : vp < 0 ? '#dc2626' : vp > 0 ? '#111827' : '#16a34a'
                        const vpStr = (vp: number | null) => vp == null ? '' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                        return (
                          <>
                            {/* Game info */}
                            <p className="text-xs text-gray-500 mb-3">{ballsCount * numSegments} Balls · ${perBallValue}/Ball · ${ballsCount * numSegments * perBallValue}/Player</p>
                            {/* Balls tally */}
                            {tallyEntries.length > 0 && (
                              <div className="flex flex-col gap-1.5 mb-3">
                                {tallyEntries.map((e) => {
                                  const teamPlayerNames = players.filter((p) => p.team_id === e.id).map((p) => p.name)
                                  return (
                                    <div key={e.name} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                                      <span className="text-xs font-bold whitespace-nowrap" style={{ color: navy }}>{e.name}</span>
                                      <span className="text-xs font-bold" style={{ color: gold }}>{e.balls}</span>
                                      <span className="text-[10px] text-gray-500 whitespace-nowrap">Ball{e.balls !== 1 ? 's' : ''}</span>
                                      {teamPlayerNames.length > 0 && (
                                        <span className="text-[10px] text-gray-400 truncate">· {teamPlayerNames.join(', ')}</span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            {/* Table header */}
                            <div className={`grid ${colClass} text-[10px] font-bold uppercase tracking-wide text-gray-400 pb-1.5 border-b border-gray-200`}>
                              <span>Ball</span>
                              <span>Front 9</span>
                              <span>Back 9</span>
                              {includeTotal && <span>Total</span>}
                            </div>
                            {/* Table rows */}
                            {Array.from({ length: ballsCount }, (_, bi) => {
                              const front = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Front 9')
                              const back = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Back 9')
                              const total = includeTotal ? ballResults.find((r) => r.ball === bi + 1 && r.half === 'Total 18') : undefined
                              const segs = includeTotal ? [front, back, total] : [front, back]
                              const renderCell = (result: typeof front) => {
                                if (!result || !result.played) return <span className="text-sm text-gray-300">–</span>
                                if (result.tied) {
                                  const { names, vsPar } = getTiedInfo(result)
                                  const vs = vpStr(vsPar)
                                  return (
                                    <span className="flex items-baseline gap-1 min-w-0">
                                      <span className="text-sm font-semibold truncate" style={{ color: navy }}>{names.join(' / ')}</span>
                                      {vs && <span className="text-xs font-medium flex-shrink-0" style={{ color: vpColor(vsPar) }}>{vs}</span>}
                                    </span>
                                  )
                                }
                                const vp = result.winnerVsPar
                                const vs = vpStr(vp)
                                return (
                                  <span className="flex items-baseline gap-1 min-w-0">
                                    <span className="text-sm font-semibold truncate" style={{ color: navy }}>{result.winnerName}</span>
                                    {vs && <span className="text-xs font-medium flex-shrink-0" style={{ color: vpColor(vp) }}>{vs}</span>}
                                  </span>
                                )
                              }
                              return (
                                <div key={bi} className={`grid ${colClass} items-center py-2 border-b border-gray-50 last:border-0`}>
                                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: gold }}>{BALL_NAMES[bi]}</span>
                                  {segs.map((result, hi) => <div key={hi}>{renderCell(result)}</div>)}
                                </div>
                              )
                            })}
                          </>
                        )
                      })()}
                    </div>
                    <div className="border-t border-gray-100 px-4 pt-3 pb-2">
                      <button
                        onClick={() => setShowBallPotBreakdown((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2"
                      >
                        <span>Pot Breakdown</span>
                        <span className="text-gray-400 text-[10px]">{showBallPotBreakdown ? '▲' : '▼'}</span>
                      </button>
                      {showBallPotBreakdown && (() => {
                        const totalBalls = ballsCount * numSegments
                        const { potTotal, perBallResult, perPlayerContribution, numPlayedResults } = poolResults
                        const totalPlayers = players.filter((p) => initialTeams.some((t) => t.id === p.team_id)).length
                        const allTeamBalls: Record<string, { name: string; balls: number; playerCount: number }> = {}
                        for (const t of initialTeams) {
                          allTeamBalls[t.id] = { name: t.name, balls: 0, playerCount: players.filter((p) => p.team_id === t.id).length }
                        }
                        for (const r of ballResults) {
                          if (!r.played) continue
                          if (!r.tied && r.winnerId) {
                            if (allTeamBalls[r.winnerId]) allTeamBalls[r.winnerId].balls += 1
                          } else if (r.tied) {
                            const summaryMap = r.half === 'Front 9' ? frontSummaries : r.half === 'Back 9' ? backSummaries : (totalSummaries ?? new Map())
                            const bi = r.ball - 1
                            const tiedTeams = initialTeams.filter((t) => (summaryMap.get(t.id)?.ballTotals[bi] ?? null) === r.winnerTotal)
                            for (const t of tiedTeams) {
                              if (allTeamBalls[t.id]) allTeamBalls[t.id].balls += 0.5
                            }
                          }
                        }
                        const breakdown = Object.values(allTeamBalls).sort((a, b) => b.balls - a.balls)
                        return (
                          <div className="space-y-2">
                            <div className="text-xs text-gray-500 space-y-0.5">
                              <div><span className="font-semibold text-gray-700">${potTotal.toFixed(2)}</span> total pot <span className="text-gray-400">({totalPlayers} players × ${perPlayerContribution.toFixed(2)}/player)</span></div>
                              <div><span className="font-semibold text-gray-700">${perBallResult.toFixed(2)}</span>/ball <span className="text-gray-400">(${potTotal.toFixed(2)} ÷ {numPlayedResults} ball{numPlayedResults !== 1 ? 's' : ''} played)</span></div>
                            </div>
                            <div className="mt-2 space-y-2">
                              {breakdown.map((e) => {
                                const winnings = e.balls * perBallResult
                                const grossPerPlayer = e.playerCount > 0 ? winnings / e.playerCount : 0
                                const netPerPlayer = grossPerPlayer - perPlayerContribution
                                return (
                                  <div key={e.name} className="border-b border-gray-50 last:border-0 pb-1.5 last:pb-0">
                                    <div className="flex items-center justify-between text-xs mb-0.5">
                                      <span className="font-semibold" style={{ color: navy }}>{e.name}</span>
                                      <span className="font-bold" style={{ color: netPerPlayer > 0 ? '#16a34a' : netPerPlayer < 0 ? '#dc2626' : '#6b7280' }}>
                                        {fmtNetSigned(netPerPlayer)} net
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-gray-500 leading-snug">
                                      {e.balls} Ball{e.balls > 1 ? 's' : ''} × ${perBallResult.toFixed(0)} = <span className="text-gray-700">${winnings.toFixed(2)}</span> ÷ {e.playerCount} = <span className="text-gray-700">${grossPerPlayer.toFixed(2)}/player</span>
                                    </p>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                    <div className="border-t border-gray-100 px-4 pt-3 pb-2">
                      <button
                        onClick={() => setShowBallNetPositions((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2"
                      >
                        <span>Net Positions</span>
                        <span className="text-gray-400 text-[10px]">{showBallNetPositions ? '▲' : '▼'}</span>
                      </button>
                      {showBallNetPositions && (
                        <div className="space-y-1">
                          {[...players]
                            .filter((p) => poolResults.playerNet[p.id] !== undefined)
                            .sort((a, b) => (poolResults.playerNet[b.id] ?? 0) - (poolResults.playerNet[a.id] ?? 0))
                            .map((p) => {
                              const v = poolResults.playerNet[p.id] ?? 0
                              return (
                                <div key={p.id} className="flex items-center justify-between">
                                  <span className="text-xs text-gray-700 min-w-0 truncate">{p.name}</span>
                                  <span className="text-xs font-bold tabular-nums flex-shrink-0" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>
                                    {fmtNetSigned(v)}
                                  </span>
                                </div>
                              )
                            })}
                        </div>
                      )}
                    </div>
                    <div className="border-t border-gray-100 px-4 py-3">
                      <button
                        onClick={() => setShowBallSettlements((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2"
                      >
                        <span>Settlements</span>
                        <span className="text-gray-400 text-[10px]">{showBallSettlements ? '▲' : '▼'}</span>
                      </button>
                      {showBallSettlements && (
                        poolResults.settlements.length === 0
                          ? <p className="text-xs text-gray-400 text-center">All even — no payments needed</p>
                          : poolResults.settlements.map((s, i) => (
                            <div key={i} className="flex items-center justify-between py-1">
                              <span className="text-xs text-gray-800 min-w-0 truncate">
                                <span className="font-semibold text-red-500">{s.fromName}</span>
                                <span className="text-gray-400"> pays </span>
                                <span className="font-semibold text-green-600">{s.toName}</span>
                              </span>
                              <span className="text-xs font-bold text-gray-900 flex-shrink-0">{fmtSettle(s.amount)}</span>
                            </div>
                          ))
                      )}
                    </div>
                  </div>}
                </div>
              )}

              {/* ── Daytona Side Game Results (collapsible) ── */}
              {!isDaytona && (standardGroupRows.some((g) => g.hasDaytona) || traditionalGroupRows.some((g) => g.hasDaytona)) && (
                <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                  <button onClick={() => setShowDaytonaSideResults((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <span className="text-sm font-semibold text-gray-800">Daytona Results</span>
                    <span className="text-gray-400 text-xs">{showDaytonaSideResults ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showDaytonaSideResults && (
                    <div className="border-t border-gray-100">
                      {[...standardGroupRows.filter((g) => g.hasDaytona), ...traditionalGroupRows.filter((g) => g.hasDaytona).map((g) => ({ id: g.team.id, name: g.team.name, daytona_variant: g.team.daytona_variant, rows: g.rows, hasDaytona: true, hasBanker: false, pointsMap: g.pointsMap, bankerTotals: {} as Record<string, number> }))].map((group, ti) => {
                        const rawVariant = group.daytona_variant!
                        const variant = rawVariant.split('|')[0]
                        const payoutStr = rawVariant.includes('|') ? rawVariant.split('|')[1] : null
                        const groupPayoutValue = payoutStr ? (parseFloat(payoutStr) || dtPayoutValue) : dtPayoutValue
                        const pids = group.rows.map((r) => r.player.id)
                        const groupPlayers = players.filter((p) => pids.includes(p.id))
                        const tAssign = assignments.filter((a) => pids.includes(a.player_id))
                        const tScores = scores.filter((s) => pids.includes(s.player_id))
                        const netTScores = tScores.map((s) => ({ ...s, strokes: s.strokes - ((liveHoleStrokes[s.hole_number] ?? []).includes(s.player_id) ? 1 : 0) }))
                        const tHoleVals = liveHoleValues[group.id] ?? {}
                        const pointTotals = group.pointsMap ?? new Map<string, number>()
                        const dollarTotals = computePlayerDaytonaDollars(holes, netTScores, tAssign, variant, groupPayoutValue, tHoleVals)
                        const { net: playerNet, settlements: playerSettlements } = settleDaytonaPlayerPoints(groupPlayers, dollarTotals, 1)
                        const segments = buildSegmentBreakdown(holes, netTScores, tAssign, variant, tHoleVals, groupPayoutValue)
                        return (
                          <div key={group.id} className={ti > 0 ? 'border-t-2 border-gray-200' : ''}>
                            <div className="px-4 py-2 bg-gray-50 flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{group.name}</span>
                            </div>
                            <div className="px-4 py-2"><p className="text-xs text-gray-400">{formatHoleRateBreakdown(holes, tHoleVals, groupPayoutValue)}</p></div>
                            <div className="divide-y divide-gray-100">
                              {[...groupPlayers].sort((a, b) => (playerNet[b.id] ?? 0) - (playerNet[a.id] ?? 0)).map((p) => { const pts = pointTotals.get(p.id) ?? 0; const dollars = playerNet[p.id] ?? 0; return (
                                <div key={p.id}>
                                  <div className={`flex items-center px-4 gap-2 ${segments.length > 0 ? 'pt-2 pb-1' : 'py-2.5'}`}>
                                    <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{p.name}</span>
                                    {segments.length === 0 && <span className="text-sm font-semibold tabular-nums w-16 text-right" style={{ color: pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#6b7280' }}>{pts > 0 ? `+${pts}` : pts === 0 ? '0' : pts} pts</span>}
                                    <span className="text-sm font-bold tabular-nums w-20 text-right" style={{ color: dollars > 0 ? '#16a34a' : dollars < 0 ? '#dc2626' : '#6b7280' }}>{fmtDollars(dollars)}</span>
                                  </div>
                                  {segments.length > 0 && (
                                    <div className="px-4 pb-2 flex gap-x-3" style={{ fontSize: segments.length <= 2 ? '12px' : segments.length === 3 ? '10px' : '9px' }}>
                                      {segments.map((seg, si) => { const sp = seg.ptsByPlayer.get(p.id) ?? 0; const sd = Math.round(sp * seg.rate * 100) / 100; return (
                                        <span key={si} className="tabular-nums text-gray-400 whitespace-nowrap">
                                          {seg.label}:{' '}
                                          <span style={{ color: sp > 0 ? '#16a34a' : sp < 0 ? '#dc2626' : '#6b7280' }}>{sp > 0 ? `+${sp}` : sp}pts</span>
                                          {' ('}
                                          <span style={{ color: sd > 0 ? '#16a34a' : sd < 0 ? '#dc2626' : '#6b7280' }}>{sd > 0 ? `$${Math.round(sd)}` : sd < 0 ? `$${Math.round(Math.abs(sd))}` : '$0'}</span>
                                          {')'}
                                        </span>
                                      )})}
                                    </div>
                                  )}
                                </div>
                              )})}
                            </div>
                            {(playerSettlements.length > 0 || groupPlayers.length > 0) && (
                              <div className="border-t border-gray-100 px-4 py-3">
                                <button onClick={() => setShowDaytonaSideSettlements((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                  <span>Settlement</span>
                                  <span className="text-gray-400 text-[10px]">{showDaytonaSideSettlements ? '▲' : '▼'}</span>
                                </button>
                                {showDaytonaSideSettlements && (
                                  playerSettlements.length === 0
                                    ? <p className="text-xs text-gray-400 text-center">{[...pointTotals.values()].every((v) => v === 0) ? 'No holes scored yet.' : 'All even — no payments needed.'}</p>
                                    : playerSettlements.map((s, i) => (
                                      <div key={i} className="flex items-center py-1 gap-2 text-sm">
                                        <span className="flex-1 min-w-0 truncate"><span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span></span>
                                        <span className="font-bold text-gray-900">{fmtSettle(s.amount)}</span>
                                      </div>
                                    ))
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Banker Results (collapsible) ── */}
              {standardGroupRows.some((g) => g.hasBanker) && (
                <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                  <button onClick={() => setShowBankerResults((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <span className="text-sm font-semibold text-gray-800">Banker Results</span>
                    <span className="text-gray-400 text-xs">{showBankerResults ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showBankerResults && (
                    <div className="border-t border-gray-100">
                      {standardGroupRows.filter((g) => g.hasBanker).map((group, ti) => {
                        const pids = group.rows.map((r) => r.player.id)
                        const groupPlayers = players.filter((p) => pids.includes(p.id))
                        const tNet = group.bankerTotals
                        const tSettlements = minimizeSettlements(groupPlayers, tNet)
                        return (
                          <div key={group.id} className={ti > 0 ? 'border-t-2 border-gray-200' : ''}>
                            <div className="px-4 py-2 bg-gray-50">
                              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{group.name}</span>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {groupPlayers.map((p) => {
                                const v = Math.round((tNet[p.id] ?? 0) * 100) / 100
                                return (
                                  <div key={p.id} className="flex items-center px-4 py-2.5 gap-2">
                                    <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{p.name}</span>
                                    <span className="text-sm font-bold tabular-nums w-20 text-right" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>{fmtDollars(v)}</span>
                                  </div>
                                )
                              })}
                            </div>
                            {tSettlements.length > 0 && (
                              <div className="border-t border-gray-100 px-4 py-3">
                                <button onClick={() => setShowBankerSettlements((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                  <span>Settlement</span>
                                  <span className="text-gray-400 text-[10px]">{showBankerSettlements ? '▲' : '▼'}</span>
                                </button>
                                {showBankerSettlements && tSettlements.map((s, i) => (
                                  <div key={i} className="flex items-center py-1 gap-2 text-sm">
                                    <span className="flex-1 min-w-0 truncate"><span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span></span>
                                    <span className="font-bold text-gray-900">{fmtSettle(s.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {tSettlements.length === 0 && groupPlayers.length > 0 && (<p className="text-xs text-gray-400 text-center py-3">All even — no payments needed.</p>)}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Hammer Results (collapsible) ── */}
              {isHammer && hammerMatchups.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                  <button onClick={() => setShowHammerResults((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <span className="text-sm font-semibold text-gray-800">Hammer Results</span>
                    <span className="text-gray-400 text-xs">{showHammerResults ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showHammerResults && (
                    <div className="border-t border-gray-100">
                      {hammerMatchups.map((matchup, mi) => {
                        const t1Players = players.filter((p) => p.team_id === matchup.team1_id)
                        const t2Players = players.filter((p) => p.team_id === matchup.team2_id)
                        const t1Team = initialTeams.find((t) => t.id === matchup.team1_id)
                        const t2Team = initialTeams.find((t) => t.id === matchup.team2_id)
                        const matchupHoles = hammerHolesMap[matchup.id] ?? {}
                        const hammerNet: Record<string, number> = {}
                        for (const p of [...t1Players, ...t2Players]) hammerNet[p.id] = 0
                        let t1Total = 0, t2Total = 0
                        const holeResults: { hNum: number; winner: 1 | 2 | null; folded: 1 | 2 | null; stake: number; mult: number }[] = []
                        for (const hole of holes) {
                          const allP = [...t1Players, ...t2Players]
                          if (!allP.every((p) => scores.some((s) => s.player_id === p.id && s.hole_number === hole.hole_number))) continue
                          const hs = matchupHoles[hole.hole_number] ?? { stake: matchup.base_bet, lastHammerTeam: null, foldedTeam: null, preTeeUsed: false }
                          if (hs.foldedTeam !== null) {
                            const loser = hs.foldedTeam; const gainer = loser === 1 ? 2 : 1
                            if (gainer === 1) { t1Total += hs.stake; t2Total -= hs.stake } else { t2Total += hs.stake; t1Total -= hs.stake }
                            holeResults.push({ hNum: hole.hole_number, winner: gainer, folded: hs.foldedTeam, stake: hs.stake, mult: 1 })
                          } else {
                            const getNet = (pId: string) => { const g = scores.find((s) => s.player_id === pId && s.hole_number === hole.hole_number)?.strokes; if (g === undefined) return undefined; return g - ((liveHoleStrokes[hole.hole_number] ?? []).includes(pId) ? 1 : 0) }
                            const t1Nets = t1Players.map((p) => getNet(p.id)).filter((s): s is number => s !== undefined)
                            const t2Nets = t2Players.map((p) => getNet(p.id)).filter((s): s is number => s !== undefined)
                            if (t1Nets.length === 0 || t2Nets.length === 0) continue
                            const t1Best = Math.min(...t1Nets); const t2Best = Math.min(...t2Nets)
                            if (t1Best === t2Best) { holeResults.push({ hNum: hole.hole_number, winner: null, folded: null, stake: hs.stake, mult: 1 }); continue }
                            const winner = t1Best < t2Best ? 1 : 2
                            const winnerBest = winner === 1 ? t1Best : t2Best
                            const mult = winnerBest <= hole.par - 2 ? 3 : winnerBest === hole.par - 1 ? 2 : 1
                            const amount = hs.stake * mult
                            if (winner === 1) { t1Total += amount; t2Total -= amount } else { t2Total += amount; t1Total -= amount }
                            holeResults.push({ hNum: hole.hole_number, winner, folded: null, stake: hs.stake, mult })
                          }
                        }
                        if (t1Players.length > 0) { const share = t1Total / t1Players.length; for (const p of t1Players) hammerNet[p.id] = share }
                        if (t2Players.length > 0) { const share = t2Total / t2Players.length; for (const p of t2Players) hammerNet[p.id] = share }
                        const allMatchupPlayers = [...t1Players, ...t2Players]
                        const tSettlements = minimizeSettlements(allMatchupPlayers, hammerNet)
                        const t1Name = t1Team?.name ?? 'Team 1'
                        const t2Name = t2Team?.name ?? 'Team 2'
                        return (
                          <div key={matchup.id} className={mi > 0 ? 'border-t-2 border-gray-200' : ''}>
                            <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{t1Name} vs {t2Name}</span>
                              <span className="text-xs text-gray-400">Base ${matchup.base_bet}/hole</span>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {allMatchupPlayers.map((p) => {
                                const v = hammerNet[p.id] ?? 0
                                return (
                                  <div key={p.id} className="flex items-center px-4 py-2.5 gap-2">
                                    <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{p.name}</span>
                                    <span className="text-sm font-bold tabular-nums w-20 text-right" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>{fmtDollars(v)}</span>
                                  </div>
                                )
                              })}
                            </div>
                            {holeResults.length > 0 && (
                              <div className="border-t border-gray-100 px-4 py-3">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Hole-by-Hole</p>
                                <div className="space-y-1">
                                  {holeResults.map(({ hNum, winner, folded, stake, mult }) => (
                                    <div key={hNum} className="flex items-center justify-between text-xs">
                                      <span className="text-gray-500 w-10">H{hNum}</span>
                                      <span className="flex-1 text-gray-700">
                                        {folded !== null
                                          ? <><span className="font-semibold" style={{ color: folded === 1 ? '#dc2626' : '#16a34a' }}>{folded === 1 ? t1Name : t2Name}</span> folded</>
                                          : winner === null
                                          ? <span className="text-gray-400 italic">Tied</span>
                                          : <><span className="font-semibold" style={{ color: '#16a34a' }}>{winner === 1 ? t1Name : t2Name}</span> wins{mult > 1 && <span className="ml-1 text-amber-600 font-bold">×{mult}</span>}</>
                                        }
                                      </span>
                                      <span className="font-bold text-gray-900">${stake * (mult)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {tSettlements.length > 0 && (<div className="border-t border-gray-100 px-4 py-3"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Settlement</p>{tSettlements.map((s, i) => (<div key={i} className="flex items-center py-1 gap-2 text-sm"><span className="flex-1 min-w-0 truncate"><span className="font-semibold text-red-600">{s.fromName}</span>{' pays '}<span className="font-semibold text-green-700">{s.toName}</span></span><span className="font-bold text-gray-900">{fmtSettle(s.amount)}</span></div>))}</div>)}
                            {tSettlements.length === 0 && allMatchupPlayers.length > 0 && holeResults.length > 0 && (<p className="text-xs text-gray-400 text-center py-3">All even — no payments needed.</p>)}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Matchup Results (collapsible) — hidden when all matchups excluded ── */}
              {!excludeMatchups ? (
              <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                <button onClick={() => setShowMatchupResults((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                  <span className="text-sm font-semibold text-gray-800">Matchup Results</span>
                  <span className="text-gray-400 text-xs">{showMatchupResults ? '▲ Hide' : '▼ Show'}</span>
                </button>
                {showMatchupResults && (
                  <div className="border-t border-gray-100">
                    {visibleMatchupPayouts.rows.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No matchups added yet.</p>
                    ) : (<>
                      {visibleMatchupPayouts.rows.map((row, rowIdx) => {
                        const nr = row.nassauResult
                        const fmtAmt = nr ? (nr.amount % 1 === 0 ? String(nr.amount) : nr.amount.toFixed(2)) : ''
                        const overallSeg = !nr && row.segments.length === 1 ? row.segments[0] : null
                        const prevRow = rowIdx > 0 ? matchupPayouts.rows[rowIdx - 1] : null
                        const showH2HHeader = row.type === 'h2h' && (rowIdx === 0 || prevRow?.type !== 'h2h')
                        const showBBHeader = row.type === 'bb' && (rowIdx === 0 || prevRow?.type !== 'bb')
                        return (
                          <div key={row.id}>
                          {showH2HHeader && (
                            <div className={`px-4 py-2 bg-gray-50 ${rowIdx > 0 ? 'border-t border-gray-200' : ''}`}>
                              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Head to Head</p>
                            </div>
                          )}
                          {showBBHeader && (
                            <div className={`px-4 py-2 bg-gray-50 ${rowIdx > 0 ? 'border-t border-gray-200' : ''}`}>
                              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">2v2 Best Ball</p>
                            </div>
                          )}
                          <div className={rowIdx > 0 && !showH2HHeader && !showBBHeader ? 'border-t border-gray-100' : ''}>
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
                                  {nr && nr.anySettled && nr.winnerLabel !== null ? <span className="text-green-600">${fmtAmt}{nr.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span> : overallSeg && overallSeg.settled && !overallSeg.tied ? <span className="text-green-600">${overallSeg.amount % 1 === 0 ? overallSeg.amount : overallSeg.amount.toFixed(2)}{overallSeg.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span> : null}
                                </span>
                              </div>
                            )}
                          </div>
                          </div>
                        )
                      })}
                      {visibleMatchupPayouts.rows.some((r) => r.segments.some((s) => s.settled)) && (
                        <>
                          <div className="border-t-2 border-gray-200 px-4 pt-3 pb-2">
                            <button
                              onClick={() => setShowMatchupNetPositions((v) => !v)}
                              className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2"
                            >
                              <span>Net Positions</span>
                              <span className="text-gray-400 text-[10px]">{showMatchupNetPositions ? '▲' : '▼'}</span>
                            </button>
                            {showMatchupNetPositions && (
                              <div className="space-y-1">
                                {[...players].filter((p) => visibleMatchupPayouts.involvedIds.has(p.id)).sort((a, b) => (visibleMatchupPayouts.net[b.id] ?? 0) - (visibleMatchupPayouts.net[a.id] ?? 0)).map((p) => {
                                  const v = visibleMatchupPayouts.net[p.id] ?? 0
                                  return (<div key={p.id} className="flex items-center justify-between"><span className="text-xs text-gray-700 min-w-0 truncate">{p.name}</span><span className="text-xs font-bold tabular-nums flex-shrink-0" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>{fmtDollars(v)}</span></div>)
                                })}
                              </div>
                            )}
                          </div>
                          <div className="border-t border-gray-100 px-4 py-3">
                            <button
                              onClick={() => setShowMatchupSettlements((v) => !v)}
                              className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2"
                            >
                              <span>Settlements</span>
                              <span className="text-gray-400 text-[10px]">{showMatchupSettlements ? '▲' : '▼'}</span>
                            </button>
                            {showMatchupSettlements && (matchupOnlySettlements.length === 0 ? <p className="text-xs text-gray-400 text-center">All even — no payments needed</p> : matchupOnlySettlements.map((s, i) => (<div key={i} className="flex items-center justify-between py-1"><span className="text-xs text-gray-800 min-w-0 truncate"><span className="font-semibold text-red-500">{s.fromName}</span><span className="text-gray-400"> pays </span><span className="font-semibold text-green-600">{s.toName}</span></span><span className="text-xs font-bold text-gray-900 flex-shrink-0">{fmtSettle(s.amount)}</span></div>)))}
                          </div>
                        </>
                      )}
                    </>)}
                    </div>
                  )}
                </div>
              ) : null}

              {/* ── Skins Game Results ── */}
              {skinsEnabled && skinsParticipants.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                  <button onClick={() => setShowSkinsResults((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <span className="text-sm font-semibold text-gray-800">Skins Game</span>
                    <span className="text-gray-400 text-xs flex-shrink-0 ml-2">{showSkinsResults ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showSkinsResults && (
                    <div className="border-t border-gray-100">
                      {/* Amount header */}
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm text-gray-900">Amount</p>
                        <p className="text-xs text-gray-400 mt-0.5">${skinsAmount % 1 === 0 ? skinsAmount : skinsAmount.toFixed(2)}/skin</p>
                      </div>
                      {/* Current Skins — players with ≥1 skin */}
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Current Skins</p>
                        {(() => {
                          const winnerMap: Record<string, { name: string; holes: number[] }> = {}
                          for (const s of skinsResults.skins) {
                            if (s.status === 'won' && s.winnerId && s.winnerName) {
                              if (!winnerMap[s.winnerId]) winnerMap[s.winnerId] = { name: s.winnerName, holes: [] }
                              winnerMap[s.winnerId].holes.push(s.holeNumber)
                            }
                          }
                          const winners = Object.entries(winnerMap).sort((a, b) => b[1].holes.length - a[1].holes.length || a[1].name.localeCompare(b[1].name))
                          if (winners.length === 0) return <p className="text-xs text-gray-400">No skins won yet</p>
                          return (
                            <div className="space-y-0">
                              {winners.map(([id, { name, holes }]) => (
                                <div key={id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                                  <span className="text-xs font-semibold text-green-700">
                                    {name}{' '}
                                    <span className="font-normal text-gray-500">
                                      (Hole{holes.length !== 1 ? 's' : ''} {holes.join(', ')})
                                    </span>
                                  </span>
                                  <span className="text-xs font-semibold text-green-600 shrink-0">
                                    +${(skinsAmount * (skinsParticipants.length - 1) * holes.length).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                      {/* Participants dropdown */}
                      <div className="px-4 py-3 border-b border-gray-100">
                        <button
                          onClick={() => setShowSkinsParticipants((v) => !v)}
                          className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide"
                        >
                          <span>Participants ({skinsParticipants.length})</span>
                          <span className="text-gray-400 text-[10px]">{showSkinsParticipants ? '▲' : '▼'}</span>
                        </button>
                        {showSkinsParticipants && (
                          <div className="mt-2 space-y-1 pl-1">
                            {skinsParticipants.map((p) => (
                              <div key={p.id} className="text-xs text-gray-700">{p.name}</div>
                            ))}
                          </div>
                        )}
                      </div>
                      {skinsResults.skinsWon > 0 && (
                        <>
                          <div className="border-t border-gray-100 px-4 pt-3 pb-2">
                            <button
                              onClick={() => setShowSkinsNetPositions((v) => !v)}
                              className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2"
                            >
                              <span>Net Positions</span>
                              <span className="text-gray-400 text-[10px]">{showSkinsNetPositions ? '▲' : '▼'}</span>
                            </button>
                            {showSkinsNetPositions && (
                              <div className="space-y-1">
                                {[...skinsParticipants]
                                  .sort((a, b) => (skinsResults.playerNet[b.id] ?? 0) - (skinsResults.playerNet[a.id] ?? 0))
                                  .map((p) => {
                                    const amt = skinsResults.playerNet[p.id] ?? 0
                                    return (
                                      <div key={p.id} className="flex items-center justify-between">
                                        <span className="text-xs text-gray-700 min-w-0 truncate">{p.name}</span>
                                        <span className="text-xs font-bold tabular-nums flex-shrink-0"
                                          style={{ color: amt > 0 ? '#16a34a' : amt < 0 ? '#dc2626' : '#6b7280' }}>
                                          {fmtDollars(amt)}
                                        </span>
                                      </div>
                                    )
                                  })}
                              </div>
                            )}
                          </div>
                          <div className="border-t border-gray-100 px-4 py-3">
                            <button
                              onClick={() => setShowSkinsSettlements((v) => !v)}
                              className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2"
                            >
                              <span>Settlements</span>
                              <span className="text-gray-400 text-[10px]">{showSkinsSettlements ? '▲' : '▼'}</span>
                            </button>
                            {showSkinsSettlements && (skinsResults.settlements.length === 0 ? (
                              <p className="text-xs text-gray-400 text-center">All even — no payments needed</p>
                            ) : skinsResults.settlements.map((s, i) => (
                              <div key={i} className="flex items-center justify-between py-1">
                                <span className="text-xs text-gray-800">
                                  <span className="font-semibold text-red-500">{s.fromName}</span>
                                  <span className="text-gray-400"> pays </span>
                                  <span className="font-semibold text-green-600">{s.toName}</span>
                                </span>
                                <span className="text-xs font-bold text-gray-900">{fmtSettle(s.amount)}</span>
                              </div>
                            )))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Combined Settlements ── */}
              <div className="bg-white rounded-2xl border border-gray-400 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h4 className="font-semibold text-gray-900 text-sm mb-1.5">Combined Settlements</h4>
                  <div className="flex flex-nowrap gap-1 overflow-x-auto">
                    {!isDaytona && !isTraditional && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] whitespace-nowrap flex-shrink-0">Balls</span>
                    )}
                    {isDaytona && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] whitespace-nowrap flex-shrink-0">Daytona</span>
                    )}
                    {!isDaytona && (standardGroupRows.some((g) => g.hasDaytona) || traditionalGroupRows.some((g) => g.hasDaytona)) && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] whitespace-nowrap flex-shrink-0">Daytona</span>
                    )}
                    {standardGroupRows.some((g) => g.hasBanker) && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] whitespace-nowrap flex-shrink-0">Banker</span>
                    )}
                    {isHammer && hammerMatchups.length > 0 && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] whitespace-nowrap flex-shrink-0">Hammer</span>
                    )}
                    {!excludeMatchups && <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] whitespace-nowrap flex-shrink-0">Matchups</span>}
                    {skinsEnabled && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] whitespace-nowrap flex-shrink-0">Skins</span>
                    )}
                  </div>
                </div>
                {/* Net positions */}
                <div className="px-4 pt-3 pb-2">
                  <div className="space-y-1">
                    {[...players].sort((a, b) => (combinedNet[b.id] ?? 0) - (combinedNet[a.id] ?? 0)).map((p) => {
                      const v = combinedNet[p.id] ?? 0
                      return (
                        <div key={p.id} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
                          <span className="text-sm text-gray-900 min-w-0 truncate">{p.name}</span>
                          <button onClick={() => setBreakdownPlayerId(breakdownPlayerId === p.id ? null : p.id)} className="text-sm font-bold tabular-nums flex-shrink-0 underline decoration-dotted underline-offset-2 cursor-pointer" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280', background: 'none', border: 'none', padding: 0 }}>
                            {fmtDollars(v)}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {/* Who pays who */}
                <div className="border-t border-gray-200 px-4 py-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Who Pays Who</p>
                  {combinedSettlements.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">No payouts yet</p> : combinedSettlements.map((s, i) => (<div key={i} className="flex items-center justify-between py-1"><span className="text-sm text-gray-800 min-w-0 truncate"><span className="font-semibold text-red-500">{s.fromName}</span><span className="text-gray-500"> pays </span><span className="font-semibold text-green-600">{s.toName}</span></span><span className="text-sm font-bold text-gray-900 flex-shrink-0">{fmtSettle(s.amount)}</span></div>))}
                </div>
              </div>
              {/* Breakdown popup */}
              {breakdownPlayerId && (() => {
                const bp = players.find((p) => p.id === breakdownPlayerId)
                if (!bp) return null
                const bd = playerBreakdown[bp.id] ?? { ball: 0, daytona: 0, banker: 0, matchups: 0, skins: 0, hammer: 0 }
                const total = combinedNet[bp.id] ?? 0
                const bdRows: { label: string; val: number }[] = [
                  { label: 'Ball Results', val: bd.ball },
                  { label: 'Daytona Results', val: bd.daytona },
                  { label: 'Banker Results', val: bd.banker },
                  { label: 'Hammer Results', val: bd.hammer },
                  { label: 'Matchup Results', val: bd.matchups },
                  { label: 'Skins Game', val: bd.skins },
                ].filter((r) => r.val !== 0)
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setBreakdownPlayerId(null)}>
                    <div className="absolute inset-0 bg-black/30" />
                    <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                      <div className="px-4 py-3 flex items-center justify-between" style={{ background: navy, borderBottom: '1px solid rgba(255,255,255,0.35)' }}>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#f59e0b' }}>Combined Breakdown</p>
                          <p className="text-white font-bold text-base">{bp.name}</p>
                        </div>
                        <button onClick={() => setBreakdownPlayerId(null)} className="text-xl leading-none ml-4" style={{ color: 'rgba(255,255,255,0.7)' }}>✕</button>
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        {bdRows.length === 0 && <p className="text-sm text-gray-400 text-center py-2">No results yet</p>}
                        {bdRows.map(({ label, val }) => {
                          return (
                            <div key={label} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                              <span className="text-gray-600">{label}</span>
                              <span className="font-semibold tabular-nums" style={{ color: val > 0 ? '#16a34a' : '#dc2626' }}>
                                {val === 0 ? 'Even' : `$${Math.round(Math.abs(val))}`}
                              </span>
                            </div>
                          )
                        })}
                        <div className="flex items-center justify-between text-sm font-bold pt-2 border-t border-gray-200">
                          <span className="text-gray-900">Total</span>
                          <span style={{ color: total > 0 ? '#16a34a' : total < 0 ? '#dc2626' : '#6b7280' }}>
                            {total === 0 ? 'Even' : `$${Math.round(Math.abs(total))}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      {showAllScorecards && (() => {
        const baseRows = isDaytona ? dtIndividualRows : isTraditional ? traditionalPlayerRows : ballIndividualRows
        const groupRows = allScorecardsGroupId
          ? groupPlayerMap[allScorecardsGroupId]
            ? baseRows.filter((r) => (groupPlayerMap[allScorecardsGroupId] ?? []).includes(r.player.id))
            : baseRows.filter((r) => r.player.team_id === allScorecardsGroupId)
          : baseRows
        const isGroupView = !!allScorecardsGroupId
        const filteredRows = (!isGroupView && skinsEnabled && allScorecardsFilter === 'skins')
          ? groupRows.filter((r) => r.player.skins_participant)
          : groupRows

        // Daytona side game for this group (check both teams and playing groups)
        const activeTeam = allScorecardsGroupId ? initialTeams.find((t) => t.id === allScorecardsGroupId) : null
        const activePlayingGroup = allScorecardsGroupId && groupPlayerMap[allScorecardsGroupId] ? playingGroups.find((pg) => pg.id === allScorecardsGroupId) : null
        const groupVariant = activeTeam?.daytona_variant ?? activePlayingGroup?.daytona_variant ?? null
        const groupHasDaytona = !!groupVariant
        const gIs5Man = groupVariant?.startsWith('5man') ?? false
        const gIsFlares = groupVariant?.startsWith('5man-flares') ?? false
        const groupPlayerIds = new Set(groupRows.map((r) => r.player.id))
        const holePtsMaps = new Map<number, Map<string, number>>()
        if (groupHasDaytona) {
          for (const hole of holes) {
            const ha = assignments.filter((a) => a.hole_number === hole.hole_number && groupPlayerIds.has(a.player_id))
            const leftIds = ha.filter((a) => a.side === 'left').map((a) => a.player_id)
            const rightIds = ha.filter((a) => a.side === 'right').map((a) => a.player_id)
            const strokeIds = liveHoleStrokes[hole.hole_number] ?? []
            const netScoresForHole = scores.map((s) => ({
              ...s, strokes: s.strokes - (strokeIds.includes(s.player_id) ? 1 : 0),
            }))
            if (gIs5Man) {
              if (leftIds.length >= 2 && rightIds.length >= 3)
                holePtsMaps.set(hole.hole_number, computeHoleDaytonaPointsFiveMan(leftIds, rightIds, netScoresForHole, hole.hole_number, hole.par))
            } else if (leftIds.length >= 2 && rightIds.length >= 2) {
              const leftSc = leftIds.map((id) => netScoresForHole.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
              const rightSc = rightIds.map((id) => netScoresForHole.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
              if (leftSc.length >= 2 && rightSc.length >= 2) {
                const { leftDt, rightDt } = computeHoleDaytonaWithSides(leftSc, rightSc, hole.par)
                if (leftDt !== null && rightDt !== null) {
                  const diff = Math.abs(leftDt - rightDt)
                  const lWins = leftDt < rightDt, rWins = rightDt < leftDt
                  const m = new Map<string, number>()
                  for (const id of leftIds) m.set(id, lWins ? diff : rWins ? -diff : 0)
                  for (const id of rightIds) m.set(id, rWins ? diff : lWins ? -diff : 0)
                  holePtsMaps.set(hole.hole_number, m)
                }
              }
            }
          }
        }
        const teamHoleVals = allScorecardsGroupId ? (liveHoleValues[allScorecardsGroupId] ?? {}) : {}
        const groupHasBanker = !!(activePlayingGroup as { banker_side_game?: boolean | null } | null)?.banker_side_game
        const groupBankerMinBet = (activePlayingGroup as { banker_side_game_min_bet?: number | null } | null)?.banker_side_game_min_bet ?? 2
        const groupBankerHoles = allScorecardsGroupId ? (liveBankerHoles[allScorecardsGroupId] ?? {}) : {}
        const groupBankerBets = allScorecardsGroupId ? (liveBankerBets[allScorecardsGroupId] ?? {}) : {}
        const allGroupPids = groupRows.map((r) => r.player.id)
        const holeBankerAmtMap = new Map<number, Map<string, number>>()
        const totalBankerAmtMap = new Map<string, number>()
        if (groupHasBanker) {
          const scPgAutoStrokes = !!(activePlayingGroup as { auto_strokes?: boolean | null } | null)?.auto_strokes
          const scEffHcp = (h: number) => Math.max(0, Math.trunc(h))
          for (const hole of [...scFrontNine, ...scBackNine]) {
            const hd = groupBankerHoles[hole.hole_number]
            if (!hd?.bankerPlayerId) continue
            const bankerId = hd.bankerPlayerId
            const bankerPlayer = groupRows.find((r) => r.player.id === bankerId)?.player
            if (!bankerPlayer) continue
            const bankerGross = scores.find((s) => s.player_id === bankerId && s.hole_number === hole.hole_number)?.strokes
            if (bankerGross === undefined) continue
            // Mirror leaderboard exactly: manual strokes override, then auto-compute, then none
            const manualStrokes = liveHoleStrokes[hole.hole_number]
            const si = hole.stroke_index ?? 999
            let effIds: string[]
            if (manualStrokes !== undefined) {
              effIds = manualStrokes
            } else if (scPgAutoStrokes) {
              const bHcpVal = bankerPlayer.handicap != null ? scEffHcp(bankerPlayer.handicap) : null
              const playerAutoIds: string[] = bHcpVal != null
                ? groupRows.filter((r) => {
                    if (r.player.id === bankerId) return false
                    const ph = r.player.handicap != null ? scEffHcp(r.player.handicap) : null
                    if (ph == null) return false
                    return ph - bHcpVal > 0 && si <= ph - bHcpVal
                  }).map((r) => r.player.id)
                : []
              const bankerReceives = bHcpVal != null && groupRows.some((r) => {
                if (r.player.id === bankerId) return false
                const ph = r.player.handicap != null ? scEffHcp(r.player.handicap) : null
                if (ph == null) return false
                return bHcpVal - ph > 0 && si <= bHcpVal - ph
              })
              effIds = [...playerAutoIds, ...(bankerReceives ? [bankerId] : [])]
            } else {
              effIds = []
            }
            const holeAmts = new Map<string, number>()
            let bankerTotal = 0
            for (const pid of allGroupPids) {
              if (pid === bankerId) continue
              const player = groupRows.find((r) => r.player.id === pid)?.player
              if (!player) continue
              const playerGross = scores.find((s) => s.player_id === pid && s.hole_number === hole.hole_number)?.strokes
              if (playerGross === undefined) continue
              const playerNet = playerGross - (effIds.includes(pid) ? 1 : 0)
              // Per-matchup banker stroke: banker only gets stroke against players where bHcp > pHcp
              const bHcp = bankerPlayer.handicap != null ? scEffHcp(bankerPlayer.handicap) : null
              const pHcp = player.handicap != null ? scEffHcp(player.handicap) : null
              const bankerInStrokes = effIds.includes(bankerId)
              const bankerStroke = bankerInStrokes && bHcp != null && pHcp != null && bHcp > pHcp && si <= bHcp - pHcp ? 1 : 0
              const bankerNet = bankerGross - bankerStroke
              const bet = groupBankerBets[hole.hole_number]?.[pid] ?? { baseBet: groupBankerMinBet, playerDoubled: false, bankerDoubled: false }
              const eff = bet.baseBet * (bet.playerDoubled ? 2 : 1) * (bet.bankerDoubled ? 2 : 1)
              let result = 0
              if (playerNet < bankerNet) result = eff * lbBankerMultiplier(playerNet, hole.par)
              else if (playerNet > bankerNet) result = -eff * lbBankerMultiplier(bankerNet, hole.par)
              holeAmts.set(pid, result)
              bankerTotal -= result
            }
            holeAmts.set(bankerId, bankerTotal)
            holeBankerAmtMap.set(hole.hole_number, holeAmts)
            for (const [pid, amt] of holeAmts) totalBankerAmtMap.set(pid, (totalBankerAmtMap.get(pid) ?? 0) + amt)
          }
        }
        const fmtBkrAmt = (amt: number | null): React.ReactNode => {
          if (amt === null) return <span style={{ color: '#d1d5db' }}>–</span>
          if (amt === 0) return <span style={{ color: '#6b7280', fontSize: '0.65rem' }}>$0</span>
          return <span style={{ fontWeight: 600, fontSize: '0.65rem', color: amt > 0 ? '#16a34a' : '#dc2626', whiteSpace: 'nowrap' }}>${Math.round(Math.abs(amt))}</span>
        }
        const groupPayoutStr = groupVariant?.includes('|') ? groupVariant.split('|')[1] : null
        const groupBaseRate = groupPayoutStr ? (parseFloat(groupPayoutStr) || 0) : dtPayoutValue
        const PRESS_COLORS = [gold, '#3b82f6', '#8b5cf6', '#ef4444', '#10b981']
        const sortedPressRates = [...new Set(Object.values(teamHoleVals))].sort((a, b) => a - b)
        const pressColor = (val: number) => PRESS_COLORS[sortedPressRates.indexOf(val) % PRESS_COLORS.length]
        const pStr = (pts: number | null) => pts === null ? '–' : pts === 0 ? '0' : pts > 0 ? `+${pts}` : String(pts)
        const pColor = (pts: number | null) => pts === null ? '#d1d5db' : pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#374151'

        const thSt = (highlight?: boolean, isHoleNum?: boolean): React.CSSProperties => ({
          background: highlight ? '#4a7fa5' : isHoleNum ? '#dde4ee' : navy,
          color: highlight ? 'white' : isHoleNum ? navy : 'white',
          fontWeight: 700, fontSize: '0.65rem', textAlign: 'center', padding: '0.5rem 0.45rem', whiteSpace: 'nowrap',
        })
        const tdPar = (highlight?: boolean): React.CSSProperties => ({
          background: highlight ? '#dbeafe' : 'white',
          color: highlight ? '#1e40af' : '#6b7280',
          fontWeight: highlight ? 700 : 400, fontSize: '0.7rem', textAlign: 'center', padding: '0.45rem 0.45rem',
        })
        const tdSc = (highlight?: boolean): React.CSSProperties => ({
          background: highlight ? '#dbeafe' : 'white',
          fontWeight: highlight ? 700 : 400,
          color: highlight ? '#1e40af' : undefined,
          fontSize: '0.7rem', textAlign: 'center', padding: '0.42rem 0.42rem',
        })
        const stickyFirst: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1 }
        const stickyFirstTh: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 2 }
        return (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowAllScorecards(false)}>
            <div className="bg-white rounded-t-2xl max-h-[90vh] flex flex-col" style={{ animation: 'slideUp 0.28s ease-out', boxShadow: '0 0 0 2px rgba(255,255,255,0.3)' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-4 flex-shrink-0" style={{ background: navy, borderBottom: '1px solid rgba(255,255,255,0.35)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="font-bold text-white text-base flex-shrink-0">{activeTeam?.name ?? activePlayingGroup?.name ?? 'All Scorecards'}</h3>
                  {groupHasDaytona && groupBaseRate > 0 && (
                    <span className="text-xs flex-shrink-0" style={{ color: 'rgba(255,255,255,0.6)' }}>{gIsFlares ? '5-Man Flares' : gIs5Man ? '5-Man Daytona' : 'Daytona'} – {groupBaseRate % 1 === 0 ? `$${groupBaseRate}` : `$${groupBaseRate.toFixed(2).replace(/^0/, '')}`}/point</span>
                  )}
                  {groupHasBanker && (
                    <span className="text-xs flex-shrink-0" style={{ color: 'rgba(255,255,255,0.6)' }}>Banker – ${groupBankerMinBet} min. bet</span>
                  )}
                </div>
                <button onClick={() => setShowAllScorecards(false)} className="text-xl font-bold leading-none ml-2" style={{ color: 'rgba(255,255,255,0.7)' }}>×</button>
              </div>
              {!isGroupView && skinsEnabled && (
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden w-fit mx-4 mt-3">
                  <button onClick={() => setAllScorecardsFilter('all')}
                    className="text-xs font-semibold px-3 py-1.5 transition"
                    style={{ background: allScorecardsFilter === 'all' ? navy : 'white', color: allScorecardsFilter === 'all' ? 'white' : '#6b7280' }}>
                    All Players
                  </button>
                  <button onClick={() => setAllScorecardsFilter('skins')}
                    className="text-xs font-semibold px-3 py-1.5 transition border-l border-gray-200"
                    style={{ background: allScorecardsFilter === 'skins' ? navy : 'white', color: allScorecardsFilter === 'skins' ? 'white' : '#6b7280' }}>
                    Skins Only
                  </button>
                </div>
              )}
              <div className="px-4 py-4 space-y-3 overflow-y-auto flex-1">
                {filteredRows.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No players.</p>}
                {(groupHasDaytona && holePtsMaps.size > 0
                  ? [...filteredRows].sort((a, b) => {
                      const aTot = [...holePtsMaps.values()].reduce((s, m) => s + (m.get(a.player.id) ?? 0), 0)
                      const bTot = [...holePtsMaps.values()].reduce((s, m) => s + (m.get(b.player.id) ?? 0), 0)
                      if (aTot !== bTot) return bTot - aTot
                      return a.player.name.localeCompare(b.player.name)
                    })
                  : groupHasBanker && totalBankerAmtMap.size > 0
                    ? [...filteredRows].sort((a, b) => (totalBankerAmtMap.get(b.player.id) ?? 0) - (totalBankerAmtMap.get(a.player.id) ?? 0))
                  : filteredRows
                ).map((row, i) => {
                  const scoreMap = Object.fromEntries(scores.filter((s) => s.player_id === row.player.id).map((s) => [s.hole_number, s.strokes]))
                  const frontScored = scFrontNine.filter((h) => scoreMap[h.hole_number] != null)
                  const frontStrokes = frontScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)
                  const backScored = scBackNine.filter((h) => scoreMap[h.hole_number] != null)
                  const backStrokes = backScored.reduce((s, h) => s + scoreMap[h.hole_number]!, 0)
                  const totalStrokes = frontStrokes + backStrokes
                  const thru = row.holesPlayed
                  const vpStr = row.vspar === null ? '–' : row.vspar === 0 ? 'E' : row.vspar > 0 ? `+${row.vspar}` : `${row.vspar}`
                  const frontVspar = frontScored.length > 0 ? frontStrokes - frontScored.reduce((s, h) => s + h.par, 0) : null
                  const backVspar = backScored.length > 0 ? backStrokes - backScored.reduce((s, h) => s + h.par, 0) : null
                  const totalVspar = frontVspar !== null || backVspar !== null ? (frontVspar ?? 0) + (backVspar ?? 0) : null
                  const fmtV = (n: number | null) => n === null ? '–' : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`
                  const vpC = (n: number | null) => n === null ? 'rgba(255,255,255,0.55)' : n < 0 ? '#f87171' : n > 0 ? '#fbbf24' : 'rgba(255,255,255,0.8)'
                  const frontPts = scFrontNine.some((h) => holePtsMaps.get(h.hole_number)?.has(row.player.id))
                    ? scFrontNine.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(row.player.id) ?? 0), 0) : null
                  const backPts = scBackNine.some((h) => holePtsMaps.get(h.hole_number)?.has(row.player.id))
                    ? scBackNine.reduce((s, h) => s + (holePtsMaps.get(h.hole_number)?.get(row.player.id) ?? 0), 0) : null
                  const totalPts = holePtsMaps.size > 0 && [...holePtsMaps.values()].some((m) => m.has(row.player.id))
                    ? [...holePtsMaps.values()].reduce((s, m) => s + (m.get(row.player.id) ?? 0), 0) : null
                  return (
                    <div key={row.player.id} className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-2" style={{ background: navy }}>
                        <span className="text-base font-bold w-8 flex-shrink-0" style={{ color: thru > 0 ? gold : 'rgba(255,255,255,0.25)' }}>
                          {thru > 0 ? `#${i + 1}` : '–'}
                        </span>
                        <span className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="font-bold text-white text-sm truncate">{row.player.name}</span>
                          <span className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); toggleHcp(row.player.id) }} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: hcpVisible.has(row.player.id) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)', color: hcpVisible.has(row.player.id) ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.15)' }}>HCP</button>
                            {row.player.handicap != null && <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>{row.player.handicap < 0 ? `+${Math.abs(row.player.handicap)}` : row.player.handicap}</span>}
                          </span>
                        </span>
                        <div className="flex items-center gap-3 text-[10px] font-semibold flex-shrink-0" style={{ color: 'rgba(255,255,255,0.55)' }}>
                          <span>Front: <span style={{ color: vpC(frontVspar) }}>{fmtV(frontVspar)}</span></span>
                          <span>Back: <span style={{ color: vpC(backVspar) }}>{fmtV(backVspar)}</span></span>
                          <span>Total: <span style={{ color: vpC(totalVspar) }}>{fmtV(totalVspar)}</span></span>
                        </div>
                      </div>
                      <div className="overflow-x-auto bg-white">
                        <table className="border-collapse" style={{ minWidth: '700px', width: '100%', tableLayout: 'fixed' }}>
                          <thead style={{ borderTop: '1px solid #e5e7eb' }}>
                            <tr>
                              <th style={{ ...thSt(false, true), textAlign: 'left', paddingLeft: '0.6rem', width: '3.5rem', ...stickyFirstTh }}>HOLE</th>
                              {scFrontNine.map((h) => {
                                const hasStroke = (groupHasDaytona || groupHasBanker) && (liveHoleStrokes[h.hole_number] ?? []).includes(row.player.id)
                                const wonSkin = allScorecardsFilter === 'skins' && skinsResults.skins.some((s) => s.status === 'won' && s.winnerId === row.player.id && s.holeNumber === h.hole_number)
                                return (
                                  <th key={h.hole_number} style={{ ...thSt(false, true), width: '2rem' }}>
                                    <span style={{ position: 'relative', display: 'inline-block' }}>
                                      {h.hole_number}
                                      {hasStroke && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.7rem', fontWeight: 700, lineHeight: 1, marginLeft: '1px' }}>*</span>}
                                      {wonSkin && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.72rem', fontWeight: 700, lineHeight: 1, marginLeft: '2px' }}>✓</span>}
                                    </span>
                                  </th>
                                )
                              })}
                              {scFrontNine.length > 0 && <th style={{ ...thSt(true), width: '2.8rem' }}>Out</th>}
                              {scBackNine.map((h) => {
                                const hasStroke = (groupHasDaytona || groupHasBanker) && (liveHoleStrokes[h.hole_number] ?? []).includes(row.player.id)
                                const wonSkin = allScorecardsFilter === 'skins' && skinsResults.skins.some((s) => s.status === 'won' && s.winnerId === row.player.id && s.holeNumber === h.hole_number)
                                return (
                                  <th key={h.hole_number} style={{ ...thSt(false, true), width: '2rem' }}>
                                    <span style={{ position: 'relative', display: 'inline-block' }}>
                                      {h.hole_number}
                                      {hasStroke && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.7rem', fontWeight: 700, lineHeight: 1, marginLeft: '1px' }}>*</span>}
                                      {wonSkin && <span style={{ position: 'absolute', top: '50%', left: '100%', transform: 'translateY(-50%)', color: '#16a34a', fontSize: '0.72rem', fontWeight: 700, lineHeight: 1, marginLeft: '2px' }}>✓</span>}
                                    </span>
                                  </th>
                                )
                              })}
                              {scBackNine.length > 0 && <th style={{ ...thSt(true), width: '2.8rem' }}>In</th>}
                              <th style={{ ...thSt(), width: '2.8rem' }}>TOT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {hcpVisible.has(row.player.id) && (
                              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>HCP</td>
                                {scFrontNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                                {scFrontNine.length > 0 && <td style={tdPar(true)} />}
                                {scBackNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.stroke_index ?? '–'}</td>)}
                                {scBackNine.length > 0 && <td style={tdPar(true)} />}
                                <td style={tdPar()} />
                              </tr>
                            )}
                            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <td style={{ ...tdPar(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PAR</td>
                              {scFrontNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.par}</td>)}
                              {scFrontNine.length > 0 && <td style={tdPar(true)}>{scFrontPar}</td>}
                              {scBackNine.map((h) => <td key={h.hole_number} style={tdPar()}>{h.par}</td>)}
                              {scBackNine.length > 0 && <td style={tdPar(true)}>{scBackPar}</td>}
                              <td style={{ ...tdPar(), fontWeight: 700, color: '#111827' }}>{scTotalPar}</td>
                            </tr>
                            <tr style={{ borderBottom: (groupHasDaytona || groupHasBanker) ? '1px solid #e5e7eb' : undefined }}>
                              <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>SCORE</td>
                              {scFrontNine.map((h) => {
                                const s = scoreMap[h.hole_number] ?? null
                                return <td key={h.hole_number} style={tdSc()}>{s != null ? <ScoreNotation strokes={s} par={h.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                              })}
                              {scFrontNine.length > 0 && <td style={tdSc(true)}>{frontScored.length > 0 ? frontStrokes : '–'}</td>}
                              {scBackNine.map((h) => {
                                const s = scoreMap[h.hole_number] ?? null
                                return <td key={h.hole_number} style={tdSc()}>{s != null ? <ScoreNotation strokes={s} par={h.par} size="sm" /> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                              })}
                              {scBackNine.length > 0 && <td style={tdSc(true)}>{backScored.length > 0 ? backStrokes : '–'}</td>}
                              <td style={{ ...tdSc(), fontWeight: 700, color: '#111827' }}>{thru > 0 ? totalStrokes : '–'}</td>
                            </tr>
                            {groupHasBanker && <>
                              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>AMT</td>
                                {scFrontNine.map((h) => (
                                  <td key={h.hole_number} style={tdSc()}>
                                    {fmtBkrAmt(holeBankerAmtMap.has(h.hole_number) ? (holeBankerAmtMap.get(h.hole_number)!.get(row.player.id) ?? 0) : null)}
                                  </td>
                                ))}
                                <td style={tdSc(true)}>{fmtBkrAmt((() => { const pl = scFrontNine.filter(h => holeBankerAmtMap.get(h.hole_number)?.has(row.player.id)); return pl.length > 0 ? pl.reduce((s, h) => s + (holeBankerAmtMap.get(h.hole_number)!.get(row.player.id) ?? 0), 0) : null })())}</td>
                                {scBackNine.map((h) => (
                                  <td key={h.hole_number} style={tdSc()}>
                                    {fmtBkrAmt(holeBankerAmtMap.has(h.hole_number) ? (holeBankerAmtMap.get(h.hole_number)!.get(row.player.id) ?? 0) : null)}
                                  </td>
                                ))}
                                {scBackNine.length > 0 && <td style={tdSc(true)}>{fmtBkrAmt((() => { const pl = scBackNine.filter(h => holeBankerAmtMap.get(h.hole_number)?.has(row.player.id)); return pl.length > 0 ? pl.reduce((s, h) => s + (holeBankerAmtMap.get(h.hole_number)!.get(row.player.id) ?? 0), 0) : null })())}</td>}
                                <td style={tdSc()}>{fmtBkrAmt(totalBankerAmtMap.has(row.player.id) ? totalBankerAmtMap.get(row.player.id)! : null)}</td>
                              </tr>
                              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>BKR</td>
                                {scFrontNine.map((h) => (
                                  <td key={h.hole_number} style={tdSc()}>
                                    {groupBankerHoles[h.hole_number]?.bankerPlayerId === row.player.id ? <span style={{ fontSize: '0.75rem' }}>🏦</span> : <span style={{ color: '#d1d5db' }}>–</span>}
                                  </td>
                                ))}
                                {(() => { const n = scFrontNine.filter(h => groupBankerHoles[h.hole_number]?.bankerPlayerId === row.player.id).length; return <td style={tdSc(true)}>{n > 0 ? <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.7rem' }}>{n}</span> : null}</td> })()}
                                {scBackNine.map((h) => (
                                  <td key={h.hole_number} style={tdSc()}>
                                    {groupBankerHoles[h.hole_number]?.bankerPlayerId === row.player.id ? <span style={{ fontSize: '0.75rem' }}>🏦</span> : <span style={{ color: '#d1d5db' }}>–</span>}
                                  </td>
                                ))}
                                {scBackNine.length > 0 && (() => { const n = scBackNine.filter(h => groupBankerHoles[h.hole_number]?.bankerPlayerId === row.player.id).length; return <td style={tdSc(true)}>{n > 0 ? <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.7rem' }}>{n}</span> : null}</td> })()}
                                {(() => { const n = [...scFrontNine, ...scBackNine].filter(h => groupBankerHoles[h.hole_number]?.bankerPlayerId === row.player.id).length; return <td style={tdSc()}>{n > 0 ? <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.7rem' }}>{n}</span> : null}</td> })()}
                              </tr>
                            </>}
                            {groupHasDaytona && <>
                              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PTS</td>
                                {scFrontNine.map((h) => {
                                  const pts = holePtsMaps.get(h.hole_number)?.has(row.player.id) ? holePtsMaps.get(h.hole_number)!.get(row.player.id)! : null
                                  return <td key={h.hole_number} style={tdSc()}>{pts === null ? <span style={{ color: '#d1d5db' }}>–</span> : <span style={{ position: 'relative', display: 'inline-block', fontWeight: 600, color: pColor(pts), fontSize: '0.7rem' }}>{pts !== 0 && <span style={{ position: 'absolute', right: '100%', paddingRight: '1px' }}>{pts > 0 ? '+' : '-'}</span>}<span>{pts === 0 ? '0' : String(Math.abs(pts))}</span></span>}</td>
                                })}
                                <td style={tdSc(true)}>{frontPts === null ? <span style={{ color: '#d1d5db' }}>–</span> : <span style={{ position: 'relative', display: 'inline-block', fontWeight: 700, color: pColor(frontPts) }}>{frontPts !== 0 && <span style={{ position: 'absolute', right: '100%', paddingRight: '1px' }}>{frontPts > 0 ? '+' : '-'}</span>}<span>{frontPts === 0 ? '0' : String(Math.abs(frontPts))}</span></span>}</td>
                                {scBackNine.map((h) => {
                                  const pts = holePtsMaps.get(h.hole_number)?.has(row.player.id) ? holePtsMaps.get(h.hole_number)!.get(row.player.id)! : null
                                  return <td key={h.hole_number} style={tdSc()}>{pts === null ? <span style={{ color: '#d1d5db' }}>–</span> : <span style={{ position: 'relative', display: 'inline-block', fontWeight: 600, color: pColor(pts), fontSize: '0.7rem' }}>{pts !== 0 && <span style={{ position: 'absolute', right: '100%', paddingRight: '1px' }}>{pts > 0 ? '+' : '-'}</span>}<span>{pts === 0 ? '0' : String(Math.abs(pts))}</span></span>}</td>
                                })}
                                <td style={tdSc(true)}>{backPts === null ? <span style={{ color: '#d1d5db' }}>–</span> : <span style={{ position: 'relative', display: 'inline-block', fontWeight: 700, color: pColor(backPts) }}>{backPts !== 0 && <span style={{ position: 'absolute', right: '100%', paddingRight: '1px' }}>{backPts > 0 ? '+' : '-'}</span>}<span>{backPts === 0 ? '0' : String(Math.abs(backPts))}</span></span>}</td>
                                <td style={tdSc()}>{totalPts === null ? <span style={{ color: '#d1d5db' }}>–</span> : <span style={{ position: 'relative', display: 'inline-block', fontWeight: 700, color: pColor(totalPts) }}>{totalPts !== 0 && <span style={{ position: 'absolute', right: '100%', paddingRight: '1px' }}>{totalPts > 0 ? '+' : '-'}</span>}<span>{totalPts === 0 ? '0' : String(Math.abs(totalPts))}</span></span>}</td>
                              </tr>
                              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>TEAM</td>
                                {scFrontNine.map((h) => {
                                  const a = assignments.find((a) => a.player_id === row.player.id && a.hole_number === h.hole_number)
                                  const side = a?.side ?? null
                                  const lChar = gIsFlares ? (h.par === 3 ? 'C' : 'O') : 'L'
                                  const rChar = gIsFlares ? (h.par === 3 ? 'F' : 'I') : 'R'
                                  return <td key={h.hole_number} style={tdSc()}>{side != null ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? lChar : rChar}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                                })}
                                <td style={tdSc(true)} />
                                {scBackNine.map((h) => {
                                  const a = assignments.find((a) => a.player_id === row.player.id && a.hole_number === h.hole_number)
                                  const side = a?.side ?? null
                                  const lChar = gIsFlares ? (h.par === 3 ? 'C' : 'O') : 'L'
                                  const rChar = gIsFlares ? (h.par === 3 ? 'F' : 'I') : 'R'
                                  return <td key={h.hole_number} style={tdSc()}>{side != null ? <span style={{ fontWeight: 700, fontSize: '0.7rem', color: side === 'left' ? '#2563eb' : '#92400e' }}>{side === 'left' ? lChar : rChar}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                                })}
                                <td style={tdSc(true)} /><td style={tdSc()} />
                              </tr>
                              {groupHasDaytona && Object.keys(teamHoleVals).length > 0 && (
                                <tr>
                                  <td style={{ ...tdSc(), textAlign: 'left', paddingLeft: '0.6rem', fontWeight: 700, color: '#374151', ...stickyFirst }}>PRESS</td>
                                  {scFrontNine.map((h) => {
                                    const pressRate = teamHoleVals[h.hole_number]
                                    const color = pressRate !== undefined ? pressColor(pressRate) : '#9ca3af'
                                    const rateStr = pressRate !== undefined ? (pressRate % 1 === 0 ? `$${pressRate}` : `$${pressRate.toFixed(2).replace(/^0/, '')}`) : null
                                    return <td key={h.hole_number} style={tdSc()}>{rateStr !== null ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{rateStr}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                                  })}
                                  <td style={tdSc(true)} />
                                  {scBackNine.map((h) => {
                                    const pressRate = teamHoleVals[h.hole_number]
                                    const color = pressRate !== undefined ? pressColor(pressRate) : '#9ca3af'
                                    const rateStr = pressRate !== undefined ? (pressRate % 1 === 0 ? `$${pressRate}` : `$${pressRate.toFixed(2).replace(/^0/, '')}`) : null
                                    return <td key={h.hole_number} style={tdSc()}>{rateStr !== null ? <span style={{ fontWeight: 600, fontSize: '0.65rem', color }}>{rateStr}</span> : <span style={{ color: '#d1d5db' }}>–</span>}</td>
                                  })}
                                  <td style={tdSc(true)} /><td style={tdSc()} />
                                </tr>
                              )}
                            </>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="h-6" />
            </div>
          </div>
        )
      })()}

      <header ref={headerRef} className="text-white pb-4 px-4 shadow-md z-10" style={{ position: 'fixed', top: 0, left: 0, right: 0, background: navy, paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-[72px] h-[72px] flex-shrink-0 rounded-3xl overflow-hidden -my-1">
                <img src="/abg-logo.jpg" alt="ABG" className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest leading-tight" style={{ color: gold }}>{orgName}</p>
                <h1 className="text-lg font-bold leading-tight">{roundName}</h1>
                {roundCourse && <p className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.5)' }}>{roundCourse}</p>}
                <p className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.5)' }}>{formattedDate}</p>
                {(isAdmin || scorecardTeamId || scorecardGroupId) && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {isAdmin && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>Admin</span>}
                    {(scorecardTeamId || scorecardGroupId) && <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>Scorer</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-1.5 flex-shrink-0 ml-3">
              {(isMixedGroups ? scorecardGroupId : scorecardTeamId) ? (
                <a href={isMixedGroups ? `/${orgSlug}/score/group/${scorecardGroupId}` : `/${orgSlug}/score/${scorecardTeamId}`}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold text-center"
                  style={{ background: gold, color: navy }}>
                  {isComplete ? 'Edit Scores' : 'Enter Scores'}
                </a>
              ) : (
                <button onClick={() => setShowPin(true)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  style={{ background: gold, color: navy }}>
                  Enter Pin
                </button>
              )}
              <button onClick={() => setShowOptions(true)}
                className="text-xs px-3 py-1.5 rounded-lg border font-medium text-white text-center"
                style={{ borderColor: 'rgba(255,255,255,0.5)' }}>
                Options
              </button>
            </div>
          </div>
        </div>
      </header>
      <div ref={spacerRef} />

      <div className="max-w-lg mx-auto px-4 pt-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-gray-900">Leaderboard</h2>
          {(!isMixedGroups || mixedTab === 'team') && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500" style={{ marginRight: '22px' }}>
              <span className={`w-2 h-2 rounded-full inline-block${isComplete ? ' bg-red-500' : ' bg-green-500 animate-pulse'}`} />
              {isComplete ? 'Complete' : 'Live'}
            </div>
          )}
        </div>


        {/* Group leaderboard */}
        {isMixedGroups && mixedTab === 'group' && (() => {
          const groupRows = (playingGroups ?? []).map((g) => {
            const pids = groupPlayerMap[g.id] ?? []
            let totalVsPar: number | null = null
            for (const pid of pids) {
              const pScores = scores.filter((s) => s.player_id === pid)
              if (pScores.length === 0) continue
              const pPar = holes.filter((h) => pScores.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
              const pStrokes = pScores.reduce((sum, s) => sum + s.strokes, 0)
              totalVsPar = (totalVsPar ?? 0) + (pStrokes - pPar)
            }
            const thru = pids.length > 0 ? Math.max(...pids.map((pid) => scores.filter((s) => s.player_id === pid).length), 0) : 0
            return { group: g, totalVsPar, thru }
          }).sort((a, b) => {
            if (a.totalVsPar === null && b.totalVsPar === null) return 0
            if (a.totalVsPar === null) return 1
            if (b.totalVsPar === null) return -1
            return a.totalVsPar - b.totalVsPar
          })
          return (
            <div className="space-y-2 pb-24">
              {groupRows.map((row, i) => {
                const vp = row.totalVsPar
                const vpStr = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : String(vp)
                const vpColor = vp === null ? '#9ca3af' : vp < 0 ? '#16a34a' : vp > 0 ? '#dc2626' : '#374151'
                const pids = groupPlayerMap[row.group.id] ?? []
                return (
                  <div key={row.group.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-400 w-5 flex-shrink-0">{vp !== null ? i + 1 : '–'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{row.group.name}</p>
                      <p className="text-xs text-gray-400">{pids.length} players · {row.thru > 0 ? `Thru ${row.thru}` : 'Not started'}</p>
                    </div>
                    <span className="text-lg font-bold" style={{ color: vpColor }}>{vpStr}</span>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Individual leaderboard */}
        {isMixedGroups && mixedTab === 'individual' && (() => {
          const allPids = Object.values(groupPlayerMap).flat()
          const playerRows = players
            .filter((p) => allPids.includes(p.id))
            .map((p) => {
              const pScores = scores.filter((s) => s.player_id === p.id)
              if (pScores.length === 0) return { player: p, vsPar: null, thru: 0 }
              const pPar = holes.filter((h) => pScores.some((s) => s.hole_number === h.hole_number)).reduce((sum, h) => sum + h.par, 0)
              const pStrokes = pScores.reduce((sum, s) => sum + s.strokes, 0)
              return { player: p, vsPar: pStrokes - pPar, thru: pScores.length }
            }).sort((a, b) => {
              if (a.vsPar === null && b.vsPar === null) return 0
              if (a.vsPar === null) return 1
              if (b.vsPar === null) return -1
              return a.vsPar - b.vsPar
            })
          const teamName = (p: Player) => initialTeams.find((t) => t.id === p.team_id)?.name ?? ''
          return (
            <div className="space-y-2 pb-24">
              {playerRows.map((row, i) => {
                const vp = row.vsPar
                const vpStr = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : String(vp)
                const vpColor = vp === null ? '#9ca3af' : vp < 0 ? '#16a34a' : vp > 0 ? '#dc2626' : '#374151'
                return (
                  <div key={row.player.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-400 w-5 flex-shrink-0">{vp !== null ? i + 1 : '–'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{row.player.name}</p>
                      <p className="text-xs text-gray-400">{teamName(row.player)}{row.thru > 0 ? ` · Thru ${row.thru}` : ' · Not started'}</p>
                    </div>
                    <span className="text-lg font-bold" style={{ color: vpColor }}>{vpStr}</span>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Existing leaderboard content (Team tab or non-mixed) */}
        {(!isMixedGroups || mixedTab === 'team') && <>
        {/* Leaderboard view toggles + divider + action buttons — single no-wrap row */}
        <div className="flex items-center gap-1 mb-3" style={{ flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {(isDaytona
            ? [{ view: 'group', label: 'Group' }, { view: 'individual', label: 'Individual' }]
            : isTraditional
            ? [{ view: 'individual', label: 'Individual' }, { view: 'group', label: 'Group' }]
            : hasStandardGroupView
            ? [{ view: 'team', label: 'Team' }, { view: 'group', label: 'Group' }, { view: 'individual', label: 'Individual' }]
            : [{ view: 'team', label: 'Team' }, { view: 'individual', label: 'Individual' }]
          ).map(({ view, label }) => (
            <button
              key={view}
              onClick={() => { const v = view as 'group' | 'team' | 'individual'; setLeaderboardView(v); sessionStorage.setItem('leaderboardView', v) }}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition"
              style={{ ...(leaderboardView === view ? { background: navy, color: 'white', borderColor: navy } : { background: 'white', color: '#6b7280', borderColor: '#d1d5db' }), flexShrink: 0 }}>
              {label}
            </button>
          ))}
          <div style={{ width: '1.5px', height: '1.25rem', background: '#94a3b8', flexShrink: 0, margin: '0 4px' }} />
          <a href={`/${orgSlug}/matchup`} className="font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1.5px solid #f59e0b', color: navy, boxShadow: '0 2px 8px rgba(245,158,11,0.3)', flexShrink: 0, fontSize: '11px' }}>
            Matchups
          </a>
          <button
            onClick={() => setShowPayouts(true)}
            className="font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1.5px solid #f59e0b', color: navy, boxShadow: '0 2px 8px rgba(245,158,11,0.3)', flexShrink: 0, fontSize: '11px' }}>
            Payouts
          </button>
          {isDaytona && initialTeams.length === 1 && (
            <a href={`/${orgSlug}/scorecards?teamId=${initialTeams[0].id}`}
              className="font-semibold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1.5px solid #f59e0b', color: navy, boxShadow: '0 2px 8px rgba(245,158,11,0.3)', flexShrink: 0, fontSize: '11px' }}>
              All Scorecards
            </a>
          )}
        </div>

        {isDaytona && leaderboardView === 'group' && dtGroupRows.length > 1 ? (
          <div className="space-y-4">
            {dtGroupRows.map((group) => {
              const variantLabel = group.variant?.startsWith('5man-flares') ? '5-Man Flares'
                : group.variant?.startsWith('5man') ? '5-Man Normal' : '4-Man'
              return (
                <div key={group.team.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div style={{ background: navy }}>
                    <div className="flex items-center px-4 pt-3 pb-1.5">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-bold text-white">{group.team.name}</span>
                        <span className="ml-2 text-xs" style={{ color: 'white' }}>· Daytona {variantLabel}</span>
                      </div>
                      <a href={`/${orgSlug}/scorecards?teamId=${group.team.id}`}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 ml-2"
                        style={{ background: gold, color: navy }}>
                        All Scorecards
                      </a>
                    </div>
                    <div className="flex items-center px-4 py-2 text-xs font-semibold uppercase"
                      style={{ background: '#dde4ee' }}>
                      <span className="w-5 mr-2 flex-shrink-0" style={{ color: '#64748b' }}>#</span>
                      <span className="flex-1 min-w-0" style={{ color: '#64748b' }}>Player</span>
                      <span className="inline-flex justify-center flex-shrink-0" style={{ width: '4rem', color: navy }}>Points</span>
                      <span className="inline-flex justify-center flex-shrink-0" style={{ width: '2.75rem', color: '#64748b' }}>Thru</span>
                    </div>
                  </div>
                  {group.rows.map((row, i) => {
                    const hasScores = row.thru > 0

                    const pts = row.thru > 0 ? row.points : null
                    const ptsColor = pts === null ? '#9ca3af' : pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#111827'
                    const ptsStr = pts === null ? '–' : pts > 0 ? `+${pts}` : String(pts)
                    return (
                      <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                        className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                        <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>
                          {hasScores ? i + 1 : '–'}
                        </span>
                        <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                        <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: ptsColor }}>
                          {ptsStr}
                        </span>
                        <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>
                          {row.thru === 0 ? '–' : row.thru === 18 ? 'F' : row.thru}
                        </span>
                      </a>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ) : isTraditional && leaderboardView === 'group' ? (
          <div className="space-y-4">
            {traditionalGroupRows.length === 0 && <p className="text-center text-gray-500 text-sm py-8">No groups yet.</p>}
            {traditionalGroupRows.map((group) => {
              const gView = traditionalGroupView[group.team.id] ?? (group.hasDaytona ? 'points' : 'score')
              const showingPoints = gView === 'points' && group.hasDaytona && group.pointsMap
              const sortedRows = showingPoints
                ? [...group.rows].sort((a, b) => {
                    const aPts = group.pointsMap!.get(a.player.id) ?? 0
                    const bPts = group.pointsMap!.get(b.player.id) ?? 0
                    if (aPts !== bPts) return bPts - aPts
                    return a.player.name.localeCompare(b.player.name)
                  })
                : group.rows
              return (
                <div key={group.team.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div style={{ background: navy }}>
                    <div className="flex items-center px-4 pt-3 pb-1.5 gap-2">
                      <span className="text-sm font-bold text-white flex-1">
                        {group.team.name}
                        {group.team.daytona_variant?.startsWith('5man-flares') && (
                          <span className="ml-1.5 text-xs font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>(Flares)</span>
                        )}
                      </span>
                      {group.hasDaytona && (
                        <div className="flex items-center rounded-full overflow-hidden border text-[10px] font-semibold flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.35)' }}>
                          <button onClick={() => setTraditionalGroupView((v) => ({ ...v, [group.team.id]: 'score' }))}
                            className="px-2.5 py-0.5 transition"
                            style={{ background: gView === 'score' ? 'white' : 'transparent', color: gView === 'score' ? navy : 'rgba(255,255,255,0.7)' }}>
                            Score
                          </button>
                          <button onClick={() => setTraditionalGroupView((v) => ({ ...v, [group.team.id]: 'points' }))}
                            className="px-2.5 py-0.5 transition"
                            style={{ background: gView === 'points' ? 'white' : 'transparent', color: gView === 'points' ? navy : 'rgba(255,255,255,0.7)' }}>
                            Points
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => { setAllScorecardsGroupId(group.team.id); setShowAllScorecards(true) }}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: gold, color: navy }}>
                        All Scorecards
                      </button>
                    </div>
                    <div className="flex items-center px-4 py-2 text-xs font-semibold uppercase" style={{ background: '#dde4ee' }}>
                      <span className="w-5 mr-2 flex-shrink-0" style={{ color: '#64748b' }}>#</span>
                      <span className="flex-1 min-w-0" style={{ color: '#64748b' }}>Player</span>
                      <span className="inline-flex justify-center flex-shrink-0" style={{ width: '4rem', color: navy }}>{showingPoints ? 'Points' : 'Score'}</span>
                      <span className="inline-flex justify-center flex-shrink-0" style={{ width: '2.75rem', color: '#64748b' }}>Thru</span>
                    </div>
                  </div>
                  {sortedRows.map((row, i) => {
                    if (showingPoints) {
                      const pts = group.pointsMap!.get(row.player.id) ?? null
                      const ptCol = pts === null ? '#9ca3af' : pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#111827'
                      const ptStr = pts === null ? '–' : pts > 0 ? `+${pts}` : String(pts)
                      return (
                        <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                          className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                          <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>{row.holesPlayed > 0 ? i + 1 : '–'}</span>
                          <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                          <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: ptCol }}>{ptStr}</span>
                          <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>{row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}</span>
                        </a>
                      )
                    }
                    const vp = row.vspar
                    const vpColor = vp !== null && vp < 0 ? '#dc2626' : '#111827'
                    const vpStr = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                    return (
                      <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                        className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                        <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>{row.holesPlayed > 0 ? i + 1 : '–'}</span>
                        <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                        <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: vp === null ? '#9ca3af' : vpColor }}>{vpStr}</span>
                        <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>{row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}</span>
                      </a>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ) : hasStandardGroupView && leaderboardView === 'group' ? (
          <div className="space-y-4">
            {standardGroupRows.length === 0 && <p className="text-center text-gray-500 text-sm py-8">No groups yet.</p>}
            {standardGroupRows.map((group) => {
              const gView = traditionalGroupView[group.id] ?? (group.hasDaytona ? 'points' : 'score')
              const showingPoints = gView === 'points' && group.hasDaytona && group.pointsMap
              const bankerView = groupBankerView[group.id] ?? (group.hasBanker ? 'dollars' : 'score')
              const showingDollars = group.hasBanker && bankerView === 'dollars'
              const sortedRows = showingPoints
                ? [...group.rows].sort((a, b) => {
                    const aPts = group.pointsMap!.get(a.player.id) ?? 0
                    const bPts = group.pointsMap!.get(b.player.id) ?? 0
                    if (aPts !== bPts) return bPts - aPts
                    return a.player.name.localeCompare(b.player.name)
                  })
                : showingDollars
                  ? [...group.rows].sort((a, b) => {
                      const aAmt = group.bankerTotals[a.player.id] ?? 0
                      const bAmt = group.bankerTotals[b.player.id] ?? 0
                      if (aAmt !== bAmt) return bAmt - aAmt
                      return a.player.name.localeCompare(b.player.name)
                    })
                  : group.rows
              const colHeader = showingPoints ? 'Points' : showingDollars ? '$' : 'Score'
              return (
                <div key={group.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div style={{ background: navy }}>
                    <div className="flex items-center px-4 pt-3 pb-1.5 gap-2">
                      <span className="text-sm font-bold text-white flex-1 flex items-center gap-1.5">
                        {group.name}
                        {group.hasDaytona && (
                          <span className="text-[10px] font-semibold tracking-wide" style={{ color: 'rgba(255,255,255,0.5)' }}>
                            {group.daytona_variant?.startsWith('5man-flares') ? 'Flares' : 'Daytona'}
                          </span>
                        )}
                        {group.hasBanker && (
                          <span className="text-[10px] font-semibold tracking-wide" style={{ color: 'rgba(255,255,255,0.5)' }}>
                            Banker
                          </span>
                        )}
                      </span>
                      {group.hasDaytona && (
                        <div className="flex items-center rounded-full overflow-hidden border text-[10px] font-semibold flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.35)' }}>
                          <button onClick={() => setTraditionalGroupView((v) => ({ ...v, [group.id]: 'score' }))}
                            className="px-2.5 py-0.5 transition"
                            style={{ background: gView === 'score' ? 'white' : 'transparent', color: gView === 'score' ? navy : 'rgba(255,255,255,0.7)' }}>
                            Score
                          </button>
                          <button onClick={() => setTraditionalGroupView((v) => ({ ...v, [group.id]: 'points' }))}
                            className="px-2.5 py-0.5 transition"
                            style={{ background: gView === 'points' ? 'white' : 'transparent', color: gView === 'points' ? navy : 'rgba(255,255,255,0.7)' }}>
                            Points
                          </button>
                        </div>
                      )}
                      {group.hasBanker && (
                        <div className="flex items-center rounded-full overflow-hidden border text-[10px] font-semibold flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.35)' }}>
                          <button onClick={() => setGroupBankerView((v) => ({ ...v, [group.id]: 'score' }))}
                            className="px-2.5 py-0.5 transition"
                            style={{ background: bankerView === 'score' ? 'white' : 'transparent', color: bankerView === 'score' ? navy : 'rgba(255,255,255,0.7)' }}>
                            Score
                          </button>
                          <button onClick={() => setGroupBankerView((v) => ({ ...v, [group.id]: 'dollars' }))}
                            className="px-2.5 py-0.5 transition"
                            style={{ background: bankerView === 'dollars' ? 'white' : 'transparent', color: bankerView === 'dollars' ? navy : 'rgba(255,255,255,0.7)' }}>
                            $
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => { setAllScorecardsGroupId(group.id); setShowAllScorecards(true) }}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: gold, color: navy }}>
                        All Scorecards
                      </button>
                    </div>
                    <div className="flex items-center px-4 py-2 text-xs font-semibold uppercase" style={{ background: '#dde4ee' }}>
                      <span className="w-5 mr-2 flex-shrink-0" style={{ color: '#64748b' }}>#</span>
                      <span className="flex-1 min-w-0" style={{ color: '#64748b' }}>Player</span>
                      <span className="inline-flex justify-center flex-shrink-0" style={{ width: '4rem', color: navy }}>{colHeader}</span>
                      <span className="inline-flex justify-center flex-shrink-0" style={{ width: '2.75rem', color: '#64748b' }}>Thru</span>
                    </div>
                  </div>
                  {sortedRows.map((row, i) => {
                    if (showingDollars) {
                      const amt = group.bankerTotals[row.player.id] ?? 0
                      const amtColor = amt > 0 ? '#16a34a' : amt < 0 ? '#dc2626' : '#6b7280'
                      const amtStr = amt !== 0 ? `$${Math.round(Math.abs(amt))}` : '$0'
                      return (
                        <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                          className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                          <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>{row.holesPlayed > 0 ? i + 1 : '–'}</span>
                          <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                          <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: amtColor }}>{amtStr}</span>
                          <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>{row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}</span>
                        </a>
                      )
                    }
                    if (showingPoints) {
                      const pts = group.pointsMap!.get(row.player.id) ?? null
                      const ptCol = pts === null ? '#9ca3af' : pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#111827'
                      const ptStr = pts === null ? '–' : pts > 0 ? `+${pts}` : String(pts)
                      return (
                        <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                          className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                          <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>{row.holesPlayed > 0 ? i + 1 : '–'}</span>
                          <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                          <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: ptCol }}>{ptStr}</span>
                          <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>{row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}</span>
                        </a>
                      )
                    }
                    const vp = row.vspar
                    const vpColor = vp !== null && vp < 0 ? '#dc2626' : '#111827'
                    const vpStr = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                    return (
                      <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                        className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                        <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>{row.holesPlayed > 0 ? i + 1 : '–'}</span>
                        <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                        <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: vp === null ? '#9ca3af' : vpColor }}>{vpStr}</span>
                        <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>{row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}</span>
                      </a>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <div className="min-w-max w-full">
          {/* Header */}
          <div style={{ background: navy }}>
            {(!isDaytona && !isTraditional && leaderboardView === 'team') ? (
              <>
                {/* Group labels row */}
                <div className="flex items-center px-4 pt-2 pb-0 text-xs font-semibold uppercase tracking-wide">
                  <span className="w-5 mr-2 flex-shrink-0" />
                  <span className="flex-1 min-w-0" />
                  <span
                    className="inline-flex justify-center flex-shrink-0"
                    style={{ width: `${ballsCount * 2}rem`, color: 'white' }}>
                    Front 9
                  </span>
                  <span className="flex-shrink-0" style={{ width: '0.75rem' }} />
                  <span
                    className="inline-flex justify-center flex-shrink-0"
                    style={{ width: `${ballsCount * 2}rem`, color: 'white' }}>
                    Back 9
                  </span>
                  <span className="flex-shrink-0" style={{ width: '2.75rem' }} />
                </div>
                {/* Column labels row */}
                <div className="flex items-center px-4 pb-2 pt-0.5 text-xs font-semibold uppercase"
                  style={{ color: 'white' }}>
                  <span className="w-5 mr-2 flex-shrink-0">#</span>
                  <span className="flex-1 min-w-0">Team</span>
                  {Array.from({ length: ballsCount }, (_, i) => (
                    <span key={`fh${i}`} className="inline-flex justify-center flex-shrink-0" style={{ width: scoreColW, color: gold }}>{i + 1}B</span>
                  ))}
                  <span className="flex-shrink-0" style={{ width: '0.75rem' }} />
                  {Array.from({ length: ballsCount }, (_, i) => (
                    <span key={`bh${i}`} className="inline-flex justify-center flex-shrink-0" style={{ width: scoreColW, color: gold }}>{i + 1}B</span>
                  ))}
                  <span className="inline-flex justify-center flex-shrink-0" style={{ width: '2.75rem' }}>Thru</span>
                </div>
              </>
            ) : (
              <div className="flex items-center px-4 py-2 text-xs font-semibold uppercase" style={{ color: 'white' }}>
                <span className="w-5 mr-2 flex-shrink-0">#</span>
                <span className="flex-1 min-w-0">Player</span>
                {leaderboardView === 'individual' && (
                  <button
                    onClick={() => { setAllScorecardsGroupId(null); setShowAllScorecards(true) }}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                    style={{ background: gold, color: navy }}>
                    All Scorecards
                  </button>
                )}
                <span className="inline-flex justify-center flex-shrink-0" style={{ width: '4rem', color: gold }}>{isDaytona && leaderboardView === 'group' ? 'Points' : 'Score'}</span>
                <span className="inline-flex justify-center flex-shrink-0" style={{ width: '2.75rem' }}>Thru</span>
              </div>
            )}
          </div>

          {isDaytona && leaderboardView === 'individual' ? (
            <>
              {dtIndividualRows.length === 0 && <p className="text-center text-gray-500 text-sm py-8">No scores yet.</p>}
              {dtIndividualRows.map((row, i) => {
                const vp = row.vspar
                const vpColor = vp !== null && vp < 0 ? '#dc2626' : '#111827'
                const vpStr = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                return (
                  <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                    className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                    <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>{row.holesPlayed > 0 ? i + 1 : '–'}</span>
                    <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                    <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: vp === null ? '#9ca3af' : vpColor }}>{vpStr}</span>
                    <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>{row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}</span>
                  </a>
                )
              })}
            </>
          ) : !isDaytona && !isTraditional && leaderboardView === 'individual' ? (
            <>
              {ballIndividualRows.length === 0 && <p className="text-center text-gray-500 text-sm py-8">No scores yet.</p>}
              {ballIndividualRows.map((row, i) => {
                const vp = row.vspar
                const vpColor = vp !== null && vp < 0 ? '#dc2626' : '#111827'
                const vpStr = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                return (
                  <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                    className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                    <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>{row.holesPlayed > 0 ? i + 1 : '–'}</span>
                    <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                    <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: vp === null ? '#9ca3af' : vpColor }}>{vpStr}</span>
                    <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>{row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}</span>
                  </a>
                )
              })}
            </>
          ) : isTraditional ? (
            <>
              {traditionalPlayerRows.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">No scores yet.</p>
              )}
              {traditionalPlayerRows.map((row, i) => {
                const hasScores = row.holesPlayed > 0
                const vp = row.vspar
                const vpCol = vp !== null && vp < 0 ? '#dc2626' : '#111827'
                const vpStr = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                return (
                  <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                    className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                    <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>
                      {hasScores ? i + 1 : '–'}
                    </span>
                    <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                    <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: vp === null ? '#9ca3af' : vpCol }}>
                      {vpStr}
                    </span>
                    <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>
                      {row.holesPlayed === 0 ? '–' : row.holesPlayed === 18 ? 'F' : row.holesPlayed}
                    </span>
                  </a>
                )
              })}
            </>
          ) : isDaytona ? (
            <>
              {dtGroupRows.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">No groups added yet.</p>
              )}
              {(dtGroupRows[0]?.rows ?? []).map((row, i) => {
                const hasScores = row.thru > 0
                const pts = row.thru > 0 ? row.points : null
                const ptsColor = pts === null ? '#9ca3af' : pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#111827'
                const ptsStr = pts === null ? '–' : pts > 0 ? `+${pts}` : String(pts)
                return (
                  <a key={row.player.id} href={`/${orgSlug}/player/${row.player.id}`}
                    className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-200 transition border-b border-gray-100 last:border-0">
                    <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>
                      {hasScores ? i + 1 : '–'}
                    </span>
                    <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate">{row.player.name}</span>
                    <span className="inline-flex justify-center text-sm font-bold flex-shrink-0" style={{ width: '4rem', color: ptsColor }}>
                      {ptsStr}
                    </span>
                    <span className="inline-flex justify-center text-sm text-gray-500 flex-shrink-0" style={{ width: '2.75rem' }}>
                      {row.thru === 0 ? '–' : row.thru === 18 ? 'F' : row.thru}
                    </span>
                  </a>
                )
              })}
            </>
          ) : (
            <>
              {rows.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">No scores yet.</p>
              )}
              {rows.map((row, i) => {
                const isExpanded = expandedTeam === row.team.id
                const teamPlayers = players.filter((p) => p.team_id === row.team.id)
                const teamPlayerIds = teamPlayers.map((p) => p.id)
                const thruCount = teamPlayerIds.length > 0
                  ? holes.filter((h) => teamPlayerIds.every((id) => scores.some((s) => s.player_id === id && s.hole_number === h.hole_number))).length
                  : 0
                const hasScores = thruCount > 0
                return (
                  <div key={row.team.id} className="border-b border-gray-100 last:border-0">
                    <a
                      href={`/${orgSlug}/scorecard/${row.team.id}`}
                      className="block hover:bg-gray-50 active:bg-gray-200 transition">
                      {/* Main score line */}
                      <div className="flex items-center px-4 py-3">
                        <span className="w-5 mr-2 text-sm font-bold flex-shrink-0" style={{ color: '#9ca3af' }}>
                          {hasScores ? i + 1 : '–'}
                        </span>
                        <span className="flex-1 min-w-0 font-semibold text-gray-900 text-sm truncate mr-1">
                          {row.team.name}
                        </span>
                        {Array.from({ length: ballsCount }, (_, bi) => {
                          const fResult = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Front 9')
                          const fWon = !!(fResult?.played && !fResult.tied && fResult.winnerId === row.team.id)
                          return (
                            <span key={`f${bi}`} className="inline-flex justify-center items-center flex-shrink-0 rounded" style={{ width: scoreColW, background: fWon ? '#fef3c7' : 'transparent' }}>
                              <ScoreCell vp={row.frontSummary?.ballVsPar[bi] ?? null} gold={fWon} />
                            </span>
                          )
                        })}
                        <span className="flex-shrink-0" style={{ width: '0.75rem' }} />
                        {Array.from({ length: ballsCount }, (_, bi) => {
                          const bResult = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Back 9')
                          const bWon = !!(bResult?.played && !bResult.tied && bResult.winnerId === row.team.id)
                          return (
                            <span key={`b${bi}`} className="inline-flex justify-center items-center flex-shrink-0 rounded" style={{ width: scoreColW, background: bWon ? '#fef3c7' : 'transparent' }}>
                              <ScoreCell vp={row.backSummary?.ballVsPar[bi] ?? null} gold={bWon} />
                            </span>
                          )
                        })}
                        <span className="inline-flex justify-center flex-shrink-0 text-sm text-gray-500" style={{ width: '2.75rem' }}>
                          {thruCount === 0 ? '–' : thruCount === 18 ? 'F' : thruCount}
                        </span>
                      </div>
                    </a>
                  </div>
                )
              })}
            </>
          )}
          </div>
          </div>
        </div>
        )}

        {leaderboardView === 'team' && !isDaytona && !isTraditional && rows.length > 0 && (
          <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-200 mt-4">
            <div className="px-4 py-3" style={{ background: navy }}>
              <span className="text-white font-bold text-sm uppercase tracking-wide">Rosters</span>
            </div>
            {[...rows].sort((a, b) => a.team.name.localeCompare(b.team.name)).map((row) => {
              const rosterPlayers = players.filter((p) => p.team_id === row.team.id)
              return (
                <div key={row.team.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
                  <span className="font-semibold text-gray-900 text-sm flex-shrink-0" style={{ minWidth: '5rem' }}>{row.team.name}</span>
                  <div className="flex-1 min-w-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  <span className="text-sm text-gray-500 flex gap-x-1" style={{ flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                    {rosterPlayers.map((p, idx) => (
                      <span key={p.id} className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                        {idx > 0 && <span className="text-gray-300 select-none">·</span>}
                        <button
                          className="hover:text-gray-900 hover:underline transition-colors"
                          onClick={() => {
                            const frontS = scores.filter((s) => s.player_id === p.id && s.hole_number <= 9)
                            const backS = scores.filter((s) => s.player_id === p.id && s.hole_number >= 10)
                            const fPar = holes.filter((h) => h.hole_number <= 9 && frontS.some((s) => s.hole_number === h.hole_number)).reduce((a, h) => a + h.par, 0)
                            const bPar = holes.filter((h) => h.hole_number >= 10 && backS.some((s) => s.hole_number === h.hole_number)).reduce((a, h) => a + h.par, 0)
                            const frontVP = frontS.length > 0 ? frontS.reduce((a, s) => a + s.strokes, 0) - fPar : null
                            const backVP = backS.length > 0 ? backS.reduce((a, s) => a + s.strokes, 0) - bPar : null
                            const totalVP = frontVP === null && backVP === null ? null : (frontVP ?? 0) + (backVP ?? 0)
                            const thru = new Set(scores.filter((s) => s.player_id === p.id).map((s) => s.hole_number)).size
                            setRosterPopup({ name: p.name, handicap: p.handicap ?? null, frontVP, backVP, totalVP, thru })
                          }}
                        >
                          {p.name}
                        </button>
                      </span>
                    ))}
                  </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        </>}
      </div>

      {/* Roster player popup */}
      {rosterPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setRosterPopup(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl mx-4 overflow-hidden"
            style={{ width: '18rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4" style={{ background: navy, borderBottom: '1px solid rgba(255,255,255,0.35)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2 min-w-0">
                  <p className="text-white font-bold text-base leading-tight">{rosterPopup.name}</p>
                  {rosterPopup.handicap !== null && (
                    <span className="text-xs flex-shrink-0" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      HCP {rosterPopup.handicap < 0 ? `+${Math.abs(rosterPopup.handicap)}` : rosterPopup.handicap}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setRosterPopup(null)}
                  className="text-white opacity-60 hover:opacity-100 transition-opacity text-2xl leading-none font-light"
                >×</button>
              </div>
            </div>
            {/* Score table */}
            <div className="px-5 pt-3 pb-4">
              {/* Column headers */}
              <div className="flex text-xs font-semibold uppercase mb-1.5" style={{ color: '#9ca3af' }}>
                {(['Front', 'Back', 'Total', 'Thru'] as const).map((label) => (
                  <span key={label} className="flex-1 text-center">{label}</span>
                ))}
              </div>
              {/* Values row */}
              <div className="flex">
                {[rosterPopup.frontVP, rosterPopup.backVP, rosterPopup.totalVP].map((vp, i) => {
                  const val = vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : String(vp)
                  const color = vp === null ? '#9ca3af' : vp < 0 ? '#dc2626' : '#111827'
                  return (
                    <span key={i} className="flex-1 text-center text-sm font-bold" style={{ color }}>{val}</span>
                  )
                })}
                <span className="flex-1 text-center text-sm font-semibold text-gray-500">
                  {rosterPopup.thru === 0 ? '–' : rosterPopup.thru === 18 ? 'F' : rosterPopup.thru}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

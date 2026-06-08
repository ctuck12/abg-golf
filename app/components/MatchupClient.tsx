'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  saveMatchup, deleteMatchup, updateMatchupBet, updateMatchupPresses,
  saveBestBallMatchup, deleteBestBallMatchup, updateBestBallBet, updateBestBallPresses,
} from '@/app/actions'
import { ScoreNotation } from './ScoreNotation'
import PinLoginModal from './PinLoginModal'

type Player = { id: string; name: string; teamName: string; handicap?: number | null }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type PressEntry = { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: 'p1' | 'p2'; strokes?: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string; press: PressEntry[] }
type BestBallMatchup = {
  id: string
  team1_player1_id: string; team1_player2_id: string
  team2_player1_id: string; team2_player2_id: string
  bet: string
  press: PressEntry[]
}
type ScorecardTarget =
  | { type: 'player'; id: string; name: string }
  | { type: 'h2h'; p1Id: string; p2Id: string; p1Name: string; p2Name: string; p1Handicap?: number | null; p2Handicap?: number | null; scoringType: ScoringType; betType: BetType | ''; handicapSide: string; handicapFront: number; handicapBack: number; handicapTotal: number }
  | { type: 'bestball'; p1Id: string; p2Id: string; teamName: string }
  | { type: 'bb-scorecards'; t1p1Id: string; t1p2Id: string; t2p1Id: string; t2p2Id: string; t1p1Name: string; t1p2Name: string; t2p1Name: string; t2p2Name: string; t1Name: string; t2Name: string; scoringType: ScoringType; betType: BetType | ''; handicapSide: string; handicapFront: number; handicapBack: number; handicapTotal: number }

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

function computePressResult(
  p1Id: string, p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[],
  press: PressEntry
): { p1Net: number | null; p2Net: number | null; p1Wins: boolean; p2Wins: boolean; holesComplete: boolean } {
  const pressHoles = holes.filter(h => h.hole_number >= press.holeStart && h.hole_number <= press.holeEnd)
  if (pressHoles.length === 0) return { p1Net: null, p2Net: null, p1Wins: false, p2Wins: false, holesComplete: false }
  let p1Sum = 0, p2Sum = 0, parSum = 0, played = 0
  for (const h of pressHoles) {
    const s1 = scoreMap[p1Id]?.[h.hole_number] ?? null
    const s2 = scoreMap[p2Id]?.[h.hole_number] ?? null
    if (s1 === null || s2 === null) continue
    p1Sum += s1; p2Sum += s2; parSum += h.par; played++
  }
  const holesComplete = played === pressHoles.length
  if (played === 0) return { p1Net: null, p2Net: null, p1Wins: false, p2Wins: false, holesComplete }
  const strokes = press.strokes ?? 0
  const adjP1 = (p1Sum - parSum) - (press.strokesSide === 'p1' ? strokes : 0)
  const adjP2 = (p2Sum - parSum) - (press.strokesSide === 'p2' ? strokes : 0)
  return {
    p1Net: adjP1, p2Net: adjP2,
    p1Wins: holesComplete && adjP1 < adjP2,
    p2Wins: holesComplete && adjP2 < adjP1,
    holesComplete,
  }
}

type BetType = 'nassau' | 'straight'
type ScoringType = 'stroke' | 'match'

function parseAmounts(raw: string): { frontAmount: number; backAmount: number; totalAmount: number } {
  const p = raw.split('|')
  if (p.length === 3) {
    const f = parseFloat(p[0]) || 0, b = parseFloat(p[1]) || 0, t = parseFloat(p[2]) || 0
    return { frontAmount: f, backAmount: b, totalAmount: t }
  }
  const a = parseFloat(raw) || 0
  return { frontAmount: a, backAmount: a, totalAmount: a }
}

function parseBet(bet: string): { betType: BetType | ''; amount: string; scoringType: ScoringType; sweepAmount: string; handicapSide: string; handicapFront: string; handicapBack: string; handicapTotal: string; frontAmount: number; backAmount: number; totalAmount: number } {
  const empty = { betType: '' as BetType | '', amount: '', scoringType: 'stroke' as ScoringType, sweepAmount: '', handicapSide: '', handicapFront: '', handicapBack: '', handicapTotal: '', frontAmount: 0, backAmount: 0, totalAmount: 0 }
  if (!bet) return empty
  const parts = bet.split(':')
  // Structured: betType:amount:scoringType[:sweepAmount[:handicapSide:front:back:total]]
  if (parts.length >= 2 && (parts[0] === 'nassau' || parts[0] === 'straight')) {
    const rawAmt = parts[1] ?? ''
    return {
      betType: parts[0] as BetType,
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

function composeBet(betType: BetType | '', amount: string, scoringType: ScoringType, sweepAmount = '', handicapSide = '', handicapFront = '', handicapBack = '', handicapTotal = ''): string {
  if (!betType) return `score:${scoringType}`
  const hf = parseFloat(handicapFront) || 0
  const hb = parseFloat(handicapBack) || 0
  const ht = parseFloat(handicapTotal) || 0
  const hasHandicap = handicapSide && (hf > 0 || hb > 0 || ht > 0)
  const base = `${betType}:${amount.trim()}:${scoringType}`
  if (betType === 'nassau') {
    if (sweepAmount.trim() || hasHandicap) {
      let s = `${base}:${sweepAmount.trim()}`
      if (hasHandicap) s += `:${handicapSide}:${hf}:${hb}:${ht}`
      return s
    }
    return base
  }
  // straight
  if (hasHandicap) return `${base}::${handicapSide}:${hf}:${hb}:${ht}`
  return base
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
  type: 'h2h' | 'bb'
  label: string
  betLabel: string
  segments: PayoutSegment[]
  nassauResult?: {
    winnerLabel: string | null   // net winner name, or null if tied/no data
    amount: number               // absolute net amount (sweepAmt when swept)
    perPlayer: boolean
    anySettled: boolean
    swept?: boolean              // true when one side won front+back+total and sweep is in effect
  }
}

function computeBBPressResult(
  t1p1Id: string, t1p2Id: string,
  t2p1Id: string, t2p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[],
  press: PressEntry
): { t1Net: number | null; t2Net: number | null; t1Wins: boolean; t2Wins: boolean; holesComplete: boolean } {
  const pressHoles = holes.filter(h => h.hole_number >= press.holeStart && h.hole_number <= press.holeEnd)
  if (pressHoles.length === 0) return { t1Net: null, t2Net: null, t1Wins: false, t2Wins: false, holesComplete: false }
  let t1Sum = 0, t2Sum = 0, parSum = 0, played = 0
  for (const h of pressHoles) {
    const t1Arr = ([scoreMap[t1p1Id]?.[h.hole_number] ?? null, scoreMap[t1p2Id]?.[h.hole_number] ?? null] as (number | null)[]).filter((s): s is number => s !== null)
    const t2Arr = ([scoreMap[t2p1Id]?.[h.hole_number] ?? null, scoreMap[t2p2Id]?.[h.hole_number] ?? null] as (number | null)[]).filter((s): s is number => s !== null)
    if (t1Arr.length === 0 || t2Arr.length === 0) continue
    t1Sum += Math.min(...t1Arr); t2Sum += Math.min(...t2Arr); parSum += h.par; played++
  }
  const holesComplete = played === pressHoles.length
  if (played === 0) return { t1Net: null, t2Net: null, t1Wins: false, t2Wins: false, holesComplete }
  const strokes = press.strokes ?? 0
  const adjT1 = (t1Sum - parSum) - (press.strokesSide === 'p1' ? strokes : 0)
  const adjT2 = (t2Sum - parSum) - (press.strokesSide === 'p2' ? strokes : 0)
  return { t1Net: adjT1, t2Net: adjT2, t1Wins: holesComplete && adjT1 < adjT2, t2Wins: holesComplete && adjT2 < adjT1, holesComplete }
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

    const { betType, scoringType, sweepAmount, handicapSide, handicapFront, handicapBack, handicapTotal, frontAmount: fBetAmt, backAmount: bBetAmt, totalAmount: tBetAmt } = parseBet(m.bet)
    const hasBet = betType !== '' && (fBetAmt > 0 || bBetAmt > 0 || tBetAmt > 0)

    if (!hasBet) {
      // Old matchup with no bet configured — show it but skip payout math
      rows.push({ id: m.id, type: 'h2h', label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }

    const stats = computeStats(m.player1_id, m.player2_id, scoreMap, holes)
    const hole9 = scoreMap[m.player1_id]?.[9] != null && scoreMap[m.player2_id]?.[9] != null
    const hole18 = scoreMap[m.player1_id]?.[18] != null && scoreMap[m.player2_id]?.[18] != null
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

    const segments: PayoutSegment[] = []
    if (betType === 'nassau') {
      const fSett = hole9 && stats.p1Front !== null && stats.p2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveH2H(fSett, strokeLeader(adjP1Front, adjP2Front), stats.p1FrontWins - stats.p2FrontWins, fBetAmt)
      segments.push({ name: 'Front', settled: fSett, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: false })

      const bSett = hole18 && stats.p1Back !== null && stats.p2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveH2H(bSett, strokeLeader(adjP1Back, adjP2Back), stats.p1BackWins - stats.p2BackWins, bBetAmt)
      segments.push({ name: 'Back', settled: bSett, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: false })
    }
    const tSett = hole18 && stats.p1Total !== null && stats.p2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveH2H(tSett, strokeLeader(adjP1Total, adjP2Total), stats.p1Wins - stats.p2Wins, tBetAmt)
    segments.push({ name: 'Total', settled: tSett, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: false })

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

    const stats = computeBestBall(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
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

    const segments: PayoutSegment[] = []
    if (betType === 'nassau') {
      const fSett = hole9 && stats.t1Front !== null && stats.t2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveBB(fSett, strokeLeaderBB(adjT1Front, adjT2Front), stats.t1FrontWins - stats.t2FrontWins, fBetAmt)
      segments.push({ name: 'Front', settled: fSett, winnerLabel: fWL, tied: fT, amount: fBetAmt, perPlayer: true })

      const bSett = hole18 && stats.t1Back !== null && stats.t2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveBB(bSett, strokeLeaderBB(adjT1Back, adjT2Back), stats.t1BackWins - stats.t2BackWins, bBetAmt)
      segments.push({ name: 'Back', settled: bSett, winnerLabel: bWL, tied: bT, amount: bBetAmt, perPlayer: true })
    }
    const tSett = hole18 && stats.t1Total !== null && stats.t2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveBB(tSett, strokeLeaderBB(adjT1Total, adjT2Total), stats.t1Wins - stats.t2Wins, tBetAmt)
    segments.push({ name: 'Total', settled: tSett, winnerLabel: tWL, tied: tT, amount: tBetAmt, perPlayer: true })

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
    rows.push({ id: m.id, type: 'bb', label: `${t1Name} vs ${t2Name}`, betLabel: formatBet(m.bet), segments, nassauResult })
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

export default function MatchupClient({
  orgSlug, orgId, orgName, isMaster = false,
  roundId, players, holes, scores: initialScores, roundName, initialMatchups, initialBestBallMatchups, isAdmin = false, scorecardTeamId: scorecardTeamIdProp = null, format = 'standard', teams = [], isMixedGroups = false, playingGroups = [], scorecardGroupId: scorecardGroupIdProp = null,
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster?: boolean
  roundId: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  roundName: string
  initialMatchups: SavedMatchup[]
  initialBestBallMatchups: BestBallMatchup[]
  isAdmin?: boolean
  scorecardTeamId?: string | null
  format?: string
  teams?: { id: string; name: string }[]
  isMixedGroups?: boolean
  playingGroups?: { id: string; name: string }[]
  scorecardGroupId?: string | null
}) {
  const [scores, setScores] = useState(initialScores)
  const [matchups, setMatchups] = useState(initialMatchups)
  const [bestBallMatchups, setBestBallMatchups] = useState(initialBestBallMatchups)
  const [showOptions, setShowOptions] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [showPinLogin, setShowPinLogin] = useState(false)
  const [scorecardTeamId] = useState<string | null>(scorecardTeamIdProp)
  const [scorecardGroupId] = useState<string | null>(scorecardGroupIdProp)

  // In mixed-groups rounds, scorer auth comes from the group cookie; otherwise from the team cookie
  const effectiveScorerId = isMixedGroups ? scorecardGroupId : scorecardTeamId
  const enterScoresHref = isMixedGroups
    ? `/${orgSlug}/score/group/${scorecardGroupId}`
    : `/${orgSlug}/score/${scorecardTeamId}`

  async function handleSignOut() {
    await fetch('/api/org-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })
    window.location.href = isMaster ? '/master/dashboard' : '/'
  }

  const addH2HRef = useRef<HTMLDivElement>(null)
  const [newP1, setNewP1] = useState('')
  const [newP2, setNewP2] = useState('')
  const [newBetType, setNewBetType] = useState<BetType | ''>('')
  const [newBetAmount, setNewBetAmount] = useState('')
  const [newFrontAmount, setNewFrontAmount] = useState('')
  const [newBackAmount, setNewBackAmount] = useState('')
  const [newTotalAmount, setNewTotalAmount] = useState('')
  const [newScoringType, setNewScoringType] = useState<ScoringType>('stroke')
  const [newSweepEnabled, setNewSweepEnabled] = useState(false)
  const [newSweepAmount, setNewSweepAmount] = useState('')
  const [newStrokesEnabled, setNewStrokesEnabled] = useState(false)
  const [newStrokesSide, setNewStrokesSide] = useState<'p1' | 'p2'>('p1')
  const [newStrokesFront, setNewStrokesFront] = useState('')
  const [newStrokesBack, setNewStrokesBack] = useState('')
  const [newStrokesTotal, setNewStrokesTotal] = useState('')
  const [savingH2H, setSavingH2H] = useState(false)

  const editH2HRef = useRef<HTMLDivElement>(null)
  const [editingH2H, setEditingH2H] = useState<string | null>(null)
  const [editH2HBetType, setEditH2HBetType] = useState<BetType | ''>('')
  const [editH2HBetAmount, setEditH2HBetAmount] = useState('')
  const [editH2HScoringType, setEditH2HScoringType] = useState<ScoringType>('stroke')
  const [editH2HSweepEnabled, setEditH2HSweepEnabled] = useState(false)
  const [editH2HSweepAmount, setEditH2HSweepAmount] = useState('')
  const [editH2HStrokesEnabled, setEditH2HStrokesEnabled] = useState(false)
  const [editH2HStrokesSide, setEditH2HStrokesSide] = useState<'p1' | 'p2'>('p1')
  const [editH2HStrokesFront, setEditH2HStrokesFront] = useState('')
  const [editH2HStrokesBack, setEditH2HStrokesBack] = useState('')
  const [editH2HStrokesTotal, setEditH2HStrokesTotal] = useState('')
  const [editH2HFrontAmount, setEditH2HFrontAmount] = useState('')
  const [editH2HBackAmount, setEditH2HBackAmount] = useState('')
  const [editH2HTotalAmount, setEditH2HTotalAmount] = useState('')
  // Press bet state
  const [editH2HPresses, setEditH2HPresses] = useState<PressEntry[]>([])
  const [pressEnabled, setPressEnabled] = useState(false)
  const [newPressStrokesEnabled, setNewPressStrokesEnabled] = useState(false)
  const [newPressStrokesSide, setNewPressStrokesSide] = useState<'p1' | 'p2'>('p1')
  const [newPressStrokes, setNewPressStrokes] = useState('')
  const [newPressHoleType, setNewPressHoleType] = useState<'1hole' | 'multihole'>('1hole')
  const [newPressHoleStart, setNewPressHoleStart] = useState<number>(1)
  const [newPressHoleEnd, setNewPressHoleEnd] = useState<number>(18)
  const [newPressAmount, setNewPressAmount] = useState('')
  const [pressPopoverInfo, setPressPopoverInfo] = useState<{ press: PressEntry; p1Name: string; p2Name: string; pressLabel: string } | null>(null)

  const addBBRef = useRef<HTMLDivElement>(null)
  const [bbT1P1, setBbT1P1] = useState('')
  const [bbT1P2, setBbT1P2] = useState('')
  const [bbT2P1, setBbT2P1] = useState('')
  const [bbT2P2, setBbT2P2] = useState('')
  const [bbBetType, setBbBetType] = useState<BetType | ''>('')
  const [bbBetAmount, setBbBetAmount] = useState('')
  const [bbFrontAmount, setBbFrontAmount] = useState('')
  const [bbBackAmount, setBbBackAmount] = useState('')
  const [bbTotalAmount, setBbTotalAmount] = useState('')
  const [bbScoringType, setBbScoringType] = useState<ScoringType>('stroke')
  const [bbSweepEnabled, setBbSweepEnabled] = useState(false)
  const [bbSweepAmount, setBbSweepAmount] = useState('')
  const [bbStrokesEnabled, setBbStrokesEnabled] = useState(false)
  const [bbStrokesSide, setBbStrokesSide] = useState<'t1' | 't2'>('t1')
  const [bbStrokesFront, setBbStrokesFront] = useState('')
  const [bbStrokesBack, setBbStrokesBack] = useState('')
  const [bbStrokesTotal, setBbStrokesTotal] = useState('')
  const [savingBB, setSavingBB] = useState(false)

  const editBBRef = useRef<HTMLDivElement>(null)
  const [editingBB, setEditingBB] = useState<string | null>(null)
  const [editBBBetType, setEditBBBetType] = useState<BetType | ''>('')
  const [editBBBetAmount, setEditBBBetAmount] = useState('')
  const [editBBScoringType, setEditBBScoringType] = useState<ScoringType>('stroke')
  const [editBBSweepEnabled, setEditBBSweepEnabled] = useState(false)
  const [editBBSweepAmount, setEditBBSweepAmount] = useState('')
  const [editBBStrokesEnabled, setEditBBStrokesEnabled] = useState(false)
  const [editBBStrokesSide, setEditBBStrokesSide] = useState<'t1' | 't2'>('t1')
  const [editBBStrokesFront, setEditBBStrokesFront] = useState('')
  const [editBBStrokesBack, setEditBBStrokesBack] = useState('')
  const [editBBStrokesTotal, setEditBBStrokesTotal] = useState('')
  const [editBBFrontAmount, setEditBBFrontAmount] = useState('')
  const [editBBBackAmount, setEditBBBackAmount] = useState('')
  const [editBBTotalAmount, setEditBBTotalAmount] = useState('')
  const [editBBPresses, setEditBBPresses] = useState<PressEntry[]>([])
  const [bbPressEnabled, setBBPressEnabled] = useState(false)

  const [showScorecardFor, setShowScorecardFor] = useState<ScorecardTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchWrapperRef = useRef<HTMLDivElement>(null)
  const [fixedSearch, setFixedSearch] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [showH2HForm, setShowH2HForm] = useState(false)
  const [showBBForm, setShowBBForm] = useState(false)
  const [showPayouts, setShowPayouts] = useState(false)
  const [showNetPositions, setShowNetPositions] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string; type: 'h2h' | 'bb' } | null>(null)
  const [showDuplicateAlert, setShowDuplicateAlert] = useState(false)
  const [strokesPopover, setStrokesPopover] = useState<{ recipientName: string; front: number; back: number; total: number } | null>(null)

  function captureSearchPos() {
    if (searchWrapperRef.current && !fixedSearch) {
      const rect = searchWrapperRef.current.getBoundingClientRect()
      setFixedSearch({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }
  }

  useEffect(() => {
    if (!searchQuery) setFixedSearch(null)
  }, [searchQuery])

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
        const { data } = await supabase.from('matchups').select('id, player1_id, player2_id, bet, press').eq('round_id', roundId).order('created_at')
        if (data) setMatchups(data)
      }).subscribe()
    const ch3 = supabase.channel('matchup-bestball')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'best_ball_matchups' }, async () => {
        const { data } = await supabase.from('best_ball_matchups')
          .select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet, press')
          .eq('round_id', roundId).order('created_at')
        if (data) setBestBallMatchups(data.map((m) => ({ ...m, press: m.press ?? [] })))
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
    const isDuplicateH2H = matchups.some((m) => {
      const samePlayers = (m.player1_id === newP1 && m.player2_id === newP2) || (m.player1_id === newP2 && m.player2_id === newP1)
      return samePlayers && parseBet(m.bet).scoringType === newScoringType
    })
    if (isDuplicateH2H) { setShowDuplicateAlert(true); return }
    setSavingH2H(true)
    const amtStr = newBetType === 'nassau'
      ? `${newBetAmount.trim() || '0'}|${newBetAmount.trim() || '0'}|${newBetAmount.trim() || '0'}`
      : newBetAmount
    const bet = composeBet(newBetType, amtStr, newScoringType,
      newSweepEnabled ? newSweepAmount : '',
      newScoringType === 'stroke' && newStrokesEnabled ? newStrokesSide : '',
      newScoringType === 'stroke' && newStrokesEnabled ? newStrokesFront : '',
      newScoringType === 'stroke' && newStrokesEnabled ? newStrokesBack : '',
      newScoringType === 'stroke' && newStrokesEnabled ? newStrokesTotal : '',
    )
    const result = await saveMatchup(roundId, newP1, newP2, bet)
    if (!result.error && result.id) {
      setMatchups((prev) => [...prev, { id: result.id!, player1_id: newP1, player2_id: newP2, bet, press: [] }])
      setNewP1(''); setNewP2(''); setNewBetAmount(''); setNewFrontAmount(''); setNewBackAmount(''); setNewTotalAmount('')
      setNewSweepAmount(''); setNewSweepEnabled(false)
      setNewStrokesEnabled(false); setNewStrokesFront(''); setNewStrokesBack(''); setNewStrokesTotal('')
      setShowH2HForm(false)
    }
    setSavingH2H(false)
  }

  async function handleDeleteH2H(id: string) {
    setMatchups((prev) => prev.filter((m) => m.id !== id))
    await deleteMatchup(id)
  }


  async function handleSaveH2HBet(id: string) {
    const amtStr = editH2HBetType === 'nassau'
      ? `${editH2HFrontAmount.trim() || '0'}|${editH2HBackAmount.trim() || '0'}|${editH2HTotalAmount.trim() || '0'}`
      : editH2HBetAmount
    const bet = composeBet(editH2HBetType, amtStr, editH2HScoringType,
      editH2HSweepEnabled ? editH2HSweepAmount : '',
      editH2HScoringType === 'stroke' && editH2HStrokesEnabled ? editH2HStrokesSide : '',
      editH2HScoringType === 'stroke' && editH2HStrokesEnabled ? editH2HStrokesFront : '',
      editH2HScoringType === 'stroke' && editH2HStrokesEnabled ? editH2HStrokesBack : '',
      editH2HScoringType === 'stroke' && editH2HStrokesEnabled ? editH2HStrokesTotal : '',
    )
    const savedPresses = editH2HPresses
    setMatchups((prev) => prev.map((m) => m.id === id ? { ...m, bet, press: savedPresses } : m))
    setEditingH2H(null)
    setPressEnabled(false)
    await Promise.all([updateMatchupBet(id, bet), updateMatchupPresses(id, savedPresses)])
  }

  async function handleCreateBB() {
    const ids = [bbT1P1, bbT1P2, bbT2P1, bbT2P2]
    if (ids.some((id) => !id) || new Set(ids).size !== 4 || !bbBetType || !bbBetAmount.trim()) return
    const newSet = new Set(ids)
    const isDuplicateBB = bestBallMatchups.some((m) => {
      const ex = new Set([m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id])
      const samePlayers = ex.size === newSet.size && [...newSet].every((id) => ex.has(id))
      return samePlayers && parseBet(m.bet).scoringType === bbScoringType
    })
    if (isDuplicateBB) { setShowDuplicateAlert(true); return }
    setSavingBB(true)
    const bbAmtStr = bbBetType === 'nassau'
      ? `${bbBetAmount.trim() || '0'}|${bbBetAmount.trim() || '0'}|${bbBetAmount.trim() || '0'}`
      : bbBetAmount
    const bet = composeBet(bbBetType, bbAmtStr, bbScoringType,
      bbSweepEnabled ? bbSweepAmount : '',
      bbScoringType === 'stroke' && bbStrokesEnabled ? bbStrokesSide : '',
      bbScoringType === 'stroke' && bbStrokesEnabled ? bbStrokesFront : '',
      bbScoringType === 'stroke' && bbStrokesEnabled ? bbStrokesBack : '',
      bbScoringType === 'stroke' && bbStrokesEnabled ? bbStrokesTotal : '',
    )
    const result = await saveBestBallMatchup(roundId, bbT1P1, bbT1P2, bbT2P1, bbT2P2, bet)
    if (!result.error && result.id) {
      setBestBallMatchups((prev) => [...prev, {
        id: result.id!, team1_player1_id: bbT1P1, team1_player2_id: bbT1P2,
        team2_player1_id: bbT2P1, team2_player2_id: bbT2P2, bet, press: [],
      }])
      setBbT1P1(''); setBbT1P2(''); setBbT2P1(''); setBbT2P2(''); setBbBetAmount('')
      setBbFrontAmount(''); setBbBackAmount(''); setBbTotalAmount('')
      setBbSweepAmount(''); setBbSweepEnabled(false)
      setBbStrokesEnabled(false); setBbStrokesFront(''); setBbStrokesBack(''); setBbStrokesTotal('')
      setShowBBForm(false)
    }
    setSavingBB(false)
  }

  async function handleDeleteBB(id: string) {
    setBestBallMatchups((prev) => prev.filter((m) => m.id !== id))
    await deleteBestBallMatchup(id)
  }

  async function handleSaveBBBet(id: string) {
    const amtStr = editBBBetType === 'nassau'
      ? `${editBBFrontAmount.trim() || '0'}|${editBBBackAmount.trim() || '0'}|${editBBTotalAmount.trim() || '0'}`
      : editBBBetAmount
    const bet = composeBet(editBBBetType, amtStr, editBBScoringType,
      editBBSweepEnabled ? editBBSweepAmount : '',
      editBBScoringType === 'stroke' && editBBStrokesEnabled ? editBBStrokesSide : '',
      editBBScoringType === 'stroke' && editBBStrokesEnabled ? editBBStrokesFront : '',
      editBBScoringType === 'stroke' && editBBStrokesEnabled ? editBBStrokesBack : '',
      editBBScoringType === 'stroke' && editBBStrokesEnabled ? editBBStrokesTotal : '',
    )
    const savedBBPresses = editBBPresses
    setBestBallMatchups((prev) => prev.map((m) => m.id === id ? { ...m, bet, press: savedBBPresses } : m))
    setEditingBB(null)
    setBBPressEnabled(false)
    await Promise.all([updateBestBallBet(id, bet), updateBestBallPresses(id, savedBBPresses)])
  }

  const searchLower = searchQuery.toLowerCase().trim()
  const bbSelected = [bbT1P1, bbT1P2, bbT2P1, bbT2P2].filter(Boolean)
  const isComplete = holes.length > 0 && players.every((p) => Object.keys(scoreMap[p.id] ?? {}).length >= holes.length)

  const payouts = useMemo(
    () => computeMatchupPayouts(matchups, bestBallMatchups, players, scoreMap, holes),
    [matchups, bestBallMatchups, players, scoreMap, holes]
  )

  // Filter payout rows by the current search query so search drives Matchup Results too.
  const filteredPayoutRows = searchLower
    ? payouts.rows.filter((row) => {
        const h2h = matchups.find((m) => m.id === row.id)
        if (h2h) {
          const mp1 = players.find((p) => p.id === h2h.player1_id)
          const mp2 = players.find((p) => p.id === h2h.player2_id)
          return mp1?.name.toLowerCase().includes(searchLower) || mp2?.name.toLowerCase().includes(searchLower)
        }
        const bb = bestBallMatchups.find((m) => m.id === row.id)
        if (bb) {
          const ids = [bb.team1_player1_id, bb.team1_player2_id, bb.team2_player1_id, bb.team2_player2_id]
          return ids.some((id) => players.find((p) => p.id === id)?.name.toLowerCase().includes(searchLower))
        }
        return false
      })
    : payouts.rows

  useEffect(() => {
    const locked = showOptions || !!confirmDelete || !!strokesPopover || !!pressPopoverInfo || showDuplicateAlert || !!showScorecardFor || showPinLogin
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [showOptions, confirmDelete, strokesPopover, pressPopoverInfo, showDuplicateAlert, showScorecardFor, showPinLogin])

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>

      {showOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowOptions(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Options</h2>
              <button onClick={() => setShowOptions(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              {isAdmin
                ? <a href={`/${orgSlug}/admin/dashboard`} className="w-full text-center py-3 rounded-xl font-semibold text-sm" style={{ background: navy, color: 'white' }}>Admin Hub</a>
                : <a href={`/${orgSlug}/admin`} className="w-full text-center py-3 rounded-xl font-semibold text-sm" style={{ background: navy, color: 'white' }}>Admin Login</a>
              }
              {effectiveScorerId ? (
                <a href={enterScoresHref} className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: navy, color: navy }}>
                  Enter Scores
                </a>
              ) : (
                <button
                  onClick={() => { setShowOptions(false); setShowPinLogin(true) }}
                  className="w-full text-center py-3 rounded-xl font-semibold text-sm border"
                  style={{ borderColor: navy, color: navy }}>
                  {isMixedGroups ? 'Log In as Scorer (Group PIN)' : 'Log In as Scorer'}
                </button>
              )}
              {isMaster && <a href="/master/dashboard" className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: '#f59e0b', color: '#92400e', background: '#fffbeb' }}>← Master Admin</a>}
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

      {showPinLogin && (
        <PinLoginModal
          teams={isMixedGroups ? [] : teams}
          playingGroups={isMixedGroups ? playingGroups : undefined}
          orgSlug={orgSlug}
          onClose={() => setShowPinLogin(false)}
        />
      )}

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

      {/* ── Strokes Info Popover ── */}
      {strokesPopover && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setStrokesPopover(null)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900 text-base">Handicap Strokes</h3>
              <button onClick={() => setStrokesPopover(null)} className="text-gray-400 text-xl font-bold leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              <span className="font-semibold text-gray-800">{strokesPopover.recipientName}</span> is receiving:
            </p>
            <div className="flex gap-4 justify-center">
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-0.5">Front</p>
                <p className="text-xl font-bold" style={{ color: gold }}>+{strokesPopover.front}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-0.5">Back</p>
                <p className="text-xl font-bold" style={{ color: gold }}>+{strokesPopover.back}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-0.5">Overall</p>
                <p className="text-xl font-bold" style={{ color: gold }}>+{strokesPopover.total}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Press Info Popover ── */}
      {pressPopoverInfo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setPressPopoverInfo(null)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900 text-base">{pressPopoverInfo.pressLabel}</h3>
              <button onClick={() => setPressPopoverInfo(null)} className="text-gray-400 text-xl font-bold leading-none">×</button>
            </div>
            <div className="space-y-1.5 text-sm text-gray-700">
              <div className="flex justify-between">
                <span className="text-gray-500">Holes</span>
                <span className="font-semibold">
                  {pressPopoverInfo.press.holeStart === pressPopoverInfo.press.holeEnd
                    ? `Hole ${pressPopoverInfo.press.holeStart}`
                    : `Holes ${pressPopoverInfo.press.holeStart}–${pressPopoverInfo.press.holeEnd}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount</span>
                <span className="font-semibold" style={{ color: gold }}>${pressPopoverInfo.press.amount}</span>
              </div>
              {pressPopoverInfo.press.strokesSide && (pressPopoverInfo.press.strokes ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Strokes</span>
                  <span className="font-semibold">
                    {pressPopoverInfo.press.strokesSide === 'p1' ? pressPopoverInfo.p1Name : pressPopoverInfo.p2Name} gets +{pressPopoverInfo.press.strokes}
                  </span>
                </div>
              )}
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
          <div className="bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto" style={{ animation: 'slideUp 0.28s ease-out', boxShadow: '0 0 0 2px rgba(255,255,255,0.3)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-4 sticky top-0" style={{ background: navy, borderBottom: '1px solid rgba(255,255,255,0.35)' }}>
              <h3 className="font-bold text-white text-base">
                {showScorecardFor.type === 'player' ? showScorecardFor.name
                  : showScorecardFor.type === 'h2h' ? `${showScorecardFor.p1Name} vs ${showScorecardFor.p2Name}`
                  : showScorecardFor.type === 'bb-scorecards' ? `${showScorecardFor.t1Name} vs ${showScorecardFor.t2Name}`
                  : showScorecardFor.teamName}
              </h3>
              <button onClick={() => setShowScorecardFor(null)}
                className="text-2xl font-bold leading-none" style={{ color: gold }}>×</button>
            </div>
            <div className="px-4 py-4 overflow-x-auto">
              {showScorecardFor.type === 'player' ? (
                <HorizontalScorecardTable
                  rows={[{ label: 'Score', scoreMap: scoreMap[showScorecardFor.id] ?? {} }]}
                  holes={holes}
                />
              ) : showScorecardFor.type === 'h2h' ? (() => {
                const target = showScorecardFor
                const hcpInfo = target.scoringType === 'stroke' && target.handicapSide && (target.handicapFront > 0 || target.handicapBack > 0 || target.handicapTotal > 0)
                  ? { front: target.handicapFront, back: target.handicapBack, total: target.handicapTotal }
                  : null
                const strokesInfo = [
                  target.handicapSide === 'p1' ? hcpInfo : null,
                  target.handicapSide === 'p2' ? hcpInfo : null,
                ]
                const isOverall = target.betType === 'straight'
                const fmtV = (n: number | null) => n === null ? '–' : n === 0 ? 'E' : n > 0 ? `+${n}` : String(n)
                const fmtHcp = (h: number | null | undefined) => h == null ? null : h < 0 ? `+${Math.abs(h) % 1 === 0 ? Math.abs(h) : Math.abs(h).toFixed(1)}` : `${h % 1 === 0 ? h : Number(h).toFixed(1)}`
                const vpColor = (n: number | null) => n === null ? 'rgba(255,255,255,0.55)' : n < 0 ? '#f87171' : n > 0 ? '#fbbf24' : 'rgba(255,255,255,0.8)'
                const playerBars = [
                  { id: target.p1Id, name: target.p1Name, handicap: target.p1Handicap },
                  { id: target.p2Id, name: target.p2Name, handicap: target.p2Handicap },
                ]
                return (
                  <>
                    <div className="space-y-1 mb-3">
                      {playerBars.map(({ id, name, handicap }) => {
                        const sm = scoreMap[id] ?? {}
                        const fNine = holes.filter((h) => h.hole_number <= 9)
                        const bNine = holes.filter((h) => h.hole_number > 9)
                        const fScored = fNine.filter((h) => sm[h.hole_number] != null)
                        const bScored = bNine.filter((h) => sm[h.hole_number] != null)
                        const fVsp = fScored.length > 0 ? fScored.reduce((s, h) => s + sm[h.hole_number]! - h.par, 0) : null
                        const bVsp = bScored.length > 0 ? bScored.reduce((s, h) => s + sm[h.hole_number]! - h.par, 0) : null
                        const tVsp = fVsp !== null || bVsp !== null ? (fVsp ?? 0) + (bVsp ?? 0) : null
                        return (
                          <div key={id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: navy }}>
                            <span className="flex-1 min-w-0 font-bold text-white text-sm truncate">{name}</span>
                            {fmtHcp(handicap) && (
                              <span className="text-[10px] font-semibold ml-1 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }}>
                                HCP {fmtHcp(handicap)}
                              </span>
                            )}
                            <div className="flex items-center gap-4 text-[10px] font-semibold flex-shrink-0" style={{ color: 'rgba(255,255,255,0.55)' }}>
                              {!isOverall && <span>Front: <span style={{ color: vpColor(fVsp) }}>{fmtV(fVsp)}</span></span>}
                              {!isOverall && <span>Back: <span style={{ color: vpColor(bVsp) }}>{fmtV(bVsp)}</span></span>}
                              <span>Total: <span style={{ color: vpColor(tVsp) }}>{fmtV(tVsp)}</span></span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  <HorizontalScorecardTable
                    rows={[
                      { label: target.p1Name, scoreMap: scoreMap[target.p1Id] ?? {} },
                      { label: target.p2Name, scoreMap: scoreMap[target.p2Id] ?? {} },
                    ]}
                    holes={holes}
                    showMatchPlay={target.scoringType === 'match'}
                    betType={target.betType}
                    strokesInfo={strokesInfo}
                    onStrokesClick={setStrokesPopover}
                  />
                  </>
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
                const bbHcpInfo = target.scoringType === 'stroke' && target.handicapSide && (target.handicapFront > 0 || target.handicapBack > 0 || target.handicapTotal > 0)
                  ? { front: target.handicapFront, back: target.handicapBack, total: target.handicapTotal }
                  : null
                const bbStrokesInfo = [
                  target.handicapSide === 't1' ? bbHcpInfo : null,
                  target.handicapSide === 't2' ? bbHcpInfo : null,
                ]
                return (
                  <HorizontalScorecardTable
                    rows={[
                      { label: target.t1Name, scoreMap: t1Map },
                      { label: target.t2Name, scoreMap: t2Map },
                    ]}
                    holes={holes}
                    showMatchPlay={target.scoringType === 'match'}
                    betType={target.betType}
                    strokesInfo={bbStrokesInfo}
                    onStrokesClick={setStrokesPopover}
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

      <header className="text-white px-4 pb-4 shadow-md sticky top-0 z-10" style={{ background: navy, paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-[72px] h-[72px] flex-shrink-0 rounded-3xl overflow-hidden -my-1">
              <img src="/abg-logo.jpg" alt="ABG" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide leading-tight" style={{ color: gold }}>Matchups</p>
              <h1 className="font-bold text-lg leading-tight">{roundName}</h1>
{(isAdmin || effectiveScorerId) && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {isAdmin && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>Admin</span>}
                  {effectiveScorerId && <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>Scorer</span>}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-1.5 flex-shrink-0 ml-3">
            <a href={`/${orgSlug}`} className="text-xs px-3 py-1.5 rounded-lg font-semibold text-center" style={{ background: gold, color: navy }}>Leaderboard</a>
            <button onClick={() => setShowOptions(true)}
              className="text-xs px-3 py-1.5 rounded-lg border font-medium text-white text-center"
              style={{ borderColor: 'rgba(255,255,255,0.5)' }}>
              Options
            </button>
          </div>
        </div>
      </header>

      {/* Full-width opaque backdrop behind fixed search bar — covers from viewport top to search bar bottom so nothing bleeds through the gap */}
      {fixedSearch && searchQuery && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: fixedSearch.top + fixedSearch.height, background: '#f8fafc', zIndex: 8 }} />
      )}

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">

        {/* ── Search ── */}
        <div ref={searchWrapperRef} style={fixedSearch && searchQuery ? { height: fixedSearch.height } : undefined}>
          <div
            className="relative"
            style={fixedSearch && searchQuery ? { position: 'fixed', top: fixedSearch.top, left: fixedSearch.left, width: fixedSearch.width, zIndex: 9 } : undefined}
          >
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search by player name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={captureSearchPos}
              className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-1 text-xs sm:py-1.5 sm:text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>
        </div>

        {/* ── Head to Head ── */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Head to Head</p>
            {!showH2HForm && (
              <button onClick={() => { setShowH2HForm(true); setTimeout(() => addH2HRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }}
                className="text-sm font-semibold px-4 py-1.5 rounded-lg" style={{ background: navy, color: 'white' }}>+ Add</button>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {showH2HForm && (
              <div className="px-4 pt-3 pb-3 border-b border-gray-100">
                <div ref={addH2HRef} className="space-y-3 bg-gray-50 rounded-xl p-3 border border-gray-200">

                  {/* Players */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Player 1</label>
                      <select value={newP1} onChange={(e) => { setNewP1(e.target.value); if (e.target.value === newP2) setNewP2('') }}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                        <option value="">Select…</option>
                        {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === newP2}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Player 2</label>
                      <select value={newP2} onChange={(e) => setNewP2(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                        <option value="">Select…</option>
                        {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === newP1}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Scoring */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Scoring</label>
                    <select value={newScoringType} onChange={(e) => setNewScoringType(e.target.value as ScoringType)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="stroke">Stroke Play</option>
                      <option value="match">Match Play</option>
                    </select>
                  </div>

                  {/* Bet Type + Amount + Sweep — all on one row */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Bet Type <span className="text-red-400">*</span></label>
                      <select value={newBetType} onChange={(e) => { setNewBetType(e.target.value as BetType | ''); if (e.target.value !== 'nassau') { setNewSweepEnabled(false); setNewSweepAmount('') } }}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                        <option value="" disabled>Select…</option>
                        <option value="nassau">Nassau</option>
                        <option value="straight">Overall</option>
                      </select>
                    </div>
                    {newBetType && (
                      <div className="w-16 flex-shrink-0">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Amt ($)</label>
                        <input type="number" min="0" step="1" placeholder="0"
                          value={newBetAmount} onChange={(e) => setNewBetAmount(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                      </div>
                    )}
                    {newBetType === 'nassau' && (
                      <div className="flex-shrink-0 flex flex-col">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Sweep</label>
                        <div className="flex items-center gap-1.5 h-[38px]">
                          <input type="checkbox" checked={newSweepEnabled} onChange={(e) => { setNewSweepEnabled(e.target.checked); if (!e.target.checked) setNewSweepAmount('') }} className="rounded" />
                          {newSweepEnabled && (
                            <input type="number" min="0" step="1" placeholder="0"
                              value={newSweepAmount} onChange={(e) => setNewSweepAmount(e.target.value)}
                              className="w-14 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Handicap Strokes */}
                  {newScoringType === 'stroke' && newBetType && (
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={newStrokesEnabled} onChange={(e) => { setNewStrokesEnabled(e.target.checked); if (!e.target.checked) { setNewStrokesFront(''); setNewStrokesBack(''); setNewStrokesTotal('') } }} className="rounded" />
                        Handicap Strokes
                      </label>
                      {newStrokesEnabled && (
                        <div className="pl-3 border-l-2 border-gray-200 ml-1 mt-2 space-y-2">
                          <select value={newStrokesSide} onChange={(e) => setNewStrokesSide(e.target.value as 'p1' | 'p2')}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none">
                            <option value="p1">{newP1 ? (players.find((p) => p.id === newP1)?.name.split(' ')[0] ?? 'Player 1') : 'Player 1'} gets strokes</option>
                            <option value="p2">{newP2 ? (players.find((p) => p.id === newP2)?.name.split(' ')[0] ?? 'Player 2') : 'Player 2'} gets strokes</option>
                          </select>
                          {newBetType === 'nassau' ? (
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Front</label>
                                <input type="number" min="0" step="0.5" placeholder="0" value={newStrokesFront} onChange={(e) => setNewStrokesFront(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Back</label>
                                <input type="number" min="0" step="0.5" placeholder="0" value={newStrokesBack} onChange={(e) => setNewStrokesBack(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Total</label>
                                <input type="number" min="0" step="0.5" placeholder="0" value={newStrokesTotal} onChange={(e) => setNewStrokesTotal(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs font-medium text-gray-400 mb-1">Overall</label>
                              <input type="number" min="0" step="0.5" placeholder="0" value={newStrokesTotal} onChange={(e) => setNewStrokesTotal(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Save / Cancel */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                    <button onClick={() => { setShowH2HForm(false); setNewP1(''); setNewP2(''); setNewBetType(''); setNewBetAmount(''); setNewFrontAmount(''); setNewBackAmount(''); setNewTotalAmount(''); setNewSweepEnabled(false); setNewSweepAmount(''); setNewStrokesEnabled(false); setNewStrokesFront(''); setNewStrokesBack(''); setNewStrokesTotal('') }}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 bg-white">Cancel</button>
                    <button onClick={handleCreateH2H}
                      disabled={!newP1 || !newP2 || newP1 === newP2 || !newBetType || !newBetAmount.trim() || savingH2H}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                      style={{ background: navy, color: 'white' }}>
                      {savingH2H ? 'Saving…' : 'Save'}
                    </button>
                  </div>

                </div>
              </div>
            )}

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
                    const { scoringType: h2hScoringType, betType: h2hBetType, handicapSide: h2hHcpSide, handicapFront: h2hHcpFront, handicapBack: h2hHcpBack, handicapTotal: h2hHcpTotal } = parseBet(m.bet)
                    const isMatchPlay = h2hScoringType === 'match'
                    const isOverallBet = h2hBetType === 'straight'
                    // Handicap-adjusted win indicators (stroke play only)
                    const listHf = !isMatchPlay ? (parseFloat(h2hHcpFront) || 0) : 0
                    const listHb = !isMatchPlay ? (parseFloat(h2hHcpBack) || 0) : 0
                    const listHt = !isMatchPlay ? (parseFloat(h2hHcpTotal) || 0) : 0
                    const listAdjP1Front = stats.p1Front !== null ? stats.p1Front - (h2hHcpSide === 'p1' ? listHf : 0) : null
                    const listAdjP2Front = stats.p2Front !== null ? stats.p2Front - (h2hHcpSide === 'p2' ? listHf : 0) : null
                    const listAdjP1Back  = stats.p1Back  !== null ? stats.p1Back  - (h2hHcpSide === 'p1' ? listHb : 0) : null
                    const listAdjP2Back  = stats.p2Back  !== null ? stats.p2Back  - (h2hHcpSide === 'p2' ? listHb : 0) : null
                    const listAdjP1Total = stats.p1Total !== null ? stats.p1Total - (h2hHcpSide === 'p1' ? listHt : 0) : null
                    const listAdjP2Total = stats.p2Total !== null ? stats.p2Total - (h2hHcpSide === 'p2' ? listHt : 0) : null
                    const p1WinsFront = listAdjP1Front !== null && listAdjP2Front !== null && listAdjP1Front < listAdjP2Front
                    const p2WinsFront = listAdjP1Front !== null && listAdjP2Front !== null && listAdjP2Front < listAdjP1Front
                    const p1WinsBack = listAdjP1Back !== null && listAdjP2Back !== null && listAdjP1Back < listAdjP2Back
                    const p2WinsBack = listAdjP1Back !== null && listAdjP2Back !== null && listAdjP2Back < listAdjP1Back
                    const p1WinsTotal = listAdjP1Total !== null && listAdjP2Total !== null && listAdjP1Total < listAdjP2Total
                    const p2WinsTotal = listAdjP1Total !== null && listAdjP2Total !== null && listAdjP2Total < listAdjP1Total
                    // Press results (one per press entry)
                    const pressResults = (m.press ?? []).map(pr => computePressResult(m.player1_id, m.player2_id, scoreMap, holes, pr))

                    return (
                      <div key={m.id}>
                        <div className="px-4 py-3">
                          {/* Bet + status + controls row */}
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                            {!isEditing && (
                              <span className="flex items-center gap-1.5">
                                {m.bet
                                  ? <span className="font-medium whitespace-nowrap" style={{ color: gold, fontSize: 'clamp(9px, 2.3vw, 11px)' }}>Bet: {formatBet(m.bet)}</span>
                                  : <span className="text-gray-300 text-[11px]">No bet</span>}
                                <button onClick={() => { setEditingH2H(m.id); const p = parseBet(m.bet); setEditH2HBetType(p.betType); setEditH2HBetAmount(p.betType === 'nassau' ? '' : p.amount); setEditH2HScoringType(p.scoringType); setEditH2HSweepAmount(p.sweepAmount); setEditH2HSweepEnabled(!!p.sweepAmount); setEditH2HStrokesEnabled(!!p.handicapSide); setEditH2HStrokesSide((p.handicapSide as 'p1' | 'p2') || 'p1'); setEditH2HStrokesFront(p.handicapFront); setEditH2HStrokesBack(p.handicapBack); setEditH2HStrokesTotal(p.handicapTotal); setEditH2HFrontAmount(p.betType === 'nassau' ? String(p.frontAmount || '') : ''); setEditH2HBackAmount(p.betType === 'nassau' ? String(p.backAmount || '') : ''); setEditH2HTotalAmount(p.betType === 'nassau' ? String(p.totalAmount || '') : ''); setEditH2HPresses(m.press ?? []); setPressEnabled(false); setNewPressAmount(''); setNewPressStrokes(''); setNewPressStrokesEnabled(false); setNewPressHoleType('1hole'); setNewPressHoleStart(1); setNewPressHoleEnd(18); setTimeout(() => { const el = editH2HRef.current; if (el) { const top = el.getBoundingClientRect().top + window.scrollY - 70; window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }) } }, 50) }}
                                  className="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors touch-manipulation" style={{ fontSize: '1rem' }}>✎</button>
                              </span>
                            )}
                            <button
                              onClick={() => setShowScorecardFor({ type: 'h2h', p1Id: m.player1_id, p2Id: m.player2_id, p1Name: p1First, p2Name: p2First, p1Handicap: mp1.handicap ?? null, p2Handicap: mp2.handicap ?? null, scoringType: h2hScoringType, betType: h2hBetType, handicapSide: h2hHcpSide, handicapFront: listHf, handicapBack: listHb, handicapTotal: listHt })}
                              className="text-xs font-medium px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400 transition">
                              Scorecards
                            </button>
                            <span className="flex-1" />
                            <button onClick={() => setConfirmDelete({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, type: 'h2h' })} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                          </div>

                          {/* Edit form — shown below the controls row when editing */}
                          {isEditing && (
                            <div ref={editH2HRef} className="space-y-3 mb-3 bg-gray-50 rounded-xl p-3 border border-gray-200 [&_input]:text-base [&_select]:text-base">
                              {/* Bet type label (static) */}
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-500">Bet:</span>
                                <span className="text-xs font-semibold text-gray-800">
                                  {editH2HBetType === 'nassau' ? 'Nassau' : editH2HBetType === 'straight' ? 'Overall' : 'No bet'}
                                </span>
                              </div>

                              {/* Amount inputs */}
                              {editH2HBetType === 'nassau' && (
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Front ($)</label>
                                    <input autoFocus type="number" min="0" step="1" placeholder="0"
                                      value={editH2HFrontAmount} onChange={(e) => setEditH2HFrontAmount(e.target.value)}
                                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Back ($)</label>
                                    <input type="number" min="0" step="1" placeholder="0"
                                      value={editH2HBackAmount} onChange={(e) => setEditH2HBackAmount(e.target.value)}
                                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Total ($)</label>
                                    <input type="number" min="0" step="1" placeholder="0"
                                      value={editH2HTotalAmount} onChange={(e) => setEditH2HTotalAmount(e.target.value)}
                                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                  </div>
                                </div>
                              )}
                              {editH2HBetType === 'straight' && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount ($)</label>
                                  <input autoFocus type="number" min="0" step="1" placeholder="0"
                                    value={editH2HBetAmount} onChange={(e) => setEditH2HBetAmount(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                </div>
                              )}

                              {/* Sweep row (Nassau only) */}
                              {editH2HBetType === 'nassau' && (
                                <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                                    <input type="checkbox" checked={editH2HSweepEnabled} onChange={(e) => { setEditH2HSweepEnabled(e.target.checked); if (!e.target.checked) setEditH2HSweepAmount('') }} className="rounded" />
                                    Sweep ($)
                                  </label>
                                  {editH2HSweepEnabled && (
                                    <input type="number" min="0" step="1" placeholder="sweep amt"
                                      value={editH2HSweepAmount} onChange={(e) => setEditH2HSweepAmount(e.target.value)}
                                      className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none w-28" />
                                  )}
                                </div>
                              )}

                              {/* Handicap Strokes row */}
                              {editH2HScoringType === 'stroke' && editH2HBetType && (
                                <div>
                                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer mb-2">
                                    <input type="checkbox" checked={editH2HStrokesEnabled} onChange={(e) => { setEditH2HStrokesEnabled(e.target.checked); if (!e.target.checked) { setEditH2HStrokesFront(''); setEditH2HStrokesBack(''); setEditH2HStrokesTotal('') } }} className="rounded" />
                                    Handicap Strokes
                                  </label>
                                  {editH2HStrokesEnabled && (
                                    <div className="pl-3 border-l-2 border-gray-200 space-y-2">
                                      <select value={editH2HStrokesSide} onChange={(e) => setEditH2HStrokesSide(e.target.value as 'p1' | 'p2')}
                                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                                        <option value="p1">{mp1.name.split(' ')[0]} gets strokes</option>
                                        <option value="p2">{mp2.name.split(' ')[0]} gets strokes</option>
                                      </select>
                                      {editH2HBetType === 'nassau' ? (
                                        <div className="grid grid-cols-3 gap-2">
                                          <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Front</label>
                                            <input type="number" min="0" step="0.5" placeholder="0"
                                              value={editH2HStrokesFront} onChange={(e) => setEditH2HStrokesFront(e.target.value)}
                                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                          </div>
                                          <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Back</label>
                                            <input type="number" min="0" step="0.5" placeholder="0"
                                              value={editH2HStrokesBack} onChange={(e) => setEditH2HStrokesBack(e.target.value)}
                                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                          </div>
                                          <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Total</label>
                                            <input type="number" min="0" step="0.5" placeholder="0"
                                              value={editH2HStrokesTotal} onChange={(e) => setEditH2HStrokesTotal(e.target.value)}
                                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                          </div>
                                        </div>
                                      ) : (
                                        <div>
                                          <label className="block text-xs font-medium text-gray-500 mb-1">Overall</label>
                                          <input type="number" min="0" step="0.5" placeholder="0"
                                            value={editH2HStrokesTotal} onChange={(e) => setEditH2HStrokesTotal(e.target.value)}
                                            className="w-32 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Press section */}
                              <div className="border-t border-gray-100 pt-2.5 space-y-2">
                                {editH2HPresses.length > 0 && (
                                  <div className="flex flex-col gap-0.5">
                                    {editH2HPresses.map((pr, pi) => {
                                      const hl = pr.holeStart === pr.holeEnd ? `H${pr.holeStart}` : `H${pr.holeStart}–${pr.holeEnd}`
                                      const sl = pr.strokesSide && (pr.strokes ?? 0) > 0
                                        ? ` · ${pr.strokesSide === 'p1' ? mp1.name.split(' ')[0] : mp2.name.split(' ')[0]} +${pr.strokes}`
                                        : ''
                                      return (
                                        <div key={pr.id} className="flex items-center gap-1.5 text-xs">
                                          <span className="font-semibold" style={{ color: gold }}>Press {pi + 1}:</span>
                                          <span className="text-gray-600">{hl} · ${pr.amount}{sl}</span>
                                          <button onClick={() => setEditH2HPresses(prev => prev.filter((_, i) => i !== pi))}
                                            className="text-gray-400 hover:text-red-500 ml-1 text-[11px]">✕</button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer w-fit">
                                  <input type="checkbox" checked={pressEnabled}
                                    onChange={(e) => { setPressEnabled(e.target.checked); if (!e.target.checked) { setNewPressAmount(''); setNewPressStrokes(''); setNewPressStrokesEnabled(false) } }}
                                    className="rounded" />
                                  Press
                                </label>
                                {pressEnabled && (
                                  <div className="flex items-center gap-1.5 flex-wrap pl-2 border-l-2 border-amber-300">
                                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                                      <input type="checkbox" checked={newPressStrokesEnabled}
                                        onChange={(e) => { setNewPressStrokesEnabled(e.target.checked); if (!e.target.checked) setNewPressStrokes('') }}
                                        className="rounded" />
                                      Strokes
                                    </label>
                                    {newPressStrokesEnabled && (
                                      <>
                                        <select value={newPressStrokesSide} onChange={(e) => setNewPressStrokesSide(e.target.value as 'p1' | 'p2')}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                          <option value="p1">{mp1.name.split(' ')[0]}</option>
                                          <option value="p2">{mp2.name.split(' ')[0]}</option>
                                        </select>
                                        <input type="number" min="0" step="0.5" placeholder="0" value={newPressStrokes}
                                          onChange={(e) => setNewPressStrokes(e.target.value)}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none w-12" />
                                      </>
                                    )}
                                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                                      <input type="radio" name={`pht-${m.id}`} checked={newPressHoleType === '1hole'}
                                        onChange={() => { setNewPressHoleType('1hole'); setNewPressHoleEnd(newPressHoleStart) }} />
                                      1 Hole
                                    </label>
                                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                                      <input type="radio" name={`pht-${m.id}`} checked={newPressHoleType === 'multihole'}
                                        onChange={() => setNewPressHoleType('multihole')} />
                                      Multi
                                    </label>
                                    {newPressHoleType === '1hole' && (
                                      <select value={newPressHoleStart}
                                        onChange={(e) => { const v = parseInt(e.target.value); setNewPressHoleStart(v); setNewPressHoleEnd(v) }}
                                        className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                        {Array.from({ length: 18 }, (_, i) => i + 1).map(n => (
                                          <option key={n} value={n}>Hole {n}</option>
                                        ))}
                                      </select>
                                    )}
                                    {newPressHoleType === 'multihole' && (
                                      <>
                                        <select value={newPressHoleStart}
                                          onChange={(e) => { const v = parseInt(e.target.value); setNewPressHoleStart(v); if (newPressHoleEnd < v) setNewPressHoleEnd(v) }}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                          {Array.from({ length: 18 }, (_, i) => i + 1).map(n => <option key={n} value={n}>H{n}</option>)}
                                        </select>
                                        <span className="text-xs text-gray-400">–</span>
                                        <select value={newPressHoleEnd}
                                          onChange={(e) => setNewPressHoleEnd(parseInt(e.target.value))}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                          {Array.from({ length: 18 }, (_, i) => i + 1).filter(n => n >= newPressHoleStart).map(n => <option key={n} value={n}>H{n}</option>)}
                                        </select>
                                      </>
                                    )}
                                    <input type="number" min="0" step="1" placeholder="$amt" value={newPressAmount}
                                      onChange={(e) => setNewPressAmount(e.target.value)}
                                      className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none w-16" />
                                    <button
                                      onClick={() => {
                                        const amt = parseFloat(newPressAmount)
                                        if (!newPressAmount.trim() || isNaN(amt) || amt <= 0) return
                                        const hEnd = newPressHoleType === '1hole' ? newPressHoleStart : Math.max(newPressHoleStart, newPressHoleEnd)
                                        const entry: PressEntry = {
                                          id: Math.random().toString(36).slice(2),
                                          holeStart: newPressHoleStart,
                                          holeEnd: hEnd,
                                          amount: amt,
                                          ...(newPressStrokesEnabled && newPressStrokes.trim() ? { strokesSide: newPressStrokesSide, strokes: parseFloat(newPressStrokes) || 0 } : {}),
                                        }
                                        setEditH2HPresses(prev => [...prev, entry])
                                        setNewPressAmount('')
                                        setNewPressStrokes('')
                                        setNewPressStrokesEnabled(false)
                                        setPressEnabled(false)
                                      }}
                                      disabled={!newPressAmount.trim() || !(parseFloat(newPressAmount) > 0)}
                                      className="text-xs font-semibold text-blue-600 disabled:opacity-40">
                                      + Add
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Save / Cancel */}
                              <div className="flex gap-2">
                                <button onClick={() => handleSaveH2HBet(m.id)}
                                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white"
                                  style={{ background: navy }}>
                                  Save
                                </button>
                                <button onClick={() => { setEditingH2H(null); setPressEnabled(false) }}
                                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-300 bg-white">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {/* summary table (5 columns + press columns) */}
                          <div className="rounded-lg border border-gray-300 overflow-hidden">
                            <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse">
                              <thead>
                                <tr style={{ background: navy }}>
                                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-white">Player</th>
                                  {!isOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Front</th>}
                                  {!isOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Back</th>}
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Total</th>
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Thru</th>
                                  {(m.press ?? []).map((pr, pi) => {
                                    const pLabel = (m.press ?? []).length === 1 ? 'Press' : `Press ${pi + 1}`
                                    return (
                                      <th key={pi} className="px-2 py-1.5 text-center text-xs font-semibold text-white whitespace-nowrap">
                                        {pLabel}
                                        <button
                                          onClick={() => setPressPopoverInfo({ press: pr, p1Name: mp1.name, p2Name: mp2.name, pressLabel: pLabel })}
                                          style={{ color: gold, fontSize: '0.85rem', marginLeft: '1px', fontWeight: 700, lineHeight: 1 }}>*</button>
                                      </th>
                                    )
                                  })}
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
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <span className="text-xs font-semibold text-gray-800">{player.name}</span>
                                        {h2hHcpSide === (rowIdx === 0 ? 'p1' : 'p2') && (listHf > 0 || listHb > 0 || listHt > 0) && (
                                          <button
                                            onClick={() => setStrokesPopover({ recipientName: player.name, front: listHf, back: listHb, total: listHt })}
                                            className="font-bold leading-none"
                                            style={{ color: gold, fontSize: '0.9rem', marginLeft: '2px', verticalAlign: 'text-top', position: 'relative', top: '6px' }}
                                            title="View handicap strokes">*</button>
                                        )}
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
                                      {pressResults.map((pr, pi) => {
                                        const pNet = rowIdx === 0 ? pr.p1Net : pr.p2Net
                                        const pWins = rowIdx === 0 ? pr.p1Wins : pr.p2Wins
                                        return (
                                          <td key={pi} className="px-2 py-2 text-center text-xs font-semibold" style={{ color: vpColor(pNet) }}>
                                            <span style={{ position: 'relative', display: 'inline-block' }}>
                                              <VsParDisplay n={pNet} />
                                              {pWins && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>}
                                            </span>
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                            </div>
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
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">2 v 2 Best Ball</p>
            {!showBBForm && (
              <button onClick={() => { setShowBBForm(true); setTimeout(() => addBBRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }}
                className="text-sm font-semibold px-4 py-1.5 rounded-lg" style={{ background: navy, color: 'white' }}>+ Add</button>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {showBBForm && (
              <div className="px-4 pt-3 pb-3 border-b border-gray-100">
                <div ref={addBBRef} className="space-y-3 bg-gray-50 rounded-xl p-3 border border-gray-200">

                  {/* Teams */}
                  <div className="grid grid-cols-2 gap-2">
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

                  {/* Scoring */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Scoring</label>
                    <select value={bbScoringType} onChange={(e) => setBbScoringType(e.target.value as ScoringType)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                      <option value="stroke">Stroke Play</option>
                      <option value="match">Match Play</option>
                    </select>
                  </div>

                  {/* Bet Type + Amount + Sweep — all on one row */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Bet Type <span className="text-red-400">*</span></label>
                      <select value={bbBetType} onChange={(e) => { setBbBetType(e.target.value as BetType | ''); if (e.target.value !== 'nassau') { setBbSweepEnabled(false); setBbSweepAmount('') } }}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                        <option value="" disabled>Select…</option>
                        <option value="nassau">Nassau</option>
                        <option value="straight">Overall</option>
                      </select>
                    </div>
                    {bbBetType && (
                      <div className="w-16 flex-shrink-0">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Amt ($)</label>
                        <input type="number" min="0" step="1" placeholder="0"
                          value={bbBetAmount} onChange={(e) => setBbBetAmount(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                      </div>
                    )}
                    {bbBetType === 'nassau' && (
                      <div className="flex-shrink-0 flex flex-col">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Sweep</label>
                        <div className="flex items-center gap-1.5 h-[38px]">
                          <input type="checkbox" checked={bbSweepEnabled} onChange={(e) => { setBbSweepEnabled(e.target.checked); if (!e.target.checked) setBbSweepAmount('') }} className="rounded" />
                          {bbSweepEnabled && (
                            <input type="number" min="0" step="1" placeholder="0"
                              value={bbSweepAmount} onChange={(e) => setBbSweepAmount(e.target.value)}
                              className="w-14 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Handicap Strokes */}
                  {bbScoringType === 'stroke' && bbBetType && (
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={bbStrokesEnabled} onChange={(e) => { setBbStrokesEnabled(e.target.checked); if (!e.target.checked) { setBbStrokesFront(''); setBbStrokesBack(''); setBbStrokesTotal('') } }} className="rounded" />
                        Handicap Strokes
                      </label>
                      {bbStrokesEnabled && (
                        <div className="pl-3 border-l-2 border-gray-200 ml-1 mt-2 space-y-2">
                          <select value={bbStrokesSide} onChange={(e) => setBbStrokesSide(e.target.value as 't1' | 't2')}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none">
                            <option value="t1">Team 1 gets strokes</option>
                            <option value="t2">Team 2 gets strokes</option>
                          </select>
                          {bbBetType === 'nassau' ? (
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Front</label>
                                <input type="number" min="0" step="0.5" placeholder="0" value={bbStrokesFront} onChange={(e) => setBbStrokesFront(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Back</label>
                                <input type="number" min="0" step="0.5" placeholder="0" value={bbStrokesBack} onChange={(e) => setBbStrokesBack(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Total</label>
                                <input type="number" min="0" step="0.5" placeholder="0" value={bbStrokesTotal} onChange={(e) => setBbStrokesTotal(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs font-medium text-gray-400 mb-1">Overall</label>
                              <input type="number" min="0" step="0.5" placeholder="0" value={bbStrokesTotal} onChange={(e) => setBbStrokesTotal(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Save / Cancel */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                    <button onClick={() => { setShowBBForm(false); setBbT1P1(''); setBbT1P2(''); setBbT2P1(''); setBbT2P2(''); setBbBetType(''); setBbBetAmount(''); setBbFrontAmount(''); setBbBackAmount(''); setBbTotalAmount(''); setBbSweepEnabled(false); setBbSweepAmount(''); setBbStrokesEnabled(false); setBbStrokesFront(''); setBbStrokesBack(''); setBbStrokesTotal('') }}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 bg-white">Cancel</button>
                    <button onClick={handleCreateBB}
                      disabled={!bbT1P1 || !bbT1P2 || !bbT2P1 || !bbT2P2 || new Set([bbT1P1, bbT1P2, bbT2P1, bbT2P2]).size !== 4 || !bbBetType || !bbBetAmount.trim() || savingBB}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                      style={{ background: navy, color: 'white' }}>
                      {savingBB ? 'Saving…' : 'Save'}
                    </button>
                  </div>

                </div>
              </div>
            )}

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
                    const { scoringType: bbScoringTypeParsed, betType: bbBetTypeParsed, handicapSide: bbListHcpSide, handicapFront: bbListHcpFront, handicapBack: bbListHcpBack, handicapTotal: bbListHcpTotal } = parseBet(m.bet)
                    const isBBMatchPlay = bbScoringTypeParsed === 'match'
                    const isBBOverallBet = bbBetTypeParsed === 'straight'
                    // Handicap-adjusted win indicators (stroke play only)
                    const bbListHf = !isBBMatchPlay ? (parseFloat(bbListHcpFront) || 0) : 0
                    const bbListHb = !isBBMatchPlay ? (parseFloat(bbListHcpBack) || 0) : 0
                    const bbListHt = !isBBMatchPlay ? (parseFloat(bbListHcpTotal) || 0) : 0
                    const bbListAdjT1Front = stats.t1Front !== null ? stats.t1Front - (bbListHcpSide === 't1' ? bbListHf : 0) : null
                    const bbListAdjT2Front = stats.t2Front !== null ? stats.t2Front - (bbListHcpSide === 't2' ? bbListHf : 0) : null
                    const bbListAdjT1Back  = stats.t1Back  !== null ? stats.t1Back  - (bbListHcpSide === 't1' ? bbListHb : 0) : null
                    const bbListAdjT2Back  = stats.t2Back  !== null ? stats.t2Back  - (bbListHcpSide === 't2' ? bbListHb : 0) : null
                    const bbListAdjT1Total = stats.t1Total !== null ? stats.t1Total - (bbListHcpSide === 't1' ? bbListHt : 0) : null
                    const bbListAdjT2Total = stats.t2Total !== null ? stats.t2Total - (bbListHcpSide === 't2' ? bbListHt : 0) : null
                    const t1WinsFront = bbListAdjT1Front !== null && bbListAdjT2Front !== null && bbListAdjT1Front < bbListAdjT2Front
                    const t2WinsFront = bbListAdjT1Front !== null && bbListAdjT2Front !== null && bbListAdjT2Front < bbListAdjT1Front
                    const t1WinsBack = bbListAdjT1Back !== null && bbListAdjT2Back !== null && bbListAdjT1Back < bbListAdjT2Back
                    const t2WinsBack = bbListAdjT1Back !== null && bbListAdjT2Back !== null && bbListAdjT2Back < bbListAdjT1Back
                    const t1WinsTotal = bbListAdjT1Total !== null && bbListAdjT2Total !== null && bbListAdjT1Total < bbListAdjT2Total
                    const t2WinsTotal = bbListAdjT1Total !== null && bbListAdjT2Total !== null && bbListAdjT2Total < bbListAdjT1Total
                    const bbPressResults = (m.press ?? []).map(pr => computeBBPressResult(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes, pr))

                    return (
                      <div key={m.id}>
                        <div className="px-4 py-3">
                          {/* Bet + status + controls row */}
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                            {!isEditingBB && (
                              <span className="flex items-center gap-1.5">
                                {m.bet
                                  ? <span className="font-medium whitespace-nowrap" style={{ color: gold, fontSize: 'clamp(9px, 2.3vw, 11px)' }}>Bet: {formatBet(m.bet)}</span>
                                  : <span className="text-gray-300 text-[11px]">No bet</span>}
                                <button onClick={() => { setEditingBB(m.id); const p = parseBet(m.bet); setEditBBBetType(p.betType); setEditBBBetAmount(p.betType === 'nassau' ? '' : p.amount); setEditBBScoringType(p.scoringType); setEditBBSweepAmount(p.sweepAmount); setEditBBSweepEnabled(!!p.sweepAmount); setEditBBStrokesEnabled(!!p.handicapSide); setEditBBStrokesSide((p.handicapSide as 't1' | 't2') || 't1'); setEditBBStrokesFront(p.handicapFront); setEditBBStrokesBack(p.handicapBack); setEditBBStrokesTotal(p.handicapTotal); setEditBBFrontAmount(p.betType === 'nassau' ? String(p.frontAmount || '') : ''); setEditBBBackAmount(p.betType === 'nassau' ? String(p.backAmount || '') : ''); setEditBBTotalAmount(p.betType === 'nassau' ? String(p.totalAmount || '') : ''); setEditBBPresses(m.press ?? []); setBBPressEnabled(false); setNewPressAmount(''); setNewPressStrokes(''); setNewPressStrokesEnabled(false); setNewPressHoleType('1hole'); setNewPressHoleStart(1); setNewPressHoleEnd(18); setTimeout(() => { const el = editBBRef.current; if (el) { const top = el.getBoundingClientRect().top + window.scrollY - 70; window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }) } }, 50) }}
                                  className="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors touch-manipulation" style={{ fontSize: '1rem' }}>✎</button>
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
                                handicapSide: bbListHcpSide,
                                handicapFront: bbListHf,
                                handicapBack: bbListHb,
                                handicapTotal: bbListHt,
                              })}
                              className="text-xs font-medium px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400 transition">
                              Scorecards
                            </button>
                            <span className="flex-1" />
                            <button onClick={() => setConfirmDelete({ id: m.id, label: `${t1Name} vs ${t2Name}`, type: 'bb' })} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                          </div>

                          {/* Edit form — shown below the controls row when editing */}
                          {isEditingBB && (
                            <div ref={editBBRef} className="space-y-3 mb-3 bg-gray-50 rounded-xl p-3 border border-gray-200 [&_input]:text-base [&_select]:text-base">
                              {/* Bet type label (static) */}
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-500">Bet:</span>
                                <span className="text-xs font-semibold text-gray-800">
                                  {editBBBetType === 'nassau' ? 'Nassau' : editBBBetType === 'straight' ? 'Overall' : 'No bet'}
                                </span>
                              </div>

                              {/* Amount inputs */}
                              {editBBBetType === 'nassau' && (
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Front ($)</label>
                                    <input autoFocus type="number" min="0" step="1" placeholder="0"
                                      value={editBBFrontAmount} onChange={(e) => setEditBBFrontAmount(e.target.value)}
                                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Back ($)</label>
                                    <input type="number" min="0" step="1" placeholder="0"
                                      value={editBBBackAmount} onChange={(e) => setEditBBBackAmount(e.target.value)}
                                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Total ($)</label>
                                    <input type="number" min="0" step="1" placeholder="0"
                                      value={editBBTotalAmount} onChange={(e) => setEditBBTotalAmount(e.target.value)}
                                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                  </div>
                                </div>
                              )}
                              {editBBBetType === 'straight' && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount ($)</label>
                                  <input autoFocus type="number" min="0" step="1" placeholder="0"
                                    value={editBBBetAmount} onChange={(e) => setEditBBBetAmount(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-200" />
                                </div>
                              )}

                              {/* Sweep row (Nassau only) */}
                              {editBBBetType === 'nassau' && (
                                <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                                    <input type="checkbox" checked={editBBSweepEnabled} onChange={(e) => { setEditBBSweepEnabled(e.target.checked); if (!e.target.checked) setEditBBSweepAmount('') }} className="rounded" />
                                    Sweep ($)
                                  </label>
                                  {editBBSweepEnabled && (
                                    <input type="number" min="0" step="1" placeholder="sweep amt"
                                      value={editBBSweepAmount} onChange={(e) => setEditBBSweepAmount(e.target.value)}
                                      className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none w-28" />
                                  )}
                                </div>
                              )}

                              {/* Handicap Strokes row */}
                              {editBBScoringType === 'stroke' && editBBBetType && (
                                <div>
                                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer mb-2">
                                    <input type="checkbox" checked={editBBStrokesEnabled} onChange={(e) => { setEditBBStrokesEnabled(e.target.checked); if (!e.target.checked) { setEditBBStrokesFront(''); setEditBBStrokesBack(''); setEditBBStrokesTotal('') } }} className="rounded" />
                                    Handicap Strokes
                                  </label>
                                  {editBBStrokesEnabled && (
                                    <div className="pl-3 border-l-2 border-gray-200 space-y-2">
                                      <select value={editBBStrokesSide} onChange={(e) => setEditBBStrokesSide(e.target.value as 't1' | 't2')}
                                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                                        <option value="t1">{t1Name} gets strokes</option>
                                        <option value="t2">{t2Name} gets strokes</option>
                                      </select>
                                      {editBBBetType === 'nassau' ? (
                                        <div className="grid grid-cols-3 gap-2">
                                          <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Front</label>
                                            <input type="number" min="0" step="0.5" placeholder="0"
                                              value={editBBStrokesFront} onChange={(e) => setEditBBStrokesFront(e.target.value)}
                                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                          </div>
                                          <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Back</label>
                                            <input type="number" min="0" step="0.5" placeholder="0"
                                              value={editBBStrokesBack} onChange={(e) => setEditBBStrokesBack(e.target.value)}
                                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                          </div>
                                          <div>
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Total</label>
                                            <input type="number" min="0" step="0.5" placeholder="0"
                                              value={editBBStrokesTotal} onChange={(e) => setEditBBStrokesTotal(e.target.value)}
                                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                          </div>
                                        </div>
                                      ) : (
                                        <div>
                                          <label className="block text-xs font-medium text-gray-500 mb-1">Overall</label>
                                          <input type="number" min="0" step="0.5" placeholder="0"
                                            value={editBBStrokesTotal} onChange={(e) => setEditBBStrokesTotal(e.target.value)}
                                            className="w-32 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Press section */}
                              <div className="border-t border-gray-100 pt-2.5 space-y-2">
                                {editBBPresses.length > 0 && (
                                  <div className="flex flex-col gap-0.5">
                                    {editBBPresses.map((pr, pi) => {
                                      const hl = pr.holeStart === pr.holeEnd ? `H${pr.holeStart}` : `H${pr.holeStart}–${pr.holeEnd}`
                                      const sl = pr.strokesSide && (pr.strokes ?? 0) > 0
                                        ? ` · ${pr.strokesSide === 'p1' ? t1Name : t2Name} +${pr.strokes}`
                                        : ''
                                      return (
                                        <div key={pr.id} className="flex items-center gap-1.5 text-xs">
                                          <span className="font-semibold" style={{ color: gold }}>Press {pi + 1}:</span>
                                          <span className="text-gray-600">{hl} · ${pr.amount}{sl}</span>
                                          <button onClick={() => setEditBBPresses(prev => prev.filter((_, i) => i !== pi))}
                                            className="text-gray-400 hover:text-red-500 ml-1 text-[11px]">✕</button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer w-fit">
                                  <input type="checkbox" checked={bbPressEnabled}
                                    onChange={(e) => { setBBPressEnabled(e.target.checked); if (!e.target.checked) { setNewPressAmount(''); setNewPressStrokes(''); setNewPressStrokesEnabled(false) } }}
                                    className="rounded" />
                                  Press
                                </label>
                                {bbPressEnabled && (
                                  <div className="flex items-center gap-1.5 flex-wrap pl-2 border-l-2 border-amber-300">
                                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                                      <input type="checkbox" checked={newPressStrokesEnabled}
                                        onChange={(e) => { setNewPressStrokesEnabled(e.target.checked); if (!e.target.checked) setNewPressStrokes('') }}
                                        className="rounded" />
                                      Strokes
                                    </label>
                                    {newPressStrokesEnabled && (
                                      <>
                                        <select value={newPressStrokesSide} onChange={(e) => setNewPressStrokesSide(e.target.value as 'p1' | 'p2')}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                          <option value="p1">{t1Name}</option>
                                          <option value="p2">{t2Name}</option>
                                        </select>
                                        <input type="number" min="0" step="0.5" placeholder="0" value={newPressStrokes}
                                          onChange={(e) => setNewPressStrokes(e.target.value)}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none w-12" />
                                      </>
                                    )}
                                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                                      <input type="radio" name={`bbpht-${m.id}`} checked={newPressHoleType === '1hole'}
                                        onChange={() => { setNewPressHoleType('1hole'); setNewPressHoleEnd(newPressHoleStart) }} />
                                      1 Hole
                                    </label>
                                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                                      <input type="radio" name={`bbpht-${m.id}`} checked={newPressHoleType === 'multihole'}
                                        onChange={() => setNewPressHoleType('multihole')} />
                                      Multi
                                    </label>
                                    {newPressHoleType === '1hole' && (
                                      <select value={newPressHoleStart}
                                        onChange={(e) => { const v = parseInt(e.target.value); setNewPressHoleStart(v); setNewPressHoleEnd(v) }}
                                        className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                        {Array.from({ length: 18 }, (_, i) => i + 1).map(n => (
                                          <option key={n} value={n}>Hole {n}</option>
                                        ))}
                                      </select>
                                    )}
                                    {newPressHoleType === 'multihole' && (
                                      <>
                                        <select value={newPressHoleStart}
                                          onChange={(e) => { const v = parseInt(e.target.value); setNewPressHoleStart(v); if (newPressHoleEnd < v) setNewPressHoleEnd(v) }}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                          {Array.from({ length: 18 }, (_, i) => i + 1).map(n => <option key={n} value={n}>H{n}</option>)}
                                        </select>
                                        <span className="text-xs text-gray-400">–</span>
                                        <select value={newPressHoleEnd}
                                          onChange={(e) => setNewPressHoleEnd(parseInt(e.target.value))}
                                          className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none">
                                          {Array.from({ length: 18 }, (_, i) => i + 1).filter(n => n >= newPressHoleStart).map(n => <option key={n} value={n}>H{n}</option>)}
                                        </select>
                                      </>
                                    )}
                                    <input type="number" min="0" step="1" placeholder="$amt" value={newPressAmount}
                                      onChange={(e) => setNewPressAmount(e.target.value)}
                                      className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none w-16" />
                                    <button
                                      onClick={() => {
                                        const amt = parseFloat(newPressAmount)
                                        if (!newPressAmount.trim() || isNaN(amt) || amt <= 0) return
                                        const hEnd = newPressHoleType === '1hole' ? newPressHoleStart : Math.max(newPressHoleStart, newPressHoleEnd)
                                        const entry: PressEntry = {
                                          id: Math.random().toString(36).slice(2),
                                          holeStart: newPressHoleStart,
                                          holeEnd: hEnd,
                                          amount: amt,
                                          ...(newPressStrokesEnabled && newPressStrokes.trim() ? { strokesSide: newPressStrokesSide, strokes: parseFloat(newPressStrokes) || 0 } : {}),
                                        }
                                        setEditBBPresses(prev => [...prev, entry])
                                        setNewPressAmount('')
                                        setNewPressStrokes('')
                                        setNewPressStrokesEnabled(false)
                                        setBBPressEnabled(false)
                                      }}
                                      disabled={!newPressAmount.trim() || !(parseFloat(newPressAmount) > 0)}
                                      className="text-xs font-semibold text-blue-600 disabled:opacity-40">
                                      + Add
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Save / Cancel */}
                              <div className="flex gap-2">
                                <button onClick={() => handleSaveBBBet(m.id)}
                                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white"
                                  style={{ background: navy }}>
                                  Save
                                </button>
                                <button onClick={() => { setEditingBB(null); setBBPressEnabled(false) }}
                                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-300 bg-white">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 5-column summary table */}
                          <div className="rounded-lg border border-gray-300 overflow-hidden">
                            <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse">
                              <thead>
                                <tr style={{ background: navy }}>
                                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-white">Team</th>
                                  {!isBBOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Front</th>}
                                  {!isBBOverallBet && <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Back</th>}
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Total</th>
                                  <th className="px-3 py-1.5 text-center text-xs font-semibold text-white">Thru</th>
                                  {(m.press ?? []).map((pr, pi) => {
                                    const pLabel = (m.press ?? []).length === 1 ? 'Press' : `Press ${pi + 1}`
                                    return (
                                      <th key={pi} className="px-2 py-1.5 text-center text-xs font-semibold text-white whitespace-nowrap">
                                        {pLabel}
                                        <button
                                          onClick={() => setPressPopoverInfo({ press: pr, p1Name: t1Name, p2Name: t2Name, pressLabel: pLabel })}
                                          style={{ color: gold, fontSize: '0.85rem', marginLeft: '1px', fontWeight: 700, lineHeight: 1 }}>*</button>
                                      </th>
                                    )
                                  })}
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
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <span
                                          className="text-xs font-semibold"
                                          style={{ color }}>
                                          {tName}
                                        </span>
                                        {bbListHcpSide === (rowIdx === 0 ? 't1' : 't2') && (bbListHf > 0 || bbListHb > 0 || bbListHt > 0) && (
                                          <button
                                            onClick={() => setStrokesPopover({ recipientName: tName, front: bbListHf, back: bbListHb, total: bbListHt })}
                                            className="font-bold leading-none"
                                            style={{ color: gold, fontSize: '0.9rem', marginLeft: '2px', verticalAlign: 'text-top', position: 'relative', top: '6px' }}
                                            title="View handicap strokes">*</button>
                                        )}
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
                                      {bbPressResults.map((pr, pi) => {
                                        const pNet = rowIdx === 0 ? pr.t1Net : pr.t2Net
                                        const pWins = rowIdx === 0 ? pr.t1Wins : pr.t2Wins
                                        return (
                                          <td key={pi} className="px-2 py-2 text-center text-xs font-semibold" style={{ color: vpColor(pNet) }}>
                                            <span style={{ position: 'relative', display: 'inline-block' }}>
                                              <VsParDisplay n={pNet} />
                                              {pWins && <span style={{ position: 'absolute', left: '100%', paddingLeft: '2px', color: '#16a34a' }}>✓</span>}
                                            </span>
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                            </div>
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
            <div style={{ display: 'grid', gridTemplateRows: showPayouts ? '1fr' : '0fr', transition: 'grid-template-rows 0.22s ease' }}>
              <div style={{ overflow: 'hidden' }}>
              <div className="border-t border-gray-100 space-y-3 p-3">

                {/* Empty state when search has no payout matches */}
                {filteredPayoutRows.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-4">No matchups found for that player</p>
                )}

                {/* Per-matchup breakdown */}
                {filteredPayoutRows.map((row, rowIdx) => {
                  const prevRow = rowIdx > 0 ? filteredPayoutRows[rowIdx - 1] : null
                  const showH2HHeader = row.type === 'h2h' && (!prevRow || prevRow.type !== 'h2h')
                  const showBBHeader = row.type === 'bb' && (!prevRow || prevRow.type !== 'bb')
                  const h2hMatch = matchups.find((m) => m.id === row.id)
                  const bbMatch = bestBallMatchups.find((m) => m.id === row.id)
                  const involvedPlayerIds = h2hMatch
                    ? [h2hMatch.player1_id, h2hMatch.player2_id]
                    : bbMatch
                      ? [bbMatch.team1_player1_id, bbMatch.team1_player2_id, bbMatch.team2_player1_id, bbMatch.team2_player2_id]
                      : []
                  const allFinished = involvedPlayerIds.length > 0 && holes.length > 0 &&
                    involvedPlayerIds.every((id) => Object.keys(scoreMap[id] ?? {}).length >= holes.length)

                  // Net press amount from p1's perspective (+ve = p1 net wins from presses)
                  let p1PressNet = 0
                  if (row.type === 'h2h' && h2hMatch) {
                    for (const pr of (h2hMatch.press ?? [])) {
                      const res = computePressResult(h2hMatch.player1_id, h2hMatch.player2_id, scoreMap, holes, pr)
                      if (res.p1Wins) p1PressNet += pr.amount
                      else if (res.p2Wins) p1PressNet -= pr.amount
                    }
                  }

                  return (
                    <div key={row.id}>
                    {showH2HHeader && (
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 px-1 pt-1 pb-0.5">Head to Head</p>
                    )}
                    {showBBHeader && (
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 px-1 pt-1 pb-0.5">2v2 Best Ball</p>
                    )}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="px-4 pt-3 pb-1 border-b border-gray-100">
                        <p className="text-xs font-bold text-gray-800">{row.label}</p>
                        <p className="text-xs" style={{ color: row.segments.length === 0 ? '#9ca3af' : gold }}>
                          {row.betLabel}{row.type === 'h2h' && h2hMatch && (h2hMatch.press ?? []).length > 0 ? ' · Press' : ''}
                        </p>
                      </div>
                      {row.segments.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-gray-400">
                          No bet amount set — use the ✎ button above to add one.
                        </div>
                      ) : (
                        <table className="w-full border-collapse">
                          <tbody>
                            {/* For Nassau bets show only the Result summary row; for Overall show the single segment */}
                            {!row.nassauResult && row.segments.map((seg) => {
                              const mp1r = row.type === 'h2h' ? players.find((p) => p.id === h2hMatch?.player1_id) : null
                              const winnerPressNet = row.type === 'h2h' && seg.settled && !seg.tied
                                ? (seg.winnerLabel === mp1r?.name ? p1PressNet : -p1PressNet)
                                : 0
                              const totalAmt = seg.settled && !seg.tied ? seg.amount + winnerPressNet : seg.amount
                              const fmtAmt = totalAmt % 1 === 0 ? String(Math.abs(totalAmt)) : Math.abs(totalAmt).toFixed(2)
                              return (
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
                                      ? <span className="text-green-600">${fmtAmt}{seg.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span>
                                      : <span className="font-normal text-gray-300">${seg.amount}{seg.perPlayer ? '/player' : ''}</span>}
                                  </td>
                                </tr>
                              )
                            })}
                            {row.nassauResult && (() => {
                              const nr = row.nassauResult!
                              const mp1r = row.type === 'h2h' ? players.find((p) => p.id === h2hMatch?.player1_id) : null
                              const winnerPressNet = nr.anySettled && nr.winnerLabel !== null
                                ? (nr.winnerLabel === mp1r?.name ? p1PressNet : -p1PressNet)
                                : 0
                              const totalAmt = nr.anySettled && nr.winnerLabel !== null ? nr.amount + winnerPressNet : nr.amount
                              const fmtAmt = totalAmt % 1 === 0 ? String(Math.abs(totalAmt)) : Math.abs(totalAmt).toFixed(2)
                              return (
                                <tr className="border-t border-gray-100 bg-gray-50">
                                  <td className="px-4 py-2 text-xs font-bold text-gray-500 w-14">Result</td>
                                  <td className="px-2 py-2 text-xs font-semibold">
                                    {!nr.anySettled
                                      ? <span className="text-gray-300">Pending</span>
                                      : nr.winnerLabel === null
                                        ? <span className="text-gray-400 italic">Tied — push</span>
                                        : <span className="text-green-700 font-semibold">{nr.winnerLabel}{nr.swept && <span className="ml-1.5 text-xs font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">SWEEP</span>}</span>}
                                  </td>
                                  <td className="px-4 py-2 text-xs font-bold text-right whitespace-nowrap">
                                    {nr.anySettled && nr.winnerLabel !== null
                                      ? <span className="text-green-600">${fmtAmt}{nr.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span>
                                      : null}
                                  </td>
                                </tr>
                              )
                            })()}
                          </tbody>
                        </table>
                      )}
                    </div>
                    </div>
                  )
                })}

              </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Net Positions & Settlements ── */}
        {payouts.involvedIds.size > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowNetPositions((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm font-semibold text-gray-800">Net Positions &amp; Settlements</span>
              <span className="text-gray-400 text-xs">{showNetPositions ? '▲ Hide' : '▼ Show'}</span>
            </button>
            <div style={{ display: 'grid', gridTemplateRows: showNetPositions ? '1fr' : '0fr', transition: 'grid-template-rows 0.22s ease' }}>
              <div style={{ overflow: 'hidden' }}>
              <div className="border-t border-gray-100">
                {/* Net Positions */}
                <div className="px-4 pt-3 pb-2">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Net Positions</p>
                  <div>
                    {players
                      .filter((p) => payouts.involvedIds.has(p.id))
                      .sort((a, b) => (payouts.net[b.id] ?? 0) - (payouts.net[a.id] ?? 0))
                      .map((p) => {
                        const v = Math.round((payouts.net[p.id] ?? 0) * 100) / 100
                        return (
                          <div key={p.id} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
                            <span className="text-sm text-gray-900">{p.name}</span>
                            <span className="text-sm font-bold tabular-nums" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>
                              {v > 0 ? `$${v.toFixed(2)}` : v < 0 ? `$${Math.abs(v).toFixed(2)}` : 'Even'}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                </div>
                {/* Settlements */}
                <div className="border-t border-gray-200 px-4 py-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Settlements</p>
                  {payouts.settlements.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-2">No payouts yet</p>
                  ) : (
                    payouts.settlements.map((s, i) => (
                      <div key={i} className="flex items-center justify-between py-1">
                        <span className="text-sm text-gray-800">
                          <span className="font-semibold text-red-500">{s.fromName}</span>
                          <span className="text-gray-500"> pays </span>
                          <span className="font-semibold text-green-600">{s.toName}</span>
                        </span>
                        <span className="text-sm font-bold text-gray-900">${s.amount.toFixed(2)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HorizontalScorecardTable({
  rows, holes, showMatchPlay = false, betType = '', strokesInfo, onStrokesClick,
}: {
  rows: { label: string; scoreMap: Partial<Record<number, number>> }[]
  holes: Hole[]
  showMatchPlay?: boolean
  betType?: BetType | ''
  strokesInfo?: ({ front: number; back: number; total: number } | null)[]
  onStrokesClick?: (info: { recipientName: string; front: number; back: number; total: number }) => void
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
    // Apply handicap adjustments for checkmark placement (same logic as matchup grid)
    const hcp0 = strokesInfo?.[0] ?? null
    const hcp1 = strokesInfo?.[1] ?? null
    const adjF0 = s0.fStrokes - (hcp0?.front ?? 0)
    const adjF1 = s1.fStrokes - (hcp1?.front ?? 0)
    const adjB0 = s0.bStrokes - (hcp0?.back ?? 0)
    const adjB1 = s1.bStrokes - (hcp1?.back ?? 0)
    if (showSectionChk && s0.fScored.length > 0 && s1.fScored.length > 0 && adjF0 !== adjF1)
      frontWinnerIdx = adjF0 < adjF1 ? 0 : 1
    if (showSectionChk && s0.bScored.length > 0 && s1.bScored.length > 0 && adjB0 !== adjB1)
      backWinnerIdx = adjB0 < adjB1 ? 0 : 1
    const t0 = s0.fStrokes + s0.bStrokes, t1 = s1.fStrokes + s1.bStrokes
    const adjT0 = t0 - (hcp0?.total ?? 0)
    const adjT1 = t1 - (hcp1?.total ?? 0)
    if ((s0.fScored.length + s0.bScored.length) > 0 && (s1.fScored.length + s1.bScored.length) > 0 && adjT0 !== adjT1)
      totalWinnerIdx = adjT0 < adjT1 ? 0 : 1
  }
  const chk = <span style={{ color: '#16a34a', fontSize: '0.6rem', marginLeft: '1px', lineHeight: 1 }}>✓</span>

  const hdr = (highlight?: boolean, isHoleNum?: boolean): React.CSSProperties => ({
    background: highlight ? '#4a7fa5' : isHoleNum ? '#dde4ee' : navy,
    color: highlight || !isHoleNum ? 'white' : navy,
    fontWeight: 700,
    fontSize: '0.65rem',
    textAlign: 'center',
    padding: '0.4rem 0.25rem',
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
          <th style={{ ...hdr(false, true), textAlign: 'left', paddingLeft: '0.5rem', minWidth: '5rem' }}>HOLE</th>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <th key={n} style={hdr(false, true)}>{n}</th>)}
          <th style={hdr(true)}>Front</th>
          {[10, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => <th key={n} style={hdr(false, true)}>{n}</th>)}
          <th style={hdr(true)}>Back</th>
          <th style={hdr()}>TOTAL</th>
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
              <td style={{ ...cell(), textAlign: 'left', paddingLeft: '0.5rem', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>
                {label}
                {(() => {
                  const si = strokesInfo?.[rowIdx]
                  if (!si || (si.front === 0 && si.back === 0 && si.total === 0) || !onStrokesClick) return null
                  return (
                    <button
                      onClick={() => onStrokesClick({ recipientName: label, front: si.front, back: si.back, total: si.total })}
                      className="font-bold leading-none"
                      style={{ color: gold, fontSize: '0.9rem', marginLeft: '2px', verticalAlign: 'text-top', position: 'relative', top: '1px' }}
                      title="View handicap strokes">*</button>
                  )
                })()}
              </td>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
                const hole = holes.find((h) => h.hole_number === n)
                const s = scoreMap[n] ?? null
                return (
                  <td key={n} style={cell()}>
                    {s != null && hole
                      ? <ScoreNotation strokes={s} par={hole.par} size="sm" />
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
                      ? <ScoreNotation strokes={s} par={hole.par} size="sm" />
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

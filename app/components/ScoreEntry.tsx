'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { submitHoleScores, saveDaytonaAssignments } from '@/app/actions'
import { supabase } from '@/lib/supabase'
import {
  computeHoleBallScores, computeTeamBallSummary,
  computeHoleDaytonaWithSides, computeDaytonaSidesSummary, computePlayerDaytonaPoints,
  computeHoleDaytonaPointsFiveMan,
  calculatePoolPayouts, settleDaytonaPlayerPoints,
  type DaytonaHoleAssignment, type DaytonaSide,
} from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type Team = { id: string; name: string }
type AssignmentMap = Record<number, Record<string, DaytonaSide>>
type AllTeam = { id: string; name: string }
type AllPlayer = { id: string; team_id: string; name: string; position: number | null }
type BallValue = { ball_number: number; value_dollars: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string }
type BestBallMatchup = { id: string; team1_player1_id: string; team1_player2_id: string; team2_player1_id: string; team2_player2_id: string; bet: string }
type MatchupBetType = 'nassau' | 'straight'
type MatchupScoringType = 'stroke' | 'match'
type MPayoutSeg = { name: 'Front' | 'Back' | 'Total'; settled: boolean; winnerLabel: string | null; tied: boolean; amount: number; perPlayer: boolean }
type MPayoutRow = { id: string; label: string; betLabel: string; segments: MPayoutSeg[]; nassauResult?: { winnerLabel: string | null; amount: number; perPlayer: boolean; anySettled: boolean } }
type PayoutsData = {
  teams: AllTeam[]; players: AllPlayer[]; scores: Score[]; ballValues: BallValue[]
  assignments: DaytonaHoleAssignment[]; matchups: SavedMatchup[]; bestBallMatchups: BestBallMatchup[]
}

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

// ── Matchup helpers (mirrors LeaderboardClient) ───────────────────────────────
function parseMBet(bet: string): { betType: MatchupBetType | ''; amount: string; scoringType: MatchupScoringType } {
  if (!bet) return { betType: '', amount: '', scoringType: 'stroke' }
  const p = bet.split(':')
  if (p.length >= 2 && (p[0] === 'nassau' || p[0] === 'straight')) return { betType: p[0] as MatchupBetType, amount: p[1] ?? '', scoringType: p[2] === 'match' ? 'match' : 'stroke' }
  return { betType: '', amount: '', scoringType: 'stroke' }
}
function formatMBet(bet: string): string {
  const { betType, amount, scoringType } = parseMBet(bet)
  const sl = scoringType === 'match' ? 'Match Play' : 'Stroke Play'
  if (betType === 'nassau' && amount) return `$${amount} Nassau · ${sl}`
  if (betType === 'straight' && amount) return `$${amount} Overall · ${sl}`
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
    const { betType, amount, scoringType } = parseMBet(m.bet)
    const betAmt = parseFloat(amount); const hasBet = betType !== '' && !isNaN(betAmt) && betAmt > 0
    if (!hasBet) { rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] }); continue }
    const stats = h2hStats(m.player1_id, m.player2_id, scoreMap, holes)
    const hole9 = scoreMap[m.player1_id]?.[9] != null && scoreMap[m.player2_id]?.[9] != null
    const hole18 = scoreMap[m.player1_id]?.[18] != null && scoreMap[m.player2_id]?.[18] != null
    const p1 = m.player1_id, p2 = m.player2_id
    const resolveH2H = (settled: boolean, sl: 'p1' | 'p2' | 'tie' | null, mpDiff: number): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const p1w = scoringType === 'match' ? mpDiff > 0 : sl === 'p1', p2w = scoringType === 'match' ? mpDiff < 0 : sl === 'p2'
      if (p1w) { net[p1] = (net[p1] ?? 0) + betAmt; net[p2] = (net[p2] ?? 0) - betAmt; return { winnerLabel: mp1.name, tied: false } }
      if (p2w) { net[p2] = (net[p2] ?? 0) + betAmt; net[p1] = (net[p1] ?? 0) - betAmt; return { winnerLabel: mp2.name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segs: MPayoutSeg[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.p1Front !== null && stats.p2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveH2H(fS, slH2H(stats.p1Front, stats.p2Front), stats.p1FrontWins - stats.p2FrontWins)
      segs.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: betAmt, perPlayer: false })
      const bS = hole18 && stats.p1Back !== null && stats.p2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveH2H(bS, slH2H(stats.p1Back, stats.p2Back), stats.p1BackWins - stats.p2BackWins)
      segs.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: betAmt, perPlayer: false })
    }
    const tS = hole18 && stats.p1Total !== null && stats.p2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveH2H(tS, slH2H(stats.p1Total, stats.p2Total), stats.p1Wins - stats.p2Wins)
    segs.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: betAmt, perPlayer: false })
    let nassauResult: MPayoutRow['nassauResult']
    if (betType === 'nassau') { const p1Net = segs.reduce((s, seg) => s + (seg.settled && !seg.tied && seg.winnerLabel !== null ? (seg.winnerLabel === mp1.name ? seg.amount : -seg.amount) : 0), 0); nassauResult = { winnerLabel: p1Net > 0 ? mp1.name : p1Net < 0 ? mp2.name : null, amount: Math.abs(p1Net), perPlayer: false, anySettled: segs.some((s) => s.settled) } }
    rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: formatMBet(m.bet), segments: segs, nassauResult })
  }
  for (const m of bestBallMatchups) {
    const t1p1 = players.find((p) => p.id === m.team1_player1_id), t1p2 = players.find((p) => p.id === m.team1_player2_id)
    const t2p1 = players.find((p) => p.id === m.team2_player1_id), t2p2 = players.find((p) => p.id === m.team2_player2_id)
    if (!t1p1 || !t1p2 || !t2p1 || !t2p2) continue
    involvedIds.add(m.team1_player1_id); involvedIds.add(m.team1_player2_id); involvedIds.add(m.team2_player1_id); involvedIds.add(m.team2_player2_id)
    const { betType, amount, scoringType } = parseMBet(m.bet)
    const betAmt = parseFloat(amount); const hasBet = betType !== '' && !isNaN(betAmt) && betAmt > 0
    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`, t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`
    if (!hasBet) { rows.push({ id: m.id, label: `${t1Name} vs ${t2Name}`, betLabel: 'No bet configured', segments: [] }); continue }
    const stats = bbStats(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
    const t1Ids = [m.team1_player1_id, m.team1_player2_id], t2Ids = [m.team2_player1_id, m.team2_player2_id]
    const hole9 = t1Ids.some((id) => scoreMap[id]?.[9] != null) && t2Ids.some((id) => scoreMap[id]?.[9] != null)
    const hole18 = t1Ids.some((id) => scoreMap[id]?.[18] != null) && t2Ids.some((id) => scoreMap[id]?.[18] != null)
    const resolveBB = (settled: boolean, sl: 't1' | 't2' | 'tie' | null, mpDiff: number): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const t1w = scoringType === 'match' ? mpDiff > 0 : sl === 't1', t2w = scoringType === 'match' ? mpDiff < 0 : sl === 't2'
      if (t1w) { for (const id of t1Ids) net[id] = (net[id] ?? 0) + betAmt; for (const id of t2Ids) net[id] = (net[id] ?? 0) - betAmt; return { winnerLabel: t1Name, tied: false } }
      if (t2w) { for (const id of t2Ids) net[id] = (net[id] ?? 0) + betAmt; for (const id of t1Ids) net[id] = (net[id] ?? 0) - betAmt; return { winnerLabel: t2Name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segs: MPayoutSeg[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.t1Front !== null && stats.t2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveBB(fS, slBB(stats.t1Front, stats.t2Front), stats.t1FrontWins - stats.t2FrontWins)
      segs.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: betAmt, perPlayer: true })
      const bS = hole18 && stats.t1Back !== null && stats.t2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveBB(bS, slBB(stats.t1Back, stats.t2Back), stats.t1BackWins - stats.t2BackWins)
      segs.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: betAmt, perPlayer: true })
    }
    const tS = hole18 && stats.t1Total !== null && stats.t2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveBB(tS, slBB(stats.t1Total, stats.t2Total), stats.t1Wins - stats.t2Wins)
    segs.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: betAmt, perPlayer: true })
    let nassauResult: MPayoutRow['nassauResult']
    if (betType === 'nassau') { const t1Net = segs.reduce((s, seg) => s + (seg.settled && !seg.tied && seg.winnerLabel !== null ? (seg.winnerLabel === t1Name ? seg.amount : -seg.amount) : 0), 0); nassauResult = { winnerLabel: t1Net > 0 ? t1Name : t1Net < 0 ? t2Name : null, amount: Math.abs(t1Net), perPlayer: true, anySettled: segs.some((s) => s.settled) } }
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
  team, players, holes, initialScores, ballsCount, format = 'standard', daytonaVariant = '4man', isAdmin, roundId = '', initialAssignments = [], roundPlayerIds = [], includeTotal = false,
}: {
  team: Team
  players: Player[]
  holes: Hole[]
  initialScores: Score[]
  ballsCount: number
  format?: string
  daytonaVariant?: string
  isAdmin: boolean
  roundId?: string
  initialAssignments?: DaytonaHoleAssignment[]
  roundPlayerIds?: string[]
  includeTotal?: boolean
}) {
  const isDaytona = format === 'daytona'
  const is5Man = isDaytona && daytonaVariant.startsWith('5man')
  const isFlares = daytonaVariant === '5man-flares'
  const leftLabel = isFlares ? 'Outside' : 'Left'
  const rightLabel = isFlares ? 'Inside' : 'Right'

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
  const [expandedHole, setExpandedHole] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [roundComplete, setRoundComplete] = useState(false)
  const [showPayoutsModal, setShowPayoutsModal] = useState(false)
  const [payoutsData, setPayoutsData] = useState<PayoutsData | null>(null)
  const [payoutsLoading, setPayoutsLoading] = useState(false)
  const [showDaytonaResultsModal, setShowDaytonaResultsModal] = useState(false)
  const [showMatchupResultsModal, setShowMatchupResultsModal] = useState(false)

  async function openPayoutsModal() {
    setShowPayoutsModal(true)
    if (payoutsData) return
    setPayoutsLoading(true)
    const { data: teams } = await supabase.from('teams').select('id, name').eq('round_id', roundId)
    const allTeamIds = (teams ?? []).map((t) => t.id)
    const [{ data: allPlayers }, { data: allScores }, { data: ballValues }, { data: dtAssignments }, { data: matchupsData }, { data: bbMatchupsData }] = await Promise.all([
      supabase.from('players').select('id, team_id, name, position').in('team_id', allTeamIds.length ? allTeamIds : ['']).order('position', { ascending: true }),
      supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', roundPlayerIds.length ? roundPlayerIds : ['']),
      supabase.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId).order('ball_number'),
      isDaytona
        ? supabase.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
        : Promise.resolve({ data: [] }),
      supabase.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', roundId),
      supabase.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', roundId),
    ])
    setPayoutsData({
      teams: teams ?? [],
      players: allPlayers ?? [],
      scores: allScores ?? [],
      ballValues: ballValues ?? [],
      assignments: (dtAssignments ?? []) as DaytonaHoleAssignment[],
      matchups: (matchupsData ?? []) as SavedMatchup[],
      bestBallMatchups: (bbMatchupsData ?? []) as BestBallMatchup[],
    })
    setPayoutsLoading(false)
  }

  async function checkRoundComplete() {
    if (roundPlayerIds.length === 0) return
    const { count } = await supabase
      .from('scores')
      .select('*', { count: 'exact', head: true })
      .in('player_id', roundPlayerIds)
    setRoundComplete(count !== null && count >= roundPlayerIds.length * 18)
  }

  const broadcastChannel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    const ch = supabase.channel('score-updates')
      .on('broadcast', { event: 'refresh' }, async () => {
        const [scoresRes, assignRes] = await Promise.all([
          supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds),
          isDaytona && roundId
            ? supabase.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') broadcastChannel.current = ch
      })
    return () => { supabase.removeChannel(ch); broadcastChannel.current = null }
  }, [players])

  useEffect(() => {
    checkRoundComplete()
  }, [])

  // Daytona Left/Right assignments per hole
  const [assignments, setAssignments] = useState<AssignmentMap>(() => {
    const m: AssignmentMap = {}
    for (const a of initialAssignments) {
      if (!m[a.hole_number]) m[a.hole_number] = {}
      m[a.hole_number][a.player_id] = a.side as DaytonaSide
    }
    return m
  })

  function setStroke(playerId: string, hole: number, val: number) {
    setStrokes((s) => ({ ...s, [playerId]: { ...s[playerId], [hole]: Math.max(1, Math.min(20, val)) } }))
  }

  function toggleSide(holeNumber: number, playerId: string) {
    setAssignments((prev) => {
      const holeMap = prev[holeNumber] ?? {}
      const current = holeMap[playerId] ?? 'right'
      return { ...prev, [holeNumber]: { ...holeMap, [playerId]: current === 'left' ? 'right' : 'left' } }
    })
  }

  function expandHole(holeNumber: number) {
    setExpandedHole((prev) => {
      if (prev === holeNumber) return null
      if (isDaytona && !assignments[holeNumber]) {
        const def = defaultAssignmentForHole(players, holeNumber, assignments)
        setAssignments((a) => ({ ...a, [holeNumber]: def }))
      }
      return holeNumber
    })
  }

  async function saveHole(holeNumber: number) {
    const holeAssignments = assignments[holeNumber] ?? {}
    const leftCount = Object.values(holeAssignments).filter((s) => s === 'left').length

    if (isDaytona && leftCount !== 2) {
      setErrors((e) => ({ ...e, [holeNumber]: 'Assign exactly 2 players to Left before saving.' }))
      return
    }

    const playerScores = players.map((p) => ({
      playerId: p.id,
      strokes: strokes[p.id]?.[holeNumber] ?? holes.find((h) => h.hole_number === holeNumber)?.par ?? 4,
    }))

    setPendingHoles((p) => new Set([...p, holeNumber]))

    const [result] = await Promise.all([
      submitHoleScores(team.id, holeNumber, playerScores),
      isDaytona && roundId
        ? saveDaytonaAssignments(
            roundId,
            holeNumber,
            Object.entries(holeAssignments).map(([playerId, side]) => ({ playerId, side }))
          )
        : Promise.resolve(),
    ])

    setPendingHoles((p) => { const n = new Set(p); n.delete(holeNumber); return n })

    if (result.error) {
      setErrors((e) => ({ ...e, [holeNumber]: result.error! }))
    } else {
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
      setExpandedHole(null)
      broadcastChannel.current?.send({ type: 'broadcast', event: 'refresh', payload: {} })
    }
  }

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)
  const playerIds = players.map((p) => p.id)

  const frontSummary = !isDaytona ? computeTeamBallSummary(frontHoles, playerIds, savedScores, ballsCount) : null
  const backSummary = !isDaytona ? computeTeamBallSummary(backHoles, playerIds, savedScores, ballsCount) : null

  // Convert assignments map to flat array for summary functions
  const flatAssignments: DaytonaHoleAssignment[] = isDaytona
    ? Object.entries(assignments).flatMap(([hn, map]) =>
        Object.entries(map).map(([pid, side]) => ({ player_id: pid, hole_number: Number(hn), side }))
      )
    : []

  const dtSummary = isDaytona ? computeDaytonaSidesSummary(holes, savedScores, flatAssignments) : null
  const playerPointTotals = isDaytona ? computePlayerDaytonaPoints(holes, savedScores, flatAssignments, daytonaVariant) : new Map<string, number>()

  const frontBallTotals = !isDaytona
    ? Array.from({ length: ballsCount }, (_, bi) =>
        frontHoles.reduce((sum, h) => {
          const hps = players.map((p) => strokes[p.id]?.[h.hole_number] ?? h.par)
          return sum + (computeHoleBallScores(hps, ballsCount)[bi] ?? h.par)
        }, 0)
      )
    : []
  const backBallTotals = !isDaytona
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
      {/* Header */}
      <header className="text-white px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Scorecard</p>
              <h1 className="font-bold text-lg">{team.name}</h1>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <a href="/admin/dashboard"
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold border"
                  style={{ background: navy, color: '#d1d5db', borderColor: '#d1d5db' }}>
                  Admin Hub
                </a>
              )}
              <a href="/" className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: gold, color: navy }}>Leaderboard</a>
            </div>
          </div>
          {!isDaytona && (
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

          {/* Player running point totals — Daytona only */}
          {isDaytona && playerPointTotals.size > 0 && (
            <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-1">
              {players.map((p) => {
                const pts = playerPointTotals.get(p.id) ?? 0
                return (
                  <div key={p.id} className="flex items-center gap-1.5 text-xs">
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>{p.name.split(' ')[0]}</span>
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

                // Combined net
                const combinedNet: Record<string, number> = {}
                for (const p of payoutsData.players) {
                  const ballNet = isDaytona ? 0 : (poolResults.playerNet[p.id] ?? 0)
                  combinedNet[p.id] = ballNet + (matchupPayoutsResult.net[p.id] ?? 0)
                }
                if (isDaytona) {
                  for (const t of payoutsData.teams) {
                    const tp = payoutsData.players.filter((p) => p.team_id === t.id)
                    const tpIds = tp.map((p) => p.id)
                    const tAssign = payoutsData.assignments.filter((a) => tpIds.includes(a.player_id))
                    const tScores = payoutsData.scores.filter((s) => tpIds.includes(s.player_id))
                    const pts = computePlayerDaytonaPoints(holes, tScores, tAssign, daytonaVariant)
                    const { net: pNet } = settleDaytonaPlayerPoints(tp, pts, dtPayoutValue)
                    for (const [id, amt] of Object.entries(pNet)) combinedNet[id] = (combinedNet[id] ?? 0) + amt
                  }
                }
                const combinedSettlements = minimizeSettlements(payoutsData.players, combinedNet)

                return (
                  <>
                    {/* ── Daytona Results (collapsible) ── */}
                    {isDaytona && (
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
                              const pointTotals = computePlayerDaytonaPoints(holes, tScores, tAssign, daytonaVariant)
                              const { net: playerNet, settlements: playerSettlements } = settleDaytonaPlayerPoints(teamPlayers, pointTotals, dtPayoutValue)
                              return (
                                <div key={t.id} className={ti > 0 ? 'border-t border-gray-100' : ''}>
                                  <div className="px-4 py-2.5"><p className="font-semibold text-gray-900 text-sm">{t.name}</p><p className="text-xs text-gray-400">${dtPayoutValue}/point</p></div>
                                  <div className="divide-y divide-gray-100">
                                    {teamPlayers.map((p) => { const pts = pointTotals.get(p.id) ?? 0; const dollars = playerNet[p.id] ?? 0; return (
                                      <div key={p.id} className="flex items-center px-4 py-2.5 gap-2">
                                        <span className="flex-1 text-sm text-gray-900">{p.name}</span>
                                        <span className="text-sm font-semibold tabular-nums w-16 text-right" style={{ color: pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#6b7280' }}>{pts > 0 ? `+${pts}` : pts === 0 ? '0' : pts} pts</span>
                                        <span className="text-sm font-bold tabular-nums w-16 text-right" style={{ color: dollars > 0 ? '#16a34a' : dollars < 0 ? '#dc2626' : '#6b7280' }}>{dollars > 0 ? `+$${dollars.toFixed(2)}` : dollars < 0 ? `-$${Math.abs(dollars).toFixed(2)}` : 'Even'}</span>
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
                                        {nr ? (!nr.anySettled ? <span className="text-gray-300">Pending</span> : nr.winnerLabel === null ? <span className="text-gray-400 italic">Tied — push</span> : <span className="text-green-700">{nr.winnerLabel}</span>) : overallSeg ? (overallSeg.settled ? overallSeg.tied ? <span className="text-gray-400 italic">Tied — push</span> : <span className="text-green-700">{overallSeg.winnerLabel}</span> : <span className="text-gray-300">Pending</span>) : null}
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
                        <p className="text-xs text-gray-500">{isDaytona ? 'Daytona game' : 'Ball game'} + all matchup bets</p>
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
        {savedCount === 18 && (
          <div className="bg-white rounded-xl border-2 px-4 py-3 text-center" style={{ borderColor: gold }}>
            <p className="font-semibold" style={{ color: navy }}>All 18 holes submitted! ⛳</p>
            <button onClick={openPayoutsModal} className="text-sm underline mt-1 inline-block" style={{ color: gold }}>
              {roundComplete ? 'Final Payouts →' : 'View Payouts →'}
            </button>
          </div>
        )}

        {holes.map((hole) => {
          const isSaved = savedHoles.has(hole.hole_number)
          const isPending = pendingHoles.has(hole.hole_number)
          const isExpanded = expandedHole === hole.hole_number
          const error = errors[hole.hole_number]

          const savedHolePlayerScores = players.map((p) => {
            const sc = savedScores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)
            return sc?.strokes ?? hole.par
          })
          const holeBalls = !isDaytona ? computeHoleBallScores(savedHolePlayerScores, ballsCount) : []

          // Compute Left/Right DT for collapsed row using saved data
          const holeAssignments = assignments[hole.hole_number] ?? {}
          const savedLeftScores = players
            .filter((p) => holeAssignments[p.id] === 'left')
            .map((p) => savedScores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes)
            .filter((s): s is number => s !== undefined)
          const savedRightScores = players
            .filter((p) => holeAssignments[p.id] === 'right')
            .map((p) => savedScores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes)
            .filter((s): s is number => s !== undefined)
          const { leftDt, rightDt } = isDaytona
            ? computeHoleDaytonaWithSides(savedLeftScores, savedRightScores, hole.par)
            : { leftDt: null, rightDt: null }

          // For 5-man: compute DT for each of the 3 right-side pairs
          const savedRightPairDts: (number | null)[] = (() => {
            if (!is5Man) return []
            const rightPlayers = players.filter((p) => holeAssignments[p.id] === 'right')
            if (rightPlayers.length !== 3) return []
            return ([[0,1],[0,2],[1,2]] as [number,number][]).map(([a, b]) => {
              const pScores = [rightPlayers[a], rightPlayers[b]]
                .map((p) => savedScores.find((s) => s.player_id === p.id && s.hole_number === hole.hole_number)?.strokes)
                .filter((s): s is number => s !== undefined)
              return computeHoleDaytonaWithSides(savedLeftScores, pScores, hole.par).rightDt
            })
          })()

          // Per-player points for this hole (saved only)
          const holePlayerPoints: Map<string, number> = (() => {
            if (!isDaytona || !isSaved) return new Map()
            const leftIds = players.filter((p) => holeAssignments[p.id] === 'left').map((p) => p.id)
            const rightIds = players.filter((p) => holeAssignments[p.id] === 'right').map((p) => p.id)
            if (is5Man) {
              if (leftIds.length < 2 || rightIds.length < 3) return new Map()
              return computeHoleDaytonaPointsFiveMan(leftIds, rightIds, savedScores, hole.hole_number, hole.par)
            }
            const lScores = leftIds.map((id) => savedScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
            const rScores = rightIds.map((id) => savedScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
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

          // Live preview during edit
          const editLeftScores = players
            .filter((p) => holeAssignments[p.id] === 'left')
            .map((p) => strokes[p.id]?.[hole.hole_number] ?? hole.par)
          const editRightScores = players
            .filter((p) => holeAssignments[p.id] === 'right')
            .map((p) => strokes[p.id]?.[hole.hole_number] ?? hole.par)
          const { leftDt: liveLeftDt, rightDt: liveRightDt } = isDaytona
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
              className="bg-white rounded-xl border overflow-hidden"
              style={{ borderColor: isSaved ? gold : '#e5e7eb' }}>
              {/* Hole row */}
              <button
                type="button"
                className="w-full flex items-center px-4 py-3 gap-3 text-left"
                onClick={() => expandHole(hole.hole_number)}>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Hole</p>
                  <p className="font-bold text-gray-900">{hole.hole_number}</p>
                </div>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Par</p>
                  <p className="font-semibold text-gray-600">{hole.par}</p>
                </div>
                <div className="flex-1" />
                {isSaved && (
                  <div className="flex items-center gap-3 mr-2">
                    {isDaytona ? (
                      <>
                        <div className="text-center mr-3">
                          <p className="text-xs" style={{ color: '#2563eb' }}>{leftLabel}</p>
                          <p className="font-bold text-sm text-gray-900">{leftDt ?? '–'}</p>
                        </div>
                        {is5Man && savedRightPairDts.length === 3 ? (
                          <div className="text-center">
                            <p className="text-xs" style={{ color: '#92400e' }}>{rightLabel}</p>
                            <p className="font-bold text-sm text-gray-900">
                              {[...savedRightPairDts].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)).map((dt) => dt ?? '–').join('/')}
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="text-center">
                              <p className="text-xs" style={{ color: '#92400e' }}>{rightLabel}</p>
                              <p className="font-bold text-sm text-gray-900">{rightDt ?? '–'}</p>
                            </div>
                            {leftDt != null && rightDt != null && leftDt !== rightDt && (
                              <div className="text-center">
                                <p className="text-xs text-gray-400">Pts</p>
                                <p className="font-bold text-sm" style={{ color: leftDt < rightDt ? '#16a34a' : '#dc2626' }}>
                                  {leftDt < rightDt ? `${leftLabel[0]} +${rightDt - leftDt}` : `${rightLabel[0]} +${leftDt - rightDt}`}
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
                  <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded score entry */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                  {players.map((player) => {
                    const val = strokes[player.id]?.[hole.hole_number] ?? hole.par
                    const side = holeAssignments[player.id] ?? 'right'
                    return (
                      <div key={player.id} className="flex items-center gap-2">
                        {isDaytona && (
                          <button
                            type="button"
                            onClick={() => toggleSide(hole.hole_number, player.id)}
                            className="flex-shrink-0 text-xs font-bold px-2 py-1 rounded-lg border transition"
                            style={{
                              background: side === 'left' ? '#2563eb' : '#f3f4f6',
                              color: side === 'left' ? 'white' : '#6b7280',
                              borderColor: side === 'left' ? '#2563eb' : '#e5e7eb',
                              minWidth: '3rem',
                            }}>
                            {side === 'left' ? leftLabel : rightLabel}
                          </button>
                        )}
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate min-w-0">
                          {player.name}
                          {isDaytona && isSaved && (() => {
                            const pts = holePlayerPoints.get(player.id)
                            if (!pts) return null
                            return (
                              <span className="ml-1.5 text-xs font-semibold" style={{ color: pts > 0 ? '#16a34a' : '#dc2626' }}>
                                {pts > 0 ? `+${pts}` : pts}
                              </span>
                            )
                          })()}
                        </span>
                        <button type="button" onClick={() => setStroke(player.id, hole.hole_number, val - 1)}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 font-bold text-gray-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
                          −
                        </button>
                        <div className="w-11 flex items-center justify-center flex-shrink-0">
                          <ScoreNotation strokes={val} par={hole.par} />
                        </div>
                        <button type="button" onClick={() => setStroke(player.id, hole.hole_number, val + 1)}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 font-bold text-gray-700 flex items-center justify-center active:scale-90 transition flex-shrink-0">
                          +
                        </button>
                      </div>
                    )
                  })}

                  {isDaytona && leftCount !== 2 && (
                    <p className="text-xs text-red-500">Need exactly 2 on {leftLabel}</p>
                  )}

                  {error && <p className="text-xs text-red-500">{error}</p>}

                  <button
                    type="button"
                    onClick={() => saveHole(hole.hole_number)}
                    disabled={isPending || (isDaytona && leftCount !== 2)}
                    className="w-full mt-2 text-white py-2 rounded-lg font-semibold text-sm disabled:opacity-60 transition"
                    style={{ background: navy }}>
                    {isPending ? 'Saving…' : 'Save Hole'}
                  </button>
                </div>
              )}
            </div>

              {hole.hole_number === 9 && !isDaytona && (
                <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: navy }}>
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Front 9 Total</p>
                    {savedHoles.has(9) && (
                      <div className="flex items-center gap-3 mr-8">
                        {isDaytona ? (
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
              {hole.hole_number === 18 && !isDaytona && (
                <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: navy }}>
                  <div className="flex items-center px-4 py-3 gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 flex-1">Back 9 Total</p>
                    {savedHoles.has(18) && (
                      <div className="flex items-center gap-3 mr-8">
                        {isDaytona ? (
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

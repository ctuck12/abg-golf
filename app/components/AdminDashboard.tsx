'use client'

import { useActionState, useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  createRound, addTeam, addPlayer, deleteTeam, deletePlayer,
  toggleTeamAdmin, resetTeamScores, activateRound, updateHolePars, updateBallValues,
  adminLogout, renameTeam, renamePlayer, movePlayer,
} from '@/app/actions'
import {
  computeTeamBallSummary, calculatePoolPayouts,
  computeDaytonaSidesSummary, computePlayerDaytonaPoints, settleDaytonaPlayerPoints,
  type DaytonaHoleAssignment, type BallHalfResult,
} from '@/lib/scoring'
import PinLoginModal from './PinLoginModal'
import { supabase } from '@/lib/supabase'

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

// Match the server-side constants for course par preview
const COURSE_PARS_CLIENT: Record<string, number[]> = {
  north: [4, 4, 4, 3, 4, 4, 5, 3, 5, 3, 4, 4, 5, 3, 5, 4, 3, 4],
  south: [4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5, 4, 3, 4, 5],
}

type Round = { id: string; name: string; date: string; course: string; balls_count: number; format: string; daytona_variant: string | null; is_started: boolean; include_total: boolean } | null
type Team = { id: string; name: string; pin: string; is_admin: boolean }
type Player = { id: string; team_id: string; name: string; position: number | null }
type Hole = { hole_number: number; par: number }
type BallValue = { ball_number: number; value_dollars: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string }
type BestBallMatchup = {
  id: string
  team1_player1_id: string; team1_player2_id: string
  team2_player1_id: string; team2_player2_id: string
  bet: string
}
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
  label: string
  betLabel: string
  segments: MatchupPayoutSegment[]
  nassauResult?: {
    winnerLabel: string | null
    amount: number
    perPlayer: boolean
    anySettled: boolean
  }
}

// ── Matchup payout helpers ────────────────────────────────────────────────────
function parseMatchupBet(bet: string): { betType: MatchupBetType | ''; amount: string; scoringType: MatchupScoringType } {
  if (!bet) return { betType: '', amount: '', scoringType: 'stroke' }
  const parts = bet.split(':')
  if (parts.length >= 2 && (parts[0] === 'nassau' || parts[0] === 'straight')) {
    return { betType: parts[0] as MatchupBetType, amount: parts[1] ?? '', scoringType: parts[2] === 'match' ? 'match' : 'stroke' }
  }
  if (parts[0] === 'score' && parts.length >= 2) {
    return { betType: '', amount: '', scoringType: parts[1] === 'match' ? 'match' : 'stroke' }
  }
  return { betType: '', amount: '', scoringType: 'stroke' }
}

function formatMatchupBet(bet: string): string {
  const { betType, amount, scoringType } = parseMatchupBet(bet)
  const scoringLabel = scoringType === 'match' ? 'Match Play' : 'Stroke Play'
  if (betType === 'nassau' && amount) return `$${amount} Nassau · ${scoringLabel}`
  if (betType === 'nassau') return `Nassau · ${scoringLabel}`
  if (betType === 'straight' && amount) return `$${amount} Overall · ${scoringLabel}`
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
    const { betType, amount, scoringType } = parseMatchupBet(m.bet)
    const betAmt = parseFloat(amount)
    const hasBet = betType !== '' && !isNaN(betAmt) && betAmt > 0
    if (!hasBet) {
      rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }
    const stats = computeH2HStats(m.player1_id, m.player2_id, scoreMap, holes)
    const hole9 = scoreMap[m.player1_id]?.[9] != null && scoreMap[m.player2_id]?.[9] != null
    const hole18 = scoreMap[m.player1_id]?.[18] != null && scoreMap[m.player2_id]?.[18] != null
    const p1 = m.player1_id, p2 = m.player2_id
    const resolveH2H = (settled: boolean, sl: 'p1' | 'p2' | 'tie' | null, mpDiff: number): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const p1w = scoringType === 'match' ? mpDiff > 0 : sl === 'p1'
      const p2w = scoringType === 'match' ? mpDiff < 0 : sl === 'p2'
      if (p1w) { net[p1] = (net[p1] ?? 0) + betAmt; net[p2] = (net[p2] ?? 0) - betAmt; return { winnerLabel: mp1.name, tied: false } }
      if (p2w) { net[p2] = (net[p2] ?? 0) + betAmt; net[p1] = (net[p1] ?? 0) - betAmt; return { winnerLabel: mp2.name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segments: MatchupPayoutSegment[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.p1Front !== null && stats.p2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveH2H(fS, slH2H(stats.p1Front, stats.p2Front), stats.p1FrontWins - stats.p2FrontWins)
      segments.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: betAmt, perPlayer: false })
      const bS = hole18 && stats.p1Back !== null && stats.p2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveH2H(bS, slH2H(stats.p1Back, stats.p2Back), stats.p1BackWins - stats.p2BackWins)
      segments.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: betAmt, perPlayer: false })
    }
    const tS = hole18 && stats.p1Total !== null && stats.p2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveH2H(tS, slH2H(stats.p1Total, stats.p2Total), stats.p1Wins - stats.p2Wins)
    segments.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: betAmt, perPlayer: false })
    let nassauResult: MatchupPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const p1Net = segments.reduce((sum, s) => {
        if (!s.settled || s.tied || s.winnerLabel === null) return sum
        return sum + (s.winnerLabel === mp1.name ? s.amount : -s.amount)
      }, 0)
      nassauResult = { winnerLabel: p1Net > 0 ? mp1.name : p1Net < 0 ? mp2.name : null, amount: Math.abs(p1Net), perPlayer: false, anySettled: segments.some((s) => s.settled) }
    }
    rows.push({ id: m.id, label: `${mp1.name} vs ${mp2.name}`, betLabel: formatMatchupBet(m.bet), segments, nassauResult })
  }

  for (const m of bestBallMatchups) {
    const t1p1 = players.find((p) => p.id === m.team1_player1_id)
    const t1p2 = players.find((p) => p.id === m.team1_player2_id)
    const t2p1 = players.find((p) => p.id === m.team2_player1_id)
    const t2p2 = players.find((p) => p.id === m.team2_player2_id)
    if (!t1p1 || !t1p2 || !t2p1 || !t2p2) continue
    involvedIds.add(m.team1_player1_id); involvedIds.add(m.team1_player2_id)
    involvedIds.add(m.team2_player1_id); involvedIds.add(m.team2_player2_id)
    const { betType, amount, scoringType } = parseMatchupBet(m.bet)
    const betAmt = parseFloat(amount)
    const hasBet = betType !== '' && !isNaN(betAmt) && betAmt > 0
    const t1Name = `${t1p1.name.split(' ')[0]} & ${t1p2.name.split(' ')[0]}`
    const t2Name = `${t2p1.name.split(' ')[0]} & ${t2p2.name.split(' ')[0]}`
    if (!hasBet) {
      rows.push({ id: m.id, label: `${t1Name} vs ${t2Name}`, betLabel: 'No bet configured', segments: [] })
      continue
    }
    const stats = computeBBStats(m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id, scoreMap, holes)
    const t1Ids = [m.team1_player1_id, m.team1_player2_id]
    const t2Ids = [m.team2_player1_id, m.team2_player2_id]
    const hole9 = t1Ids.some((id) => scoreMap[id]?.[9] != null) && t2Ids.some((id) => scoreMap[id]?.[9] != null)
    const hole18 = t1Ids.some((id) => scoreMap[id]?.[18] != null) && t2Ids.some((id) => scoreMap[id]?.[18] != null)
    const resolveBB = (settled: boolean, sl: 't1' | 't2' | 'tie' | null, mpDiff: number): { winnerLabel: string | null; tied: boolean } => {
      if (!settled) return { winnerLabel: null, tied: false }
      const t1w = scoringType === 'match' ? mpDiff > 0 : sl === 't1'
      const t2w = scoringType === 'match' ? mpDiff < 0 : sl === 't2'
      if (t1w) { for (const id of t1Ids) net[id] = (net[id] ?? 0) + betAmt; for (const id of t2Ids) net[id] = (net[id] ?? 0) - betAmt; return { winnerLabel: t1Name, tied: false } }
      if (t2w) { for (const id of t2Ids) net[id] = (net[id] ?? 0) + betAmt; for (const id of t1Ids) net[id] = (net[id] ?? 0) - betAmt; return { winnerLabel: t2Name, tied: false } }
      return { winnerLabel: null, tied: true }
    }
    const segments: MatchupPayoutSegment[] = []
    if (betType === 'nassau') {
      const fS = hole9 && stats.t1Front !== null && stats.t2Front !== null
      const { winnerLabel: fWL, tied: fT } = resolveBB(fS, slBB(stats.t1Front, stats.t2Front), stats.t1FrontWins - stats.t2FrontWins)
      segments.push({ name: 'Front', settled: fS, winnerLabel: fWL, tied: fT, amount: betAmt, perPlayer: true })
      const bS = hole18 && stats.t1Back !== null && stats.t2Back !== null
      const { winnerLabel: bWL, tied: bT } = resolveBB(bS, slBB(stats.t1Back, stats.t2Back), stats.t1BackWins - stats.t2BackWins)
      segments.push({ name: 'Back', settled: bS, winnerLabel: bWL, tied: bT, amount: betAmt, perPlayer: true })
    }
    const tS = hole18 && stats.t1Total !== null && stats.t2Total !== null
    const { winnerLabel: tWL, tied: tT } = resolveBB(tS, slBB(stats.t1Total, stats.t2Total), stats.t1Wins - stats.t2Wins)
    segments.push({ name: 'Total', settled: tS, winnerLabel: tWL, tied: tT, amount: betAmt, perPlayer: true })
    let nassauResultBB: MatchupPayoutRow['nassauResult']
    if (betType === 'nassau') {
      const t1Net = segments.reduce((sum, s) => {
        if (!s.settled || s.tied || s.winnerLabel === null) return sum
        return sum + (s.winnerLabel === t1Name ? s.amount : -s.amount)
      }, 0)
      nassauResultBB = { winnerLabel: t1Net > 0 ? t1Name : t1Net < 0 ? t2Name : null, amount: Math.abs(t1Net), perPlayer: true, anySettled: segments.some((s) => s.settled) }
    }
    rows.push({ id: m.id, label: `${t1Name} vs ${t2Name}`, betLabel: formatMatchupBet(m.bet), segments, nassauResult: nassauResultBB })
  }

  return { rows, net, involvedIds }
}

export default function AdminDashboard({
  round, teams, players, holes, ballValues, scores, scorecardTeamId = null, dtAssignments = [],
  matchups = [], bestBallMatchups = [],
}: {
  round: Round; teams: Team[]; players: Player[]; holes: Hole[]; ballValues: BallValue[]; scores: Score[]; scorecardTeamId?: string | null; dtAssignments?: DaytonaHoleAssignment[]
  matchups?: SavedMatchup[]; bestBallMatchups?: BestBallMatchup[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'teams' | 'setup' | 'payouts'>(!round ? 'setup' : 'teams')
  const [showPinModal, setShowPinModal] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [renamingTeam, setRenamingTeam] = useState<string | null>(null)
  const [renamingPlayer, setRenamingPlayer] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState('north')
  const [selectedFormat, setSelectedFormat] = useState('standard')
  const [selectedDaytonaCount, setSelectedDaytonaCount] = useState('4')
  const [selectedDaytonaSubVariant, setSelectedDaytonaSubVariant] = useState('normal')
  const [createIncludeTotal, setCreateIncludeTotal] = useState(false)
  const [showDaytonaResults, setShowDaytonaResults] = useState(false)
  const [showMatchupResults, setShowMatchupResults] = useState(false)
  const [newRoundName, setNewRoundName] = useState('')
  const [newRoundDate, setNewRoundDate] = useState('')
  const [valueSaved, setValueSaved] = useState(false)
  const [showStartTooltip, setShowStartTooltip] = useState(false)
  const computedDaytonaVariant = selectedDaytonaCount === '5'
    ? `5man-${selectedDaytonaSubVariant}`
    : '4man'

  const [createState, createAction, createPending] = useActionState(createRound, null)
  const [addTeamState, addTeamAction, addTeamPending] = useActionState(addTeam, null)
  const [addPlayerState, addPlayerAction, addPlayerPending] = useActionState(addPlayer, null)
  const [parState, parAction, parPending] = useActionState(updateHolePars, null)
  const [ballState, ballAction, ballPending] = useActionState(updateBallValues, null)
  const [renameState, renameAction, renamePending] = useActionState(renameTeam, null)
  const [renamePlayerState, renamePlayerAction, renamePlayerPending] = useActionState(renamePlayer, null)

  // Refresh server data after mutations so the UI updates without a manual reload.
  useEffect(() => {
    if (createState?.success) { router.refresh(); setTab('teams'); setNewRoundName(''); setNewRoundDate(''); setValueSaved(false) }
  }, [createState])
  useEffect(() => {
    if (addTeamState?.success) router.refresh()
  }, [addTeamState])
  useEffect(() => {
    if (addPlayerState?.success) router.refresh()
  }, [addPlayerState])
  useEffect(() => {
    if (renameState?.success) { router.refresh(); setRenamingTeam(null) }
  }, [renameState])
  useEffect(() => {
    if (renamePlayerState?.success) { router.refresh(); setRenamingPlayer(null) }
  }, [renamePlayerState])
  useEffect(() => {
    if (parState?.success) router.refresh()
  }, [parState])
  useEffect(() => {
    if (ballState?.success) router.refresh()
  }, [ballState])

  useEffect(() => {
    setValueSaved(false)
    if (selectedFormat !== 'daytona') {
      // If the stored value looks like a Daytona per-point amount (< $1), reset to the $5 standard default
      setBallVals((prev) => {
        const cur = prev[1] ?? 0
        return cur < 1 ? { ...prev, 1: 5 } : prev
      })
    }
  }, [selectedFormat])

  // Sync live state when server props refresh (router.refresh triggers re-render with new props)
  useEffect(() => { setLiveMatchups(matchups) }, [matchups])
  useEffect(() => { setLiveBestBallMatchups(bestBallMatchups) }, [bestBallMatchups])
  useEffect(() => { setLiveScores(scores) }, [scores])

  // Real-time subscriptions — auto-recalculate settlements on any matchup or score change
  useEffect(() => {
    if (!round?.id) return
    const rid = round.id
    const playerIds = players.map((p) => p.id)

    const ch1 = supabase.channel('admin-live-matchups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchups' }, async () => {
        const { data } = await supabase.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', rid).order('created_at')
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

    return () => {
      supabase.removeChannel(ch1)
      supabase.removeChannel(ch2)
      supabase.removeChannel(ch3)
    }
  }, [round?.id])

  const [pars, setPars] = useState<Record<number, number>>(
    Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, holes.find((h) => h.hole_number === i + 1)?.par ?? 4]))
  )
  const [ballVals, setBallVals] = useState<Record<number, number>>(
    Object.fromEntries(ballValues.map((bv) => [bv.ball_number, bv.value_dollars]))
  )

  // Live state — kept in sync with server props and updated by real-time subscriptions
  const [liveMatchups, setLiveMatchups] = useState(matchups)
  const [liveBestBallMatchups, setLiveBestBallMatchups] = useState(bestBallMatchups)
  const [liveScores, setLiveScores] = useState(scores)

  const parTotal = Object.values(pars).reduce((a, b) => a + b, 0)
  const ballsCount = round?.balls_count ?? 3
  const isDaytona = round?.format === 'daytona'
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

  const combinedDaytonaNet = useMemo(() => {
    if (!isDaytona) return {}
    const allNet: Record<string, number> = {}
    for (const team of teams) {
      const tp = players.filter((p) => p.team_id === team.id)
      const tpIds = tp.map((p) => p.id)
      const tAssign = dtAssignments.filter((a) => tpIds.includes(a.player_id))
      const tScores = liveScores.filter((s) => tpIds.includes(s.player_id))
      const pts = computePlayerDaytonaPoints(holes, tScores, tAssign, round?.daytona_variant ?? '4man')
      const { net: pNet } = settleDaytonaPlayerPoints(tp, pts, dtPayoutValue)
      for (const [id, amt] of Object.entries(pNet)) allNet[id] = (allNet[id] ?? 0) + amt
    }
    for (const p of players) {
      allNet[p.id] = (allNet[p.id] ?? 0) + (matchupData.net[p.id] ?? 0)
    }
    return allNet
  }, [isDaytona, teams, players, dtAssignments, liveScores, holes, dtPayoutValue, matchupData, round])

  const combinedSettlements = useMemo(
    () => minimizeSettlements(players, combinedDaytonaNet),
    [players, combinedDaytonaNet]
  )

  const combinedStandardNet = useMemo(() => {
    if (isDaytona) return {} as Record<string, number>
    const net: Record<string, number> = {}
    for (const p of players) {
      net[p.id] = (poolResults.playerNet[p.id] ?? 0) + (matchupData.net[p.id] ?? 0)
    }
    return net
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDaytona, players, poolResults.playerNet, matchupData.net])

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
  const canStartRound = startMissingItems.length === 0

  const tabs = ['teams', 'setup', 'payouts'] as const

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {showPinModal && <PinLoginModal teams={teams} onClose={() => setShowPinModal(false)} />}
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Admin</p>
            <h1 className="font-bold text-lg">Anything But Golf Group</h1>
          </div>
          <div className="flex items-center gap-2">
            {scorecardTeamId ? (
              <a href={`/score/${scorecardTeamId}`}
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
                Team Pin
              </button>
            )}
            <a href="/" className="text-xs px-3 py-1.5 rounded-lg border border-white/30 hover:bg-white/10 text-white">Leaderboard</a>
            <form action={adminLogout}>
              <button type="submit" className="text-xs px-3 py-1.5 rounded-lg border border-white/30 hover:bg-white/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-4">

        {/* Active Round banner */}
        {round ? (
          <div className="bg-white border-l-4 rounded-xl px-4 py-3 mb-4 shadow-sm" style={{ borderColor: round.is_started ? '#16a34a' : gold }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-semibold text-gray-900 truncate">{round.name}</p>
                  {round.is_started ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={isComplete ? { background: '#fee2e2', color: '#dc2626' } : { background: '#dcfce7', color: '#15803d' }}>
                      {isComplete ? '● Complete' : '● Active'}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>Setup</span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {round.course && `${round.course} · `}
                  {new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' · '}{teams.length} teams · Par {parTotal}
                  {' · '}{isDaytona
                    ? round?.daytona_variant === '5man-normal' ? 'Daytona 5-Man Normal'
                      : round?.daytona_variant === '5man-flares' ? 'Daytona 5-Man Flares'
                      : 'Daytona 4-Man'
                    : `${ballsCount}-ball${roundIncludeTotal ? ' + total' : ''}`}
                </p>
              </div>
              {!round.is_started && (
                <form action={activateRound.bind(null, round.id)} className="flex-shrink-0">
                  <button type="submit"
                    className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition"
                    style={{ background: '#16a34a' }}>
                    Activate Round
                  </button>
                </form>
              )}
            </div>
            {!round.is_started && (
              <p className="text-xs text-amber-700 mt-2">
                Set up teams and pars below, then click "Activate Round" to make the leaderboard public.
              </p>
            )}
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-amber-800 font-medium text-sm">No active round. Create one in the Setup tab.</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-200 rounded-xl p-1">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition"
              style={tab === t ? { background: navy, color: 'white' } : { color: '#4b5563' }}>
              {t === 'payouts' ? '$ Payouts' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ── TEAMS ────────────────────────────────────────────────────── */}
        {tab === 'teams' && round && (
          <div className="space-y-4">
            {/* Add team */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-3 text-sm">Add New Team</h3>
              <form action={addTeamAction} className="space-y-2">
                <input type="hidden" name="roundId" value={round.id} />
                {addTeamState?.error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{addTeamState.error}</p>}
                {addTeamState?.success && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Team added!</p>}
                <div className="flex gap-2">
                  <input type="text" name="name" placeholder="Team name" required
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  <input type="text" name="pin" placeholder="PIN" maxLength={4} inputMode="numeric" required
                    className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none" />
                  <button type="submit" disabled={addTeamPending}
                    className="text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                    style={{ background: navy }}>Add</button>
                </div>
                <p className="text-xs text-gray-400">PIN must be 4 digits — share this with the team.</p>
              </form>
            </div>

            {/* Teams list */}
            {teams.map((team) => {
              const teamPlayers = players.filter((p) => p.team_id === team.id)
              const isSelected = selectedTeam === team.id
              const isRenaming = renamingTeam === team.id
              return (
                <div key={team.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3">
                    {isRenaming ? (
                      <form action={renameAction} className="flex gap-2" onSubmit={() => setRenamingTeam(null)}>
                        <input type="hidden" name="teamId" value={team.id} />
                        {renameState?.error && <p className="text-xs text-red-500">{renameState.error}</p>}
                        <input type="text" name="name" defaultValue={team.name} required autoFocus
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                        <button type="submit" disabled={renamePending}
                          className="text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
                          style={{ background: navy }}>Save</button>
                        <button type="button" onClick={() => setRenamingTeam(null)}
                          className="text-gray-500 px-3 py-1.5 rounded-lg text-sm border border-gray-300">Cancel</button>
                      </form>
                    ) : (
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{team.name}</p>
                          <p className="text-xs text-gray-500">
                            PIN: <span className="font-mono font-bold text-gray-800">{team.pin}</span>
                            {' · '}{teamPlayers.length} player{teamPlayers.length !== 1 ? 's' : ''}
                            {team.is_admin && <span className="ml-1 text-amber-600 font-medium">· Admin</span>}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => setRenamingTeam(team.id)}
                            className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                            Rename
                          </button>
                          <button onClick={() => setSelectedTeam(isSelected ? null : team.id)}
                            className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                            {isSelected ? 'Close' : 'Players'}
                          </button>
                          <button type="button" onClick={() => handleToggleAdmin(team.id, !team.is_admin)}
                            className="text-xs border px-2 py-1 rounded"
                            style={team.is_admin
                              ? { background: gold, borderColor: gold, color: navy }
                              : { borderColor: gold, color: '#6b7280' }}>
                            {team.is_admin ? 'Revoke Admin' : 'Make Admin'}
                          </button>
                          <button type="button" onClick={() => handleDeleteTeam(team.id)}
                            className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-50">
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {isSelected && (
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
                              <div className="flex flex-col gap-0.5 mr-1">
                                <button
                                  type="button"
                                  disabled={pi === 0}
                                  onClick={() => handleMovePlayer(p.id, 'up')}
                                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition text-xs leading-none"
                                >▲</button>
                                <button
                                  type="button"
                                  disabled={pi === teamPlayers.length - 1}
                                  onClick={() => handleMovePlayer(p.id, 'down')}
                                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition text-xs leading-none"
                                >▼</button>
                              </div>
                              <span className="flex-1 text-sm text-gray-800 font-medium">{p.name}</span>
                              <button type="button" onClick={() => setRenamingPlayer(p.id)}
                                className="text-xs text-blue-500 hover:text-blue-700">Rename</button>
                              <button type="button" onClick={() => handleDeletePlayer(p.id)}
                                className="text-xs text-red-500 hover:text-red-700 ml-1">Remove</button>
                            </div>
                          )}
                        </div>
                      ))}
                      <form action={addPlayerAction} className="flex gap-2 mt-2">
                        <input type="hidden" name="teamId" value={team.id} />
                        {addPlayerState?.error && <p className="text-xs text-red-500 w-full">{addPlayerState.error}</p>}
                        <input type="text" name="name" placeholder="Player name" required
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                        <button type="submit" disabled={addPlayerPending}
                          className="text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
                          style={{ background: navy }}>Add</button>
                      </form>
                      <button type="button" onClick={() => handleResetScores(team.id)}
                        className="text-xs text-orange-600 border border-orange-200 px-2 py-1 rounded hover:bg-orange-50 mt-1">
                        Reset All Scores
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── SETUP ────────────────────────────────────────────────────── */}
        {tab === 'setup' && (
          <div className="space-y-4">
            {/* Create round */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-1 text-sm">
                {round ? 'Start New Round' : 'Set Up Round'}
              </h3>
              {round && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3">
                  This will end the current round and start a new one.
                </p>
              )}
              {createState?.error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mb-2">{createState.error}</p>}
              {createState?.success && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2 mb-2">Round created! Add teams and activate when ready.</p>}
              <form action={createAction} className="space-y-3">
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
                      <option value="standard">Standard (Best Balls)</option>
                      <option value="daytona">Daytona</option>
                    </select>
                  </div>
                </div>
                {selectedFormat === 'daytona' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Daytona Type</label>
                      <select value={selectedDaytonaCount} onChange={(e) => setSelectedDaytonaCount(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                        <option value="4">4-Man</option>
                        <option value="5">5-Man</option>
                      </select>
                    </div>
                    {selectedDaytonaCount === '5' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">5-Man Variant</label>
                        <select value={selectedDaytonaSubVariant} onChange={(e) => setSelectedDaytonaSubVariant(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                          <option value="normal">Normal</option>
                          <option value="flares">Flares</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}
                <input type="hidden" name="daytona_variant" value={computedDaytonaVariant} />
                {selectedFormat !== 'daytona' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Balls in Play</label>
                      <select name="ballsCount" defaultValue="3"
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
                    <option value="north">North Course (Par 71)</option>
                    <option value="south">South Course (Par 72)</option>
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
                  <button type="submit" disabled={!canStartRound || createPending}
                    className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition"
                    style={{ background: navy, cursor: !canStartRound ? 'not-allowed' : undefined }}>
                    {createPending ? 'Creating…' : round ? 'Start New Round' : 'Create Round'}
                  </button>
                </div>
              </form>
            </div>

            {/* Par per hole */}
            {round && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 text-sm">Par Per Hole</h3>
                  <span className="text-xs text-gray-500">Total: Par {parTotal}</span>
                </div>
                <form action={parAction} className="space-y-3">
                  <input type="hidden" name="roundId" value={round.id} />
                  {parState?.success && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Pars saved!</p>}
                  <div className="grid grid-cols-9 gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((hole) => (
                      <div key={hole} className="text-center">
                        <p className="text-xs text-gray-400 mb-0.5">{hole}</p>
                        <select name={`par_${hole}`} value={pars[hole] ?? 4}
                          onChange={(e) => setPars((p) => ({ ...p, [hole]: parseInt(e.target.value) }))}
                          className="w-full border border-gray-200 rounded px-0 py-1 text-xs text-center focus:outline-none bg-gray-50">
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-9 gap-1">
                    {[10, 11, 12, 13, 14, 15, 16, 17, 18].map((hole) => (
                      <div key={hole} className="text-center">
                        <p className="text-xs text-gray-400 mb-0.5">{hole}</p>
                        <select name={`par_${hole}`} value={pars[hole] ?? 4}
                          onChange={(e) => setPars((p) => ({ ...p, [hole]: parseInt(e.target.value) }))}
                          className="w-full border border-gray-200 rounded px-0 py-1 text-xs text-center focus:outline-none bg-gray-50">
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  <button type="submit" disabled={parPending}
                    className="w-full text-white py-2 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                    style={{ background: navy }}>
                    {parPending ? 'Saving…' : 'Save Pars'}
                  </button>
                </form>
              </div>
            )}

            {/* Ball / Daytona values */}
            {round && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">
                  {selectedFormat === 'daytona' ? 'Daytona Payout Value' : 'Per Ball Payout Value'}
                </h3>
                <form action={ballAction} onSubmit={() => setValueSaved(true)} className="space-y-3">
                  <input type="hidden" name="roundId" value={round.id} />
                  <input type="hidden" name="ballsCount" value={selectedFormat === 'daytona' ? 1 : round.balls_count} />
                  {ballState?.success && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Values saved!</p>}
                  {selectedFormat === 'daytona' ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Value Per Point ($)</label>
                      <input type="number" name="ball_1" min="0" step="0.25"
                        value={ballVals[1] ?? 1}
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
          </div>
        )}

        {/* ── PAYOUTS ──────────────────────────────────────────────────── */}
        {tab === 'payouts' && round && (
          <div className="space-y-4">
            {isDaytona ? (
              /* ── Daytona per-player point tracking ── */
              <>
                {/* Collapsible "Daytona Results" section */}
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setShowDaytonaResults((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-sm font-semibold text-gray-800">Daytona Results</span>
                    <span className="text-gray-400 text-xs">{showDaytonaResults ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {showDaytonaResults && (
                    <div className="border-t border-gray-100 space-y-0">
                      {teams.map((team, teamIdx) => {
                        const teamPlayers = players.filter((p) => p.team_id === team.id)
                        const teamPlayerIds = teamPlayers.map((p) => p.id)
                        const teamAssignments = dtAssignments.filter((a) => teamPlayerIds.includes(a.player_id))
                        const teamScores = liveScores.filter((s) => teamPlayerIds.includes(s.player_id))
                        const pointTotals = computePlayerDaytonaPoints(holes, teamScores, teamAssignments, round?.daytona_variant ?? '4man')
                        const { net: playerNet, settlements: playerSettlements } = settleDaytonaPlayerPoints(
                          teamPlayers, pointTotals, dtPayoutValue
                        )
                        return (
                          <div key={team.id} className={teamIdx > 0 ? 'border-t border-gray-100' : ''}>
                            <div className="px-4 py-2.5">
                              <h3 className="font-semibold text-gray-900 text-sm">{team.name}</h3>
                              <p className="text-xs text-gray-400">${dtPayoutValue}/point</p>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {teamPlayers.map((p) => {
                                const pts = pointTotals.get(p.id) ?? 0
                                const dollars = playerNet[p.id] ?? 0
                                return (
                                  <div key={p.id} className="flex items-center px-4 py-2.5 gap-2">
                                    <span className="flex-1 text-sm text-gray-900">{p.name}</span>
                                    <span className="text-sm font-semibold tabular-nums w-16 text-right"
                                      style={{ color: pts > 0 ? '#16a34a' : pts < 0 ? '#dc2626' : '#6b7280' }}>
                                      {pts > 0 ? `+${pts}` : pts === 0 ? '0' : pts} pts
                                    </span>
                                    <span className="text-sm font-bold tabular-nums w-16 text-right"
                                      style={{ color: dollars > 0 ? '#16a34a' : dollars < 0 ? '#dc2626' : '#6b7280' }}>
                                      {dollars > 0 ? `+$${dollars.toFixed(2)}` : dollars < 0 ? `-$${Math.abs(dollars).toFixed(2)}` : 'Even'}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                            {playerSettlements.length > 0 && (
                              <div className="border-t border-gray-100 px-4 py-3">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Settlement</p>
                                {playerSettlements.map((s, i) => (
                                  <div key={i} className="flex items-center py-1 gap-2 text-sm">
                                    <span className="flex-1">
                                      <span className="font-semibold text-red-600">{s.fromName}</span>
                                      {' pays '}
                                      <span className="font-semibold text-green-700">{s.toName}</span>
                                    </span>
                                    <span className="font-bold text-gray-900">${s.amount.toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {playerSettlements.length === 0 && teamPlayers.length > 0 && (
                              <p className="text-xs text-gray-400 text-center py-3">
                                {[...pointTotals.values()].every((v) => v === 0) ? 'No holes scored yet.' : 'All even — no payments needed.'}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* ── Standard ball results ── */
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900 text-sm">Ball Results</h3>
                  <p className="text-xs text-gray-500">{ballsCount * numSegments} results total · ties wash · ${perBallValue}/player · {players.length}P pool (${poolResults.perBallResult.toFixed(0)}/win)</p>
                </div>
                <div className="px-4 py-4 space-y-4">
                  {Array.from({ length: ballsCount }, (_, bi) => {
                    const front = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Front 9')
                    const back = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Back 9')
                    const total = roundIncludeTotal ? ballResults.find((r) => r.ball === bi + 1 && r.half === 'Total 18') : undefined
                    const segments = roundIncludeTotal ? [front, back, total] : [front, back]
                    return (
                      <div key={bi}>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: gold }}>
                          {BALL_NAMES[bi]}
                        </p>
                        <div className={`grid gap-2 ${roundIncludeTotal ? 'grid-cols-3' : 'grid-cols-2'}`}>
                          {segments.map((result, hi) => {
                            if (!result) return <div key={hi} />
                            const vp = result.winnerVsPar
                            const vpStr = vp == null ? '' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                            const halfLabel = result.half === 'Total 18' ? 'Total' : result.half === 'Front 9' ? 'Front' : 'Back'
                            return (
                              <div key={hi} className="bg-gray-50 rounded-lg px-3 py-2">
                                <p className="text-xs text-gray-500 mb-0.5">{halfLabel}</p>
                                {!result.played ? (
                                  <p className="text-sm text-gray-300 font-medium">–</p>
                                ) : result.tied ? (
                                  <p className="text-sm text-gray-500 font-medium">Tie</p>
                                ) : (
                                  <>
                                    <p className="text-sm font-semibold text-green-700 truncate">{result.winnerName}</p>
                                    {vpStr && <p className="text-xs text-gray-400">{vpStr}</p>}
                                  </>
                                )}
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

            {/* Matchup Results — collapsible */}
            {matchupData.rows.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Collapsible header */}
                <button
                  onClick={() => setShowMatchupResults((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold text-gray-800">Matchup Results</span>
                  <span className="text-gray-400 text-xs">{showMatchupResults ? '▲ Hide' : '▼ Show'}</span>
                </button>
                {showMatchupResults && <div className="border-t border-gray-100">
                {/* Matchup result rows */}
                {matchupData.rows.map((row, rowIdx) => {
                  const nr = row.nassauResult
                  const fmtAmt = nr ? (nr.amount % 1 === 0 ? String(nr.amount) : nr.amount.toFixed(2)) : ''
                  const overallSeg = !nr && row.segments.length === 1 ? row.segments[0] : null
                  return (
                    <div key={row.id} className={rowIdx > 0 ? 'border-t border-gray-100' : ''}>
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-sm font-bold text-gray-800 leading-snug">{row.label}</p>
                        <p className="text-xs font-medium mt-0.5" style={{ color: row.segments.length === 0 ? '#9ca3af' : gold }}>{row.betLabel}</p>
                      </div>
                      {row.segments.length === 0 ? (
                        <p className="px-4 pb-3 text-xs text-gray-400 italic">No bet amount set</p>
                      ) : (
                        <div className="flex items-center justify-between px-4 pb-3 pt-1 bg-gray-50 mx-3 mb-3 rounded-lg">
                          <span className="text-xs font-bold text-gray-400 mr-3">Result</span>
                          <span className="text-xs font-semibold flex-1">
                            {nr
                              ? (!nr.anySettled
                                  ? <span className="text-gray-300">Pending</span>
                                  : nr.winnerLabel === null
                                    ? <span className="text-gray-400 italic">Tied — push</span>
                                    : <span className="text-green-700">{nr.winnerLabel}</span>)
                              : overallSeg
                                ? (overallSeg.settled
                                    ? overallSeg.tied
                                      ? <span className="text-gray-400 italic">Tied — push</span>
                                      : <span className="text-green-700">{overallSeg.winnerLabel}</span>
                                    : <span className="text-gray-300">Pending</span>)
                                : null}
                          </span>
                          <span className="text-xs font-bold whitespace-nowrap">
                            {nr && nr.anySettled && nr.winnerLabel !== null
                              ? <span className="text-green-600">+${fmtAmt}{nr.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span>
                              : overallSeg && overallSeg.settled && !overallSeg.tied
                                ? <span className="text-green-600">+${overallSeg.amount % 1 === 0 ? overallSeg.amount : overallSeg.amount.toFixed(2)}{overallSeg.perPlayer ? <span className="font-normal text-green-500">/player</span> : ''}</span>
                                : null}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Net Positions + Settlements — only when at least one result is settled */}
                {matchupData.rows.some((r) => r.segments.some((s) => s.settled)) && (
                  <>
                    <div className="border-t-2 border-gray-200 px-4 pt-3 pb-2">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Net Positions</p>
                      <div className="space-y-1">
                        {[...players]
                          .filter((p) => matchupData.involvedIds.has(p.id))
                          .sort((a, b) => (matchupData.net[b.id] ?? 0) - (matchupData.net[a.id] ?? 0))
                          .map((p) => {
                            const v = Math.round((matchupData.net[p.id] ?? 0) * 100) / 100
                            return (
                              <div key={p.id} className="flex items-center justify-between">
                                <span className="text-xs text-gray-700">{p.name}</span>
                                <span className="text-xs font-bold tabular-nums" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#6b7280' }}>
                                  {v > 0 ? `+$${v.toFixed(2)}` : v < 0 ? `-$${Math.abs(v).toFixed(2)}` : 'Even'}
                                </span>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                    <div className="border-t border-gray-100 px-4 py-3">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Settlements</p>
                      {matchupOnlySettlements.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center">All even — no payments needed</p>
                      ) : matchupOnlySettlements.map((s, i) => (
                        <div key={i} className="flex items-center justify-between py-1">
                          <span className="text-xs text-gray-800">
                            <span className="font-semibold text-red-500">{s.fromName}</span>
                            <span className="text-gray-400"> pays </span>
                            <span className="font-semibold text-green-600">{s.toName}</span>
                          </span>
                          <span className="text-xs font-bold text-gray-900">${s.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                </div>}
              </div>
            )}

            {/* Player Net + Combined Settlements — standard format only */}
            {!isDaytona && (
              <>
                {/* Player Net: ball game + matchup bets combined */}
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900 text-sm">Player Net</h3>
                    <p className="text-xs text-gray-500">Ball game + matchup bets · per player</p>
                  </div>
                  {players.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">No players yet.</p>
                  ) : (
                    [...players].sort((a, b) => (combinedStandardNet[b.id] ?? 0) - (combinedStandardNet[a.id] ?? 0)).map((p) => {
                      const amt = combinedStandardNet[p.id] ?? 0
                      const teamName = teams.find((t) => t.id === p.team_id)?.name ?? ''
                      return (
                        <div key={p.id} className="flex items-center px-4 py-2.5 border-b border-gray-100 last:border-0">
                          <span className="flex-1 text-sm text-gray-900">
                            {p.name}
                            {teamName && <span className="text-xs text-gray-400 ml-1.5">({teamName})</span>}
                          </span>
                          <span className="font-bold tabular-nums text-sm"
                            style={{ color: amt > 0 ? '#16a34a' : amt < 0 ? '#dc2626' : '#6b7280' }}>
                            {amt === 0 ? 'Even' : amt > 0 ? `+$${amt.toFixed(2)}` : `-$${Math.abs(amt).toFixed(2)}`}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Combined Settlements: ball game + all matchup bets */}
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900 text-sm">Combined Settlements</h3>
                    <p className="text-xs text-gray-500">Ball game + all matchup bets</p>
                  </div>
                  {combinedStandardSettlements.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">No payouts yet.</p>
                  ) : combinedStandardSettlements.map((s, i) => (
                    <div key={i} className="flex items-center px-4 py-2.5 border-b border-gray-100 last:border-0 gap-2">
                      <span className="flex-1 text-sm text-gray-900">
                        <span className="font-semibold text-red-600">{s.fromName}</span>
                        {' pays '}
                        <span className="font-semibold text-green-700">{s.toName}</span>
                      </span>
                      <span className="font-bold text-gray-900">${s.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Combined Settlements (Daytona + Matchups) */}
            {isDaytona && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900 text-sm">Combined Settlements</h3>
                  <p className="text-xs text-gray-500">Daytona game + all matchup bets</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {[...players].sort((a, b) => (combinedDaytonaNet[b.id] ?? 0) - (combinedDaytonaNet[a.id] ?? 0)).map((p) => {
                    const amt = combinedDaytonaNet[p.id] ?? 0
                    return (
                      <div key={p.id} className="flex items-center px-4 py-2.5 gap-2">
                        <span className="flex-1 text-sm text-gray-900">{p.name}</span>
                        <span className="text-sm font-bold tabular-nums"
                          style={{ color: amt > 0 ? '#16a34a' : amt < 0 ? '#dc2626' : '#6b7280' }}>
                          {amt > 0 ? `+$${amt.toFixed(2)}` : amt < 0 ? `-$${Math.abs(amt).toFixed(2)}` : 'Even'}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {combinedSettlements.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4 border-t border-gray-100">All even — no payments needed.</p>
                ) : (
                  <div className="border-t border-gray-200 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Who Pays Who</p>
                    {combinedSettlements.map((s, i) => (
                      <div key={i} className="flex items-center py-1.5 gap-2 text-sm border-b border-gray-50 last:border-0">
                        <span className="flex-1">
                          <span className="font-semibold text-red-600">{s.fromName}</span>
                          {' pays '}
                          <span className="font-semibold text-green-700">{s.toName}</span>
                        </span>
                        <span className="font-bold text-gray-900">${s.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  )
}

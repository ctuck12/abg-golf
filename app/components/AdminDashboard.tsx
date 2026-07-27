'use client'

import { useActionState, useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  createRound, addTeam, addPlayer, deleteTeam, deletePlayer,
  toggleTeamAdmin, resetTeamScores, activateRound, updateHolePars, updateBallValues,
  adminLogout, renameTeam, renamePlayer, movePlayer,
  updateSkinsSettings, updatePlayerSkinsParticipation, updateTeamSettings,
  updatePlayerHandicap,
  updatePlayerHolesRange,
  clearAllScores,
  updateRoundAutoHandicap,
  updateRoundHandicapRounding,
  toggleMixedGroups,
  setPlayingGroupCount,
  createPlayingGroup,
  deletePlayingGroup,
  setPlayerGroup,
  createRosterPlayer,
  updateRosterPlayer,
  deleteRosterPlayer,
  addRosterPlayersToTeam,
  createHammerMatchup,
  deleteHammerMatchup,
  bulkCreateTeams,
  addManualPlayerToGroup,
  removeManualPlayerFromGroup,
  updatePlayingGroupSettings,
  setRoundExcludeMatchups,
  updateRoundName,
} from '@/app/actions'
import {
  computeTeamBallSummary, calculatePoolPayouts,
  computeDaytonaSidesSummary, settleDaytonaPlayerPoints,
  computeBBStrokeHoles, applyPlayerStrokesToScoreMap,
  pressForfeitMap, type PressForfeit,
  computeMedley, type MedleyMatchup,
  computePlayerDaytonaDollarsSplit,
  computeSkinsResults,
  computeSkinsPotResults,
  playerCoversHole,
  type DaytonaHoleAssignment, type BallHalfResult, type SkinResult,
  computeAllMatchupPayouts,
} from '@/lib/scoring'
import PinLoginModal from './PinLoginModal'

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

// Auto-generated PINs always default to 1234 — admins change them if they want
function randomPin(): string {
  return '1234'
}

function generateBalancedTeams(players: GeneratedPlayer[], numTeams: number, rng?: () => number): GeneratedTeam[] {
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

type Round = { id: string; name: string; date: string; course: string; balls_count: number; format: string; daytona_variant: string | null; is_started: boolean; include_total: boolean; skins_enabled: boolean; skins_amount: number; skins_mode?: string | null; auto_handicap?: boolean; handicap_rounding?: string | null; banker_min_bet?: number | null; mixed_groups?: boolean; playing_group_count?: number; exclude_matchups?: boolean } | null
type PlayingGroup = { id: string; name: string; pin: string; daytona_variant?: string | null; banker_side_game?: boolean; banker_side_game_min_bet?: number | null; auto_strokes?: boolean }
type PlayingGroupPlayer = { playing_group_id: string; player_id: string }
type RosterPlayer = { id: string; name: string; ghin_number?: string | null; handicap_index?: number | null; email?: string | null }
type HammerMatchup = { id: string; team1_id: string; team2_id: string; base_bet: number; auto_handicap: boolean }
type Team = { id: string; name: string; pin: string; is_admin: boolean; daytona_variant?: string | null; daytona_variant_back9?: string | null; banker_side_game?: boolean; banker_side_game_min_bet?: number | null; auto_strokes?: boolean; hammer_side_game?: boolean; hammer_base_bet?: number | null; hammer_format?: string | null }
type Player = { id: string; team_id: string | null; name: string; position: number | null; skins_participant: boolean; handicap?: number | null; holes_range?: string | null }
type Hole = { hole_number: number; par: number }
type BallValue = { ball_number: number; value_dollars: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type PressEntry = { id: string; holeStart: number; holeEnd: number; amount: number; strokesSide?: 'p1' | 'p2'; strokes?: number; forfeit?: PressForfeit | null }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string; press: PressEntry[]; hole_range?: string | null }
type BestBallMatchup = {
  id: string
  team1_player1_id: string; team1_player2_id: string
  team2_player1_id: string; team2_player2_id: string
  bet: string
  press?: PressEntry[]
  hole_range?: string | null
  player_strokes?: Record<string, number> | null
}
type GeneratedPlayer = { id: string; name: string; handicap: number | null; source: 'roster' | 'manual' }
type GeneratedTeam = { name: string; pin: string; players: GeneratedPlayer[]; avgHandicap: number | null }

type MatchupBetType = 'nassau' | 'straight'
type MatchupScoringType = 'stroke' | 'match'

// ── Matchup payout helpers ────────────────────────────────────────────────────


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

function getSetupLS(roundId: string | undefined): Record<string, boolean> {
  if (!roundId || typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(`abg_setup_${roundId}`) ?? '{}') } catch { return {} }
}
function setSetupLS(roundId: string | undefined, key: string, val: boolean) {
  if (!roundId || typeof window === 'undefined') return
  try {
    const cur = getSetupLS(roundId)
    localStorage.setItem(`abg_setup_${roundId}`, JSON.stringify({ ...cur, [key]: val }))
  } catch {}
}

export default function AdminDashboard({
  orgSlug, orgId, orgName, isMaster = false,
  round, teams, players, holes, ballValues, scores, scorecardTeamId = null, scorecardGroupId = null, dtAssignments = [],
  matchups = [], bestBallMatchups = [], medleyMatchups = [], initialHoleValues = {}, courses = [],
  playingGroups = [], playingGroupPlayers = [], roster = [], hammerMatchups = [],
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster?: boolean
  round: Round; teams: Team[]; players: Player[]; holes: Hole[]; ballValues: BallValue[]; scores: Score[]; scorecardTeamId?: string | null; scorecardGroupId?: string | null; dtAssignments?: DaytonaHoleAssignment[]
  matchups?: SavedMatchup[]; bestBallMatchups?: BestBallMatchup[]; medleyMatchups?: MedleyMatchup[]; initialHoleValues?: Record<string, Record<number, number>>
  courses?: { name: string; slug: string; pars: number[] }[]
  playingGroups?: PlayingGroup[]
  playingGroupPlayers?: PlayingGroupPlayer[]
  roster?: RosterPlayer[]
  hammerMatchups?: HammerMatchup[]
}) {
  const router = useRouter()
  const [showOptions, setShowOptions] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [renamingTeam, setRenamingTeam] = useState<string | null>(null)
  const [renamingPlayer, setRenamingPlayer] = useState<string | null>(null)
  const [editingHandicapId, setEditingHandicapId] = useState<string | null>(null)
  const [handicapDraft, setHandicapDraft] = useState('')
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [confirmRemoveTeamId, setConfirmRemoveTeamId] = useState<string | null>(null)
  const [confirmRemovePlayerId, setConfirmRemovePlayerId] = useState<string | null>(null)
  const [confirmRemoveRosterId, setConfirmRemoveRosterId] = useState<string | null>(null)
  const [showAddRosterForm, setShowAddRosterForm] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPin, setEditPin] = useState('')
  const [editingRoundName, setEditingRoundName] = useState(false)
  const [roundNameDraft, setRoundNameDraft] = useState('')
  const [editDaytonaEnabled, setEditDaytonaEnabled] = useState(false)
  const [editDaytonaType, setEditDaytonaType] = useState('')
  const [editDaytonaSubVariant, setEditDaytonaSubVariant] = useState('')
  const [editDaytonaPayout, setEditDaytonaPayout] = useState('')
  const [editDaytonaBack9, setEditDaytonaBack9] = useState('')
  const [selectedCourse, setSelectedCourse] = useState('')
  const [selectedFormat, setSelectedFormat] = useState('')
  const [showNewRoundForm, setShowNewRoundForm] = useState(!round)
  const [showNewRoundWarning, setShowNewRoundWarning] = useState(false)
  const [showCreateConfirm, setShowCreateConfirm] = useState(false)
  const [editingRoundSettings, setEditingRoundSettings] = useState(false)
  const [editRoundPending, setEditRoundPending] = useState(false)
  const [editRoundError, setEditRoundError] = useState('')
  const [editScoreClearConfirm, setEditScoreClearConfirm] = useState(false)
  const createFormRef = useRef<HTMLFormElement>(null)
  const mixedGroupsSectionRef = useRef<HTMLDivElement | null>(null)
  const [showAssignGroupsNotice, setShowAssignGroupsNotice] = useState(false)
  const [skinsFewParticipantsWarning, setSkinsFewParticipantsWarning] = useState(false)
  const [confirmMixedSwitch, setConfirmMixedSwitch] = useState<{ to: boolean } | null>(null)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
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
  const [skinsSaved, setSkinsSaved] = useState<boolean>(() => {
    const ls = getSetupLS(round?.id)
    return ls.skinsSaved ?? false
  })
  const [roundSaved, setRoundSaved] = useState<boolean>(() => {
    const ls = getSetupLS(round?.id)
    // A round existing in the DB means "Start New Round" was already submitted.
    // localStorage is the primary source; fall back to any evidence a round is set up.
    return ls.roundSaved ?? (
      (ls.payoutSaved ?? false) || ballValues.length > 0 || teams.length > 0 ||
      (round?.is_started ?? false) || round?.format === 'traditional' || round != null
    )
  })
  const [payoutSaved, setPayoutSaved] = useState<boolean>(() => {
    const ls = getSetupLS(round?.id)
    // $0 ball values are created automatically on round creation — don't count those as "saved".
    // Only treat payout as saved when a non-zero value was deliberately set, or LS confirms it.
    const hasRealBallValue = ballValues.some(bv => bv.value_dollars > 0)
    return ls.payoutSaved ?? (hasRealBallValue || ['traditional', 'banker', 'hammer'].includes(round?.format ?? ''))
  })
  const [teamsSaved, setTeamsSaved] = useState<boolean>(() => {
    const ls = getSetupLS(round?.id)
    return ls.teamsSaved ?? (teams.length > 0)
  })
  const [showActivateTooltip, setShowActivateTooltip] = useState(false)
  const [resetConfirmTeamId, setResetConfirmTeamId] = useState<string | null>(null)
  const [roundExcludeMatchups, setRoundExcludeMatchupsState] = useState<boolean>(round?.exclude_matchups ?? false)
  const [roundExcludeMatchupsSaving, setRoundExcludeMatchupsSaving] = useState(false)
  const [roundExcludeMatchupsSaved, setRoundExcludeMatchupsSaved] = useState(false)
  const [showAddTeamSuccess, setShowAddTeamSuccess] = useState(false)
  const [newTeamDaytonaType, setNewTeamDaytonaType] = useState('')
  const [newTeamSubVariant, setNewTeamSubVariant] = useState('')
  const [newTeamDaytonaEnabled, setNewTeamDaytonaEnabled] = useState(false)
  const [newTeamDaytonaPayout, setNewTeamDaytonaPayout] = useState('')
  const [newTeamDaytonaBack9, setNewTeamDaytonaBack9] = useState('')
  const [newTeamBankerEnabled, setNewTeamBankerEnabled] = useState(false)
  const [newTeamBankerMinBet, setNewTeamBankerMinBet] = useState('2')
  const [newTeamAutoStrokes, setNewTeamAutoStrokes] = useState(false)
  const [newTeamHammerEnabled, setNewTeamHammerEnabled] = useState(false)
  const [newTeamHammerBaseBet, setNewTeamHammerBaseBet] = useState('1')
  const [newTeamHammerFormat, setNewTeamHammerFormat] = useState('stroke')
  const [editBankerEnabled, setEditBankerEnabled] = useState(false)
  const [editBankerMinBet, setEditBankerMinBet] = useState('2')
  const [editAutoStrokes, setEditAutoStrokes] = useState(false)
  const [editHammerEnabled, setEditHammerEnabled] = useState(false)
  const [editHammerBaseBet, setEditHammerBaseBet] = useState('1')
  const [editHammerFormat, setEditHammerFormat] = useState('stroke')
  // Roster state
  const [liveRoster, setLiveRoster] = useState<RosterPlayer[]>(roster)
  const [showRoster, setShowRoster] = useState(false)
  const [editingRosterId, setEditingRosterId] = useState<string | null>(null)
  const [rosterForm, setRosterForm] = useState({ name: '', ghin: '', handicap: '', email: '' })
  const [rosterPending, setRosterPending] = useState(false)
  const [rosterError, setRosterError] = useState('')
  const [rosterPickerTeamId, setRosterPickerTeamId] = useState<string | null>(null)
  const [rosterSearch, setRosterSearch] = useState('')
  const [rosterPickerMaxPlayers, setRosterPickerMaxPlayers] = useState(5)
  const [rosterPickerCurrentCount, setRosterPickerCurrentCount] = useState(0)
  const [rosterPickerSelectedIds, setRosterPickerSelectedIds] = useState<Set<string>>(new Set())
  const [rosterPickerAlreadyNames, setRosterPickerAlreadyNames] = useState<Set<string>>(new Set())
  const [rosterPickerPending, setRosterPickerPending] = useState(false)

  // Team Generator state
  const [showTeamGenerator, setShowTeamGenerator] = useState(false)
  const [genSelectedRosterIds, setGenSelectedRosterIds] = useState<Set<string>>(new Set())
  const [genManualPlayers, setGenManualPlayers] = useState<{ tempId: string; name: string; handicap: string }[]>([])
  const [genManualName, setGenManualName] = useState('')
  const [genManualHcp, setGenManualHcp] = useState('')
  const [genNumTeams, setGenNumTeams] = useState('2')
  const [generatedTeams, setGeneratedTeams] = useState<GeneratedTeam[] | null>(null)
  // Generation history for Previous/Next navigation (entry 0 = initial generation)
  const [genHistory, setGenHistory] = useState<{ teams: GeneratedTeam[]; names: string[]; pins: string[] }[]>([])
  const [genHistoryIdx, setGenHistoryIdx] = useState(0)
  const [genAtStartNotice, setGenAtStartNotice] = useState(false)
  // Skins participants picked in the generator preview (by generated-player id)
  const [genSkinsIds, setGenSkinsIds] = useState<Set<string>>(new Set())
  // Players picked while creating a new playing group (assigned on create)
  const [newGroupPlayerIds, setNewGroupPlayerIds] = useState<Set<string>>(new Set())
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
  const [hcpRounding, setHcpRounding] = useState(round?.handicap_rounding ?? 'down')
  // Re-sync when a different round loads (e.g. a new Daytona/Banker round created with auto handicap on)
  useEffect(() => { setAutoHandicap(round?.auto_handicap ?? false); setHcpRounding(round?.handicap_rounding ?? 'down') }, [round?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const [mixedGroups, setMixedGroups] = useState<boolean | null>(() => {
    const ls = getSetupLS(round?.id)
    const answered = ls.mixedGroupsAnswered ?? (teams.length > 0 || round?.mixed_groups === true)
    if (!answered) return null
    return round?.mixed_groups ?? null
  })
  const [mixedGroupsPending, setMixedGroupsPending] = useState(false)
  const [mixedGroupsAnswered, setMixedGroupsAnswered] = useState<boolean>(() => {
    const ls = getSetupLS(round?.id)
    return ls.mixedGroupsAnswered ?? (teams.length > 0 || round?.mixed_groups === true)
  })
  const [targetGroupCount, setTargetGroupCount] = useState(round?.playing_group_count ?? 0)
  const [groupCountSaved, setGroupCountSaved] = useState<boolean>(() => {
    const ls = getSetupLS(round?.id)
    return ls.groupCountSaved ?? !!(round?.playing_group_count && round.playing_group_count > 0)
  })
  const [livePlayingGroups, setLivePlayingGroups] = useState<PlayingGroup[]>(playingGroups)
  const [liveGroupPlayers, setLiveGroupPlayers] = useState<PlayingGroupPlayer[]>(playingGroupPlayers)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupPin, setNewGroupPin] = useState('')
  const [newGroupPending, setNewGroupPending] = useState(false)
  const [showNewGroupPin, setShowNewGroupPin] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [confirmRemoveGroupId, setConfirmRemoveGroupId] = useState<string | null>(null)
  const [confirmRemoveGroupPlayer, setConfirmRemoveGroupPlayer] = useState<{ playerId: string; playerName: string; isManual: boolean } | null>(null)
  const [confirmDisableSideGame, setConfirmDisableSideGame] = useState<{ label: string; onConfirm: () => Promise<void> } | null>(null)
  const [confirmDisableSideGamePending, setConfirmDisableSideGamePending] = useState(false)
  const [expandedGroupAssign, setExpandedGroupAssign] = useState<string | null>(null)
  const [groupAssignSearch, setGroupAssignSearch] = useState('')
  const [manualGroupName, setManualGroupName] = useState('')
  const [manualGroupHandicap, setManualGroupHandicap] = useState('')
  const [manualGroupPending, setManualGroupPending] = useState(false)
  const [expandedGroupCards, setExpandedGroupCards] = useState<Set<string>>(new Set())
  const [liveManualPlayers, setLiveManualPlayers] = useState<Player[]>([])
  const [expandedGroupSideGame, setExpandedGroupSideGame] = useState<string | null>(null)
  type GroupSideGame = { daytonaEnabled: boolean; daytonaType: string; daytonaSubVariant: string; daytonaPayout: string; bankerEnabled: boolean; bankerMinBet: string; autoStrokes: boolean; saving: boolean; saved: boolean }
  const initGroupSideGame = (g: PlayingGroup): GroupSideGame => {
    const raw = g.daytona_variant ?? ''
    const [variant, payout] = raw.includes('|') ? raw.split('|') : [raw, '']
    return {
      daytonaEnabled: !!g.daytona_variant,
      daytonaType: variant.startsWith('5man') ? '5' : variant === '4man' ? '4' : '',
      daytonaSubVariant: variant === '5man-flares' ? 'flares' : variant === '5man-normal' ? 'normal' : '',
      daytonaPayout: payout || '',
      bankerEnabled: !!g.banker_side_game,
      bankerMinBet: g.banker_side_game_min_bet != null ? String(g.banker_side_game_min_bet) : '2',
      autoStrokes: !!g.auto_strokes,
      saving: false, saved: false,
    }
  }
  const [groupSideGames, setGroupSideGames] = useState<Record<string, GroupSideGame>>(() =>
    Object.fromEntries(playingGroups.map(g => [g.id, initGroupSideGame(g)]))
  )
  function updateGroupSG(groupId: string, patch: Partial<GroupSideGame>) {
    setGroupSideGames(prev => ({ ...prev, [groupId]: { ...prev[groupId], ...patch } }))
  }
  const [skinsOverrides, setSkinsOverrides] = useState<Record<string, boolean>>({})
  const [holesRangeOverrides, setHolesRangeOverrides] = useState<Record<string, string>>({})
  const [confirmClearScores, setConfirmClearScores] = useState(false)
  const [clearScoresPending, setClearScoresPending] = useState(false)

  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState('')
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
      setSetupLS(round?.id, 'payoutSaved', true)
    }
  }, [ballState])
  useEffect(() => {
    if (skinsState?.success) {
      router.refresh()
      setSkinsSaved(true)
      setSetupLS(round?.id, 'skinsSaved', true)
    }
  }, [skinsState])

  // When the active round changes (new round created + router.refresh() delivers new props),
  // sync local UI state so skins/ball values always reflect what's in the DB for the new round.
  useEffect(() => {
    setSkinsEnabled(round?.skins_enabled ?? null)
    setSkinsAmount(round?.skins_amount ?? 0)
    setSkinsMode(round?.skins_mode ?? 'per_hole')
    setBallVals(
      ballValues.length > 0
        ? Object.fromEntries(ballValues.map((bv) => [bv.ball_number, bv.value_dollars]))
        : { 1: 0 }
    )
    // Restore setup wizard progress from localStorage for the current round
    const ls = getSetupLS(round?.id)
    setRoundSaved(ls.roundSaved ?? (
      (ls.payoutSaved ?? false) || ballValues.length > 0 || teams.length > 0 ||
      (round?.is_started ?? false) || round?.format === 'traditional' || round != null
    ))
    const hasRealBallValue = ballValues.some(bv => bv.value_dollars > 0)
    setPayoutSaved(ls.payoutSaved ?? (hasRealBallValue || ['traditional', 'banker', 'hammer'].includes(round?.format ?? '')))
    setSkinsSaved(ls.skinsSaved ?? false)
    setTeamsSaved(ls.teamsSaved ?? false)
    setGroupCountSaved(ls.groupCountSaved ?? !!(round?.playing_group_count && round.playing_group_count > 0))
    setMixedGroupsAnswered(ls.mixedGroupsAnswered ?? (teams.length > 0 || round?.mixed_groups === true))
    setMixedGroups(round?.mixed_groups ?? null)
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

  // Polling — auto-recalculate settlements on any matchup or score change
  useEffect(() => {
    if (!round?.id) return
    const rid = round.id
    const playerIds = players.map((p) => p.id)

    async function refetchAll() {
      const [matchupsData, bbMatchupsData, scoresData, hvData] = await Promise.all([
        fetch('/api/matchups?roundId=' + rid).then((r) => r.json()).catch(() => null),
        fetch('/api/best-ball-matchups?roundId=' + rid).then((r) => r.json()).catch(() => null),
        playerIds.length ? fetch('/api/scores?playerIds=' + playerIds.join(',')).then((r) => r.json()).catch(() => null) : Promise.resolve(null),
        fetch('/api/daytona-hole-values?roundId=' + rid).then((r) => r.json()).catch(() => null),
      ])
      if (matchupsData) setLiveMatchups(matchupsData)
      if (bbMatchupsData) setLiveBestBallMatchups(bbMatchupsData)
      if (scoresData) setLiveScores(scoresData)
      if (hvData) {
        const map: Record<string, Record<number, number>> = {}
        for (const hv of hvData as { team_id: string; hole_number: number; value_per_point: number }[]) {
          if (!map[hv.team_id]) map[hv.team_id] = {}
          map[hv.team_id][hv.hole_number] = hv.value_per_point
        }
        setLiveHoleValues(map)
      }
    }

    const interval = setInterval(refetchAll, 5000)
    return () => { clearInterval(interval) }
  }, [round?.id])

  const [pars, setPars] = useState<Record<number, number>>(
    Object.fromEntries(holes.map((h) => [h.hole_number, h.par]))
  )
  const [ballVals, setBallVals] = useState<Record<number, number>>(
    Object.fromEntries(ballValues.map((bv) => [bv.ball_number, bv.value_dollars]))
  )
  const [skinsEnabled, setSkinsEnabled] = useState<boolean | null>(() => {
    const ls = getSetupLS(round?.id)
    if (!(ls.skinsSaved ?? false)) return null
    return round?.skins_enabled ?? null
  })
  const [skinsAmount, setSkinsAmount] = useState(round?.skins_amount ?? 0)
  const [skinsMode, setSkinsMode] = useState<string>(round?.skins_mode ?? 'per_hole')

  // Live state — kept in sync with server props and updated by real-time subscriptions
  const [liveMatchups, setLiveMatchups] = useState(matchups)
  const [liveBestBallMatchups, setLiveBestBallMatchups] = useState(bestBallMatchups)
  const [liveScores, setLiveScores] = useState(scores)

  // Exclude manual (team-less) group guests from all ball-game scoring
  const teamPlayers = players.filter((p): p is Player & { team_id: string } => p.team_id !== null)

  const parTotal = Object.values(pars).reduce((a, b) => a + b, 0)
  const ballsCount = round?.balls_count ?? 3
  const isDaytona = round?.format === 'daytona'
  const isTraditional = round?.format === 'traditional'
  const isStandard = round?.format === 'standard'
  const isBankerRound = round?.format === 'banker'
  const isHammerRound = round?.format === 'hammer'
  // Formats with no ball/point pool at all — the payout step is skipped and
  // the ball-game money math never runs (banker money = per-hole bets,
  // hammer money = hammer matchups, traditional = matchups/skins only).
  const hasNoBallPool = isTraditional || isBankerRound || isHammerRound
  const isBanker = round?.format === 'banker'
  const roundHoleCount = holes.length  // 9 or 18
  const roundStartHole = holes.length > 0 ? holes[0].hole_number : 1
  const is9HoleRound = (isDaytona || isTraditional || isBanker) && roundHoleCount === 9
  const roundIncludeTotal = round?.include_total ?? false
  const numSegments = roundIncludeTotal ? 3 : 2          // Front + Back [+ Total]
  // Complete = every player has a score on every hole THEY cover (players set
  // to Front 9 / Back 9 only need scores on their nine, not all 18)
  const isComplete = teamPlayers.length > 0 && holes.length > 0 && teamPlayers.every((p) => {
    const covered = holes.filter((h) => playerCoversHole(p.holes_range ?? null, h.hole_number))
    return covered.length > 0 && covered.every((h) => liveScores.some((s) => s.player_id === p.id && s.hole_number === h.hole_number))
  })

  // Standard ball payouts
  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)
  const frontSummaries = !isDaytona ? new Map(teams.map((team) => {
    const tp = teamPlayers.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(frontHoles, tp.map((p) => p.id), liveScores, ballsCount)]
  })) : new Map()
  const backSummaries = !isDaytona ? new Map(teams.map((team) => {
    const tp = teamPlayers.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(backHoles, tp.map((p) => p.id), liveScores, ballsCount)]
  })) : new Map()
  const totalSummaries = (!isDaytona && roundIncludeTotal) ? new Map(teams.map((team) => {
    const tp = teamPlayers.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(holes, tp.map((p) => p.id), liveScores, ballsCount)]
  })) : undefined

  const perBallValue = ballVals[1] ?? 5
  const emptyPoolResult: ReturnType<typeof calculatePoolPayouts> = { results: [] as BallHalfResult[], playerNet: {} as Record<string, number>, potTotal: 0, perBallResult: 0, perPlayerContribution: 0, numDecidedResults: 0, numPlayedResults: 0, settlements: [] }
  const poolResults = !isDaytona && !hasNoBallPool
    ? calculatePoolPayouts(teams, teamPlayers, frontSummaries, backSummaries, perBallValue, ballsCount, totalSummaries)
    : emptyPoolResult
  const ballResults = poolResults.results

  // Daytona Left/Right summaries per team
  const dtSummaries = isDaytona
    ? new Map(teams.map((team) => {
        const teamPlayerIds = teamPlayers.filter((p) => p.team_id === team.id).map((p) => p.id)
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
    () => computeAllMatchupPayouts(liveMatchups, liveBestBallMatchups, medleyMatchups, players, scoreMap, holes, round?.handicap_rounding),
    [liveMatchups, liveBestBallMatchups, medleyMatchups, players, scoreMap, holes, round?.handicap_rounding]
  )

  // Skins — declared before combinedDaytonaNet / combinedStandardNet which consume playerNet
  const skinsParticipants = useMemo(
    () => players.filter((p) => skinsOverrides[p.id] ?? p.skins_participant),
    [players, skinsOverrides]
  )
  const skinsResults = useMemo(
    () => skinsEnabled && skinsParticipants.length > 0
      ? (skinsMode === 'pot'
          ? computeSkinsPotResults(holes, liveScores, skinsParticipants, skinsAmount)
          : computeSkinsResults(holes, liveScores, skinsParticipants, skinsAmount))
      : { skins: [] as SkinResult[], playerNet: {} as Record<string, number>, skinsWon: 0, settlements: [] },
    [skinsEnabled, skinsParticipants, holes, liveScores, skinsAmount, skinsMode]
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
      const dollarTotals = computePlayerDaytonaDollarsSplit(holes, tScores, tAssign, team.daytona_variant ?? round?.daytona_variant ?? '4man', team.daytona_variant_back9, dtPayoutValue, tHoleVals)
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

  function buildGenInputs(): { allPlayers: GeneratedPlayer[]; numTeams: number } | null {
    const numTeams = parseInt(genNumTeams, 10)
    if (isNaN(numTeams) || numTeams < 2) { setGenError('Enter at least 2 teams.'); return null }

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
      return null
    }
    return { allPlayers, numTeams }
  }

  // Membership fingerprint so Re-generate can guarantee a different arrangement
  function teamsSignature(ts: GeneratedTeam[]): string {
    return ts.map(t => t.players.map(p => p.id).sort().join(',')).sort().join('|')
  }

  function handleGenerateTeams() {
    const inputs = buildGenInputs()
    if (!inputs) return
    setGenError('')
    setConfirmGenUse(false)
    const result = generateBalancedTeams(inputs.allPlayers, inputs.numTeams)
    const names = result.map(t => t.name), pins = result.map(t => t.pin)
    setGenHistory([{ teams: result, names, pins }])
    setGenHistoryIdx(0)
    setGeneratedTeams(result)
    setGenEditNames(names)
    setGenEditPins(pins)
  }

  function handleRegenerateTeams() {
    const inputs = buildGenInputs()
    if (!inputs) return
    setGenError('')
    setConfirmGenUse(false)
    const currentSig = generatedTeams ? teamsSignature(generatedTeams) : ''
    let result: GeneratedTeam[] | null = null
    for (let attempt = 0; attempt < 15; attempt++) {
      const candidate = generateBalancedTeams(inputs.allPlayers, inputs.numTeams, Math.random)
      if (teamsSignature(candidate) !== currentSig) { result = candidate; break }
    }
    if (!result) {
      setGenError('This roster only has one balanced arrangement — no different teams to generate.')
      return
    }
    const names = result.map(t => t.name), pins = result.map(t => t.pin)
    const appendIdx = genHistory.length
    // Keep any name/PIN edits made to the current generation before moving on
    setGenHistory(prev => {
      const copy = [...prev]
      if (copy[genHistoryIdx]) copy[genHistoryIdx] = { ...copy[genHistoryIdx], names: genEditNames, pins: genEditPins }
      return [...copy, { teams: result!, names, pins }]
    })
    setGenHistoryIdx(appendIdx)
    setGeneratedTeams(result)
    setGenEditNames(names)
    setGenEditPins(pins)
  }

  function gotoGeneration(idx: number) {
    if (idx < 0) { setGenAtStartNotice(true); return }
    if (idx > genHistory.length - 1) return
    const entry = genHistory[idx]
    if (!entry) return
    // Keep any name/PIN edits made to the current generation
    setGenHistory(prev => {
      const copy = [...prev]
      if (copy[genHistoryIdx]) copy[genHistoryIdx] = { ...copy[genHistoryIdx], names: genEditNames, pins: genEditPins }
      return copy
    })
    setGenHistoryIdx(idx)
    setGeneratedTeams(entry.teams)
    setGenEditNames(entry.names)
    setGenEditPins(entry.pins)
    setConfirmGenUse(false)
  }

  async function handleUseGeneratedTeams() {
    if (!round || !generatedTeams) return
    setGenPending(true)
    setGenError('')
    const teamsToCreate = generatedTeams.map((t, i) => ({
      name: genEditNames[i] || t.name,
      pin: genEditPins[i] || t.pin,
      players: t.players.map(p => ({ name: p.name, handicap: p.handicap, skins: skinsEnabled === true && genSkinsIds.has(p.id) })),
    }))
    const result = await bulkCreateTeams(round.id, teamsToCreate)
    setGenPending(false)
    if (result.error) { setGenError(result.error); return }
    router.refresh()
    setShowTeamGenerator(false)
    setGeneratedTeams(null)
    setGenSelectedRosterIds(new Set())
    setGenSkinsIds(new Set())
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
      setLiveRoster((prev) => prev.map((p) => p.id === editingRosterId ? { ...p, name: rosterForm.name, ghin_number: rosterForm.ghin || null, handicap_index: hcp, email: rosterForm.email || null } : p).sort((a, b) => a.name.localeCompare(b.name)))
      setEditingRosterId(null)
    } else {
      const res = await createRosterPlayer(orgId, rosterForm.name, rosterForm.ghin || null, hcp, rosterForm.email || null)
      if (res.error) { setRosterError(res.error); setRosterPending(false); return }
      setLiveRoster((prev) => [...prev, { id: res.id!, name: rosterForm.name, ghin_number: rosterForm.ghin || null, handicap_index: hcp, email: rosterForm.email || null }].sort((a, b) => a.name.localeCompare(b.name)))
      setShowAddRosterForm(false)
    }
    setRosterForm({ name: '', ghin: '', handicap: '', email: '' }); setRosterPending(false)
  }
  async function handleDeleteRosterPlayer(id: string) {
    await deleteRosterPlayer(id)
    setLiveRoster((prev) => prev.filter((p) => p.id !== id))
  }
  function closeRosterPicker() {
    setRosterPickerTeamId(null)
    setRosterSearch('')
    setRosterPickerSelectedIds(new Set())
  }

  function toggleRosterPickerSelection(id: string) {
    setRosterPickerSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSaveFromRoster() {
    if (!rosterPickerTeamId || rosterPickerSelectedIds.size === 0) return
    setRosterPickerPending(true)
    const res = await addRosterPlayersToTeam(rosterPickerTeamId, [...rosterPickerSelectedIds])
    setRosterPickerPending(false)
    if (res.error) alert(res.error)
    closeRosterPicker()
    router.refresh()
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

  function handleToggleMixedGroups(value: boolean) {
    setMixedGroups(value)
  }

  // One-tap Mixed Groups answer at the top of Teams / Groups — persists immediately.
  // Changing an already-made answer with teams/groups in place asks for confirmation
  // first (switching cleans up config that no longer applies).
  async function chooseMixedGroups(value: boolean) {
    if (!round || mixedGroupsPending) return
    if (mixedGroupsAnswered && mixedGroups === value) return
    if (mixedGroupsAnswered && (teams.length > 0 || livePlayingGroups.length > 0)) {
      setConfirmMixedSwitch({ to: value })
      return
    }
    await performMixedGroupsChoice(value)
  }

  async function performMixedGroupsChoice(value: boolean) {
    if (!round) return
    setMixedGroups(value)
    setMixedGroupsPending(true)
    setMixedGroupsAnswered(true)
    setSetupLS(round.id, 'mixedGroupsAnswered', true)
    // Playing groups are cleared on any switch (server deletes them both directions)
    setLivePlayingGroups([])
    setLiveGroupPlayers([])
    setTargetGroupCount(0)
    setGroupCountSaved(false)
    setSetupLS(round.id, 'groupCountSaved', false)
    await toggleMixedGroups(round.id, value)
    router.refresh()
    setMixedGroupsPending(false)
  }

  async function saveMixedGroupsChoice() {
    if (!round || mixedGroups === null) return
    setMixedGroupsPending(true)
    setMixedGroupsAnswered(true)
    setSetupLS(round.id, 'mixedGroupsAnswered', true)
    if (mixedGroups) {
      setLivePlayingGroups([])
      setLiveGroupPlayers([])
      setTargetGroupCount(0)
      setGroupCountSaved(false)
      setSetupLS(round.id, 'groupCountSaved', false)
    }
    await toggleMixedGroups(round.id, mixedGroups)
    router.refresh()
    setMixedGroupsPending(false)
  }
  async function handleCreateGroup() {
    if (!round || !newGroupName.trim() || !newGroupPin.trim()) return
    if (!/^\d{4}$/.test(newGroupPin)) { setGroupError('PIN must be exactly 4 digits.'); return }
    if (livePlayingGroups.some(g => g.name.toLowerCase() === newGroupName.trim().toLowerCase())) {
      setGroupError('A group with that name already exists.'); return
    }
    setGroupError(''); setNewGroupPending(true)
    const res = await createPlayingGroup(round.id, newGroupName.trim(), newGroupPin.trim())
    if (res.error) { setNewGroupPending(false); setGroupError(res.error); return }
    const newGroup: PlayingGroup = { id: res.id!, name: newGroupName.trim(), pin: newGroupPin.trim() }
    setLivePlayingGroups((prev) => [...prev, newGroup])
    setGroupSideGames(prev => ({ ...prev, [res.id!]: initGroupSideGame(newGroup) }))
    // Assign any players picked in the create form
    const pickedIds = Array.from(newGroupPlayerIds)
    if (pickedIds.length > 0) {
      setLiveGroupPlayers((prev) => [
        ...prev.filter((gp) => !pickedIds.includes(gp.player_id)),
        ...pickedIds.map((pid) => ({ playing_group_id: res.id!, player_id: pid })),
      ])
      await Promise.all(pickedIds.map((pid) => setPlayerGroup(pid, res.id!)))
    }
    setNewGroupPlayerIds(new Set())
    setNewGroupPending(false)
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

  async function handleSetHcpRounding(mode: string) {
    if (!round || mode === hcpRounding) return
    setHcpRounding(mode)
    await updateRoundHandicapRounding(round.id, mode)
    router.refresh()
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
  function handleToggleSkinsParticipant(playerId: string, current: boolean) {
    const next = !current
    setSkinsOverrides(prev => ({ ...prev, [playerId]: next }))
    updatePlayerSkinsParticipation(playerId, next).then(() => router.refresh())
  }
  function handleUpdateHolesRange(playerId: string, range: string) {
    setHolesRangeOverrides(prev => ({ ...prev, [playerId]: range }))
    updatePlayerHolesRange(playerId, range).then(() => router.refresh())
  }
  async function handleClearAllScores() {
    if (!round) return
    setClearScoresPending(true)
    await clearAllScores(round.id)
    setClearScoresPending(false)
    setConfirmClearScores(false)
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

  function enterRoundEditMode() {
    if (!round) return
    setNewRoundName(round.name ?? '')
    setNewRoundDate(round.date ?? '')
    setSelectedFormat(round.format ?? 'standard')
    const matchedSlug = courses.find((c) => c.name === round.course)?.slug ?? ''
    setSelectedCourse(matchedSlug)
    setSelectedBallsCount(String(round.balls_count ?? 3))
    setCreateIncludeTotal(round.include_total ?? false)
    setSelectedHoleCount(String(holes.length || 18))
    setSelectedStartHole(String(holes.length > 0 ? holes[0].hole_number : 1))
    setBankerMinBetInput(String(round.banker_min_bet ?? 2))
    setEditRoundError('')
    setEditingRoundSettings(true)
  }

  async function handleEditRoundSave() {
    if (!round) return
    if (!newRoundName.trim() || !newRoundDate || !selectedFormat || !selectedCourse) {
      setEditRoundError('Round name, date, format, and course are required.')
      return
    }
    if (liveScores.length > 0) {
      setEditScoreClearConfirm(true)
      return
    }
    await doEditRound(false)
  }

  async function doEditRound(clearScores: boolean) {
    if (!round) return
    setEditRoundPending(true)
    setEditRoundError('')
    try {
      const res = await fetch(`/api/round/${round.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRoundName.trim(),
          date: newRoundDate,
          courseSlug: selectedCourse,
          format: selectedFormat,
          ballsCount: parseInt(selectedBallsCount) || 3,
          includeTotal: createIncludeTotal,
          holeCount: parseInt(selectedHoleCount) || 18,
          startHole: parseInt(selectedStartHole) || 1,
          bankerMinBet: parseFloat(bankerMinBetInput) || 2,
          clearScores,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setEditRoundError(data.error)
      } else {
        setEditingRoundSettings(false)
        setEditScoreClearConfirm(false)
        window.location.reload()
      }
    } catch (e) {
      setEditRoundError(e instanceof Error ? e.message : 'Network error. Please try again.')
    } finally {
      setEditRoundPending(false)
    }
  }

  const startMissingItems: string[] = []
  if (!newRoundName.trim()) startMissingItems.push('Round Name')
  if (!newRoundDate) startMissingItems.push('Date')
  if (!selectedFormat) startMissingItems.push('Scoring Format')
  if (!selectedCourse) startMissingItems.push('Course')
  const canStartRound = startMissingItems.length === 0

  // ── Setup wizard lock states ──────────────────────────────────────────────
  // Sequential: each section must be saved before the next unlocks.
  // When live/complete (round.is_started), everything is fully editable.
  const live = !!(round?.is_started)
  const setupBase = roundIsSettingUp && !createPending && !effectivePendingId
  const effectivePayoutSaved = payoutSaved || hasNoBallPool   // Traditional/Banker/Hammer have no payout step
  // Mixed groups is "done" when: not standard, OR chose No, OR chose Yes + Set clicked + all groups created
  const mixedGroupsSaved = !isStandard || (mixedGroupsAnswered && mixedGroups === false) || (mixedGroups === true && groupCountSaved && targetGroupCount > 0 && livePlayingGroups.length === targetGroupCount)
  // If the new-round form is open over an existing round, lock all downstream sections
  // (they belong to the old round; settings don't apply until the new round is saved)
  const creatingNewRound = showNewRoundForm && !!round && !editingRoundSettings
  // Step 1 — Payout: unlocks once a round exists (round saved = round was created)
  const payoutSectionEnabled = !creatingNewRound && (live || (setupBase && roundSaved))
  // Step 2 — Skins: unlocks after payout saved
  const skinsSectionEnabled = !creatingNewRound && (live || (setupBase && effectivePayoutSaved))
  // Step 3 — Teams: unlocks after payout + skins saved (teams come BEFORE mixed groups)
  const teamsAddEnabled = !creatingNewRound && (live || (setupBase && skinsSaved && effectivePayoutSaved))
  // Step 4 — Mixed Groups (standard only): unlocks after teams saved
  const mixedGroupsSectionEnabled = !creatingNewRound && (live || (setupBase && skinsSaved && teamsSaved))
  // Legacy alias used in a few spots below
  const skinsAndPayoutEnabled = payoutSectionEnabled

  // ── Player count requirements per format ──────────────────────────────────
  // Daytona 4-Man: exactly 4 · Daytona 5-Man: exactly 5 (per group's own type)
  // Traditional: 2–5 players per group
  // 3/4-ball: ≥balls_count and ≤5 players per team
  const allTeamsMeetRequirement = teams.length > 0 && teams.every(team => {
    const count = players.filter(p => p.team_id === team.id).length
    if (isDaytona) {
      const teamVariant = team.daytona_variant ?? '4man'
      const frontReq = teamVariant.startsWith('5man') ? 5 : 4
      const backReq = team.daytona_variant_back9 ? (team.daytona_variant_back9.startsWith('5man') ? 5 : 4) : frontReq
      return count >= Math.min(frontReq, backReq) && count <= Math.max(frontReq, backReq)
    }
    if (isTraditional) return count >= 2 && count <= 5
    return count >= (round?.balls_count ?? 3) && count <= 5
  })

  const allGroupsMeetMinimum = mixedGroups !== true || livePlayingGroups.every(g =>
    liveGroupPlayers.filter(gp => gp.playing_group_id === g.id).length >= 3
  )
  // Skins enabled but fewer than 2 participants marked → block activation
  const skinsNeedsParticipants = skinsEnabled === true && skinsParticipants.length < 2
  const canActivate = roundIsSettingUp && skinsSaved && effectivePayoutSaved && mixedGroupsSaved && teamsSaved && allTeamsMeetRequirement && allGroupsMeetMinimum && !skinsNeedsParticipants
  const activateMissingItems: string[] = []
  if (roundIsSettingUp) {
    if (!effectivePayoutSaved) activateMissingItems.push('Save Payout Value')
    if (!skinsSaved) activateMissingItems.push('Save Skins Settings')
    if (isStandard && !mixedGroupsSaved) activateMissingItems.push(!mixedGroupsAnswered ? 'Answer the Mixed Groups question (top of Teams / Groups)' : 'Finish creating the playing groups')
    if (!teamsSaved) activateMissingItems.push((isDaytona || isTraditional) ? 'Save Group(s)' : 'Save Teams')
    if (mixedGroups === true && !allGroupsMeetMinimum) activateMissingItems.push('Each playing group needs at least 3 players')
    if (teamsSaved && !allTeamsMeetRequirement) {
      if (isDaytona) {
        activateMissingItems.push('Each group needs the correct number of players')
      } else if (isTraditional) {
        activateMissingItems.push('Each group needs 2–5 players')
      } else {
        activateMissingItems.push(`Each team needs at least ${round?.balls_count ?? 3} and no more than 5 players`)
      }
    }
    if (skinsNeedsParticipants) activateMissingItems.push('Skins Game is enabled but fewer than 2 skins participants are selected — mark at least 2 players with the Skins button in the Teams / Groups → Players section, or disable the Skins Game')
  }

  useEffect(() => {
    const locked = showOptions || showPinModal || !!rosterPickerTeamId || showNewRoundWarning || !!confirmRemoveTeamId || !!confirmRemovePlayerId || !!confirmRemoveRosterId || !!confirmRemoveGroupId || !!confirmRemoveGroupPlayer || !!confirmDisableSideGame || editScoreClearConfirm
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [showOptions, showPinModal, rosterPickerTeamId, showNewRoundWarning, confirmRemoveTeamId, confirmRemovePlayerId, confirmRemoveRosterId, confirmRemoveGroupId, confirmRemoveGroupPlayer, confirmDisableSideGame, editScoreClearConfirm])

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

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>

      {/* ── Team generator: back-at-start notice ── */}
      {genAtStartNotice && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setGenAtStartNotice(false)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-base mb-2">At the Initial Generation</h3>
            <p className="text-sm text-gray-600 mb-4">
              You&apos;re back at the first set of generated teams — there&apos;s nothing previous to see.
              You can still go forward with <span className="font-semibold">Next</span>, or create a new variation with <span className="font-semibold">Re-generate</span>.
            </p>
            <button onClick={() => setGenAtStartNotice(false)}
              className="w-full py-2 rounded-lg text-sm font-bold text-white" style={{ background: navy }}>
              Got It
            </button>
          </div>
        </div>
      )}

      {/* ── Activate Round confirmation modal — full setup summary ── */}
      {showActivateConfirm && round && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setShowActivateConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 flex flex-col" style={{ maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-900 text-base">Ready to Activate?</h3>
              <p className="text-xs text-gray-500 mt-0.5">Review everything below, then confirm or go back and edit.</p>
            </div>
            <div className="px-5 py-3 overflow-y-auto space-y-3 text-sm">
              {/* Round */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Round</p>
                <p className="font-semibold text-gray-900">{round.name}</p>
                <p className="text-xs text-gray-500">
                  {round.course} · {new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <p className="text-xs text-gray-500">
                  Format: <span className="font-semibold text-gray-700">
                    {isDaytona ? 'Daytona' : isTraditional ? 'Traditional' : isBanker ? `Banker (min bet $${round.banker_min_bet ?? 2})` : isHammerRound ? 'Hammer' : `${ballsCount}-Ball${roundIncludeTotal ? ' + Total' : ''}`}
                  </span>
                  {is9HoleRound ? ` · 9 Holes (${roundStartHole === 10 ? 'Back 9' : 'Front 9'})` : ' · 18 Holes'}
                </p>
              </div>
              {/* Payout value */}
              {!hasNoBallPool && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{isDaytona ? 'Per Point Value' : 'Per Ball Value'}</p>
                  <p className="text-xs text-gray-700 font-semibold">${ballVals[1] ?? 0}{isDaytona ? ' per point' : ' per ball'}</p>
                </div>
              )}
              {/* Skins */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Skins Game</p>
                {skinsEnabled ? (
                  <p className="text-xs text-gray-700">
                    <span className="font-semibold text-green-700">On</span> · {skinsMode === 'pot' ? `Winner Takes Pot · $${skinsAmount} buy-in` : `Per Skin · $${skinsAmount}/skin`} · {skinsParticipants.length} participant{skinsParticipants.length !== 1 ? 's' : ''}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">Off</p>
                )}
              </div>
              {/* Handicap settings */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Handicaps</p>
                <p className="text-xs text-gray-700">
                  {(isDaytona || isBanker) && <>Auto Handicap <span className="font-semibold">{autoHandicap ? 'On' : 'Off'}</span> · </>}
                  Rounding: <span className="font-semibold">{hcpRounding === 'nearest' ? 'Round Up' : 'Round Down'}</span>
                </p>
              </div>
              {/* Mixed groups (standard only) */}
              {isStandard && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Mixed Groups</p>
                  {mixedGroups === true ? (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-700"><span className="font-semibold text-green-700">Yes</span> · {livePlayingGroups.length} playing group{livePlayingGroups.length !== 1 ? 's' : ''}</p>
                      {livePlayingGroups.map((g) => {
                        const gp = liveGroupPlayers.filter((x) => x.playing_group_id === g.id)
                        const names = gp.map((x) => players.find((p) => p.id === x.player_id)?.name.split(' ')[0] ?? '?').join(', ')
                        const sg: string[] = []
                        if (g.daytona_variant) sg.push(`Daytona ${g.daytona_variant.startsWith('5man-flares') ? '5-Man Flares' : g.daytona_variant.startsWith('5man') ? '5-Man Normal' : '4-Man'}`)
                        if (g.banker_side_game) sg.push(`Banker (min $${g.banker_side_game_min_bet ?? 2})`)
                        return (
                          <p key={g.id} className="text-xs text-gray-600 pl-2">
                            <span className="font-semibold text-gray-800">{g.name}</span> (PIN {g.pin}): {names || 'no players'}{sg.length > 0 ? <span className="text-amber-700"> · {sg.join(' · ')}</span> : ''}
                          </p>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No — playing groups are the teams</p>
                  )}
                </div>
              )}
              {/* Teams / groups + players + side games */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  {(isDaytona || isTraditional) ? `Groups (${teams.length})` : `Teams (${teams.length})`}
                </p>
                <div className="space-y-1">
                  {teams.map((t) => {
                    const tp = players.filter((p) => p.team_id === t.id)
                    const names = tp.map((p) => p.name.split(' ')[0]).join(', ')
                    const skinsCount = tp.filter((p) => skinsOverrides[p.id] ?? p.skins_participant).length
                    const sg: string[] = []
                    if (t.daytona_variant) sg.push(`Daytona ${t.daytona_variant.split('|')[0].startsWith('5man-flares') ? '5-Man Flares' : t.daytona_variant.split('|')[0].startsWith('5man') ? '5-Man Normal' : '4-Man'}`)
                    if (t.banker_side_game) sg.push(`Banker (min $${t.banker_side_game_min_bet ?? 2})`)
                    if (t.hammer_side_game) sg.push(`Hammer ($${t.hammer_base_bet ?? 0} ${t.hammer_format === 'match' ? 'Match' : 'Stroke'})`)
                    return (
                      <p key={t.id} className="text-xs text-gray-600">
                        <span className="font-semibold text-gray-800">{t.name}</span>
                        {mixedGroups !== true && <span className="text-gray-400"> (PIN {t.pin})</span>}: {names || 'no players'}
                        {sg.length > 0 ? <span className="text-amber-700"> · {sg.join(' · ')}</span> : ''}
                        {skinsEnabled && skinsCount > 0 ? <span className="text-green-700"> · {skinsCount} in skins</span> : ''}
                      </p>
                    )
                  })}
                </div>
              </div>
              {roundExcludeMatchups && (
                <p className="text-xs text-red-600">Matchup Results are excluded from Payouts &amp; Settlements.</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
              <form action={activateRound.bind(null, round.id, orgSlug)} className="flex-1">
                <button type="submit"
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: '#16a34a' }}>
                  Confirm &amp; Activate
                </button>
              </form>
              <button onClick={() => setShowActivateConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-300 bg-white">
                Go Back &amp; Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mixed Groups switch confirmation modal ── */}
      {confirmMixedSwitch && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setConfirmMixedSwitch(null)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-base mb-2">
              {confirmMixedSwitch.to ? 'Switch to Mixed Groups?' : 'Turn off Mixed Groups?'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {confirmMixedSwitch.to
                ? 'Your teams and players are kept. Any side games currently set on your teams will be removed — side games and scorekeeper PINs are set on the playing groups instead, which you’ll build after saving teams.'
                : 'Your teams and players are kept. The playing groups you created will be deleted, and side games and scorekeeper PINs go back to being set on each team.'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => { const to = confirmMixedSwitch.to; setConfirmMixedSwitch(null); performMixedGroupsChoice(to) }}
                className="flex-1 py-2 rounded-lg text-sm font-bold text-white" style={{ background: navy }}>
                Switch
              </button>
              <button onClick={() => setConfirmMixedSwitch(null)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-300 bg-white">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Skins participants warning modal ── */}
      {skinsFewParticipantsWarning && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setSkinsFewParticipantsWarning(false)}>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-base mb-2">⚠ Skins Game Needs Players</h3>
            <p className="text-sm text-gray-600 mb-4">
              The Skins Game is enabled but fewer than 2 players are marked as skins participants.
              Mark at least 2 players with the <span className="font-semibold text-amber-700 bg-amber-100 px-1 rounded">Skins</span> button
              in each team&apos;s Players section, or disable the Skins Game.
              The round can&apos;t be activated until then.
            </p>
            <button onClick={() => setSkinsFewParticipantsWarning(false)}
              className="w-full py-2 rounded-lg text-sm font-bold text-white" style={{ background: navy }}>
              Got It
            </button>
          </div>
        </div>
      )}

      {/* ── Roster picker modal ── */}
      {rosterPickerTeamId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => !rosterPickerPending && closeRosterPicker()}>
          <div className="bg-white rounded-t-3xl w-full max-w-lg p-5 pb-8 flex flex-col" style={{ maxHeight: '90dvh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div>
                <h3 className="font-bold text-gray-900">Pick from Roster</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {rosterPickerCurrentCount + rosterPickerSelectedIds.size}/{rosterPickerMaxPlayers} players
                  {rosterPickerSelectedIds.size > 0 && <span className="text-green-600 font-medium"> · {rosterPickerSelectedIds.size} selected</span>}
                </p>
              </div>
              <button onClick={closeRosterPicker} disabled={rosterPickerPending} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <input value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)}
              placeholder="Search players…" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none mb-3 flex-shrink-0" />
            <div className="space-y-1.5 overflow-y-auto flex-1 min-h-0" style={{ maxHeight: '62dvh' }}>
              {liveRoster
                .filter((rp) => rp.name.toLowerCase().includes(rosterSearch.toLowerCase()))
                .map((rp) => {
                  const alreadyOnTeam = rosterPickerAlreadyNames.has(rp.name.toLowerCase())
                  const isSelected = rosterPickerSelectedIds.has(rp.id)
                  const atMax = rosterPickerCurrentCount + rosterPickerSelectedIds.size >= rosterPickerMaxPlayers
                  const isDisabled = alreadyOnTeam || (!isSelected && atMax)
                  return (
                    <button key={rp.id} type="button"
                      disabled={isDisabled}
                      onClick={() => toggleRosterPickerSelection(rp.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition text-left ${
                        alreadyOnTeam
                          ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                          : isSelected
                            ? 'border-green-400 bg-green-50'
                            : isDisabled
                              ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                              : 'border-gray-100 bg-gray-50 hover:bg-blue-50 hover:border-blue-200'
                      }`}>
                      <div>
                        <p className={`text-sm font-medium ${isSelected ? 'text-green-700' : 'text-gray-800'}`}>{rp.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {rp.handicap_index != null && <span className="text-xs text-gray-500">HCP {rp.handicap_index < 0 ? `+${Math.abs(rp.handicap_index)}` : rp.handicap_index}</span>}
                          {rp.ghin_number && <span className="text-xs font-mono text-blue-500">GHIN {rp.ghin_number}</span>}
                        </div>
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        {alreadyOnTeam
                          ? <span className="text-xs text-gray-400">Added</span>
                          : isSelected
                            ? <span className="text-green-500 text-lg font-bold">✓</span>
                            : <span className="text-blue-500 text-sm font-semibold">+ Select</span>
                        }
                      </div>
                    </button>
                  )
                })}
              {liveRoster.filter((rp) => rp.name.toLowerCase().includes(rosterSearch.toLowerCase())).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No players found</p>
              )}
            </div>
            <div className="flex gap-2 mt-4 flex-shrink-0">
              <button type="button" onClick={closeRosterPicker} disabled={rosterPickerPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-600 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={handleSaveFromRoster}
                disabled={rosterPickerPending || rosterPickerSelectedIds.size === 0}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: navy }}>
                {rosterPickerPending
                  ? 'Adding…'
                  : rosterPickerSelectedIds.size === 0
                    ? 'Add Players'
                    : `Add ${rosterPickerSelectedIds.size} Player${rosterPickerSelectedIds.size !== 1 ? 's' : ''}`}
              </button>
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
                  setMixedGroups(null)
                  setMixedGroupsAnswered(false)
                  setGroupCountSaved(false)
                  setTargetGroupCount(0)
                  setAutoHandicap(false)
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                style={{ background: '#b91c1c' }}>
                Yes, Start New Round
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Edit Round — Clear Scores confirmation modal ── */}
      {editScoreClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg font-bold">!</div>
              <div>
                <h2 className="font-semibold text-gray-900 text-base leading-snug">Clear all saved scores?</h2>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  This round already has scored holes. Saving these changes will clear all scored holes. Each scorekeeper will see a warning on their scorecard to re-enter completed hole scores.
                </p>
              </div>
            </div>
            <div className="border-t border-gray-100" />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditScoreClearConfirm(false)}
                disabled={editRoundPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => doEditRound(true)}
                disabled={editRoundPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
                style={{ background: '#b91c1c' }}>
                {editRoundPending ? 'Saving…' : 'Confirm & Clear Scores'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Team confirmation modal ── */}
      {confirmRemoveTeamId && (() => {
        const teamName = teams.find(t => t.id === confirmRemoveTeamId)?.name ?? 'this team'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg font-bold">!</div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-base leading-snug">Remove team?</h2>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    This will permanently remove <span className="font-semibold text-gray-800">{teamName}</span> and all its players. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-100" />
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirmRemoveTeamId(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="button"
                  onClick={async () => { const id = confirmRemoveTeamId; setConfirmRemoveTeamId(null); await handleDeleteTeam(id) }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                  style={{ background: '#dc2626' }}>
                  Yes, Remove Team
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Remove Player confirmation modal ── */}
      {confirmRemovePlayerId && (() => {
        const playerName = players.find(p => p.id === confirmRemovePlayerId)?.name ?? 'this player'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg font-bold">!</div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-base leading-snug">Remove player?</h2>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    This will remove <span className="font-semibold text-gray-800">{playerName}</span> from the team and delete all their scores for this round. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-100" />
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirmRemovePlayerId(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="button"
                  onClick={async () => { const id = confirmRemovePlayerId; setConfirmRemovePlayerId(null); await handleDeletePlayer(id) }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                  style={{ background: '#dc2626' }}>
                  Yes, Remove Player
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

      {/* ── Remove Playing Group confirmation modal ── */}
      {confirmRemoveGroupId && (() => {
        const grpName = livePlayingGroups.find(g => g.id === confirmRemoveGroupId)?.name ?? 'this group'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg font-bold">!</div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-base leading-snug">Remove playing group?</h2>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    This will permanently remove <span className="font-semibold text-gray-800">{grpName}</span> and unassign all its players.
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-100" />
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirmRemoveGroupId(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="button"
                  onClick={async () => {
                    const id = confirmRemoveGroupId
                    setConfirmRemoveGroupId(null)
                    await handleDeleteGroup(id)
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

      {/* ── Remove player from group confirmation modal ── */}
      {confirmRemoveGroupPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg font-bold">!</div>
              <div>
                <h2 className="font-semibold text-gray-900 text-base leading-snug">Remove player from group?</h2>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  This will remove <span className="font-semibold text-gray-800">{confirmRemoveGroupPlayer.playerName}</span> from this playing group.
                </p>
              </div>
            </div>
            <div className="border-t border-gray-100" />
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmRemoveGroupPlayer(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                Cancel
              </button>
              <button type="button"
                onClick={async () => {
                  const { playerId, isManual } = confirmRemoveGroupPlayer
                  setConfirmRemoveGroupPlayer(null)
                  setLiveGroupPlayers(prev => prev.filter(gp => gp.player_id !== playerId))
                  if (isManual) {
                    setLiveManualPlayers(prev => prev.filter(mp => mp.id !== playerId))
                    await removeManualPlayerFromGroup(playerId)
                  } else {
                    await setPlayerGroup(playerId, null)
                  }
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition"
                style={{ background: '#dc2626' }}>
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Disable side game confirmation modal ── */}
      {confirmDisableSideGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 text-lg font-bold">!</div>
              <div>
                <h2 className="font-semibold text-gray-900 text-base leading-snug">Disable {confirmDisableSideGame.label}?</h2>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">The round is active. Disabling this side game will remove it from scoring. This cannot be undone without re-enabling and re-saving.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmDisableSideGame(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                Cancel
              </button>
              <button type="button" disabled={confirmDisableSideGamePending}
                onClick={async () => {
                  setConfirmDisableSideGamePending(true)
                  await confirmDisableSideGame.onConfirm()
                  setConfirmDisableSideGamePending(false)
                  setConfirmDisableSideGame(null)
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ background: '#d97706' }}>
                {confirmDisableSideGamePending ? 'Saving…' : 'Yes, Disable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPinModal && <PinLoginModal teams={teams} onClose={() => setShowPinModal(false)} orgSlug={orgSlug} isGroup={isDaytona || isTraditional} playingGroups={mixedGroups === true ? livePlayingGroups : undefined} />}
      {showOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowOptions(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Options</h2>
              <button onClick={() => setShowOptions(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex flex-col gap-2">
              {scorecardTeamId ? (
                <a href={`/${orgSlug}/score/${scorecardTeamId}`}
                  className="w-full text-center py-2.5 rounded-xl font-semibold text-sm text-white"
                  style={{ background: navy }}>
                  {isComplete ? 'Edit Scores' : 'Enter Scores'}
                </a>
              ) : scorecardGroupId ? (
                <a href={`/${orgSlug}/score/group/${scorecardGroupId}`}
                  className="w-full text-center py-2.5 rounded-xl font-semibold text-sm text-white"
                  style={{ background: navy }}>
                  Enter Scores
                </a>
              ) : (
                <button type="button" onClick={() => { setShowOptions(false); setShowPinModal(true) }}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm text-white"
                  style={{ background: navy }}>
                  Enter Pin
                </button>
              )}
              {isMaster && (
                <a href="/master/dashboard"
                  className="w-full text-center py-2.5 rounded-xl font-semibold text-sm border"
                  style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>
                  ← Master Admin
                </a>
              )}
              <form action={adminLogout.bind(null, orgSlug, orgId)}>
                <button type="submit" className="w-full py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700">
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <header ref={headerRef} className="text-white px-4 pb-4 shadow-md z-10" style={{ position: 'fixed', top: 0, left: 0, right: 0, background: navy, paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-[72px] h-[72px] flex-shrink-0 rounded-3xl overflow-hidden -my-1">
              <img src="/abg-logo.jpg" alt="ABG" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Admin Hub</p>
              <h1 className="font-bold text-lg leading-tight">{orgName}</h1>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-1.5 flex-shrink-0 ml-3">
            <a href={`/${orgSlug}`}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold text-center"
              style={{ background: gold, color: navy }}>
              Leaderboard
            </a>
            <button onClick={() => setShowOptions(true)}
              className="text-xs px-3 py-1.5 rounded-lg border font-medium text-center"
              style={{ background: navy, color: '#9ca3af', borderColor: '#4b5563' }}>
              Options
            </button>
          </div>
        </div>
      </header>
      <div ref={spacerRef} />

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
            {round && ((!showNewRoundForm && !editingRoundSettings) || createPending || !!effectivePendingId) ? (
              /* Collapsed state — show "Edit Round Settings" and "New Round +" buttons */
              <div className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={enterRoundEditMode}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                  Edit Round Settings
                </button>
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
                    {editingRoundSettings ? 'Edit Round Settings' : round ? 'Start New Round' : 'Set Up Round'}
                  </h3>
                  {round && (
                    <button
                      type="button"
                      onClick={() => { editingRoundSettings ? setEditingRoundSettings(false) : setShowNewRoundForm(false) }}
                      className="text-xs text-gray-400 hover:text-gray-600">✕ Cancel</button>
                  )}
                </div>
                {round && !editingRoundSettings && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3">
                    This will end the current round and start a new one.
                  </p>
                )}
                {editRoundError && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mb-2">{editRoundError}</p>}
                {createError && !editingRoundSettings && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mb-2">{createError}</p>}
                <form ref={createFormRef} className="space-y-3">
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
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Minimum Bet ($)</label>
                        <input type="number" name="banker_min_bet" value={bankerMinBetInput} onChange={(e) => setBankerMinBetInput(e.target.value)}
                          min="0.5" step="0.5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                        <p className="text-xs text-gray-400 mt-0.5">Minimum bet each player must put up against the banker</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Holes</label>
                        <div className="flex gap-2">
                          {(['18', '9'] as const).map((hc) => (
                            <button key={hc} type="button" onClick={() => setSelectedHoleCount(hc)}
                              className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition ${
                                selectedHoleCount === hc ? 'border-gray-700 bg-gray-100 text-gray-800' : 'border-gray-200 bg-white text-gray-500'
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
                              <button key={val} type="button" onClick={() => setSelectedStartHole(val)}
                                className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition ${
                                  selectedStartHole === val ? 'border-gray-700 bg-gray-100 text-gray-800' : 'border-gray-200 bg-white text-gray-500'
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
                  {editingRoundSettings ? (
                    <button
                      type="button"
                      disabled={editRoundPending || !newRoundName.trim() || !newRoundDate || !selectedFormat || !selectedCourse}
                      onClick={handleEditRoundSave}
                      className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition"
                      style={{ background: navy }}>
                      {editRoundPending ? 'Saving…' : 'Save Changes'}
                    </button>
                  ) : (
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
                        onClick={async () => {
                          if (!createFormRef.current) return
                          setCreatePending(true)
                          setCreateError('')
                          try {
                            const body = new FormData(createFormRef.current)
                            const res = await fetch('/api/create-round', { method: 'POST', body })
                            const data = await res.json()
                            if (data.error) {
                              setCreateError(data.error)
                              setCreatePending(false)
                            } else {
                              const savedRoundId = data.roundId ?? round?.id
                              if (savedRoundId) setSetupLS(savedRoundId, 'roundSaved', true)
                              window.location.href = `/${orgSlug}/admin/dashboard`
                            }
                          } catch (e) {
                            setCreateError(e instanceof Error ? e.message : 'Network error. Please try again.')
                            setCreatePending(false)
                          }
                        }}
                        className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition"
                        style={{ background: navy, cursor: !canStartRound ? 'not-allowed' : undefined }}>
                        {createPending ? 'Creating…' : round ? 'Save' : 'Create Round'}
                      </button>
                    </div>
                  )}
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
                      {editingRoundName ? (
                        <form
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                          onSubmit={async (e) => {
                            e.preventDefault()
                            const trimmed = roundNameDraft.trim()
                            if (!trimmed || !round?.id) { setEditingRoundName(false); return }
                            await updateRoundName(round.id, trimmed)
                            setEditingRoundName(false)
                            router.refresh()
                          }}
                        >
                          <input
                            autoFocus
                            value={roundNameDraft}
                            onChange={(e) => setRoundNameDraft(e.target.value)}
                            className="flex-1 min-w-0 text-sm font-semibold text-gray-900 border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <button type="submit" className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: '#1d4ed8', color: 'white' }}>Save</button>
                          <button type="button" className="text-xs px-2 py-0.5 rounded font-semibold text-gray-500 border border-gray-300" onClick={() => setEditingRoundName(false)}>✕</button>
                        </form>
                      ) : (
                        <>
                          {/* During transition, show the new round's name from form state */}
                          <p className="font-semibold text-gray-900 truncate">
                            {(createPending || !!effectivePendingId) && newRoundName ? newRoundName : round.name}
                          </p>
                          <button
                            onClick={() => { setRoundNameDraft(round.name); setEditingRoundName(true) }}
                            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                            title="Edit round name"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }}>
                              <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                            </svg>
                          </button>
                        </>
                      )}
                      {!editingRoundName && (isSettingUp ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: '#fef3c7', color: '#92400e' }}>● Setting Up</span>
                      ) : (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={isComplete ? { background: '#fee2e2', color: '#dc2626' } : { background: '#dcfce7', color: '#15803d' }}>
                          {isComplete ? '● Complete' : '● Active'}
                        </span>
                      ))}
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

            {/* ── Per Ball / Per Point Payout Value — not shown for formats with no ball pool ── */}
            {round && !hasNoBallPool && (
              <div className={`bg-white rounded-2xl border border-gray-200 p-5 transition-opacity ${!skinsAndPayoutEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {!skinsAndPayoutEnabled && (roundIsSettingUp || creatingNewRound) && (
                  <p className="text-xs text-gray-400 mb-3 bg-gray-50 rounded px-2 py-1.5 border border-gray-100 text-center">
                    {creatingNewRound ? 'Save the new round above to unlock' : 'Complete the round form above to unlock'}
                  </p>
                )}
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">
                  {isDaytona ? 'Per Point Payout Value' : 'Per Ball Payout Value'}
                </h3>
                <form action={ballAction} className="space-y-3">
                  <input type="hidden" name="roundId" value={round.id} />
                  <input type="hidden" name="ballsCount" value={isDaytona ? 1 : round.balls_count} />
                  {payoutSaved && roundIsSettingUp && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Values saved!</p>}
                  {isDaytona ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Value Per Point ($)</label>
                      <input type="number" name="ball_1" min="0" step="0.25"
                        value={!payoutSaved && (ballVals[1] ?? 0) === 0 ? '' : (ballVals[1] ?? 0.25)}
                        placeholder="e.g. 0.25"
                        onChange={(e) => setBallVals((v) => ({ ...v, 1: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      <p className="text-xs text-gray-400 mt-1">Each point = this dollar amount. Points are the DT score difference per hole per player.</p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Value Per Ball ($)</label>
                      <input type="number" name="ball_1" min="0" step="1"
                        value={!payoutSaved && (ballVals[1] ?? 0) === 0 ? '' : (ballVals[1] ?? 5)}
                        placeholder="e.g. 5"
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
              <div className={`bg-white rounded-2xl border border-gray-200 p-5 transition-opacity ${!skinsSectionEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {!skinsSectionEnabled && (roundIsSettingUp || creatingNewRound) && (
                  <p className="text-xs text-gray-400 mb-3 bg-gray-50 rounded px-2 py-1.5 border border-gray-100 text-center">
                    {creatingNewRound ? 'Save the new round above to unlock' : 'Save Per Ball/Per Point Value above to unlock'}
                  </p>
                )}
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">Skins Game</h3>
                <form action={skinsAction} className="space-y-4">
                  <input type="hidden" name="roundId" value={round.id} />
                  <input type="hidden" name="skins_enabled" value={String(skinsEnabled ?? false)} />
                  <input type="hidden" name="skins_mode" value={skinsMode} />
                  {skinsState?.error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{skinsState.error}</p>}
                  {skinsSaved && roundIsSettingUp && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Skins settings saved!</p>}
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
                    <p className="text-xs text-gray-400 mt-1.5">Lowest individual score ≤ par on each hole wins a skin.</p>
                  </div>
                  {/* Payout format */}
                  {skinsEnabled && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-2">Payout Format</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSkinsMode('per_hole')}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                            skinsMode !== 'pot'
                              ? 'border-green-500 bg-green-50 text-green-700'
                              : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                          }`}>
                          Per Skin
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkinsMode('pot')}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                            skinsMode === 'pot'
                              ? 'border-green-500 bg-green-50 text-green-700'
                              : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                          }`}>
                          Winner Takes Pot
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-1.5">
                        {skinsMode === 'pot'
                          ? 'Everyone buys in. Whoever wins the most skins over the round takes the whole pot — ties split it evenly.'
                          : 'Each skin won pays out immediately from every other participant.'}
                      </p>
                    </div>
                  )}
                  {/* Amount per skin / buy-in */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{skinsMode === 'pot' ? 'Buy-In Per Player ($)' : 'Amount Per Skin ($)'}</label>
                    <input
                      type="number" name="skins_amount" min="0" step="1"
                      value={skinsAmount === 0 ? '' : skinsAmount}
                      placeholder={skinsMode === 'pot' ? 'e.g. 10' : 'e.g. 5'}
                      onChange={(e) => setSkinsAmount(parseFloat(e.target.value) || 0)}
                      disabled={!skinsEnabled}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-40 disabled:bg-gray-50" />
                    <p className="text-xs text-gray-400 mt-1">
                      {skinsMode === 'pot'
                        ? 'Each participant puts this amount into the pot. Pot = buy-in × number of participants.'
                        : 'Each other participant owes this amount to the skin winner per hole won.'}
                    </p>
                  </div>
                  <button type="submit" disabled={skinsPending || skinsEnabled === null}
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

            {/* ── Handicap Settings (auto strokes + rounding) — during setup too for Daytona/Banker, which auto-stroke by default ── */}
            {round && (round.is_started || isDaytona || isBankerRound) && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 text-sm mb-3">Handicap Settings</h3>
                {(isDaytona || round.format === 'banker') && (
                  <div className="flex items-center gap-3 cursor-pointer mb-4" onClick={handleToggleAutoHandicap}>
                    <div className={`w-8 h-5 rounded-full transition-colors flex-shrink-0 flex items-center ${autoHandicap ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${autoHandicap ? 'translate-x-3' : 'translate-x-0'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">Auto Handicap</p>
                      <p className="text-xs text-gray-400">Automatically pre-fill strokes on each hole based on player handicaps and course stroke indexes</p>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-800 mb-1">Stroke Rounding</p>
                  <p className="text-xs text-gray-400 mb-2">How decimal handicaps become whole strokes. Round Down: 7.9 → 7. Round Up: 7.4 → 7, 7.5 → 8.</p>
                  <div className="flex gap-1.5">
                    {([['down', 'Round Down'], ['nearest', 'Round Up']] as const).map(([mode, label]) => (
                      <button key={mode} type="button" onClick={() => handleSetHcpRounding(mode)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition"
                        style={hcpRounding === mode ? { background: navy, color: 'white', borderColor: navy } : { background: 'white', color: '#6b7280', borderColor: '#d1d5db' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Hammer Matchups (standalone Hammer format only) ── */}
            {round && round.format === 'hammer' && round.is_started && (
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

            {/* ── Matchup Results ── */}
            {round && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 text-sm mb-3">Matchup Results</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-600">Exclude from Payouts &amp; Settlements</span>
                  <button type="button"
                    disabled={roundExcludeMatchupsSaving}
                    onClick={async () => {
                      const newVal = !roundExcludeMatchups
                      setRoundExcludeMatchupsState(newVal)
                      setRoundExcludeMatchupsSaving(true)
                      setRoundExcludeMatchupsSaved(false)
                      await setRoundExcludeMatchups(round.id, newVal)
                      setRoundExcludeMatchupsSaving(false)
                      setRoundExcludeMatchupsSaved(true)
                      setTimeout(() => setRoundExcludeMatchupsSaved(false), 3000)
                    }}
                    className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition disabled:opacity-40 ${roundExcludeMatchups ? 'bg-red-100 text-red-800 border-red-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                    {roundExcludeMatchupsSaving ? '…' : roundExcludeMatchups ? 'On' : 'Off'}
                  </button>
                  {roundExcludeMatchupsSaved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
                </div>
                {roundExcludeMatchups && (
                  <p className="text-xs text-gray-400 mt-2">Matchup Results are hidden from Payouts and excluded from Combined Settlements.</p>
                )}
              </div>
            )}

            {/* ── Teams / Groups section ── */}
            {round && (
              <div className={`bg-white rounded-2xl border border-gray-200 overflow-hidden ${!teamsAddEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                {/* Mixed Groups question — must be answered before team building (3/4 ball only) */}
                {isStandard && roundIsSettingUp && (
                  <div className="px-4 py-3 border-b border-gray-100">
                    <label className="block text-xs font-medium text-gray-600 mb-2">Are you playing Mixed Groups? (playing groups different from ball-game teams)</label>
                    <div className="flex gap-2">
                      <button type="button" disabled={mixedGroupsPending} onClick={() => chooseMixedGroups(true)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition disabled:opacity-60 ${mixedGroupsAnswered && mixedGroups === true ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}>
                        Yes
                      </button>
                      <button type="button" disabled={mixedGroupsPending} onClick={() => chooseMixedGroups(false)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition disabled:opacity-60 ${mixedGroupsAnswered && mixedGroups === false ? 'border-gray-700 bg-gray-100 text-gray-800' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}>
                        No
                      </button>
                    </div>
                    {!mixedGroupsAnswered && (
                      <p className="text-xs text-amber-700 mt-1.5">Choose Yes or No to unlock team building below.</p>
                    )}
                  </div>
                )}
                <div className={isStandard && roundIsSettingUp && !mixedGroupsAnswered ? 'opacity-40 pointer-events-none select-none' : ''}>
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
                            setGenSelectedRosterIds(new Set())
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
                {!teamsAddEnabled && (roundIsSettingUp || creatingNewRound) && (
                  <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
                    <p className="text-xs text-gray-400 text-center">
                      {creatingNewRound ? 'Save the new round above to unlock' : 'Complete all sections above to unlock'}
                    </p>
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
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Preview — edit names</p>
                          <div className="flex items-center gap-1.5">
                            {genHistory.length >= 3 && genHistoryIdx > 0 && (
                              <button type="button" onClick={() => gotoGeneration(0)}
                                className="text-xs text-gray-600 border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                                ⇤ First
                              </button>
                            )}
                            {genHistory.length > 1 && (
                              <button type="button" onClick={() => gotoGeneration(genHistoryIdx - 1)}
                                className="text-xs text-gray-600 border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                                ← Previous
                              </button>
                            )}
                            {genHistory.length > 1 && (
                              <span className="text-[10px] text-gray-400 font-semibold whitespace-nowrap">{genHistoryIdx + 1}/{genHistory.length}</span>
                            )}
                            {genHistoryIdx < genHistory.length - 1 && (
                              <button type="button" onClick={() => gotoGeneration(genHistoryIdx + 1)}
                                className="text-xs text-gray-600 border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                                Next →
                              </button>
                            )}
                            <button type="button" onClick={handleRegenerateTeams}
                              className="text-xs text-indigo-600 border border-indigo-200 px-2 py-1 rounded hover:bg-indigo-50">
                              Re-generate
                            </button>
                          </div>
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
                              {team.avgHandicap != null && (
                                <span className="text-xs text-gray-400 flex-shrink-0">avg {team.avgHandicap < 0 ? `+${Math.abs(team.avgHandicap)}` : team.avgHandicap} HCP</span>
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {team.players.map(p => (
                                <div key={p.id} className="flex items-center gap-2 text-sm text-gray-700 py-0.5 border-b border-gray-50 last:border-0">
                                  <span className="flex-1 truncate">{p.name}</span>
                                  <span className="text-xs text-gray-400">
                                    {p.handicap != null
                                      ? p.handicap < 0
                                        ? `+${Math.abs(p.handicap)} HCP`
                                        : `HCP ${p.handicap}`
                                      : '—'}
                                  </span>
                                  {skinsEnabled === true && (
                                    <button type="button"
                                      onClick={() => setGenSkinsIds(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                                      className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold transition flex-shrink-0 ${genSkinsIds.has(p.id) ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-400 border-gray-300'}`}>
                                      Skins{genSkinsIds.has(p.id) ? ' ✓' : ''}
                                    </button>
                                  )}
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
                        <div className="space-y-2">
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
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500 whitespace-nowrap">Back 9</label>
                            <select value={newTeamDaytonaBack9} onChange={(e) => setNewTeamDaytonaBack9(e.target.value)}
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                              <option value="">Same as front</option>
                              <option value="4man">4-Man</option>
                              <option value="5man-normal">5-Man Normal</option>
                              <option value="5man-flares">5-Man Flares</option>
                            </select>
                            <input type="hidden" name="daytona_variant_back9" value={newTeamDaytonaBack9} />
                          </div>
                        </div>
                      )}
                      {(isTraditional || isStandard) && !mixedGroups && (
                        <div className="space-y-2">
                          {/* Daytona Side Game — hidden when Banker is On */}
                          {!newTeamBankerEnabled && (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-600">Daytona Side Game</span>
                                <button type="button"
                                  onClick={() => { setNewTeamDaytonaEnabled(v => !v); setNewTeamDaytonaType(''); setNewTeamSubVariant(''); setNewTeamDaytonaBack9(''); setNewTeamAutoStrokes(!newTeamDaytonaEnabled) }}
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
                                    <input type="number" min="0.1" step="0.01" placeholder="e.g. 0.25"
                                      value={newTeamDaytonaPayout} onChange={(e) => setNewTeamDaytonaPayout(e.target.value)}
                                      onFocus={(e) => { if (e.target.value === '0') e.target.value = '' }}
                                      className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-500 whitespace-nowrap">Back 9</label>
                                    <select value={newTeamDaytonaBack9} onChange={(e) => setNewTeamDaytonaBack9(e.target.value)}
                                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                                      <option value="">Same as front</option>
                                      <option value="4man">4-Man</option>
                                      <option value="5man-normal">5-Man Normal</option>
                                      <option value="5man-flares">5-Man Flares</option>
                                    </select>
                                  </div>
                                  <input type="hidden" name="daytona_variant" value={
                                    newTeamDaytonaType === '4' ? `4man|${newTeamDaytonaPayout || '0'}` :
                                    newTeamDaytonaType === '5' ? `5man-${newTeamSubVariant || 'normal'}|${newTeamDaytonaPayout || '0'}` : ''
                                  } />
                                  <input type="hidden" name="daytona_variant_back9" value={newTeamDaytonaBack9} />
                                </div>
                              )}
                            </>
                          )}
                          {/* Banker Side Game — hidden when Daytona is On */}
                          {!newTeamDaytonaEnabled && (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-600">Banker Side Game</span>
                                <button type="button"
                                  onClick={() => { setNewTeamBankerEnabled(v => !v); setNewTeamAutoStrokes(!newTeamBankerEnabled) }}
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
                            </>
                          )}
                          <input type="hidden" name="banker_side_game" value={newTeamBankerEnabled ? 'true' : 'false'} />
                          {newTeamBankerEnabled && <input type="hidden" name="banker_side_game_min_bet" value={newTeamBankerMinBet} />}
                          {/* Auto Strokes — shown when either side game is On */}
                          {(newTeamDaytonaEnabled || newTeamBankerEnabled) && (
                            <div className="flex items-center gap-2 pt-1">
                              <span className="text-xs font-medium text-gray-600">Auto Strokes</span>
                              <button type="button"
                                onClick={() => setNewTeamAutoStrokes(v => !v)}
                                className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${newTeamAutoStrokes ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                {newTeamAutoStrokes ? 'On' : 'Off'}
                              </button>
                              <span className="text-xs text-gray-400">Auto-calculate strokes from player handicaps</span>
                            </div>
                          )}
                          <input type="hidden" name="auto_strokes" value={(newTeamDaytonaEnabled || newTeamBankerEnabled) && newTeamAutoStrokes ? 'true' : 'false'} />
                          {/* Stroke rounding — round-level, surfaced here for non-Daytona/Banker formats */}
                          {round?.format !== 'daytona' && round?.format !== 'banker' && (((newTeamDaytonaEnabled || newTeamBankerEnabled) && newTeamAutoStrokes) || newTeamHammerEnabled) && (
                            <div className="flex items-center gap-2 pt-1 flex-wrap">
                              <span className="text-xs font-medium text-gray-600">Stroke Rounding</span>
                              {([['down', 'Round Down'], ['nearest', 'Round Up']] as const).map(([mode, mlabel]) => (
                                <button key={mode} type="button" onClick={() => handleSetHcpRounding(mode)}
                                  className="text-xs font-semibold px-2.5 py-0.5 rounded-full border transition"
                                  style={hcpRounding === mode ? { background: navy, color: 'white', borderColor: navy } : { background: 'white', color: '#6b7280', borderColor: '#d1d5db' }}>
                                  {mlabel}
                                </button>
                              ))}
                              <span className="text-xs text-gray-400 w-full">Round Down: 7.9 → 7 · Round Up: 7.5 → 8. Applies to the whole round.</span>
                            </div>
                          )}
                          {/* Hammer Side Game — hidden when Daytona or Banker On */}
                          {!newTeamDaytonaEnabled && !newTeamBankerEnabled && (
                            <>
                              <div className="flex items-center gap-2 pt-1">
                                <span className="text-xs font-medium text-gray-600">Hammer Side Game</span>
                                <button type="button"
                                  onClick={() => setNewTeamHammerEnabled(v => !v)}
                                  className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${newTeamHammerEnabled ? 'bg-orange-100 text-orange-800 border-orange-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                  {newTeamHammerEnabled ? 'On' : 'Off'}
                                </button>
                                <span className="text-xs text-gray-400">2-player or 4-player only</span>
                              </div>
                              {newTeamHammerEnabled && (
                                <div className="space-y-2 pl-1">
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-500 whitespace-nowrap">Base Bet ($)</label>
                                    <input type="number" min="0.5" step="0.5" value={newTeamHammerBaseBet}
                                      onChange={e => setNewTeamHammerBaseBet(e.target.value)}
                                      className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-500 whitespace-nowrap">Scoring Format</label>
                                    <select value={newTeamHammerFormat} onChange={e => setNewTeamHammerFormat(e.target.value)}
                                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                                      <option value="stroke">Stroke Play</option>
                                      <option value="match">Match Play</option>
                                    </select>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          <input type="hidden" name="hammer_side_game" value={newTeamHammerEnabled ? 'true' : 'false'} />
                          {newTeamHammerEnabled && <input type="hidden" name="hammer_base_bet" value={newTeamHammerBaseBet} />}
                          {newTeamHammerEnabled && <input type="hidden" name="hammer_format" value={newTeamHammerFormat} />}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input type="text" name="name" placeholder={(isDaytona || isTraditional) ? 'Group name' : 'Team name'} required
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                        {!mixedGroups && (
                          <input type="text" name="pin" placeholder="PIN" maxLength={4} inputMode="numeric" required
                            className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none" />
                        )}
                        {/* Disabled only while the create action is in-flight (roundId not known yet) */}
                        <button type="submit"
                          disabled={addTeamPending || createPending || (isDaytona && (!newTeamDaytonaType || (newTeamDaytonaType === '5' && !newTeamSubVariant))) || (isTraditional && newTeamDaytonaEnabled && (!newTeamDaytonaType || (newTeamDaytonaType === '5' && !newTeamSubVariant) || !newTeamDaytonaPayout))}
                          className="text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                          style={{ background: navy }}>{createPending ? '…' : 'Add'}</button>
                      </div>
                      {!mixedGroups && <p className="text-xs text-gray-400">PIN must be 4 digits — share with the team.</p>}
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
                              {!mixedGroups && (
                                <input type="text" name="pin" value={editPin} onChange={(e) => setEditPin(e.target.value)} placeholder="PIN" maxLength={4} inputMode="numeric"
                                  className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none" />
                              )}
                            </div>
                            {isDaytona && (
                              <div className="space-y-2">
                                <div className="flex gap-2">
                                  <select value={editDaytonaType} onChange={(e) => { setEditDaytonaType(e.target.value); setEditDaytonaSubVariant('') }}
                                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                                    <option value="" disabled>Daytona Type…</option>
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
                                  <label className="text-xs text-gray-500 whitespace-nowrap">Back 9</label>
                                  <select value={editDaytonaBack9} onChange={(e) => setEditDaytonaBack9(e.target.value)}
                                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                                    <option value="">Same as front</option>
                                    <option value="4man">4-Man</option>
                                    <option value="5man-normal">5-Man Normal</option>
                                    <option value="5man-flares">5-Man Flares</option>
                                  </select>
                                </div>
                                <input type="hidden" name="daytona_variant" value={
                                  editDaytonaType === '4' ? '4man' :
                                  editDaytonaType === '5' ? `5man-${editDaytonaSubVariant || 'normal'}` : ''
                                } />
                                <input type="hidden" name="daytona_variant_back9" value={editDaytonaBack9} />
                              </div>
                            )}
                            {!isDaytona && !mixedGroups && (
                              <div className="space-y-2">
                                {/* Daytona Side Game — hidden when Banker is On */}
                                {!editBankerEnabled && (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-gray-600">Daytona Side Game</span>
                                      <button type="button"
                                        onClick={() => {
                                          const doIt = async () => { setEditDaytonaEnabled(v => !v); setEditDaytonaType(''); setEditDaytonaSubVariant(''); setEditDaytonaPayout(''); setEditDaytonaBack9(''); setEditAutoStrokes(!editDaytonaEnabled) }
                                          if (editDaytonaEnabled && round?.is_started) {
                                            setConfirmDisableSideGame({ label: 'Daytona Side Game', onConfirm: doIt })
                                          } else { doIt() }
                                        }}
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
                                          <input type="number" min="0.1" step="0.01" placeholder="e.g. 0.25"
                                            value={editDaytonaPayout} onChange={(e) => setEditDaytonaPayout(e.target.value)}
                                            onFocus={(e) => { if (e.target.value === '0') e.target.value = '' }}
                                            className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs text-gray-500 whitespace-nowrap">Back 9</label>
                                          <select value={editDaytonaBack9} onChange={(e) => setEditDaytonaBack9(e.target.value)}
                                            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                                            <option value="">Same as front</option>
                                            <option value="4man">4-Man</option>
                                            <option value="5man-normal">5-Man Normal</option>
                                            <option value="5man-flares">5-Man Flares</option>
                                          </select>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                                <input type="hidden" name="daytona_variant" value={
                                  editDaytonaEnabled && editDaytonaType === '4' ? `4man|${editDaytonaPayout || '0'}` :
                                  editDaytonaEnabled && editDaytonaType === '5' ? `5man-${editDaytonaSubVariant || 'normal'}|${editDaytonaPayout || '0'}` : ''
                                } />
                                <input type="hidden" name="daytona_variant_back9" value={editDaytonaEnabled ? editDaytonaBack9 : ''} />
                                {/* Banker Side Game — hidden when Daytona is On */}
                                {!editDaytonaEnabled && (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-gray-600">Banker Side Game</span>
                                      <button type="button"
                                        onClick={() => {
                                          const doIt = async () => { setEditBankerEnabled(v => !v); setEditAutoStrokes(!editBankerEnabled) }
                                          if (editBankerEnabled && round?.is_started) {
                                            setConfirmDisableSideGame({ label: 'Banker Side Game', onConfirm: doIt })
                                          } else { doIt() }
                                        }}
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
                                  </>
                                )}
                                <input type="hidden" name="banker_side_game" value={editBankerEnabled ? 'true' : 'false'} />
                                {editBankerEnabled && <input type="hidden" name="banker_side_game_min_bet" value={editBankerMinBet} />}
                                {/* Auto Strokes — shown when either side game is On */}
                                {(editDaytonaEnabled || editBankerEnabled) && (
                                  <div className="flex items-center gap-2 pt-1">
                                    <span className="text-xs font-medium text-gray-600">Auto Strokes</span>
                                    <button type="button"
                                      onClick={() => setEditAutoStrokes(v => !v)}
                                      className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${editAutoStrokes ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                      {editAutoStrokes ? 'On' : 'Off'}
                                    </button>
                                    <span className="text-xs text-gray-400">Auto-calculate strokes from player handicaps</span>
                                  </div>
                                )}
                                <input type="hidden" name="auto_strokes" value={(editDaytonaEnabled || editBankerEnabled) && editAutoStrokes ? 'true' : 'false'} />
                                {/* Stroke rounding — round-level, surfaced here for non-Daytona/Banker formats */}
                                {round?.format !== 'daytona' && round?.format !== 'banker' && (((editDaytonaEnabled || editBankerEnabled) && editAutoStrokes) || editHammerEnabled) && (
                                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                                    <span className="text-xs font-medium text-gray-600">Stroke Rounding</span>
                                    {([['down', 'Round Down'], ['nearest', 'Round Up']] as const).map(([mode, mlabel]) => (
                                      <button key={mode} type="button" onClick={() => handleSetHcpRounding(mode)}
                                        className="text-xs font-semibold px-2.5 py-0.5 rounded-full border transition"
                                        style={hcpRounding === mode ? { background: navy, color: 'white', borderColor: navy } : { background: 'white', color: '#6b7280', borderColor: '#d1d5db' }}>
                                        {mlabel}
                                      </button>
                                    ))}
                                    <span className="text-xs text-gray-400 w-full">Round Down: 7.9 → 7 · Round Up: 7.5 → 8. Applies to the whole round.</span>
                                  </div>
                                )}
                                {/* Hammer Side Game — hidden when Daytona or Banker On */}
                                {!editDaytonaEnabled && !editBankerEnabled && (
                                  <>
                                    <div className="flex items-center gap-2 pt-1">
                                      <span className="text-xs font-medium text-gray-600">Hammer Side Game</span>
                                      <button type="button"
                                        onClick={() => setEditHammerEnabled(v => !v)}
                                        className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${editHammerEnabled ? 'bg-orange-100 text-orange-800 border-orange-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                        {editHammerEnabled ? 'On' : 'Off'}
                                      </button>
                                      <span className="text-xs text-gray-400">2-player or 4-player only</span>
                                    </div>
                                    {editHammerEnabled && (
                                      <div className="space-y-2 pl-1">
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs text-gray-500 whitespace-nowrap">Base Bet ($)</label>
                                          <input type="number" min="0.5" step="0.5" value={editHammerBaseBet}
                                            onChange={e => setEditHammerBaseBet(e.target.value)}
                                            className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs text-gray-500 whitespace-nowrap">Scoring Format</label>
                                          <select value={editHammerFormat} onChange={e => setEditHammerFormat(e.target.value)}
                                            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                                            <option value="stroke">Stroke Play</option>
                                            <option value="match">Match Play</option>
                                          </select>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                                <input type="hidden" name="hammer_side_game" value={editHammerEnabled ? 'true' : 'false'} />
                                {editHammerEnabled && <input type="hidden" name="hammer_base_bet" value={editHammerBaseBet} />}
                                {editHammerEnabled && <input type="hidden" name="hammer_format" value={editHammerFormat} />}
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
                                {!mixedGroups && <>PIN: <span className="font-mono font-bold text-gray-800">{team.pin}</span></>}
                                {team.daytona_variant && (() => {
                                  const [v, p] = team.daytona_variant!.split('|')
                                  const label = v === '5man-flares' ? 'Daytona 5-Man Flares' : v === '5man-normal' ? 'Daytona 5-Man Normal' : 'Daytona 4-Man'
                                  return <> · <span className="font-medium text-gray-700">{label}{p && p !== '0' ? ` · $${p}/pt` : ''}</span></>
                                })()}
                                {team.daytona_variant_back9 && (() => {
                                  const label = team.daytona_variant_back9 === '5man-flares' ? '5-Man Flares' : team.daytona_variant_back9 === '5man-normal' ? '5-Man Normal' : '4-Man'
                                  return <> · <span className="font-medium text-gray-700">Back 9: {label}</span></>
                                })()}
                                {team.banker_side_game && <> · <span className="font-medium text-blue-700">Banker · ${team.banker_side_game_min_bet ?? 2} min.</span></>}
                                {team.hammer_side_game && <> · <span className="font-medium text-orange-700">Hammer · {team.hammer_format === 'match' ? 'Match' : 'Stroke'} · ${team.hammer_base_bet ?? 1}/hole</span></>}
                                {team.is_admin && <span className="ml-1 text-amber-600 font-medium">· Admin</span>}
                              </p>
                              <p className="text-xs mt-0.5">
                                {(() => {
                                  if (isTraditional) {
                                    if (team.daytona_variant) {
                                      const frontReq = team.daytona_variant.split('|')[0].startsWith('5man') ? 5 : 4
                                      const backReq = team.daytona_variant_back9 ? (team.daytona_variant_back9.startsWith('5man') ? 5 : 4) : frontReq
                                      const minReq = Math.min(frontReq, backReq), maxReq = Math.max(frontReq, backReq)
                                      const ok = teamPlayers.length >= minReq && teamPlayers.length <= maxReq
                                      const over = teamPlayers.length > maxReq
                                      return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length} players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                    }
                                    const ok = teamPlayers.length >= 2 && teamPlayers.length <= 5
                                    const over = teamPlayers.length > 5
                                    return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length} players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                  }
                                  if (isDaytona) {
                                    const teamVariant = (team.daytona_variant ?? '4man').split('|')[0]
                                    const frontReq = teamVariant.startsWith('5man') ? 5 : 4
                                    const backReq = team.daytona_variant_back9 ? (team.daytona_variant_back9.startsWith('5man') ? 5 : 4) : frontReq
                                    const minReq = Math.min(frontReq, backReq), maxReq = Math.max(frontReq, backReq)
                                    const ok = teamPlayers.length >= minReq && teamPlayers.length <= maxReq
                                    const over = teamPlayers.length > maxReq
                                    return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length} players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                  }
                                  const required = round?.balls_count ?? 3
                                  const ok = teamPlayers.length >= required && teamPlayers.length <= 5
                                  const over = teamPlayers.length > 5
                                  return <span className={`font-semibold ${ok ? 'text-green-600' : 'text-red-500'}`}>{teamPlayers.length} players{over ? ' ↑ too many' : ok ? ' ✓' : ''}</span>
                                })()}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 flex-shrink-0">
                              <button onClick={() => {
                                const v = team.daytona_variant ?? (isDaytona ? (round?.daytona_variant ?? '') : '')
                                const [variant, payout] = v.includes('|') ? v.split('|') : [v, '']
                                setEditingTeamId(team.id)
                                setEditName(team.name)
                                setEditPin(team.pin)
                                setEditDaytonaEnabled(!!v)
                                setEditDaytonaType(variant.startsWith('5man') ? '5' : variant === '4man' ? '4' : '')
                                setEditDaytonaSubVariant(variant === '5man-flares' ? 'flares' : variant === '5man-normal' ? 'normal' : '')
                                setEditDaytonaPayout(payout || '')
                                setEditDaytonaBack9(team.daytona_variant_back9 ?? '')
                                setEditBankerEnabled(!!team.banker_side_game)
                                setEditBankerMinBet(team.banker_side_game_min_bet != null ? String(team.banker_side_game_min_bet) : '2')
                                setEditAutoStrokes(!!team.auto_strokes)
                                setEditHammerEnabled(!!team.hammer_side_game)
                                setEditHammerBaseBet(team.hammer_base_bet != null ? String(team.hammer_base_bet) : '1')
                                setEditHammerFormat(team.hammer_format ?? 'stroke')
                              }}
                                className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                                Edit
                              </button>
                              <button onClick={() => setSelectedTeam(isSelected ? null : team.id)}
                                className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">
                                {isSelected ? 'Close' : 'Players'}
                              </button>

                              <button type="button" onClick={() => setConfirmRemoveTeamId(team.id)}
                                className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-50">
                                Remove
                              </button>
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
                                  <div className="flex flex-col px-3 py-2 gap-1">
                                    <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-gray-400 w-4 text-right flex-shrink-0">{pi + 1}</span>
                                    <div className="flex flex-col gap-0.5 mr-1">
                                      <button type="button" disabled={pi === 0}
                                        onClick={() => handleMovePlayer(p.id, 'up')}
                                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition text-xs leading-none">▲</button>
                                      <button type="button" disabled={pi === teamPlayers.length - 1}
                                        onClick={() => handleMovePlayer(p.id, 'down')}
                                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition text-xs leading-none">▼</button>
                                    </div>
                                    <span className="flex-1 min-w-0 text-sm text-gray-800 font-medium truncate">{p.name}</span>
                                    {editingHandicapId === p.id ? (
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <input type="number" value={handicapDraft} onChange={(e) => setHandicapDraft(e.target.value)}
                                          autoFocus min="0" max="54" step="0.1" placeholder="HCP"
                                          className="w-14 border border-blue-300 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                                          onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateHandicap(p.id); if (e.key === 'Escape') setEditingHandicapId(null) }} />
                                        <button type="button" onClick={() => handleUpdateHandicap(p.id)} className="text-xs text-blue-600 font-medium">✓</button>
                                        <button type="button" onClick={() => setEditingHandicapId(null)} className="text-xs text-gray-400">✕</button>
                                      </div>
                                    ) : (
                                      <button type="button" onClick={() => { setEditingHandicapId(p.id); setHandicapDraft(p.handicap != null ? String(p.handicap) : '') }}
                                        className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition w-16 text-center flex-shrink-0">
                                        {p.handicap != null ? (p.handicap < 0 ? `HCP +${Math.abs(p.handicap)}` : `HCP ${p.handicap}`) : 'HCP —'}
                                      </button>
                                    )}
                                    </div>
                                    <div className="flex items-center gap-2 pl-10">
                                    {skinsEnabled && (
                                      <button type="button"
                                        onClick={() => handleToggleSkinsParticipant(p.id, skinsOverrides[p.id] ?? p.skins_participant)}
                                        className={`text-xs px-2 py-0.5 rounded border transition ${(skinsOverrides[p.id] ?? p.skins_participant) ? 'bg-amber-100 border-amber-400 text-amber-800 font-semibold' : 'border-gray-300 text-gray-400 hover:border-amber-300 hover:text-amber-600'}`}>
                                        Skins
                                      </button>
                                    )}
                                    <select
                                      value={holesRangeOverrides[p.id] ?? p.holes_range ?? 'all'}
                                      onChange={(e) => handleUpdateHolesRange(p.id, e.target.value)}
                                      className={`text-xs px-1 py-0.5 rounded border focus:outline-none ${(holesRangeOverrides[p.id] ?? p.holes_range ?? 'all') !== 'all' ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold' : 'border-gray-300 text-gray-400'}`}>
                                      <option value="all">18 Holes</option>
                                      <option value="front9">Front 9</option>
                                      <option value="back9">Back 9</option>
                                    </select>
                                    <button type="button" onClick={() => setRenamingPlayer(p.id)}
                                      className="text-xs text-blue-500 hover:text-blue-700">Rename</button>
                                    <button type="button" onClick={() => setConfirmRemovePlayerId(p.id)}
                                      className="text-xs text-red-500 hover:text-red-700">Remove</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                            {(() => {
                              const maxPlayers = (isDaytona || (isTraditional && team.daytona_variant))
                                ? ((team.daytona_variant ?? '4man').split('|')[0].startsWith('5man') || team.daytona_variant_back9?.startsWith('5man')) ? 5 : 4
                                : 5
                              if (teamPlayers.length >= maxPlayers) return null
                              return (
                                <>
                                {liveRoster.length > 0 && (
                                  <button type="button" onClick={() => {
                                    setRosterPickerTeamId(team.id)
                                    setRosterSearch('')
                                    setRosterPickerMaxPlayers(maxPlayers)
                                    setRosterPickerCurrentCount(teamPlayers.length)
                                    setRosterPickerAlreadyNames(new Set(teamPlayers.map((p) => p.name.toLowerCase())))
                                    setRosterPickerSelectedIds(new Set())
                                  }}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 font-medium mt-2 hover:bg-blue-50 transition">
                                    Pick from Roster
                                  </button>
                                )}
                                <form action={addPlayerAction} className="flex flex-col gap-2 mt-1">
                                  <input type="hidden" name="teamId" value={team.id} />
                                  {addPlayerState?.error && <p className="text-xs text-red-500">{addPlayerState.error}</p>}
                                  <input type="text" name="name" placeholder="Or enter name manually" required
                                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                                  <div className="flex items-center gap-2">
                                    <input type="number" name="handicap" placeholder="HCP" min="0" max="54" step="0.1"
                                      className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                                    {skinsEnabled && (
                                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer flex-1">
                                        <input type="checkbox" name="skins_participant" value="true"
                                          className="w-3.5 h-3.5 accent-amber-500" />
                                        In Skins
                                      </label>
                                    )}
                                    <button type="submit" disabled={addPlayerPending}
                                      className="text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60 ml-auto"
                                      style={{ background: navy }}>Add</button>
                                  </div>
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
                      onClick={() => {
                        setTeamsSaved(true); setSetupLS(round?.id, 'teamsSaved', true)
                        // Skins enabled with fewer than 2 participants marked — warn now (activation stays gated too)
                        if (skinsEnabled === true && skinsParticipants.length < 2 && roundIsSettingUp) {
                          setSkinsFewParticipantsWarning(true)
                        }
                        // Mixed groups: the Playing Groups section below is the next step — take the admin there
                        if (isStandard && mixedGroups === true && roundIsSettingUp) {
                          setShowAssignGroupsNotice(true)
                          setTimeout(() => mixedGroupsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
                        }
                      }}
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
                    {skinsEnabled === true && (
                      <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                        <span className="text-amber-500 text-base leading-none mt-0.5 flex-shrink-0">⚠</span>
                        <p className="text-xs text-amber-800">
                          <span className="font-semibold">Skins Game is enabled.</span> Open each team's Players section and tap the <span className="font-semibold text-amber-700 bg-amber-100 px-1 rounded">Skins</span> button for every player who is participating in skins.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            )}

            {/* ── Playing Groups (standard format, mixed groups = Yes only) ── */}
            {round && round.format === 'standard' && mixedGroups === true && mixedGroupsAnswered && (
              <div ref={mixedGroupsSectionRef} className={`bg-white rounded-2xl border border-gray-200 p-5 space-y-4 transition-opacity ${!mixedGroupsSectionEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`} style={{ scrollMarginTop: '80px' }}>
                {!mixedGroupsSectionEnabled && (roundIsSettingUp || creatingNewRound) && (
                  <p className="text-xs text-gray-400 bg-gray-50 rounded px-2 py-1.5 border border-gray-100 text-center">
                    {creatingNewRound ? 'Save the new round above to unlock' : 'Save Teams above to unlock'}
                  </p>
                )}
                {showAssignGroupsNotice && roundIsSettingUp && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5">
                    <span className="text-amber-500 text-base leading-none mt-0.5 flex-shrink-0">⚠</span>
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">Teams saved — now set the playing groups.</span> Assign every player to the group they&apos;re actually playing with below, set each group&apos;s PIN, and add any side games before you can activate the round.
                    </p>
                  </div>
                )}
                <h3 className="font-semibold text-gray-900 text-sm">Playing Groups</h3>
                <p className="text-xs text-gray-400 -mt-2">Each playing group gets its own scorekeeper PIN, separate from ball-game teams. Side games (Daytona / Banker) are set per group here.</p>

                {mixedGroups && mixedGroupsAnswered && (
                  <div className="space-y-3 border-t border-gray-100 pt-3">
                    {/* Step 1: set number of groups */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Number of Playing Groups</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="1" max="20"
                          value={targetGroupCount || ''}
                          placeholder="e.g. 4"
                          onChange={e => {
                            setTargetGroupCount(Math.max(0, parseInt(e.target.value) || 0))
                            setGroupCountSaved(false)
                          }}
                          className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={targetGroupCount === 0}
                          onClick={async () => {
                            if (round && targetGroupCount > 0) {
                              await setPlayingGroupCount(round.id, targetGroupCount)
                              setGroupCountSaved(true)
                              setSetupLS(round.id, 'groupCountSaved', true)
                            }
                          }}
                          className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition"
                          style={{ background: navy }}>
                          Set
                        </button>
                        {groupCountSaved && targetGroupCount > 0 && (
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${livePlayingGroups.length === targetGroupCount ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {livePlayingGroups.length} / {targetGroupCount} added
                          </span>
                        )}
                      </div>
                      {!groupCountSaved && (
                        <p className="text-xs text-amber-700 mt-1.5">Enter the number of groups then click <strong>Set</strong> to continue.</p>
                      )}
                    </div>

                    {/* Step 2: add groups (only after Set is clicked) */}
                    {groupCountSaved && targetGroupCount > 0 && (
                      <>
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Playing Groups</p>
                        {groupError && <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1.5">{groupError}</p>}

                        {/* Create group form — hidden when at capacity */}
                        {livePlayingGroups.length < targetGroupCount ? (
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
                            {/* Pick this group's players up front (optional — assignable later too) */}
                            {(() => {
                              const allAssigned = new Set(liveGroupPlayers.map(gp => gp.player_id))
                              const avail = players.filter(p => p.team_id !== null && !allAssigned.has(p.id))
                              if (avail.length === 0) return null
                              return (
                                <div className="w-full">
                                  <p className="text-xs text-gray-500 mb-1">Tap the players in this group (optional — you can also add them after creating):</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {avail.map(p => {
                                      const sel = newGroupPlayerIds.has(p.id)
                                      return (
                                        <button key={p.id} type="button"
                                          onClick={() => setNewGroupPlayerIds(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else if (n.size < 5) n.add(p.id); return n })}
                                          className={`text-xs px-2 py-1 rounded-full border font-medium transition ${sel ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-white text-gray-600 border-gray-300'}`}>
                                          {p.name}{sel ? ' ✓' : ''}
                                        </button>
                                      )
                                    })}
                                  </div>
                                  {newGroupPlayerIds.size >= 5 && <p className="text-[10px] text-amber-600 mt-1">5 players max per group</p>}
                                </div>
                              )
                            })()}
                            <button type="button" onClick={handleCreateGroup} disabled={newGroupPending || !newGroupName.trim() || !newGroupPin.trim()}
                              className="text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60" style={{ background: navy }}>
                              {newGroupPlayerIds.size > 0 ? `+ Add with ${newGroupPlayerIds.size} player${newGroupPlayerIds.size !== 1 ? 's' : ''}` : '+ Add'}
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-2 font-medium">All {targetGroupCount} groups added ✓</p>
                        )}
                      </>
                    )}

                    {/* Group cards — each has inline player assignment */}
                    {groupCountSaved && livePlayingGroups.map((g) => {
                      const allKnownPlayers = [...players, ...liveManualPlayers]
                      const assignedPlayerIds = new Set(liveGroupPlayers.filter(gp => gp.playing_group_id === g.id).map(gp => gp.player_id))
                      const assignedPlayers = allKnownPlayers.filter(p => assignedPlayerIds.has(p.id))
                      const allAssignedIds = new Set(liveGroupPlayers.map(gp => gp.player_id))
                      // Only show team players (non-null team_id) in the "assign from team" list
                      const unassignedTeamPlayers = players.filter(p => p.team_id !== null && !allAssignedIds.has(p.id))
                      const groupFull = assignedPlayers.length >= 5
                      const isExpanded = expandedGroupAssign === g.id
                      const isCardExpanded = expandedGroupCards.has(g.id)
                      const toggleCard = () => setExpandedGroupCards(prev => {
                        const next = new Set(prev)
                        next.has(g.id) ? next.delete(g.id) : next.add(g.id)
                        return next
                      })
                      return (
                        <div key={g.id} className="bg-gray-50 rounded-xl border border-gray-200 p-3 space-y-2.5">
                          {/* Header — always visible, clickable to expand */}
                          <div className="flex items-center justify-between cursor-pointer select-none" onClick={toggleCard}>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-gray-800">{g.name}</p>
                                <span className="text-gray-400 text-xs">{isCardExpanded ? '▲' : '▼'}</span>
                              </div>
                              <p className="text-xs text-gray-400 font-mono">PIN: {g.pin}</p>
                            </div>
                            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmRemoveGroupId(g.id) }}
                              className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
                          </div>

                          {/* Assigned player chips — always visible */}
                          <div className="flex flex-wrap gap-1.5">
                            {assignedPlayers.map((p) => {
                              const inSkins = skinsOverrides[p.id] ?? ((p as { skins_participant?: boolean }).skins_participant ?? false)
                              return (
                                <span key={p.id} className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 font-medium" style={{ background: p.team_id === null ? '#f3e8ff' : '#dbeafe', color: p.team_id === null ? '#7c3aed' : '#1e40af' }}>
                                  {p.name}
                                  {skinsEnabled === true && (
                                    <button type="button"
                                      onClick={(e) => { e.stopPropagation(); handleToggleSkinsParticipant(p.id, inSkins) }}
                                      className={`text-[9px] font-bold px-1 py-px rounded-full border leading-none ${inSkins ? 'bg-green-100 text-green-800 border-green-300' : 'bg-white text-gray-400 border-gray-300'}`}
                                      title="Toggle skins participation">
                                      Skins{inSkins ? ' ✓' : ''}
                                    </button>
                                  )}
                                  <button type="button"
                                    onClick={(e) => { e.stopPropagation(); setConfirmRemoveGroupPlayer({ playerId: p.id, playerName: p.name, isManual: p.team_id === null }) }}
                                    className="ml-0.5 hover:text-red-600 leading-none">×</button>
                                </span>
                              )
                            })}
                            {assignedPlayers.length === 0 && <p className="text-xs text-gray-400">No players assigned yet</p>}
                          </div>

                          {/* Expanded body — add-player panel + side game */}
                          {isCardExpanded && <>

                          {/* Inline add-player panel */}
                          {!groupFull && (
                            isExpanded ? (
                              <div className="border border-gray-200 rounded-lg bg-white p-2.5 space-y-2">
                                {/* Team players search */}
                                <input
                                  type="text"
                                  placeholder="Search team players…"
                                  value={groupAssignSearch}
                                  onChange={e => setGroupAssignSearch(e.target.value)}
                                  autoFocus
                                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                                />
                                <div className="max-h-36 overflow-y-auto space-y-0.5">
                                  {unassignedTeamPlayers
                                    .filter(p => p.name.toLowerCase().includes(groupAssignSearch.toLowerCase()))
                                    .map(p => {
                                      const teamName = teams.find(t => t.id === p.team_id)?.name
                                      return (
                                        <button key={p.id} type="button"
                                          onClick={() => handleSetPlayerGroup(p.id, g.id)}
                                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-left transition">
                                          <div>
                                            <span className="text-sm text-gray-800">{p.name}</span>
                                            {teamName && <span className="text-xs text-gray-400 ml-1.5">{teamName}</span>}
                                          </div>
                                          <span className="text-xs text-blue-600 font-semibold flex-shrink-0">+ Add</span>
                                        </button>
                                      )
                                    })}
                                  {unassignedTeamPlayers.filter(p => p.name.toLowerCase().includes(groupAssignSearch.toLowerCase())).length === 0 && (
                                    <p className="text-xs text-gray-400 text-center py-2">
                                      {unassignedTeamPlayers.length === 0 ? 'All team players are assigned' : 'No matches'}
                                    </p>
                                  )}
                                </div>

                                {/* Manual add */}
                                <div className="border-t border-gray-100 pt-2">
                                  <p className="text-xs text-gray-500 mb-1.5">Or add guest manually:</p>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      placeholder="Guest name"
                                      value={manualGroupName}
                                      onChange={e => setManualGroupName(e.target.value)}
                                      onKeyDown={async e => {
                                        if (e.key === 'Enter' && manualGroupName.trim()) {
                                          setManualGroupPending(true)
                                          const hcp = manualGroupHandicap.trim() !== '' ? parseFloat(manualGroupHandicap) : null
                                          const res = await addManualPlayerToGroup(g.id, manualGroupName.trim(), isNaN(hcp as number) ? null : hcp)
                                          setManualGroupPending(false)
                                          if (!res.error && res.id) {
                                            const newP: Player = { id: res.id, team_id: null, name: manualGroupName.trim(), position: null, skins_participant: false, handicap: isNaN(hcp as number) ? null : hcp }
                                            setLiveManualPlayers(prev => [...prev, newP])
                                            setLiveGroupPlayers(prev => [...prev, { playing_group_id: g.id, player_id: res.id! }])
                                            setManualGroupName('')
                                            setManualGroupHandicap('')
                                          }
                                        }
                                      }}
                                      className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                                    />
                                    <input
                                      type="number"
                                      placeholder="HCP"
                                      value={manualGroupHandicap}
                                      onChange={e => setManualGroupHandicap(e.target.value)}
                                      step="0.1"
                                      className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none text-center"
                                    />
                                    <button
                                      type="button"
                                      disabled={!manualGroupName.trim() || manualGroupPending}
                                      onClick={async () => {
                                        if (!manualGroupName.trim()) return
                                        setManualGroupPending(true)
                                        const hcp = manualGroupHandicap.trim() !== '' ? parseFloat(manualGroupHandicap) : null
                                        const res = await addManualPlayerToGroup(g.id, manualGroupName.trim(), isNaN(hcp as number) ? null : hcp)
                                        setManualGroupPending(false)
                                        if (!res.error && res.id) {
                                          const newP: Player = { id: res.id, team_id: null, name: manualGroupName.trim(), position: null, skins_participant: false, handicap: isNaN(hcp as number) ? null : hcp }
                                          setLiveManualPlayers(prev => [...prev, newP])
                                          setLiveGroupPlayers(prev => [...prev, { playing_group_id: g.id, player_id: res.id! }])
                                          setManualGroupName('')
                                          setManualGroupHandicap('')
                                        }
                                      }}
                                      className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 transition"
                                      style={{ background: navy }}>
                                      {manualGroupPending ? '…' : 'Add'}
                                    </button>
                                  </div>
                                </div>

                                <button type="button"
                                  onClick={() => { setExpandedGroupAssign(null); setGroupAssignSearch(''); setManualGroupName(''); setManualGroupHandicap('') }}
                                  className="text-xs text-gray-400 hover:text-gray-600">
                                  Done
                                </button>
                              </div>
                            ) : (
                              <button type="button"
                                onClick={() => { setExpandedGroupAssign(g.id); setGroupAssignSearch(''); setManualGroupName(''); setManualGroupHandicap('') }}
                                className="text-xs text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 font-medium transition">
                                + Add Player
                              </button>
                            )
                          )}
                          {groupFull && (
                            <p className="text-xs text-gray-400 italic">Group is full (5 players max)</p>
                          )}

                          {/* ── Side Game settings (only when group has players) ── */}
                          {assignedPlayers.length > 0 && (() => {
                            const sg = groupSideGames[g.id] ?? initGroupSideGame(g)
                            const hasSideGame = sg.daytonaEnabled || sg.bankerEnabled
                            const isOpen = expandedGroupSideGame === g.id || hasSideGame
                            return (
                              <div className="border-t border-gray-100 pt-2.5 space-y-2">
                                {!isOpen ? (
                                  <button type="button"
                                    onClick={() => setExpandedGroupSideGame(g.id)}
                                    className="text-xs text-purple-600 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-50 font-medium transition">
                                    + Add Side Game
                                  </button>
                                ) : (
                                <><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center justify-between">
                                  Side Game
                                  {!hasSideGame && (
                                    <button type="button" onClick={() => setExpandedGroupSideGame(null)}
                                      className="text-gray-400 hover:text-gray-600 text-xs font-normal normal-case">✕ Cancel</button>
                                  )}
                                </p>

                                {/* Daytona — hidden when Banker On */}
                                {!sg.bankerEnabled && (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-gray-600">Daytona Side Game</span>
                                      <button type="button"
                                        onClick={() => {
                                          const doIt = () => updateGroupSG(g.id, { daytonaEnabled: !sg.daytonaEnabled, daytonaType: '', daytonaSubVariant: '', autoStrokes: !sg.daytonaEnabled })
                                          if (sg.daytonaEnabled && round?.is_started) {
                                            const captured = sg
                                            setConfirmDisableSideGame({ label: 'Daytona Side Game', onConfirm: async () => {
                                              updateGroupSG(g.id, { daytonaEnabled: false, daytonaType: '', daytonaSubVariant: '', autoStrokes: false, saving: true })
                                              await updatePlayingGroupSettings(g.id, {
                                                daytona_variant: null,
                                                banker_side_game: captured.bankerEnabled,
                                                banker_side_game_min_bet: captured.bankerEnabled ? (parseFloat(captured.bankerMinBet) || 2) : null,
                                                auto_strokes: false,
                                              })
                                              updateGroupSG(g.id, { saving: false, saved: true })
                                            }})
                                          } else { doIt() }
                                        }}
                                        className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${sg.daytonaEnabled ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                        {sg.daytonaEnabled ? 'On' : 'Off'}
                                      </button>
                                    </div>
                                    {sg.daytonaEnabled && (
                                      <div className="space-y-1.5 pl-1">
                                        <div className="flex gap-2">
                                          <select value={sg.daytonaType} onChange={e => updateGroupSG(g.id, { daytonaType: e.target.value, daytonaSubVariant: '' })}
                                            className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none">
                                            <option value="" disabled>Type…</option>
                                            <option value="4">4-Man</option>
                                            <option value="5">5-Man</option>
                                          </select>
                                          {sg.daytonaType === '5' && (
                                            <select value={sg.daytonaSubVariant} onChange={e => updateGroupSG(g.id, { daytonaSubVariant: e.target.value })}
                                              className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none">
                                              <option value="" disabled>Variant…</option>
                                              <option value="normal">Normal</option>
                                              <option value="flares">Flares</option>
                                            </select>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs text-gray-500 whitespace-nowrap">Amt./point ($)</label>
                                          <input type="number" min="0.1" step="0.01" placeholder="e.g. 0.25"
                                            value={sg.daytonaPayout} onChange={e => updateGroupSG(g.id, { daytonaPayout: e.target.value })}
                                            className="w-24 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}

                                {/* Banker — hidden when Daytona On */}
                                {!sg.daytonaEnabled && (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-gray-600">Banker Side Game</span>
                                      <button type="button"
                                        onClick={() => {
                                          const doIt = () => updateGroupSG(g.id, { bankerEnabled: !sg.bankerEnabled, autoStrokes: !sg.bankerEnabled })
                                          if (sg.bankerEnabled && round?.is_started) {
                                            const captured = sg
                                            setConfirmDisableSideGame({ label: 'Banker Side Game', onConfirm: async () => {
                                              updateGroupSG(g.id, { bankerEnabled: false, autoStrokes: false, saving: true })
                                              const daytonaVariant = captured.daytonaEnabled
                                                ? captured.daytonaType === '4' ? `4man|${captured.daytonaPayout || '0'}` : captured.daytonaType === '5' ? `5man-${captured.daytonaSubVariant || 'normal'}|${captured.daytonaPayout || '0'}` : null
                                                : null
                                              await updatePlayingGroupSettings(g.id, {
                                                daytona_variant: daytonaVariant,
                                                banker_side_game: false,
                                                banker_side_game_min_bet: null,
                                                auto_strokes: false,
                                              })
                                              updateGroupSG(g.id, { saving: false, saved: true })
                                            }})
                                          } else { doIt() }
                                        }}
                                        className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${sg.bankerEnabled ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                        {sg.bankerEnabled ? 'On' : 'Off'}
                                      </button>
                                    </div>
                                    {sg.bankerEnabled && (
                                      <div className="flex items-center gap-2 pl-1">
                                        <label className="text-xs text-gray-500 whitespace-nowrap">Min bet ($)</label>
                                        <input type="number" min="0.5" step="0.5" placeholder="e.g. 2"
                                          value={sg.bankerMinBet} onChange={e => updateGroupSG(g.id, { bankerMinBet: e.target.value })}
                                          className="w-20 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
                                      </div>
                                    )}
                                  </>
                                )}

                                {/* Auto Strokes — only when a side game is On */}
                                {(sg.daytonaEnabled || sg.bankerEnabled) && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-gray-600">Auto Strokes</span>
                                    <button type="button"
                                      onClick={() => updateGroupSG(g.id, { autoStrokes: !sg.autoStrokes })}
                                      className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition ${sg.autoStrokes ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                      {sg.autoStrokes ? 'On' : 'Off'}
                                    </button>
                                    <span className="text-xs text-gray-400">Based on handicaps</span>
                                  </div>
                                )}
                                {/* Stroke rounding — round-level, surfaced here for non-Daytona/Banker formats */}
                                {round?.format !== 'daytona' && round?.format !== 'banker' && (sg.daytonaEnabled || sg.bankerEnabled) && sg.autoStrokes && (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-gray-600">Stroke Rounding</span>
                                    {([['down', 'Round Down'], ['nearest', 'Round Up']] as const).map(([mode, mlabel]) => (
                                      <button key={mode} type="button" onClick={() => handleSetHcpRounding(mode)}
                                        className="text-xs font-semibold px-2.5 py-0.5 rounded-full border transition"
                                        style={hcpRounding === mode ? { background: navy, color: 'white', borderColor: navy } : { background: 'white', color: '#6b7280', borderColor: '#d1d5db' }}>
                                        {mlabel}
                                      </button>
                                    ))}
                                    <span className="text-xs text-gray-400 w-full">Round Down: 7.9 → 7 · Round Up: 7.5 → 8. Applies to the whole round.</span>
                                  </div>
                                )}

                                {/* Save button */}
                                <div className="flex items-center gap-2 pt-0.5">
                                  <button type="button"
                                    disabled={sg.saving || (sg.daytonaEnabled && !sg.daytonaType)}
                                    onClick={async () => {
                                      updateGroupSG(g.id, { saving: true, saved: false })
                                      const daytonaVariant = sg.daytonaEnabled
                                        ? sg.daytonaType === '4' ? `4man|${sg.daytonaPayout || '0'}` : sg.daytonaType === '5' ? `5man-${sg.daytonaSubVariant || 'normal'}|${sg.daytonaPayout || '0'}` : null
                                        : null
                                      await updatePlayingGroupSettings(g.id, {
                                        daytona_variant: daytonaVariant,
                                        banker_side_game: sg.bankerEnabled,
                                        banker_side_game_min_bet: sg.bankerEnabled ? (parseFloat(sg.bankerMinBet) || 2) : null,
                                        auto_strokes: (sg.daytonaEnabled || sg.bankerEnabled) ? sg.autoStrokes : false,
                                      })
                                      updateGroupSG(g.id, { saving: false, saved: true })
                                      if (!sg.daytonaEnabled && !sg.bankerEnabled) setExpandedGroupSideGame(null)
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-40 transition"
                                    style={{ background: navy }}>
                                    {sg.saving ? 'Saving…' : 'Save'}
                                  </button>
                                  {sg.saved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
                                </div>
                                </>)}
                              </div>
                            )
                          })()}
                          </>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Clear All Scores (any format, once started) — last card before activation/banner ── */}
            {round && round.is_started && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 text-sm mb-1">Clear All Scores</h3>
                <p className="text-xs text-gray-400 mb-3">Deletes every saved score in this round for all teams and groups. Teams, matchups, and settings are kept.</p>
                {confirmClearScores ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-red-700">Clear every score in this round? This cannot be undone.</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={clearScoresPending} onClick={handleClearAllScores}
                        className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#b91c1c' }}>
                        {clearScoresPending ? 'Clearing…' : 'Yes, Clear All Scores'}
                      </button>
                      <button type="button" disabled={clearScoresPending} onClick={() => setConfirmClearScores(false)}
                        className="flex-1 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmClearScores(true)}
                    className="text-sm font-semibold px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition">
                    Clear All Scores
                  </button>
                )}
              </div>
            )}

            {/* ── Round Active banner — shown after activation ── */}
            {round && round.is_started && (
              <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center text-white text-lg flex-shrink-0">✓</div>
                <div>
                  <p className="font-semibold text-green-800 text-sm">Round is now Active!</p>
                  <p className="text-xs text-green-700 mt-0.5">The leaderboard is live — players can enter scores.</p>
                  {isHammerRound && liveHammerMatchups.length === 0 && (
                    <p className="text-xs font-semibold text-amber-700 mt-1.5">⚠ No Hammer matchups yet — add them in the Hammer Matchups section above.</p>
                  )}
                </div>
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
                {isHammerRound && (
                  <p className="text-xs text-blue-700 bg-blue-50 rounded px-3 py-2 mb-3">
                    Hammer matchups are set up after activation — the Hammer Matchups section appears above once the round is live.
                  </p>
                )}
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
                  <button type="button"
                    onClick={() => setShowActivateConfirm(true)}
                    disabled={!canActivate}
                    className="w-full text-white py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: '#16a34a' }}>
                    Activate Round
                  </button>
                </div>
              </div>
            )}

        </div>{/* end outer content space-y-4 */}

        <div className="h-8" />
      </div>
    </div>
  )
}

'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { submitGroupHoleScores, saveDaytonaAssignments, saveDaytonaHoleValues, saveHoleStrokes, saveBankerHole, saveBankerBets } from '@/app/actions'
import { computeTeamBallSummary, computeHoleBallScores, computeHoleDaytonaWithSides, computeHoleDaytonaPointsFiveMan, computePlayerDaytonaPoints } from '@/lib/scoring'
import { supabase } from '@/lib/supabase'
import { ScoreNotation } from './ScoreNotation'
import ScorecardBottomSheet from './ScorecardBottomSheet'

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

type Player = { id: string; name: string; team_id: string; position: number | null; handicap?: number | null }
type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }
type BallValue = { ball_number: number; value_dollars: number }

function scoreToPar(scores: Score[], playerId: string, holes: Hole[]): number | null {
  let total = 0; let played = 0
  for (const h of holes) {
    const s = scores.find((sc) => sc.player_id === playerId && sc.hole_number === h.hole_number)
    if (s) { total += s.strokes - h.par; played++ }
  }
  return played > 0 ? total : null
}

function formatToPar(val: number | null): string {
  if (val === null) return '–'
  return val > 0 ? `+${val}` : val === 0 ? 'E' : String(val)
}

function toParColor(val: number | null): string {
  if (val === null) return 'rgba(255,255,255,0.4)'
  return val < 0 ? '#4ade80' : val > 0 ? '#f87171' : 'rgba(255,255,255,0.7)'
}

export default function PlayingGroupScoreEntry({
  orgSlug, orgId, orgName, isMaster, isAdmin,
  groupId, groupName, roundId, roundName, roundDate, roundCourse,
  players, holes, initialScores, allScores: initialAllScores,
  ballsCount, teamPlayerMap, teamMap, includeTotal, ballValues, isStarted,
  daytonaVariant, isDaytonaSideGame, defaultDtPayoutValue, initialAssignments,
  initialHoleStrokes = {}, initialHoleValues = {},
  bankerSideGame = false, bankerMinBet = 2, initialBankerHoles = {}, initialBankerBets = {},
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster: boolean; isAdmin: boolean
  groupId: string; groupName: string; roundId: string; roundName: string; roundDate: string; roundCourse: string
  players: Player[]; holes: Hole[]; initialScores: Score[]; allScores: Score[]
  ballsCount: number; teamPlayerMap: Record<string, string[]>; teamMap: Record<string, string>
  includeTotal: boolean; ballValues: BallValue[]; isStarted: boolean
  daytonaVariant?: string | null; isDaytonaSideGame?: boolean; defaultDtPayoutValue?: number
  initialAssignments?: { player_id: string; hole_number: number; side: string }[]
  initialHoleStrokes?: Record<number, string[]>
  initialHoleValues?: Record<number, number>
  bankerSideGame?: boolean
  bankerMinBet?: number
  initialBankerHoles?: Record<number, { bankerPlayerId: string | null; maxBet: number }>
  initialBankerBets?: Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>
}) {
  const isDaytonaMode = !!isDaytonaSideGame
  const isFlares = daytonaVariant === '5man-flares'
  const is5Man = isDaytonaMode && (daytonaVariant === '5man-normal' || daytonaVariant === '5man-flares')
  const leftLabel = isFlares ? 'Out' : 'Left'
  const rightLabel = isFlares ? 'In' : 'Right'
  const router = useRouter()
  const [strokes, setStrokes] = useState<Record<string, Record<number, number>>>(() => {
    const s: Record<string, Record<number, number>> = {}
    for (const sc of initialScores) {
      if (!s[sc.player_id]) s[sc.player_id] = {}
      s[sc.player_id][sc.hole_number] = sc.strokes
    }
    return s
  })
  const [savedScores, setSavedScores] = useState<Score[]>(initialScores)
  const [allScores, setAllScores] = useState<Score[]>(initialAllScores)
  const [savedHoles, setSavedHoles] = useState<Set<number>>(() => {
    const saved = new Set<number>()
    for (const h of holes) {
      if (players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h.hole_number))) {
        saved.add(h.hole_number)
      }
    }
    return saved
  })
  const [expandedHole, setExpandedHole] = useState<number | null>(null)
  const [pendingHoles, setPendingHoles] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [playerPopup, setPlayerPopup] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [showScorecards, setShowScorecards] = useState(false)
  const [assignments, setAssignments] = useState<Record<number, Record<string, 'left' | 'right'>>>(() => {
    const m: Record<number, Record<string, 'left' | 'right'>> = {}
    for (const a of (initialAssignments ?? [])) {
      if (!m[a.hole_number]) m[a.hole_number] = {}
      m[a.hole_number][a.player_id] = a.side as 'left' | 'right'
    }
    if (isDaytonaMode) {
      const firstUnsaved = holes.find((h) =>
        !players.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h.hole_number))
      )?.hole_number
      if (firstUnsaved !== undefined && !m[firstUnsaved]) m[firstUnsaved] = {}
    }
    return m
  })

  const [holeValues, setHoleValues] = useState<Record<number, number>>(initialHoleValues)
  const [pressShowInput, setPressShowInput] = useState<Record<number, boolean>>({})
  const [pressValueStr, setPressValueStr] = useState<Record<number, string>>({})
  const [pressScope, setPressScope] = useState<Record<number, 'this' | 'forward'>>({})
  const [pressConfirmHole, setPressConfirmHole] = useState<number | null>(null)
  const [holeStrokes, setHoleStrokes] = useState<Record<number, string[]>>(initialHoleStrokes)
  const [strokesPending, setStrokesPending] = useState(false)
  const isBanker = !!bankerSideGame
  const [bankerHoles, setBankerHoles] = useState<Record<number, { bankerPlayerId: string | null; maxBet: number }>>(initialBankerHoles)
  // Draft strings for bet inputs — keyed by holeNumber then playerId, allows free typing
  const [bankerBets, setBankerBets] = useState<Record<number, Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>>>(initialBankerBets)
  const [allGroupsDone, setAllGroupsDone] = useState<boolean | null>(null)
  const prevSavedCount = useRef(savedHoles.size)
  const headerRef = useRef<HTMLElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const expandedHoleRef = useRef(expandedHole)
  useEffect(() => { expandedHoleRef.current = expandedHole }, [expandedHole])

  const [maxBetDraft, setMaxBetDraft] = useState<Record<number, string>>({})
  const [playerBetDraft, setPlayerBetDraft] = useState<Record<number, Record<string, string>>>({})

  function noScrollFocus(e: React.TouchEvent<HTMLInputElement>) {
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
  }

  // Pin header to visual viewport top — only while keyboard is open to avoid scroll glitch
  useEffect(() => {
    const vv = window.visualViewport
    const header = headerRef.current
    if (!vv || !header) return
    function pin() { header!.style.top = `${vv!.offsetTop}px` }
    function onResize() {
      const keyboardOpen = vv!.height < window.innerHeight - 100
      if (keyboardOpen) {
        vv!.addEventListener('scroll', pin)
        pin()
      } else {
        vv!.removeEventListener('scroll', pin)
        header!.style.top = '0px'
      }
    }
    const ro = new ResizeObserver(() => {
      if (spacerRef.current) spacerRef.current.style.height = `${header!.offsetHeight}px`
    })
    ro.observe(header)
    vv.addEventListener('resize', onResize)
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', pin); ro.disconnect() }
  }, [])

  // After keyboard closes, scroll expanded hole back into view
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    function onFocusOut(e: FocusEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const hole = expandedHoleRef.current
        if (hole === null) return
        const el = document.getElementById(`hole-${hole}`)
        if (!el) return
        const headerHeight = headerRef.current?.offsetHeight ?? 96
        const rect = el.getBoundingClientRect()
        if (rect.top >= headerHeight && rect.bottom <= window.innerHeight) return
        window.scrollTo({ top: rect.top + window.scrollY - headerHeight - 8, behavior: 'smooth' })
      }, 350)
    }
    document.addEventListener('focusout', onFocusOut)
    return () => { document.removeEventListener('focusout', onFocusOut); if (timer) clearTimeout(timer) }
  }, [])

  async function checkAllGroupsDone() {
    setAllGroupsDone(null)
    const { data: groups } = await supabase.from('playing_groups').select('id').eq('round_id', roundId)
    if (!groups?.length) { setAllGroupsDone(true); return }
    const { data: links } = await supabase.from('playing_group_players').select('playing_group_id, player_id').in('playing_group_id', groups.map(g => g.id))
    if (!links?.length) { setAllGroupsDone(true); return }
    const allPids = [...new Set(links.map(l => l.player_id))]
    const { data: scoresData } = await supabase.from('scores').select('player_id, hole_number').in('player_id', allPids)
    if (!scoresData) { setAllGroupsDone(false); return }
    const done = groups.every(g => {
      const gPids = links.filter(l => l.playing_group_id === g.id).map(l => l.player_id)
      return gPids.length === 0 || holes.every(h => gPids.every(pid => scoresData.some(s => s.player_id === pid && s.hole_number === h.hole_number)))
    })
    setAllGroupsDone(done)
  }

  useEffect(() => {
    const nowComplete = savedHoles.size === holes.length && holes.length > 0
    const wasComplete = prevSavedCount.current === holes.length && holes.length > 0
    if (nowComplete && !wasComplete) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      checkAllGroupsDone()
    }
    if (nowComplete && wasComplete && allGroupsDone === null) {
      checkAllGroupsDone()
    }
    prevSavedCount.current = savedHoles.size
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedHoles.size])

  useEffect(() => {
    if (allGroupsDone !== false) return
    const id = setInterval(checkAllGroupsDone, 15000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGroupsDone])

  // Auto-assign a random banker on the first hole if none is set yet
  useEffect(() => {
    if (!isBanker || !isStarted || players.length === 0 || holes.length === 0) return
    const firstHole = holes[0].hole_number
    if (bankerHoles[firstHole]?.bankerPlayerId) return
    const randomPlayer = players[Math.floor(Math.random() * players.length)]
    handleSaveBankerHole(firstHole, randomPlayer.id, bankerMinBet)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formattedDate = roundDate
    ? new Date(roundDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  async function handleStrokesToggle(holeNumber: number, playerId: string) {
    const current = holeStrokes[holeNumber] ?? []
    const next = current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    setHoleStrokes((prev) => ({ ...prev, [holeNumber]: next }))
    setStrokesPending(true)
    await saveHoleStrokes(roundId, holeNumber, next)
    setStrokesPending(false)
  }

  function getAutoStrokes(holeNumber: number): string[] {
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole?.stroke_index) return []
    const effHcp = (h: number) => Math.max(0, Math.trunc(h))
    return players.filter((p) => {
      if (p.handicap == null) return false
      const strokes = effHcp(p.handicap)
      return strokes > 0 && hole.stroke_index! <= strokes
    }).map((p) => p.id)
  }

  function netSavedGlobal(pid: string, holeNumber: number): number | undefined {
    const gross = savedScores.find((s) => s.player_id === pid && s.hole_number === holeNumber)?.strokes
    if (gross === undefined) return undefined
    return gross - ((holeStrokes[holeNumber] ?? []).includes(pid) ? 1 : 0)
  }

  function bankerMultiplier(net: number, par: number): number {
    if (net <= par - 2) return 3
    if (net === par - 1) return 2
    return 1
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
      const bankerNet = netSavedGlobal(bankerId, hole.hole_number)
      if (bankerNet === undefined) continue
      for (const p of players) {
        if (p.id === bankerId) continue
        const playerNet = netSavedGlobal(p.id, hole.hole_number)
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

  async function handleSaveBankerHole(holeNumber: number, bankerPlayerId: string | null, maxBet: number) {
    setBankerHoles((prev) => ({ ...prev, [holeNumber]: { bankerPlayerId, maxBet } }))
    await saveBankerHole(roundId, groupId, holeNumber, bankerPlayerId, maxBet)
  }
  async function handleSaveBankerBets(holeNumber: number, bets: Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }>) {
    setBankerBets((prev) => ({ ...prev, [holeNumber]: bets }))
    const arr = Object.entries(bets).map(([pid, b]) => ({ playerId: pid, baseBet: b.baseBet, playerDoubled: b.playerDoubled, bankerDoubled: b.bankerDoubled }))
    await saveBankerBets(roundId, groupId, holeNumber, arr)
  }

  function getBankerAutoStrokes(holeNumber: number): string[] {
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole?.stroke_index) return []
    const bankerPlayerId = bankerHoles[holeNumber]?.bankerPlayerId ?? null
    if (!bankerPlayerId) return []
    const bankerHcpRaw = players.find((p) => p.id === bankerPlayerId)?.handicap ?? null
    if (bankerHcpRaw == null) return []
    const effHcp = (h: number) => Math.max(0, Math.trunc(h))
    const bankerHcp = effHcp(bankerHcpRaw)
    return players.filter((p) => {
      if (p.id === bankerPlayerId) return false
      const hcp = p.handicap ?? null
      if (hcp == null) return false
      const diff = effHcp(hcp) - bankerHcp
      return diff > 0 && hole.stroke_index! <= diff
    }).map((p) => p.id)
  }

  const currentHole = holes.find((h) => !savedHoles.has(h.hole_number))?.hole_number ?? null

  function expandHole(holeNumber: number) {
    const h = holes.find((h) => h.hole_number === holeNumber)
    if (!h) return
    if (!isStarted) return
    // Block holes beyond the current (first unsaved) hole
    if (!savedHoles.has(holeNumber) && currentHole !== null && holeNumber > currentHole) return
    setExpandedHole((prev) => {
      if (prev === holeNumber) return null
      if (isDaytonaMode && !assignments[holeNumber]) {
        setAssignments((a) => ({ ...a, [holeNumber]: {} }))
      }
      return holeNumber
    })
  }

  async function saveHole(holeNumber: number, pressActive = false, pressValue = '') {
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole) return

    if (isDaytonaMode) {
      const holeAssignments = assignments[holeNumber] ?? {}
      const leftCount = Object.values(holeAssignments).filter((s) => s === 'left').length
      if (leftCount !== 2) {
        setErrors((prev) => ({ ...prev, [holeNumber]: 'Assign exactly 2 players to Left before saving.' }))
        return
      }
    }

    const playerScores = players.map((p) => ({
      playerId: p.id,
      strokes: strokes[p.id]?.[holeNumber] ?? hole.par,
    }))
    setPendingHoles((prev) => new Set([...prev, holeNumber]))
    setErrors((prev) => { const e = { ...prev }; delete e[holeNumber]; return e })

    const holeAssignments = assignments[holeNumber] ?? {}

    const pressEntries: { holeNumber: number; valuePerPoint: number | null }[] = []
    if (isDaytonaMode && pressActive) {
      const rawVal = parseFloat(pressValue)
      const pressVal = isNaN(rawVal) || rawVal <= 0 ? null : rawVal
      const scope = pressScope[holeNumber] ?? 'this'
      const affectedHoles = scope === 'forward'
        ? holes.filter((h) => h.hole_number >= holeNumber).map((h) => h.hole_number)
        : [holeNumber]
      for (const hn of affectedHoles) pressEntries.push({ holeNumber: hn, valuePerPoint: pressVal })
    }

    const [res, , pressRes] = await Promise.all([
      submitGroupHoleScores(groupId, holeNumber, playerScores),
      isDaytonaMode
        ? saveDaytonaAssignments(
            roundId,
            holeNumber,
            Object.entries(holeAssignments).map(([playerId, side]) => ({ playerId, side }))
          )
        : Promise.resolve(),
      isDaytonaMode && pressEntries.length > 0
        ? saveDaytonaHoleValues(roundId, groupId, pressEntries)
        : Promise.resolve(null),
    ])

    setPendingHoles((prev) => { const s = new Set(prev); s.delete(holeNumber); return s })
    if (res.error) { setErrors((prev) => ({ ...prev, [holeNumber]: res.error! })); return }
    if (pressRes && typeof pressRes === 'object' && 'error' in pressRes && pressRes.error) {
      setErrors((prev) => ({ ...prev, [holeNumber]: `Press save failed: ${pressRes.error}` })); return
    }

    if (pressEntries.length > 0) {
      setHoleValues((prev) => {
        const next = { ...prev }
        for (const e of pressEntries) { if (e.valuePerPoint === null) delete next[e.holeNumber]; else next[e.holeNumber] = e.valuePerPoint }
        return next
      })
      setPressShowInput((prev) => { const n = { ...prev }; delete n[holeNumber]; return n })
      setPressValueStr((prev) => { const n = { ...prev }; delete n[holeNumber]; return n })
      setPressScope((prev) => { const n = { ...prev }; delete n[holeNumber]; return n })
    }
    setSavedHoles((prev) => new Set([...prev, holeNumber]))
    // Ensure all banker bets are persisted (fill in defaults for players who didn't explicitly set a bet)
    if (isBanker) {
      const hd = bankerHoles[holeNumber]
      if (hd?.bankerPlayerId) {
        const currentBets = bankerBets[holeNumber] ?? {}
        const allBets: Record<string, { baseBet: number; playerDoubled: boolean; bankerDoubled: boolean }> = {}
        for (const p of players) {
          if (p.id === hd.bankerPlayerId) continue
          allBets[p.id] = currentBets[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
        }
        if (Object.keys(allBets).length > 0) handleSaveBankerBets(holeNumber, allBets)
      }
    }
    const newScores = playerScores.map((ps) => ({ player_id: ps.playerId, hole_number: holeNumber, strokes: ps.strokes }))
    setSavedScores((prev) => {
      const filtered = prev.filter((s) => s.hole_number !== holeNumber || !players.some((p) => p.id === s.player_id))
      return [...filtered, ...newScores]
    })
    setAllScores((prev) => {
      const filtered = prev.filter((s) => s.hole_number !== holeNumber || !players.some((p) => p.id === s.player_id))
      return [...filtered, ...newScores]
    })
    // Auto-advance to next unsaved hole
    const nextHole = holes.find((h) => h.hole_number > holeNumber && !savedHoles.has(h.hole_number) && h.hole_number !== holeNumber)
    if (isDaytonaMode && nextHole && !assignments[nextHole.hole_number]) {
      setAssignments((a) => ({ ...a, [nextHole.hole_number]: {} }))
    }
    if (nextHole) {
      setExpandedHole(nextHole.hole_number)
      setTimeout(() => {
        const el = document.getElementById(`hole-${holeNumber}`)
        if (!el) return
        const headerEl = document.querySelector('header')
        const headerHeight = headerEl?.offsetHeight ?? 96
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerHeight - 8, behavior: 'smooth' })
      }, 100)
    } else setExpandedHole(null)
  }

  async function handleSignOut() {
    await fetch('/api/playing-group-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId }) })
    window.location.href = isMaster ? '/master/dashboard' : `/${orgSlug}`
  }

  // Ball score popup for a player
  const popupPlayer = playerPopup ? players.find((p) => p.id === playerPopup) : null
  const popupTeamId = popupPlayer?.team_id ?? null
  const popupTeamPlayerIds = popupTeamId ? (teamPlayerMap[popupTeamId] ?? []) : []
  const popupBallSummary = popupTeamId && popupTeamPlayerIds.length > 0
    ? computeTeamBallSummary(holes, popupTeamPlayerIds, allScores, ballsCount)
    : null

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number > 9)

  function ballSummarySection(label: string, holeSubset: Hole[]) {
    if (!popupBallSummary || holeSubset.length === 0) return null
    const sub = computeTeamBallSummary(holeSubset, popupTeamPlayerIds, allScores, ballsCount)
    return (
      <div className="mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</p>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: ballsCount }, (_, bi) => {
            const vsp = sub.ballVsPar[bi]
            return (
              <div key={bi} className="flex-1 min-w-0 bg-gray-50 rounded-lg p-2 text-center border border-gray-100">
                <p className="text-[10px] text-gray-400 font-medium mb-0.5">{BALL_NAMES[bi]}</p>
                <p className="text-sm font-bold" style={{ color: vsp == null ? '#9ca3af' : vsp < 0 ? '#16a34a' : vsp > 0 ? '#dc2626' : navy }}>
                  {vsp == null ? '–' : vsp > 0 ? `+${vsp}` : vsp === 0 ? 'E' : vsp}
                </p>
                {sub.ballTotals[bi] != null && (
                  <p className="text-[10px] text-gray-400">{sub.ballTotals[bi]}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>

      {/* Options modal */}
      {showOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowOptions(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Options</h2>
              <button onClick={() => setShowOptions(false)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              <button onClick={() => { setShowOptions(false); setShowScorecards(true) }}
                className="w-full text-center py-3 rounded-xl font-semibold text-sm"
                style={{ background: gold, color: navy }}>
                Scorecards
              </button>
              {isAdmin ? (
                <a href={`/${orgSlug}/admin/dashboard`} className="w-full text-center py-3 rounded-xl font-semibold text-sm text-white" style={{ background: navy }}>
                  Admin Hub
                </a>
              ) : (
                <a href={`/${orgSlug}/admin`} className="w-full text-center py-3 rounded-xl font-semibold text-sm text-white" style={{ background: navy }}>
                  Admin Login
                </a>
              )}
              {isMaster && (
                <a href="/master/dashboard" className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: gold, color: '#92400e', background: '#fffbeb' }}>
                  ← Master Admin
                </a>
              )}
              {showSignOutConfirm ? (
                <div className="space-y-2">
                  <p className="text-sm text-center text-gray-700 font-medium">Sign out of this group?</p>
                  <div className="flex gap-2">
                    <button onClick={handleSignOut} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white" style={{ background: '#dc2626' }}>Sign Out</button>
                    <button onClick={() => setShowSignOutConfirm(false)} className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowSignOutConfirm(true)} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#6b7280' }}>
                  Sign Out of {groupName}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Player score popup */}
      {playerPopup && popupPlayer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setPlayerPopup(null)}>
          <div className="bg-white rounded-t-3xl w-full max-w-lg p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900">{popupPlayer.name}</h3>
                {popupPlayer.handicap != null && (
                  <span className="text-xs text-gray-400">
                    {popupPlayer.handicap < 0 ? `+${Math.abs(popupPlayer.handicap)}` : popupPlayer.handicap} HCP
                  </span>
                )}
              </div>
              <button onClick={() => setPlayerPopup(null)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <p className="text-xs text-gray-400 mb-4">{teamMap[popupPlayer.team_id] ?? 'Unknown team'}</p>
            {(() => {
              const pScores = savedScores.filter((s) => s.player_id === popupPlayer.id)
              if (pScores.length === 0) return <p className="text-sm text-gray-400 text-center py-4">No scores yet</p>
              const calcVsPar = (holeSubset: typeof frontHoles) => {
                const played = holeSubset.filter((h) => pScores.some((s) => s.hole_number === h.hole_number))
                if (played.length === 0) return null
                return played.reduce((sum, h) => {
                  const s = pScores.find((sc) => sc.hole_number === h.hole_number)
                  return sum + (s ? s.strokes - h.par : 0)
                }, 0)
              }
              const fmtVp = (vp: number | null) => vp === null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : String(vp)
              const vpColor = (vp: number | null) => vp === null ? '#9ca3af' : vp < 0 ? '#16a34a' : vp > 0 ? '#dc2626' : '#374151'
              const frontVp = calcVsPar(frontHoles)
              const backVp = calcVsPar(backHoles)
              const totalVp = calcVsPar(holes)
              return (
                <div className="flex justify-around text-center">
                  {[{ label: 'Front 9', vp: frontVp }, { label: 'Back 9', vp: backVp }, { label: 'Total', vp: totalVp }].map(({ label, vp }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-400 mb-1">{label}</p>
                      <p className="text-xl font-bold" style={{ color: vpColor(vp) }}>{fmtVp(vp)}</p>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {showScorecards && (
        <ScorecardBottomSheet
          title={groupName}
          players={players}
          holes={holes}
          scores={savedScores}
          onClose={() => setShowScorecards(false)}
          isDaytonaMode={isDaytonaMode}
          assignments={assignments}
          holeStrokes={holeStrokes}
          holeValues={holeValues}
          dtPayoutValue={defaultDtPayoutValue ?? 0}
          is5Man={is5Man}
          isFlares={isFlares}
          isBankerMode={isBanker}
          bankerHoles={bankerHoles}
          bankerBets={bankerBets}
          bankerMinBet={bankerMinBet}
        />
      )}

      {/* Header */}
      <header ref={headerRef} className="text-white px-4 pt-4 pb-3 z-10 shadow-md" style={{ position: 'fixed', top: 0, left: 0, right: 0, background: navy }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Score Entry</p>
              <h1 className="font-bold text-lg">{groupName}</h1>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{roundCourse} · {formattedDate}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowScorecards(true)} className="text-xs px-3 py-1.5 rounded-lg border font-medium" style={{ background: navy, borderColor: '#6b7280', color: '#9ca3af' }}>
                Scorecards
              </button>
              <a href={`/${orgSlug}`} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: gold, color: navy }}>Leaderboard</a>
            </div>
          </div>
          {/* Player scores — Daytona points or to-par (hidden in banker mode) */}
          {!isBanker && (() => {
            // Compute running totals using the same direct logic as per-hole holePlayerPoints
            const ptsMap = new Map<string, number>()
            if (isDaytonaMode) {
              for (const hole of holes) {
                if (!savedHoles.has(hole.hole_number)) continue
                const holeAssignments = assignments[hole.hole_number] ?? {}
                const leftIds = Object.entries(holeAssignments).filter(([, s]) => s === 'left').map(([id]) => id)
                const rightIds = Object.entries(holeAssignments).filter(([, s]) => s === 'right').map(([id]) => id)
                const strokeIds = holeStrokes[hole.hole_number] ?? []
                const netScores = savedScores.map((s) => ({ ...s, strokes: s.strokes - (strokeIds.includes(s.player_id) ? 1 : 0) }))
                if (is5Man) {
                  if (leftIds.length < 2 || rightIds.length < 3) continue
                  const holePts = computeHoleDaytonaPointsFiveMan(leftIds, rightIds, netScores, hole.hole_number, hole.par)
                  for (const [id, pts] of holePts) ptsMap.set(id, (ptsMap.get(id) ?? 0) + pts)
                } else {
                  if (leftIds.length < 2 || rightIds.length < 2) continue
                  const lScores = leftIds.map((id) => netScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
                  const rScores = rightIds.map((id) => netScores.find((s) => s.player_id === id && s.hole_number === hole.hole_number)?.strokes).filter((s): s is number => s !== undefined)
                  if (lScores.length < 2 || rScores.length < 2) continue
                  const { leftDt, rightDt } = computeHoleDaytonaWithSides(lScores, rScores, hole.par)
                  if (leftDt === null || rightDt === null) continue
                  const diff = Math.abs(leftDt - rightDt)
                  const leftPts = leftDt < rightDt ? diff : leftDt > rightDt ? -diff : 0
                  for (const id of leftIds) ptsMap.set(id, (ptsMap.get(id) ?? 0) + leftPts)
                  for (const id of rightIds) ptsMap.set(id, (ptsMap.get(id) ?? 0) - leftPts)
                }
              }
            }
            return (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-white/10 mt-1">
                {players.map((p) => {
                  let display: string
                  let color: string
                  if (isDaytonaMode) {
                    const hasPlayed = savedScores.some((s) => s.player_id === p.id)
                    const pts = hasPlayed ? (ptsMap.get(p.id) ?? 0) : null
                    display = pts === null ? '–' : pts === 0 ? '0' : pts > 0 ? `+${pts}` : String(pts)
                    color = pts === null ? 'rgba(255,255,255,0.4)' : pts > 0 ? '#4ade80' : pts < 0 ? '#f87171' : 'rgba(255,255,255,0.7)'
                  } else {
                    const toPar = scoreToPar(savedScores.filter((s) => savedHoles.has(s.hole_number)), p.id, holes)
                    display = formatToPar(toPar)
                    color = toParColor(toPar)
                  }
                  return (
                    <span key={p.id} className="flex items-center gap-1 text-xs">
                      <span style={{ color: 'rgba(255,255,255,0.6)' }}>{p.name.split(' ')[0]}</span>
                      <span className="font-bold" style={{ color }}>{display}</span>
                    </span>
                  )
                })}
              </div>
            )
          })()}
          {isBanker && Object.values(bankerRunningTotals).some((v) => v !== 0) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-white/10 mt-1">
              {players.map((p) => {
                const amt = bankerRunningTotals[p.id] ?? 0
                return (
                  <span key={p.id} className="flex items-center gap-1 text-xs">
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>{p.name.split(' ')[0]}:</span>
                    <span className="font-bold" style={{ color: amt > 0 ? '#4ade80' : amt < 0 ? '#f87171' : 'rgba(255,255,255,0.4)' }}>
                      {`$${Math.abs(Math.round(amt))}`}
                    </span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </header>
      <div ref={spacerRef} />

      {/* Hole list */}
      <div className="max-w-lg mx-auto px-4 pt-4 pb-16 space-y-2">
        {!isStarted && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-semibold text-amber-800">Round not yet active</p>
          </div>
        )}

        {/* Completion box */}
        {savedHoles.size === holes.length && holes.length > 0 && (
          <div className="rounded-xl border-2 px-4 py-4 flex items-center gap-4" style={{ borderColor: '#f59e0b', background: '#fffbeb' }}>
            <span className="text-4xl flex-shrink-0">⛳</span>
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="font-bold text-gray-900">All {holes.length} holes submitted!</p>
              {(allGroupsDone === null || allGroupsDone === false) && (
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                  <p className="text-sm text-gray-500">Waiting for other groups to finish…</p>
                </div>
              )}
              {allGroupsDone === true && (
                <a href={`/${orgSlug}`} className="text-sm font-bold text-amber-700 underline">View Final Payouts →</a>
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
          const holeAssignments = assignments[hole.hole_number] ?? {}
          const leftCount = Object.values(holeAssignments).filter((s) => s === 'left').length
          const holeLeftLabel = isFlares && hole.par === 3 ? 'Close' : leftLabel
          const holeRightLabel = isFlares && hole.par === 3 ? 'Far' : rightLabel

          const holeStrokeIds = holeStrokes[hole.hole_number] ?? []
          // Net = gross - 1 if player has a stroke on this hole
          const netSaved = (pid: string) => {
            const gross = savedScores.find((s) => s.player_id === pid && s.hole_number === hole.hole_number)?.strokes
            if (gross === undefined) return undefined
            return gross - (holeStrokeIds.includes(pid) ? 1 : 0)
          }

          // DT scores for collapsed preview (net)
          const savedLeftScores = players.filter((p) => holeAssignments[p.id] === 'left').map((p) => netSaved(p.id)).filter((s): s is number => s !== undefined)
          const savedRightScores = players.filter((p) => holeAssignments[p.id] === 'right').map((p) => netSaved(p.id)).filter((s): s is number => s !== undefined)
          const { leftDt, rightDt } = isDaytonaMode ? computeHoleDaytonaWithSides(savedLeftScores, savedRightScores, hole.par) : { leftDt: null, rightDt: null }

          // For 5-man: compute DT for each of the 3 right-side pairs (and corresponding left scores)
          const savedRightPairDts: (number | null)[] = (() => {
            if (!is5Man) return []
            const rightPlayers = players.filter((p) => holeAssignments[p.id] === 'right')
            if (rightPlayers.length !== 3) return []
            return ([[0,1],[0,2],[1,2]] as [number,number][]).map(([a, b]) => {
              const pScores = [rightPlayers[a], rightPlayers[b]]
                .map((p) => netSaved(p.id))
                .filter((s): s is number => s !== undefined)
              return computeHoleDaytonaWithSides(savedLeftScores, pScores, hole.par).rightDt
            })
          })()
          const savedLeftPairDts: (number | null)[] = (() => {
            if (!is5Man) return []
            const rightPlayers = players.filter((p) => holeAssignments[p.id] === 'right')
            if (rightPlayers.length !== 3) return []
            return ([[0,1],[0,2],[1,2]] as [number,number][]).map(([a, b]) => {
              const pScores = [rightPlayers[a], rightPlayers[b]]
                .map((p) => netSaved(p.id))
                .filter((s): s is number => s !== undefined)
              return computeHoleDaytonaWithSides(savedLeftScores, pScores, hole.par).leftDt
            })
          })()

          // Per-player DT points for inline label (net scores)
          const holePlayerPoints: Map<string, number> = (() => {
            if (!isDaytonaMode || !isSaved) return new Map()
            const leftIds = players.filter((p) => holeAssignments[p.id] === 'left').map((p) => p.id)
            const rightIds = players.filter((p) => holeAssignments[p.id] === 'right').map((p) => p.id)
            if (is5Man) {
              if (leftIds.length < 2 || rightIds.length < 3) return new Map()
              const netScores = savedScores.map((s) => ({ ...s, strokes: s.strokes - (holeStrokeIds.includes(s.player_id) ? 1 : 0) }))
              return computeHoleDaytonaPointsFiveMan(leftIds, rightIds, netScores, hole.hole_number, hole.par)
            }
            if (savedLeftScores.length < 2 || savedRightScores.length < 2) return new Map()
            const { leftDt: lDt, rightDt: rDt } = computeHoleDaytonaWithSides(savedLeftScores, savedRightScores, hole.par)
            if (lDt === null || rDt === null) return new Map()
            const diff = Math.abs(lDt - rDt)
            const leftPts = lDt < rDt ? diff : lDt > rDt ? -diff : 0
            const map = new Map<string, number>()
            leftIds.forEach((id) => map.set(id, leftPts))
            rightIds.forEach((id) => map.set(id, -leftPts))
            return map
          })()

          return (
            <div key={hole.hole_number} id={`hole-${hole.hole_number}`}
              className="bg-white rounded-xl border overflow-hidden"
              style={{ borderColor: isSaved ? gold : '#e5e7eb' }}>
              <button type="button"
                className={`w-full flex items-center px-3 py-2.5 gap-2 text-left${isLocked ? ' cursor-not-allowed opacity-50' : ''}`}
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
                {isDaytonaMode && isSaved && holeValues[hole.hole_number] !== undefined && (
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#fef3c7', color: '#92400e' }}>
                    ↑${holeValues[hole.hole_number]}
                  </span>
                )}
                {isBanker && bankerHoles[hole.hole_number]?.bankerPlayerId && (() => {
                  const bankerId = bankerHoles[hole.hole_number].bankerPlayerId!
                  const bankerName = players.find((p) => p.id === bankerId)?.name.split(' ')[0] ?? 'Banker'
                  let bankerResult: number | null = null
                  if (isSaved) {
                    const bankerNet = netSavedGlobal(bankerId, hole.hole_number)
                    if (bankerNet !== undefined) {
                      const hBets = bankerBets[hole.hole_number] ?? {}
                      let tot = 0
                      for (const p of players) {
                        if (p.id === bankerId) continue
                        const pNet = netSavedGlobal(p.id, hole.hole_number)
                        if (pNet === undefined) continue
                        const bet = hBets[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
                        const eff = bet.baseBet * (bet.playerDoubled ? 2 : 1) * (bet.bankerDoubled ? 2 : 1)
                        let res = 0
                        if (pNet < bankerNet) res = eff * bankerMultiplier(pNet, hole.par)
                        else if (pNet > bankerNet) res = -eff * bankerMultiplier(bankerNet, hole.par)
                        tot -= res
                      }
                      bankerResult = tot
                    }
                  }
                  return (
                    <div className="flex flex-col items-center flex-shrink-0">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                        🏦 {bankerName}
                      </span>
                      {bankerResult !== null && (
                        <span className="text-[10px] font-semibold leading-tight" style={{ color: bankerResult > 0 ? '#16a34a' : bankerResult < 0 ? '#dc2626' : '#6b7280' }}>
                          {`$${Math.abs(Math.round(bankerResult))}`}
                        </span>
                      )}
                    </div>
                  )
                })()}
                <div className="flex-1" />
                {isSaved && (
                  <div className="flex items-center gap-1.5 mr-1">
                    {isDaytonaMode ? (
                      <>
                        {is5Man && savedLeftPairDts.length === 3 ? (
                          <div className="text-center mr-1">
                            <p className="text-xs" style={{ color: '#2563eb' }}>{holeLeftLabel}</p>
                            <p className="font-bold text-sm text-gray-900">
                              {[...savedLeftPairDts].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)).map((dt) => dt ?? '–').join('/')}
                            </p>
                          </div>
                        ) : (
                          <div className="text-center mr-1">
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
                          <div className="text-center">
                            <p className="text-xs" style={{ color: '#92400e' }}>{holeRightLabel}</p>
                            <p className="font-bold text-sm text-gray-900">{rightDt ?? '–'}</p>
                          </div>
                        )}
                      </>
                    ) : isBanker ? (() => {
                      const hd = bankerHoles[hole.hole_number]
                      const bankerId = hd?.bankerPlayerId ?? null
                      if (!bankerId) return null
                      const bets = bankerBets[hole.hole_number] ?? {}
                      const bankerNet = netSavedGlobal(bankerId, hole.hole_number)
                      if (bankerNet === undefined) return null
                      let bankerTotal = 0
                      const playerAmts: Record<string, number> = {}
                      for (const p of players) {
                        if (p.id === bankerId) continue
                        const playerNet = netSavedGlobal(p.id, hole.hole_number)
                        if (playerNet === undefined) continue
                        const bet = bets[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
                        const eff = bet.baseBet * (bet.playerDoubled ? 2 : 1) * (bet.bankerDoubled ? 2 : 1)
                        let result = 0
                        if (playerNet < bankerNet) result = eff * bankerMultiplier(playerNet, hole.par)
                        else if (playerNet > bankerNet) result = -eff * bankerMultiplier(bankerNet, hole.par)
                        playerAmts[p.id] = result
                        bankerTotal -= result
                      }
                      return players.filter((p) => p.id !== bankerId)
                        .sort((a, b) => (playerAmts[b.id] ?? 0) - (playerAmts[a.id] ?? 0))
                        .map((p) => {
                        const amt = playerAmts[p.id] ?? 0
                        return (
                          <div key={p.id} className="text-center flex-shrink-0">
                            <p className="leading-tight text-gray-400" style={{ fontSize: 'clamp(8px, 2.2vw, 10px)' }}>{p.name.split(' ')[0]}</p>
                            <p className="font-semibold leading-tight" style={{ fontSize: 'clamp(9px, 2.4vw, 11px)', color: amt > 0 ? '#16a34a' : amt < 0 ? '#dc2626' : '#6b7280' }}>
                              {`$${Math.abs(Math.round(amt))}`}
                            </p>
                          </div>
                        )
                      })
                    })() : null}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isSaved && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>✓</span>}
                  {isLocked && !isSaved
                    ? <span className="text-gray-300 text-sm">🔒</span>
                    : <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>}
                </div>
              </button>

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
                      <div className="bg-blue-50 rounded-xl p-2 space-y-2 border border-blue-100">
                        <div>
                          <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1">
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
                        {hd.bankerPlayerId && (
                          <div>
                            <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1">
                              Max Bet (min ${bankerMinBet})
                            </p>
                            <div className="flex items-center gap-3">
                              <input
                                type="number" inputMode="numeric"
                                value={maxBetDraft[hole.hole_number] ?? String(hd.maxBet)}
                                min={bankerMinBet}
                                style={{ fontSize: '16px', width: '52px', textAlign: 'center', fontWeight: 'bold' }}
                                className="border border-gray-200 rounded-lg px-1 py-0.5 focus:outline-none focus:border-blue-300"
                                onTouchStart={noScrollFocus}
                                onChange={(e) => setMaxBetDraft(prev => ({ ...prev, [hole.hole_number]: e.target.value }))}
                                onBlur={() => {
                                  const raw = maxBetDraft[hole.hole_number]
                                  setMaxBetDraft(prev => { const n = { ...prev }; delete n[hole.hole_number]; return n })
                                  if (raw !== undefined) {
                                    const v = Math.max(bankerMinBet, Math.round(parseFloat(raw) || bankerMinBet))
                                    handleSaveBankerHole(hole.hole_number, hd.bankerPlayerId, v)
                                  }
                                }}
                              />
                              <span className="text-xs text-gray-400">min ${bankerMinBet}</span>
                            </div>
                          </div>
                        )}
                        {hd.bankerPlayerId && (
                          <div>
                            <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1">Player Bets</p>
                            <div className="space-y-1.5">
                              {players.filter((p) => p.id !== hd.bankerPlayerId).map((p) => {
                                const pb = bets[p.id] ?? { baseBet: bankerMinBet, playerDoubled: false, bankerDoubled: false }
                                const effective = pb.baseBet * (pb.playerDoubled ? 2 : 1) * (pb.bankerDoubled ? 2 : 1)
                                return (
                                  <div key={p.id} className="bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-medium text-gray-700 flex-1 truncate">{p.name}</span>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number" inputMode="numeric"
                                          value={playerBetDraft[hole.hole_number]?.[p.id] ?? String(pb.baseBet)}
                                          min={bankerMinBet} max={hd.maxBet}
                                          style={{ fontSize: '16px', width: '44px', textAlign: 'center', fontWeight: 'bold' }}
                                          className="border border-gray-200 rounded-lg px-1 py-0.5 focus:outline-none focus:border-blue-300"
                                          onTouchStart={noScrollFocus}
                                          onChange={(e) => setPlayerBetDraft(prev => ({ ...prev, [hole.hole_number]: { ...(prev[hole.hole_number] ?? {}), [p.id]: e.target.value } }))}
                                          onBlur={() => {
                                            const raw = playerBetDraft[hole.hole_number]?.[p.id]
                                            setPlayerBetDraft(prev => { const n = { ...prev }; const h = { ...(n[hole.hole_number] ?? {}) }; delete h[p.id]; n[hole.hole_number] = h; return n })
                                            if (raw !== undefined) {
                                              const v = Math.min(hd.maxBet, Math.max(bankerMinBet, Math.round(parseFloat(raw) || bankerMinBet)))
                                              handleSaveBankerBets(hole.hole_number, { ...bets, [p.id]: { ...pb, baseBet: v } })
                                            }
                                          }}
                                        />
                                      </div>
                                      <button type="button"
                                        onClick={() => handleSaveBankerBets(hole.hole_number, { ...bets, [p.id]: { ...pb, playerDoubled: !pb.playerDoubled } })}
                                        className={`text-[11px] px-1.5 py-0.5 rounded border font-semibold transition ${pb.playerDoubled ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>
                                        {pb.playerDoubled ? '2× ✓' : '2×'}
                                      </button>
                                    </div>
                                    {(pb.playerDoubled || pb.bankerDoubled) && (
                                      <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
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
                      </div>
                    )
                  })()}

                  {players.map((player) => {
                    const val = strokes[player.id]?.[hole.hole_number] ?? hole.par
                    const side = holeAssignments[player.id] as 'left' | 'right' | undefined
                    const isAssigned = player.id in holeAssignments
                    const defaultSide: 'left' | 'right' = leftCount < 2 ? 'left' : 'right'
                    const displaySide = side ?? defaultSide
                    const allAssigned = !isDaytonaMode || players.every((p) => p.id in holeAssignments)
                    const canScore = !isDaytonaMode || allAssigned
                    return (
                      <div key={player.id} className="flex items-center gap-2">
                        {isDaytonaMode && (
                          <button
                            type="button"
                            onClick={() => {
                              setAssignments((prev) => {
                                const hm = { ...(prev[hole.hole_number] ?? {}) }
                                hm[player.id] = isAssigned ? (side === 'left' ? 'right' : 'left') : displaySide
                                const newLeft = Object.values(hm).filter(s => s === 'left').length
                                if (newLeft === 2) { for (const p of players) { if (!(p.id in hm)) hm[p.id] = 'right' } }
                                const newRight = Object.values(hm).filter(s => s === 'right').length
                                const rightTarget = is5Man ? 3 : 2
                                if (newRight === rightTarget) { for (const p of players) { if (!(p.id in hm)) hm[p.id] = 'left' } }
                                return { ...prev, [hole.hole_number]: hm }
                              })
                            }}
                            className="flex-shrink-0 text-xs font-bold px-2 rounded-lg border transition flex items-center justify-center"
                            style={{
                              background: !isAssigned ? (defaultSide === 'left' ? '#dbeafe' : '#fef3c7') : (side === 'left' ? '#2563eb' : '#b45309'),
                              color: !isAssigned ? (defaultSide === 'left' ? '#2563eb' : '#b45309') : 'white',
                              borderColor: !isAssigned ? (defaultSide === 'left' ? '#93c5fd' : '#fcd34d') : (side === 'left' ? '#2563eb' : '#b45309'),
                              minWidth: '3rem', height: '1.5rem',
                            }}>
                            {isAssigned ? (side === 'left' ? holeLeftLabel : holeRightLabel) : '+'}
                          </button>
                        )}
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate min-w-0">
                          {player.name}{holeStrokeIds.includes(player.id) ? <span className="text-blue-500 font-bold">*</span> : ''}
                          {isDaytonaMode && isSaved && (() => {
                            const pts = holePlayerPoints.get(player.id)
                            if (!pts) return null
                            return <span className="ml-1.5 text-xs font-semibold" style={{ color: pts > 0 ? '#16a34a' : '#dc2626' }}>{pts > 0 ? `+${pts}` : pts}</span>
                          })()}
                        </span>
                        <button type="button"
                          disabled={!canScore}
                          onClick={() => setStrokes((prev) => ({ ...prev, [player.id]: { ...(prev[player.id] ?? {}), [hole.hole_number]: Math.max(1, (prev[player.id]?.[hole.hole_number] ?? hole.par) - 1) } }))}
                          className={`w-8 h-8 rounded-full bg-gray-100 font-bold flex items-center justify-center flex-shrink-0 transition${canScore ? ' hover:bg-gray-200 active:scale-90' : ' cursor-not-allowed'}`}
                          style={{ color: canScore ? '#374151' : '#d1d5db' }}>−</button>
                        <div className="w-11 flex items-center justify-center flex-shrink-0">
                          {canScore
                            ? <ScoreNotation strokes={val} par={hole.par} />
                            : <span className="text-2xl font-bold" style={{ color: '#d1d5db' }}>{val}</span>}
                        </div>
                        <button type="button"
                          disabled={!canScore}
                          onClick={() => setStrokes((prev) => ({ ...prev, [player.id]: { ...(prev[player.id] ?? {}), [hole.hole_number]: Math.min(20, (prev[player.id]?.[hole.hole_number] ?? hole.par) + 1) } }))}
                          className={`w-8 h-8 rounded-full bg-gray-100 font-bold flex items-center justify-center flex-shrink-0 transition${canScore ? ' hover:bg-gray-200 active:scale-90' : ' cursor-not-allowed'}`}
                          style={{ color: canScore ? '#374151' : '#d1d5db' }}>+</button>
                      </div>
                    )
                  })}

                  {isDaytonaMode && (() => {
                    const allAssigned = players.every((p) => p.id in holeAssignments)
                    if (!allAssigned) return <p className="text-xs text-red-500 mt-1">Select 2 {holeLeftLabel} players</p>
                    if (leftCount !== 2) return <p className="text-xs text-red-500 mt-1">{is5Man ? `Need exactly 2 ${holeLeftLabel} & 3 ${holeRightLabel}` : `Need exactly 2 ${holeLeftLabel} & 2 ${holeRightLabel}`}</p>
                    return null
                  })()}

                  {/* ── Handicap Strokes ── */}
                  {(() => {
                    const autoIds = isBanker ? getBankerAutoStrokes(hole.hole_number) : getAutoStrokes(hole.hole_number)
                    const visiblePlayers = players.filter((p) => autoIds.includes(p.id) || holeStrokeIds.includes(p.id))
                    if (visiblePlayers.length === 0) return null
                    return (
                      <div className="pt-2 border-t border-gray-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Handicap Strokes</p>
                        <div className="flex flex-wrap gap-2">
                          {visiblePlayers.map((p) => {
                            const hasStroke = holeStrokeIds.includes(p.id)
                            const isSuggested = autoIds.includes(p.id)
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
                                {p.name.split(' ')[0]}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* ── Press (custom payout) ── */}
                  {isDaytonaMode && (() => {
                    const isActive = !!pressShowInput[hole.hole_number]
                    const existingVal = holeValues[hole.hole_number]
                    const currentScope = pressScope[hole.hole_number] ?? 'this'
                    return (
                      <div className="pt-2 border-t border-gray-100">
                        <div className="flex items-center gap-2">
                          <button type="button"
                            onClick={() => {
                              if (isActive) {
                                setPressShowInput((p) => { const n = { ...p }; delete n[hole.hole_number]; return n })
                                setPressValueStr((p) => { const n = { ...p }; delete n[hole.hole_number]; return n })
                              } else {
                                const prefill = existingVal !== undefined ? String(existingVal) : String(defaultDtPayoutValue ?? 0.25)
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
                                <span className="text-xs text-gray-500">Remove?</span>
                                <button type="button" onClick={async () => {
                                  await saveDaytonaHoleValues(roundId, groupId, [{ holeNumber: hole.hole_number, valuePerPoint: null }])
                                  setHoleValues((p) => { const n = { ...p }; delete n[hole.hole_number]; return n })
                                  setPressConfirmHole(null)
                                }} className="text-xs font-semibold text-red-500 hover:text-red-700">Yes</button>
                                <button type="button" onClick={() => setPressConfirmHole(null)} className="text-xs text-gray-400">Cancel</button>
                              </span>
                            ) : (
                              <button type="button" onClick={() => setPressConfirmHole(hole.hole_number)}
                                className="text-xs text-gray-400 hover:text-red-500 transition">Clear</button>
                            )
                          )}
                        </div>
                        {isActive && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">$</span>
                              <input type="number" value={pressValueStr[hole.hole_number] ?? ''} min="0" step="0.25"
                                onChange={(e) => setPressValueStr((p) => ({ ...p, [hole.hole_number]: e.target.value }))}
                                onFocus={(e) => { if (e.target.value === '0') e.target.value = '' }}
                                className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none" />
                              <span className="text-xs text-gray-400">per point</span>
                            </div>
                            <div className="flex gap-2">
                              <button type="button"
                                onClick={() => setPressScope((p) => ({ ...p, [hole.hole_number]: 'this' }))}
                                className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition ${currentScope === 'this' ? 'text-white border-transparent' : 'border-gray-200 text-gray-500'}`}
                                style={currentScope === 'this' ? { background: navy } : {}}>
                                This hole
                              </button>
                              <button type="button"
                                onClick={() => setPressScope((p) => ({ ...p, [hole.hole_number]: 'forward' }))}
                                className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition ${currentScope === 'forward' ? 'text-white border-transparent' : 'border-gray-200 text-gray-500'}`}
                                style={currentScope === 'forward' ? { background: navy } : {}}>
                                Forward holes
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button type="button"
                    onClick={() => saveHole(
                      hole.hole_number,
                      !!pressShowInput[hole.hole_number],
                      pressValueStr[hole.hole_number] ?? ''
                    )}
                    disabled={isPending}
                    className="w-full mt-1 text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                    style={{ background: navy }}>
                    {isPending ? 'Saving…' : 'Save Hole'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

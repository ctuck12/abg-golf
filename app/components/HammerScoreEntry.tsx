'use client'

import { useState, useMemo, Fragment, useEffect, useRef } from 'react'
import { saveHammerHole, submitHammerHoleScores, saveHoleStrokes } from '@/app/actions'

const navy = '#0f172a'
const gold = '#f59e0b'

type Player = { id: string; name: string; team_id: string; handicap?: number | null }
type Hole = { hole_number: number; par: number; stroke_index?: number | null }
type Score = { player_id: string; hole_number: number; strokes: number }
type HammerHoleState = { stake: number; lastHammerTeam: 1 | 2 | null; foldedTeam: 1 | 2 | null; preTeeUsed: boolean }

function formatToPar(val: number | null): string {
  if (val === null) return '–'
  return val > 0 ? `+${val}` : val === 0 ? 'E' : String(val)
}
function toParColor(val: number | null) {
  if (val === null) return 'rgba(255,255,255,0.4)'
  return val < 0 ? '#4ade80' : val > 0 ? '#f87171' : 'rgba(255,255,255,0.7)'
}
function playerSectionToPar(scores: Score[], playerId: string, holes: Hole[], start: number, end: number) {
  let total = 0; let played = 0
  for (const h of holes.filter((h) => h.hole_number >= start && h.hole_number <= end)) {
    const s = scores.find((sc) => sc.player_id === playerId && sc.hole_number === h.hole_number)
    if (s) { total += s.strokes - h.par; played++ }
  }
  return played > 0 ? total : null
}

export default function HammerScoreEntry({
  orgSlug, orgId, orgName, isMaster, isAdmin,
  matchupId, roundId, roundName, roundDate, roundCourse,
  team1, team2, allPlayers, holes, initialScores,
  baseBet, autoHandicap, allPlayerHandicaps, initialHoleStrokes, initialHammerHoles, isStarted,
}: {
  orgSlug: string; orgId: string; orgName: string; isMaster: boolean; isAdmin: boolean
  matchupId: string; roundId: string; roundName: string; roundDate: string; roundCourse: string
  team1: { id: string; name: string }; team2: { id: string; name: string }
  allPlayers: Player[]; holes: Hole[]; initialScores: Score[]
  baseBet: number; autoHandicap: boolean
  allPlayerHandicaps: Record<string, number | null>
  initialHoleStrokes: Record<number, string[]>
  initialHammerHoles: Record<number, HammerHoleState>
  isStarted: boolean
}) {
  const team1Players = allPlayers.filter((p) => p.team_id === team1.id)
  const team2Players = allPlayers.filter((p) => p.team_id === team2.id)

  const [strokes, setStrokes] = useState<Record<string, Record<number, number>>>(() => {
    const s: Record<string, Record<number, number>> = {}
    for (const sc of initialScores) {
      if (!s[sc.player_id]) s[sc.player_id] = {}
      s[sc.player_id][sc.hole_number] = sc.strokes
    }
    return s
  })
  const [savedScores, setSavedScores] = useState<Score[]>(initialScores)
  const [savedHoles, setSavedHoles] = useState<Set<number>>(() => {
    const saved = new Set<number>()
    for (const h of holes) {
      if (allPlayers.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h.hole_number))) {
        saved.add(h.hole_number)
      }
    }
    return saved
  })
  const [expandedHole, setExpandedHole] = useState<number | null>(() => {
    for (const h of holes) {
      if (!allPlayers.every((p) => initialScores.some((s) => s.player_id === p.id && s.hole_number === h.hole_number))) return h.hole_number
    }
    return null
  })
  const [pendingHoles, setPendingHoles] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [hammerHoles, setHammerHoles] = useState<Record<number, HammerHoleState>>(initialHammerHoles)
  const [pendingHammer, setPendingHammer] = useState<{ fromTeam: 1 | 2; holeNumber: number } | null>(null)
  const [holeStrokes, setHoleStrokes] = useState<Record<number, string[]>>(initialHoleStrokes)
  const prevSavedCount = useRef(savedHoles.size)
  useEffect(() => {
    const nowComplete = savedHoles.size === holes.length && holes.length > 0
    const wasComplete = prevSavedCount.current === holes.length && holes.length > 0
    if (nowComplete && !wasComplete) window.scrollTo({ top: 0, behavior: 'smooth' })
    prevSavedCount.current = savedHoles.size
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedHoles.size])
  const [playerPopup, setPlayerPopup] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

  const formattedDate = roundDate
    ? new Date(roundDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  function netSaved(playerId: string, holeNumber: number): number | undefined {
    const gross = savedScores.find((s) => s.player_id === playerId && s.hole_number === holeNumber)?.strokes
    if (gross === undefined) return undefined
    return gross - ((holeStrokes[holeNumber] ?? []).includes(playerId) ? 1 : 0)
  }
  function netEdit(playerId: string, holeNumber: number, par: number): number {
    const gross = strokes[playerId]?.[holeNumber] ?? par
    return gross - ((holeStrokes[holeNumber] ?? []).includes(playerId) ? 1 : 0)
  }

  const holeState = (holeNumber: number): HammerHoleState =>
    hammerHoles[holeNumber] ?? { stake: baseBet, lastHammerTeam: null, foldedTeam: null, preTeeUsed: false }

  const runningTotals = useMemo(() => {
    let t1 = 0; let t2 = 0
    for (const h of holes) {
      if (!savedHoles.has(h.hole_number)) continue
      const hs = holeState(h.hole_number)
      if (hs.foldedTeam === 1) { t2 += hs.stake; t1 -= hs.stake }
      else if (hs.foldedTeam === 2) { t1 += hs.stake; t2 -= hs.stake }
      else {
        const t1Nets = team1Players.map((p) => netSaved(p.id, h.hole_number)).filter((s): s is number => s !== undefined)
        const t2Nets = team2Players.map((p) => netSaved(p.id, h.hole_number)).filter((s): s is number => s !== undefined)
        if (t1Nets.length === 0 || t2Nets.length === 0) continue
        const t1Best = Math.min(...t1Nets); const t2Best = Math.min(...t2Nets)
        if (t1Best === t2Best) continue
        const winner = t1Best < t2Best ? 1 : 2
        const winnerBest = winner === 1 ? t1Best : t2Best
        const mult = winnerBest < h.par ? 3 : 1
        const amount = hs.stake * mult
        if (winner === 1) { t1 += amount; t2 -= amount } else { t2 += amount; t1 -= amount }
      }
    }
    return { team1: t1, team2: t2 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedHoles, hammerHoles, savedScores, holeStrokes, holes])

  function canThrow(teamNum: 1 | 2, holeNumber: number): boolean {
    const hs = holeState(holeNumber)
    return hs.foldedTeam === null && hs.lastHammerTeam !== teamNum
  }

  function canPreTee(teamNum: 1 | 2, holeNumber: number): boolean {
    const hs = holeState(holeNumber)
    if (hs.preTeeUsed || hs.foldedTeam !== null) return false
    if (allPlayers.some((p) => strokes[p.id]?.[holeNumber] !== undefined)) return false
    if (teamNum === 1 && runningTotals.team1 >= 0) return false
    if (teamNum === 2 && runningTotals.team2 >= 0) return false
    return true
  }

  async function handleThrow(fromTeam: 1 | 2, holeNumber: number) {
    setPendingHammer({ fromTeam, holeNumber })
  }

  async function handleAccept(holeNumber: number) {
    if (!pendingHammer) return
    const hs = holeState(holeNumber)
    const next: HammerHoleState = { ...hs, stake: hs.stake * 2, lastHammerTeam: pendingHammer.fromTeam }
    setHammerHoles((prev) => ({ ...prev, [holeNumber]: next }))
    setPendingHammer(null)
    await saveHammerHole(matchupId, holeNumber, next)
  }

  async function handleFold(holeNumber: number) {
    if (!pendingHammer) return
    const hs = holeState(holeNumber)
    const foldedTeam = pendingHammer.fromTeam === 1 ? 2 : 1
    const next: HammerHoleState = { ...hs, foldedTeam }
    setHammerHoles((prev) => ({ ...prev, [holeNumber]: next }))
    setPendingHammer(null)
    await saveHammerHole(matchupId, holeNumber, next)
  }

  async function handlePreTeeHammer(fromTeam: 1 | 2, holeNumber: number) {
    const hs = holeState(holeNumber)
    const next: HammerHoleState = { ...hs, stake: hs.stake * 2, lastHammerTeam: fromTeam, preTeeUsed: true }
    setHammerHoles((prev) => ({ ...prev, [holeNumber]: next }))
    await saveHammerHole(matchupId, holeNumber, next)
  }

  async function handleStrokeToggle(holeNumber: number, playerId: string) {
    const current = holeStrokes[holeNumber] ?? []
    const next = current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    setHoleStrokes((prev) => ({ ...prev, [holeNumber]: next }))
    await saveHoleStrokes(roundId, holeNumber, next)
  }

  async function getAutoStrokes(holeNumber: number): Promise<string[]> {
    if (!autoHandicap) return []
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole?.stroke_index) return []
    const allHcps = Object.values(allPlayerHandicaps).filter((h): h is number => h != null)
    if (allHcps.length === 0) return []
    const effHcp = (h: number) => Math.max(0, Math.trunc(h))
    const minHcp = Math.min(...allHcps.map(effHcp))
    return allPlayers.filter((p) => {
      const hcp = allPlayerHandicaps[p.id] ?? null
      if (hcp == null) return false
      const strokes = effHcp(hcp) - minHcp
      return strokes > 0 && hole.stroke_index! <= strokes
    }).map((p) => p.id)
  }

  async function saveHole(holeNumber: number) {
    const hole = holes.find((h) => h.hole_number === holeNumber)
    if (!hole) return
    const playerScores = allPlayers.map((p) => ({ playerId: p.id, strokes: strokes[p.id]?.[holeNumber] ?? hole.par }))
    setPendingHoles((prev) => new Set([...prev, holeNumber]))
    setErrors((prev) => { const e = { ...prev }; delete e[holeNumber]; return e })
    const res = await submitHammerHoleScores(matchupId, holeNumber, playerScores)
    setPendingHoles((prev) => { const s = new Set(prev); s.delete(holeNumber); return s })
    if (res.error) { setErrors((prev) => ({ ...prev, [holeNumber]: res.error! })); return }
    setSavedHoles((prev) => new Set([...prev, holeNumber]))
    const newScores = playerScores.map((ps) => ({ player_id: ps.playerId, hole_number: holeNumber, strokes: ps.strokes }))
    setSavedScores((prev) => {
      const filtered = prev.filter((s) => s.hole_number !== holeNumber || !allPlayers.some((p) => p.id === s.player_id))
      return [...filtered, ...newScores]
    })
    const nextHole = holes.find((h) => h.hole_number > holeNumber && !savedHoles.has(h.hole_number))
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
    window.location.href = `/${orgSlug}`
  }

  const popupPlayer = playerPopup ? allPlayers.find((p) => p.id === playerPopup) : null

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
              {isAdmin && <a href={`/${orgSlug}/admin/dashboard`} className="w-full text-center py-3 rounded-xl font-semibold text-sm text-white" style={{ background: navy }}>Admin Hub</a>}
              {isMaster && <a href="/master/dashboard" className="w-full text-center py-3 rounded-xl font-semibold text-sm border" style={{ borderColor: gold, color: '#92400e', background: '#fffbeb' }}>← Master Admin</a>}
              {showSignOutConfirm ? (
                <div className="space-y-2">
                  <p className="text-sm text-center text-gray-700 font-medium">Sign out of this group?</p>
                  <div className="flex gap-2">
                    <button onClick={handleSignOut} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white" style={{ background: '#dc2626' }}>Sign Out</button>
                    <button onClick={() => setShowSignOutConfirm(false)} className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowSignOutConfirm(true)} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#6b7280' }}>Sign Out of {orgName}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Player score to par popup */}
      {playerPopup && popupPlayer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setPlayerPopup(null)}>
          <div className="bg-white rounded-t-3xl w-full max-w-lg p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">{popupPlayer.name}</h3>
              <button onClick={() => setPlayerPopup(null)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[['Front 9', 1, 9], ['Back 9', 10, 18], ['Total', 1, 18]].map(([label, start, end]) => {
                const val = playerSectionToPar(savedScores, popupPlayer.id, holes, start as number, end as number)
                return (
                  <div key={label as string} className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">{label as string}</p>
                    <p className="text-xl font-bold" style={{ color: val == null ? '#9ca3af' : val < 0 ? '#16a34a' : val > 0 ? '#dc2626' : navy }}>
                      {val === null ? '–' : val > 0 ? `+${val}` : val === 0 ? 'E' : val}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="text-white px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md" style={{ background: navy }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Hammer</p>
              <h1 className="font-bold text-lg">{roundName}</h1>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{roundCourse} · {formattedDate}</p>
            </div>
            <button onClick={() => setShowOptions(true)} className="text-xs px-3 py-1.5 rounded-lg border font-medium" style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#d1d5db' }}>Options</button>
          </div>

          {/* Team running totals */}
          <div className="flex gap-4 py-1.5 border-t border-white/10">
            <div className="flex-1 text-center">
              <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{team1.name}</p>
              <p className="font-bold text-sm" style={{ color: runningTotals.team1 > 0 ? '#4ade80' : runningTotals.team1 < 0 ? '#f87171' : 'rgba(255,255,255,0.6)' }}>
                {runningTotals.team1 > 0 ? `+$${runningTotals.team1.toFixed(2)}` : runningTotals.team1 < 0 ? `-$${Math.abs(runningTotals.team1).toFixed(2)}` : '$0'}
              </p>
            </div>
            <div className="text-center self-center">
              <p className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>vs</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{team2.name}</p>
              <p className="font-bold text-sm" style={{ color: runningTotals.team2 > 0 ? '#4ade80' : runningTotals.team2 < 0 ? '#f87171' : 'rgba(255,255,255,0.6)' }}>
                {runningTotals.team2 > 0 ? `+$${runningTotals.team2.toFixed(2)}` : runningTotals.team2 < 0 ? `-$${Math.abs(runningTotals.team2).toFixed(2)}` : '$0'}
              </p>
            </div>
          </div>

          {/* Player chips — tap to see score to par */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-white/10">
            {allPlayers.map((p) => {
              const total = playerSectionToPar(savedScores, p.id, holes, 1, 18)
              return (
                <button key={p.id} type="button" onClick={() => setPlayerPopup((prev) => prev === p.id ? null : p.id)}
                  className="flex items-center gap-1 text-xs">
                  <span className="underline underline-offset-2" style={{ color: 'rgba(255,255,255,0.55)' }}>{p.name.split(' ')[0]}</span>
                  <span className="font-bold" style={{ color: toParColor(total) }}>{formatToPar(total)}</span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Hole list */}
      <div className="max-w-lg mx-auto px-4 pt-4 pb-16 space-y-2">
        {!isStarted && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-semibold text-amber-800">Round not yet active</p>
          </div>
        )}

        {savedHoles.size === holes.length && holes.length > 0 && (
          <div className="rounded-xl border-2 px-4 py-4 flex items-center gap-3" style={{ borderColor: gold, background: '#fffbeb' }}>
            <span className="text-3xl flex-shrink-0">⛳</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900">All {holes.length} holes submitted!</p>
              <a href={`/${orgSlug}`} className="text-sm font-bold text-amber-700 underline">Leaderboard →</a>
            </div>
          </div>
        )}

        {holes.map((hole) => {
          const isSaved = savedHoles.has(hole.hole_number)
          const isPending = pendingHoles.has(hole.hole_number)
          const isExpanded = isStarted && expandedHole === hole.hole_number
          const hs = holeState(hole.hole_number)
          const error = errors[hole.hole_number]
          const isPendingHammer = pendingHammer?.holeNumber === hole.hole_number

          // Compute hole result for display on collapsed row
          const holeResult = (() => {
            if (!isSaved) return null
            if (hs.foldedTeam === 1) return { winner: 2, amount: hs.stake, label: `${team2.name} +$${hs.stake} (fold)` }
            if (hs.foldedTeam === 2) return { winner: 1, amount: hs.stake, label: `${team1.name} +$${hs.stake} (fold)` }
            const t1Nets = team1Players.map((p) => netSaved(p.id, hole.hole_number)).filter((s): s is number => s !== undefined)
            const t2Nets = team2Players.map((p) => netSaved(p.id, hole.hole_number)).filter((s): s is number => s !== undefined)
            if (t1Nets.length === 0 || t2Nets.length === 0) return null
            const t1Best = Math.min(...t1Nets); const t2Best = Math.min(...t2Nets)
            if (t1Best === t2Best) return { winner: 0, amount: 0, label: 'Push' }
            const winner = t1Best < t2Best ? 1 : 2
            const winnerBest = winner === 1 ? t1Best : t2Best
            const mult = winnerBest < hole.par ? 3 : 1
            const amount = hs.stake * mult
            const winnerName = winner === 1 ? team1.name : team2.name
            return { winner, amount, label: `${winnerName} +$${amount}${mult === 3 ? ' 🐦' : ''}` }
          })()

          return (
            <div key={hole.hole_number} id={`hole-${hole.hole_number}`}
              className="bg-white rounded-xl border overflow-hidden"
              style={{ borderColor: isSaved ? gold : '#e5e7eb' }}>
              <button type="button"
                className={`w-full flex items-center px-4 py-3 gap-3 text-left${!isStarted ? ' opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => isStarted && setExpandedHole((prev) => prev === hole.hole_number ? null : hole.hole_number)}>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Hole</p>
                  <p className="font-bold text-gray-900">{hole.hole_number}</p>
                </div>
                <div className="w-8 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Par</p>
                  <p className="font-semibold text-gray-600">{hole.par}</p>
                </div>
                <div className="w-12 text-center flex-shrink-0">
                  <p className="text-xs text-gray-400">Stake</p>
                  <p className="font-semibold text-gray-700">${hs.stake}</p>
                </div>
                <div className="flex-1" />
                {isSaved && holeResult && (
                  <span className={`text-xs font-semibold ${holeResult.winner === 0 ? 'text-gray-400' : holeResult.winner === 1 ? 'text-green-600' : 'text-red-500'}`}>
                    {holeResult.label}
                  </span>
                )}
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {isSaved && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>✓</span>}
                  <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-4">
                  {/* ── Hammer Controls ── */}
                  <div className="bg-orange-50 rounded-xl p-3 border border-orange-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Hammer</p>
                      <span className="text-sm font-bold text-orange-800">Stake: ${hs.stake}</span>
                    </div>

                    {hs.foldedTeam !== null ? (
                      <p className="text-xs text-orange-600 font-medium">
                        {hs.foldedTeam === 1 ? team1.name : team2.name} folded — {hs.foldedTeam === 1 ? team2.name : team1.name} wins ${hs.stake}
                      </p>
                    ) : isPendingHammer ? (
                      <div className="space-y-1.5">
                        <p className="text-xs text-orange-700 font-medium">
                          {pendingHammer!.fromTeam === 1 ? team1.name : team2.name} throws hammer → ${hs.stake * 2}
                        </p>
                        <p className="text-xs text-gray-500">{pendingHammer!.fromTeam === 1 ? team2.name : team1.name} decides:</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => handleAccept(hole.hole_number)}
                            className="flex-1 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: '#16a34a' }}>
                            Accept (${hs.stake * 2})
                          </button>
                          <button type="button" onClick={() => handleFold(hole.hole_number)}
                            className="flex-1 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: '#dc2626' }}>
                            Fold (lose ${hs.stake})
                          </button>
                        </div>
                        <button type="button" onClick={() => setPendingHammer(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {/* Pre-tee hammer buttons */}
                        {(canPreTee(1, hole.hole_number) || canPreTee(2, hole.hole_number)) && (
                          <div className="flex gap-2">
                            {canPreTee(1, hole.hole_number) && (
                              <button type="button" onClick={() => handlePreTeeHammer(1, hole.hole_number)}
                                className="flex-1 py-1.5 rounded-lg text-xs font-semibold border-2 border-dashed" style={{ borderColor: '#f59e0b', color: '#92400e', background: '#fef3c7' }}>
                                {team1.name} Pre-Tee 🔨 (must accept)
                              </button>
                            )}
                            {canPreTee(2, hole.hole_number) && (
                              <button type="button" onClick={() => handlePreTeeHammer(2, hole.hole_number)}
                                className="flex-1 py-1.5 rounded-lg text-xs font-semibold border-2 border-dashed" style={{ borderColor: '#f59e0b', color: '#92400e', background: '#fef3c7' }}>
                                {team2.name} Pre-Tee 🔨 (must accept)
                              </button>
                            )}
                          </div>
                        )}
                        {/* Regular hammer buttons */}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => handleThrow(1, hole.hole_number)}
                            disabled={!canThrow(1, hole.hole_number)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-30" style={{ borderColor: navy, color: navy }}>
                            {team1.name} 🔨
                          </button>
                          <button type="button" onClick={() => handleThrow(2, hole.hole_number)}
                            disabled={!canThrow(2, hole.hole_number)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-30" style={{ borderColor: navy, color: navy }}>
                            {team2.name} 🔨
                          </button>
                        </div>
                        {hs.lastHammerTeam && (
                          <p className="text-xs text-gray-400">
                            {hs.lastHammerTeam === 1 ? team1.name : team2.name} threw last — waiting for {hs.lastHammerTeam === 1 ? team2.name : team1.name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Score Inputs ── */}
                  {[{ team: team1, players: team1Players }, { team: team2, players: team2Players }].map(({ team, players: tPlayers }) => (
                    <div key={team.id}>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{team.name}</p>
                      {tPlayers.map((player) => {
                        const val = strokes[player.id]?.[hole.hole_number] ?? hole.par
                        const net = netEdit(player.id, hole.hole_number, hole.par)
                        const rel = net - hole.par
                        const hasStroke = (holeStrokes[hole.hole_number] ?? []).includes(player.id)
                        return (
                          <div key={player.id} className="flex items-center gap-2 mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-gray-800">{player.name}</span>
                                <button type="button" onClick={() => handleStrokeToggle(hole.hole_number, player.id)}
                                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border transition ${hasStroke ? 'bg-green-100 border-green-400 text-green-700' : 'border-gray-200 text-gray-400'}`}>
                                  {hasStroke ? '+1' : 'HCP'}
                                </button>
                              </div>
                              <span className="text-xs font-semibold" style={{ color: rel < 0 ? '#16a34a' : rel > 0 ? '#dc2626' : '#6b7280' }}>
                                {net !== val ? `net ${net} (${rel > 0 ? `+${rel}` : rel === 0 ? 'E' : rel})` : (rel > 0 ? `+${rel}` : rel === 0 ? 'E' : rel)}
                              </span>
                            </div>
                            <button type="button"
                              onClick={() => setStrokes((prev) => ({ ...prev, [player.id]: { ...(prev[player.id] ?? {}), [hole.hole_number]: Math.max(1, (prev[player.id]?.[hole.hole_number] ?? hole.par) - 1) } }))}
                              className="w-9 h-9 rounded-xl border border-gray-300 text-lg font-bold text-gray-600 flex items-center justify-center">−</button>
                            <span className="text-xl font-bold text-gray-900 w-8 text-center">{val}</span>
                            <button type="button"
                              onClick={() => setStrokes((prev) => ({ ...prev, [player.id]: { ...(prev[player.id] ?? {}), [hole.hole_number]: Math.min(20, (prev[player.id]?.[hole.hole_number] ?? hole.par) + 1) } }))}
                              className="w-9 h-9 rounded-xl border border-gray-300 text-lg font-bold text-gray-600 flex items-center justify-center">+</button>
                          </div>
                        )
                      })}
                    </div>
                  ))}

                  {/* Auto-fill strokes */}
                  {autoHandicap && (
                    <button type="button" onClick={async () => {
                      const auto = await getAutoStrokes(hole.hole_number)
                      setHoleStrokes((prev) => ({ ...prev, [hole.hole_number]: auto }))
                      saveHoleStrokes(roundId, hole.hole_number, auto)
                    }} className="text-xs text-blue-500 hover:text-blue-700">Auto-fill handicap strokes</button>
                  )}

                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button type="button" onClick={() => saveHole(hole.hole_number)} disabled={isPending}
                    className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition" style={{ background: navy }}>
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

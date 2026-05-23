'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { submitHoleScores, saveDaytonaAssignments } from '@/app/actions'
import { supabase } from '@/lib/supabase'
import {
  computeHoleBallScores, computeTeamBallSummary,
  computeHoleDaytonaWithSides, computeDaytonaSidesSummary, computePlayerDaytonaPoints,
  type DaytonaHoleAssignment, type DaytonaSide,
} from '@/lib/scoring'
import { ScoreNotation } from './ScoreNotation'

type Player = { id: string; name: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type Team = { id: string; name: string }
type AssignmentMap = Record<number, Record<string, DaytonaSide>>

const navy = '#0f172a'
const gold = '#f59e0b'

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
  team, players, holes, initialScores, ballsCount, format = 'standard', daytonaVariant = '4man', isAdmin, roundId = '', initialAssignments = [],
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
      })
      .subscribe()
    broadcastChannel.current = ch
    return () => { supabase.removeChannel(ch); broadcastChannel.current = null }
  }, [players])

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

      <main className="max-w-lg mx-auto px-3 py-4 space-y-2 pb-24">
        {savedCount === 18 && (
          <div className="bg-white rounded-xl border-2 px-4 py-3 text-center" style={{ borderColor: gold }}>
            <p className="font-semibold" style={{ color: navy }}>All 18 holes submitted! ⛳</p>
            <a href="/leaderboard" className="text-sm underline mt-1 inline-block" style={{ color: gold }}>
              View Live Leaderboard →
            </a>
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
                              {savedRightPairDts.map((dt) => dt ?? '–').join('/')}
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
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate">{player.name}</span>
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

                  {isDaytona && (
                    <div className="flex items-center gap-4 pt-1 pb-1">
                      <span className="text-xs text-gray-400">
                        {leftLabel}: <strong>{leftCount}</strong> · {rightLabel}: <strong>{players.length - leftCount}</strong>
                        {leftCount !== 2 && <span className="text-red-500 ml-1">(need exactly 2 on {leftLabel})</span>}
                      </span>
                      <div className="flex-1" />
                      {liveLeftDt != null && (is5Man ? liveRightPairDts.length === 3 : liveRightDt != null) && (
                        <span className="text-xs text-gray-500">
                          Preview: <span style={{ color: '#2563eb' }}>L {liveLeftDt}</span>
                          {' · '}
                          <span style={{ color: '#92400e' }}>
                            {is5Man
                              ? `R ${liveRightPairDts.map((dt) => dt ?? '–').join(' / ')}`
                              : `R ${liveRightDt}`}
                          </span>
                        </span>
                      )}
                    </div>
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

'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

type Player = { id: string; name: string; teamName: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }

const navy = '#0f172a'
const gold = '#f59e0b'

function scoreColor(strokes: number | null, par: number): string {
  if (strokes == null) return '#9ca3af'
  const d = strokes - par
  if (d <= -2) return '#7c3aed'
  if (d === -1) return '#2563eb'
  if (d === 0) return '#6b7280'
  if (d === 1) return '#dc2626'
  return '#7f1d1d'
}

function fmtVsPar(n: number | null): string {
  if (n === null) return '–'
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : String(n)
}

export default function MatchupClient({
  players, holes, scores: initialScores, roundName,
}: {
  players: Player[]
  holes: Hole[]
  scores: Score[]
  roundName: string
}) {
  const [scores, setScores] = useState(initialScores)
  const [p1Id, setP1Id] = useState('')
  const [p2Id, setP2Id] = useState('')

  // Live score updates
  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    if (!playerIds.length) return
    const channel = supabase.channel('matchup')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        const { data } = await supabase
          .from('scores')
          .select('player_id, hole_number, strokes')
          .in('player_id', playerIds)
        if (data) setScores(data)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [players])

  const scoreMap = useMemo(() => {
    const m: Record<string, Record<number, number>> = {}
    for (const s of scores) {
      if (!m[s.player_id]) m[s.player_id] = {}
      m[s.player_id][s.hole_number] = s.strokes
    }
    return m
  }, [scores])

  const p1 = players.find((p) => p.id === p1Id)
  const p2 = players.find((p) => p.id === p2Id)

  const comparison = useMemo(() => {
    if (!p1 || !p2) return null
    let p1Wins = 0, p2Wins = 0, ties = 0
    let p1TotalStrokes = 0, p2TotalStrokes = 0
    let p1ParSoFar = 0, p2ParSoFar = 0
    let runningDiff = 0 // positive = p1 leading (fewer strokes net)

    const rows = holes.map((hole) => {
      const s1 = scoreMap[p1Id]?.[hole.hole_number] ?? null
      const s2 = scoreMap[p2Id]?.[hole.hole_number] ?? null
      let result: 'win' | 'loss' | 'tie' | null = null

      if (s1 !== null && s2 !== null) {
        p1TotalStrokes += s1
        p2TotalStrokes += s2
        p1ParSoFar += hole.par
        p2ParSoFar += hole.par
        runningDiff += s2 - s1
        if (s1 < s2) { result = 'win'; p1Wins++ }
        else if (s1 > s2) { result = 'loss'; p2Wins++ }
        else { result = 'tie'; ties++ }
      }

      return { hole, s1, s2, result, runningDiff }
    })

    const p1VsPar = p1ParSoFar > 0 ? p1TotalStrokes - p1ParSoFar : null
    const p2VsPar = p2ParSoFar > 0 ? p2TotalStrokes - p2ParSoFar : null
    const holesPlayed = p1Wins + p2Wins + ties

    return { rows, p1Wins, p2Wins, ties, holesPlayed, p1VsPar, p2VsPar, p1TotalStrokes, p2TotalStrokes, finalDiff: runningDiff }
  }, [p1, p2, p1Id, p2Id, holes, scoreMap])

  let leader: typeof p1 | null = null
  if (comparison) {
    if (comparison.p1Wins > comparison.p2Wins) leader = p1 ?? null
    else if (comparison.p2Wins > comparison.p1Wins) leader = p2 ?? null
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: gold }}>Matchup</p>
            <h1 className="font-bold text-lg">{roundName}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
              Live
            </div>
            <a href="/" className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>← Back</a>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Player selectors */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Choose Two Players</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Player 1</label>
              <select
                value={p1Id}
                onChange={(e) => { setP1Id(e.target.value); if (e.target.value === p2Id) setP2Id('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none"
              >
                <option value="">Select player…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === p2Id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Player 2</label>
              <select
                value={p2Id}
                onChange={(e) => setP2Id(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none"
              >
                <option value="">Select player…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === p1Id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {!p1Id || !p2Id ? (
          <p className="text-center text-sm text-gray-400 py-4">Select two players above to compare their rounds</p>
        ) : comparison && p1 && p2 && (
          <>
            {/* Summary banner */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-gray-100">
                {/* Player 1 */}
                <div className="px-4 py-4 text-center">
                  <p className="text-xs font-semibold text-gray-500 truncate mb-1">{p1.name}</p>
                  <p className="text-xs text-gray-400 mb-2">{p1.teamName}</p>
                  <p className="text-3xl font-bold" style={{ color: comparison.p1Wins > comparison.p2Wins ? '#16a34a' : '#374151' }}>
                    {comparison.p1Wins}
                  </p>
                  <p className="text-xs text-gray-400">holes won</p>
                  {comparison.p1VsPar !== null && (
                    <p className="text-sm font-bold mt-1.5"
                      style={{ color: comparison.p1VsPar < 0 ? '#2563eb' : comparison.p1VsPar > 0 ? '#dc2626' : '#6b7280' }}>
                      {fmtVsPar(comparison.p1VsPar)}
                    </p>
                  )}
                </div>

                {/* Middle */}
                <div className="px-4 py-4 text-center flex flex-col items-center justify-center">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">VS</p>
                  <p className="text-sm text-gray-500">{comparison.ties} tied</p>
                  {comparison.holesPlayed > 0 && (
                    <p className="text-xs mt-1.5 font-semibold"
                      style={{ color: leader ? '#16a34a' : '#6b7280' }}>
                      {leader
                        ? `${leader.name.split(' ')[0]} leads`
                        : 'All square'}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {comparison.holesPlayed} of {holes.length} played
                  </p>
                </div>

                {/* Player 2 */}
                <div className="px-4 py-4 text-center">
                  <p className="text-xs font-semibold text-gray-500 truncate mb-1">{p2.name}</p>
                  <p className="text-xs text-gray-400 mb-2">{p2.teamName}</p>
                  <p className="text-3xl font-bold" style={{ color: comparison.p2Wins > comparison.p1Wins ? '#16a34a' : '#374151' }}>
                    {comparison.p2Wins}
                  </p>
                  <p className="text-xs text-gray-400">holes won</p>
                  {comparison.p2VsPar !== null && (
                    <p className="text-sm font-bold mt-1.5"
                      style={{ color: comparison.p2VsPar < 0 ? '#2563eb' : comparison.p2VsPar > 0 ? '#dc2626' : '#6b7280' }}>
                      {fmtVsPar(comparison.p2VsPar)}
                    </p>
                  )}
                </div>
              </div>

              {/* Record bar */}
              <div className="border-t border-gray-100 px-4 py-2 flex items-center justify-center gap-2 text-sm">
                <span className="font-bold" style={{ color: comparison.p1Wins > comparison.p2Wins ? '#16a34a' : '#374151' }}>
                  {p1.name.split(' ')[0]}
                </span>
                <span className="font-mono font-bold text-gray-700">
                  {comparison.p1Wins} – {comparison.p2Wins} – {comparison.ties}
                </span>
                <span className="font-bold" style={{ color: comparison.p2Wins > comparison.p1Wins ? '#16a34a' : '#374151' }}>
                  {p2.name.split(' ')[0]}
                </span>
              </div>
            </div>

            {/* Hole-by-hole */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ background: navy }}>
                    <th className="px-3 py-2 text-left text-xs font-semibold w-10" style={{ color: 'rgba(255,255,255,0.6)' }}>Hole</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold w-8" style={{ color: 'rgba(255,255,255,0.6)' }}>Par</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>{p1.name.split(' ')[0]}</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold w-8" style={{ color: 'rgba(255,255,255,0.6)' }}></th>
                    <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>{p2.name.split(' ')[0]}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map(({ hole, s1, s2, result }) => {
                    const rowBg = result === 'win' ? '#f0fdf4'
                      : result === 'loss' ? '#fff1f2'
                      : result === 'tie' ? '#f9fafb'
                      : 'white'
                    return (
                      <tr key={hole.hole_number} style={{ background: rowBg }} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-2.5 font-bold text-gray-900">{hole.hole_number}</td>
                        <td className="px-2 py-2.5 text-center text-gray-400">{hole.par}</td>
                        <td className="px-3 py-2.5 text-center">
                          {s1 != null ? (
                            <span className="font-bold text-base" style={{ color: scoreColor(s1, hole.par) }}>{s1}</span>
                          ) : <span className="text-gray-300">–</span>}
                          {s1 != null && (
                            <span className="text-xs ml-1" style={{ color: scoreColor(s1, hole.par) }}>
                              ({s1 - hole.par === 0 ? 'E' : s1 - hole.par > 0 ? `+${s1 - hole.par}` : s1 - hole.par})
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-center text-xs font-bold w-8">
                          {result === 'win' && <span className="text-green-600">W</span>}
                          {result === 'loss' && <span className="text-red-500">L</span>}
                          {result === 'tie' && <span className="text-gray-400">T</span>}
                          {result === null && <span className="text-gray-200">–</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {s2 != null ? (
                            <span className="font-bold text-base" style={{ color: scoreColor(s2, hole.par) }}>{s2}</span>
                          ) : <span className="text-gray-300">–</span>}
                          {s2 != null && (
                            <span className="text-xs ml-1" style={{ color: scoreColor(s2, hole.par) }}>
                              ({s2 - hole.par === 0 ? 'E' : s2 - hole.par > 0 ? `+${s2 - hole.par}` : s2 - hole.par})
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}

                  {/* Totals */}
                  <tr className="border-t-2 border-gray-200 font-bold" style={{ background: '#f9fafb' }}>
                    <td colSpan={2} className="px-3 py-2.5 text-gray-700">Total</td>
                    <td className="px-3 py-2.5 text-center">
                      {comparison.p1TotalStrokes > 0 ? (
                        <span style={{ color: (comparison.p1VsPar ?? 0) < 0 ? '#2563eb' : (comparison.p1VsPar ?? 0) > 0 ? '#dc2626' : '#6b7280' }}>
                          {comparison.p1TotalStrokes} ({fmtVsPar(comparison.p1VsPar)})
                        </span>
                      ) : '–'}
                    </td>
                    <td className="px-2 py-2.5 text-center text-xs"
                      style={{ color: comparison.p1Wins > comparison.p2Wins ? '#16a34a' : comparison.p2Wins > comparison.p1Wins ? '#dc2626' : '#6b7280' }}>
                      {comparison.p1Wins}-{comparison.p2Wins}-{comparison.ties}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {comparison.p2TotalStrokes > 0 ? (
                        <span style={{ color: (comparison.p2VsPar ?? 0) < 0 ? '#2563eb' : (comparison.p2VsPar ?? 0) > 0 ? '#dc2626' : '#6b7280' }}>
                          {comparison.p2TotalStrokes} ({fmtVsPar(comparison.p2VsPar)})
                        </span>
                      ) : '–'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

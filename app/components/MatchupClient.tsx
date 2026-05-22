'use client'

import { useState, useMemo } from 'react'

type Player = { id: string; name: string; teamName: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }

const navy = '#0f172a'
const gold = '#f59e0b'

function vsColor(strokes: number | null, par: number): string {
  if (strokes == null) return '#9ca3af'
  const d = strokes - par
  if (d <= -2) return '#7c3aed'
  if (d === -1) return '#2563eb'
  if (d === 0) return '#6b7280'
  if (d === 1) return '#dc2626'
  return '#7f1d1d'
}

export default function MatchupClient({
  players, holes, scores, roundName,
}: {
  players: Player[]
  holes: Hole[]
  scores: Score[]
  roundName: string
}) {
  const [p1Id, setP1Id] = useState('')
  const [p2Id, setP2Id] = useState('')

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
    let p1Wins = 0, p2Wins = 0, ties = 0, p1Total = 0, p2Total = 0
    let p1Par = 0, p2Par = 0
    let runningNet = 0 // positive = p1 ahead (fewer strokes), negative = p2 ahead

    const rows = holes.map((hole) => {
      const s1 = scoreMap[p1Id]?.[hole.hole_number] ?? null
      const s2 = scoreMap[p2Id]?.[hole.hole_number] ?? null

      let result: 'win' | 'loss' | 'tie' | null = null
      if (s1 !== null && s2 !== null) {
        p1Total += s1; p2Total += s2
        p1Par += hole.par; p2Par += hole.par
        runningNet += s2 - s1 // positive means p1 had fewer strokes → p1 winning
        if (s1 < s2) { result = 'win'; p1Wins++ }
        else if (s1 > s2) { result = 'loss'; p2Wins++ }
        else { result = 'tie'; ties++ }
      }

      return { hole, s1, s2, result, runningNet }
    })

    const p1VsPar = p1Par > 0 ? p1Total - p1Par : null
    const p2VsPar = p2Par > 0 ? p2Total - p2Par : null
    const finalNet = runningNet // positive = p1 won more holes by fewer strokes net

    return { rows, p1Wins, p2Wins, ties, p1VsPar, p2VsPar, p1Total, p2Total, finalNet }
  }, [p1, p2, p1Id, p2Id, holes, scoreMap])

  function fmtScore(strokes: number | null, par: number) {
    if (strokes == null) return '–'
    const d = strokes - par
    if (d === 0) return `${strokes} (E)`
    return `${strokes} (${d > 0 ? '+' : ''}${d})`
  }

  function fmtNet(n: number | null) {
    if (n === null) return '–'
    if (n === 0) return 'E'
    return n > 0 ? `+${n}` : String(n)
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Matchup</p>
            <h1 className="font-bold text-lg">{roundName}</h1>
          </div>
          <a href="/" className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>← Back</a>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Player selectors */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Select Players to Compare</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Player 1</label>
              <select
                value={p1Id}
                onChange={(e) => { setP1Id(e.target.value); if (e.target.value === p2Id) setP2Id('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none"
              >
                <option value="">Select…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === p2Id}>
                    {p.name} ({p.teamName})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Player 2</label>
              <select
                value={p2Id}
                onChange={(e) => setP2Id(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none"
              >
                <option value="">Select…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === p1Id}>
                    {p.name} ({p.teamName})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Summary banner */}
        {comparison && p1 && p2 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">{p1.name}</p>
                <p className="text-2xl font-bold" style={{ color: comparison.p1Wins > comparison.p2Wins ? '#16a34a' : '#6b7280' }}>
                  {comparison.p1Wins}
                </p>
                <p className="text-xs text-gray-400">holes won</p>
                {comparison.p1VsPar !== null && (
                  <p className="text-xs font-semibold mt-1"
                    style={{ color: comparison.p1VsPar < 0 ? '#2563eb' : comparison.p1VsPar > 0 ? '#dc2626' : '#6b7280' }}>
                    {fmtNet(comparison.p1VsPar)} vs par
                  </p>
                )}
              </div>
              <div className="flex flex-col items-center justify-center">
                <p className="text-lg font-bold text-gray-400">VS</p>
                <p className="text-xs text-gray-400 mt-1">{comparison.ties} tied</p>
                {comparison.finalNet !== 0 && (
                  <p className="text-xs font-semibold mt-1" style={{ color: comparison.finalNet > 0 ? '#16a34a' : '#dc2626' }}>
                    {comparison.finalNet > 0 ? `${p1.name.split(' ')[0]} leads` : `${p2.name.split(' ')[0]} leads`}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">{p2.name}</p>
                <p className="text-2xl font-bold" style={{ color: comparison.p2Wins > comparison.p1Wins ? '#16a34a' : '#6b7280' }}>
                  {comparison.p2Wins}
                </p>
                <p className="text-xs text-gray-400">holes won</p>
                {comparison.p2VsPar !== null && (
                  <p className="text-xs font-semibold mt-1"
                    style={{ color: comparison.p2VsPar < 0 ? '#2563eb' : comparison.p2VsPar > 0 ? '#dc2626' : '#6b7280' }}>
                    {fmtNet(comparison.p2VsPar)} vs par
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Hole-by-hole table */}
        {comparison && p1 && p2 && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ background: navy, color: 'rgba(255,255,255,0.7)' }}>
                  <th className="px-3 py-2 text-left text-xs font-semibold w-10">Hole</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold w-10">Par</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold" style={{ color: gold }}>{p1.name.split(' ')[0]}</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold w-10">Result</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold" style={{ color: gold }}>{p2.name.split(' ')[0]}</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold w-12">Net</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map(({ hole, s1, s2, result, runningNet }) => {
                  const rowBg = result === 'win' ? '#f0fdf4' : result === 'loss' ? '#fff1f2' : result === 'tie' ? '#fafafa' : 'white'
                  return (
                    <tr key={hole.hole_number} style={{ background: rowBg }} className="border-b border-gray-100">
                      <td className="px-3 py-2 font-bold text-gray-900">{hole.hole_number}</td>
                      <td className="px-2 py-2 text-center text-gray-500">{hole.par}</td>
                      <td className="px-2 py-2 text-center font-semibold" style={{ color: vsColor(s1, hole.par) }}>
                        {s1 != null ? fmtScore(s1, hole.par) : '–'}
                      </td>
                      <td className="px-2 py-2 text-center text-xs font-bold">
                        {result === 'win' && <span style={{ color: '#16a34a' }}>W</span>}
                        {result === 'loss' && <span style={{ color: '#dc2626' }}>L</span>}
                        {result === 'tie' && <span className="text-gray-400">T</span>}
                        {result === null && <span className="text-gray-200">–</span>}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold" style={{ color: vsColor(s2, hole.par) }}>
                        {s2 != null ? fmtScore(s2, hole.par) : '–'}
                      </td>
                      <td className="px-2 py-2 text-center text-xs font-semibold"
                        style={{ color: runningNet > 0 ? '#16a34a' : runningNet < 0 ? '#dc2626' : '#6b7280' }}>
                        {s1 != null && s2 != null ? (runningNet === 0 ? 'E' : runningNet > 0 ? `+${runningNet}` : runningNet) : '–'}
                      </td>
                    </tr>
                  )
                })}

                {/* Totals row */}
                <tr className="font-bold border-t-2 border-gray-300" style={{ background: '#f9fafb' }}>
                  <td className="px-3 py-2 text-gray-900">Total</td>
                  <td className="px-2 py-2 text-center text-gray-600">
                    {holes.reduce((s, h) => s + h.par, 0)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {comparison.p1Total > 0 && (
                      <span style={{ color: (comparison.p1VsPar ?? 0) < 0 ? '#2563eb' : (comparison.p1VsPar ?? 0) > 0 ? '#dc2626' : '#6b7280' }}>
                        {comparison.p1Total} ({fmtNet(comparison.p1VsPar)})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center text-sm">
                    <span style={{ color: comparison.p1Wins > comparison.p2Wins ? '#16a34a' : comparison.p2Wins > comparison.p1Wins ? '#dc2626' : '#6b7280' }}>
                      {comparison.p1Wins}-{comparison.p2Wins}-{comparison.ties}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {comparison.p2Total > 0 && (
                      <span style={{ color: (comparison.p2VsPar ?? 0) < 0 ? '#2563eb' : (comparison.p2VsPar ?? 0) > 0 ? '#dc2626' : '#6b7280' }}>
                        {comparison.p2Total} ({fmtNet(comparison.p2VsPar)})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center"
                    style={{ color: comparison.finalNet > 0 ? '#16a34a' : comparison.finalNet < 0 ? '#dc2626' : '#6b7280' }}>
                    {comparison.finalNet === 0 ? 'E' : comparison.finalNet > 0 ? `+${comparison.finalNet}` : comparison.finalNet}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {!p1Id || !p2Id ? (
          <p className="text-center text-xs text-gray-400 mt-6">Select two players above to compare their scorecards</p>
        ) : null}
      </div>
    </div>
  )
}

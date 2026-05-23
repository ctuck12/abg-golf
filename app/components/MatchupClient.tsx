'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { saveMatchup, deleteMatchup } from '@/app/actions'

type Player = { id: string; name: string; teamName: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string }

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

function vpColor(n: number | null): string {
  if (n === null) return '#9ca3af'
  if (n < 0) return '#dc2626'
  if (n > 0) return '#374151'
  return '#374151'
}

function computeStats(
  p1Id: string, p2Id: string,
  scoreMap: Record<string, Record<number, number>>,
  holes: Hole[]
) {
  let p1Wins = 0, p2Wins = 0, ties = 0
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
      if (s1 < s2) { result = 'win'; p1Wins++ }
      else if (s1 > s2) { result = 'loss'; p2Wins++ }
      else { result = 'tie'; ties++ }
    }
    rows.push({ hole, s1, s2, result })
  }

  return {
    rows, p1Wins, p2Wins, ties, holesPlayed: tPlayed,
    p1Front: fPlayed > 0 ? p1F - fPar : null,
    p2Front: fPlayed > 0 ? p2F - fPar : null,
    p1Back: bPlayed > 0 ? p1B - bPar : null,
    p2Back: bPlayed > 0 ? p2B - bPar : null,
    p1Total: tPlayed > 0 ? p1T - tPar : null,
    p2Total: tPlayed > 0 ? p2T - tPar : null,
    p1TotalStrokes: p1T, p2TotalStrokes: p2T,
  }
}

export default function MatchupClient({
  roundId, players, holes, scores: initialScores, roundName, initialMatchups,
}: {
  roundId: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  roundName: string
  initialMatchups: SavedMatchup[]
}) {
  const [scores, setScores] = useState(initialScores)
  const [matchups, setMatchups] = useState(initialMatchups)
  const [p1Id, setP1Id] = useState('')
  const [p2Id, setP2Id] = useState('')

  // Create form state
  const [newP1, setNewP1] = useState('')
  const [newP2, setNewP2] = useState('')
  const [newBet, setNewBet] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const playerIds = players.map((p) => p.id)
    if (!playerIds.length) return
    const ch1 = supabase.channel('matchup-scores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, async () => {
        const { data } = await supabase.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds)
        if (data) setScores(data)
      }).subscribe()
    const ch2 = supabase.channel('matchup-matchups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchups' }, async () => {
        const { data } = await supabase.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', roundId).order('created_at')
        if (data) setMatchups(data)
      }).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [players, roundId])

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
    return computeStats(p1Id, p2Id, scoreMap, holes)
  }, [p1, p2, p1Id, p2Id, holes, scoreMap])

  async function handleCreate() {
    if (!newP1 || !newP2 || newP1 === newP2) return
    setSaving(true)
    const result = await saveMatchup(roundId, newP1, newP2, newBet)
    if (!result.error && result.id) {
      setMatchups((prev) => [...prev, { id: result.id!, player1_id: newP1, player2_id: newP2, bet: newBet.trim() }])
      setNewP1(''); setNewP2(''); setNewBet('')
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    setMatchups((prev) => prev.filter((m) => m.id !== id))
    await deleteMatchup(id)
  }

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: gold }}>Matchups</p>
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

        {/* ── On-the-fly comparison ── */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">On-the-Fly Comparison</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Player 1</label>
              <select value={p1Id} onChange={(e) => { setP1Id(e.target.value); if (e.target.value === p2Id) setP2Id('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none">
                <option value="">Select player…</option>
                {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === p2Id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Player 2</label>
              <select value={p2Id} onChange={(e) => setP2Id(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none">
                <option value="">Select player…</option>
                {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === p1Id}>{p.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {p1Id && p2Id && comparison && p1 && p2 && (
          <MatchupDetail p1={p1} p2={p2} stats={comparison} holes={holes} />
        )}
        {(!p1Id || !p2Id) && (
          <p className="text-center text-sm text-gray-400 py-2">Select two players above to compare their rounds</p>
        )}

        {/* ── Saved Matchups ── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Saved Matchups</p>
            {/* Create form */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[110px]">
                <label className="block text-xs text-gray-500 mb-1">Player 1</label>
                <select value={newP1} onChange={(e) => { setNewP1(e.target.value); if (e.target.value === newP2) setNewP2('') }}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                  <option value="">Select…</option>
                  {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === newP2}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[110px]">
                <label className="block text-xs text-gray-500 mb-1">Player 2</label>
                <select value={newP2} onChange={(e) => setNewP2(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                  <option value="">Select…</option>
                  {players.map((p) => <option key={p.id} value={p.id} disabled={p.id === newP1}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="block text-xs text-gray-500 mb-1">Bet</label>
                <input
                  type="text"
                  placeholder="e.g. $5, dinner…"
                  value={newBet}
                  onChange={(e) => setNewBet(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!newP1 || !newP2 || newP1 === newP2 || saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex-shrink-0"
                style={{ background: navy, color: 'white' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {matchups.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">No saved matchups yet</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {matchups.map((m) => {
                const mp1 = players.find((p) => p.id === m.player1_id)
                const mp2 = players.find((p) => p.id === m.player2_id)
                if (!mp1 || !mp2) return null
                const stats = computeStats(m.player1_id, m.player2_id, scoreMap, holes)
                const leader = stats.p1Wins > stats.p2Wins ? mp1 : stats.p2Wins > stats.p1Wins ? mp2 : null
                return (
                  <div key={m.id} className="px-4 py-3">
                    {/* Names + record */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                        <a href={`/player/${mp1.id}`} className="hover:underline truncate" style={{ color: navy }}>{mp1.name}</a>
                        <span className="text-gray-400 font-normal flex-shrink-0">vs</span>
                        <a href={`/player/${mp2.id}`} className="hover:underline truncate" style={{ color: navy }}>{mp2.name}</a>
                      </div>
                      <button onClick={() => handleDelete(m.id)} className="text-xs text-gray-400 hover:text-red-500 ml-3 flex-shrink-0">✕</button>
                    </div>

                    {/* Bet + status */}
                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                      {m.bet && <span className="font-medium" style={{ color: gold }}>Bet: {m.bet}</span>}
                      {stats.holesPlayed > 0 ? (
                        <span>
                          <span className="font-mono font-bold text-gray-700">{stats.p1Wins}–{stats.p2Wins}–{stats.ties}</span>
                          {' · '}
                          <span className="font-semibold" style={{ color: leader ? '#16a34a' : '#6b7280' }}>
                            {leader ? `${leader.name.split(' ')[0]} leads` : 'All square'}
                          </span>
                          {' · '}
                          <span>{stats.holesPlayed}/{holes.length} played</span>
                        </span>
                      ) : <span className="text-gray-400">No scores yet</span>}
                    </div>

                    {/* Front / Back / Total */}
                    {stats.holesPlayed > 0 && (
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        {(['Front', 'Back', 'Total'] as const).map((label) => {
                          const v1 = label === 'Front' ? stats.p1Front : label === 'Back' ? stats.p1Back : stats.p1Total
                          const v2 = label === 'Front' ? stats.p2Front : label === 'Back' ? stats.p2Back : stats.p2Total
                          return (
                            <div key={label} className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
                              <p className="text-gray-400 mb-0.5">{label}</p>
                              <div className="flex justify-around">
                                <span className="font-bold" style={{ color: vpColor(v1) }}>{fmtVsPar(v1)}</span>
                                <span className="text-gray-300">|</span>
                                <span className="font-bold" style={{ color: vpColor(v2) }}>{fmtVsPar(v2)}</span>
                              </div>
                              <p className="text-gray-400 mt-0.5 text-xs">{mp1.name.split(' ')[0]} | {mp2.name.split(' ')[0]}</p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MatchupDetail({ p1, p2, stats, holes }: {
  p1: Player; p2: Player
  stats: ReturnType<typeof computeStats>
  holes: Hole[]
}) {
  const leader = stats.p1Wins > stats.p2Wins ? p1 : stats.p2Wins > stats.p1Wins ? p2 : null
  return (
    <>
      {/* Summary banner */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          <div className="px-4 py-3 text-center">
            <a href={`/player/${p1.id}`} className="text-xs font-semibold text-gray-500 truncate mb-1 block hover:underline">{p1.name}</a>
            <p className="text-3xl font-bold" style={{ color: stats.p1Wins > stats.p2Wins ? '#16a34a' : '#374151' }}>{stats.p1Wins}</p>
            <p className="text-xs text-gray-400">holes won</p>
          </div>
          <div className="px-4 py-3 text-center flex flex-col items-center justify-center">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">VS</p>
            <p className="text-sm text-gray-500">{stats.ties} tied</p>
            {stats.holesPlayed > 0 && (
              <p className="text-xs mt-1 font-semibold" style={{ color: leader ? '#16a34a' : '#6b7280' }}>
                {leader ? `${leader.name.split(' ')[0]} leads` : 'All square'}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">{stats.holesPlayed}/{holes.length} played</p>
          </div>
          <div className="px-4 py-3 text-center">
            <a href={`/player/${p2.id}`} className="text-xs font-semibold text-gray-500 truncate mb-1 block hover:underline">{p2.name}</a>
            <p className="text-3xl font-bold" style={{ color: stats.p2Wins > stats.p1Wins ? '#16a34a' : '#374151' }}>{stats.p2Wins}</p>
            <p className="text-xs text-gray-400">holes won</p>
          </div>
        </div>

        {/* Record bar */}
        <div className="border-t border-gray-100 px-4 py-2 flex items-center justify-center gap-2 text-sm">
          <span className="font-bold" style={{ color: stats.p1Wins > stats.p2Wins ? '#16a34a' : '#374151' }}>{p1.name.split(' ')[0]}</span>
          <span className="font-mono font-bold text-gray-700">{stats.p1Wins}–{stats.p2Wins}–{stats.ties}</span>
          <span className="font-bold" style={{ color: stats.p2Wins > stats.p1Wins ? '#16a34a' : '#374151' }}>{p2.name.split(' ')[0]}</span>
        </div>

        {/* Front / Back / Total */}
        {stats.holesPlayed > 0 && (
          <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
            {(['Front', 'Back', 'Total'] as const).map((label) => {
              const v1 = label === 'Front' ? stats.p1Front : label === 'Back' ? stats.p1Back : stats.p1Total
              const v2 = label === 'Front' ? stats.p2Front : label === 'Back' ? stats.p2Back : stats.p2Total
              return (
                <div key={label} className="px-3 py-2 text-center">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <div className="flex justify-around items-center">
                    <span className="font-bold text-sm" style={{ color: vpColor(v1) }}>{fmtVsPar(v1)}</span>
                    <span className="text-gray-200 text-xs">|</span>
                    <span className="font-bold text-sm" style={{ color: vpColor(v2) }}>{fmtVsPar(v2)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Hole-by-hole */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ background: navy }}>
              <th className="px-3 py-2 text-left text-xs font-semibold w-10" style={{ color: 'rgba(255,255,255,0.6)' }}>Hole</th>
              <th className="px-2 py-2 text-center text-xs font-semibold w-8" style={{ color: 'rgba(255,255,255,0.6)' }}>Par</th>
              <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>
                <a href={`/player/${p1.id}`} className="hover:underline">{p1.name.split(' ')[0]}</a>
              </th>
              <th className="px-2 py-2 text-center text-xs w-8" style={{ color: 'rgba(255,255,255,0.6)' }} />
              <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>
                <a href={`/player/${p2.id}`} className="hover:underline">{p2.name.split(' ')[0]}</a>
              </th>
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
                    {s1 != null ? (
                      <>
                        <span className="font-bold text-base" style={{ color: scoreColor(s1, hole.par) }}>{s1}</span>
                        <span className="text-xs ml-1" style={{ color: scoreColor(s1, hole.par) }}>
                          ({s1 - hole.par === 0 ? 'E' : s1 - hole.par > 0 ? `+${s1 - hole.par}` : s1 - hole.par})
                        </span>
                      </>
                    ) : <span className="text-gray-300">–</span>}
                  </td>
                  <td className="px-2 py-2.5 text-center text-xs font-bold w-8">
                    {result === 'win' && <span className="text-green-600">W</span>}
                    {result === 'loss' && <span className="text-red-500">L</span>}
                    {result === 'tie' && <span className="text-gray-400">T</span>}
                    {result === null && <span className="text-gray-200">–</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {s2 != null ? (
                      <>
                        <span className="font-bold text-base" style={{ color: scoreColor(s2, hole.par) }}>{s2}</span>
                        <span className="text-xs ml-1" style={{ color: scoreColor(s2, hole.par) }}>
                          ({s2 - hole.par === 0 ? 'E' : s2 - hole.par > 0 ? `+${s2 - hole.par}` : s2 - hole.par})
                        </span>
                      </>
                    ) : <span className="text-gray-300">–</span>}
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
              <td className="px-2 py-2.5 text-center text-xs" style={{ color: stats.p1Wins > stats.p2Wins ? '#16a34a' : stats.p2Wins > stats.p1Wins ? '#dc2626' : '#6b7280' }}>
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
      </div>
    </>
  )
}

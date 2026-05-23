'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import {
  saveMatchup, deleteMatchup, updateMatchupBet,
  saveBestBallMatchup, deleteBestBallMatchup, updateBestBallBet,
} from '@/app/actions'

type Player = { id: string; name: string; teamName: string }
type Hole = { hole_number: number; par: number }
type Score = { player_id: string; hole_number: number; strokes: number }
type SavedMatchup = { id: string; player1_id: string; player2_id: string; bet: string }
type BestBallMatchup = {
  id: string
  team1_player1_id: string; team1_player2_id: string
  team2_player1_id: string; team2_player2_id: string
  bet: string
}

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
  return '#374151'
}

function nassauStatus(p1Up: number, played: number, complete: boolean, p1Name: string, p2Name: string) {
  if (played === 0) return { text: '–', color: '#9ca3af' }
  if (p1Up > 0) return { text: `${p1Name} ${p1Up}up${complete ? ' ✓' : ''}`, color: '#16a34a' }
  if (p1Up < 0) return { text: `${p2Name} ${-p1Up}up${complete ? ' ✓' : ''}`, color: '#16a34a' }
  return { text: complete ? 'Tied' : 'AS', color: '#6b7280' }
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
  let frontP1W = 0, frontP2W = 0, frontPlayed = 0
  let backP1W = 0, backP2W = 0, backPlayed = 0
  const rows: { hole: Hole; s1: number | null; s2: number | null; result: 'win' | 'loss' | 'tie' | null }[] = []

  for (const hole of holes) {
    const s1 = scoreMap[p1Id]?.[hole.hole_number] ?? null
    const s2 = scoreMap[p2Id]?.[hole.hole_number] ?? null
    let result: 'win' | 'loss' | 'tie' | null = null
    if (s1 !== null && s2 !== null) {
      tPlayed++; p1T += s1; p2T += s2; tPar += hole.par
      if (hole.hole_number <= 9) {
        fPlayed++; p1F += s1; p2F += s2; fPar += hole.par
        frontPlayed++
        if (s1 < s2) frontP1W++; else if (s1 > s2) frontP2W++
      } else {
        bPlayed++; p1B += s1; p2B += s2; bPar += hole.par
        backPlayed++
        if (s1 < s2) backP1W++; else if (s1 > s2) backP2W++
      }
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
    nassauFront: { p1Up: frontP1W - frontP2W, played: frontPlayed, complete: frontPlayed === 9 },
    nassauBack: { p1Up: backP1W - backP2W, played: backPlayed, complete: backPlayed === 9 },
    nassauOverall: { p1Up: p1Wins - p2Wins, played: tPlayed, complete: tPlayed === holes.length },
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
      if (t1Best < t2Best) { result = 'team1'; t1Wins++ }
      else if (t1Best > t2Best) { result = 'team2'; t2Wins++ }
      else { result = 'tie'; ties++ }
    }
    rows.push({ hole, t1p1, t1p2, t1Best, t2p1, t2p2, t2Best, result })
  }

  return {
    rows, t1Wins, t2Wins, ties, holesPlayed: tPlayed,
    t1Front: fPlayed > 0 ? t1F - fPar : null,
    t2Front: fPlayed > 0 ? t2F - fPar : null,
    t1Back: bPlayed > 0 ? t1B - bPar : null,
    t2Back: bPlayed > 0 ? t2B - bPar : null,
    t1Total: tPlayed > 0 ? t1T - tPar : null,
    t2Total: tPlayed > 0 ? t2T - tPar : null,
  }
}

export default function MatchupClient({
  roundId, players, holes, scores: initialScores, roundName, initialMatchups, initialBestBallMatchups,
}: {
  roundId: string
  players: Player[]
  holes: Hole[]
  scores: Score[]
  roundName: string
  initialMatchups: SavedMatchup[]
  initialBestBallMatchups: BestBallMatchup[]
}) {
  const [scores, setScores] = useState(initialScores)
  const [matchups, setMatchups] = useState(initialMatchups)
  const [bestBallMatchups, setBestBallMatchups] = useState(initialBestBallMatchups)

  // On-the-fly
  const [p1Id, setP1Id] = useState('')
  const [p2Id, setP2Id] = useState('')

  // H2H create
  const [newP1, setNewP1] = useState('')
  const [newP2, setNewP2] = useState('')
  const [newBet, setNewBet] = useState('')
  const [savingH2H, setSavingH2H] = useState(false)

  // H2H expand / edit
  const [expandedH2H, setExpandedH2H] = useState<string | null>(null)
  const [editingH2H, setEditingH2H] = useState<string | null>(null)
  const [editH2HBet, setEditH2HBet] = useState('')

  // BB create
  const [bbT1P1, setBbT1P1] = useState('')
  const [bbT1P2, setBbT1P2] = useState('')
  const [bbT2P1, setBbT2P1] = useState('')
  const [bbT2P2, setBbT2P2] = useState('')
  const [bbBet, setBbBet] = useState('')
  const [savingBB, setSavingBB] = useState(false)

  // BB expand / edit
  const [expandedBB, setExpandedBB] = useState<{ id: string; view: 'match' | 'team1' | 'team2' } | null>(null)
  const [editingBB, setEditingBB] = useState<string | null>(null)
  const [editBBBet, setEditBBBet] = useState('')

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
    const ch3 = supabase.channel('matchup-bestball')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'best_ball_matchups' }, async () => {
        const { data } = await supabase.from('best_ball_matchups')
          .select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet')
          .eq('round_id', roundId).order('created_at')
        if (data) setBestBallMatchups(data)
      }).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3) }
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

  async function handleCreateH2H() {
    if (!newP1 || !newP2 || newP1 === newP2) return
    setSavingH2H(true)
    const result = await saveMatchup(roundId, newP1, newP2, newBet)
    if (!result.error && result.id) {
      setMatchups((prev) => [...prev, { id: result.id!, player1_id: newP1, player2_id: newP2, bet: newBet.trim() }])
      setNewP1(''); setNewP2(''); setNewBet('')
    }
    setSavingH2H(false)
  }

  async function handleDeleteH2H(id: string) {
    setMatchups((prev) => prev.filter((m) => m.id !== id))
    if (expandedH2H === id) setExpandedH2H(null)
    await deleteMatchup(id)
  }

  async function handleSaveH2HBet(id: string) {
    setMatchups((prev) => prev.map((m) => m.id === id ? { ...m, bet: editH2HBet.trim() } : m))
    setEditingH2H(null)
    await updateMatchupBet(id, editH2HBet)
  }

  async function handleCreateBB() {
    const ids = [bbT1P1, bbT1P2, bbT2P1, bbT2P2]
    if (ids.some((id) => !id) || new Set(ids).size !== 4) return
    setSavingBB(true)
    const result = await saveBestBallMatchup(roundId, bbT1P1, bbT1P2, bbT2P1, bbT2P2, bbBet)
    if (!result.error && result.id) {
      setBestBallMatchups((prev) => [...prev, {
        id: result.id!, team1_player1_id: bbT1P1, team1_player2_id: bbT1P2,
        team2_player1_id: bbT2P1, team2_player2_id: bbT2P2, bet: bbBet.trim(),
      }])
      setBbT1P1(''); setBbT1P2(''); setBbT2P1(''); setBbT2P2(''); setBbBet('')
    }
    setSavingBB(false)
  }

  async function handleDeleteBB(id: string) {
    setBestBallMatchups((prev) => prev.filter((m) => m.id !== id))
    if (expandedBB?.id === id) setExpandedBB(null)
    await deleteBestBallMatchup(id)
  }

  async function handleSaveBBBet(id: string) {
    setBestBallMatchups((prev) => prev.map((m) => m.id === id ? { ...m, bet: editBBBet.trim() } : m))
    setEditingBB(null)
    await updateBestBallBet(id, editBBBet)
  }

  // All selected BB player ids for mutual exclusion
  const bbSelected = [bbT1P1, bbT1P2, bbT2P1, bbT2P2].filter(Boolean)

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

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">

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
          <p className="text-center text-sm text-gray-400 py-1">Select two players above to compare</p>
        )}

        {/* ── Head to Head ── */}
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Head to Head</p>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
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
                <div className="flex-1 min-w-[90px]">
                  <label className="block text-xs text-gray-500 mb-1">Bet</label>
                  <input type="text" placeholder="e.g. $5…" value={newBet} onChange={(e) => setNewBet(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none" />
                </div>
                <button onClick={handleCreateH2H} disabled={!newP1 || !newP2 || newP1 === newP2 || savingH2H}
                  className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex-shrink-0"
                  style={{ background: navy, color: 'white' }}>
                  {savingH2H ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {matchups.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">No head to head matchups saved yet</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {matchups.map((m) => {
                  const mp1 = players.find((p) => p.id === m.player1_id)
                  const mp2 = players.find((p) => p.id === m.player2_id)
                  if (!mp1 || !mp2) return null
                  const stats = computeStats(m.player1_id, m.player2_id, scoreMap, holes)
                  const isFinal = stats.holesPlayed === holes.length && holes.length > 0
                  const leader = stats.p1Wins > stats.p2Wins ? mp1 : stats.p2Wins > stats.p1Wins ? mp2 : null
                  const isExpanded = expandedH2H === m.id
                  const isEditing = editingH2H === m.id
                  const p1Short = mp1.name.split(' ')[0]
                  const p2Short = mp2.name.split(' ')[0]

                  return (
                    <div key={m.id}>
                      <div className="px-4 py-3">
                        {/* Names row */}
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                            <a href={`/player/${mp1.id}`} className="hover:underline truncate" style={{ color: navy }}>{mp1.name}</a>
                            <span className="text-gray-400 font-normal flex-shrink-0">vs</span>
                            <a href={`/player/${mp2.id}`} className="hover:underline truncate" style={{ color: navy }}>{mp2.name}</a>
                            {isFinal && (
                              <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0"
                                style={{ background: '#fef3c7', color: '#92400e' }}>FINAL</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                            <button onClick={() => { setExpandedH2H(isExpanded ? null : m.id) }}
                              className="text-xs text-gray-400 hover:text-gray-700">
                              {isExpanded ? '▲' : '▼'}
                            </button>
                            <button onClick={() => handleDeleteH2H(m.id)} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                          </div>
                        </div>

                        {/* Bet row */}
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 flex-wrap">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input autoFocus value={editH2HBet} onChange={(e) => setEditH2HBet(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveH2HBet(m.id); if (e.key === 'Escape') setEditingH2H(null) }}
                                className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none w-28" />
                              <button onClick={() => handleSaveH2HBet(m.id)} className="text-xs font-semibold text-green-600">Save</button>
                              <button onClick={() => setEditingH2H(null)} className="text-xs text-gray-400">Cancel</button>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1">
                              {m.bet
                                ? <span className="font-medium" style={{ color: gold }}>Bet: {m.bet}</span>
                                : <span className="text-gray-300">No bet</span>}
                              <button onClick={() => { setEditingH2H(m.id); setEditH2HBet(m.bet) }}
                                className="text-gray-300 hover:text-gray-500 ml-0.5">✎</button>
                            </span>
                          )}
                          {stats.holesPlayed > 0 ? (
                            <>
                              <span className="text-gray-300">·</span>
                              <span className="font-mono font-bold text-gray-700">{stats.p1Wins}–{stats.p2Wins}–{stats.ties}</span>
                              <span className="text-gray-300">·</span>
                              <span className="font-semibold" style={{ color: leader ? '#16a34a' : '#6b7280' }}>
                                {isFinal
                                  ? (leader ? `${leader.name.split(' ')[0]} wins` : 'All square')
                                  : (leader ? `${leader.name.split(' ')[0]} leads` : 'All square')}
                              </span>
                              <span className="text-gray-300">·</span>
                              <span className="text-gray-500">Thru {stats.holesPlayed}</span>
                            </>
                          ) : <span className="text-gray-400">No scores yet</span>}
                        </div>

                        {/* Nassau */}
                        {stats.holesPlayed > 0 && (
                          <div className="flex gap-1.5 text-xs mb-2">
                            {(['Front', 'Back', 'Overall'] as const).map((leg) => {
                              const ns = leg === 'Front' ? stats.nassauFront : leg === 'Back' ? stats.nassauBack : stats.nassauOverall
                              const { text, color } = nassauStatus(ns.p1Up, ns.played, ns.complete, p1Short, p2Short)
                              return (
                                <div key={leg} className="flex-1 rounded-md px-1.5 py-1 text-center" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                                  <p className="text-gray-400 text-xs leading-none mb-0.5">{leg}</p>
                                  <p className="font-semibold leading-none" style={{ color, fontSize: '0.65rem' }}>{text}</p>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Front / Back / Total vs par */}
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
                                  <p className="text-gray-400 mt-0.5" style={{ fontSize: '0.65rem' }}>{p1Short} | {p2Short}</p>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Expanded hole-by-hole */}
                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          <H2HHoleTable stats={stats} p1={mp1} p2={mp2} holes={holes} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── 2 v 2 Best Ball ── */}
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">2 v 2 Best Ball</p>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <div className="grid grid-cols-2 gap-2 mb-2">
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
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Bet</label>
                  <input type="text" placeholder="e.g. $10…" value={bbBet} onChange={(e) => setBbBet(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none" />
                </div>
                <button onClick={handleCreateBB}
                  disabled={!bbT1P1 || !bbT1P2 || !bbT2P1 || !bbT2P2 || new Set([bbT1P1, bbT1P2, bbT2P1, bbT2P2]).size !== 4 || savingBB}
                  className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex-shrink-0"
                  style={{ background: navy, color: 'white' }}>
                  {savingBB ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {bestBallMatchups.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">No best ball matchups saved yet</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {bestBallMatchups.map((m) => {
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
                  const isExpanded = expandedBB?.id === m.id
                  const expandView = expandedBB?.view ?? 'match'
                  const isEditingBB = editingBB === m.id

                  return (
                    <div key={m.id}>
                      <div className="px-4 py-3">
                        {/* Team names row */}
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 text-sm font-semibold min-w-0 flex-wrap">
                            <button onClick={() => setExpandedBB(isExpanded && expandView === 'team1' ? null : { id: m.id, view: 'team1' })}
                              className="hover:underline font-semibold text-left" style={{ color: '#2563eb' }}>{t1Name}</button>
                            <span className="text-gray-400 font-normal flex-shrink-0">vs</span>
                            <button onClick={() => setExpandedBB(isExpanded && expandView === 'team2' ? null : { id: m.id, view: 'team2' })}
                              className="hover:underline font-semibold text-left" style={{ color: '#92400e' }}>{t2Name}</button>
                            {isFinal && (
                              <span className="px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0"
                                style={{ background: '#fef3c7', color: '#92400e' }}>FINAL</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                            <button onClick={() => setExpandedBB(isExpanded && expandView === 'match' ? null : { id: m.id, view: 'match' })}
                              className="text-xs text-gray-400 hover:text-gray-700">
                              {isExpanded ? '▲' : '▼'}
                            </button>
                            <button onClick={() => handleDeleteBB(m.id)} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                          </div>
                        </div>

                        {/* Bet + status */}
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 flex-wrap">
                          {isEditingBB ? (
                            <div className="flex items-center gap-1.5">
                              <input autoFocus value={editBBBet} onChange={(e) => setEditBBBet(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveBBBet(m.id); if (e.key === 'Escape') setEditingBB(null) }}
                                className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none w-28" />
                              <button onClick={() => handleSaveBBBet(m.id)} className="text-xs font-semibold text-green-600">Save</button>
                              <button onClick={() => setEditingBB(null)} className="text-xs text-gray-400">Cancel</button>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1">
                              {m.bet
                                ? <span className="font-medium" style={{ color: gold }}>Bet: {m.bet}</span>
                                : <span className="text-gray-300">No bet</span>}
                              <button onClick={() => { setEditingBB(m.id); setEditBBBet(m.bet) }}
                                className="text-gray-300 hover:text-gray-500 ml-0.5">✎</button>
                            </span>
                          )}
                          {stats.holesPlayed > 0 ? (
                            <>
                              <span className="text-gray-300">·</span>
                              <span className="font-mono font-bold text-gray-700">{stats.t1Wins}–{stats.t2Wins}–{stats.ties}</span>
                              <span className="text-gray-300">·</span>
                              <span className="font-semibold" style={{ color: leader ? '#16a34a' : '#6b7280' }}>
                                {isFinal
                                  ? (leader === 'team1' ? `${t1Name} wins` : leader === 'team2' ? `${t2Name} wins` : 'Tied')
                                  : (leader === 'team1' ? `${t1Name} leads` : leader === 'team2' ? `${t2Name} leads` : 'All square')}
                              </span>
                              <span className="text-gray-300">·</span>
                              <span>Thru {stats.holesPlayed}</span>
                            </>
                          ) : <span className="text-gray-400">No scores yet</span>}
                        </div>

                        {/* Front / Back / Total */}
                        {stats.holesPlayed > 0 && (
                          <div className="grid grid-cols-3 gap-1 text-xs">
                            {(['Front', 'Back', 'Total'] as const).map((label) => {
                              const v1 = label === 'Front' ? stats.t1Front : label === 'Back' ? stats.t1Back : stats.t1Total
                              const v2 = label === 'Front' ? stats.t2Front : label === 'Back' ? stats.t2Back : stats.t2Total
                              return (
                                <div key={label} className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
                                  <p className="text-gray-400 mb-0.5">{label}</p>
                                  <div className="flex justify-around">
                                    <span className="font-bold" style={{ color: vpColor(v1) }}>{fmtVsPar(v1)}</span>
                                    <span className="text-gray-300">|</span>
                                    <span className="font-bold" style={{ color: vpColor(v2) }}>{fmtVsPar(v2)}</span>
                                  </div>
                                  <p className="text-gray-400 mt-0.5" style={{ fontSize: '0.65rem' }}>T1 | T2</p>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Expanded view */}
                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          {/* Tab switcher */}
                          <div className="flex border-b border-gray-100">
                            {([
                              { key: 'match', label: 'Match' },
                              { key: 'team1', label: t1Name },
                              { key: 'team2', label: t2Name },
                            ] as const).map(({ key, label }) => (
                              <button key={key}
                                onClick={() => setExpandedBB({ id: m.id, view: key })}
                                className="flex-1 py-2 text-xs font-semibold border-b-2 transition-colors"
                                style={{
                                  borderColor: expandView === key ? navy : 'transparent',
                                  color: expandView === key ? navy : '#9ca3af',
                                }}>
                                {label}
                              </button>
                            ))}
                          </div>

                          {expandView === 'match' && (
                            <BBMatchTable stats={stats} t1Name={t1Name} t2Name={t2Name} holes={holes} />
                          )}
                          {expandView === 'team1' && (
                            <BBTeamTable rows={stats.rows} p1={t1p1} p2={t1p2} teamKey="team1" holes={holes} />
                          )}
                          {expandView === 'team2' && (
                            <BBTeamTable rows={stats.rows} p1={t2p1} p2={t2p2} teamKey="team2" holes={holes} />
                          )}
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
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
          <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>
            <a href={`/player/${p1.id}`} className="hover:underline">{p1.name.split(' ')[0]}</a>
          </th>
          <th className="px-2 py-2 w-8" />
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
                {s1 != null
                  ? <span className="font-bold" style={{ color: scoreColor(s1, hole.par) }}>{s1}</span>
                  : <span className="text-gray-300">–</span>}
              </td>
              <td className="px-2 py-2.5 text-center text-xs font-bold">
                {result === 'win' && <span className="text-green-600">W</span>}
                {result === 'loss' && <span className="text-red-500">L</span>}
                {result === 'tie' && <span className="text-gray-400">T</span>}
                {result === null && <span className="text-gray-200">–</span>}
              </td>
              <td className="px-3 py-2.5 text-center">
                {s2 != null
                  ? <span className="font-bold" style={{ color: scoreColor(s2, hole.par) }}>{s2}</span>
                  : <span className="text-gray-300">–</span>}
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
                {t1Best != null
                  ? <span className="font-bold" style={{ color: scoreColor(t1Best, hole.par) }}>{t1Best}</span>
                  : <span className="text-gray-300">–</span>}
              </td>
              <td className="px-2 py-2.5 text-center text-xs font-bold">
                {result === 'team1' && <span className="text-green-600">W</span>}
                {result === 'team2' && <span className="text-red-500">L</span>}
                {result === 'tie' && <span className="text-gray-400">T</span>}
                {result === null && <span className="text-gray-200">–</span>}
              </td>
              <td className="px-3 py-2.5 text-center">
                {t2Best != null
                  ? <span className="font-bold" style={{ color: scoreColor(t2Best, hole.par) }}>{t2Best}</span>
                  : <span className="text-gray-300">–</span>}
              </td>
            </tr>
          )
        })}
        <tr className="border-t-2 border-gray-200 font-bold" style={{ background: '#f9fafb' }}>
          <td colSpan={2} className="px-3 py-2.5 text-gray-700">Total</td>
          <td className="px-3 py-2.5 text-center">
            <span style={{ color: vpColor(stats.t1Total) }}>{fmtVsPar(stats.t1Total)}</span>
          </td>
          <td className="px-2 py-2.5 text-center text-xs"
            style={{ color: stats.t1Wins > stats.t2Wins ? '#16a34a' : stats.t2Wins > stats.t1Wins ? '#dc2626' : '#6b7280' }}>
            {stats.t1Wins}–{stats.t2Wins}–{stats.ties}
          </td>
          <td className="px-3 py-2.5 text-center">
            <span style={{ color: vpColor(stats.t2Total) }}>{fmtVsPar(stats.t2Total)}</span>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function BBTeamTable({ rows, p1, p2, teamKey, holes }: {
  rows: BBRow[]
  p1: Player; p2: Player
  teamKey: 'team1' | 'team2'
  holes: Hole[]
}) {
  const totalPar = holes.reduce((s, h) => s + h.par, 0)
  let totalP1 = 0, totalP2 = 0, totalBest = 0, anyScore = false

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr style={{ background: navy }}>
          <th className="px-3 py-2 text-left text-xs font-semibold w-10" style={{ color: 'rgba(255,255,255,0.6)' }}>Hole</th>
          <th className="px-2 py-2 text-center text-xs w-8" style={{ color: 'rgba(255,255,255,0.6)' }}>Par</th>
          <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>
            <a href={`/player/${p1.id}`} className="hover:underline">{p1.name.split(' ')[0]}</a>
          </th>
          <th className="px-3 py-2 text-center text-xs font-semibold" style={{ color: gold }}>
            <a href={`/player/${p2.id}`} className="hover:underline">{p2.name.split(' ')[0]}</a>
          </th>
          <th className="px-3 py-2 text-center text-xs font-semibold text-white">Best</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const s1 = teamKey === 'team1' ? row.t1p1 : row.t2p1
          const s2 = teamKey === 'team1' ? row.t1p2 : row.t2p2
          const best = teamKey === 'team1' ? row.t1Best : row.t2Best
          if (s1 != null) totalP1 += s1
          if (s2 != null) totalP2 += s2
          if (best != null) { totalBest += best; anyScore = true }
          const p1IsBest = best != null && s1 === best
          const p2IsBest = best != null && s2 === best
          return (
            <tr key={row.hole.hole_number} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-2.5 font-bold text-gray-900">{row.hole.hole_number}</td>
              <td className="px-2 py-2.5 text-center text-gray-400">{row.hole.par}</td>
              <td className="px-3 py-2.5 text-center">
                {s1 != null
                  ? <span className="font-bold" style={{ color: scoreColor(s1, row.hole.par) }}>
                      {s1}{p1IsBest && !p2IsBest ? ' ★' : ''}
                    </span>
                  : <span className="text-gray-300">–</span>}
              </td>
              <td className="px-3 py-2.5 text-center">
                {s2 != null
                  ? <span className="font-bold" style={{ color: scoreColor(s2, row.hole.par) }}>
                      {s2}{p2IsBest && !p1IsBest ? ' ★' : ''}
                    </span>
                  : <span className="text-gray-300">–</span>}
              </td>
              <td className="px-3 py-2.5 text-center">
                {best != null
                  ? <span className="font-bold" style={{ color: scoreColor(best, row.hole.par) }}>{best}</span>
                  : <span className="text-gray-300">–</span>}
              </td>
            </tr>
          )
        })}
        <tr className="border-t-2 border-gray-200 font-bold" style={{ background: '#f9fafb' }}>
          <td colSpan={2} className="px-3 py-2.5 text-gray-700">Total</td>
          <td className="px-3 py-2.5 text-center text-gray-500 text-xs">{totalP1 > 0 ? totalP1 : '–'}</td>
          <td className="px-3 py-2.5 text-center text-gray-500 text-xs">{totalP2 > 0 ? totalP2 : '–'}</td>
          <td className="px-3 py-2.5 text-center">
            {anyScore
              ? <span style={{ color: vpColor(totalBest - totalPar) }}>{totalBest} ({fmtVsPar(totalBest - totalPar)})</span>
              : '–'}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function MatchupDetail({ p1, p2, stats, holes }: {
  p1: Player; p2: Player
  stats: ReturnType<typeof computeStats>
  holes: Hole[]
}) {
  const leader = stats.p1Wins > stats.p2Wins ? p1 : stats.p2Wins > stats.p1Wins ? p2 : null
  const isFinal = stats.holesPlayed === holes.length && holes.length > 0
  const p1Short = p1.name.split(' ')[0]
  const p2Short = p2.name.split(' ')[0]

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          <div className="px-4 py-3 text-center">
            <a href={`/player/${p1.id}`} className="text-xs font-semibold text-gray-500 mb-1 block hover:underline">{p1.name}</a>
            <p className="text-3xl font-bold" style={{ color: stats.p1Wins > stats.p2Wins ? '#16a34a' : '#374151' }}>{stats.p1Wins}</p>
            <p className="text-xs text-gray-400">holes won</p>
          </div>
          <div className="px-4 py-3 text-center flex flex-col items-center justify-center">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">VS</p>
            <p className="text-sm text-gray-500">{stats.ties} tied</p>
            {stats.holesPlayed > 0 && (
              <p className="text-xs mt-1 font-semibold" style={{ color: leader ? '#16a34a' : '#6b7280' }}>
                {isFinal
                  ? (leader ? `${leader.name.split(' ')[0]} wins` : 'Tied')
                  : (leader ? `${leader.name.split(' ')[0]} leads` : 'All square')}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">
              {isFinal ? 'Final' : `Thru ${stats.holesPlayed}`}
            </p>
          </div>
          <div className="px-4 py-3 text-center">
            <a href={`/player/${p2.id}`} className="text-xs font-semibold text-gray-500 mb-1 block hover:underline">{p2.name}</a>
            <p className="text-3xl font-bold" style={{ color: stats.p2Wins > stats.p1Wins ? '#16a34a' : '#374151' }}>{stats.p2Wins}</p>
            <p className="text-xs text-gray-400">holes won</p>
          </div>
        </div>

        {/* Nassau */}
        {stats.holesPlayed > 0 && (
          <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
            {(['nassauFront', 'nassauBack', 'nassauOverall'] as const).map((key, i) => {
              const ns = stats[key]
              const { text, color } = nassauStatus(ns.p1Up, ns.played, ns.complete, p1Short, p2Short)
              const label = ['Front', 'Back', 'Overall'][i]
              return (
                <div key={key} className="px-2 py-2 text-center">
                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                  <p className="text-xs font-semibold" style={{ color }}>{text}</p>
                </div>
              )
            })}
          </div>
        )}

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

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <H2HHoleTable stats={stats} p1={p1} p2={p2} holes={holes} />
      </div>
    </>
  )
}

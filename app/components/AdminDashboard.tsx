'use client'

import { useActionState, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  createRound, addTeam, addPlayer, deleteTeam, deletePlayer,
  toggleTeamAdmin, resetTeamScores, activateRound, updateHolePars, updateBallValues,
  adminLogout, renameTeam, movePlayer,
} from '@/app/actions'
import { computeTeamBallSummary, calculateFrontBackPayouts } from '@/lib/scoring'

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

// Match the server-side constants for course par preview
const COURSE_PARS_CLIENT: Record<string, number[]> = {
  north: [4, 4, 4, 3, 4, 4, 5, 3, 5, 3, 4, 4, 5, 3, 5, 4, 3, 4],
  south: [4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5, 4, 3, 4, 5],
}

type Round = { id: string; name: string; date: string; course: string; balls_count: number; is_started: boolean } | null
type Team = { id: string; name: string; pin: string; is_admin: boolean }
type Player = { id: string; team_id: string; name: string; position: number | null }
type Hole = { hole_number: number; par: number }
type BallValue = { ball_number: number; value_dollars: number }
type Score = { player_id: string; hole_number: number; strokes: number }

export default function AdminDashboard({
  round, teams, players, holes, ballValues, scores,
}: {
  round: Round; teams: Team[]; players: Player[]; holes: Hole[]; ballValues: BallValue[]; scores: Score[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'overview' | 'teams' | 'setup' | 'payouts'>(!round ? 'setup' : 'overview')
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [renamingTeam, setRenamingTeam] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState('north')

  const [createState, createAction, createPending] = useActionState(createRound, null)
  const [addTeamState, addTeamAction, addTeamPending] = useActionState(addTeam, null)
  const [addPlayerState, addPlayerAction, addPlayerPending] = useActionState(addPlayer, null)
  const [parState, parAction, parPending] = useActionState(updateHolePars, null)
  const [ballState, ballAction, ballPending] = useActionState(updateBallValues, null)
  const [renameState, renameAction, renamePending] = useActionState(renameTeam, null)

  // Refresh server data after mutations so the UI updates without a manual reload.
  // Watch the full state object (not just .success) — the object reference changes
  // on every submission, so the effect re-fires even on back-to-back successes.
  useEffect(() => {
    if (createState?.success) { router.refresh(); setTab('teams') }
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
    if (parState?.success) router.refresh()
  }, [parState])
  useEffect(() => {
    if (ballState?.success) router.refresh()
  }, [ballState])

  const [pars, setPars] = useState<Record<number, number>>(
    Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, holes.find((h) => h.hole_number === i + 1)?.par ?? 4]))
  )
  const [ballVals, setBallVals] = useState<Record<number, number>>(
    Object.fromEntries(ballValues.map((bv) => [bv.ball_number, bv.value_dollars]))
  )

  const parTotal = Object.values(pars).reduce((a, b) => a + b, 0)
  const ballsCount = round?.balls_count ?? 3

  const summaryMap = new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(holes, tp.map((p) => p.id), scores, ballsCount)]
  }))

  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)
  const frontSummaries = new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(frontHoles, tp.map((p) => p.id), scores, ballsCount)]
  }))
  const backSummaries = new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(backHoles, tp.map((p) => p.id), scores, ballsCount)]
  }))

  const ballValueArr = Array.from({ length: ballsCount }, (_, i) => ballVals[i + 1] ?? 0)
  const { results: ballResults, net, settlements } = calculateFrontBackPayouts(
    teams, frontSummaries, backSummaries, ballValueArr, ballsCount
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

  function toggleExpand(teamId: string) {
    setExpandedTeams((prev) => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  function handleCourseChange(courseKey: string) {
    setSelectedCourse(courseKey)
    const presetPars = COURSE_PARS_CLIENT[courseKey]
    if (presetPars) {
      setPars(Object.fromEntries(presetPars.map((par, i) => [i + 1, par])))
    }
  }

  const tabs = ['overview', 'teams', 'setup', 'payouts'] as const

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      <header className="text-white px-4 py-4 shadow-md" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: gold }}>Admin</p>
            <h1 className="font-bold text-lg">Anything But Golf Group</h1>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>Leaderboard ↗</a>
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
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#15803d' }}>● Active</span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>Setup</span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {round.course && `${round.course} · `}
                  {new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' · '}{teams.length} teams · Par {parTotal} · {ballsCount}-ball
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

        {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
        {tab === 'overview' && round && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center px-4 py-2 text-xs font-semibold uppercase"
              style={{ background: navy, color: 'rgba(255,255,255,0.7)' }}>
              <span className="flex-1">Team / Players</span>
              {Array.from({ length: ballsCount }, (_, i) => (
                <span key={i} className="w-12 text-center" style={{ color: gold }}>{BALL_NAMES[i]}</span>
              ))}
              <span className="w-10 text-center">Thru</span>
              <span className="w-5" />
            </div>
            {teams.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">No teams yet. Add them in the Teams tab.</p>
            )}
            {teams.map((team) => {
              const s = summaryMap.get(team.id)!
              const teamPlayers = players.filter((p) => p.team_id === team.id)
              const isExpanded = expandedTeams.has(team.id)
              return (
                <div key={team.id} className="border-b border-gray-100 last:border-0">
                  <button
                    type="button"
                    onClick={() => toggleExpand(team.id)}
                    className="w-full flex items-center px-4 py-2.5 hover:bg-gray-50 transition text-left"
                  >
                    <span className="flex-1 font-semibold text-gray-900 text-sm truncate">{team.name}</span>
                    {Array.from({ length: ballsCount }, (_, i) => {
                      const vp = s.ballVsPar[i]
                      return (
                        <span key={i} className="w-12 text-center text-sm font-medium"
                          style={{ color: vp == null ? '#d1d5db' : vp < 0 ? '#2563eb' : vp > 0 ? '#dc2626' : '#6b7280' }}>
                          {vp == null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                        </span>
                      )
                    })}
                    <span className="w-10 text-center text-sm text-gray-500">
                      {s.holesPerBall[0] === 0 ? '–' : s.holesPerBall[0] === 18 ? 'F' : s.holesPerBall[0]}
                    </span>
                    <span className="w-5 text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="bg-gray-50 px-5 py-2 space-y-1">
                      {teamPlayers.length === 0 && (
                        <p className="text-xs text-gray-400 py-1">No players added yet</p>
                      )}
                      {teamPlayers.map((player) => {
                        const playerScores = scores.filter((s) => s.player_id === player.id)
                        const total = playerScores.reduce((sum, s) => sum + s.strokes, 0)
                        const thru = playerScores.length
                        const parForThru = holes
                          .filter((h) => playerScores.some((s) => s.hole_number === h.hole_number))
                          .reduce((sum, h) => sum + h.par, 0)
                        const vp = thru > 0 ? total - parForThru : null
                        return (
                          <div key={player.id} className="flex items-center py-0.5">
                            <span className="flex-1 text-sm text-gray-700">{player.name}</span>
                            <span className="text-xs text-gray-400 mr-3">{thru > 0 ? `Thru ${thru}` : 'No scores'}</span>
                            <span className="text-sm font-medium w-8 text-right"
                              style={{ color: vp == null ? '#9ca3af' : vp < 0 ? '#2563eb' : vp > 0 ? '#dc2626' : '#6b7280' }}>
                              {vp == null ? '–' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : vp}
                            </span>
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{team.name}</p>
                          <p className="text-xs text-gray-500">
                            PIN: <span className="font-mono font-bold text-gray-800">{team.pin}</span>
                            {' · '}{teamPlayers.length} player{teamPlayers.length !== 1 ? 's' : ''}
                            {team.is_admin && <span className="ml-1 text-amber-600 font-medium">· Admin</span>}
                          </p>
                        </div>
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
                          style={{ borderColor: gold, color: team.is_admin ? '#92400e' : '#6b7280' }}>
                          {team.is_admin ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                        <button type="button" onClick={() => handleDeleteTeam(team.id)}
                          className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-50">
                          Remove
                        </button>
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
                        <div key={p.id} className="flex items-center gap-1.5 bg-white rounded-lg px-3 py-2 border border-gray-100">
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
                          <button type="button" onClick={() => handleDeletePlayer(p.id)}
                            className="text-xs text-red-500 hover:text-red-700 ml-1">Remove</button>
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
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                    <input type="date" name="date" required
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Balls in Play</label>
                    <select name="ballsCount" defaultValue="3"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                      <option value="3">3 Balls</option>
                      <option value="4">4 Balls</option>
                    </select>
                  </div>
                </div>
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
                <button type="submit" disabled={createPending}
                  className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                  style={{ background: navy }}>
                  {createPending ? 'Creating…' : round ? 'Start New Round' : 'Create Round'}
                </button>
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

            {/* Ball values */}
            {round && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">Ball Values</h3>
                <form action={ballAction} className="space-y-3">
                  <input type="hidden" name="roundId" value={round.id} />
                  <input type="hidden" name="ballsCount" value={round.balls_count} />
                  {ballState?.success && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Values saved!</p>}
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: round.balls_count }, (_, i) => i + 1).map((bn) => (
                      <div key={bn}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{BALL_NAMES[bn - 1]} Per Half ($)</label>
                        <input type="number" name={`ball_${bn}`} min="0" step="5"
                          value={ballVals[bn] ?? 10}
                          onChange={(e) => setBallVals((v) => ({ ...v, [bn]: parseFloat(e.target.value) || 0 }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                    ))}
                  </div>
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
            {/* Ball Results */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">Ball Results</h3>
                <p className="text-xs text-gray-500">6 balls total · ties wash · winner takes ${ballVals[1] ?? 0}/team per half</p>
              </div>
              <div className="px-4 py-4 space-y-4">
                {Array.from({ length: ballsCount }, (_, bi) => {
                  const front = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Front 9')
                  const back = ballResults.find((r) => r.ball === bi + 1 && r.half === 'Back 9')
                  return (
                    <div key={bi}>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: gold }}>
                        {BALL_NAMES[bi]}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {[front, back].map((result, hi) => {
                          if (!result) return <div key={hi} />
                          const vp = result.winnerVsPar
                          const vpStr = vp == null ? '' : vp === 0 ? 'E' : vp > 0 ? `+${vp}` : `${vp}`
                          return (
                            <div key={hi} className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-xs text-gray-500 mb-0.5">{result.half}</p>
                              {!result.played ? (
                                <p className="text-sm text-gray-300 font-medium">–</p>
                              ) : result.tied ? (
                                <p className="text-sm text-gray-500 font-medium">Tie — Washes</p>
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

            {/* Team Net */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">Team Net</h3>
                <p className="text-xs text-gray-500">Based on scores entered so far</p>
              </div>
              {[...teams].sort((a, b) => (net[b.id] ?? 0) - (net[a.id] ?? 0)).map((team) => {
                const teamNet = net[team.id] ?? 0
                return (
                  <div key={team.id} className="flex items-center px-4 py-2.5 border-b border-gray-100 last:border-0">
                    <span className="flex-1 font-medium text-gray-900 text-sm">{team.name}</span>
                    <span className="font-bold text-base" style={{ color: teamNet > 0 ? '#16a34a' : teamNet < 0 ? '#dc2626' : '#6b7280' }}>
                      {teamNet === 0 ? 'Even' : teamNet > 0 ? `+$${teamNet}` : `-$${Math.abs(teamNet)}`}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Settlement */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">Settlement</h3>
                <p className="text-xs text-gray-500">Who pays who</p>
              </div>
              {settlements.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No payouts yet.</p>
              ) : settlements.map((s, i) => (
                <div key={i} className="flex items-center px-4 py-2.5 border-b border-gray-100 last:border-0 gap-2">
                  <span className="flex-1 text-sm text-gray-900">
                    <span className="font-semibold text-red-600">{s.fromName}</span>
                    {' pays '}
                    <span className="font-semibold text-green-700">{s.toName}</span>
                  </span>
                  <span className="font-bold text-gray-900">${s.amount}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  )
}

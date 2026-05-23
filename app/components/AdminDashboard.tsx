'use client'

import { useActionState, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  createRound, addTeam, addPlayer, deleteTeam, deletePlayer,
  toggleTeamAdmin, resetTeamScores, activateRound, updateHolePars, updateBallValues,
  adminLogout, renameTeam, renamePlayer, movePlayer,
} from '@/app/actions'
import {
  computeTeamBallSummary, calculateFrontBackPayouts,
  computeDaytonaSidesSummary, computePlayerDaytonaPoints, settleDaytonaPlayerPoints,
  type DaytonaHoleAssignment,
} from '@/lib/scoring'
import PinLoginModal from './PinLoginModal'

const navy = '#0f172a'
const gold = '#f59e0b'
const BALL_NAMES = ['1-Ball', '2-Ball', '3-Ball', '4-Ball']

// Match the server-side constants for course par preview
const COURSE_PARS_CLIENT: Record<string, number[]> = {
  north: [4, 4, 4, 3, 4, 4, 5, 3, 5, 3, 4, 4, 5, 3, 5, 4, 3, 4],
  south: [4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5, 4, 3, 4, 5],
}

type Round = { id: string; name: string; date: string; course: string; balls_count: number; format: string; daytona_variant: string | null; is_started: boolean } | null
type Team = { id: string; name: string; pin: string; is_admin: boolean }
type Player = { id: string; team_id: string; name: string; position: number | null }
type Hole = { hole_number: number; par: number }
type BallValue = { ball_number: number; value_dollars: number }
type Score = { player_id: string; hole_number: number; strokes: number }

export default function AdminDashboard({
  round, teams, players, holes, ballValues, scores, scorecardTeamId = null, dtAssignments = [],
}: {
  round: Round; teams: Team[]; players: Player[]; holes: Hole[]; ballValues: BallValue[]; scores: Score[]; scorecardTeamId?: string | null; dtAssignments?: DaytonaHoleAssignment[]
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
    if (renamePlayerState?.success) { router.refresh(); setRenamingPlayer(null) }
  }, [renamePlayerState])
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
  const isDaytona = round?.format === 'daytona'
  const isComplete = players.length > 0 && holes.length > 0 && players.every((p) => scores.filter((s) => s.player_id === p.id).length === holes.length)

  // Standard ball payouts
  const frontHoles = holes.filter((h) => h.hole_number <= 9)
  const backHoles = holes.filter((h) => h.hole_number >= 10)
  const frontSummaries = !isDaytona ? new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(frontHoles, tp.map((p) => p.id), scores, ballsCount)]
  })) : new Map()
  const backSummaries = !isDaytona ? new Map(teams.map((team) => {
    const tp = players.filter((p) => p.team_id === team.id)
    return [team.id, computeTeamBallSummary(backHoles, tp.map((p) => p.id), scores, ballsCount)]
  })) : new Map()

  const ballValueArr = Array.from({ length: ballsCount }, (_, i) => ballVals[i + 1] ?? 0)
  const { results: ballResults, net, settlements } = !isDaytona
    ? calculateFrontBackPayouts(teams, frontSummaries, backSummaries, ballValueArr, ballsCount)
    : { results: [], net: {} as Record<string, number>, settlements: [] }

  // Daytona Left/Right summaries per team
  const dtSummaries = isDaytona
    ? new Map(teams.map((team) => {
        const teamPlayerIds = players.filter((p) => p.team_id === team.id).map((p) => p.id)
        const teamAssignments = dtAssignments.filter((a) => teamPlayerIds.includes(a.player_id))
        return [team.id, computeDaytonaSidesSummary(holes, scores, teamAssignments)]
      }))
    : new Map()
  const dtPayoutValue = ballVals[1] ?? 0

  const payoutNet = net
  const payoutSettlements = settlements

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
                    : `${ballsCount}-ball`}
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
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                    <input type="date" name="date" required
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
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Balls in Play</label>
                    <select name="ballsCount" defaultValue="3"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                      <option value="3">3 Balls</option>
                      <option value="4">4 Balls</option>
                    </select>
                  </div>
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

            {/* Ball / Daytona values */}
            {round && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-3 text-sm">
                  {isDaytona ? 'Daytona Payout Value' : 'Ball Values'}
                </h3>
                <form action={ballAction} className="space-y-3">
                  <input type="hidden" name="roundId" value={round.id} />
                  <input type="hidden" name="ballsCount" value={isDaytona ? 1 : round.balls_count} />
                  {ballState?.success && <p className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">Values saved!</p>}
                  {isDaytona ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Value Per Point ($)</label>
                      <input type="number" name="ball_1" min="0" step="0.25"
                        value={ballVals[1] ?? 1}
                        onChange={(e) => setBallVals((v) => ({ ...v, 1: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      <p className="text-xs text-gray-400 mt-1">Each point = this dollar amount. Points are the DT score difference per hole per player.</p>
                    </div>
                  ) : (
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
                {teams.map((team) => {
                  const teamPlayers = players.filter((p) => p.team_id === team.id)
                  const teamPlayerIds = teamPlayers.map((p) => p.id)
                  const teamAssignments = dtAssignments.filter((a) => teamPlayerIds.includes(a.player_id))
                  const teamScores = scores.filter((s) => teamPlayerIds.includes(s.player_id))
                  const pointTotals = computePlayerDaytonaPoints(holes, teamScores, teamAssignments, round?.daytona_variant ?? '4man')
                  const { net: playerNet, settlements: playerSettlements } = settleDaytonaPlayerPoints(
                    teamPlayers, pointTotals, dtPayoutValue
                  )

                  return (
                    <div key={team.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <h3 className="font-semibold text-gray-900 text-sm">{team.name}</h3>
                        <p className="text-xs text-gray-500">${dtPayoutValue}/point · lower DT wins each hole · difference = points</p>
                      </div>

                      {/* Per-player point totals */}
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

                      {/* Hole-by-hole DT summary */}
                      {(() => {
                        const summary = dtSummaries.get(team.id)
                        return summary && (summary.leftFront != null || summary.leftBack != null) ? (
                          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                            <div className="flex gap-4 text-xs">
                              {summary.leftFront != null && (
                                <span className="text-gray-500">
                                  Front: <span style={{ color: '#2563eb' }}>L {summary.leftFront}</span>
                                  {' vs '}
                                  <span style={{ color: '#92400e' }}>R {summary.rightFront}</span>
                                </span>
                              )}
                              {summary.leftBack != null && (
                                <span className="text-gray-500">
                                  Back: <span style={{ color: '#2563eb' }}>L {summary.leftBack}</span>
                                  {' vs '}
                                  <span style={{ color: '#92400e' }}>R {summary.rightBack}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        ) : null
                      })()}

                      {/* Settlement */}
                      {playerSettlements.length > 0 && (
                        <div className="border-t border-gray-200 px-4 py-3">
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
              </>
            ) : (
              /* ── Standard ball results ── */
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
            )}

            {/* Team Net + Settlement — standard format only */}
            {!isDaytona && (
              <>
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900 text-sm">Team Net</h3>
                    <p className="text-xs text-gray-500">Based on scores entered so far</p>
                  </div>
                  {[...teams].sort((a, b) => (payoutNet[b.id] ?? 0) - (payoutNet[a.id] ?? 0)).map((team) => {
                    const teamNet = payoutNet[team.id] ?? 0
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

                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900 text-sm">Settlement</h3>
                    <p className="text-xs text-gray-500">Who pays who</p>
                  </div>
                  {payoutSettlements.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">No payouts yet.</p>
                  ) : payoutSettlements.map((s, i) => (
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
              </>
            )}
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import PreRoundHome from './components/PreRoundHome'
import LeaderboardClient from './components/LeaderboardClient'

export default async function HomePage() {
  const cookieStore = await cookies()
  const isAdmin = cookieStore.get('admin_auth')?.value === 'true'
  const sb = createServerClient()

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count, is_started')
    .eq('is_active', true)
    .single()

  const { data: teamsRaw } = round
    ? await sb.from('teams').select('id, name').eq('round_id', round.id).order('name')
    : { data: [] }
  const teams = teamsRaw ?? []

  // Pre-round: only Admin Login + Enter Team PIN
  if (!round || !round.is_started) {
    return <PreRoundHome teams={teams} round={round ?? null} />
  }

  const teamIds = teams.map((t) => t.id)
  const [{ data: players }, { data: holes }, { data: scores }] = await Promise.all([
    sb.from('players').select('id, team_id, name').in('team_id', teamIds.length ? teamIds : ['']),
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
  ])

  return (
    <LeaderboardClient
      initialTeams={teams}
      players={players ?? []}
      holes={holes ?? []}
      initialScores={scores ?? []}
      ballsCount={round.balls_count}
      roundName={round.name}
      roundDate={round.date}
      roundCourse={round.course ?? ''}
      viewOnly
      isAdmin={isAdmin}
    />
  )
}

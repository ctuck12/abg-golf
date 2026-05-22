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
    .select('id, name, date, course, balls_count, format, is_started')
    .eq('is_active', true)
    .single()

  const { data: teamsRaw } = round
    ? await sb.from('teams').select('id, name').eq('round_id', round.id).order('name')
    : { data: [] }
  const teams = teamsRaw ?? []
  const scorecardTeamId = teams.find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null

  // Pre-round: only Admin Login + Enter Team PIN
  if (!round || !round.is_started) {
    return <PreRoundHome teams={teams} round={round ?? null} />
  }

  const teamIds = teams.map((t) => t.id)
  const [{ data: players }, { data: holes }, { data: scores }] = await Promise.all([
    sb.from('players').select('id, team_id, name, position').in('team_id', teamIds.length ? teamIds : ['']).order('position', { ascending: true }),
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
      format={round.format ?? 'standard'}
      roundName={round.name}
      roundDate={round.date}
      roundCourse={round.course ?? ''}
      viewOnly
      isAdmin={isAdmin}
      scorecardTeamId={scorecardTeamId}
    />
  )
}

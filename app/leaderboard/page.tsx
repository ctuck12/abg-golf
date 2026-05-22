import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import LeaderboardClient from '@/app/components/LeaderboardClient'

export const dynamic = 'force-dynamic'

export default async function LeaderboardPage() {
  const sb = createServerClient()

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count')
    .eq('is_active', true)
    .single()

  if (!round) redirect('/')

  const { data: teams } = await sb
    .from('teams').select('id, name').eq('round_id', round.id).order('name')

  const teamIds = (teams ?? []).map((t) => t.id)

  const [{ data: players }, { data: holes }, { data: scores }] = await Promise.all([
    sb.from('players').select('id, team_id, name').in('team_id', teamIds.length ? teamIds : ['']),
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
  ])

  // Detect if a team member is currently logged in (so we can show "Back to Scorecard")
  const cookieStore = await cookies()
  const authTeam = (teams ?? []).find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')

  return (
    <LeaderboardClient
      initialTeams={teams ?? []}
      players={players ?? []}
      holes={holes ?? []}
      initialScores={scores ?? []}
      ballsCount={round.balls_count}
      roundName={round.name}
      roundDate={round.date}
      roundCourse={round.course ?? ''}
      scorecardTeamId={authTeam?.id ?? null}
    />
  )
}

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import LeaderboardClient from '@/app/components/LeaderboardClient'

export const dynamic = 'force-dynamic'

export default async function LeaderboardPage() {
  const sb = createServerClient()

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count, format, daytona_variant, include_total')
    .eq('is_active', true)
    .single()

  if (!round) redirect('/')

  const { data: teams } = await sb
    .from('teams').select('id, name').eq('round_id', round.id).order('name')

  const teamIds = (teams ?? []).map((t) => t.id)
  const isDaytona = (round.format ?? 'standard') === 'daytona'

  const [{ data: players }, { data: holes }, { data: scores }, { data: assignments }, { data: matchups }, { data: bestBallMatchups }] = await Promise.all([
    sb.from('players').select('id, team_id, name, position').in('team_id', teamIds.length ? teamIds : ['']).order('position', { ascending: true }),
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
    isDaytona
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id)
      : Promise.resolve({ data: [] }),
    sb.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', round.id).order('created_at'),
    sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', round.id).order('created_at'),
  ])

  const cookieStore = await cookies()
  const isAdmin = cookieStore.get('admin_auth')?.value === 'true'
  const authTeam = (teams ?? []).find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')

  const { data: ballValuesRaw } = await sb
    .from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id).order('ball_number')

  return (
    <LeaderboardClient
      initialTeams={teams ?? []}
      players={players ?? []}
      holes={holes ?? []}
      initialScores={scores ?? []}
      ballsCount={round.balls_count}
      ballValues={ballValuesRaw ?? []}
      format={round.format ?? 'standard'}
      daytonaVariant={round.daytona_variant ?? '4man'}
      roundId={round.id}
      initialAssignments={assignments ?? []}
      roundName={round.name}
      roundDate={round.date}
      roundCourse={round.course ?? ''}
      scorecardTeamId={authTeam?.id ?? null}
      isAdmin={isAdmin}
      includeTotal={round.include_total ?? false}
      matchups={matchups ?? []}
      bestBallMatchups={bestBallMatchups ?? []}
    />
  )
}

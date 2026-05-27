import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import AdminDashboard from '@/app/components/AdminDashboard'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_auth')?.value) redirect('/admin')

  const sb = createServerClient()

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, date, course, balls_count, format, daytona_variant, is_started, include_total, skins_enabled, skins_amount')
    .eq('is_active', true)
    .single()

  const roundId = round?.id

  const [teamsRes, holesRes, ballValuesRes] = await Promise.all([
    roundId
      ? sb.from('teams').select('id, name, pin, is_admin, daytona_variant').eq('round_id', roundId).order('name')
      : Promise.resolve({ data: [] }),
    roundId
      ? sb.from('holes').select('hole_number, par').eq('round_id', roundId).order('hole_number')
      : Promise.resolve({ data: [] }),
    roundId
      ? sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', roundId).order('ball_number')
      : Promise.resolve({ data: [] }),
  ])

  const teams = teamsRes.data ?? []
  const teamIds = teams.map((t) => t.id)
  const scorecardTeamId = teams.find((t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true')?.id ?? null

  const isDaytona = (round?.format ?? 'standard') === 'daytona'

  const [playersRes, scoresRes, assignmentsRes, matchupsRaw, bestBallRes, holeValuesRes] = await Promise.all([
    teamIds.length
      ? sb.from('players').select('id, team_id, name, position, skins_participant').in('team_id', teamIds).order('position', { ascending: true })
      : Promise.resolve({ data: [] }),
    roundId
      ? sb.from('scores').select('player_id, hole_number, strokes')
      : Promise.resolve({ data: [] }),
    roundId && isDaytona
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', roundId)
      : Promise.resolve({ data: [] }),
    roundId
      ? sb.from('matchups').select('id, player1_id, player2_id, bet, press').eq('round_id', roundId).order('created_at')
      : Promise.resolve({ data: [], error: null }),
    roundId
      ? sb.from('best_ball_matchups').select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, bet').eq('round_id', roundId).order('created_at')
      : Promise.resolve({ data: [] }),
    roundId && isDaytona
      ? sb.from('daytona_hole_values').select('team_id, hole_number, value_per_point').eq('round_id', roundId)
      : Promise.resolve({ data: [] }),
  ])
  const initialHoleValues: Record<string, Record<number, number>> = {}
  for (const hv of (holeValuesRes.data ?? []) as { team_id: string; hole_number: number; value_per_point: number }[]) {
    if (!initialHoleValues[hv.team_id]) initialHoleValues[hv.team_id] = {}
    initialHoleValues[hv.team_id][hv.hole_number] = hv.value_per_point
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let matchupsRes: { data: { id: string; player1_id: string; player2_id: string; bet: string; press: any[] }[] }
  if (!matchupsRaw.error) {
    matchupsRes = { data: (matchupsRaw.data ?? []) as typeof matchupsRes['data'] }
  } else {
    const fallback = roundId
      ? await sb.from('matchups').select('id, player1_id, player2_id, bet').eq('round_id', roundId).order('created_at')
      : { data: [] }
    matchupsRes = { data: (fallback.data ?? []).map((m) => ({ ...m, press: [] })) }
  }

  return (
    <AdminDashboard
      round={round ?? null}
      teams={teams}
      players={playersRes.data ?? []}
      holes={holesRes.data ?? []}
      ballValues={ballValuesRes.data ?? []}
      scores={scoresRes.data ?? []}
      scorecardTeamId={scorecardTeamId}
      dtAssignments={assignmentsRes.data ?? []}
      matchups={matchupsRes.data ?? []}
      bestBallMatchups={bestBallRes.data ?? []}
      initialHoleValues={initialHoleValues}
    />
  )
}

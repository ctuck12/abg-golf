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
    .select('id, name, date, course, balls_count, is_started')
    .eq('is_active', true)
    .single()

  const roundId = round?.id

  const [teamsRes, holesRes, ballValuesRes] = await Promise.all([
    roundId
      ? sb.from('teams').select('id, name, pin, is_admin').eq('round_id', roundId).order('name')
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

  const [playersRes, scoresRes] = await Promise.all([
    teamIds.length
      ? sb.from('players').select('id, team_id, name, position').in('team_id', teamIds).order('position', { ascending: true })
      : Promise.resolve({ data: [] }),
    roundId
      ? sb.from('scores').select('player_id, hole_number, strokes')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <AdminDashboard
      round={round ?? null}
      teams={teams}
      players={playersRes.data ?? []}
      holes={holesRes.data ?? []}
      ballValues={ballValuesRes.data ?? []}
      scores={scoresRes.data ?? []}
    />
  )
}

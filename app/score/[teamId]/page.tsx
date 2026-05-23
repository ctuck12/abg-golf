import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import ScoreEntry from '@/app/components/ScoreEntry'

export const dynamic = 'force-dynamic'

export default async function ScorePage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const cookieStore = await cookies()
  if (!cookieStore.get(`team_auth_${teamId}`)?.value) redirect('/')

  const sb = createServerClient()

  const { data: team } = await sb.from('teams').select('id, name, round_id, is_admin').eq('id', teamId).single()
  if (!team) redirect('/')

  const { data: round } = await sb
    .from('rounds').select('id, balls_count, format, daytona_variant, is_active').eq('id', team.round_id).single()
  if (!round || !round.is_active) redirect('/')

  const { data: players } = await sb
    .from('players').select('id, name').eq('team_id', teamId).order('position', { ascending: true })

  const playerIds = (players ?? []).map((p) => p.id)

  const isDaytona = (round.format ?? 'standard') === 'daytona'

  const { data: allTeams } = await sb.from('teams').select('id').eq('round_id', team.round_id)
  const allTeamIds = (allTeams ?? []).map((t) => t.id)
  const { data: allRoundPlayers } = await sb
    .from('players').select('id').in('team_id', allTeamIds.length ? allTeamIds : [''])
  const roundPlayerIds = (allRoundPlayers ?? []).map((p) => p.id)

  const [{ data: holes }, { data: scores }, { data: assignments }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds.length ? playerIds : ['']),
    isDaytona
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id)
      : Promise.resolve({ data: [] }),
  ])

  return (
    <ScoreEntry
      team={{ id: team.id, name: team.name }}
      players={players ?? []}
      holes={holes ?? []}
      initialScores={scores ?? []}
      ballsCount={round.balls_count}
      format={round.format ?? 'standard'}
      daytonaVariant={round.daytona_variant ?? '4man'}
      isAdmin={team.is_admin ?? false}
      roundId={round.id}
      initialAssignments={assignments ?? []}
      roundPlayerIds={roundPlayerIds}
    />
  )
}

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import ScorecardViewer from '@/app/components/ScorecardViewer'

export const dynamic = 'force-dynamic'

export default async function ScorecardPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const sb = createServerClient()

  const { data: team } = await sb.from('teams').select('id, name, round_id').eq('id', teamId).single()
  if (!team) redirect('/leaderboard')

  const { data: round } = await sb
    .from('rounds').select('id, balls_count, format').eq('id', team.round_id).single()
  if (!round) redirect('/leaderboard')

  const { data: players } = await sb
    .from('players').select('id, name').eq('team_id', teamId).order('name')

  const playerIds = (players ?? []).map((p) => p.id)

  const [{ data: holes }, { data: scores }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds.length ? playerIds : ['']),
  ])

  return (
    <ScorecardViewer
      teamName={team.name}
      players={players ?? []}
      holes={holes ?? []}
      scores={scores ?? []}
      ballsCount={round.balls_count}
      format={round.format ?? 'standard'}
    />
  )
}

import { createServerClient } from '@/lib/supabase-server'
import PlayerScorecard from '@/app/components/PlayerScorecard'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function PlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const sb = createServerClient()

  const { data: player } = await sb
    .from('players').select('id, name, team_id').eq('id', playerId).single()
  if (!player) redirect('/')

  const { data: team } = await sb
    .from('teams').select('id, name, round_id').eq('id', player.team_id).single()
  if (!team) redirect('/')

  const { data: round } = await sb
    .from('rounds').select('id, is_started').eq('id', team.round_id).single()
  if (!round || !round.is_started) redirect('/')

  const [{ data: holes }, { data: scores }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('hole_number, strokes').eq('player_id', playerId),
  ])

  return (
    <PlayerScorecard
      player={{ id: player.id, name: player.name }}
      teamName={team.name}
      teamId={team.id}
      holes={holes ?? []}
      scores={scores ?? []}
    />
  )
}

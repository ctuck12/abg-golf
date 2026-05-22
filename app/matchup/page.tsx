import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import MatchupClient from '@/app/components/MatchupClient'

export const dynamic = 'force-dynamic'

export default async function MatchupPage() {
  const sb = createServerClient()

  const { data: round } = await sb
    .from('rounds')
    .select('id, name, balls_count, is_started')
    .eq('is_active', true)
    .single()

  if (!round || !round.is_started) redirect('/')

  const { data: teams } = await sb
    .from('teams').select('id, name').eq('round_id', round.id).order('name')
  const teamIds = (teams ?? []).map((t) => t.id)

  const [{ data: playersRaw }, { data: holes }, { data: scores }] = await Promise.all([
    teamIds.length
      ? sb.from('players').select('id, name, team_id').in('team_id', teamIds).order('name')
      : Promise.resolve({ data: [] }),
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes'),
  ])

  // Attach team name to each player
  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]))
  const players = (playersRaw ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    teamName: teamMap[p.team_id] ?? '',
  }))

  return (
    <MatchupClient
      players={players}
      holes={holes ?? []}
      scores={scores ?? []}
      roundName={round.name}
    />
  )
}

import { createServerClient } from '@/lib/supabase-server'
import PlayerScorecard from '@/app/components/PlayerScorecard'
import { redirect } from 'next/navigation'
import type { DaytonaHoleAssignment } from '@/lib/scoring'

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
    .from('rounds').select('id, is_started, format').eq('id', team.round_id).single()
  if (!round || !round.is_started) redirect('/')

  const [{ data: holes }, { data: scores }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('hole_number, strokes').eq('player_id', playerId),
  ])

  let dtData: {
    roundId: string
    allPlayerIds: string[]
    assignments: DaytonaHoleAssignment[]
    allRoundScores: { player_id: string; hole_number: number; strokes: number }[]
  } | undefined

  if ((round.format ?? 'standard') === 'daytona') {
    const { data: allTeams } = await sb.from('teams').select('id').eq('round_id', round.id)
    const teamIds = (allTeams ?? []).map((t: { id: string }) => t.id)
    const { data: allPlayers } = await sb.from('players').select('id').in('team_id', teamIds)
    const allPlayerIds = (allPlayers ?? []).map((p: { id: string }) => p.id)
    const [{ data: assignmentsData }, { data: allScoresData }] = await Promise.all([
      sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id),
      sb.from('scores').select('player_id, hole_number, strokes').in('player_id', allPlayerIds),
    ])
    dtData = {
      roundId: round.id,
      allPlayerIds,
      assignments: (assignmentsData ?? []) as DaytonaHoleAssignment[],
      allRoundScores: allScoresData ?? [],
    }
  }

  return (
    <PlayerScorecard
      player={{ id: player.id, name: player.name }}
      teamName={team.name}
      teamId={team.id}
      holes={holes ?? []}
      scores={scores ?? []}
      format={round.format ?? 'standard'}
      dtData={dtData}
    />
  )
}

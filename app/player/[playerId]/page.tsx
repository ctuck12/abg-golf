import { createServerClient } from '@/lib/supabase-server'
import PlayerScorecard from '@/app/components/PlayerScorecard'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import type { DaytonaHoleAssignment } from '@/lib/scoring'

export const dynamic = 'force-dynamic'

export default async function PlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const cookieStore = await cookies()
  const isAdmin = cookieStore.get('admin_auth')?.value === 'true'
  const sb = createServerClient()

  const { data: player } = await sb
    .from('players').select('id, name, team_id').eq('id', playerId).single()
  if (!player) redirect('/')

  const { data: team } = await sb
    .from('teams').select('id, name, round_id, daytona_variant').eq('id', player.team_id).single()
  if (!team) redirect('/')

  const { data: round } = await sb
    .from('rounds').select('id, is_started, format, daytona_variant').eq('id', team.round_id).single()
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
    daytonaVariant?: string
  } | undefined

  if ((round.format ?? 'standard') === 'daytona') {
    // Scope to the player's own group only — other groups' assignments and scores
    // must not bleed into this player's point calculations.
    const { data: teamPlayers } = await sb.from('players').select('id').eq('team_id', team!.id)
    const teamPlayerIds = (teamPlayers ?? []).map((p: { id: string }) => p.id)
    const [{ data: assignmentsData }, { data: allScoresData }] = await Promise.all([
      teamPlayerIds.length
        ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id).in('player_id', teamPlayerIds)
        : Promise.resolve({ data: [] }),
      teamPlayerIds.length
        ? sb.from('scores').select('player_id, hole_number, strokes').in('player_id', teamPlayerIds)
        : Promise.resolve({ data: [] }),
    ])
    dtData = {
      roundId: round.id,
      allPlayerIds: teamPlayerIds,
      assignments: (assignmentsData ?? []) as DaytonaHoleAssignment[],
      allRoundScores: allScoresData ?? [],
      daytonaVariant: (team as { daytona_variant?: string | null }).daytona_variant ?? '4man',
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
      isAdmin={isAdmin}
    />
  )
}

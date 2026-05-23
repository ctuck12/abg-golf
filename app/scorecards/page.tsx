import { createServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import AllScorecardsView from '@/app/components/AllScorecardsView'
import { computePlayerDaytonaPoints, type DaytonaHoleAssignment } from '@/lib/scoring'

export const dynamic = 'force-dynamic'

export default async function AllScorecardsPage() {
  const sb = createServerClient()

  const { data: round } = await sb
    .from('rounds')
    .select('id, format, daytona_variant')
    .eq('is_active', true)
    .single()

  if (!round || round.format !== 'daytona') redirect('/')

  const { data: teams } = await sb.from('teams').select('id, name').eq('round_id', round.id)
  const teamIds = (teams ?? []).map((t: { id: string }) => t.id)

  const { data: players } = await sb
    .from('players').select('id, name, team_id').in('team_id', teamIds)
  const playerIds = (players ?? []).map((p: { id: string }) => p.id)

  const [{ data: holes }, { data: scores }, { data: assignments }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds),
    sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id),
  ])

  const daytonaVariant = round.daytona_variant ?? '4man'
  const pointsMap = computePlayerDaytonaPoints(
    holes ?? [],
    scores ?? [],
    (assignments ?? []) as DaytonaHoleAssignment[],
    daytonaVariant
  )

  const teamNameMap = Object.fromEntries((teams ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))

  const rankedPlayers = (players ?? [])
    .map((p: { id: string; name: string; team_id: string }) => ({
      id: p.id,
      name: p.name,
      teamName: teamNameMap[p.team_id] ?? '',
      points: pointsMap.get(p.id) ?? 0,
      thru: (scores ?? []).filter((s: { player_id: string }) => s.player_id === p.id).length,
    }))
    .sort((a: { thru: number; points: number; name: string }, b: { thru: number; points: number; name: string }) => {
      if (a.thru === 0 && b.thru === 0) return a.name.localeCompare(b.name)
      if (a.thru === 0) return 1
      if (b.thru === 0) return -1
      return b.points - a.points
    })

  return (
    <AllScorecardsView
      roundId={round.id}
      players={rankedPlayers}
      allPlayerIds={playerIds}
      holes={holes ?? []}
      initialScores={scores ?? []}
      initialAssignments={(assignments ?? []) as DaytonaHoleAssignment[]}
      daytonaVariant={daytonaVariant}
    />
  )
}

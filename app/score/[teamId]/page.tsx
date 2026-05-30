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

  const { data: team } = await sb.from('teams').select('id, name, round_id, is_admin, daytona_variant').eq('id', teamId).single()
  if (!team) redirect('/')

  const { data: round } = await sb
    .from('rounds').select('id, balls_count, format, daytona_variant, is_active, include_total').eq('id', team.round_id).single()
  if (!round || !round.is_active) redirect('/')

  const { data: players } = await sb
    .from('players').select('id, name').eq('team_id', teamId).order('position', { ascending: true })

  const playerIds = (players ?? []).map((p) => p.id)

  const isDaytona = (round.format ?? 'standard') === 'daytona'
  const isTraditional = (round.format ?? 'standard') === 'traditional'
  const teamDaytonaRaw = (team as { daytona_variant?: string | null }).daytona_variant ?? null
  const isDaytonaSideGame = isTraditional && !!teamDaytonaRaw
  const [parsedDaytonaVariant, parsedPayoutStr] = teamDaytonaRaw?.includes('|')
    ? teamDaytonaRaw.split('|') : [teamDaytonaRaw ?? '4man', null]
  const sideGamePayout = parsedPayoutStr ? (parseFloat(parsedPayoutStr) || 0) : 0

  const { data: allTeams } = await sb.from('teams').select('id').eq('round_id', team.round_id)
  const allTeamIds = (allTeams ?? []).map((t) => t.id)
  const { data: allRoundPlayers } = await sb
    .from('players').select('id').in('team_id', allTeamIds.length ? allTeamIds : [''])
  const roundPlayerIds = (allRoundPlayers ?? []).map((p) => p.id)

  const [{ data: holes }, { data: scores }, { data: assignments }, { data: ballValuesRaw }, { data: holeValuesRaw }] = await Promise.all([
    sb.from('holes').select('hole_number, par').eq('round_id', round.id).order('hole_number'),
    sb.from('scores').select('player_id, hole_number, strokes').in('player_id', playerIds.length ? playerIds : ['']),
    (isDaytona || isDaytonaSideGame) && playerIds.length
      ? sb.from('daytona_hole_assignments').select('player_id, hole_number, side').eq('round_id', round.id).in('player_id', playerIds)
      : Promise.resolve({ data: [] }),
    isDaytona ? sb.from('ball_values').select('ball_number, value_dollars').eq('round_id', round.id).order('ball_number') : Promise.resolve({ data: [] }),
    (isDaytona || isDaytonaSideGame) ? sb.from('daytona_hole_values').select('hole_number, value_per_point').eq('round_id', round.id).eq('team_id', team.id) : Promise.resolve({ data: [] }),
  ])
  const defaultDtPayoutValue = isDaytonaSideGame
    ? sideGamePayout
    : (isDaytona ? (ballValuesRaw ?? []).find((bv: { ball_number: number }) => bv.ball_number === 1) : null)?.value_dollars ?? 0.25
  const initialHoleValues: Record<number, number> = {}
  for (const hv of (holeValuesRaw ?? []) as { hole_number: number; value_per_point: number }[]) {
    initialHoleValues[hv.hole_number] = hv.value_per_point
  }

  return (
    <ScoreEntry
      team={{ id: team.id, name: team.name }}
      players={players ?? []}
      holes={holes ?? []}
      initialScores={scores ?? []}
      ballsCount={round.balls_count}
      format={round.format ?? 'standard'}
      daytonaVariant={isDaytonaSideGame ? parsedDaytonaVariant : ((team as { daytona_variant?: string | null }).daytona_variant?.split('|')[0] ?? round.daytona_variant ?? '4man')}
      isDaytonaSideGame={isDaytonaSideGame}
      isAdmin={cookieStore.get('admin_auth')?.value === 'true'}
      roundId={round.id}
      initialAssignments={assignments ?? []}
      roundPlayerIds={roundPlayerIds}
      includeTotal={round.include_total ?? false}
      initialHoleValues={initialHoleValues}
      defaultDtPayoutValue={defaultDtPayoutValue}
    />
  )
}

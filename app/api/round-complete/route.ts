import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roundId = searchParams.get('roundId') ?? ''
  if (!roundId) {
    return NextResponse.json({ allDone: false })
  }

  const supabase = createServerClient()

  const [{ data: holes }, { data: teams }] = await Promise.all([
    supabase.from('holes').select('hole_number').eq('round_id', roundId),
    supabase.from('teams').select('id').eq('round_id', roundId),
  ])

  const holeCount = (holes ?? []).length
  const teamIds = (teams ?? []).map((t) => t.id)

  if (holeCount === 0 || teamIds.length === 0) {
    return NextResponse.json({ allDone: false })
  }

  const { data: players } = await supabase
    .from('players')
    .select('id, holes_range')
    .in('team_id', teamIds)

  const playerIds = (players ?? []).map((p) => p.id)
  if (playerIds.length === 0) {
    return NextResponse.json({ allDone: false })
  }

  const { data: scores } = await supabase
    .from('scores')
    .select('player_id')
    .in('player_id', playerIds)

  const scoreCountByPlayer: Record<string, number> = {}
  for (const s of scores ?? []) {
    scoreCountByPlayer[s.player_id] = (scoreCountByPlayer[s.player_id] ?? 0) + 1
  }

  // A player only needs scores for the holes their range covers
  const holeNumbers = (holes ?? []).map((h) => h.hole_number)
  const expectedFor = (range: string | null | undefined) =>
    range === 'front9' ? holeNumbers.filter((n) => n <= 9).length
    : range === 'back9' ? holeNumbers.filter((n) => n > 9).length
    : holeCount
  const allDone = (players ?? []).every((p) => (scoreCountByPlayer[p.id] ?? 0) >= expectedFor((p as { holes_range?: string | null }).holes_range))

  return NextResponse.json({ allDone })
}

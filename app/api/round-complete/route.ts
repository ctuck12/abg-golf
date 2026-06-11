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
    .select('id')
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

  const allDone = playerIds.every((id) => (scoreCountByPlayer[id] ?? 0) >= holeCount)

  return NextResponse.json({ allDone })
}

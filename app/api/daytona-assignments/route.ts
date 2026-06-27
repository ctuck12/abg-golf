import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roundId = searchParams.get('roundId') ?? ''
  const playerIdsParam = searchParams.get('playerIds') ?? ''
  const playerIds = playerIdsParam ? playerIdsParam.split(',').filter(Boolean) : []
  if (!roundId) {
    return NextResponse.json([])
  }
  const supabase = createServerClient()
  let query = supabase
    .from('daytona_hole_assignments')
    .select('player_id, hole_number, side')
    .eq('round_id', roundId)
  if (playerIds.length > 0) {
    query = query.in('player_id', playerIds)
  }
  const { data } = await query
  return NextResponse.json(data ?? [])
}

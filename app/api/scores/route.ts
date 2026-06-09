import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const playerIdsParam = searchParams.get('playerIds') ?? ''
  const playerIds = playerIdsParam ? playerIdsParam.split(',').filter(Boolean) : []
  if (playerIds.length === 0) {
    return NextResponse.json([])
  }
  const supabase = createServerClient()
  const { data } = await supabase
    .from('scores')
    .select('player_id, hole_number, strokes')
    .in('player_id', playerIds)
  return NextResponse.json(data ?? [])
}

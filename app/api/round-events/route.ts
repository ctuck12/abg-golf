import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// Audit trail for a round, newest first. Returns { events, error? } — error is
// set (and events empty) when the round_events table hasn't been created yet.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roundId = searchParams.get('roundId') ?? ''
  if (!roundId) return NextResponse.json({ events: [] })

  const sb = createServerClient()
  const { data, error } = await sb
    .from('round_events')
    .select('id, actor, action, detail, created_at')
    .eq('round_id', roundId)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ events: [], error: error.message })
  return NextResponse.json({ events: data ?? [] })
}

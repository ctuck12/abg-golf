import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  const isAdmin = cookieStore.get('admin_auth')?.value === 'true'

  const sb = createServerClient()
  const { data: round } = await sb
    .from('rounds')
    .select('id')
    .eq('is_active', true)
    .single()

  if (!round) {
    return NextResponse.json({ isAdmin, scorecardTeamId: null })
  }

  const { data: teams } = await sb
    .from('teams')
    .select('id')
    .eq('round_id', round.id)

  const authTeam = (teams ?? []).find(
    (t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true'
  )

  return NextResponse.json({ isAdmin, scorecardTeamId: authTeam?.id ?? null })
}

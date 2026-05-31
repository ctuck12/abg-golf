import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const orgId = searchParams.get('orgId')

  const cookieStore = await cookies()
  const isMaster = cookieStore.get('master_auth')?.value === 'true'
  const isAdmin = isMaster || (orgId ? cookieStore.get(`org_admin_${orgId}`)?.value === 'true' : false)

  const sb = createServerClient()

  const roundQuery = sb.from('rounds').select('id').eq('is_active', true)
  if (orgId) roundQuery.eq('org_id', orgId)
  const { data: round } = await roundQuery.single()

  if (!round) {
    return NextResponse.json({ isAdmin, scorecardTeamId: null })
  }

  const { data: teams } = await sb.from('teams').select('id').eq('round_id', round.id)
  const authTeam = (teams ?? []).find(
    (t) => cookieStore.get(`team_auth_${t.id}`)?.value === 'true'
  )

  return NextResponse.json({ isAdmin, scorecardTeamId: authTeam?.id ?? null })
}

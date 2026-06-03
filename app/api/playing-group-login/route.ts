import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const { groupId, pin } = await request.json()
  if (!groupId || !pin) return NextResponse.json({ error: 'Select your group and enter your PIN.' }, { status: 400 })

  const sb = createServerClient()
  const { data: group } = await sb.from('playing_groups').select('id, pin, round_id').eq('id', groupId).single()

  if (!group || group.pin !== pin.trim()) {
    return NextResponse.json({ error: 'Incorrect PIN. Try again.' }, { status: 401 })
  }

  // Resolve orgId so we can set the org_member cookie (required for leaderboard access)
  const { data: round } = await sb.from('rounds').select('org_id').eq('id', group.round_id).single()

  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, maxAge: 60 * 60 * 24, path: '/' }
  const response = NextResponse.json({ success: true, groupId })
  response.cookies.set(`playing_group_auth_${groupId}`, 'true', cookieOpts)
  if (round?.org_id) {
    response.cookies.set(`org_member_${round.org_id}`, 'true', cookieOpts)
  }
  return response
}

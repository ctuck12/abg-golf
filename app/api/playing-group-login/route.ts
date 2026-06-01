import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const { groupId, pin } = await request.json()
  if (!groupId || !pin) return NextResponse.json({ error: 'Select your group and enter your PIN.' }, { status: 400 })

  const sb = createServerClient()
  const { data: group } = await sb.from('playing_groups').select('id, pin').eq('id', groupId).single()

  if (!group || group.pin !== pin.trim()) {
    return NextResponse.json({ error: 'Incorrect PIN. Try again.' }, { status: 401 })
  }

  const response = NextResponse.json({ success: true, groupId })
  response.cookies.set(`playing_group_auth_${groupId}`, 'true', {
    httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24, path: '/',
  })
  return response
}

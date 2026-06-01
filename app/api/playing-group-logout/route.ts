import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { groupId } = await request.json().catch(() => ({}))
  const response = NextResponse.json({ success: true })
  if (groupId) {
    response.cookies.set(`playing_group_auth_${groupId}`, '', { httpOnly: true, sameSite: 'lax', maxAge: 0, path: '/' })
  }
  return response
}

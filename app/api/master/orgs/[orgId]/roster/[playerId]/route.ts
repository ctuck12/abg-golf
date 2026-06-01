import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string; playerId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { playerId } = await params
  const { name, ghin_number, handicap_index, email } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  const sb = createServerClient()
  const { error } = await sb.from('org_players').update({
    name: name.trim(),
    ghin_number: ghin_number || null,
    handicap_index: handicap_index ?? null,
    email: email || null,
  }).eq('id', playerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ orgId: string; playerId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { playerId } = await params
  const sb = createServerClient()
  const { error } = await sb.from('org_players').delete().eq('id', playerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

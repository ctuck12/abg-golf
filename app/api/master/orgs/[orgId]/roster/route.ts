import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await params
  const sb = createServerClient()
  const { data, error } = await sb.from('org_players').select('id, name, ghin_number, handicap_index, email').eq('org_id', orgId).order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ players: data ?? [] })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await params
  const { name, ghin_number, handicap_index, email } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  const sb = createServerClient()
  const { data, error } = await sb.from('org_players')
    .insert({ org_id: orgId, name: name.trim(), ghin_number: ghin_number || null, handicap_index: handicap_index ?? null, email: email || null })
    .select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, id: data.id })
}

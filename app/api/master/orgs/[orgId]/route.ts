import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await params
  const body = await request.json()
  const updates: Record<string, unknown> = {}
  if (body.name) updates.name = body.name
  if (body.slug) updates.slug = body.slug
  if (body.group_password) updates.group_password = body.group_password
  if (body.admin_password) updates.admin_password = body.admin_password
  if (body.is_active !== undefined) updates.is_active = body.is_active

  const sb = createServerClient()
  const { error } = await sb.from('organizations').update(updates).eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await params
  const sb = createServerClient()
  const { error } = await sb.from('organizations').delete().eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

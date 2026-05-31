import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { courseId } = await params
  const { name, pars } = await request.json()
  const updates: Record<string, unknown> = {}
  if (name) updates.name = name
  if (Array.isArray(pars) && pars.length === 18) updates.pars = JSON.stringify(pars)
  const sb = createServerClient()
  const { error } = await sb.from('courses').update(updates).eq('id', courseId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { courseId } = await params
  const sb = createServerClient()
  const { error } = await sb.from('courses').delete().eq('id', courseId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

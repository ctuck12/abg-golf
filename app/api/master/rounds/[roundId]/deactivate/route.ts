import { NextRequest, NextResponse } from 'next/server'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  if (!(await requireMasterAuth())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { roundId } = await params
  const sb = createServerClient()
  const { error } = await sb.from('rounds').update({ is_active: false }).eq('id', roundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

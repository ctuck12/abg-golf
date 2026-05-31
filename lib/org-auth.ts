import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'

export type OrgAuthResult =
  | { ok: false }
  | { ok: true; orgId: string; isAdmin: boolean; isMaster: boolean }

export async function getOrgAuth(slug: string): Promise<OrgAuthResult> {
  const cookieStore = await cookies()
  const isMaster = cookieStore.get('master_auth')?.value === 'true'

  const sb = createServerClient()
  const { data: org } = await sb
    .from('organizations')
    .select('id, is_active')
    .eq('slug', slug)
    .single()

  if (!org || !org.is_active) return { ok: false }

  if (isMaster) return { ok: true, orgId: org.id, isAdmin: true, isMaster: true }

  const isAdmin = cookieStore.get(`org_admin_${org.id}`)?.value === 'true'
  const isMember = cookieStore.get(`org_member_${org.id}`)?.value === 'true'

  if (!isAdmin && !isMember) return { ok: false }
  return { ok: true, orgId: org.id, isAdmin, isMaster: false }
}

export async function requireMasterAuth(): Promise<boolean> {
  const cookieStore = await cookies()
  return cookieStore.get('master_auth')?.value === 'true'
}

export function orgCookieOpts(maxAge = 60 * 60 * 24 * 7) {
  return { httpOnly: true, sameSite: 'lax' as const, maxAge, path: '/' }
}

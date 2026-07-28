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

// ── Server-action guards ──────────────────────────────────────────────────────
// Server actions are reachable by direct POST, not just through the UI, so
// every mutating action verifies a login cookie itself. Each returns an error
// message for the caller, or null when authorized.

const AUTH_ERROR = 'Not authorized. Please sign in again.'

// Master, legacy admin, or an org admin login.
export async function requireAdminAuth(): Promise<string | null> {
  const store = await cookies()
  const ok = store.getAll().some((c) => c.value && (
    c.name === 'master_auth' || c.name === 'admin_auth' || c.name.startsWith('org_admin_')
  ))
  return ok ? null : AUTH_ERROR
}

// Any signed-in identity: master/org admin, org member, or a team /
// playing-group scorekeeper login. For actions that members and scorekeepers
// legitimately call mid-round (matchups, presses, banker, hole strokes).
export async function requireAnyLogin(): Promise<string | null> {
  const store = await cookies()
  const ok = store.getAll().some((c) => c.value && (
    c.name === 'master_auth' || c.name === 'admin_auth' ||
    c.name.startsWith('org_admin_') || c.name.startsWith('org_member_') ||
    c.name.startsWith('team_auth_') || c.name.startsWith('playing_group_auth_')
  ))
  return ok ? null : AUTH_ERROR
}

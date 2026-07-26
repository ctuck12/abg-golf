import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import MasterLanding from '@/app/components/MasterLanding'

export const dynamic = 'force-dynamic'

export default async function RootPage() {
  const cookieStore = await cookies()
  const isMaster = cookieStore.get('master_auth')?.value === 'true'

  if (isMaster) redirect('/master/dashboard')

  const sb = createServerClient()
  const { data: orgs } = await sb
    .from('organizations')
    .select('id, name, slug, is_active')
    .order('name')

  // A cold PWA launch always lands on "/" — if the user still has a session
  // with a group, send them straight back instead of showing the org picker.
  const hasOrgSession = (o: { id: string }) =>
    cookieStore.get(`org_admin_${o.id}`)?.value === 'true' || cookieStore.get(`org_member_${o.id}`)?.value === 'true'
  const lastOrgSlug = cookieStore.get('last_org')?.value
  const lastOrg = (orgs ?? []).find((o) => o.slug === lastOrgSlug && o.is_active)
  if (lastOrg && hasOrgSession(lastOrg)) redirect(`/${lastOrg.slug}`)
  const authedOrgs = (orgs ?? []).filter((o) => o.is_active && hasOrgSession(o))
  if (authedOrgs.length === 1) redirect(`/${authedOrgs[0].slug}`)

  return <MasterLanding orgs={orgs ?? []} />
}

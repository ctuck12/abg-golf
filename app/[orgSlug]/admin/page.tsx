import { redirect } from 'next/navigation'
import { getOrgAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import OrgAdminLoginForm from '@/app/components/OrgAdminLoginForm'

export const dynamic = 'force-dynamic'

export default async function OrgAdminPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const auth = await getOrgAuth(orgSlug)
  if (auth.ok && auth.isAdmin) redirect(`/${orgSlug}/admin/dashboard`)

  const sb = createServerClient()
  const { data: org } = await sb
    .from('organizations').select('name').eq('slug', orgSlug).single()

  return <OrgAdminLoginForm orgSlug={orgSlug} orgName={org?.name ?? orgSlug} />
}

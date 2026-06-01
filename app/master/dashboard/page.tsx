import { redirect } from 'next/navigation'
import { requireMasterAuth } from '@/lib/org-auth'
import { createServerClient } from '@/lib/supabase-server'
import MasterDashboard from '@/app/components/MasterDashboard'

export const dynamic = 'force-dynamic'

export default async function MasterDashboardPage() {
  if (!(await requireMasterAuth())) redirect('/')

  const sb = createServerClient()
  const [{ data: orgs }, { data: courses }, { data: activeRounds }] = await Promise.all([
    sb.from('organizations').select('id, name, slug, is_active, created_at').order('name'),
    sb.from('courses').select('id, name, slug, pars, stroke_indexes, is_active').order('name'),
    sb.from('rounds')
      .select('id, name, date, course, format, is_started, org_id')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  ])

  return (
    <MasterDashboard
      orgs={orgs ?? []}
      courses={courses ?? []}
      activeRounds={activeRounds ?? []}
    />
  )
}

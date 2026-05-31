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

  return <MasterLanding orgs={orgs ?? []} />
}

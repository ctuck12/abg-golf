import { redirect } from 'next/navigation'
import { getOrgAuth } from '@/lib/org-auth'

export const dynamic = 'force-dynamic'

// /[orgSlug]/leaderboard → canonical home is /[orgSlug]
export default async function OrgLeaderboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const auth = await getOrgAuth(orgSlug)
  if (!auth.ok) redirect(`/${orgSlug}`)
  redirect(`/${orgSlug}`)
}

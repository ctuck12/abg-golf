import LastOrgCookie from '@/app/components/LastOrgCookie'

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  return (
    <>
      <LastOrgCookie slug={orgSlug} />
      {children}
    </>
  )
}

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import AdminLoginForm from '@/app/components/AdminLoginForm'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const cookieStore = await cookies()
  if (cookieStore.get('admin_auth')?.value) redirect('/admin/dashboard')
  return <AdminLoginForm />
}

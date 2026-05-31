'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const navy = '#0f172a'
const gold = '#f59e0b'

export default function OrgAdminLoginForm({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setPending(true)
    try {
      const res = await fetch('/api/org-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: orgSlug, password }),
      })
      const data = await res.json()
      if (data.success && data.isAdmin) {
        router.push(`/${orgSlug}/admin/dashboard`)
      } else if (data.success) {
        setError('This password is for group access only, not admin access.')
      } else {
        setError(data.error ?? 'Incorrect password.')
      }
    } catch {
      setError('Network error.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
      <header className="text-white py-8 px-4 text-center shadow-md" style={{ background: navy }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: gold }}>
          {orgName}
        </p>
        <h1 className="text-2xl font-bold">Admin Login</h1>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 pt-12">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Admin Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Admin password"
                  required
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="w-full text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                style={{ background: navy }}
              >
                {pending ? 'Verifying…' : 'Sign In →'}
              </button>
            </form>
          </div>
          <a href={`/${orgSlug}`} className="block text-center text-xs text-gray-400 hover:text-gray-600 py-3">
            ← Back to {orgName}
          </a>
        </div>
      </main>
    </div>
  )
}

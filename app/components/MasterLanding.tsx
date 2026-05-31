'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Org = { id: string; name: string; slug: string; is_active: boolean }

const navy = '#0f172a'
const gold = '#f59e0b'

export default function MasterLanding({ orgs }: { orgs: Org[] }) {
  const router = useRouter()
  const [showMasterLogin, setShowMasterLogin] = useState(false)
  const [masterPassword, setMasterPassword] = useState('')
  const [masterError, setMasterError] = useState('')
  const [masterPending, setMasterPending] = useState(false)

  async function handleMasterLogin(e: React.FormEvent) {
    e.preventDefault()
    setMasterError('')
    setMasterPending(true)
    try {
      const res = await fetch('/api/master-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: masterPassword }),
      })
      const data = await res.json()
      if (data.success) {
        router.push('/master/dashboard')
      } else {
        setMasterError(data.error ?? 'Incorrect password.')
      }
    } catch {
      setMasterError('Network error.')
    } finally {
      setMasterPending(false)
    }
  }

  const activeOrgs = orgs.filter((o) => o.is_active)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
      <header className="text-white py-8 px-4 text-center shadow-md" style={{ background: navy }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: gold }}>
          Anything But Golf
        </p>
        <h1 className="text-2xl font-bold">Golf Scoring</h1>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 pt-10">
        <div className="w-full max-w-sm space-y-4">

          {activeOrgs.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center">
              <p className="text-gray-500 text-sm">No groups available yet.</p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Select Your Group</p>
              <div className="space-y-2">
                {activeOrgs.map((org) => (
                  <a
                    key={org.id}
                    href={`/${org.slug}`}
                    className="flex items-center justify-between w-full px-4 py-3.5 rounded-xl font-semibold text-sm transition active:scale-95 bg-white border border-gray-200 text-gray-900 hover:border-gray-400"
                  >
                    {org.name}
                    <span style={{ color: gold }}>→</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {!showMasterLogin ? (
            <button
              type="button"
              onClick={() => setShowMasterLogin(true)}
              className="w-full py-3 rounded-xl font-semibold text-sm border-2 transition active:scale-95"
              style={{ borderColor: navy, color: navy, background: 'white' }}
            >
              Master Admin Login
            </button>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 text-sm">Master Admin</h2>
                <button onClick={() => setShowMasterLogin(false)} className="text-gray-400 text-lg leading-none">✕</button>
              </div>
              <form onSubmit={handleMasterLogin} className="space-y-3">
                {masterError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{masterError}</p>
                )}
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  placeholder="Master password"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={masterPending}
                  className="w-full text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition"
                  style={{ background: navy }}
                >
                  {masterPending ? 'Verifying…' : 'Sign In →'}
                </button>
              </form>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

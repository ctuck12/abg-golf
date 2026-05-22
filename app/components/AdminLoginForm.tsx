'use client'

import { useActionState, useEffect } from 'react'
import { adminLogin } from '@/app/actions'

const navy = '#0f172a'
const gold = '#f59e0b'

export default function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLogin, null)

  useEffect(() => {
    if (state && 'success' in state && state.success) {
      window.location.href = '/admin/dashboard'
    }
  }, [state])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f8fafc' }}>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold mb-1" style={{ color: navy }}>Admin Login</h1>
        <p className="text-sm text-gray-500 mb-6">Anything But Golf Group</p>
        <form action={action} className="space-y-4">
          {state && 'error' in state && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{state.error}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              name="password"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none"
              placeholder="Admin password"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full text-white py-3 rounded-xl font-semibold transition disabled:opacity-60"
            style={{ background: navy }}
          >
            {pending ? 'Verifying…' : 'Enter Admin →'}
          </button>
        </form>
        <div className="mt-5 text-center">
          <a href="/" className="text-sm font-medium" style={{ color: gold }}>← Back to Home</a>
        </div>
      </div>
    </div>
  )
}

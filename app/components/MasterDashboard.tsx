'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const navy = '#0f172a'
const gold = '#f59e0b'

type Org = { id: string; name: string; slug: string; is_active: boolean; created_at: string }
type Course = { id: string; name: string; slug: string; pars: number[]; is_active: boolean }
type ActiveRound = { id: string; name: string; date: string; course: string; format: string; is_started: boolean; org_id: string }

export default function MasterDashboard({
  orgs, courses, activeRounds,
}: {
  orgs: Org[]
  courses: Course[]
  activeRounds: ActiveRound[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'groups' | 'courses' | 'rounds'>('groups')

  // Org form state
  const [showOrgForm, setShowOrgForm] = useState(false)
  const [editingOrg, setEditingOrg] = useState<Org | null>(null)
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [orgGroupPw, setOrgGroupPw] = useState('')
  const [orgAdminPw, setOrgAdminPw] = useState('')
  const [orgError, setOrgError] = useState('')
  const [showGroupPw, setShowGroupPw] = useState(false)
  const [showAdminPw, setShowAdminPw] = useState(false)
  const [orgPending, setOrgPending] = useState(false)

  // Course form state
  const [showCourseForm, setShowCourseForm] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [courseName, setCourseName] = useState('')
  const [courseSlug, setCourseSlug] = useState('')
  const [coursePars, setCoursePars] = useState<string>(Array(18).fill('4').join(','))
  const [courseError, setCourseError] = useState('')
  const [coursePending, setCoursePending] = useState(false)

  const [signOutPending, setSignOutPending] = useState(false)
  const [confirmOrgModal, setConfirmOrgModal] = useState<{ action: 'delete' | 'deactivate'; org: Org } | null>(null)
  const [confirmCourseModal, setConfirmCourseModal] = useState<Course | null>(null)
  const [confirmRoundModal, setConfirmRoundModal] = useState<ActiveRound | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState('')

  async function signOut() {
    setSignOutPending(true)
    await fetch('/api/master-logout', { method: 'POST' })
    router.push('/')
  }

  function openNewOrg() {
    setEditingOrg(null)
    setOrgName(''); setOrgSlug(''); setOrgGroupPw(''); setOrgAdminPw(''); setOrgError('')
    setShowOrgForm(true)
  }
  function openEditOrg(org: Org) {
    setEditingOrg(org)
    setOrgName(org.name); setOrgSlug(org.slug); setOrgGroupPw(''); setOrgAdminPw(''); setOrgError('')
    setShowOrgForm(true)
  }

  async function submitOrg(e: React.FormEvent) {
    e.preventDefault()
    setOrgError(''); setOrgPending(true)
    try {
      const url = editingOrg ? `/api/master/orgs/${editingOrg.id}` : '/api/master/orgs'
      const body: Record<string, string> = { name: orgName, slug: orgSlug }
      if (orgGroupPw) body.group_password = orgGroupPw
      if (orgAdminPw) body.admin_password = orgAdminPw
      if (!editingOrg) { body.group_password = orgGroupPw; body.admin_password = orgAdminPw }
      const res = await fetch(url, { method: editingOrg ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.error) { setOrgError(data.error); return }
      setShowOrgForm(false); router.refresh()
    } catch { setOrgError('Network error.') }
    finally { setOrgPending(false) }
  }

  async function toggleOrgActive(org: Org) {
    setActionError(''); setActionPending(true)
    try {
      await fetch(`/api/master/orgs/${org.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !org.is_active }) })
      router.refresh()
    } catch { setActionError('Failed to update group.') }
    finally { setActionPending(false) }
  }


  async function deleteOrg(orgId: string) {
    setActionError(''); setActionPending(true)
    try {
      const res = await fetch(`/api/master/orgs/${orgId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) { setActionError(data.error); return }
      setConfirmOrgModal(null); router.refresh()
    } catch { setActionError('Failed to delete group.') }
    finally { setActionPending(false) }
  }

  async function confirmOrgAction() {
    if (!confirmOrgModal) return
    if (confirmOrgModal.action === 'delete') {
      await deleteOrg(confirmOrgModal.org.id)
    } else {
      await toggleOrgActive(confirmOrgModal.org)
      setConfirmOrgModal(null)
    }
  }

  function openNewCourse() {
    setEditingCourse(null)
    setCourseName(''); setCourseSlug(''); setCoursePars(Array(18).fill('4').join(',')); setCourseError('')
    setShowCourseForm(true)
  }
  function openEditCourse(c: Course) {
    setEditingCourse(c)
    setCourseName(c.name); setCourseSlug(c.slug)
    setCoursePars(Array.isArray(c.pars) ? c.pars.join(',') : String(c.pars))
    setCourseError(''); setShowCourseForm(true)
  }

  async function submitCourse(e: React.FormEvent) {
    e.preventDefault()
    setCourseError(''); setCoursePending(true)
    try {
      const pars = coursePars.split(',').map((p) => parseInt(p.trim())).filter((p) => !isNaN(p))
      if (pars.length !== 18) { setCourseError('Enter exactly 18 par values separated by commas.'); setCoursePending(false); return }
      const url = editingCourse ? `/api/master/courses/${editingCourse.id}` : '/api/master/courses'
      const res = await fetch(url, { method: editingCourse ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: courseName, slug: courseSlug, pars }) })
      const data = await res.json()
      if (data.error) { setCourseError(data.error); return }
      setShowCourseForm(false); router.refresh()
    } catch { setCourseError('Network error.') }
    finally { setCoursePending(false) }
  }

  async function deleteCourse(courseId: string) {
    setActionError(''); setActionPending(true)
    try {
      await fetch(`/api/master/courses/${courseId}`, { method: 'DELETE' })
      setConfirmCourseModal(null); router.refresh()
    } catch { setActionError('Failed to delete course.') }
    finally { setActionPending(false) }
  }

  async function forceDeactivateRound(roundId: string) {
    setActionError(''); setActionPending(true)
    try {
      await fetch(`/api/master/rounds/${roundId}/deactivate`, { method: 'POST' })
      setConfirmRoundModal(null); router.refresh()
    } catch { setActionError('Failed to deactivate round.') }
    finally { setActionPending(false) }
  }

  async function enterAsAdmin(org: Org) {
    // Log into the org as admin (master auth already set, this just grants org_admin cookie too)
    await fetch('/api/org-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: org.slug, _masterOverride: true }),
    })
    router.push(`/${org.slug}/admin/dashboard`)
  }

  const orgMap = Object.fromEntries(orgs.map((o) => [o.id, o]))

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {/* Header */}
      <header className="text-white px-4 py-4 shadow-md sticky top-0 z-10" style={{ background: navy }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest font-bold" style={{ color: gold }}>Master Admin</p>
            <h1 className="font-bold text-lg">Dashboard</h1>
          </div>
          <button
            onClick={signOut}
            disabled={signOutPending}
            className="text-xs px-3 py-1.5 rounded-lg border font-medium"
            style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#d1d5db' }}
          >
            {signOutPending ? 'Signing out…' : 'Sign Out'}
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-5 pb-16 space-y-5">
        {actionError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</p>
        )}

        {/* Tabs */}
        <div className="flex gap-2 bg-white rounded-xl border border-gray-200 p-1">
          {(['groups', 'courses', 'rounds'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${tab === t ? 'text-white' : 'text-gray-500'}`}
              style={tab === t ? { background: navy } : {}}
            >
              {t === 'groups' ? 'Groups' : t === 'courses' ? 'Courses' : 'Active Rounds'}
            </button>
          ))}
        </div>

        {/* ── GROUPS ── */}
        {tab === 'groups' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Groups</h2>
              <button onClick={openNewOrg} className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: gold }}>
                + New Group
              </button>
            </div>

            {showOrgForm && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h3 className="font-semibold text-gray-900 text-sm mb-3">{editingOrg ? 'Edit Group' : 'New Group'}</h3>
                <form onSubmit={submitOrg} className="space-y-3">
                  {orgError && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{orgError}</p>}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Group Name</label>
                    <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required placeholder="e.g. Anything But Golf Group" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">URL Slug</label>
                    <input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} required placeholder="e.g. abg-group" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none font-mono" />
                    <p className="text-xs text-gray-400 mt-0.5">URL: abg-golf.vercel.app/{orgSlug || '…'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Group Password {editingOrg && <span className="text-gray-400">(leave blank to keep)</span>}</label>
                      <div className="relative">
                        <input type={showGroupPw ? 'text' : 'password'} value={orgGroupPw} onChange={(e) => setOrgGroupPw(e.target.value)} required={!editingOrg} placeholder="Group login" className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none" />
                        <button type="button" tabIndex={-1} onClick={() => setShowGroupPw(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none">
                          {showGroupPw
                            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'0.875rem',height:'0.875rem'}}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'0.875rem',height:'0.875rem'}}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Admin Password {editingOrg && <span className="text-gray-400">(leave blank to keep)</span>}</label>
                      <div className="relative">
                        <input type={showAdminPw ? 'text' : 'password'} value={orgAdminPw} onChange={(e) => setOrgAdminPw(e.target.value)} required={!editingOrg} placeholder="Admin login" className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none" />
                        <button type="button" tabIndex={-1} onClick={() => setShowAdminPw(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none">
                          {showAdminPw
                            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'0.875rem',height:'0.875rem'}}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'0.875rem',height:'0.875rem'}}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={orgPending} className="flex-1 text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60" style={{ background: navy }}>
                      {orgPending ? 'Saving…' : editingOrg ? 'Save Changes' : 'Create Group'}
                    </button>
                    <button type="button" onClick={() => setShowOrgForm(false)} className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-600">Cancel</button>
                  </div>
                </form>
              </div>
            )}

            {orgs.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-6 text-center">
                <p className="text-gray-400 text-sm">No groups yet. Create one above.</p>
              </div>
            ) : (
              orgs.map((org) => {
                const orgRound = activeRounds.find((r) => r.org_id === org.id)
                return (
                  <div key={org.id} className={`bg-white rounded-xl border border-gray-200 p-4 ${!org.is_active ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900 truncate">{org.name}</p>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {org.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">/{org.slug}</p>
                        {orgRound && (
                          <p className="text-xs text-gray-500 mt-1">
                            Active round: <span className="font-medium text-gray-700">{orgRound.name}</span>
                            {' · '}{orgRound.is_started ? 'Live' : 'Setting Up'}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {org.is_active && (
                          <button
                            onClick={() => enterAsAdmin(org)}
                            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                            style={{ background: gold, color: navy }}
                          >
                            Enter as Admin
                          </button>
                        )}
                        <button onClick={() => openEditOrg(org)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 font-medium text-gray-700">Edit</button>
                        <button onClick={() => setConfirmOrgModal({ action: 'deactivate', org })} disabled={actionPending} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 font-medium text-gray-700 disabled:opacity-50">
                          {org.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button onClick={() => setConfirmOrgModal({ action: 'delete', org })} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 font-medium text-red-600">Delete</button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── COURSES ── */}
        {tab === 'courses' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Courses</h2>
              <button onClick={openNewCourse} className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: gold }}>
                + New Course
              </button>
            </div>

            {showCourseForm && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h3 className="font-semibold text-gray-900 text-sm mb-3">{editingCourse ? 'Edit Course' : 'New Course'}</h3>
                <form onSubmit={submitCourse} className="space-y-3">
                  {courseError && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{courseError}</p>}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Course Name</label>
                    <input value={courseName} onChange={(e) => setCourseName(e.target.value)} required placeholder="e.g. ACC South Course" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
                    <input value={courseSlug} onChange={(e) => setCourseSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} required placeholder="e.g. acc-south" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none font-mono" disabled={!!editingCourse} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Pars (18 values, comma-separated)</label>
                    <input value={coursePars} onChange={(e) => setCoursePars(e.target.value)} required placeholder="4,4,5,3,4,4,4,3,5,4,3,4,4,5,4,3,4,5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none font-mono" />
                    <p className="text-xs text-gray-400 mt-0.5">Total par: {coursePars.split(',').map((p) => parseInt(p.trim()) || 0).reduce((a, b) => a + b, 0)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={coursePending} className="flex-1 text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60" style={{ background: navy }}>
                      {coursePending ? 'Saving…' : editingCourse ? 'Save Changes' : 'Create Course'}
                    </button>
                    <button type="button" onClick={() => setShowCourseForm(false)} className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-600">Cancel</button>
                  </div>
                </form>
              </div>
            )}

            {courses.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-6 text-center">
                <p className="text-gray-400 text-sm">No courses yet.</p>
              </div>
            ) : (
              courses.map((c) => {
                const pars: number[] = Array.isArray(c.pars) ? c.pars : JSON.parse(String(c.pars))
                const total = pars.reduce((a, b) => a + b, 0)
                return (
                  <div key={c.id} className={`bg-white rounded-xl border border-gray-200 p-4 ${!c.is_active ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{c.name}</p>
                        <p className="text-xs text-gray-400">Par {total} · /{c.slug}</p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button onClick={() => openEditCourse(c)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 font-medium text-gray-700">Edit</button>
                        <button onClick={() => setConfirmCourseModal(c)} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 font-medium text-red-600">Delete</button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── CONFIRM ORG MODAL ── */}
        {confirmOrgModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !actionPending && setConfirmOrgModal(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900 text-base mb-2">
                {confirmOrgModal.action === 'delete' ? 'Delete Group' : confirmOrgModal.org.is_active ? 'Deactivate Group' : 'Reactivate Group'}
              </h3>
              <p className="text-sm text-gray-600 mb-5">
                {confirmOrgModal.action === 'delete'
                  ? <>Are you sure you want to permanently delete <span className="font-semibold">{confirmOrgModal.org.name}</span>? This cannot be undone.</>
                  : confirmOrgModal.org.is_active
                    ? <>Are you sure you want to deactivate <span className="font-semibold">{confirmOrgModal.org.name}</span>? Members will not be able to access the group.</>
                    : <>Are you sure you want to reactivate <span className="font-semibold">{confirmOrgModal.org.name}</span>?</>
                }
              </p>
              {actionError && <p className="text-xs text-red-600 mb-3">{actionError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmOrgModal(null)}
                  disabled={actionPending}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmOrgAction}
                  disabled={actionPending}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: confirmOrgModal.action === 'delete' ? '#dc2626' : navy }}
                >
                  {actionPending
                    ? 'Please wait…'
                    : confirmOrgModal.action === 'delete'
                      ? 'Delete'
                      : confirmOrgModal.org.is_active ? 'Deactivate' : 'Reactivate'
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONFIRM COURSE MODAL ── */}
        {confirmCourseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !actionPending && setConfirmCourseModal(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900 text-base mb-2">Delete Course</h3>
              <p className="text-sm text-gray-600 mb-5">
                Are you sure you want to permanently delete <span className="font-semibold">{confirmCourseModal.name}</span>? This cannot be undone.
              </p>
              {actionError && <p className="text-xs text-red-600 mb-3">{actionError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setConfirmCourseModal(null)} disabled={actionPending} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-600 disabled:opacity-50">Cancel</button>
                <button onClick={() => deleteCourse(confirmCourseModal.id)} disabled={actionPending} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#dc2626' }}>
                  {actionPending ? 'Please wait…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONFIRM ROUND MODAL ── */}
        {confirmRoundModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !actionPending && setConfirmRoundModal(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900 text-base mb-2">Force End Round</h3>
              <p className="text-sm text-gray-600 mb-5">
                Are you sure you want to force end <span className="font-semibold">{confirmRoundModal.name}</span>? This will immediately end the round for all players.
              </p>
              {actionError && <p className="text-xs text-red-600 mb-3">{actionError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setConfirmRoundModal(null)} disabled={actionPending} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-600 disabled:opacity-50">Cancel</button>
                <button onClick={() => forceDeactivateRound(confirmRoundModal.id)} disabled={actionPending} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#dc2626' }}>
                  {actionPending ? 'Please wait…' : 'Force End'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ACTIVE ROUNDS ── */}
        {tab === 'rounds' && (
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-900">Active Rounds</h2>
            {activeRounds.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-6 text-center">
                <p className="text-gray-400 text-sm">No active rounds across any group.</p>
              </div>
            ) : (
              activeRounds.map((r) => {
                const org = orgMap[r.org_id]
                return (
                  <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{r.name}</p>
                        <p className="text-xs text-gray-500">
                          {org?.name ?? 'Unknown group'} · {r.course} · {new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-xs mt-0.5">
                          <span className={`font-semibold ${r.is_started ? 'text-green-600' : 'text-amber-600'}`}>
                            {r.is_started ? '● Live' : '● Setting Up'}
                          </span>
                          {' · '}{r.format}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {org && (
                          <a href={`/${org.slug}`} className="text-xs px-3 py-1.5 rounded-lg font-semibold text-center" style={{ background: gold, color: navy }}>
                            View
                          </a>
                        )}
                        <button onClick={() => setConfirmRoundModal(r)} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 font-medium text-red-600">Force End</button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}

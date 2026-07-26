'use client'

import { useEffect } from 'react'

// Remembers the most recently visited group so a cold PWA launch (start_url "/")
// can return straight to it instead of showing the master org picker.
export default function LastOrgCookie({ slug }: { slug: string }) {
  useEffect(() => {
    if (slug) document.cookie = `last_org=${encodeURIComponent(slug)}; path=/; max-age=31536000; SameSite=Lax`
  }, [slug])
  return null
}

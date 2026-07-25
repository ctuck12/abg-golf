// Notifications for round events: PWA web push (VAPID) and optional email via
// Resend. Each channel no-ops silently unless its env vars are configured.

import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VAPID_PUBLIC_KEY } from '@/lib/push-keys'

// Sends a push to every subscribed device; prunes subscriptions the push
// service reports as gone (unsubscribed / uninstalled PWA).
export async function sendPushToAll(
  supabase: SupabaseClient,
  payload: { title: string; body: string; url?: string }
) {
  const publicKey = VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return
  try {
    webpush.setVapidDetails('mailto:ctuck12@gmail.com', publicKey, privateKey)
    const { data: subs } = await supabase.from('push_subscriptions').select('endpoint, subscription')
    if (!subs || subs.length === 0) return
    const body = JSON.stringify(payload)
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription as webpush.PushSubscription, body)
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        }
      }
    }))
  } catch (e) {
    console.error('[notify] push failed:', e)
  }
}

export async function sendFirstScoreEmail(opts: {
  orgName: string
  roundName: string
  scorerLabel: string
  holeNumber: number
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const to = process.env.SCORE_NOTIFY_EMAIL || 'ctuck12@gmail.com'
  const { orgName, roundName, scorerLabel, holeNumber } = opts
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: 'ABG Golf <onboarding@resend.dev>',
        to: [to],
        subject: `⛳ ${orgName}: first scores are in for ${roundName}`,
        html: `<p><strong>${orgName}</strong> just entered the first scores of <strong>${roundName}</strong>.</p>
<p>${scorerLabel} saved hole ${holeNumber}.</p>`,
      }),
    })
  } catch (e) {
    console.error('[notify] first-score email failed:', e)
  }
}

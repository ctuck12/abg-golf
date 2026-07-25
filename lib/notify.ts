// Email notifications via Resend (https://resend.com).
// No-ops silently unless RESEND_API_KEY is set in the environment.

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

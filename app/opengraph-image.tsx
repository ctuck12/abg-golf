import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The card messaging apps and Slack show when someone shares the link.
// Generated rather than shipped as a file so the wording tracks the app.
export const alt = 'Anything But Golf Scoring — live scoring for the Saturday group'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const navy = '#0f172a'
const gold = '#f59e0b'

export default async function Image() {
  // process.cwd() is the project root; the mark is the small one on purpose,
  // 320px is plenty at this size and keeps the inlined data URL modest.
  const mark = await readFile(join(process.cwd(), 'public', 'abg-logo-mark.png'))
  const markSrc = `data:image/png;base64,${mark.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: navy,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 36,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markSrc} alt="" width={220} height={220} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: 'white', letterSpacing: -1 }}>
            Anything But Golf
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, color: gold, letterSpacing: 6, textTransform: 'uppercase' }}>
            Scoring
          </div>
        </div>
      </div>
    ),
    size,
  )
}

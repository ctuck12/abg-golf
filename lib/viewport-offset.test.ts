import { describe, it, expect } from 'vitest'

import { stickyOffset } from './viewport-offset'

// Layout viewport of an iPhone 16 Pro Max in CSS px.
const LAYOUT = 932

describe('stickyOffset', () => {
  it('is zero when nothing is going on', () => {
    expect(stickyOffset(LAYOUT, LAYOUT, 0)).toBe(0)
  })

  it('stays zero while rubber-band scrolling with no keyboard', () => {
    // The regression: offsetTop moves during an ordinary scroll. Compensating
    // for it pushes the fixed header down into the middle of the page.
    expect(stickyOffset(LAYOUT, LAYOUT, 240)).toBe(0)
  })

  it('stays zero when only the URL bar collapses', () => {
    expect(stickyOffset(LAYOUT, LAYOUT - 60, 60)).toBe(0)
  })

  it('pushes chrome down by the displacement once the keyboard is up', () => {
    expect(stickyOffset(LAYOUT, LAYOUT - 336, 180)).toBe(180)
  })

  it('is zero with the keyboard up but no displacement', () => {
    expect(stickyOffset(LAYOUT, LAYOUT - 336, 0)).toBe(0)
  })

  it('never returns a negative offset', () => {
    expect(stickyOffset(LAYOUT, LAYOUT - 336, -40)).toBe(0)
  })

  it('ignores a visual viewport reported taller than the layout one', () => {
    expect(stickyOffset(LAYOUT, LAYOUT + 20, 30)).toBe(0)
  })
})

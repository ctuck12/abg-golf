// How far to push position:fixed / sticky chrome back down so it stays on
// screen while the on-screen keyboard is up.
//
// iOS anchors fixed and sticky elements to the *layout* viewport, then scrolls
// that viewport to reveal a focused input — so the header rides off the top.
// visualViewport.offsetTop measures exactly that displacement.
//
// The catch: offsetTop is also non-zero during ordinary rubber-band scrolling
// and pinch-zoom, when nothing needs compensating. Applying it then pushes the
// header down *into* the page. So the offset only counts while the visual
// viewport is meaningfully shorter than the layout viewport — i.e. a keyboard
// is taking up the difference. The URL bar collapsing is far smaller than the
// threshold, so it doesn't trigger.

const KEYBOARD_MIN_HEIGHT = 120

export function stickyOffset(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  const keyboardOpen = layoutHeight - visualHeight > KEYBOARD_MIN_HEIGHT
  if (!keyboardOpen) return 0
  return Math.max(0, visualOffsetTop)
}

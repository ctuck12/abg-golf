'use client'

import React from 'react'

type Props = { strokes: number; par: number; size?: 'sm' | 'md' }

// Renders a stroke count with traditional golf scorecard notation:
//   Eagle or better (≤-2): double red circle
//   Birdie (-1):            single red circle
//   Par (0):                plain number
//   Bogey (+1):             single square
//   Double bogey (+2):      double square
//   Triple bogey+ (≥+3):   triple square
export function ScoreNotation({ strokes, par, size = 'md' }: Props) {
  const diff = strokes - par
  const dim    = size === 'sm' ? '1.25rem' : '1.5rem'
  const font   = size === 'sm' ? '0.6875rem' : '0.8125rem'
  const gap    = size === 'sm' ? '1.5px' : '2px'
  const bw     = size === 'sm' ? '1.5px' : '2px'

  const inner: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 'bold', width: dim, height: dim, fontSize: font,
    lineHeight: 1, flexShrink: 0,
  }

  if (diff <= -2) {
    return (
      <span style={{ display: 'inline-flex', borderRadius: '50%', border: `${bw} solid #dc2626`, padding: gap }}>
        <span style={{ ...inner, borderRadius: '50%', border: `${bw} solid #dc2626`, color: '#dc2626' }}>
          {strokes}
        </span>
      </span>
    )
  }
  if (diff === -1) {
    return (
      <span style={{ ...inner, borderRadius: '50%', border: `${bw} solid #dc2626`, color: '#dc2626' }}>
        {strokes}
      </span>
    )
  }
  if (diff === 1) {
    return (
      <span style={{ ...inner, border: `${bw} solid #374151` }}>
        {strokes}
      </span>
    )
  }
  if (diff === 2) {
    return (
      <span style={{ display: 'inline-flex', border: `${bw} solid #374151`, padding: gap }}>
        <span style={{ ...inner, border: `${bw} solid #374151` }}>
          {strokes}
        </span>
      </span>
    )
  }
  if (diff >= 3) {
    return (
      <span style={{ display: 'inline-flex', border: `${bw} solid #374151`, padding: gap }}>
        <span style={{ display: 'inline-flex', border: `${bw} solid #374151`, padding: gap }}>
          <span style={{ ...inner, border: `${bw} solid #374151` }}>
            {strokes}
          </span>
        </span>
      </span>
    )
  }

  return <span style={{ ...inner }}>{strokes}</span>
}

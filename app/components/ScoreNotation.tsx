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
  const dim  = size === 'sm' ? '1.25rem' : '1.5rem'
  const font = size === 'sm' ? '0.6875rem' : '0.8125rem'
  const bw   = size === 'sm' ? 1.5 : 2  // px

  // All cases share the same fixed-size inline-flex element so text-align:center
  // in table cells centers every score type identically. Outer rings are rendered
  // via box-shadow (doesn't affect layout) with a matching margin so the rings
  // stay within the cell's visual bounds.
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 'bold', width: dim, height: dim, fontSize: font,
    lineHeight: 1, flexShrink: 0,
  }

  if (diff <= -2) {
    return (
      <span style={{
        ...base, borderRadius: '50%',
        border: `${bw}px solid #dc2626`, color: '#dc2626',
        boxShadow: `0 0 0 ${bw}px white, 0 0 0 ${bw * 2}px #dc2626`,
      }}>
        {strokes}
      </span>
    )
  }
  if (diff === -1) {
    return (
      <span style={{ ...base, borderRadius: '50%', border: `${bw}px solid #dc2626`, color: '#dc2626' }}>
        {strokes}
      </span>
    )
  }
  if (diff === 1) {
    return (
      <span style={{ ...base, border: `${bw}px solid #374151` }}>
        {strokes}
      </span>
    )
  }
  if (diff === 2) {
    return (
      <span style={{
        ...base,
        border: `${bw}px solid #374151`,
        boxShadow: `0 0 0 ${bw}px white, 0 0 0 ${bw * 2}px #374151`,
      }}>
        {strokes}
      </span>
    )
  }
  if (diff >= 3) {
    // Shrink core by 4*bw so total visual (core + 4 shadow rings) matches double bogey (core + 2 shadow rings)
    const tripleDim = `calc(${dim} - ${bw * 4}px)`
    return (
      <span style={{
        ...base,
        width: tripleDim,
        height: tripleDim,
        border: `${bw}px solid #374151`,
        boxShadow: `0 0 0 ${bw}px white, 0 0 0 ${bw * 2}px #374151, 0 0 0 ${bw * 3}px white, 0 0 0 ${bw * 4}px #374151`,
      }}>
        {strokes}
      </span>
    )
  }

  return <span style={{ ...base }}>{strokes}</span>
}

// Applies the same circle/square notation to a cumulative vs-par value.
// Uses pill shapes for circles so multi-digit totals (e.g. "-8") fit cleanly.
export function VsParNotation({ vp }: { vp: number | null }) {
  if (vp === null) return <span style={{ color: '#d1d5db', fontWeight: 600 }}>–</span>
  if (vp === 0) return <span style={{ color: '#6b7280', fontWeight: 600 }}>E</span>

  const label = vp > 0 ? `+${vp}` : String(vp)
  const isUnder = vp < 0
  const color = isUnder ? '#dc2626' : '#374151'
  const radius = isUnder ? '999px' : '2px'
  const bw = '1.5px'
  const abs = Math.abs(vp)

  const textStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, color, fontSize: '0.8rem',
    padding: '1px 4px', minHeight: '1.25rem', lineHeight: 1, flexShrink: 0,
  }

  if (abs >= 3) {
    return (
      <span style={{ display: 'inline-flex', borderRadius: radius, border: `${bw} solid ${color}`, padding: '1.5px' }}>
        <span style={{ display: 'inline-flex', borderRadius: radius, border: `${bw} solid ${color}`, padding: '1.5px' }}>
          <span style={{ ...textStyle, borderRadius: radius, border: `${bw} solid ${color}` }}>{label}</span>
        </span>
      </span>
    )
  }
  if (abs === 2) {
    return (
      <span style={{ display: 'inline-flex', borderRadius: radius, border: `${bw} solid ${color}`, padding: '1.5px' }}>
        <span style={{ ...textStyle, borderRadius: radius, border: `${bw} solid ${color}` }}>{label}</span>
      </span>
    )
  }
  return <span style={{ ...textStyle, borderRadius: radius, border: `${bw} solid ${color}` }}>{label}</span>
}

import { describe, it, expect, beforeEach } from 'vitest'

import { readRoundRole, writeRoundRole, roundRoleKey, clearRoundRoleMemory } from './round-role'

function memoryStorage() {
  const data: Record<string, string> = {}
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v },
  }
}

function throwingStorage() {
  return {
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => { throw new Error('QuotaExceededError') },
  }
}

describe('round role memory', () => {
  beforeEach(() => clearRoundRoleMemory())

  it('has no answer before one is given', () => {
    expect(readRoundRole(memoryStorage(), 'r1')).toBeNull()
  })

  it('remembers a choice for that round', () => {
    const s = memoryStorage()
    writeRoundRole(s, 'r1', 'viewer')
    expect(readRoundRole(s, 'r1')).toBe('viewer')
    expect(s.data[roundRoleKey('r1')]).toBe('viewer')
  })

  it('survives a fresh page load — the answer is read back from storage alone', () => {
    const s = memoryStorage()
    writeRoundRole(s, 'r1', 'scorekeeper')
    clearRoundRoleMemory()   // new tab: module state is gone, storage is not
    expect(readRoundRole(s, 'r1')).toBe('scorekeeper')
  })

  it('keeps rounds separate', () => {
    const s = memoryStorage()
    writeRoundRole(s, 'r1', 'viewer')
    expect(readRoundRole(s, 'r2')).toBeNull()
    writeRoundRole(s, 'r2', 'scorekeeper')
    expect(readRoundRole(s, 'r1')).toBe('viewer')
    expect(readRoundRole(s, 'r2')).toBe('scorekeeper')
  })

  it('lets a later answer replace an earlier one', () => {
    const s = memoryStorage()
    writeRoundRole(s, 'r1', 'viewer')
    writeRoundRole(s, 'r1', 'scorekeeper')
    expect(readRoundRole(s, 'r1')).toBe('scorekeeper')
  })

  it('still remembers within the tab when storage throws', () => {
    const s = throwingStorage()
    writeRoundRole(s, 'r1', 'viewer')
    expect(readRoundRole(s, 'r1')).toBe('viewer')
  })

  it('ignores a garbage stored value rather than trusting it', () => {
    const s = memoryStorage()
    s.data[roundRoleKey('r1')] = 'banana'
    expect(readRoundRole(s, 'r1')).toBeNull()
  })

  it('does nothing without a round id', () => {
    const s = memoryStorage()
    writeRoundRole(s, '', 'viewer')
    expect(readRoundRole(s, '')).toBeNull()
    expect(Object.keys(s.data)).toHaveLength(0)
  })
})

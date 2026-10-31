import { describe, it, expect, vi } from 'vitest'
vi.mock('@/api/http', () => ({ request: vi.fn() }))
import {
  emptyShowcase,
  normalizeShowcase,
  readShowcaseDraft,
  saveShowcaseDraft,
} from './demo-showcase'
describe('selected public snapshot', () => {
  it('defaults to private and bounds data from storage', () => {
    expect(emptyShowcase().enabled).toBe(false)
    expect(
      normalizeShowcase({ enabled: 'true', snapshot: { kills: NaN, ai_excerpt: 'x'.repeat(999) } }),
    ).toMatchObject({ enabled: false, snapshot: { kills: null, ai_excerpt: 'x'.repeat(280) } })
  })
  it('isolates drafts by account and tolerates corrupt storage', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key),
      setItem: (key: string, value: string) => data.set(key, value),
    })
    saveShowcaseDraft('a', { ...emptyShowcase(), enabled: true, analysis_id: 'chosen' })
    expect(readShowcaseDraft('a').analysis_id).toBe('chosen')
    expect(readShowcaseDraft('b').analysis_id).toBeNull()
    data.set('csdm.showcase.v1.a', '{broken')
    expect(readShowcaseDraft('a').enabled).toBe(false)
    vi.unstubAllGlobals()
  })
})

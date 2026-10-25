import { describe, expect, it } from 'vitest'
import { combinedStartupProgress } from './startup-progress'

describe('combined startup progress', () => {
  it('waits for the minimum display when the app is already ready', () => {
    expect(combinedStartupProgress(1, 0.4)).toBe(40)
    expect(combinedStartupProgress(1, 0.99)).toBe(99)
  })
  it('waits for remaining app stages after the minimum display', () => {
    expect(combinedStartupProgress(0.65, 1)).toBe(65)
  })
  it('reserves 100 for the final startup gate', () => {
    expect(combinedStartupProgress(1, 1)).toBe(99)
  })
})

import { describe, expect, it } from 'vitest'
import {
  getTrainingBests,
  parseTrainingSession,
  recordTrainingSession,
  trainingComparisonKey,
  trainingStorageKey,
} from './records'
import type { TrainingMode, TrainingOwner, TrainingSession } from './records'
const owner: TrainingOwner = { id: '1', username: 'alice', createdAt: '2026-10-01T00:00:00.000Z' }
const other: TrainingOwner = { id: '2', username: 'bob', createdAt: owner.createdAt }
function store() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}
function session(id: string, mode: TrainingMode = 'gridshot', value = 100): TrainingSession {
  return {
    schemaVersion: 1,
    id,
    completedAt: '2026-10-21T04:00:00.000Z',
    durationMs: 30000,
    parametersChanged: false,
    config: {
      rulesVersion: mode === 'reaction' ? 3 : 2,
      mode,
      duration: 30,
      difficulty: 'normal',
      input: 'locked',
      sensitivity: 1,
      fov: 64,
    },
    metrics: {
      hits: 10,
      shots: 20,
      score: ['reaction', 'tracking'].includes(mode) ? null : value,
      accuracy: 0.5,
      reactionMs: mode === 'reaction' ? value : null,
      trackingRatio: mode === 'tracking' ? value : null,
    },
  }
}
describe('account-owned training personal bests', () => {
  it('keeps highest aim/tracking and lowest reaction average, without counting duplicate completions', () => {
    const storage = store()
    for (const s of [
      session('g1'),
      session('g2', 'gridshot', 80),
      session('g3', 'gridshot', 140),
      session('r1', 'reaction', 240),
      session('r2', 'reaction', 210),
      session('r3', 'reaction', 260),
      session('t1', 'tracking', 0.3),
      session('t2', 'tracking', 0.6),
    ])
      recordTrainingSession(owner, s, storage)
    expect(recordTrainingSession(owner, session('g3', 'gridshot', 999), storage)).toBe('ignored')
    const records = getTrainingBests(owner, storage)
    expect(records.find((r) => r.session.config.mode === 'gridshot')?.session.metrics.score).toBe(
      140,
    )
    expect(records.find((r) => r.session.config.mode === 'gridshot')?.attempts).toBe(3)
    expect(
      records.find((r) => r.session.config.mode === 'reaction')?.session.metrics.reactionMs,
    ).toBe(210)
    expect(
      records.find((r) => r.session.config.mode === 'tracking')?.session.metrics.trackingRatio,
    ).toBe(0.6)
  })
  it('isolates player identities, and never imports shared VECTOR history', () => {
    const storage = store()
    storage.setItem('vector.trainer.sessions.v1', JSON.stringify([session('old-shared')]))
    expect(getTrainingBests(owner, storage)).toEqual([])
    recordTrainingSession(owner, session('alice'), storage)
    expect(getTrainingBests(other, storage)).toEqual([])
    expect(getTrainingBests({ ...owner, username: 'new_alice' }, storage)).toEqual([])
    expect(getTrainingBests({ ...owner, createdAt: '2026-10-02T00:00:00.000Z' }, storage)).toEqual(
      [],
    )
    expect(JSON.parse(storage.getItem('vector.trainer.sessions.v1')!)[0].id).toBe('old-shared')
  })
  it('separates duration, difficulty and first-person parameters; ignores aim parameters for reaction', () => {
    const storage = store()
    const normal = session('normal')
    const longer = session('longer')
    longer.config.duration = 60
    longer.durationMs = 60000
    const hard = session('hard')
    hard.config.difficulty = 'hard'
    const sensitivity = session('sensitivity')
    sensitivity.config.sensitivity = 2
    for (const s of [normal, longer, hard, sensitivity]) recordTrainingSession(owner, s, storage)
    expect(getTrainingBests(owner, storage)).toHaveLength(4)
    const reaction = session('reaction', 'reaction', 200)
    expect(trainingComparisonKey(reaction.config)).toBe(
      trainingComparisonKey({ ...reaction.config, fov: 90, sensitivity: 3 }),
    )
  })
  it('excludes changed-parameter, incomplete/legacy, missing-metric and corrupt sessions, strips input events', () => {
    const storage = store()
    expect(
      recordTrainingSession(owner, { ...session('changed'), parametersChanged: true }, storage),
    ).toBe('ignored')
    expect(recordTrainingSession(owner, { ...session('short'), durationMs: 2000 }, storage)).toBe(
      'ignored',
    )
    const legacy = session('legacy')
    legacy.config.rulesVersion = 1
    expect(recordTrainingSession(owner, legacy, storage)).toBe('ignored')
    const noReaction = session('no-hits', 'reaction')
    noReaction.metrics.reactionMs = null
    expect(recordTrainingSession(owner, noReaction, storage)).toBe('ignored')
    expect(parseTrainingSession(null)).toBeNull()
    expect(parseTrainingSession({ ...session('old-pointer'), config: { ...session('old-pointer').config, input: 'pointer' } })).toBeNull()
    const extra = { ...session('valid'), events: [{ privateInput: 'omitted' }] }
    recordTrainingSession(owner, extra, storage)
    expect(storage.getItem(trainingStorageKey(owner))).not.toContain('privateInput')
  })
  it('handles invalid storage and quota failures without touching game records', () => {
    const storage = store()
    storage.setItem(trainingStorageKey(owner), '{broken')
    expect(getTrainingBests(owner, storage)).toEqual([])
    const unavailable = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(recordTrainingSession(owner, session('quota'), unavailable)).toBe('unavailable')
    storage.setItem(trainingStorageKey(other), storage.getItem(trainingStorageKey(owner))!)
    expect(getTrainingBests(other, storage)).toEqual([])
  })
})

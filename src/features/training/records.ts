import type { User } from '@/types'

export const TRAINING_MODES = [
  { id: 'gridshot', name: '网格点射', english: 'GRIDSHOT', unit: '分', direction: '最高分' },
  { id: 'reaction', name: '反应测试', english: 'REACTION', unit: 'ms', direction: '最快平均反应' },
  { id: 'spidershot', name: '大幅甩枪', english: 'SPIDERSHOT', unit: '分', direction: '最高分' },
  { id: 'microshot', name: '精准微调', english: 'MICROSHOT', unit: '分', direction: '最高分' },
  { id: 'tracking', name: '平滑跟枪', english: 'TRACKING', unit: '%', direction: '最高在靶率' },
] as const
export type TrainingMode = (typeof TRAINING_MODES)[number]['id']
export type TrainingOwner = Pick<User, 'id' | 'username' | 'createdAt'>
export interface TrainingSession {
  schemaVersion: 1
  id: string
  completedAt: string
  durationMs: number
  parametersChanged: boolean
  config: {
    rulesVersion: number
    mode: TrainingMode
    duration: number
    difficulty: 'easy' | 'normal' | 'hard'
    input: 'locked'
    sensitivity: number
    fov: number
  }
  metrics: {
    score: number | null
    accuracy: number | null
    reactionMs: number | null
    trackingRatio: number | null
    hits: number
    shots: number
  }
}
export interface TrainingBest {
  key: string
  session: TrainingSession
  attempts: number
  lastPlayedAt: string
}
interface SavedRecords {
  version: 1
  owner: TrainingOwner
  records: TrainingBest[]
  recentIds: string[]
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const PREFIX = 'csdm.training.bests.v1.'
export const TRAINING_RECORDS_CHANGED = 'csdm:training-records-changed'
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const nullable = (value: unknown): value is number | null => value === null || finite(value)

// Only consume the game's documented completion snapshot. Never read or assign
// the shared VECTOR history to a player, and never keep raw mouse/input events.
export function parseTrainingSession(value: unknown): TrainingSession | null {
  if (!value || typeof value !== 'object') return null
  const s = value as TrainingSession
  const c = s.config
  const m = s.metrics
  if (
    s.schemaVersion !== 1 ||
    typeof s.id !== 'string' ||
    !s.id ||
    s.id.length > 128 ||
    typeof s.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(s.completedAt)) ||
    typeof s.parametersChanged !== 'boolean' ||
    !c ||
    !m ||
    !TRAINING_MODES.some((mode) => mode.id === c.mode) ||
    ![30, 60, 90].includes(c.duration) ||
    !['easy', 'normal', 'hard'].includes(c.difficulty) ||
    c.input !== 'locked' ||
    !finite(c.sensitivity) ||
    c.sensitivity < 0.1 ||
    c.sensitivity > 5 ||
    !finite(c.fov) ||
    c.fov < 50 ||
    c.fov > 100 ||
    c.rulesVersion !== (c.mode === 'reaction' ? 3 : 2) ||
    s.durationMs !== c.duration * 1000 ||
    !finite(m.hits) ||
    !finite(m.shots) ||
    m.hits > m.shots ||
    !nullable(m.score) ||
    !nullable(m.accuracy) ||
    !nullable(m.reactionMs) ||
    !nullable(m.trackingRatio) ||
    (m.accuracy !== null && m.accuracy > 1) ||
    (m.trackingRatio !== null && m.trackingRatio > 1)
  )
    return null
  return {
    schemaVersion: 1,
    id: s.id,
    completedAt: s.completedAt,
    durationMs: s.durationMs,
    parametersChanged: s.parametersChanged,
    config: {
      rulesVersion: c.rulesVersion,
      mode: c.mode,
      duration: c.duration,
      difficulty: c.difficulty,
      input: c.input,
      sensitivity: c.sensitivity,
      fov: c.fov,
    },
    metrics: {
      score: m.score,
      accuracy: m.accuracy,
      reactionMs: m.reactionMs,
      trackingRatio: m.trackingRatio,
      hits: m.hits,
      shots: m.shots,
    },
  }
}
export function trainingMetric(session: TrainingSession): number | null {
  if (session.config.mode === 'reaction') return session.metrics.reactionMs
  if (session.config.mode === 'tracking')
    return session.metrics.trackingRatio === null ? null : session.metrics.trackingRatio * 100
  return session.metrics.score
}
// Same grouping as the native game's comparisonKey: compare like parameters.
export function trainingComparisonKey(c: TrainingSession['config']): string {
  if (c.mode === 'reaction')
    return [`v${c.rulesVersion}`, c.mode, c.duration, 'color-click'].join(':')
  return [
    `v${c.rulesVersion}`,
    c.mode,
    c.duration,
    c.difficulty,
    'locked',
    c.sensitivity,
    c.fov,
  ].join(':')
}
export function trainingGroupLabel(c: TrainingSession['config']): string {
  if (c.mode === 'reaction') return `${c.duration} 秒 · 变色反应`
  const difficulty = { easy: '入门', normal: '标准', hard: '挑战' }[c.difficulty]
  return `${c.duration} 秒 · ${difficulty} · 第一人称 · 灵敏度 ${c.sensitivity} · FOV ${c.fov}`
}
export function trainingStorageKey(owner: TrainingOwner): string {
  return PREFIX + encodeURIComponent(JSON.stringify([owner.id, owner.username, owner.createdAt]))
}
function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
function read(owner: TrainingOwner, storage: StorageLike | undefined): SavedRecords {
  const empty: SavedRecords = { version: 1, owner, records: [], recentIds: [] }
  try {
    const saved = JSON.parse(
      storage?.getItem(trainingStorageKey(owner)) || 'null',
    ) as SavedRecords | null
    if (
      !saved ||
      saved.version !== 1 ||
      !saved.owner ||
      trainingStorageKey(saved.owner) !== trainingStorageKey(owner) ||
      !Array.isArray(saved.records)
    )
      return empty
    const records = saved.records.flatMap((record) => {
      if (
        !record ||
        !Number.isSafeInteger(record.attempts) ||
        record.attempts < 1 ||
        !Number.isFinite(Date.parse(record.lastPlayedAt))
      )
        return []
      const session = parseTrainingSession(record.session)
      return session &&
        !session.parametersChanged &&
        trainingMetric(session) !== null &&
        record.key === trainingComparisonKey(session.config)
        ? [{ ...record, session }]
        : []
    })
    return {
      version: 1,
      owner,
      records,
      recentIds: Array.isArray(saved.recentIds)
        ? saved.recentIds.filter((id) => typeof id === 'string').slice(-500)
        : [],
    }
  } catch {
    return empty
  }
}
export function getTrainingBests(owner: TrainingOwner, storage = browserStorage()): TrainingBest[] {
  return read(owner, storage).records
}
export function recordTrainingSession(
  owner: TrainingOwner,
  raw: unknown,
  storage = browserStorage(),
): 'saved' | 'ignored' | 'unavailable' {
  const session = parseTrainingSession(raw)
  if (!session || session.parametersChanged || trainingMetric(session) === null) return 'ignored'
  const saved = read(owner, storage)
  if (
    saved.recentIds.includes(session.id) ||
    saved.records.some((record) => record.session.id === session.id)
  )
    return 'ignored'
  const key = trainingComparisonKey(session.config)
  const previous = saved.records.find((record) => record.key === key)
  if (previous) {
    const nextValue = trainingMetric(session)!
    const oldValue = trainingMetric(previous.session)!
    if (session.config.mode === 'reaction' ? nextValue < oldValue : nextValue > oldValue)
      previous.session = session
    previous.attempts++
    if (Date.parse(session.completedAt) > Date.parse(previous.lastPlayedAt))
      previous.lastPlayedAt = session.completedAt
  } else saved.records.push({ key, session, attempts: 1, lastPlayedAt: session.completedAt })
  saved.recentIds = [...saved.recentIds, session.id].slice(-500)
  try {
    if (!storage) return 'unavailable'
    storage.setItem(trainingStorageKey(owner), JSON.stringify(saved))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(TRAINING_RECORDS_CHANGED))
    return 'saved'
  } catch {
    return 'unavailable'
  }
}

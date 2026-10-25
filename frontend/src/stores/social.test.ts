import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'
import { useSocialStore } from './social'
import { getFriends, getFriendRequests } from '@/features/social/api'
import type { Friend } from '@/features/social/types'
import type { Page } from '@/types'
vi.mock('@/features/social/api', () => ({ getFriends: vi.fn(), getFriendRequests: vi.fn() }))
const friend = (id: number): Friend => ({
  friendship_id: id,
  friends_since: '2026-10-25T00:00:00Z',
  user: {
    user_id: id,
    username: `user_${id}`,
    nickname: null,
    avatar_url: null,
    skill_level: null,
  },
})
const page = (items: Friend[], current = 1, total = items.length): Page<Friend> => ({
  items,
  page: current,
  pageSize: 50,
  total,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  useAuthStore().user = {
    id: '1',
    username: 'alice',
    nickname: 'Alice',
    avatar: null,
    createdAt: '',
  }
  vi.mocked(getFriendRequests).mockResolvedValue({ incoming: [], outgoing: [], incoming_count: 0 })
  vi.mocked(getFriends).mockResolvedValue(page([]))
})
describe('shared social state', () => {
  it('loads every friends page so a friend beyond page 1 is never offered a new request', async () => {
    vi.mocked(getFriends)
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 50 }, (_, i) => friend(i + 2)),
          1,
          51,
        ),
      )
      .mockResolvedValueOnce(page([friend(52)], 2, 51))
    const store = useSocialStore()
    await store.refresh()
    expect(store.friends).toHaveLength(51)
    expect(store.relationship(52)).toBe('friend')
    expect(getFriends).toHaveBeenNthCalledWith(2, 2)
  })
  it('discards a late response when switching accounts and clears cached requests', async () => {
    const old = deferred<Page<Friend>>()
    vi.mocked(getFriends).mockReturnValueOnce(old.promise)
    const store = useSocialStore()
    const reading = store.refresh()
    useAuthStore().user = {
      id: '3',
      username: 'carol',
      nickname: 'Carol',
      avatar: null,
      createdAt: '',
    }
    await store.refresh()
    old.resolve(page([friend(2)]))
    await reading
    expect(store.friends).toEqual([])
    expect(store.ready).toBe(true)
    expect(store.loading).toBe(false)
  })
  it('reads the committed relationship after an older read finishes during a mutation', async () => {
    const old = deferred<Page<Friend>>()
    vi.mocked(getFriends)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page([friend(2)]))
    const store = useSocialStore()
    const reading = store.refresh()
    const action = vi.fn().mockResolvedValue(undefined)
    const writing = store.mutate(2, action)
    expect(await store.mutate(2, action)).toBe(false)
    old.resolve(page([]))
    await reading
    await writing
    expect(action).toHaveBeenCalledTimes(1)
    expect(store.relationship(2)).toBe('friend')
    expect(store.busy).toBe(null)
  })
  it('invalidates relationship actions on failed reads, and retries cleanly', async () => {
    const store = useSocialStore()
    vi.mocked(getFriends)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([friend(2)]))
    await store.refresh()
    expect(store.ready).toBe(false)
    expect(store.error).toBe('offline')
    await store.refresh()
    expect(store.ready).toBe(true)
    expect(store.error).toBe('')
    expect(store.relationship(2)).toBe('friend')
  })
})

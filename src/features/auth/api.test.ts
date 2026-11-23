import { describe, expect, it } from 'vitest'
import { normalizeUser } from './api'

describe('backend account adapter', () => {
  it('uses username when nickname is null and normalizes numeric account ids', () => {
    expect(
      normalizeUser({
        id: 4,
        username: 'player_4',
        nickname: null,
        avatar_url: '/uploads/a.jpg',
        created_at: '2026-10-20T00:00:00Z',
      }),
    ).toEqual({
      id: '4',
      username: 'player_4',
      nickname: 'player_4',
      avatar: '/uploads/a.jpg',
      createdAt: '2026-10-20T00:00:00Z',
    })
  })
})

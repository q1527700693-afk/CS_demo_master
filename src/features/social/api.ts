import { request } from '@/api/http'
import type { Page } from '@/types'
import type { Friend, FriendRequest, FriendRequests, SearchPlayer } from './types'

export const searchPlayers = (q: string, page = 1, signal?: AbortSignal) =>
  request<Page<SearchPlayer>>(
    `/users/search?${new URLSearchParams({ q, page: String(page), pageSize: '20' })}`,
    { signal },
  )
export const getFriends = (page = 1) => request<Page<Friend>>(`/friends?page=${page}&pageSize=50`)
export const getFriendRequests = () => request<FriendRequests>('/friends/requests')
export const requestFriend = (userId: number) =>
  request<FriendRequest>('/friends/requests', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  })
export const respondToFriend = (id: number, action: 'accept' | 'reject') =>
  request<FriendRequest>(`/friends/requests/${id}/${action}`, { method: 'POST' })
export const cancelFriendRequest = (id: number) =>
  request<FriendRequest>(`/friends/requests/${id}`, { method: 'DELETE' })
export const removeFriend = (userId: number) =>
  request<{ user_id: number }>(`/friends/${userId}`, { method: 'DELETE' })

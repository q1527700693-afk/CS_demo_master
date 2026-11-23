import { request } from '@/api/http'
import type { UserProfile } from '@/types'
export type ProfileInput = Pick<
  UserProfile,
  | 'steam_id'
  | 'steam_friend_code'
  | 'wanmei_id'
  | '5E_id'
  | 'signature'
  | 'skill_level'
  | 'looking_for'
  | 'other_game_ids'
>
export interface AvatarResult {
  avatar_url: string
  content_type: string
  size_bytes: number
  width: number
  height: number
}
export const getMyProfile = () => request<UserProfile>('/users/me/profile')
export const updateMyProfile = (input: ProfileInput) =>
  request<UserProfile>('/users/me/profile', { method: 'PATCH', body: JSON.stringify(input) })
export const getPublicProfile = (id: string, signal?: AbortSignal) =>
  request<UserProfile>(`/users/${encodeURIComponent(id)}/profile`, { signal })
export function uploadAvatar(file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<AvatarResult>('/users/me/avatar', { method: 'POST', body })
}
export const deleteAvatar = () => request<UserProfile>('/users/me/avatar', { method: 'DELETE' })

import { request } from '@/api/http'
import type { Page } from '@/types'
import type { Lobby, LobbyInput, LobbyMode } from './types'
export const listLobbies = (page = 1, mode: LobbyMode | '' = '') => {
  const params = new URLSearchParams({ page: String(page), pageSize: '12' })
  if (mode) params.set('mode', mode)
  return request<Page<Lobby>>(`/lobbies?${params}`)
}
export const getLobby = (id: number) => request<Lobby>(`/lobbies/${id}`)
export const createLobby = (input: LobbyInput) =>
  request<Lobby>('/lobbies', { method: 'POST', body: JSON.stringify(input) })
export const claimLobby = (id: number) =>
  request<{ team_code: string; lobby_id: number; claimed_at: string; lobby: Lobby }>(
    `/lobbies/${id}/claim`,
    { method: 'POST' },
  )
export const cancelClaim = (id: number) =>
  request<Lobby>(`/lobbies/${id}/claim`, { method: 'DELETE' })
export const departLobby = (id: number) =>
  request<Lobby>(`/lobbies/${id}/depart`, { method: 'POST' })
export const kickClaimant = (id: number, userId: number) =>
  request<Lobby>(`/lobbies/${id}/claimants/${userId}`, { method: 'DELETE' })
export const deleteLobby = (id: number) =>
  request<{ id: number }>(`/lobbies/${id}`, { method: 'DELETE' })

import type { PlayerSummary } from '@/features/social/types'
export type LobbyMode = 'competitive' | 'premier' | 'wingman'
export const lobbyModes: Record<LobbyMode, string> = {
  competitive: '竞技匹配',
  premier: '优先模式',
  wingman: '搭档模式',
}
export interface LobbyInput {
  title: string
  description: string | null
  mode: LobbyMode
  map: string | null
  region: string | null
  skill_level: string | null
  team_size: number
  current_players: number
  team_code: string
}
export interface LobbyClaimant extends PlayerSummary {
  claimed_at: string
  is_you: boolean
}
export interface Lobby extends Omit<LobbyInput, 'team_code'> {
  id: number
  team_code: string | null
  slots_needed: number
  claim_count: number
  status: 'open' | 'departed'
  owner_id: number
  owner: PlayerSummary
  is_owner: boolean
  is_claimed: boolean
  can_claim: boolean
  expires_at: string
  departed_at: string | null
  created_at: string
  updated_at: string
  claimants: LobbyClaimant[]
}

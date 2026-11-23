export interface PlayerSummary {
  user_id: number
  username: string
  nickname: string | null
  avatar_url: string | null
  skill_level: string | null
  signature?: string | null
  looking_for?: string | null
}
export type Relationship = 'none' | 'friend' | 'incoming_request' | 'outgoing_request'
export interface SearchPlayer extends PlayerSummary {
  relationship: Relationship
}
export interface Friend {
  friendship_id: number
  user: PlayerSummary
  friends_since: string
}
export interface FriendRequest {
  id: number
  direction: 'incoming' | 'outgoing'
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  user: PlayerSummary
  created_at: string
  updated_at: string
  accepted_at: string | null
}
export interface FriendRequests {
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  incoming_count: number
}

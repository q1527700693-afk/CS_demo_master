export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}
export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}
export interface User {
  id: string
  username: string
  nickname: string
  avatar: string | null
  createdAt: string
}
export interface BackendUser {
  id: number
  username: string
  nickname: string | null
  avatar_url: string | null
  created_at: string
}
export interface OtherGameAccount {
  game: string
  account: string
}
export interface UserProfile {
  user_id: number
  username: string
  nickname: string | null
  signature: string | null
  steam_id: string | null
  steam_friend_code: string | null
  wanmei_id: string | null
  '5E_id': string | null
  other_game_ids: OtherGameAccount[]
  skill_level: string | null
  looking_for: string | null
  has_platform_id: boolean
  avatar_url: string | null
  updated_at: string | null
}
export interface LoginInput {
  username: string
  password: string
}
export type RegisterInput = LoginInput
export interface BackendAuthResult {
  access_token: string
  token_type: 'bearer'
  user: BackendUser
}
export interface AuthResult {
  token: string
  user: User
}
export type AnalysisStatus = 'uploaded' | 'queued' | 'analyzing' | 'completed' | 'failed'
export interface Replay {
  scoreKnown?: boolean
  matchTimeKnown?: boolean
  id: string
  map: string
  title: string
  createdAt: string
  score: [number, number]
  status: AnalysisStatus
  rating: number | null
  adr: number | null
}
export interface AnalysisTask {
  id: string
  status: AnalysisStatus
  progress: number
  message: string
}
export interface Report extends Replay {
  kast: number
  kills: number
  deaths: number
  assists: number
  headshotRate: number
  rounds: { round: number; won: boolean; economy: number; enemyEconomy: number }[]
  radar: { x: number; y: number; count: number }[]
  utility: { label: string; value: number; unit: string }[]
  strengths: string[]
  suggestions: string[]
  privacy: 'private'
}

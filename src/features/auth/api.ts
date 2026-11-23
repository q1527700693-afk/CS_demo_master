import { request } from '@/api/http'
import type {
  AuthResult,
  BackendAuthResult,
  BackendUser,
  LoginInput,
  RegisterInput,
  User,
} from '@/types'

export function normalizeUser(user: BackendUser): User {
  return {
    id: String(user.id),
    username: user.username,
    nickname: user.nickname || user.username,
    avatar: user.avatar_url,
    createdAt: user.created_at,
  }
}
function normalizeAuth(result: BackendAuthResult): AuthResult {
  if (!result.access_token || !result.user) throw new Error('登录响应不完整，请检查后端版本')
  return { token: result.access_token, user: normalizeUser(result.user) }
}
export const login = async (input: LoginInput) =>
  normalizeAuth(
    await request<BackendAuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
export const register = async (input: RegisterInput) =>
  normalizeAuth(
    await request<BackendAuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
export const getMe = async () => normalizeUser(await request<BackendUser>('/users/me'))

import { delay, http, HttpResponse } from 'msw'
import { apiBase, mockModules, TOKEN_KEY } from '@/app/config'
import type { BackendUser, LoginInput, User, UserProfile } from '@/types'
import { demoProfile, demoUser } from './data'
import type { ProfileInput } from '@/features/profile/api'

const url = (path: string) => `${apiBase}${path}`
const ok = <T>(data: T, status = 200) =>
  HttpResponse.json({ code: 0, message: 'success', data }, { status })
const fail = (message: string, code = 40000, status = 400) =>
  HttpResponse.json({ code, message, data: null }, { status })
const unauthorized = () => fail('请重新登录', 40002, 401)
const key = `csdm.mock.accounts.v2.${mockModules.auth ? 'demo' : 'real'}`
let users: Record<string, BackendUser> = mockModules.auth ? { 1: demoUser } : {}
let cards: Record<string, UserProfile> = mockModules.auth ? { 1: demoProfile } : {}
try {
  const saved = JSON.parse(localStorage.getItem(key) || 'null')
  if (saved) {
    users = saved.users
    cards = saved.cards
  }
} catch {
  /* Empty or old mock state. */
}
const persist = () => localStorage.setItem(key, JSON.stringify({ users, cards }))
const credentials = new Map([['demo_player', { id: '1', password: 'Demo123456!' }]])
const sessions = new Map<string, string>()
function emptyCard(user: BackendUser): UserProfile {
  return {
    user_id: user.id,
    username: user.username,
    nickname: user.nickname,
    signature: null,
    steam_id: null,
    steam_friend_code: null,
    wanmei_id: null,
    '5E_id': null,
    other_game_ids: [],
    skill_level: null,
    looking_for: null,
    has_platform_id: false,
    avatar_url: user.avatar_url,
    updated_at: null,
  }
}
export function mockOwner(request: Request): string | undefined {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || ''
  if (!mockModules.auth && token && token === localStorage.getItem(TOKEN_KEY)) {
    try {
      const user = JSON.parse(sessionStorage.getItem('csdm.mock.identity') || 'null') as User | null
      if (!user?.id) return undefined
      users[user.id] = {
        id: Number(user.id),
        username: user.username,
        nickname: user.nickname,
        avatar_url: user.avatar,
        created_at: user.createdAt,
      }
      cards[user.id] ??= emptyCard(users[user.id])
      return user.id
    } catch {
      return undefined
    }
  }
  if (mockModules.auth && token === 'mock-demo-session') return '1'
  return sessions.get(token)
}
export const mockDisplayName = (id: string) =>
  users[id]?.nickname || users[id]?.username || '新队长'
const authenticated = (user: BackendUser) => {
  const token = user.id === 1 ? 'mock-demo-session' : crypto.randomUUID()
  sessions.set(token, String(user.id))
  return { access_token: token, token_type: 'bearer', user }
}

export const accountHandlers = [
  ...(mockModules.auth
    ? [
        http.post(url('/auth/login'), async ({ request }) => {
          await delay(200)
          const body = (await request.json()) as LoginInput
          const account = credentials.get(body.username)
          return account && account.password === body.password
            ? ok(authenticated(users[account.id]))
            : fail('用户名或密码不正确', 40001, 401)
        }),
        http.post(url('/auth/register'), async ({ request }) => {
          const body = (await request.json()) as LoginInput
          if (
            !/^[A-Za-z0-9_]{3,32}$/.test(body.username) ||
            body.password?.length < 8 ||
            body.password?.length > 128
          )
            return fail('请填写有效用户名和 8–128 位密码')
          if (Object.values(users).some((user) => user.username === body.username))
            return fail('该用户名已注册', 40900, 409)
          const id = Math.max(0, ...Object.values(users).map((user) => user.id)) + 1
          const user: BackendUser = {
            id,
            username: body.username,
            nickname: null,
            avatar_url: null,
            created_at: new Date().toISOString(),
          }
          users[id] = user
          cards[id] = emptyCard(user)
          credentials.set(body.username, { id: String(id), password: body.password })
          persist()
          return ok(authenticated(user), 201)
        }),
        http.get(url('/users/me'), ({ request }) => {
          const id = mockOwner(request)
          return id && users[id] ? ok(users[id]) : unauthorized()
        }),
      ]
    : []),
  ...(mockModules.profile
    ? [
        http.get(url('/users/me/profile'), ({ request }) => {
          const id = mockOwner(request)
          return id && cards[id] ? ok(cards[id]) : unauthorized()
        }),
        http.get(url('/users/:userId/profile'), ({ params }) => {
          const card = cards[String(params.userId)]
          return card ? ok(card) : fail('没有找到这位玩家', 40400, 404)
        }),
        http.patch(url('/users/me/profile'), async ({ request }) => {
          const id = mockOwner(request)
          if (!id || !cards[id]) return unauthorized()
          const input = (await request.json()) as ProfileInput
          const result = { ...cards[id], ...input }
          if (result.steam_friend_code && !/^\d{6,12}$/.test(result.steam_friend_code))
            return fail('Steam 好友码需为 6–12 位数字')
          for (const field of ['steam_id', 'wanmei_id', '5E_id'] as const) {
            if (
              result[field] &&
              Object.entries(cards).some(
                ([other, card]) => other !== id && card[field] === result[field],
              )
            )
              return fail('该平台账号已被绑定', 40900, 409)
          }
          cards[id] = {
            ...result,
            has_platform_id: Boolean(result.steam_id || result.wanmei_id || result['5E_id']),
            updated_at: new Date().toISOString(),
          }
          persist()
          return ok(cards[id])
        }),
        http.post(url('/users/me/avatar'), async ({ request }) => {
          const id = mockOwner(request)
          if (!id || !cards[id]) return unauthorized()
          const file = (await request.formData()).get('file')
          if (!(file instanceof File) || !file.size) return fail('请选择图片')
          if (file.size > 2 * 1024 * 1024) return fail('头像不得超过 2 MB', 41300, 413)
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
            return fail('不支持该图片格式')
          try {
            const image = await createImageBitmap(file)
            const canvas = new OffscreenCanvas(512, 512)
            const size = Math.min(image.width, image.height)
            canvas
              .getContext('2d')!
              .drawImage(
                image,
                (image.width - size) / 2,
                (image.height - size) / 2,
                size,
                size,
                0,
                0,
                512,
                512,
              )
            image.close()
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
            const encoded = btoa(
              new Uint8Array(await blob.arrayBuffer()).reduce(
                (text, byte) => text + String.fromCharCode(byte),
                '',
              ),
            )
            const avatar_url = `data:image/jpeg;base64,${encoded}`
            users[id].avatar_url = avatar_url
            cards[id].avatar_url = avatar_url
            persist()
            return ok({
              avatar_url,
              width: 512,
              height: 512,
              content_type: 'image/jpeg',
              size_bytes: blob.size,
            })
          } catch {
            return fail('图片无法读取，请重新选择')
          }
        }),
        http.delete(url('/users/me/avatar'), ({ request }) => {
          const id = mockOwner(request)
          if (!id || !cards[id]) return unauthorized()
          users[id].avatar_url = null
          cards[id].avatar_url = null
          persist()
          return ok(cards[id])
        }),
      ]
    : []),
]

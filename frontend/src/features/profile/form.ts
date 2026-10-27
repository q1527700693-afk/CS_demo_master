import type { OtherGameAccount, UserProfile } from '@/types'
import type { ProfileInput } from './api'

export interface ProfileForm {
  steam_id: string
  steam_friend_code: string
  wanmei_id: string
  '5E_id': string
  signature: string
  skill_level: string
  looking_for: string
  other_game_ids: OtherGameAccount[]
}
export const emptyProfileForm = (): ProfileForm => ({
  steam_id: '',
  steam_friend_code: '',
  wanmei_id: '',
  '5E_id': '',
  signature: '',
  skill_level: '',
  looking_for: '',
  other_game_ids: [],
})
export function profileToForm(card: UserProfile): ProfileForm {
  return {
    steam_id: card.steam_id || '',
    steam_friend_code: card.steam_friend_code || '',
    wanmei_id: card.wanmei_id || '',
    '5E_id': card['5E_id'] || '',
    signature: card.signature || '',
    skill_level: card.skill_level || '',
    looking_for: card.looking_for || '',
    other_game_ids: card.other_game_ids.map((row) => ({ ...row })),
  }
}
export function profilePayload(form: ProfileForm): ProfileInput {
  const text = (value: string) => value.trim() || null
  const result: ProfileInput = {
    steam_id: text(form.steam_id),
    steam_friend_code: text(form.steam_friend_code),
    wanmei_id: text(form.wanmei_id),
    '5E_id': text(form['5E_id']),
    signature: text(form.signature),
    skill_level: text(form.skill_level),
    looking_for: text(form.looking_for),
    other_game_ids: form.other_game_ids.map((row) => ({
      game: row.game.trim(),
      account: row.account.trim(),
    })),
  }
  if (result.steam_friend_code && !/^\d{6,12}$/.test(result.steam_friend_code))
    throw new Error('Steam 好友码需为 6–12 位数字')
  if (result.other_game_ids.some((row) => !row.game || !row.account))
    throw new Error('请填写完整的游戏名称和账号，或删除该行')
  return result
}
export function validateAvatar(file: File): void {
  if (!file.size || file.size > 2 * 1024 * 1024)
    throw new Error('头像文件大小需大于 0 且不超过 2 MB')
  const supported = ['image/jpeg', 'image/png', 'image/webp']
  if (!(file.type ? supported.includes(file.type) : /\.(jpe?g|png|webp)$/i.test(file.name)))
    throw new Error('头像仅支持 JPEG、PNG 或 WebP 图片')
}

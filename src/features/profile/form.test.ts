import { describe, expect, it } from 'vitest'
import { emptyProfileForm, profilePayload, profileToForm, validateAvatar } from './form'
import type { UserProfile } from '@/types'

describe('personal card contract', () => {
  it('allows all platform fields to be empty and only sends accepted fields', () => {
    const form = emptyProfileForm()
    form.signature = 'hello'
    expect(profilePayload(form)).toEqual({
      steam_id: null,
      steam_friend_code: null,
      wanmei_id: null,
      '5E_id': null,
      signature: 'hello',
      skill_level: null,
      looking_for: null,
      other_game_ids: [],
    })
    form.wanmei_id = ' PW_123 '
    expect(profilePayload(form).wanmei_id).toBe('PW_123')
  })
  it('keeps optional null values editable and does not mutate the loaded card', () => {
    const card: UserProfile = {
      user_id: 1,
      username: 'player',
      nickname: null,
      signature: null,
      steam_id: null,
      steam_friend_code: null,
      wanmei_id: null,
      '5E_id': null,
      other_game_ids: [{ game: 'Faceit', account: 'player' }],
      skill_level: null,
      looking_for: null,
      has_platform_id: false,
      avatar_url: null,
      updated_at: null,
    }
    const form = profileToForm(card)
    form.other_game_ids[0].account = 'changed'
    expect(card.other_game_ids[0].account).toBe('player')
    expect(form.signature).toBe('')
    expect(form.steam_friend_code).toBe('')
  })
  it('validates optional friend codes and preserves leading zeros without a Steam ID', () => {
    const form = emptyProfileForm()
    for (const value of ['12345', '1234567890123', 'abc123', '123 456']) {
      form.steam_friend_code = value
      expect(() => profilePayload(form)).toThrow('6–12 位数字')
    }
    form.steam_friend_code = ' 00123456 '
    expect(profilePayload(form).steam_friend_code).toBe('00123456')
    expect(profilePayload(form).steam_id).toBeNull()
    form.steam_friend_code = ' '
    expect(profilePayload(form).steam_friend_code).toBeNull()
  })
  it('rejects incomplete game accounts and unsupported or oversized avatars', () => {
    const form = emptyProfileForm()
    form['5E_id'] = '1234'
    form.other_game_ids = [{ game: 'Faceit', account: ' ' }]
    expect(() => profilePayload(form)).toThrow('填写完整')
    expect(() =>
      validateAvatar({ size: 2 * 1024 * 1024 + 1, type: 'image/png', name: 'a.png' } as File),
    ).toThrow('2 MB')
    expect(() =>
      validateAvatar({ size: 20, type: 'image/svg+xml', name: 'a.svg' } as File),
    ).toThrow('JPEG')
  })
})

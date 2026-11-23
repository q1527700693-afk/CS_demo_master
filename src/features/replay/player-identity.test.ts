import { describe, expect, it } from 'vitest'
import { findPlayers, uniqueExactPlayer } from './player-identity'
const roster = [
  { name: 'Pose', player_id: '76561199836146468' },
  { name: 'Pose', player_id: '76561199836146469' },
  { name: 'ＰＬＡＹＥＲ', player_id: '76561199836146470' },
]
describe('explicit player identity', () => {
  it('does not pick an arbitrary player when nicknames are duplicated', () => {
    expect(findPlayers(roster, 'pose')).toHaveLength(2)
    expect(uniqueExactPlayer(roster, 'Pose')).toBe('')
  })
  it('normalizes full-width characters and whitespace for search only', () => {
    expect(uniqueExactPlayer(roster, ' player ')).toBe('76561199836146470')
  })
  it('allows exact SteamID selection without losing precision', () => {
    expect(uniqueExactPlayer(roster, '76561199836146469')).toBe('76561199836146469')
  })
  it('keeps blank or absent names unselected', () => {
    expect(uniqueExactPlayer(roster, '')).toBe('')
    expect(findPlayers(roster, 'nobody')).toHaveLength(0)
  })
})

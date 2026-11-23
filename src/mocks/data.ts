import type { BackendUser, Report, UserProfile } from '@/types'
export const demoUser: BackendUser = {
  id: 1,
  username: 'demo_player',
  nickname: 'Forsaken',
  avatar_url: null,
  created_at: '2026-10-01T00:00:00.000Z',
}
export const demoProfile: UserProfile = {
  user_id: 1,
  username: 'demo_player',
  nickname: 'Forsaken',
  avatar_url: null,
  signature: '每一次复盘，都离下一场胜利更近一点。',
  steam_id: '76561198000000001',
  steam_friend_code: null,
  wanmei_id: null,
  '5E_id': null,
  other_game_ids: [],
  skill_level: '完美 C+',
  looking_for: '周末找固定车队',
  has_platform_id: true,
  updated_at: null,
}
export function makeReport(id: string, map = 'Mirage', title = '校园五排 · 排位赛'): Report {
  return {
    id,
    map,
    title,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    score: [13, 9],
    status: 'completed',
    rating: 1.24,
    adr: 86.5,
    kast: 77.3,
    kills: 24,
    deaths: 16,
    assists: 7,
    headshotRate: 54,
    privacy: 'private',
    rounds: Array.from({ length: 22 }, (_, i) => ({
      round: i + 1,
      won: ![1, 3, 4, 8, 10, 13, 15, 18, 20].includes(i),
      economy: i % 12 === 0 ? 4000 : 12000 + ((i * 3347) % 17000),
      enemyEconomy: i % 12 === 0 ? 4100 : 11000 + ((i * 5417) % 17000),
    })),
    radar: [
      { x: 22, y: 24, count: 6 },
      { x: 65, y: 25, count: 9 },
      { x: 46, y: 48, count: 12 },
      { x: 73, y: 66, count: 5 },
      { x: 25, y: 72, count: 8 },
      { x: 53, y: 28, count: 4 },
    ],
    utility: [
      { label: '闪光助攻', value: 5, unit: '次' },
      { label: '投掷物伤害', value: 214, unit: 'HP' },
      { label: '有效致盲', value: 12, unit: '次' },
    ],
    strengths: [
      '首轮交火贡献稳定，开场击杀为队伍创造了人数优势。',
      '长枪局平均伤害表现良好，保持当前补枪距离。',
    ],
    suggestions: [
      '减少单人重复探点，进攻前先与队友约定闪光配合。',
      '本场中路死亡较集中，建议复习连接与拱门的交叉火力。',
      '进行一组 Gridshot 定位训练，再回顾关键交火回合。',
    ],
  }
}
export const initialReports: Report[] = [
  makeReport('sample-mirage'),
  {
    ...makeReport('sample-inferno', 'Inferno', '和朋友的周末五排'),
    score: [10, 13],
    rating: 0.96,
    adr: 71.2,
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    ...makeReport('sample-dust2', 'Dust II', '电竞社训练赛'),
    score: [13, 7],
    rating: 1.38,
    adr: 94.1,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
]

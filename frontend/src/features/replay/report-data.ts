import type {
  AnalysisReport,
  DetailedRound,
  ReplayDetails,
  ReplayEvent,
  RoundStatistics,
} from './contracts'

export const statusLabels: Record<string, string> = {
  queued: '排队中',
  running: '分析中',
  completed: '已完成',
  partial: '部分可用',
  failed: '失败',
  not_computed: '尚未计算',
  insufficient_data: '数据不足',
}
export const moduleLabels: Record<string, string> = {
  basic_stats: '基础表现',
  utility: '道具效果',
  death_context: '死亡前状态',
  reaction: '接敌开火延迟',
  crosshair: '预瞄分析',
  movement_shooting: '移动射击',
  trajectory_quality: '轨迹数据质量',
}
export const metricLabels: Record<string, string> = {
  adr: 'ADR',
  kills: '击杀',
  deaths: '死亡',
  assists: '助攻',
  kast_pct: 'KAST（%）',
  headshot_pct: '爆头率（%）',
  opening_kills: '首杀',
  opening_deaths: '首死',
  flashes_thrown: '闪光投掷数',
  enemies_blinded: '敌方致盲人次',
  teammates_blinded: '队友致盲人次',
  self_blinds: '自闪人次',
  team_blinding_events: '致盲队友事件',
  enemy_blind_seconds: '敌方致盲时长（秒）',
  unclassified_blinds: '敌我身份未知的致盲人次',
  deaths_with_context: '有状态记录的死亡',
  missing_snapshots: '缺少快照的死亡',
  deaths_holding_grenade: '持道具阵亡',
  deaths_reloading: '换弹时阵亡',
  deaths_blinded: '受闪状态阵亡',
  deaths_with_unused_utility: '仍有道具时阵亡',
  total_projectiles: '记录的道具轨迹',
  unattributed_projectiles: '投掷者未知的轨迹',
  target_trajectories: '目标玩家轨迹',
}
export const eventLabels: Record<string, string> = {
  kill: '击杀',
  damage: '伤害',
  weapon_fire: '开火',
  blind: '致盲',
  flash_effect: '闪光效果',
  death_context: '死亡状态',
  bomb_action: '炸弹事件',
  item_event: '物品交易',
  smoke: '烟雾',
  fire: '燃烧区域',
  unattributed_grenade: '归属未知的道具',
}
export const reasonLabels: Record<string, string> = {
  opening_kill: '记录中的首杀',
  opening_death: '记录中的首死',
  multikill: '多杀',
  review_candidates: '规则命中',
}
export function numberText(value: unknown, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value)
    : '未知'
}
export function secondsText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} 秒` : '时间未知'
}
export function assertDetailsIdentity(details: ReplayDetails, report: AnalysisReport) {
  if (
    details.source?.match_id !== report.match_id ||
    details.source?.package_id !== report.package_id ||
    details.target_player_id !== report.target_player_id
  )
    throw new Error('扩展详情与当前报告身份不一致，已停止接收')
}
export function roundRows(
  details: ReplayDetails,
): (DetailedRound & {
  stats: RoundStatistics
  ownEconomy: number | null
  enemyEconomy: number | null
  outcome: string
})[] {
  const table = new Map(details.statistics.tables?.per_round?.map((row) => [row.round_num, row]))
  return details.rounds
    .map((round) => {
      const side = round.target_side
      const own = side ? round.team_economy?.find((row) => row.side === side) : undefined
      const enemySide =
        side === 'terrorist'
          ? 'counter-terrorist'
          : side === 'counter-terrorist'
            ? 'terrorist'
            : null
      const enemy = enemySide
        ? round.team_economy?.find((row) => row.side === enemySide)
        : undefined
      return {
        ...round,
        stats: table.get(round.round_num) || round.target_summary || { round_num: round.round_num },
        ownEconomy: own?.equipment_value ?? null,
        enemyEconomy: enemy?.equipment_value ?? null,
        outcome: !side || !round.winner_side ? '未知' : round.winner_side === side ? '胜' : '负',
      }
    })
    .sort((a, b) => a.round_num - b.round_num)
}
export function describeEvent(event: ReplayEvent): string {
  const r = event.data.record || {}
  const name = (key: string) => (typeof r[key] === 'string' ? String(r[key]) : '未知玩家')
  const weapon = typeof r.weapon === 'string' ? r.weapon.replace(/^weapon_/, '') : '武器未知'
  if (event.type === 'kill')
    return `${name('attacker_name')} → ${name('victim_name')} · ${weapon}${r.headshot === true ? ' · 爆头' : ''}`
  if (event.type === 'damage')
    return `${name('attacker_name')} → ${name('victim_name')} · 原始生命伤害 ${numberText(r.dmg_health, 0)} · ${weapon}`
  if (event.type === 'weapon_fire') return `${name('name')} · ${weapon}`
  if (event.type === 'blind')
    return `${name('attacker_name')} → ${name('victim_name')} · 致盲 ${secondsText(r.duration)}`
  if (event.type === 'death_context')
    return `死亡时持有 ${String(event.data.active_weapon || '未知武器')}${event.data.is_reloading === true ? ' · 换弹中' : ''}`
  if (event.type === 'bomb_action') return `${name('name')} · ${String(r.event || '炸弹状态变化')}`
  return String(r.weapon || r.item || r.event || eventLabels[event.type] || event.type)
}

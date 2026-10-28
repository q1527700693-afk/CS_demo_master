import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'
import { numberText } from './report-data'

// Presentation registry: backend keys never become user-facing labels by accident.
export const reviewTabs = [
  { id: 'overview', label: '比赛概览', icon: 'overview' },
  { id: 'rounds', label: '回合复盘', icon: 'map' },
  { id: 'utility', label: '道具与生存', icon: 'shield' },
  { id: 'ai', label: 'AI 教练', icon: 'bolt' },
  { id: 'data', label: '详细数据', icon: 'replay' },
] as const
export type ReviewTab = (typeof reviewTabs)[number]['id']
export const mapNames: Record<string, string> = {
  de_mirage: '荒漠迷城',
  de_inferno: '炼狱小镇',
  de_dust2: '炙热沙城Ⅱ',
  de_nuke: '核子危机',
  de_ancient: '远古遗迹',
  de_anubis: '阿努比斯',
  de_overpass: '死亡游乐园',
  de_vertigo: '殒命大厦',
  de_train: '列车停放站',
  de_cache: '死城之谜',
  cs_office: '办公室',
  cs_italy: '意大利小镇',
}
export const mapName = (id: string) => mapNames[id] || '自定义地图'
export const sideName = (side?: string | null) =>
  side === 'terrorist' ? '进攻方' : side === 'counter-terrorist' ? '防守方' : '阵营未记录'
export const weaponNames: Record<string, string> = {
  ak47: 'AK-47',
  awp: 'AWP',
  m4a1: 'M4A4',
  m4a1_silencer: 'M4A1 消音型',
  usp_silencer: 'USP 消音型',
  glock: '格洛克',
  deagle: '沙漠之鹰',
  elite: '双持贝瑞塔',
  fiveseven: 'FN57',
  hkp2000: 'P2000',
  p250: 'P250',
  tec9: 'Tec-9',
  cz75a: 'CZ75',
  ssg08: 'SSG 08',
  aug: 'AUG',
  sg556: 'SG 553',
  famas: '法玛斯',
  galilar: '加利尔',
  mp9: 'MP9',
  mac10: 'MAC-10',
  mp7: 'MP7',
  mp5sd: 'MP5 消音型',
  ump45: 'UMP-45',
  p90: 'P90',
  bizon: '野牛',
  nova: '新星',
  xm1014: 'XM1014',
  mag7: 'MAG-7',
  sawedoff: '截短霰弹枪',
  negev: '内格夫',
  m249: 'M249',
  scar20: 'SCAR-20',
  g3sg1: 'G3SG1',
  revolver: 'R8 左轮',
  taser: '电击枪',
  knife: '匕首',
  flashbang: '闪光弹',
  flash: '闪光弹',
  hegrenade: '高爆手雷',
  he: '高爆手雷',
  smokegrenade: '烟雾弹',
  smoke: '烟雾弹',
  molotov: '燃烧瓶',
  incgrenade: '燃烧弹',
  incendiary: '燃烧弹',
  inferno: '燃烧伤害',
  fire: '燃烧弹',
  decoy: '诱饵弹',
  c4: '炸弹',
}
export function weaponName(value: unknown) {
  if (typeof value !== 'string' || !value) return '未记录武器'
  const id = value.replace(/^weapon_/, '')
  return weaponNames[id] || (/knife|bayonet/.test(id) ? '匕首' : '其他武器')
}
export const metricDefinitions: Record<string, string> = {
  adr: '平均每回合对敌方造成的有效伤害，来自解析器的比赛统计。',
  kast_pct: '有击杀、助攻、存活或被队友补枪的回合占比。同一回合只计一次。',
  headshot_pct: '爆头击杀数占全部击杀数的比例。',
  opening: '每回合第一起敌我击杀中，由你完成首杀或首先阵亡的次数。',
  raw_damage: '逐条伤害事件的原始合计，包含过量伤害，不等同于场均伤害。',
}
export const valueText = (value: unknown, digits = 1) =>
  typeof value === 'number' && Number.isFinite(value) ? numberText(value, digits) : '—'
export function clockText(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '时间未记录'
  const n = Math.floor(Math.abs(seconds))
  return `${seconds < 0 ? '准备 ' : ''}${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
}
export interface ReviewFocus {
  id: string
  rule: string
  round: number | null
  tick: number
  seconds: number | null
  title: string
  observation: string
  action: string
  evidenceIds: string[]
  priority: number
}
type RuleCopy = { title: string; action: string; priority: number }
export const reviewRules: Record<string, RuleCopy> = {
  death_reloading: {
    title: '换弹时阵亡',
    action: '定位阵亡前 5 秒，检查剩余弹药、掩体与换弹时机。',
    priority: 3,
  },
  death_holding_utility: {
    title: '持道具时阵亡',
    action: '检查投掷位置、队友掩护和切回主武器的时机。',
    priority: 3,
  },
  death_unused_utility: {
    title: '携带道具阵亡',
    action: '检查背包中剩余道具，并回看接敌前是否有安全使用窗口。',
    priority: 1,
  },
  team_flash: {
    title: '闪光波及队友',
    action: '回看闪光生效时的队友位置，对齐投掷口令和转身时机。',
    priority: 2,
  },
  self_flash: {
    title: '受到自己的闪光影响',
    action: '检查投掷角度和背身躲闪的时间。',
    priority: 2,
  },
}
export function reviewFocus(
  report: AnalysisReport,
  details: ReplayDetails | null,
  events: ReplayEvent[],
): ReviewFocus[] {
  const index = new Map(events.map((e) => [e.event_id, e]))
  const findings =
    details?.findings ||
    report.report.findings.map((f) => ({
      finding_id: f.finding_id,
      rule_id: f.finding_id.split(':')[0]!,
      round_num: null,
      tick: 0,
      observation: f.description,
      evidence_ids: f.evidence_ids,
    }))
  return findings
    .map((f) => {
      const event = f.evidence_ids.map((id) => index.get(id)).find(Boolean)
      const copy = reviewRules[f.rule_id]
      const duration = event?.data.record?.duration
      let observation = f.observation
      if (
        (f.rule_id === 'team_flash' || f.rule_id === 'self_flash') &&
        typeof duration === 'number'
      ) {
        const victim = event?.data.record?.victim_name
        observation = `${typeof victim === 'string' ? victim : f.rule_id === 'self_flash' ? '自己' : '队友'} 被致盲 ${duration.toFixed(2)} 秒`
      }
      if (f.rule_id === 'death_unused_utility' && event) {
        const inventory = [
          ['flashbangs', '闪光弹'],
          ['smoke_grenades', '烟雾弹'],
          ['he_grenades', '高爆手雷'],
          ['fire_grenades', '燃烧道具'],
        ]
          .filter(([key]) => typeof event.data[key!] === 'number' && Number(event.data[key!]) > 0)
          .map(([key, label]) => `${label} × ${event.data[key!]}`)
        if (inventory.length) observation = `阵亡时剩余：${inventory.join('、')}`
      }
      return {
        id: f.finding_id,
        rule: f.rule_id,
        round: f.round_num ?? event?.round_num ?? null,
        tick: event?.tick ?? f.tick,
        seconds:
          event?.live_elapsed_seconds ??
          ('live_elapsed_seconds' in f ? (f.live_elapsed_seconds as number) : null),
        title: copy?.title || '比赛事件',
        observation,
        action: copy?.action || '定位事件，结合回合地图查看前后过程。',
        evidenceIds: f.evidence_ids,
        priority:
          typeof duration === 'number'
            ? duration >= 2
              ? 4
              : duration >= 1
                ? 2
                : 0
            : (copy?.priority ?? 0),
      }
    })
    .sort((a, b) => b.priority - a.priority || (a.round ?? 0) - (b.round ?? 0) || a.tick - b.tick)
}
export function isTargetEvent(e: ReplayEvent, player: string) {
  const r = e.data.record || {}
  return (
    e.type === 'death_context' ||
    ['attacker_steamid', 'victim_steamid', 'assister_steamid', 'steamid'].some(
      (k) => r[k] === player,
    )
  )
}
export function eventSentence(e: ReplayEvent) {
  const r = e.data.record || {},
    name = (key: string) => (typeof r[key] === 'string' ? String(r[key]) : '未记录玩家')
  if (e.type === 'kill')
    return `${name('attacker_name')} 击杀 ${name('victim_name')} · ${weaponName(r.weapon)}${r.headshot === true ? ' · 爆头' : ''}`
  if (e.type === 'damage')
    return `${name('attacker_name')} → ${name('victim_name')} · ${valueText(r.dmg_health, 0)} 原始伤害 · ${weaponName(r.weapon)}`
  if (e.type === 'blind')
    return `${name('attacker_name')} → ${name('victim_name')} · 致盲 ${valueText(r.duration, 2)} 秒`
  if (e.type === 'weapon_fire') return `${name('name')} · ${weaponName(r.weapon)}`
  if (e.type === 'death_context')
    return `阵亡时持有${weaponName(e.data.active_weapon)}${e.data.is_reloading === true ? ' · 换弹中' : ''}`
  if (e.type === 'bomb_action') {
    const labels: Record<string, string> = {
      bomb_planted: '安放炸弹',
      bomb_defused: '拆除炸弹',
      bomb_exploded: '炸弹爆炸',
      bomb_beginplant: '开始安放',
      bomb_abortplant: '取消安放',
      bomb_begindefuse: '开始拆弹',
      bomb_abortdefuse: '取消拆弹',
      bomb_pickup: '拾取炸弹',
      bomb_dropped: '掉落炸弹',
      pickup: '拾取炸弹',
      drop: '掉落炸弹',
      begin_plant: '开始安放',
      finish_plant: '安放炸弹',
      abort_plant: '取消安放',
      begin_defuse: '开始拆弹',
      finish_defuse: '拆除炸弹',
      abort_defuse: '取消拆弹',
      explode: '炸弹爆炸',
    }
    return `${name('name')} · ${labels[String(r.event)] || '炸弹状态变化'}${r.bombsite === 'A' || r.bombsite === 'B' ? ` · ${r.bombsite} 区` : ''}`
  }
  if (e.type === 'item_event') return `${name('name')} · ${weaponName(r.item || r.weapon)}`
  if (e.type === 'flash_effect') return '闪光弹效果记录'
  if (e.type === 'smoke') return '烟雾弹生效记录'
  if (e.type === 'fire') return '燃烧区域记录'
  return '比赛事件记录'
}

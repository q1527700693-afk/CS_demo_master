export type ModuleStatus = 'completed' | 'partial' | 'not_computed' | 'insufficient_data' | 'failed'
export interface AnalysisModule {
  module_version: string
  status: ModuleStatus
  reason: string | null
  sample_count: number
  metrics: Record<string, number | null> | null
  evidence_ids: string[]
  evaluation_status?: string
}
export interface MatchInfo {
  started_at: string | null
  started_at_source: string
  map: string
  tick_rate: number
  complete: boolean
  teams: { team_id: string; name: string; score: number | null }[]
}
export interface AcceptedPackage {
  match_id: string
  package_id: string
  target_player_id: string
  uploaded_at: string
  reused?: boolean
}
export interface AnalysisRun {
  analysis_id: string
  match_id: string
  package_id: string
  target_player_id: string
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  stage: string
  progress: number | null
  message: string
  report_available: boolean
  created_at?: string
  analyzed_at?: string | null
}
export interface AnalysisReport extends AcceptedPackage {
  report_schema_version: string
  analysis_id: string
  status: string
  match: MatchInfo
  analyzed_at: string
  is_fixture: boolean
  perspective: { player_team_id: string | null }
  versions: { evaluation: string; prompt: string }
  report: {
    modules: Record<string, AnalysisModule>
    scores: Record<string, number>
    findings: {
      finding_id: string
      module: string
      description: string
      evidence_ids: string[]
      package_id: string
    }[]
    training_suggestions: string[]
    ai_status: string
    warnings: string[]
  }
}
export interface MatchRecord {
  match_id: string
  match: MatchInfo
  created_at: string
  latest_analysis: AnalysisRun | null
  latest_available_analysis_id: string | null
  summary: {
    adr: number | null
    rating: number | null
    player_team_id: string | null
    status: string
  } | null
}
export interface LocalJob {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  stage: string
  percent: number | null
  message: string
}
export interface StageProgress {
  stage: 'local' | 'upload' | 'cloud' | 'download'
  label: string
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed'
  percent: number | null
  message: string
}

export interface ReplayEvent {
  event_id: string
  type: string
  round_num: number | null
  tick: number
  live_elapsed_seconds?: number | null
  data: Record<string, unknown> & { record?: Record<string, unknown> }
}
export interface RoundStatistics {
  round_num: number
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  weapon_fire_events?: number | null
  raw_health_damage_dealt?: number | null
  raw_health_damage_received?: number | null
  recorded_purchase_cost?: number | null
}
export interface WeaponStatistics {
  weapon: string
  shots?: number | null
  kills?: number | null
  deaths?: number | null
  raw_health_damage_dealt?: number | null
  raw_health_damage_received?: number | null
}
export interface DetailedRound {
  round_num: number
  winner_side?: string | null
  target_side?: string | null
  team_economy?: { side: string; equipment_value: number | null; buy_type?: string }[]
  target_summary?: RoundStatistics
}
export interface ReplayDetails {
  export_scope?: { scope: string }
  source: { match_id: string; package_id: string }
  target_player_id: string
  target_player?: { player_id: string; name: string; team_id?: string | null }
  statistics: {
    tables?: { per_round?: RoundStatistics[]; by_weapon?: WeaponStatistics[] }
    source_player_stats?: Record<string, number | null>
    definitions?: Record<string, string>
  }
  rounds: DetailedRound[]
  findings: {
    finding_id: string
    rule_id: string
    round_num: number | null
    tick: number
    evidence_ids: string[]
    observation: string
    review_prompt: string
    live_elapsed_seconds?: number | null
  }[]
  key_rounds: { round_num: number; reasons: string[]; evidence_ids: string[] }[]
  movement: {
    status: string
    measured_fire_ticks: number
    eligible_fire_ticks: number
    mean_horizontal_speed: number | null
    max_horizontal_speed: number | null
    jumping_fire_ticks: number
    interpretation: string
  }
  map: { counts: Record<string, number>; sampling?: Record<string, unknown> }
  data_quality?: { warnings?: string[] }
}
export interface ReplayMapItem {
  kind: string
  tick?: number
  start_tick?: number
  end_tick?: number
  round_num?: number | null
  live_elapsed_seconds?: number | null
  state?: {
    x?: number | null
    y?: number | null
    z?: number | null
    health?: number | null
    name?: string | null
    steamid?: string
    side?: string | null
    yaw?: number | null
    active_weapon?: string | null
  }
  event_id?: string
  trajectory_id?: string
  thrower_player_id?: string | null
  ownership?: 'known' | 'unknown' | 'conflicting'
  type?: string
  points?: [number | null, number | null, number | null][]
  point_ticks?: number[]
  neighbors?: {
    player_id: string
    name?: string
    side?: string | null
    x: number
    y: number
    z?: number | null
    health?: number | null
  }[]
}
export interface RoundDetail extends DetailedRound {
  start_tick: number | null
  end_tick: number
  freeze_end_tick?: number | null
  target_start_state?: { side?: string | null }
  events: ReplayEvent[]
  finding_ids: string[]
}

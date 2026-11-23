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
  performance?: PerformanceFacts
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
  team_kills?: number | null
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
  team_kills?: number | null
  kills?: number | null
  deaths?: number | null
  raw_health_damage_dealt?: number | null
  raw_health_damage_received?: number | null
}
export interface DetailedRound {
  round_num: number
  is_knife_round?: boolean
  winner_side?: string | null
  target_side?: string | null
  target_start_state?: { side?: string | null; steamid?: string | null } | null
  team_economy?: { side: string; equipment_value: number | null; buy_type?: string }[]
  target_summary?: RoundStatistics
}
export interface ReplayDetails {
  performance?: PerformanceFacts
  analysis_version?: string
  players?: { player_id: string; name: string }[]
  match?: Partial<MatchInfo> & { rounds_played?: number }
  export_scope?: { scope: string }
  source: {
    match_id: string
    package_id: string
    kind?: string
    demo?: { sha256: string; file_name?: string }
  }
  target_player_id: string
  target_player?: { player_id: string; name: string; team_id?: string | null }
  statistics: {
    modules?: Record<string, AnalysisModule>
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
export interface PerformanceFacts {
  utility_throws?: {
    source: string | null
    complete: boolean
    items: { weapon: string; throws: number | null; lower_bound?: boolean }[]
  }
  version: string
  target_player_id: string
  complete: boolean
  damage_basis: 'raw' | 'effective'
  modules: Record<string, Record<string, number | null>>
  findings: ReplayDetails['findings']
  rounds: {
    round_num: number
    target_side: string | null
    team_economy: NonNullable<DetailedRound['team_economy']>
    target_summary: RoundStatistics
  }[]
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
  end_tick: number | null
  freeze_end_tick?: number | null
  events: ReplayEvent[]
  finding_ids: string[]
}

export type AiStatus = 'completed' | 'not_generated' | 'not_configured' | 'queued'
export interface AiImprovementArea {
  priority: 'high' | 'medium' | 'low'
  category: string
  title: string
  evidence_ids: string[]
  explanation: string
  training: string[]
}
export interface AiStrength {
  title: string
  evidence_ids: string[]
  explanation: string
}
export interface AiCoachReport {
  queued?: boolean
  stage?: string | null
  last_error?: string | null
  ai_status: AiStatus
  analysis_id?: string
  model?: string
  prompt_version?: string
  generated_at?: string
  summary?: string
  improvement_areas?: AiImprovementArea[]
  strengths?: AiStrength[]
  data_limitations?: string[]
}

export interface CloudTeam {
  team_clan_name: string
  names: string[]
  steamids: string[]
  sides?: string[]
}

export interface Dust2DefenseProfile {
  status: string
  rounds_observed: number
  scout_rounds?: number[]
  initial?: { A: number | null; B: number | null; MID: number | null }
  plant_rounds?: { A: number; B: number }
  hold_rate?: { A: number | null; B: number | null }
  retake_seconds?: { A: number | null; B: number | null }
  rotation?: {
    sampled_rounds: number
    rotated_rounds: number
    average_seconds: number | null
    speed: string
    abandoned_opposite_rounds: number
    by_site?: {
      A?: { sampled_rounds: number; average_seconds: number | null }
      B?: { sampled_rounds: number; average_seconds: number | null }
    }
  }
  weaknesses?: { A: number; B: number; weaker_site: 'A' | 'B' | null }
  confidence?: 'low' | 'medium' | string
  signals?: string[]
}

export interface Dust2RoundReview {
  outcome: 'win' | 'loss'
  actual_site: 'A' | 'B' | null
  actual_primary_tactic_id: string | null
  followed_plan: boolean | null
  opening_credit?: { steamid: string | null; name: string; weapon: string | null } | null
  opening_death?: { steamid: string | null; name: string; weapon: string | null } | null
  credits: string[]
  causes: string[]
  suggestions: string[]
}

export interface Dust2SiteRecommendation {
  round_num: number
  primary_site: 'A' | 'B'
  secondary_site: 'A' | 'B'
  site_scores: { A: number; B: number }
  recommended_tactic_id: string
  recommended_tactic_name: string
  recommendation_type?: string
  confidence: 'low' | 'medium' | string
  reasons: string[]
  risks: string[]
  spawns?: { slot_id: string; slot_label?: string; steamid: string }[]
  spawn_labels?: string[]
  economy?: {
    own: {
      buy_type: string | null
      buy_label?: string
      equipment_value: number | null
      players: number | null
    }
    enemy: {
      buy_type: string | null
      buy_label?: string
      equipment_value: number | null
      players: number | null
    }
  }
  utility?: {
    flashbangs: number
    smoke_grenades: number
    he_grenades: number
    fire_grenades: number
    total: number
  }
  review?: Dust2RoundReview | null
}

export interface WeaponHighlightWeapon {
  weapon: string
  weapon_label: string
  category: string
  cost: number | null
  kills: number
  first_bloods: number
  economy_kills: number
  multi_kill_rounds: number
}

export interface WeaponHighlight {
  player_name: string
  team_clan_name?: string | null
  kills: number
  headshots: number
  first_bloods: number
  economy_kills: number
  low_cost_kills: number
  multi_kill_rounds: number
  impact_score: number
  weapons?: WeaponHighlightWeapon[]
  weapon?: string
  weapon_label?: string
  category?: string
  cost?: number | null
  rounds: number[]
  reason: string
  evidence_ids: string[]
}

export interface Dust2PlayerWeaponImpact {
  name: string
  team_clan_name?: string | null
  side?: string | null
  kills: number
  first_bloods: number
  economy_kills: number
  weapon_impact_score: number
  top_weapons: { weapon: string; weapon_label: string; category: string; kills: number }[]
}

export interface Dust2WeaponTransition {
  player_name: string
  round_num: number
  from_label: string
  to_label: string
  confidence: string
  evidence_hint?: string
}

export interface Dust2Summary {
  status: string
  map: string
  own_team: { label: string; team_clan_name: string | null; steamids: string[] | null }
  opponent_team: { label: string; team_clan_name: string | null; steamids: string[] | null }
  scout_defense_profile: Dust2DefenseProfile
  round_recommendations: Dust2SiteRecommendation[]
  weapon_highlights?: WeaponHighlight[]
  weapon_profiles?: {
    name: string
    team_clan_name?: string | null
    side?: string | null
    top_weapons: { weapon: string; weapon_label: string; category: string; kills: number }[]
  }[]
  limitations: string[]
  player_weapon_impact?: Dust2PlayerWeaponImpact[]
  weapon_transitions?: Dust2WeaponTransition[]
  weapon_limitations?: string[]
}

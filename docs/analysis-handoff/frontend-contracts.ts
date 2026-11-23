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

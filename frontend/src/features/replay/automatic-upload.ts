import { transfer } from './analysis-api'
import { validatePackage } from './validation'
import type { LocalJob } from './contracts'
import type { RosterPlayer } from './player-identity'

export interface AutomaticLocalJob extends LocalJob {
  players?: RosterPlayer[]
  active_target_player_id?: string
}
export function validateAnalysisFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (file.name.toLowerCase().endsWith('.zip')) return validatePackage(file)
  if (!file.name.toLowerCase().endsWith('.dem')) return '请选择 .dem 比赛录像或 .zip 分析包'
  if (!file.size || file.size > 1024 ** 3) return 'Demo 必须非空且不超过 1 GB'
  return null
}
// Same-origin local connection: the local dev server supplies the companion token.
// Cloud JWTs never go to the companion; raw demos never go to the cloud API.
export const companion = {
  health: (signal: AbortSignal) =>
    transfer<{ awpy_available: boolean }>('/local/health', '', () => {}, { signal }),
  start: (file: File, signal: AbortSignal, progress: (n: number | null) => void) =>
    transfer<{ job_id: string }>('/local/jobs', '', progress, { file, signal }),
  state: (id: string, signal: AbortSignal) =>
    transfer<AutomaticLocalJob>(`/local/jobs/${encodeURIComponent(id)}`, '', () => {}, { signal }),
  export: (id: string, player: string, signal: AbortSignal) =>
    transfer<{ job_id: string }>(`/local/jobs/${encodeURIComponent(id)}/exports`, '', () => {}, {
      json: { target_player_id: player, nickname_query: '', identity_confirmed: true },
      signal,
    }),
  package: (id: string, player: string, signal: AbortSignal) =>
    transfer<Blob>(
      `/local/jobs/${encodeURIComponent(id)}/package?target_player_id=${encodeURIComponent(player)}`,
      '',
      () => {},
      { blob: true, signal },
    ),
}

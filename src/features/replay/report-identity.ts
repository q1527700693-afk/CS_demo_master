import type { AnalysisReport } from './contracts'

export type ReportIdentity = Pick<AnalysisReport, 'analysis_id'> &
  Partial<Pick<AnalysisReport, 'match_id' | 'package_id' | 'target_player_id'>>

/** Reject responses from another match/run before they reach the report cache. */
export function assertReportIdentity(
  value: unknown,
  expected: ReportIdentity,
): asserts value is AnalysisReport {
  if (!value || typeof value !== 'object') throw new Error('报告格式无效')
  const report = value as Record<string, unknown>
  if (report.report_schema_version !== '1.0.0') throw new Error('报告协议版本暂不支持，请更新前端')
  for (const key of ['analysis_id', 'match_id', 'package_id', 'target_player_id'] as const) {
    if (typeof report[key] !== 'string' || !report[key]) throw new Error(`报告缺少 ${key}`)
    if (expected[key] !== undefined && report[key] !== expected[key])
      throw new Error(`报告 ${key} 与当前任务不一致，已停止接收`)
  }
}

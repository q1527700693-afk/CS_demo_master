import { mapName } from './review-presentation'
export function analysisName(
  player: string | null | undefined,
  date: string | null | undefined,
  map: string | null | undefined,
  id = '',
) {
  const value = date ? new Date(date) : null
  const time =
    value && Number.isFinite(value.getTime())
      ? new Intl.DateTimeFormat('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).format(value)
      : '时间未记录'
  return `${player || '玩家未记录'} · ${time} · ${map ? mapName(map) : '地图待解析'}${id ? ` · ${id.replace(/^cloud:/, '').slice(0, 6)}` : ''}`
}

import { mapName } from './review-presentation'
export function analysisName(
  player: string | null | undefined,
  map: string | null | undefined,
  sequence?: number,
) {
  const prefix =
    sequence && Number.isSafeInteger(sequence) && sequence > 0
      ? `#${String(sequence).padStart(2, '0')} · `
      : ''
  return `${prefix}${player || '玩家未记录'} · ${map ? mapName(map) : '地图待解析'}`
}

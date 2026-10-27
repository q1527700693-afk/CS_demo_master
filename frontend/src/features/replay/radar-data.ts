import metadata from './radar-metadata.json'
import type { ReplayMapItem } from './contracts'

export interface RadarAsset {
  pos_x: number
  pos_y: number
  scale: number
  image: string
  lowerImage?: string
  lowerMax?: number
  version: string
  labels?: { x: number; y: number; text: string }[]
}
export const RADAR_VERSION = '2000933'
const supported = new Set([
  'ar_baggage',
  'ar_shoots',
  'ar_shoots_night',
  'cs_italy',
  'cs_office',
  'de_ancient',
  'de_ancient_night',
  'de_anubis',
  'de_cache',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_overpass',
  'de_train',
  'de_vertigo',
])
export function radarAsset(map: string): RadarAsset | null {
  if (!supported.has(map)) return null
  const data = (
    metadata as Record<
      string,
      {
        pos_x: number
        pos_y: number
        scale: number
        verticalsections?: { lower?: { AltitudeMax: string } }
      }
    >
  )[map]
  if (!data || data.scale <= 0) return null
  const base = `/maps/${RADAR_VERSION}/radars/${map}`
  return {
    ...data,
    version: RADAR_VERSION,
    image: `${base}.png`,
    ...(data.verticalsections?.lower
      ? {
          lowerImage: `${base}_lower.png`,
          lowerMax: Number(data.verticalsections.lower.AltitudeMax),
        }
      : {}),
    labels:
      map === 'de_mirage'
        ? [
            { x: 565, y: 784, text: 'A' },
            { x: 230, y: 280, text: 'B' },
            { x: 530, y: 470, text: '中路' },
          ]
        : [],
  }
}
// Same north-up, 1024px transform as awpy.plot.world_to_pixel. `rotate` and `zoom`
// are in-game HUD settings, not a transform to apply to the exported PNG.
export function worldToRadar(asset: RadarAsset, x: number, y: number) {
  return { x: (x - asset.pos_x) / asset.scale, y: (asset.pos_y - y) / asset.scale }
}
export function onRadarFloor(asset: RadarAsset, z: number | null | undefined, lower: boolean) {
  if (asset.lowerMax == null) return true
  if (z == null || !Number.isFinite(z)) return false
  return lower ? z < asset.lowerMax : z >= asset.lowerMax
}
export function sampleAt(samples: ReplayMapItem[], tick: number, maxAge: number) {
  let low = 0,
    high = samples.length - 1,
    result: ReplayMapItem | undefined
  while (low <= high) {
    const mid = (low + high) >>> 1,
      sample = samples[mid]!
    if ((sample.tick ?? Infinity) <= tick) {
      result = sample
      low = mid + 1
    } else high = mid - 1
  }
  return result && tick - (result.tick ?? 0) <= maxAge ? result : undefined
}
export function trajectoryPoints(item: ReplayMapItem, tick: number, entire: boolean) {
  if (entire) return item.points || []
  // A path without point times cannot be progressively reconstructed. Only show it once complete.
  if (!item.point_ticks || item.point_ticks.length !== item.points?.length)
    return item.end_tick != null && item.end_tick <= tick ? item.points || [] : []
  return (item.points || []).filter((_p, i) => item.point_ticks![i]! <= tick)
}

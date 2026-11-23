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
export function mapId(map: string) {
  return map
    .toLowerCase()
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)!
    .replace(/\.(bsp|vpk)$/, '')
}
export function radarAsset(map: string): RadarAsset | null {
  map = mapId(map)
  if (!Object.hasOwn(metadata, map)) return null
  const data = (
    metadata as Record<
      string,
      {
        pos_x: number
        pos_y: number
        scale: number
        version?: string
        verticalsections?: { lower?: { AltitudeMax: string | number } }
      }
    >
  )[map]
  if (!data || data.scale <= 0) return null
  const version = data.version ?? RADAR_VERSION
  const base = `/maps/${version}/radars/${map}`
  return {
    ...data,
    version,
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
export function lastAt<T>(samples: T[], tick: number, time: (item: T) => number) {
  let low = 0,
    high = samples.length - 1,
    result = -1
  while (low <= high) {
    const mid = (low + high) >>> 1,
      sample = samples[mid]!
    if (time(sample) <= tick) {
      result = mid
      low = mid + 1
    } else high = mid - 1
  }
  return result
}
const sampleTime = (s: ReplayMapItem) => s.tick ?? Infinity
export function sampleAt(samples: ReplayMapItem[], tick: number, maxAge: number) {
  const sample = samples[lastAt(samples, tick, sampleTime)]
  return sample && tick - sampleTime(sample) <= maxAge ? sample : undefined
}
export function continuous(
  a: ReplayMapItem,
  b: ReplayMapItem,
  rate: number,
  asset?: RadarAsset | null,
) {
  const p = a.state,
    q = b.state
  const gap = sampleTime(b) - sampleTime(a)
  if (
    !p ||
    !q ||
    gap <= 0 ||
    gap > rate * 0.65 ||
    p.health === 0 ||
    q.health === 0 ||
    p.side !== q.side ||
    ![p.x, p.y, q.x, q.y].every(Number.isFinite)
  )
    return false
  if (
    asset?.lowerMax != null &&
    (p.z == null || q.z == null || p.z < asset.lowerMax !== q.z < asset.lowerMax)
  )
    return false
  return Math.hypot(q.x! - p.x!, q.y! - p.y!) <= 32 + (600 * gap) / rate
}
export function positionAt(
  samples: ReplayMapItem[],
  tick: number,
  rate: number,
  asset?: RadarAsset | null,
) {
  const index = lastAt(samples, tick, sampleTime)
  const a = samples[index],
    b = samples[index + 1]
  if (!a || tick - sampleTime(a) > rate) return undefined
  if (!b || tick === a.tick || !continuous(a, b, rate, asset)) return a
  const t = (tick - a.tick!) / (b.tick! - a.tick!),
    p = a.state!,
    q = b.state!
  return {
    ...a,
    state: {
      ...p,
      x: p.x! + (q.x! - p.x!) * t,
      y: p.y! + (q.y! - p.y!) * t,
      z: p.z != null && q.z != null ? p.z + (q.z - p.z) * t : p.z,
      yaw:
        p.yaw != null && q.yaw != null ? p.yaw + (((q.yaw - p.yaw + 540) % 360) - 180) * t : p.yaw,
    },
  }
}
export function trajectoryPoints(item: ReplayMapItem, tick: number, entire: boolean) {
  if (entire) return item.points || []
  // A path without point times cannot be progressively reconstructed. Only show it once complete.
  if (!item.point_ticks || item.point_ticks.length !== item.points?.length)
    return item.end_tick != null && item.end_tick <= tick ? item.points || [] : []
  return (item.points || []).filter((_p, i) => item.point_ticks![i]! <= tick)
}

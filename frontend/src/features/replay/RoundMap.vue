<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { getRound, getRoundMap, getGlobalMapPage } from './analysis-api'
import { errorMessage } from '@/api/http'
import type { ReplayEvent, ReplayMapItem, RoundDetail } from './contracts'
import { clockText, mapName as displayMapName, weaponName } from './review-presentation'
import { onRadarFloor, radarAsset, sampleAt, trajectoryPoints, worldToRadar } from './radar-data'
import {
  groupPlayerSamples,
  playerColor,
  PLAYER_COLORS,
  utilityStyle,
  UTILITY_STYLES,
} from './map-presentation'
import { combatRelation, MIN_EFFECTIVE_BLIND_SECONDS } from './combat-facts'
import UtilitySymbol from './UtilitySymbol.vue'
const props = defineProps<{
  analysisId: string
  packageId: string
  global?: boolean
  round: number
  mapName: string
  tickRate: number
  playerName: string
  playerId: string
  seek?: { tick: number; nonce: number } | null
}>()
const emit = defineEmits<{ cursor: [tick: number]; event: [event: ReplayEvent] }>()
const items = ref<ReplayMapItem[]>([]),
  roundDetail = ref<RoundDetail | null>(null)
const loading = ref(false),
  error = ref(''),
  imageError = ref(false)
const showContext = ref(true),
  showPlayer = ref(true),
  showNeighbors = ref(true),
  showUtility = ref(true)
const entire = ref(true),
  lower = ref(false),
  playing = ref(false),
  speed = ref(2),
  tick = ref(0),
  utilityFilter = ref('all')
let controller: AbortController | undefined,
  generation = 0,
  timer: ReturnType<typeof setInterval> | undefined
const asset = computed(() => radarAsset(props.mapName))
const rate = computed(() =>
  Number.isFinite(props.tickRate) && props.tickRate > 0 ? props.tickRate : 64,
)
const sorted = (list: ReplayMapItem[]) => list.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0))
const playerGroups = computed(() => groupPlayerSamples(items.value, props.playerId, !!props.global))
const samples = computed(() => playerGroups.value.get(props.playerId) || [])
const neighborSamples = computed(() =>
  sorted(items.value.filter((i) => i.kind === 'nearby_context')),
)
const utilities = computed(() =>
  items.value.filter(
    (i) =>
      (props.global
        ? i.kind === 'all_trajectories'
        : ['trajectories', 'unattributed_trajectories'].includes(i.kind)) && i.points?.length,
  ),
)
const extent = computed(() => {
  let min = Infinity,
    max = -Infinity
  for (const i of items.value)
    for (const v of [i.tick, i.start_tick, i.end_tick])
      if (typeof v === 'number' && Number.isFinite(v)) {
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
  return {
    min:
      roundDetail.value?.freeze_end_tick ??
      roundDetail.value?.start_tick ??
      (Number.isFinite(min) ? min : 0),
    max: roundDetail.value?.end_tick ?? (Number.isFinite(max) ? max : 0),
  }
})
const elapsed = (at: number) => (at - extent.value.min) / rate.value
const duration = computed(() => Math.max(0, elapsed(extent.value.max)))
function point(x: number, y: number) {
  return worldToRadar(asset.value!, x, y)
}
function validState(i?: ReplayMapItem) {
  return i?.state && Number.isFinite(i.state.x) && Number.isFinite(i.state.y)
}
const current = computed(() => sampleAt(samples.value, tick.value, rate.value))
const selfColor = computed(() =>
  playerColor(current.value?.state?.side ?? roundDetail.value?.target_start_state?.side, true),
)
const cursor = computed(() =>
  validState(current.value) && current.value!.state!.health !== 0 ? current.value : undefined,
)
const dead = computed(() =>
  (roundDetail.value?.events || []).some(
    (e) =>
      e.tick <= tick.value && e.type === 'kill' && e.data.record?.victim_steamid === props.playerId,
  ),
)
const neighbors = computed(() => {
  if (!asset.value || !showNeighbors.value) return []
  if (props.global)
    return [...playerGroups.value]
      .filter(([id]) => id !== props.playerId)
      .flatMap(([id, list]) => {
        const s = sampleAt(list, tick.value, rate.value)?.state
        const killed = (roundDetail.value?.events || []).some(
          (e) => e.type === 'kill' && e.tick <= tick.value && e.data.record?.victim_steamid === id,
        )
        if (
          !s ||
          killed ||
          s.health === 0 ||
          !Number.isFinite(s.x) ||
          !Number.isFinite(s.y) ||
          !onRadarFloor(asset.value!, s.z, lower.value)
        )
          return []
        return [
          {
            player_id: id,
            name: s.name || id,
            side: s.side,
            x: s.x!,
            y: s.y!,
            z: s.z,
            health: s.health,
            yaw: s.yaw,
          },
        ]
      })
  const sample = sampleAt(neighborSamples.value, tick.value, rate.value)
  return (sample?.neighbors || [])
    .map((n) => ({ ...n, yaw: undefined as number | undefined }))
    .filter(
      (n) =>
        n.health !== 0 &&
        Number.isFinite(n.x) &&
        Number.isFinite(n.y) &&
        onRadarFloor(asset.value!, n.z, lower.value),
    )
})
const segments = computed(() => {
  if (!asset.value) return []
  return [...playerGroups.value].flatMap(([id, list]) => {
    if (id !== props.playerId && !showNeighbors.value) return []
    const paths: { points: string; color: string; self: boolean }[] = []
    let last: (typeof paths)[number] | undefined
    const visible = list.filter(
      (i) => (i.tick ?? 0) >= extent.value.min && (entire.value || (i.tick ?? 0) <= tick.value),
    )
    visible.slice(1).forEach((s, index) => {
      const p = visible[index]!
      if (
        !validState(s) ||
        !validState(p) ||
        s.state!.health === 0 ||
        p.state!.health === 0 ||
        (s.tick ?? 0) - (p.tick ?? 0) > rate.value ||
        !onRadarFloor(asset.value!, s.state!.z, lower.value) ||
        !onRadarFloor(asset.value!, p.state!.z, lower.value)
      ) {
        last = undefined
        return
      }
      const a = point(p.state!.x!, p.state!.y!),
        b = point(s.state!.x!, s.state!.y!)
      const color = playerColor(s.state?.side, id === props.playerId)
      if (last && last.color === color) last.points += ` ${b.x},${b.y}`
      else {
        last = { points: `${a.x},${a.y} ${b.x},${b.y}`, color, self: id === props.playerId }
        paths.push(last)
      }
    })
    return paths
  })
})
const utilityLines = computed(() => {
  if (!asset.value || !showUtility.value) return []
  return utilities.value
    .filter(
      (i) =>
        (showContext.value ||
          i.thrower_player_id === props.playerId ||
          i.kind === 'trajectories') &&
        (utilityFilter.value === 'all' || utilityStyle(i.type).kind === utilityFilter.value) &&
        (entire.value ||
          ((i.start_tick ?? Infinity) <= tick.value &&
            tick.value <= (i.end_tick ?? i.start_tick ?? 0) + rate.value * 4)),
    )
    .flatMap((i) => {
      const ps = trajectoryPoints(i, tick.value, entire.value),
        end = ps.at(-1)
      if (
        !end ||
        end[0] == null ||
        end[1] == null ||
        !Number.isFinite(end[0]) ||
        !Number.isFinite(end[1]) ||
        !onRadarFloor(asset.value!, end[2], lower.value)
      )
        return []
      const color = utilityStyle(i.type).color
      const paths: string[] = []
      let path = ''
      for (const p of ps) {
        if (
          p[0] == null ||
          p[1] == null ||
          !Number.isFinite(p[0]) ||
          !Number.isFinite(p[1]) ||
          !onRadarFloor(asset.value!, p[2], lower.value)
        ) {
          if (path) paths.push(path)
          path = ''
          continue
        }
        const at = point(p[0], p[1])
        path += `${at.x},${at.y} `
      }
      if (path) paths.push(path)
      const ownerName = i.thrower_player_id
        ? playerGroups.value.get(i.thrower_player_id)?.[0]?.state?.name || i.thrower_player_id
        : i.kind === 'trajectories'
          ? props.playerName
          : '投掷者未记录'
      return [
        {
          ...i,
          paths,
          end: point(end[0], end[1]),
          color,
          ownerName,
          unknown: i.ownership ? i.ownership !== 'known' : i.kind === 'unattributed_trajectories',
        },
      ]
    })
})
const kills = computed(() => {
  if (!asset.value) return []
  return (roundDetail.value?.events || [])
    .filter(
      (e) =>
        e.type === 'kill' &&
        (entire.value || (e.tick <= tick.value && tick.value - e.tick < rate.value * 5)),
    )
    .flatMap((e) => {
      const r = e.data.record || {},
        x = r.victim_x,
        y = r.victim_y,
        z = r.victim_z
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !onRadarFloor(asset.value!, typeof z === 'number' ? z : null, lower.value)
      )
        return []
      return [
        {
          event: e,
          ...point(x, y),
          own: r.attacker_steamid === props.playerId && combatRelation(r) === 'enemy',
          target: r.victim_steamid === props.playerId,
        },
      ]
    })
})
const keyEvents = computed(() =>
  (roundDetail.value?.events || [])
    .filter(
      (e) =>
        e.type === 'kill' ||
        (e.type === 'blind' &&
          e.data.record?.attacker_steamid === props.playerId &&
          Number(e.data.record?.duration) >= MIN_EFFECTIVE_BLIND_SECONDS),
    )
    .filter((e) => e.tick >= extent.value.min && e.tick <= extent.value.max),
)
function seekTo(value: number) {
  playing.value = false
  entire.value = false
  tick.value = Math.min(extent.value.max, Math.max(extent.value.min, value))
}
function toggleOverview() {
  playing.value = false
  entire.value = !entire.value
}
function selectTimelineEvent(event: ReplayEvent) {
  seekTo(event.tick)
  emit('event', event)
}
async function load() {
  const mine = ++generation
  controller?.abort()
  const aborter = new AbortController()
  controller = aborter
  playing.value = false
  loading.value = true
  error.value = ''
  items.value = []
  roundDetail.value = null
  try {
    const detailPromise = getRound(props.analysisId, props.round, aborter.signal)
    const mapPromise = (async () => {
      if (props.global) {
        async function pages<T>(kind: 'samples' | 'trajectories' | 'events') {
          const collected: T[] = []
          let offset: number | null = 0
          while (offset !== null) {
            const page: { items: T[]; next_offset: number | null; total: number } =
              await getGlobalMapPage<T>(props.packageId, kind, props.round, offset, aborter.signal)
            if (mine !== generation) return []
            collected.push(...page.items)
            if (
              page.next_offset !== null &&
              (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset)
            )
              throw new Error('全场数据读取中断，请重试。')
            offset = page.next_offset
          }
          return collected
        }
        const [states, paths, events] = await Promise.all([
          pages<ReplayMapItem>('samples'),
          pages<ReplayMapItem>('trajectories'),
          pages<ReplayEvent>('events'),
        ])
        return {
          items: [
            ...states.map((s) => ({ ...s, kind: 'all_player_samples' })),
            ...paths.map((s) => ({ ...s, kind: 'all_trajectories' })),
          ],
          events,
        }
      }
      const collected: ReplayMapItem[] = []
      let offset: number | null = 0
      while (offset !== null) {
        const page = await getRoundMap(props.analysisId, props.round, offset, aborter.signal)
        if (mine !== generation) return { items: [], events: null }
        collected.push(...page.items)
        if (page.next_offset !== null && page.next_offset <= offset)
          throw new Error('地图数据读取中断，请重试。')
        offset = page.next_offset
      }
      return { items: collected, events: null }
    })()
    const [detail, map] = await Promise.all([detailPromise, mapPromise])
    if (mine !== generation) return
    roundDetail.value = {
      ...detail,
      events:
        map.events?.map((e) => ({
          ...e,
          live_elapsed_seconds:
            detail.freeze_end_tick != null ? (e.tick - detail.freeze_end_tick) / rate.value : null,
        })) ?? detail.events,
    }
    items.value = map.items
    tick.value = props.global ? extent.value.min : extent.value.max
    entire.value = true
    if (props.seek) seekTo(props.seek.tick)
  } catch (e) {
    if (mine === generation) error.value = errorMessage(e)
  } finally {
    if (mine === generation) loading.value = false
  }
}
watch(() => [props.analysisId, props.packageId, props.global, props.round], load, {
  immediate: true,
})
watch(
  () => props.mapName,
  () => {
    imageError.value = false
    lower.value = false
  },
)
watch(
  () => props.seek,
  (command) => {
    if (command && !loading.value) seekTo(command.tick)
  },
)
watch(tick, (value) => emit('cursor', value))
watch(playing, (active) => {
  if (timer) clearInterval(timer)
  if (!active) return
  entire.value = false
  if (tick.value >= extent.value.max) tick.value = extent.value.min
  timer = setInterval(() => {
    tick.value = Math.min(extent.value.max, tick.value + rate.value * 0.1 * speed.value)
    if (tick.value >= extent.value.max) playing.value = false
  }, 100)
})
onUnmounted(() => {
  generation++
  controller?.abort()
  if (timer) clearInterval(timer)
})
</script>
<template>
  <div class="radar-workspace">
    <div class="radar-toolbar">
      <div class="layer-toggles">
        <label><input v-model="showPlayer" type="checkbox" />移动路线</label
        ><label><input v-model="showUtility" type="checkbox" />道具</label
        ><label
          ><input v-model="showNeighbors" type="checkbox" />{{
            global ? '其他玩家' : '附近玩家'
          }}</label
        >
      </div>
      <select v-if="asset?.lowerImage" v-model="lower" aria-label="地图楼层">
        <option :value="false">上层</option>
        <option :value="true">下层</option></select
      ><button class="map-button" :aria-pressed="entire" @click="toggleOverview">
        {{ entire ? '整回合总览' : '时间回放' }}
      </button>
    </div>
    <div v-if="loading" class="map-placeholder" role="status">
      <span class="radar-loader" />正在载入第 {{ round }} 回合…
    </div>
    <div v-else-if="error" class="map-placeholder" role="alert">
      {{ error }}<button class="button secondary compact" @click="load">重新加载</button>
    </div>
    <div v-else-if="!asset || imageError" class="map-placeholder">
      <strong>当前地图底图暂不可用</strong>
      <p>仍可使用右侧事件时间线复盘。</p>
      <button v-if="imageError" class="button secondary compact" @click="imageError = false">
        重新加载底图
      </button>
    </div>
    <template v-else>
      <div class="radar-stage">
        <div class="tactical-caption">
          <strong>{{ displayMapName(props.mapName) }}</strong
          ><span>第 {{ round }} 回合 · {{ entire ? '整回合总览' : clockText(elapsed(tick)) }}</span>
        </div>
        <svg
          class="tactical-radar"
          viewBox="0 0 1024 1024"
          role="img"
          :aria-label="`第 ${round} 回合战术地图`"
          data-testid="round-map"
        >
          <image
            :href="lower && asset.lowerImage ? asset.lowerImage : asset.image"
            width="1024"
            height="1024"
            @error="imageError = true"
            data-testid="radar-background"
          />
          <g class="radar-labels">
            <text
              v-for="label in asset.labels"
              :key="label.text"
              :x="label.x"
              :y="label.y"
              text-anchor="middle"
            >
              {{ label.text }}
            </text>
          </g>
          <g v-if="showPlayer">
            <polyline
              v-for="(line, index) in segments"
              :key="index"
              :points="line.points"
              fill="none"
              :stroke="line.color"
              :stroke-width="line.self ? 3 : 2"
              stroke-linecap="round"
              :opacity="line.self ? 0.8 : 0.3"
            />
          </g>
          <g
            v-for="line in utilityLines"
            :key="line.trajectory_id || line.event_id"
            class="utility-marker"
          >
            <polyline
              v-for="(path, i) in line.paths"
              :key="i"
              :points="path"
              fill="none"
              :stroke="line.color"
              :stroke-dasharray="line.unknown ? '7 6' : undefined"
              stroke-width="2.5"
              opacity=".85"
            />
            <g :transform="`translate(${line.end.x},${line.end.y})`">
              <UtilitySymbol :type="line.type" />
              <title>{{ utilityStyle(line.type).label }} · {{ line.ownerName }}</title>
            </g>
          </g>
          <g
            v-for="n in neighbors"
            class="neighbor-marker"
            :key="n.player_id"
            :data-player-id="n.player_id"
            :data-side="n.side"
            :transform="`translate(${point(n.x, n.y).x},${point(n.x, n.y).y})`"
          >
            <circle r="10" :fill="playerColor(n.side)" stroke="#13202a" stroke-width="2" />
            <path
              v-if="n.yaw != null"
              d="M13-5 23 0 13 5Z"
              :transform="`rotate(${-n.yaw})`"
              :fill="playerColor(n.side)"
            />
            <title>{{ n.name }} · 生命 {{ n.health ?? '—' }}</title>
            <text y="-13" text-anchor="middle" class="player-label">{{ n.name }}</text>
          </g>
          <g
            v-for="kill in kills"
            :key="kill.event.event_id"
            :transform="`translate(${kill.x},${kill.y})`"
            :class="['kill-marker', { target: kill.target }]"
            @click="emit('event', kill.event)"
          >
            <circle
              r="11"
              fill="#16212a"
              :stroke="kill.own ? '#a5d2bd' : '#db8e91'"
              stroke-width="2"
            />
            <path
              d="M-4-4 4 4M-4 4 4-4"
              :stroke="kill.own ? '#a5d2bd' : '#db8e91'"
              stroke-width="2"
            />
            <title>
              {{ kill.event.data.record?.victim_name }} ·
              {{ clockText(kill.event.live_elapsed_seconds) }}
            </title>
          </g>
          <g
            v-if="cursor && !dead && onRadarFloor(asset, cursor.state!.z, lower)"
            :transform="`translate(${point(cursor.state!.x!, cursor.state!.y!).x},${point(cursor.state!.x!, cursor.state!.y!).y})`"
            data-testid="target-marker"
            :data-player-id="playerId"
            :data-side="cursor.state!.side"
          >
            <circle r="20" :fill="selfColor" opacity=".2" />
            <circle r="11" :fill="selfColor" stroke="#f0f7ff" stroke-width="2.5" />
            <path
              v-if="cursor.state!.yaw != null"
              d="M12-5 22 0 12 5Z"
              :transform="`rotate(${-cursor.state!.yaw!})`"
              :fill="selfColor"
            />
            <text y="-24" text-anchor="middle" class="player-label target-label">
              {{ cursor.state?.name || playerName }}
            </text>
          </g>
        </svg>
        <div class="radar-legend">
          <span><i :style="{ background: PLAYER_COLORS.ct }" />警</span>
          <span><i :style="{ background: PLAYER_COLORS.t }" />匪</span>
          <span><i :style="{ background: PLAYER_COLORS.selfCt }" />{{ playerName }}（警）</span>
          <span><i :style="{ background: PLAYER_COLORS.selfT }" />{{ playerName }}（匪）</span
          ><span>× 阵亡位置</span>
        </div>
      </div>
      <div class="utility-legend" aria-label="道具标记图例">
        <span v-for="(style, kind) in UTILITY_STYLES" :key="kind">
          <svg viewBox="-20 -20 40 40" aria-hidden="true"><UtilitySymbol :type="kind" /></svg
          >{{ style.label }}
        </span>
      </div>
      <div class="playback">
        <button
          class="play-button"
          :aria-label="playing ? '暂停回放' : '播放回合'"
          @click="playing = !playing"
        >
          {{ playing ? 'Ⅱ' : '▶' }}</button
        ><span class="time-readout"
          >{{ clockText(elapsed(tick)) }} <i>/ {{ clockText(duration) }}</i></span
        >
        <div class="timeline">
          <input
            :value="tick"
            type="range"
            :min="extent.min"
            :max="extent.max"
            step="1"
            aria-label="地图时间游标"
            @input="seekTo(Number(($event.target as HTMLInputElement).value))"
          />
          <div class="timeline-markers">
            <button
              v-for="event in keyEvents"
              :key="event.event_id"
              :style="{
                left: `${((event.tick - extent.min) / Math.max(1, extent.max - extent.min)) * 100}%`,
              }"
              :aria-label="`定位${event.type === 'kill' ? '击杀' : '闪光'} ${clockText(event.live_elapsed_seconds)}`"
              :title="`${event.type === 'kill' ? '击杀' : '闪光'} · ${clockText(event.live_elapsed_seconds)}`"
              @click="selectTimelineEvent(event)"
            />
          </div>
        </div>
        <select v-model.number="speed" aria-label="播放速度">
          <option :value="1">1 倍速</option>
          <option :value="2">2 倍速</option>
          <option :value="4">4 倍速</option>
        </select>
      </div>
      <div class="map-bottom">
        <span>{{
          entire
            ? '总览展示本回合路线和落点'
            : dead
              ? '该时刻已阵亡'
              : cursor
                ? `生命 ${cursor.state?.health ?? '—'} · ${weaponName(cursor.state?.active_weapon)}`
                : '该时刻无玩家位置记录'
        }}</span
        ><span>{{
          global
            ? '全员位置 · 每 0.5 秒采样 · 存活玩家按游标时刻显示'
            : '旧版数据仅包含本人及附近玩家；全员回放需重新上传新版 ZIP'
        }}</span>
      </div>
      <details class="map-options">
        <summary>道具筛选与地图说明</summary>
        <div>
          <label
            ><input v-model="showContext" type="checkbox" />场内道具（含投掷者未记录的轨迹）</label
          ><select v-model="utilityFilter" aria-label="地图道具类型">
            <option value="all">全部道具</option>
            <option
              v-for="type in [...new Set(utilities.map((i) => utilityStyle(i.type).kind))]"
              :key="type"
              :value="type"
            >
              {{ utilityStyle(type).label }}
            </option>
          </select>
        </div>
        <p>
          实线道具已确认归属，虚线仅展示场内轨迹。底图由比赛坐标固定定位，底图版本
          {{ asset.version }}。地图只展示已记录的位置；不推断视野、烟雾覆盖范围或缺失的玩家位置。
        </p>
      </details>
    </template>
  </div>
</template>
<style scoped>
.radar-workspace {
  min-width: 0;
}
.radar-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
  margin-bottom: 12px;
}
.layer-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
}
.layer-toggles label,
.map-options label {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: #aebbc5;
}
.radar-workspace input[type='checkbox'] {
  width: 13px;
  height: 13px;
  accent-color: #edb078;
}
.radar-workspace select {
  width: auto;
  padding: 7px 9px;
  font-size: 11px;
}
.map-button {
  border: 1px solid #36434e;
  border-radius: 5px;
  background: #25313b;
  padding: 7px 9px;
  white-space: nowrap;
  font-size: 11px;
  color: #b5c7d3;
}
.map-button[aria-pressed='true'] {
  color: #efc69b;
  border-color: #6a543c;
  background: #302a23;
}
.radar-stage {
  position: relative;
  background: #0e171e;
  border: 1px solid #2b3843;
  border-radius: 9px;
  overflow: hidden;
}
.tactical-radar {
  display: block;
  width: 100%;
  max-height: 680px;
  aspect-ratio: 1;
}
.tactical-caption {
  position: absolute;
  left: 18px;
  top: 14px;
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 11px;
  color: #93a8b7;
  z-index: 1;
  pointer-events: none;
}
.tactical-caption strong {
  font-size: 12px;
  color: #d8e1e8;
}
.radar-labels text {
  font-size: 21px;
  font-weight: 600;
  fill: #c9c8a8;
  paint-order: stroke;
  stroke: #202830;
  stroke-width: 4px;
}
.player-label {
  font-size: 16px;
  fill: #eef4f6;
  paint-order: stroke;
  stroke: #101820;
  stroke-width: 4px;
  stroke-linejoin: round;
}
.target-label {
  fill: #f1f6ff;
  font-weight: 600;
}
.kill-marker {
  cursor: pointer;
}
.radar-legend {
  position: absolute;
  bottom: 12px;
  left: 15px;
  right: 15px;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 10px;
  color: #b2bfc9;
  pointer-events: none;
}
.radar-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.radar-legend i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.utility-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 10px 0 0;
  color: #b2c1cc;
  font-size: 11px;
}
.utility-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.utility-legend svg {
  width: 23px;
  height: 23px;
}
.path-dot {
  background: #f1b77d;
}
.ct-dot {
  background: #88b6dc;
}
.t-dot {
  background: #e6c28a;
}
.playback {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0 10px;
}
.play-button {
  border: 1px solid #48544e;
  background: #cfb494;
  color: #1c2429;
  width: 33px;
  height: 33px;
  border-radius: 5px;
  flex-shrink: 0;
}
.time-readout {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.time-readout i {
  color: #778b9a;
  font-style: normal;
}
.timeline {
  flex: 1;
  min-width: 40px;
  position: relative;
  padding-bottom: 8px;
}
.timeline input {
  padding: 0;
  display: block;
  height: 18px;
  accent-color: #e4b27f;
}
.timeline-markers {
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 6px;
}
.timeline-markers button {
  position: absolute;
  padding: 0;
  width: 4px;
  height: 6px;
  background: #a1bdaf;
  border: 0;
  transform: translateX(-50%);
}
.map-bottom {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 10px;
  color: #91a2ae;
  padding-bottom: 12px;
}
.map-options {
  border-top: 1px solid #2d3942;
  padding-top: 12px;
  font-size: 11px;
  color: #8fa2b0;
}
.map-options summary {
  cursor: pointer;
}
.map-options > div {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin: 15px 0;
}
.map-options p {
  font-size: 11px;
  line-height: 1.7;
}
.map-placeholder {
  min-height: 420px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  justify-content: center;
  align-items: center;
  color: #94a8b6;
  font-size: 13px;
  background: #121c24;
  border: 1px solid #293b47;
  border-radius: 9px;
  padding: 24px;
  text-align: center;
}
.radar-loader {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #36454f;
  border-top-color: #d9b080;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 650px) {
  .radar-toolbar {
    flex-wrap: wrap;
  }
  .layer-toggles {
    gap: 12px;
  }
  .tactical-caption {
    left: 10px;
    top: 10px;
  }
  .playback {
    flex-wrap: wrap;
    gap: 10px;
  }
  .timeline {
    flex-basis: calc(100% - 120px);
    order: 2;
  }
  .playback select {
    margin-left: auto;
  }
  .map-bottom {
    flex-direction: column;
    gap: 4px;
  }
  .radar-legend {
    gap: 10px;
    font-size: 9px;
  }
  .map-options > div {
    flex-wrap: wrap;
  }
  .map-placeholder {
    min-height: 300px;
  }
}
.neighbor-marker .player-label {
  opacity: 0;
  pointer-events: none;
}
.neighbor-marker:hover .player-label {
  opacity: 1;
}
.neighbor-marker:hover circle {
  stroke: #e6eef2;
  stroke-width: 3px;
}
</style>

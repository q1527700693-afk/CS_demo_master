export const WIDTH = 1000;
export const HEIGHT = 562.5;
export const MODES = Object.freeze([
  { id: 'gridshot', name: '网格点射', english: 'GRIDSHOT', tag: '速度 · 切换', icon: 'grid', description: '在三个目标之间快速切换。先稳住命中率，再找到自己的节奏。', instruction: '点击蓝色目标，命中后刷新。空枪也会计入射击次数。', skill: '目标切换', number: '01' },
  { id: 'reaction', name: '反应测试', english: 'REACTION', tag: '反应 · 判断', icon: 'bolt', description: '等待信号亮起，再迅速点击。快一点，也要沉得住气。', instruction: '等待画面变绿后，点击训练区域任意位置。提前点击为抢跑。', skill: '反应速度', number: '02' },
  { id: 'spidershot', name: '大幅甩枪', english: 'SPIDERSHOT', tag: '甩动 · 定位', icon: 'expand', description: '追上远处出现的目标，用干净利落的甩动完成定位。', instruction: '点击目标，下一目标会出现在距离较远的位置。', skill: '大幅定位', number: '03' },
  { id: 'microshot', name: '精准微调', english: 'MICROSHOT', tag: '精度 · 微调', icon: 'target', description: '缩小移动幅度，把每一次细微调整变成稳定命中。', instruction: '点击中心附近的小目标。放慢速度，确保准星准确。', skill: '微调精度', number: '04' },
  { id: 'tracking', name: '平滑跟枪', english: 'TRACKING', tag: '跟随 · 稳定', icon: 'wave', description: '跟随持续移动的目标，练习平滑控制和稳定追踪。', instruction: '让准星持续停留在目标内，无需按住或点击鼠标。', skill: '持续跟踪', number: '05' },
]);
export const DIFFICULTIES = Object.freeze({ easy: { label: '入门', radius: 34, speed: 0.7 }, normal: { label: '标准', radius: 27, speed: 1 }, hard: { label: '挑战', radius: 19, speed: 1.4 } });
export const DEFAULT_CONFIG = Object.freeze({ rulesVersion: 2, mode: 'gridshot', duration: 30, difficulty: 'normal', input: 'locked', sensitivity: 1, fov: 64, graphicsQuality: 'performance', crosshair: '#92ff60', crosshairLength: 7, crosshairGap: 4, crosshairThickness: 2, crosshairOpacity: 1, crosshairDot: false, crosshairOutline: true, crosshairStyle: 'cross', sound: true });
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function normalizeConfig(config = {}) {
  return {
    rulesVersion: config.mode === 'reaction' ? 3 : 2,
    mode: MODES.some(m => m.id === config.mode) ? config.mode : DEFAULT_CONFIG.mode,
    duration: [30, 60, 90].includes(config.duration) ? config.duration : 30,
    difficulty: config.mode === 'reaction' ? 'normal' : Object.hasOwn(DIFFICULTIES, config.difficulty) ? config.difficulty : 'normal',
    input: config.input === 'pointer' ? 'pointer' : 'locked',
    sensitivity: Number.isFinite(Number(config.sensitivity)) ? Math.round(clamp(Number(config.sensitivity), 0.1, 5) * 100) / 100 : 1,
    fov: Number.isFinite(Number(config.fov)) ? Math.round(clamp(Number(config.fov), 50, 100)) : 64,
    graphicsQuality: config.graphicsQuality === 'detail' ? 'detail' : 'performance',
    crosshair: /^#[0-9a-f]{6}$/i.test(config.crosshair) ? config.crosshair : DEFAULT_CONFIG.crosshair,
    crosshairLength: numeric(config.crosshairLength, 1, 20, 7),
    crosshairGap: numeric(config.crosshairGap, 0, 15, 4),
    crosshairThickness: numeric(config.crosshairThickness, 1, 6, 2),
    crosshairOpacity: Number.isFinite(Number(config.crosshairOpacity)) ? clamp(Number(config.crosshairOpacity), 0.2, 1) : 1,
    crosshairDot: config.crosshairDot === true,
    crosshairOutline: config.crosshairOutline !== false,
    crosshairStyle: ['cross', 't', 'dot'].includes(config.crosshairStyle) ? config.crosshairStyle : 'cross',
    sound: config.sound === true,
  };
}
function numeric(value, min, max, fallback) { return Number.isFinite(Number(value)) ? Math.round(clamp(Number(value), min, max)) : fallback; }
export function comparisonKey(config) {
  const c = normalizeConfig(config);
  if(c.mode==='reaction')return [`v${config.rulesVersion||1}`,c.mode,c.duration,config.rulesVersion>=3?'color-click':'arena-signal'].join(':');
  return [`v${config.rulesVersion || 1}`, c.mode, c.duration, c.difficulty, c.input, c.input === 'locked' ? c.sensitivity : 1, config.rulesVersion === 2 ? c.fov : 'legacy'].join(':');
}
export const modeById = id => MODES.find(mode => mode.id === id) || MODES[0];
export function primaryMetric(session) {
  if (session.config.mode === 'reaction') return session.metrics.reactionMs;
  if (session.config.mode === 'tracking') return session.metrics.trackingRatio == null ? null : session.metrics.trackingRatio * 100;
  return session.metrics.score;
}
export const isBetter = (mode, next, previous) => next != null && (previous == null || (mode === 'reaction' ? next < previous : next > previous));

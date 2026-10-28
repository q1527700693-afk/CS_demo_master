import { normalizeConfig, comparisonKey, primaryMetric, isBetter, MODES, DIFFICULTIES } from './modes.js';
const SESSIONS_KEY = 'vector.trainer.sessions.v1';
const SETTINGS_KEY = 'vector.trainer.settings.v1';
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function validSession(item) {
  return item?.schemaVersion === 1 && typeof item.id === 'string' && typeof item.completedAt === 'string' && Number.isFinite(Date.parse(item.completedAt))
    && MODES.some(m => m.id === item.config?.mode) && [30, 60, 90].includes(item.config.duration)
    && Object.hasOwn(DIFFICULTIES, item.config.difficulty) && item.config.input === 'locked'
    && validNumber(item.durationMs) && item.durationMs === item.config.duration * 1000
    && item.metrics && validNumber(item.metrics.hits) && validNumber(item.metrics.shots)
    && item.metrics.hits <= item.metrics.shots
    && (item.metrics.accuracy === null || (validNumber(item.metrics.accuracy) && item.metrics.accuracy <= 1))
    && (item.metrics.reactionMs === null || validNumber(item.metrics.reactionMs))
    && (item.metrics.trackingRatio === null || (validNumber(item.metrics.trackingRatio) && item.metrics.trackingRatio <= 1))
    && (item.metrics.score === null || validNumber(item.metrics.score));
}
export class TrainingStore {
  constructor(storage, onError = () => {}) {
    this.storage = storage;
    this.onError = onError;
    this.error = false;
    const storedSessions = this.read(SESSIONS_KEY, []);
    this.sessions = Array.isArray(storedSessions) ? storedSessions.filter(validSession).slice(0, 500).map(session => ({ ...session, events: [] })) : [];
    this.settings = normalizeConfig(this.read(SETTINGS_KEY, {}));
  }
  read(key, fallback) {
    try { const raw = this.storage?.getItem(key); return raw ? JSON.parse(raw) ?? fallback : fallback; }
    catch { this.fail('本地记录无法读取，当前会话仍可训练。'); return fallback; }
  }
  fail(message) { this.error = true; this.onError(message); }
  write(key, value) {
    try { if (!this.storage) throw new Error('No storage'); this.storage.setItem(key, JSON.stringify(value)); return true; }
    catch { this.fail('浏览器存储不可用或已满，成绩暂存于本页，请导出备份。'); return false; }
  }
  saveSettings(settings) { this.settings = normalizeConfig(settings); this.write(SETTINGS_KEY, this.settings); }
  save(session) {
    if (!validSession(session) || this.sessions.some(item => item.id === session.id)) return false;
    // History needs summaries, not every click. Keep full events only in the live completion event.
    this.sessions = [{ ...session, events: [] }, ...this.sessions].slice(0, 500);
    return this.write(SESSIONS_KEY, this.sessions);
  }
  best(config) {
    const matching = this.sessions.filter(session => !session.parametersChanged && comparisonKey(session.config) === comparisonKey(config));
    return matching.reduce((best, next) => isBetter(config.mode, primaryMetric(next), best ? primaryMetric(best) : null) ? next : best, null);
  }
  clear() {
    // Do not report success if persistent removal failed.
    try { this.storage?.removeItem(SESSIONS_KEY); this.sessions = []; return true; }
    catch { this.fail('未能清除本地记录，请检查浏览器存储权限。'); return false; }
  }
  exportJSON() { return JSON.stringify({ application: 'VECTOR', schemaVersion: 1, exportedAt: new Date().toISOString(), sessions: this.sessions }, null, 2); }
}

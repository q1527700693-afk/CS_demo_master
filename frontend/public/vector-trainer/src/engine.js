import { WIDTH, HEIGHT, normalizeConfig, DIFFICULTIES, clamp } from './modes.js';
import { DEGREES_PER_COUNT, radians, lookRay, pointerRay, rayHitsSphere } from './spatial.js';

/** Pure training state. No DOM, storage or animation-frame dependency. Times are monotonic ms. */
export class TrainingEngine {
  constructor({ random = Math.random, now = () => performance.now(), onFinish = () => {} } = {}) {
    this.random = random;
    this.now = now;
    this.onFinish = onFinish;
    this.reset();
  }
  reset() {
    this.state = 'idle';
    this.config = normalizeConfig();
    this.elapsedMs = 0;
    this.countdownMs = 0;
    this.lastTime = null;
    this.targets = [];
    this.cursor = { x: WIDTH / 2, y: HEIGHT / 2 };
    this.look = { yaw: 0, pitch: 0 };
    this.aspect = 16 / 9;
    this.parametersChanged = false;
    this.shots = 0;
    this.hits = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.falseStarts = 0;
    this.reactions = [];
    this.trackedMs = 0;
    this.events = [];
    this.effects = [];
    this.reactionPhase = 'waiting';
    this.reactionShownAt = null;
    this.nextSignalMs = 0;
    this.lastFeedback = '';
    this.feedbackUntil = 0;
    this.idCounter = 0;
    this.result = null;
  }
  start(config, time = this.now()) {
    this.reset();
    this.config = normalizeConfig(config);
    this.state = 'countdown';
    this.lastTime = time;
  }
  beginRunning(time) {
    this.state = 'running';
    if (this.config.mode === 'gridshot') for (let i = 0; i < 3; i++) this.spawnTarget();
    else if (this.config.mode === 'reaction') this.scheduleSignal();
    else if (this.config.mode === 'tracking') this.targets = [{ id: ++this.idCounter, ...this.trackingPosition(0), radius: DIFFICULTIES[this.config.difficulty].radius + 7 }];
    else this.spawnTarget();
    this.lastTime = time;
  }
  tick(time = this.now()) {
    if (!Number.isFinite(time)) return;
    const delta = this.lastTime == null ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    if (this.state === 'countdown') {
      this.countdownMs += delta;
      if (this.countdownMs >= 3000) this.beginRunning(time);
      return;
    }
    if (this.state !== 'running') return;
    const dt = Math.min(delta, this.config.duration * 1000 - this.elapsedMs);
    if (this.config.mode === 'tracking') {
      // Integrate by time rather than counting frames. Bound quadrature step to 8 ms.
      const steps = Math.max(1, Math.ceil(dt / 8));
      for (let i = 0; i < steps; i++) {
        const p = this.trackingPosition(this.elapsedMs + dt * (i + 0.5) / steps);
        if (this.targetHit({ ...this.targets[0], ...p })) this.trackedMs += dt / steps;
      }
      Object.assign(this.targets[0], this.trackingPosition(this.elapsedMs + dt));
    }
    this.elapsedMs += dt;
    if (this.config.mode === 'reaction' && this.reactionPhase === 'waiting' && this.elapsedMs >= this.nextSignalMs) {
      this.reactionPhase = 'ready';
      this.reactionShownAt = time; // this tick is rendered immediately by the host
    }
    this.effects = this.effects.filter(effect => this.elapsedMs - effect.at < 350);
    if (this.elapsedMs >= this.config.duration * 1000) this.finish();
  }
  move(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.cursor = { x: clamp(x, 0, WIDTH), y: clamp(y, 0, HEIGHT) };
  }
  relativeMove(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const scale = radians(DEGREES_PER_COUNT * this.config.sensitivity);
    this.look.yaw -= dx * scale;
    this.look.yaw = Math.atan2(Math.sin(this.look.yaw), Math.cos(this.look.yaw));
    this.look.pitch = clamp(this.look.pitch - dy * scale, radians(-85), radians(85));
  }
  aimRay() { return this.config.input === 'locked' ? lookRay(this.look) : pointerRay(this.cursor, this.aspect, this.config.fov); }
  targetHit(target) { return rayHitsSphere(this.aimRay(), target); }
  pause(time = this.now()) {
    if (!['running', 'countdown'].includes(this.state)) return;
    this.tick(time);
    if (this.state === 'finished') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    if (this.config.mode === 'reaction') this.scheduleSignal();
  }
  resume(time = this.now()) {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom || 'running';
    this.lastTime = time;
    // A paused reaction stimulus is discarded; the next stimulus gets a new random delay.
    if (this.config.mode === 'reaction' && this.state === 'running') this.scheduleSignal();
  }
  scheduleSignal() {
    this.reactionPhase = 'waiting';
    this.reactionShownAt = null;
    this.nextSignalMs = this.elapsedMs + 1200 + this.random() * 2300;
  }
  trackingPosition(ms) {
    const t = ms / 1000 * DIFFICULTIES[this.config.difficulty].speed;
    return { x: 500 + Math.sin(t * 1.15) * 285, y: 280 + Math.sin(t * 1.81 + 0.7) * 135 };
  }
  spawnTarget(previous = null) {
    const mode = this.config.mode;
    let radius = DIFFICULTIES[this.config.difficulty].radius;
    let p;
    if (mode === 'gridshot') {
      const points = Array.from({ length: 9 }, (_, i) => ({ x: 330 + (i % 3) * 170, y: 141 + Math.floor(i / 3) * 140 }));
      const available = points.filter(point => !this.targets.some(t => t.x === point.x && t.y === point.y) && (!previous || point.x !== previous.x || point.y !== previous.y));
      p = available[Math.floor(this.random() * available.length)];
    } else if (mode === 'microshot') {
      radius = Math.max(8, radius * 0.43);
      const angle = this.random() * Math.PI * 2;
      const distance = 35 + this.random() * 100;
      p = { x: 500 + Math.cos(angle) * distance, y: 281 + Math.sin(angle) * distance };
    } else {
      for (let i = 0; i < 30; i++) {
        p = { x: 120 + this.random() * 760, y: 100 + this.random() * 362 };
        if (!previous || Math.hypot(p.x - previous.x, p.y - previous.y) > 250) break;
      }
      if (previous && Math.hypot(p.x - previous.x, p.y - previous.y) <= 250) p = { x: previous.x > 500 ? 140 : 860, y: previous.y > 281 ? 120 : 442 };
    }
    this.targets.push({ id: ++this.idCounter, ...p, radius });
  }
  shoot(time = this.now()) {
    if (this.state !== 'running' || this.config.mode === 'tracking') return null;
    // Input may arrive between frames, including just after the session deadline.
    if (time - this.lastTime >= this.config.duration * 1000 - this.elapsedMs) { this.tick(time); return null; }
    if (this.config.mode === 'reaction') {
      if (this.reactionPhase !== 'ready') {
        this.falseStarts++;
        this.lastFeedback = '抢跑了，等待绿色信号';
        this.feedbackUntil = this.elapsedMs + 900;
        this.scheduleSignal();
        return { type: 'early' };
      }
      const ms = Math.max(0, time - this.reactionShownAt);
      this.reactions.push(ms);
      this.hits++;
      this.shots++;
      this.lastFeedback = `${Math.round(ms)} ms`;
      this.feedbackUntil = this.elapsedMs + 800;
      this.scheduleSignal();
      return { type: 'hit', reactionMs: ms };
    }
    this.shots++;
    const index = this.targets.findIndex(target => this.targetHit(target));
    const hit = index !== -1;
    if (this.events.length < 2500) this.events.push({ x: this.cursor.x, y: this.cursor.y, hit, at: this.elapsedMs });
    this.effects.push({ x: this.cursor.x, y: this.cursor.y, hit, at: this.elapsedMs });
    if (hit) {
      this.hits++;
      this.combo++;
      this.maxCombo = Math.max(this.combo, this.maxCombo);
      const [previous] = this.targets.splice(index, 1);
      this.spawnTarget(previous);
    } else this.combo = 0;
    return { type: hit ? 'hit' : 'miss' };
  }
  metrics() {
    const accuracy = this.shots > 0 ? this.hits / this.shots : null;
    const reactionMs = this.reactions.length ? this.reactions.reduce((a, b) => a + b, 0) / this.reactions.length : null;
    return { hits: this.hits, shots: this.shots, accuracy: this.config.mode === 'reaction' || this.config.mode === 'tracking' ? null : accuracy,
      hitsPerMinute: this.elapsedMs > 0 ? this.hits * 60000 / this.elapsedMs : 0,
      score: this.config.mode === 'reaction' || this.config.mode === 'tracking' ? null : Math.round(this.hits * 100 * (accuracy || 0)),
      reactionMs, reactionSamples: [...this.reactions], falseStarts: this.falseStarts,
      trackingRatio: this.config.mode === 'tracking' && this.elapsedMs > 0 ? clamp(this.trackedMs / this.elapsedMs, 0, 1) : null,
      trackedMs: this.trackedMs, maxCombo: this.maxCombo };
  }
  finish() {
    if (this.state === 'finished' || this.state === 'idle') return;
    this.state = 'finished';
    this.result = { schemaVersion: 1, config: { ...this.config }, parametersChanged: this.parametersChanged, durationMs: this.elapsedMs, metrics: this.metrics(), events: [...this.events] };
    this.onFinish(this.result);
  }
}

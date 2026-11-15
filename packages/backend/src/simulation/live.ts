/**
 * Live physiology: what each crew member's wearable sensor sends, second by second.
 *
 * Every signal follows its own continuous process (mean-reverting random walk) around the crew
 * member's current values, so readings drift and fluctuate like a real person's instead of being
 * independent random numbers. On top of that, *episodes* change the physiology over time:
 *
 *   intensity  0 ──ramp──▶ 1 ──hold──▶ 1 ──recover──▶ 0
 *
 * During an episode each affected signal moves towards its peak value in proportion to the intensity,
 * so a crew member who is well drifts into a critical state, stays there for a while, then recovers.
 * The health engine re-evaluates every reading, so the status, the colours and the critical alerts
 * follow the data by themselves: nothing is switched by hand.
 *
 * Episodes come from two places:
 *  - the automatic schedule (first one after 60 s, then one every few minutes, rotating through the crew);
 *  - the Simulation panel (an emergency that lasts until it is stopped).
 */
import { CREW } from '@orbital/shared/crew';
import type { Activity } from '@orbital/shared/types';
import type { Profile } from './profiles';

export type Signal = 'heartRate' | 'spo2' | 'systolic' | 'bodyTemp' | 'respiratoryRate';
const SIGNALS: Signal[] = ['heartRate', 'spo2', 'systolic', 'bodyTemp', 'respiratoryRate'];

/** Kinds of episode: the peak value of each affected signal. */
/** A manual emergency reaches its peak within this time. */
export const MANUAL_RAMP_MS = 8_000;

export const EPISODE_KINDS = {
  tachycardia: { label: 'Heart rate rises to about 152 bpm', peak: { heartRate: 152, respiratoryRate: 22 } },
  hypoxia: { label: 'Blood oxygen falls to about 86 %', peak: { spo2: 86.2, respiratoryRate: 25, heartRate: 104 } },
  hypotension: { label: 'Blood pressure falls to about 74 mmHg systolic', peak: { systolic: 74, heartRate: 96 } },
} as const satisfies Record<string, { label: string; peak: Partial<Record<Signal, number>> }>;
export type EpisodeKind = keyof typeof EPISODE_KINDS;

export interface Episode {
  id: string;
  astronautId: string;
  kind: EpisodeKind;
  label: string;
  source: 'automatic' | 'manual';
  startAt: number;
  rampMs: number;
  /** Infinity for a manual emergency, until it is stopped */
  holdMs: number;
  recoverMs: number;
  /** Set when a manual emergency is stopped: recovery starts from the level reached at that moment */
  stopAt?: number;
  stopLevel?: number;
}

export interface ScheduleConfig {
  enabled: boolean;
  firstDelayMs: number;
  intervalMs: number;
  rampMs: number;
  holdMs: number;
  recoverMs: number;
}

/** Which episode each crew member gets in the automatic rotation (fits their profile). */
const ROTATION: { astronautId: string; kind: EpisodeKind }[] = [
  { astronautId: 'voss', kind: 'tachycardia' },
  { astronautId: 'okafor', kind: 'hypoxia' },
  { astronautId: 'menon', kind: 'hypotension' },
  { astronautId: 'marchetti', kind: 'tachycardia' },
];

/** Speed of return to the target (per second) and noise of each signal. */
const DYNAMICS: Record<Signal, { rate: number; noise: number; decimals: number }> = {
  heartRate: { rate: 0.25, noise: 1.6, decimals: 0 },
  spo2: { rate: 0.18, noise: 0.18, decimals: 1 },
  systolic: { rate: 0.2, noise: 1.4, decimals: 0 },
  bodyTemp: { rate: 0.05, noise: 0.02, decimals: 1 },
  respiratoryRate: { rate: 0.2, noise: 0.5, decimals: 0 },
};

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Episode intensity at time t: 0 before and after, 1 at the plateau, smooth in between. */
export function intensity(e: Episode, t: number): number {
  if (e.stopAt !== undefined && t >= e.stopAt) {
    const r = t - e.stopAt;
    return r >= e.recoverMs ? 0 : (e.stopLevel ?? 0) * smooth(1 - r / e.recoverMs);
  }
  const dt = t - e.startAt;
  if (dt <= 0) return 0;
  if (dt < e.rampMs) return smooth(dt / e.rampMs);
  if (dt < e.rampMs + e.holdMs) return 1;
  const r = dt - e.rampMs - e.holdMs;
  return r >= e.recoverMs ? 0 : smooth(1 - r / e.recoverMs);
}
export const episodeEnd = (e: Episode) => (e.stopAt !== undefined ? e.stopAt + e.recoverMs : e.startAt + e.rampMs + e.holdMs + e.recoverMs);
const running = (e: Episode) => e.source === 'manual' && e.stopAt === undefined;

let seq = 0;

export class LivePhysiology {
  private values: Record<string, Record<Signal, number>> = {};
  episodes: Episode[] = [];
  schedule: ScheduleConfig;
  private nextAutoAt = 0;
  private rotationIndex = 0;

  constructor(private readonly profiles: Record<string, Profile>, schedule: ScheduleConfig, private readonly random = Math.random) {
    this.schedule = schedule;
    this.reset(Date.now());
  }

  /** Back to every crew member's current values; the automatic schedule restarts. */
  reset(now: number) {
    this.values = Object.fromEntries(CREW.map((c) => [c.id, this.base(c.id)]));
    this.episodes = [];
    this.rotationIndex = 0;
    this.nextAutoAt = now + this.schedule.firstDelayMs;
  }

  configure(patch: Partial<ScheduleConfig>, now: number) {
    const wasEnabled = this.schedule.enabled;
    this.schedule = { ...this.schedule, ...patch };
    if (patch.firstDelayMs !== undefined || (!wasEnabled && this.schedule.enabled)) this.nextAutoAt = now + this.schedule.firstDelayMs;
  }

  private base(id: string): Record<Signal, number> {
    const l = this.profiles[id].live;
    return { heartRate: l.heartRate[0], spo2: l.spo2[0], systolic: l.systolic[0], bodyTemp: l.bodyTemp[0], respiratoryRate: l.respiratoryRate[0] };
  }

  private gauss() {
    const u = Math.max(this.random(), 1e-9), v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Starts an emergency from the Simulation panel; it lasts until stopEmergency(). It develops faster than an
   * automatic event (8 s instead of the scheduled ramp) so that pressing the button shows the alarm at once.
   */
  startEmergency(astronautId: string, kind: EpisodeKind, now: number) {
    this.stopEmergency(astronautId, now);
    this.episodes.push({ id: `ep${++seq}`, astronautId, kind, label: EPISODE_KINDS[kind].label, source: 'manual', startAt: now,
      rampMs: Math.min(this.schedule.rampMs, MANUAL_RAMP_MS), holdMs: Number.POSITIVE_INFINITY, recoverMs: this.schedule.recoverMs });
  }

  /** Ends the hold phase of a manual emergency now; the crew member then recovers gradually. */
  stopEmergency(astronautId: string, now: number) {
    for (const e of this.episodes) {
      if (e.astronautId !== astronautId || !running(e)) continue;
      e.stopLevel = intensity(e, now);
      e.stopAt = now;
    }
  }

  manualEmergencies() {
    return Object.fromEntries(this.episodes.filter(running).map((e) => [e.astronautId, e.kind]));
  }

  /** Episodes in progress and the next automatic one (for the Simulation panel). */
  status(now: number) {
    const active = this.episodes.filter((e) => intensity(e, now) > 0 || now < e.startAt).map((e) => ({
      astronautId: e.astronautId, kind: e.kind, label: e.label, source: e.source, intensity: Math.round(intensity(e, now) * 100) / 100,
      phase: e.stopAt !== undefined || now - e.startAt >= e.rampMs + e.holdMs ? 'recovering' : now - e.startAt < e.rampMs ? 'starting' : 'peak',
    }));
    const next = ROTATION[this.rotationIndex % ROTATION.length];
    return {
      automatic: this.schedule.enabled,
      active,
      next: this.schedule.enabled ? { astronautId: next.astronautId, kind: next.kind, label: EPISODE_KINDS[next.kind].label, inSeconds: Math.max(0, Math.round((this.nextAutoAt - now) / 1000)) } : null,
    };
  }

  private scheduleAutomatic(now: number) {
    if (!this.schedule.enabled || now < this.nextAutoAt) return;
    // skip a crew member whose sensor already shows an episode
    for (let tries = 0; tries < ROTATION.length; tries++) {
      const r = ROTATION[this.rotationIndex % ROTATION.length];
      this.rotationIndex++;
      if (this.episodes.some((e) => e.astronautId === r.astronautId && (intensity(e, now) > 0))) continue;
      this.episodes.push({ id: `ep${++seq}`, astronautId: r.astronautId, kind: r.kind, label: EPISODE_KINDS[r.kind].label, source: 'automatic',
        startAt: now, rampMs: this.schedule.rampMs, holdMs: this.schedule.holdMs, recoverMs: this.schedule.recoverMs });
      break;
    }
    this.nextAutoAt = now + this.schedule.intervalMs;
  }

  /** Target value of a signal now: the crew member's current value, moved towards the peak of each active episode. */
  private target(id: string, s: Signal, now: number) {
    let v = this.base(id)[s];
    for (const e of this.episodes) {
      if (e.astronautId !== id) continue;
      const peak = (EPISODE_KINDS[e.kind].peak as Partial<Record<Signal, number>>)[s];
      if (peak === undefined) continue;
      v += (peak - v) * intensity(e, now);
    }
    return v;
  }

  /** Advances every crew member by dtMs and returns one reading per crew member. */
  step(now: number, dtMs: number) {
    this.scheduleAutomatic(now);
    this.episodes = this.episodes.filter((e) => running(e) || now < episodeEnd(e) + 60_000);
    const dt = Math.max(0.5, dtMs / 1000);
    const out: Record<string, { activity: Activity; bpm: number; spo2: number; systolic: number; diastolic: number; bodyTemp: number; respiratoryRate: number }> = {};
    for (const c of CREW) {
      const p = this.profiles[c.id];
      const cur = this.values[c.id];
      for (const s of SIGNALS) {
        const d = DYNAMICS[s];
        const pull = 1 - Math.exp(-d.rate * dt);
        cur[s] += (this.target(c.id, s, now) - cur[s]) * pull + d.noise * Math.sqrt(Math.min(dt, 4) / 3) * this.gauss();
      }
      cur.spo2 = Math.min(99.9, cur.spo2);
      const round = (s: Signal) => Math.round(cur[s] * 10 ** DYNAMICS[s].decimals) / 10 ** DYNAMICS[s].decimals;
      const systolic = Math.round(cur.systolic);
      out[c.id] = {
        activity: p.live.activity,
        bpm: round('heartRate'), spo2: round('spo2'), systolic, diastolic: Math.round(systolic * p.live.diastolicRatio),
        bodyTemp: round('bodyTemp'), respiratoryRate: round('respiratoryRate'),
      };
    }
    return out;
  }
}

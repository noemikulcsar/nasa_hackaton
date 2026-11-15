/**
 * The console's live state: event journal, protocol library, station simulator, demo switches and the
 * latest computed snapshot (health reports for every crew member + station + repair recommendations).
 * Everything the interface shows is computed here, never in the browser.
 */
import fs from 'node:fs';
import { CREW } from '@orbital/shared/crew';
import { sharedDataFile } from '@orbital/shared/paths';
import { isHealthEvent, type DemoState, type HealthEvent, type LabsData, type RepairAssigned, type StoredEvent } from '@orbital/shared/types';
import { resolveAiConfig } from '../ai/config';
import { warmUp } from '../ai/local';
import { loadProtocols } from '../protocols';
import { buildHealthReport, type HealthReport } from '../health/engine';
import { StationSimulator } from '../station/hardware';
import { recommendCrew, type Recommendation } from '../station/repair';
import { EventStore } from '../storage/event-store';
import { CriticalAlerts } from '../alerts/critical-alerts';
import { PROFILES } from '../simulation/profiles';
import { LivePhysiology, type EpisodeKind, type ScheduleConfig } from '../simulation/live';
import { sensorAuthor } from '../util/authors';
import { newId } from '../util/ids';
import type { EventStream } from '../realtime/sse';
import { env } from '../env';

export type Snapshot = ReturnType<ConsoleState['computeAll']>;

/** Events shown in timelines: everything except automatic sensor readings, daily logs and assessments. */
export const isRecordEvent = (e: StoredEvent) => !((e.type === 'hr_reading' && !e.manual) || e.type === 'daily_log' || e.type === 'assessment');

const initialSensors = () => Object.fromEntries(CREW.map((c) => [c.id, true]));

/** Kinds of emergency accepted from the Simulation panel (older names are kept for compatibility). */
const EMERGENCY_ALIASES: Record<string, EpisodeKind> = { spo2: 'hypoxia', heartRate: 'tachycardia', hypoxia: 'hypoxia', tachycardia: 'tachycardia', hypotension: 'hypotension' };
export const emergencyKind = (k: unknown): EpisodeKind | null => (typeof k === 'string' && EMERGENCY_ALIASES[k]) || null;

export class ConsoleState {
  readonly store = new EventStore(env.dataDir);
  readonly station = new StationSimulator();
  readonly alerts = new CriticalAlerts(env.alertRecoveredShowMs, 6_000, env.alertRecheckMs);
  readonly live = new LivePhysiology(PROFILES, env.episodes);
  private lastTick = Date.now();
  readonly labs: LabsData = JSON.parse(fs.readFileSync(sharedDataFile('labs.json'), 'utf8'));
  library = loadProtocols();
  readonly demo: DemoState = {
    sensorsOnline: initialSensors(),
    aiAvailable: true,
    ai: { configured: false, provider: 'Checking', model: '', offline: true },
  };
  reports: Record<string, HealthReport> = {};
  recommendations: Record<string, Recommendation> = {};
  snapshot!: Snapshot;

  constructor(private readonly stream: EventStream) {
    this.store.load();
    this.alerts.restore(this.store.events);
    this.snapshot = this.computeAll();
  }

  get events() { return this.store.events; }
  get meta() { return this.store.meta; }
  healthEvents = () => this.store.events.filter(isHealthEvent) as HealthEvent[];

  assignments() {
    const out: Record<string, RepairAssigned> = {};
    for (const e of this.store.events) if (e.type === 'repair_assigned') out[e.componentId] = e;
    return out;
  }

  /** Re-evaluates every crew member and the station, and raises or resolves critical alerts. */
  computeAll(now = Date.now()) {
    this.reports = Object.fromEntries(CREW.map((c) => [c.id, buildHealthReport({
      astronautId: c.id, events: this.store.events, now, missionStart: this.store.meta.missionStart, labs: this.labs, hrStaleMs: env.hrStaleMs,
    })]));
    const snap = this.station.snapshot();
    this.recommendations = {};
    for (const comp of snap.components) {
      if (!comp.task) continue;
      const rec = recommendCrew(comp, this.reports);
      if (rec) this.recommendations[comp.id] = rec;
    }
    for (const e of this.alerts.update(this.reports, now)) {
      this.store.append(e);
      this.stream.broadcast('record-event', e);
    }
    return { at: now, health: this.reports, station: { ...snap, assignments: this.assignments() }, recommendations: this.recommendations,
      alerts: this.alerts.list(), alertRechecks: this.alerts.pending(), live: this.live.status(now) };
  }

  /** Saves an event, pushes timeline entries to every screen and re-evaluates. */
  record(e: StoredEvent, { recompute = true } = {}) {
    this.store.append(e);
    if (isRecordEvent(e)) this.stream.broadcast('record-event', e);
    if (recompute) this.publish();
    return e;
  }

  publish(now = Date.now()) {
    this.snapshot = this.computeAll(now);
    this.stream.broadcast('snapshot', this.snapshot);
  }

  /** One cycle: the physiology advances, every online sensor sends a reading, the station steps, everything is re-evaluated. */
  tick() {
    const now = Date.now();
    const readings = this.live.step(now, now - this.lastTick);
    this.lastTick = now;
    for (const c of CREW) {
      if (!this.demo.sensorsOnline[c.id]) continue; // the person goes on; the sensor just sends nothing
      this.store.append({ id: newId(), ts: now, astronautId: c.id, author: sensorAuthor(c.id), simulated: true, type: 'hr_reading', ...readings[c.id] });
    }
    this.station.step();
    this.publish(now);
  }

  /** Reports the status of the AI assistant (the assistant module itself is not touched). */
  async refreshAi() {
    const c = await resolveAiConfig();
    const next = { configured: !!c.provider, provider: c.label, model: c.model, reason: c.reason, hint: c.hint, offline: c.offline };
    const changed = JSON.stringify(next) !== JSON.stringify(this.demo.ai);
    this.demo.ai = next;
    if (changed) this.stream.broadcast('demo-state', this.demo);
    if (c.provider === 'ollama') void warmUp(c.model);
    return next;
  }

  setSensor(astronautId: string, online: boolean) {
    this.demo.sensorsOnline[astronautId] = online;
    this.stream.broadcast('demo-state', this.demo);
  }

  /** Starts (kind) or stops (null) a demo emergency for one crew member; stopping lets them recover gradually. */
  setEmergency(astronautId: string, kind: EpisodeKind | null) {
    const now = Date.now();
    if (kind) this.live.startEmergency(astronautId, kind, now); else this.live.stopEmergency(astronautId, now);
    this.demo.emergencies = this.live.manualEmergencies();
    this.stream.broadcast('demo-state', this.demo);
  }

  /** Turns the automatic episodes on or off, or changes their timing. */
  configureEpisodes(patch: Partial<ScheduleConfig>) {
    this.live.configure(patch, Date.now());
    this.publish();
  }

  acknowledgeAlert(alertId: string, authorId: string) {
    const e = this.alerts.acknowledge(alertId, authorId, Date.now());
    if (e) this.record(e);
    return e;
  }

  /** Changes the re-check delay after an acknowledgement (demo control). */
  setAlertRecheck(ms: number) {
    this.alerts.recheckMs = ms;
  }

  setAiAvailable(available: boolean) {
    this.demo.aiAvailable = available;
    this.stream.broadcast('demo-state', this.demo);
  }

  /** Restores the demo scenario. */
  reset() {
    this.store.reset();
    this.alerts.restore(this.store.events);
    this.live.reset(Date.now());
    this.demo.emergencies = {};
    this.library = loadProtocols();
    this.station.reset();
    this.demo.sensorsOnline = initialSensors();
    this.demo.aiAvailable = true;
    this.snapshot = this.computeAll();
    this.stream.broadcast('reset', { at: Date.now() });
    this.stream.broadcast('demo-state', this.demo);
  }
}

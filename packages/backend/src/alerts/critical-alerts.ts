/**
 * Critical alerts.
 *
 * After every re-evaluation (every reading), any finding at the "critical" level that was not already
 * open raises an alert for the whole crew: it is saved in the journal, sent to every screen and announced
 * by voice. When the readings leave the critical band the alert is marked "back within range", stays on
 * screen for a short time (so nobody misses that it happened) and then closes by itself.
 * When a crew member acknowledges an alert that is still critical, the state is checked again after
 * a set time (3 minutes by default): if it is still critical, the alert is raised again on every screen.
 * Raising, recovery, acknowledgement and repeats all stay in the journal.
 * The open alerts are rebuilt from the journal at start-up, so a restart does not repeat or lose them.
 */
import { CREW, CREW_BY_ID } from '@orbital/shared/crew';
import type { Author, RegionId, StoredEvent } from '@orbital/shared/types';
import type { HealthReport } from '../health/engine';
import { crewAuthor } from '../util/authors';
import { newId } from '../util/ids';

export interface CriticalAlert {
  id: string;
  /** astronautId + rule: one open alert per problem */
  key: string;
  astronautId: string;
  name: string;
  role: string;
  condition: string;
  rule: string;
  region: RegionId;
  metric?: string;
  raisedAt: number;
  /** Last time the finding was seen at the critical level */
  lastCriticalAt?: number;
  resolvedAt?: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  /** When to check again after an acknowledgement */
  recheckAt?: number;
  /** How many times the alert was raised again because the state was still critical */
  repeats: number;
  /** Last time it was raised again, and how long after the acknowledgement */
  repeatedAt?: number;
  repeatAfterMs?: number;
}

const SYSTEM: Author = { id: 'health-engine', name: 'Health engine', kind: 'system' };

export class CriticalAlerts {
  private readonly open = new Map<string, CriticalAlert>();

  /**
   * @param recoveredShowMs how long a recovered alert stays visible before closing by itself
   * @param resolveAfterMs how long a reading must stay out of the critical band before the alert counts as recovered
   *   (so a value hovering around the threshold does not make the alert flicker)
   * @param recheckMs after an acknowledgement, when to check again; still critical → the alert is raised again
   */
  constructor(private readonly recoveredShowMs = 20_000, private readonly resolveAfterMs = 6_000, public recheckMs = 180_000) {}

  /** Rebuilds the open alerts from the journal. */
  restore(events: StoredEvent[], now = Date.now()) {
    this.open.clear();
    const byId = new Map<string, CriticalAlert>();
    for (const e of events) {
      if (e.type === 'critical_alert') {
        const c = CREW_BY_ID[e.astronautId];
        byId.set(e.alertId, { id: e.alertId, key: e.key, astronautId: e.astronautId, name: c?.name ?? e.astronautId, role: c?.role ?? '',
          condition: e.condition, rule: e.rule, region: e.region, metric: e.metric, raisedAt: e.ts, repeats: 0 });
      } else if (e.type === 'alert_resolved') {
        const a = byId.get(e.alertId); if (a) a.resolvedAt = e.ts;
      } else if (e.type === 'alert_acknowledged') {
        const a = byId.get(e.alertId); if (a) { a.acknowledgedAt = e.ts; a.acknowledgedBy = e.author.name; a.recheckAt = e.ts + this.recheckMs; }
      } else if (e.type === 'alert_repeated') {
        const a = byId.get(e.alertId); if (a) { a.acknowledgedAt = undefined; a.acknowledgedBy = undefined; a.recheckAt = undefined; a.repeats++; a.repeatedAt = e.ts; a.repeatAfterMs = e.afterMs; }
      }
    }
    for (const a of byId.values()) if (!this.closed(a, now)) this.open.set(a.key, a);
  }

  /**
   * Compares the current critical findings with the open alerts.
   * Returns the journal events to save (new alerts and resolutions).
   */
  update(reports: Record<string, HealthReport>, now: number): StoredEvent[] {
    const out: StoredEvent[] = [];
    const current = new Map<string, { astronautId: string; condition: string; rule: string; region: RegionId; metric?: string }>();
    for (const c of CREW) {
      const r = reports[c.id];
      if (!r) continue;
      for (const a of r.alerts) {
        if (a.status !== 'critical') continue;
        const key = `${c.id}:${a.rule}`;
        if (!current.has(key)) current.set(key, { astronautId: c.id, condition: a.condition ?? a.title, rule: a.rule, region: a.region, metric: a.metric });
      }
    }
    for (const [key, f] of current) {
      const existing = this.open.get(key);
      if (existing) existing.lastCriticalAt = now;
      if (existing && !existing.resolvedAt) continue;
      if (existing?.resolvedAt && !this.closed(existing, now)) { existing.resolvedAt = undefined; continue; } // critical again before the alert closed
      const c = CREW_BY_ID[f.astronautId];
      const alert: CriticalAlert = { id: newId('alert'), key, astronautId: f.astronautId, name: c.name, role: c.role, condition: f.condition,
        rule: f.rule, region: f.region, metric: f.metric, raisedAt: now, lastCriticalAt: now, repeats: 0 };
      this.open.set(key, alert);
      out.push({ id: newId(), ts: now, astronautId: f.astronautId, author: SYSTEM, simulated: false, type: 'critical_alert',
        alertId: alert.id, key, condition: f.condition, rule: f.rule, region: f.region, metric: f.metric });
    }
    for (const [key, a] of this.open) {
      // acknowledged, and the re-check time has come: still critical → raise it again
      if (a.acknowledgedAt && !a.resolvedAt && a.recheckAt !== undefined && now >= a.recheckAt && current.has(key)) {
        const afterMs = now - a.acknowledgedAt;
        a.acknowledgedAt = undefined; a.acknowledgedBy = undefined; a.recheckAt = undefined;
        a.repeats++; a.repeatedAt = now; a.repeatAfterMs = afterMs;
        out.push({ id: newId(), ts: now, astronautId: a.astronautId, author: SYSTEM, simulated: false, type: 'alert_repeated', alertId: a.id, afterMs });
      }
      if (!current.has(key) && !a.resolvedAt && now - (a.lastCriticalAt ?? a.raisedAt) >= this.resolveAfterMs) {
        a.resolvedAt = now;
        out.push({ id: newId(), ts: now, astronautId: a.astronautId, author: SYSTEM, simulated: false, type: 'alert_resolved', alertId: a.id });
      }
      if (this.closed(a, now)) this.open.delete(key);
    }
    return out;
  }

  /** Records that a crew member has seen the alert. Returns the journal event, or null if unknown. */
  acknowledge(alertId: string, authorId: string, now: number): StoredEvent | null {
    const a = [...this.open.values()].find((x) => x.id === alertId);
    if (!a || !CREW_BY_ID[authorId]) return null;
    if (a.acknowledgedAt) return null;
    a.acknowledgedAt = now;
    a.acknowledgedBy = CREW_BY_ID[authorId].name;
    a.recheckAt = now + this.recheckMs;
    if (a.resolvedAt) this.open.delete(a.key);
    return { id: newId(), ts: now, astronautId: a.astronautId, author: crewAuthor(authorId), simulated: false, type: 'alert_acknowledged', alertId: a.id };
  }

  /** Closed: recovered and either acknowledged or shown long enough. */
  private closed(a: CriticalAlert, now: number) {
    return !!a.resolvedAt && (!!a.acknowledgedAt || now - a.resolvedAt >= this.recoveredShowMs);
  }

  /** Alerts on screen: not acknowledged, still critical or recovered only a moment ago. Newest (or newly repeated) first. */
  list(): CriticalAlert[] {
    const at = (a: CriticalAlert) => a.repeatedAt ?? a.raisedAt;
    return [...this.open.values()].filter((a) => !a.acknowledgedAt).sort((a, b) => at(b) - at(a));
  }

  /** Acknowledged alerts waiting for their re-check (for the interface). */
  pending(): { id: string; astronautId: string; name: string; condition: string; recheckAt: number }[] {
    return [...this.open.values()].filter((a) => a.acknowledgedAt && !a.resolvedAt && a.recheckAt !== undefined)
      .map((a) => ({ id: a.id, astronautId: a.astronautId, name: a.name, condition: a.condition, recheckAt: a.recheckAt! }));
  }
}

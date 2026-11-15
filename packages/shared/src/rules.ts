/**
 * Personal-baseline rules for the body regions. Pure functions, used by the backend health engine
 * and by the AI assistant. Every status carries the list of reasons and the rule that set it.
 *
 *  red    (urgent) – open incident marked URGENT
 *  yellow (check)  – symptom reported, OR a reading that differs from the person's own history in comparable conditions
 *  grey   (nodata) – data missing or too old
 *  green  (ok)     – recent data, no deviation
 */
import { RULES_CONFIG, ACTIVITY_LABEL } from './config';
import { REGIONS } from './regions';
import type {
  Activity, DailyLog, HealthEvent, HrReading, Incident, LabAnalyte, LabPoint, LabsData, Reason, RegionId,
  RegionState, Stats, Status, SymptomEvent,
} from './types';

export const SEVERITY: Record<Status, number> = { urgent: 3, check: 2, nodata: 1, ok: 0 };

export function stats(values: number[]): Stats | undefined {
  if (values.length === 0) return undefined;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)) : 0;
  return { mean, sd, n: values.length };
}

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `${Math.round(h / 24)} days`;
}
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface HrDeviation {
  reading: HrReading;
  baseline?: Stats;
  delta?: number;
  threshold?: number;
  deviates: boolean;
  insufficient: boolean;
}

export interface LabSummary {
  analyte: LabAnalyte;
  points: LabPoint[];
  lastPre?: LabPoint; // latest value available on board (pre-flight)
  preStats?: Stats;
  lastPreOutOfRange: boolean;
}

export interface Derived {
  astronautId: string;
  now: number;
  hr: HrReading[];
  latestHr?: HrReading;
  hrAgeMs?: number;
  hrStale: boolean;
  hrBaseline: Partial<Record<Activity, Stats>>;
  hrDeviation?: HrDeviation;
  logs: DailyLog[];
  lastLog?: DailyLog;
  logStale: boolean;
  sleepBaseline?: Stats;
  fatigueBaseline?: Stats;
  exerciseBaseline?: Stats;
  exerciseRecent?: Stats;
  activeSymptoms: SymptomEvent[];
  incidents: Incident[];
  openIncidents: Incident[];
  timeline: HealthEvent[]; // without automatic sensor readings and daily logs
  labs: LabSummary[];
  labAgeMs?: number;
  labStale: boolean;
  regions: Record<RegionId, RegionState>;
  overall: Status;
}

export function foldIncidents(events: HealthEvent[]): Incident[] {
  const map = new Map<string, Incident>();
  for (const e of events) {
    if (e.type === 'incident_opened') {
      map.set(e.incidentId, {
        id: e.incidentId, astronautId: e.astronautId, title: e.title, region: e.region, urgency: e.urgency,
        scenario: e.scenario, openedAt: e.ts, openedBy: e.author,
      });
    } else if (e.type === 'incident_closed') {
      const inc = map.get(e.incidentId);
      if (inc) { inc.closedAt = e.ts; inc.closedBy = e.author; }
    }
  }
  return [...map.values()].sort((a, b) => b.openedAt - a.openedAt);
}

export interface DeriveInput {
  astronautId: string;
  events: HealthEvent[]; // may contain events of the whole crew
  now: number;
  missionStart: number;
  labs?: LabsData;
  osdrSubject?: string;
  hrStaleMs?: number;
}

export function derive(input: DeriveInput): Derived {
  const { astronautId, now, missionStart } = input;
  const cfg = { ...RULES_CONFIG, hrStaleMs: input.hrStaleMs ?? RULES_CONFIG.hrStaleMs };
  const mine = input.events.filter((e) => e.astronautId === astronautId).sort((a, b) => a.ts - b.ts);

  // ---- Heart rate ----
  const hr = mine.filter((e): e is HrReading => e.type === 'hr_reading');
  const latestHr = hr[hr.length - 1];
  const hrAgeMs = latestHr ? now - latestHr.ts : undefined;
  const hrStale = !latestHr || (hrAgeMs as number) > cfg.hrStaleMs;
  const hrBaseline: Partial<Record<Activity, Stats>> = {};
  let hrDeviation: HrDeviation | undefined;
  if (latestHr) {
    const from = latestHr.ts - cfg.baselineWindowMs;
    const to = latestHr.ts - cfg.baselineExcludeRecentMs;
    const window = hr.filter((r) => r.ts >= from && r.ts < to);
    for (const act of ['sleep', 'rest', 'work', 'exercise'] as Activity[]) {
      const s = stats(window.filter((r) => r.activity === act).map((r) => r.bpm));
      if (s) hrBaseline[act] = s;
    }
    const b = hrBaseline[latestHr.activity];
    if (!b || b.n < cfg.hrMinSamples) {
      hrDeviation = { reading: latestHr, baseline: b, deviates: false, insufficient: true };
    } else {
      const threshold = Math.max(cfg.hrSdFactor * b.sd, cfg.hrMinDeviationBpm);
      const delta = latestHr.bpm - b.mean;
      hrDeviation = { reading: latestHr, baseline: b, delta, threshold, deviates: Math.abs(delta) > threshold, insufficient: false };
    }
  }

  // ---- Daily log: sleep, fatigue, exercise ----
  const logs = mine.filter((e): e is DailyLog => e.type === 'daily_log');
  const lastLog = logs[logs.length - 1];
  const logStale = !lastLog || now - lastLog.ts > cfg.dailyLogStaleMs;
  const prev = logs.slice(0, -1).slice(-14);
  const sleepBaseline = stats(prev.map((l) => l.sleepHours));
  const fatigueBaseline = stats(prev.map((l) => l.fatigue));
  const exerciseRecent = stats(logs.slice(-3).map((l) => l.exerciseMinutes));
  const exerciseBaseline = stats(logs.slice(0, -3).slice(-14).map((l) => l.exerciseMinutes));

  // ---- Symptoms and incidents ----
  const activeSymptoms = mine.filter(
    (e): e is SymptomEvent => e.type === 'symptom' && now - e.ts <= cfg.symptomWindowMs,
  );
  const incidents = foldIncidents(mine);
  const openIncidents = incidents.filter((i) => !i.closedAt);
  const timeline = mine.filter((e) => (e.type !== 'hr_reading' || e.manual) && e.type !== 'daily_log').reverse();

  // ---- Lab tests (real OSDR data; only pre-flight values are "available on board") ----
  const labs: LabSummary[] = [];
  let labAgeMs: number | undefined;
  if (input.labs && input.osdrSubject) {
    const subj = input.labs.subjects[input.osdrSubject];
    const preIds = input.labs.timepoints.filter((t) => t.phase === 'pre').map((t) => t.id);
    const lastPreTp = input.labs.timepoints.filter((t) => t.phase === 'pre').slice(-1)[0];
    if (lastPreTp) labAgeMs = now - (missionStart + lastPreTp.days * 86_400_000);
    for (const a of input.labs.analytes) {
      const points = subj?.results[a.key] ?? [];
      const pre = points.filter((p) => preIds.includes(p.tp) && p.value !== null);
      const lastPre = pre[pre.length - 1];
      const out = !!lastPre && lastPre.value !== null &&
        ((lastPre.min !== null && lastPre.value < lastPre.min) || (lastPre.max !== null && lastPre.value > lastPre.max));
      labs.push({ analyte: a, points, lastPre, preStats: stats(pre.map((p) => p.value as number)), lastPreOutOfRange: out });
    }
  }
  const labStale = labAgeMs === undefined || labAgeMs > cfg.labStaleMs;

  // ---- Rules per region ----
  const regions = Object.fromEntries(REGIONS.map((r) => [r.id, { status: 'ok', reasons: [] }])) as unknown as Record<RegionId, RegionState>;
  const add = (region: RegionId, reason: Reason) => regions[region].reasons.push(reason);

  for (const inc of openIncidents) {
    add(inc.region, {
      status: inc.urgency === 'urgent' ? 'urgent' : 'check',
      rule: inc.urgency === 'urgent' ? 'R-INCIDENT-URGENT' : 'R-INCIDENT-OPEN',
      title: inc.urgency === 'urgent' ? `Incident ${inc.id} marked URGENT${inc.scenario ? ' (demo scenario)' : ''}` : `Incident ${inc.id} open`,
      detail: `"${inc.title}", opened by ${inc.openedBy.name} at ${fmtTime(inc.openedAt)}.`,
      source: 'Incident record',
      ts: inc.openedAt,
    });
  }
  for (const s of activeSymptoms) {
    add(s.region, {
      status: 'check',
      rule: 'R-SYMPTOM-REPORTED',
      title: `Symptom reported: ${s.label}`,
      detail: `Reported by ${s.author.name} at ${fmtDateTime(s.ts)}${s.note ? `: ${s.note.replace(/\.$/, '')}` : ''}. Symptoms stay active for ${RULES_CONFIG.symptomWindowMs / 3_600_000} h.`,
      source: s.simulated ? 'Crew report (simulated scenario)' : 'Crew report',
      ts: s.ts,
    });
  }

  // Chest: heart rate
  if (hrStale) {
    add('chest', {
      status: 'nodata',
      rule: 'R-SENSOR-STALE',
      title: latestHr ? 'The heart-rate sensor has stopped sending data' : 'No heart-rate readings',
      detail: latestHr
        ? `Last reading: ${latestHr.bpm} bpm at ${fmtTime(latestHr.ts)} (${fmtAge(hrAgeMs!)} ago). The freshness limit is ${fmtAge(cfg.hrStaleMs)}; the value is no longer used for the assessment.`
        : 'No reading recorded.',
      source: 'Heart-rate sensor',
      ts: latestHr?.ts,
    });
  } else if (hrDeviation?.deviates && hrDeviation.baseline) {
    const d = hrDeviation;
    add('chest', {
      status: 'check',
      rule: 'R-HR-PERSONAL-DEVIATION',
      title: `Heart rate differs from this person's history (${ACTIVITY_LABEL[d.reading.activity]})`,
      detail: `Current reading ${d.reading.bpm} bpm at ${ACTIVITY_LABEL[d.reading.activity]}, ${fmtTime(d.reading.ts)}. Usual value in the same conditions: ${r1(d.baseline!.mean)} ± ${r1(d.baseline!.sd)} bpm (n=${d.baseline!.n}, last 14 days without the last 24 h). Deviation ${d.delta! > 0 ? '+' : ''}${r1(d.delta!)} bpm > threshold ${r1(d.threshold!)} bpm (max(2×SD, ${RULES_CONFIG.hrMinDeviationBpm} bpm)), so a check is requested.`,
      source: d.reading.simulated ? 'Heart-rate sensor (simulated data)' : 'Heart-rate sensor',
      ts: d.reading.ts,
    });
  }

  // Head: sleep and fatigue
  if (logStale) {
    add('head', {
      status: 'nodata', rule: 'R-DAILY-LOG-STALE', title: 'The daily log is missing or too old',
      detail: lastLog ? `Last entry: ${fmtDateTime(lastLog.ts)} (limit ${fmtAge(cfg.dailyLogStaleMs)}).` : 'No entry.',
      source: 'Daily log', ts: lastLog?.ts,
    });
  } else if (lastLog) {
    if (sleepBaseline && lastLog.sleepHours < sleepBaseline.mean - cfg.sleepDropHours) {
      add('head', {
        status: 'check', rule: 'R-SLEEP-BELOW-USUAL', title: 'Sleep below the usual value',
        detail: `Last night: ${lastLog.sleepHours} h. Personal mean: ${r1(sleepBaseline.mean)} h (n=${sleepBaseline.n} nights). Difference ${r1(lastLog.sleepHours - sleepBaseline.mean)} h, beyond the ${cfg.sleepDropHours} h threshold.`,
        source: lastLog.simulated ? 'Daily log (simulated data)' : 'Daily log', ts: lastLog.ts,
      });
    }
    if (fatigueBaseline && lastLog.fatigue >= fatigueBaseline.mean + cfg.fatigueRise) {
      add('head', {
        status: 'check', rule: 'R-FATIGUE-ABOVE-USUAL', title: 'Reported fatigue above the usual level',
        detail: `Reported today: ${lastLog.fatigue}/10. Personal mean: ${r1(fatigueBaseline.mean)}/10. Rise of ${cfg.fatigueRise} points or more.`,
        source: lastLog.simulated ? 'Daily log (simulated data)' : 'Daily log', ts: lastLog.ts,
      });
    }
  }

  // Arms and legs: exercise
  for (const region of ['arms', 'legs'] as RegionId[]) {
    if (logStale) {
      add(region, {
        status: 'nodata', rule: 'R-DAILY-LOG-STALE', title: 'Exercise minutes are missing or too old',
        detail: lastLog ? `Last entry: ${fmtDateTime(lastLog.ts)}.` : 'No entry.', source: 'Daily log', ts: lastLog?.ts,
      });
    } else if (exerciseRecent && exerciseBaseline && exerciseRecent.mean < exerciseBaseline.mean * cfg.exerciseRatio) {
      add(region, {
        status: 'check', rule: 'R-EXERCISE-BELOW-USUAL', title: 'Exercise below the usual level (3 days)',
        detail: `Mean of the last 3 days: ${Math.round(exerciseRecent.mean)} min/day. Earlier personal mean: ${Math.round(exerciseBaseline.mean)} min/day. Below ${Math.round(cfg.exerciseRatio * 100)} % of the usual level.`,
        source: lastLog?.simulated ? 'Daily log (simulated data)' : 'Daily log', ts: lastLog?.ts,
      });
    }
  }

  // Pelvis: the only source is the pre-flight lab panel, too old during the mission
  if (labStale) {
    add('pelvis', {
      status: 'nodata', rule: 'R-LAB-STALE', title: 'The lab tests are too old',
      detail: labAgeMs !== undefined
        ? `The latest metabolic panel on board is the pre-flight one (L-3), ${fmtAge(labAgeMs)} old. The limit is ${fmtAge(cfg.labStaleMs)}. The values are shown as history only.`
        : 'There are no lab tests for this profile.',
      source: 'Lab, NASA OSDR OSD-575 (real data)',
    });
  }

  let overall: Status = 'ok';
  for (const r of REGIONS) {
    const st = regions[r.id];
    st.reasons.sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status]);
    st.status = st.reasons[0]?.status ?? 'ok';
    // The overall status ignores the age of the pre-flight labs (it is the same for the whole crew)
    for (const reason of st.reasons)
      if (reason.rule !== 'R-LAB-STALE' && SEVERITY[reason.status] > SEVERITY[overall]) overall = reason.status;
  }

  return {
    astronautId, now, hr, latestHr, hrAgeMs, hrStale, hrBaseline, hrDeviation, logs, lastLog, logStale,
    sleepBaseline, fatigueBaseline, exerciseBaseline, exerciseRecent, activeSymptoms, incidents, openIncidents,
    timeline, labs, labAgeMs, labStale, regions, overall,
  };
}

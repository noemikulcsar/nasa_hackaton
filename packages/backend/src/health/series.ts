/**
 * Time series and averages for the charts (computed on the server):
 *  - vital signs over a chosen window, averaged into time buckets, with min / mean / max;
 *  - daily means for the last 14 days (one value per day per signal);
 *  - daily log trends (sleep, efficiency, stress, fatigue, exercise) with 14-day personal means;
 *  - periodic assessment trends over the mission (bone, muscle, fluids, radiation, lung);
 *  - real NASA OSDR blood tests attributed to the profile.
 */
import { derive, stats } from '@orbital/shared/rules';
import { CREW_BY_ID } from '@orbital/shared/crew';
import type { DailyLog, HrReading, LabsData, StoredEvent } from '@orbital/shared/types';
import { isHealthEvent } from '@orbital/shared/types';
import { ACTIVITY_EN, LIMITS_FOR_CHARTS, SENSOR_SIGNALS, type Signal } from './engine';

const r = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const valueOf = (e: HrReading, s: Signal) => (s === 'heartRate' ? e.bpm : (e as unknown as Record<string, number | undefined>)[s]);

export function vitalSeries(events: StoredEvent[], astronautId: string, hours: number, now: number) {
  const from = now - hours * 3_600_000;
  const readings = events.filter((e): e is HrReading => e.type === 'hr_reading' && e.astronautId === astronautId).sort((a, b) => a.ts - b.ts);
  const inWindow = readings.filter((e) => e.ts >= from);
  const maxPoints = 180;
  const bucketMs = Math.max(1, Math.ceil((hours * 3_600_000) / maxPoints));

  const signals = Object.fromEntries(SENSOR_SIGNALS.map((s) => {
    const buckets = new Map<number, number[]>();
    for (const e of inWindow) {
      const v = valueOf(e, s);
      if (typeof v !== 'number') continue;
      const k = Math.floor((e.ts - from) / bucketMs);
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(v);
    }
    const points = [...buckets.entries()].sort((a, b) => a[0] - b[0])
      .map(([k, vs]) => ({ ts: from + k * bucketMs + bucketMs / 2, value: r(vs.reduce((a, b) => a + b, 0) / vs.length, LIMITS_FOR_CHARTS[s].decimals), n: vs.length }));
    const all = inWindow.map((e) => valueOf(e, s)).filter((v): v is number => typeof v === 'number');
    const st = stats(all);
    // Daily means for the last 14 days
    const daily: { date: string; mean: number; n: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now - i * 86_400_000); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 86_400_000;
      const vs = readings.filter((e) => e.ts >= dayStart.getTime() && e.ts < dayEnd).map((e) => valueOf(e, s)).filter((v): v is number => typeof v === 'number');
      if (vs.length) daily.push({ date: dayStart.toISOString().slice(0, 10), mean: r(vs.reduce((a, b) => a + b, 0) / vs.length, LIMITS_FOR_CHARTS[s].decimals), n: vs.length });
    }
    return [s, {
      ...LIMITS_FOR_CHARTS[s], points,
      summary: st ? { mean: r(st.mean, LIMITS_FOR_CHARTS[s].decimals), sd: r(st.sd, 1), min: Math.min(...all), max: Math.max(...all), n: st.n } : null,
      daily,
    }];
  }));

  // Heart rate grouped by activity in the window (the comparison used by the rules)
  const byActivity = Object.fromEntries((['sleep', 'rest', 'work', 'exercise'] as const).map((a) => {
    const st = stats(inWindow.filter((e) => e.activity === a).map((e) => e.bpm));
    return [ACTIVITY_EN[a], st ? { mean: r(st.mean), sd: r(st.sd), n: st.n } : null];
  }));
  const activity = inWindow.map((e) => ({ ts: e.ts, activity: ACTIVITY_EN[e.activity] }));
  return { astronautId, from, to: now, hours, bucketMinutes: r(bucketMs / 60_000, 1), signals, heartRateByActivity: byActivity, activity: compressActivity(activity) };
}

function compressActivity(list: { ts: number; activity: string }[]) {
  const out: { from: number; to: number; activity: string }[] = [];
  for (const a of list) {
    const lastSeg = out[out.length - 1];
    if (lastSeg && lastSeg.activity === a.activity) lastSeg.to = a.ts;
    else out.push({ from: a.ts, to: a.ts, activity: a.activity });
  }
  return out;
}

export function recordSeries(events: StoredEvent[], astronautId: string, now: number, missionStart: number, labs: LabsData) {
  const crew = CREW_BY_ID[astronautId];
  const health = events.filter(isHealthEvent);
  const d = derive({ astronautId, events: health, now, missionStart, labs, osdrSubject: crew.osdrSubject });
  const logs = events.filter((e): e is DailyLog => e.type === 'daily_log' && e.astronautId === astronautId).sort((a, b) => a.ts - b.ts).slice(-15);
  const logSeries = (key: 'sleepHours' | 'sleepEfficiency' | 'stress' | 'fatigue' | 'exerciseMinutes') => {
    const points = logs.map((l) => ({ date: l.date, value: l[key] as number | undefined })).filter((p): p is { date: string; value: number } => typeof p.value === 'number');
    const st = stats(points.slice(0, -1).map((p) => p.value));
    return { points, personalMean: st ? r(st.mean) : null, last: points[points.length - 1]?.value ?? null };
  };

  const assessments = events.filter((e) => e.type === 'assessment' && e.astronautId === astronautId).sort((a, b) => a.ts - b.ts);
  const domains: Record<string, { missionDay: number; ts: number; values: Record<string, number | string> }[]> = {};
  for (const e of assessments) if (e.type === 'assessment') (domains[e.domain] ??= []).push({ missionDay: e.missionDay, ts: e.ts, values: e.values });

  // Rate of change per assessment metric (per 30 days), computed from the first and last assessment
  const trends: Record<string, { first: number; last: number; perMonth: number }> = {};
  for (const [domain, list] of Object.entries(domains)) {
    if (list.length < 2) continue;
    const a = list[0], b = list[list.length - 1];
    for (const [k, v] of Object.entries(b.values)) {
      if (typeof v !== 'number' || typeof a.values[k] !== 'number') continue;
      const days = Math.max(1, b.missionDay - a.missionDay);
      trends[`${domain}.${k}`] = { first: a.values[k] as number, last: v, perMonth: r(((v - (a.values[k] as number)) / days) * 30, 2) };
    }
  }

  return {
    astronautId,
    daily: {
      sleepHours: logSeries('sleepHours'), sleepEfficiency: logSeries('sleepEfficiency'), stress: logSeries('stress'),
      fatigue: logSeries('fatigue'), exerciseMinutes: logSeries('exerciseMinutes'),
    },
    assessments: domains,
    trends,
    labs: {
      source: labs.source, timepoints: labs.timepoints, ageDays: d.labAgeMs ? Math.round(d.labAgeMs / 86_400_000) : null,
      items: d.labs.map((l) => ({
        key: l.analyte.key, name: l.analyte.name, unit: l.analyte.unit, system: l.analyte.system, region: l.analyte.region,
        panel: l.analyte.panel, hasRange: l.analyte.hasRange, points: l.points,
        lastPreflight: l.lastPre ?? null, outOfRange: l.lastPreOutOfRange,
        preflightMean: l.preStats ? r(l.preStats.mean, 2) : null,
      })),
    },
  };
}

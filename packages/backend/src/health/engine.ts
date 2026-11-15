/**
 * Health engine (backend). Builds the complete health report shown in the interface:
 *  - every metric graded against demo clinical bands (nominal / check / warning / critical);
 *  - comparisons with the crew member's personal history in comparable conditions
 *    (heart rate by activity, sleep, fatigue, exercise) — computed by `derive()` in shared/rules.ts;
 *  - stale or missing data → "No data" (grey);
 *  - reported symptoms → "Check"; incidents marked urgent → "Critical";
 *  - a status and the list of triggering rules for each of the 7 body regions.
 * Thresholds are illustrative demo values, not validated clinical limits.
 */
import { EVIDENCE, type EvidenceId } from '../simulation/calibration';
import { derive, stats, type Derived } from '@orbital/shared/rules';
import { REGIONS } from '@orbital/shared/regions';
import { CREW_BY_ID } from '@orbital/shared/crew';
import type { Activity, AssessmentEvent, LabsData, RegionId, StoredEvent } from '@orbital/shared/types';
import { isHealthEvent } from '@orbital/shared/types';

export type Level = 'nominal' | 'advisory' | 'warning' | 'critical' | 'nodata';
export const LEVEL_RANK: Record<Level, number> = { nominal: 0, nodata: 1, advisory: 2, warning: 3, critical: 4 };
export const LEVEL_LABEL: Record<Level, string> = { nominal: 'Nominal', advisory: 'Check', warning: 'Warning', critical: 'Critical', nodata: 'No data' };
export const ACTIVITY_EN: Record<Activity, string> = { sleep: 'sleep', rest: 'rest', work: 'work', exercise: 'exercise' };
export const CLINICAL_NOTE = 'A finding only triggers a check. A diagnosis comes only from an authorized clinical source (the crew medical officer or the flight surgeon).';

const H = 3_600_000;
const D = 24 * H;
const r1 = (v: number) => Math.round(v * 10) / 10;
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (ts: number) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function fmtAge(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(h / 24)} days`;
}

const high = (v: number, crit: number, warn: number, adv: number): Level => (v >= crit ? 'critical' : v >= warn ? 'warning' : v >= adv ? 'advisory' : 'nominal');
const low = (v: number, crit: number, warn: number, adv: number): Level => (v <= crit ? 'critical' : v <= warn ? 'warning' : v <= adv ? 'advisory' : 'nominal');

type Source = 'sensor' | 'log' | 'assessment';
interface Ctx {
  d: Derived;
  vitals: VitalsBlock;
  records: Partial<Record<string, AssessmentEvent>>;
}

interface MetricDef {
  id: string;
  region: RegionId;
  label: string;
  unit: string;
  source: Source;
  domain?: AssessmentEvent['domain'];
  value: (c: Ctx) => number | string | undefined;
  display: (v: number | string, c: Ctx) => string;
  rule: (v: number | string) => Level;
  normal: string;
  bands: string;
  /** Published finding behind the band or the simulated value */
  ref?: EvidenceId;
  advice: string;
}

/** Recommended next step for each metric. Non-medication actions only; treatments come from approved protocols. */
const ADVICE = {
  heartRate: 'Repeat the reading after 5 minutes of rest, check the sensor fit, and tell the medical officer if it stays out of range.',
  spo2: 'Check the finger sensor and repeat the reading now. If it stays low, call the medical officer and open the relevant protocol.',
  bloodPressure: 'Repeat the cuff reading at rest. If it stays out of range, ask the medical officer to review it.',
  respiratoryRate: 'Count breaths for one minute and ask about breathlessness. Report it to the medical officer if it persists.',
  bodyTemp: 'Repeat the reading in 15 minutes and log any symptoms. Report a raised temperature to the medical officer.',
  fvc: 'Schedule a spirometry recheck and log any breathing symptoms.',
  visualShift: 'Log the change and schedule the eye examination planned for vision changes in flight.',
  sleepHours: 'Protect the next sleep period and review the schedule with the commander.',
  sleepEfficiency: 'Check light, noise and temperature in the crew quarters.',
  stress: 'Offer a private conference with the behavioral health team and review the workload plan.',
  fatigue: 'Move tasks that need full concentration and review the schedule.',
  lumbarBmd: 'Keep the daily exercise plan, including resistive ARED sessions, and log diet adherence.',
  femoralBmd: 'Review the loading program at the next bone scan.',
  radiation: 'Log the dose and review shielding in the sleep quarters with the radiation officer.',
  ared: 'Schedule resistive sessions to reach at least 4 per week.',
  exercise: 'Log the reason for less exercise (pain, schedule, equipment) and review the plan.',
  grip: 'Add hand-grip work and check readiness for tasks in pressurized gloves.',
  quad: 'Review leg loads in the resistive exercise plan.',
  soleus: 'Review calf loads in the resistive exercise plan.',
  legVolume: 'Review fluid intake with the medical officer and check standing tolerance before strenuous tasks.',
  standing: 'Change position slowly, keep fluids up, and log each episode of dizziness.',
};

const rec = (domain: AssessmentEvent['domain'], key: string) => (c: Ctx) => c.records[domain]?.values[key];
const num = (v: number | string) => Number(v);

export const METRICS: MetricDef[] = [
  { id: 'heartRate', region: 'chest', label: 'Heart rate', unit: 'bpm', source: 'sensor', value: (c) => c.vitals.heartRate,
    display: (v) => `${Math.round(num(v))} bpm`,
    rule: (v) => { const x = num(v); return x < 40 || x > 140 ? 'critical' : x < 50 || x > 120 ? 'warning' : x < 55 || x > 100 ? 'advisory' : 'nominal'; },
    normal: '55–100 bpm', bands: 'Check < 55 or > 100, warning < 50 or > 120, critical < 40 or > 140 bpm. Heart rate is unchanged in flight', advice: ADVICE.heartRate, ref: 'bloodPressure' },
  { id: 'spo2', region: 'chest', label: 'Blood oxygen (SpO₂)', unit: '%', source: 'sensor', value: (c) => c.vitals.spo2,
    display: (v) => `${num(v).toFixed(1)} %`, rule: (v) => low(num(v), 89.99, 92.99, 94.99),
    normal: '≥ 95 %', bands: 'Check < 95 %, warning < 93 %, critical < 90 %', advice: ADVICE.spo2 },
  { id: 'bloodPressure', region: 'chest', label: 'Blood pressure', unit: 'mmHg', source: 'sensor', value: (c) => c.vitals.systolic,
    display: (v, c) => `${Math.round(num(v))}/${c.vitals.diastolic ?? '–'} mmHg`,
    rule: (v) => { const x = num(v); return x >= 160 || x < 80 ? 'critical' : x >= 140 || x < 90 ? 'warning' : x >= 130 ? 'advisory' : 'nominal'; },
    normal: 'systolic 90–129 mmHg', bands: 'Check ≥ 130, warning ≥ 140 or < 90, critical ≥ 160 or < 80 mmHg systolic. In flight the 24-hour pressure is about 8 mmHg lower than on the ground', advice: ADVICE.bloodPressure, ref: 'bloodPressure' },
  { id: 'respiratoryRate', region: 'chest', label: 'Breathing rate', unit: '/min', source: 'sensor', value: (c) => c.vitals.respiratoryRate,
    display: (v) => `${Math.round(num(v))} /min`,
    rule: (v) => { const x = num(v); return x >= 30 || x < 8 ? 'critical' : x >= 25 || x < 10 ? 'warning' : x >= 21 ? 'advisory' : 'nominal'; },
    normal: '10–20 /min', bands: 'Check ≥ 21, warning ≥ 25 or < 10, critical ≥ 30 or < 8 /min', advice: ADVICE.respiratoryRate },
  { id: 'bodyTemp', region: 'chest', label: 'Core temperature', unit: '°C', source: 'sensor', value: (c) => c.vitals.bodyTemp,
    display: (v) => `${num(v).toFixed(1)} °C`,
    rule: (v) => { const x = num(v); return x >= 39.5 || x < 35 ? 'critical' : x >= 38.6 || x < 35.5 ? 'warning' : x >= 38.1 || x < 36.1 ? 'advisory' : 'nominal'; },
    normal: '36.1–38.0 °C in flight', bands: 'In flight, resting core temperature runs about 1 °C above the ground value. Check ≥ 38.1 or < 36.1, warning ≥ 38.6 or < 35.5, critical ≥ 39.5 or < 35 °C', advice: ADVICE.bodyTemp, ref: 'coreTemperature' },
  { id: 'fvc', region: 'chest', label: 'Lung capacity (FVC)', unit: '% predicted', source: 'assessment', domain: 'lung', value: rec('lung', 'fvcPct'),
    display: (v) => `${Math.round(num(v))} % predicted`, rule: (v) => low(num(v), 59.9, 69.9, 79.9),
    normal: '≥ 80 % predicted', bands: 'Check < 80 %, warning < 70 %, critical < 60 %', advice: ADVICE.fvc },

  { id: 'visualShift', region: 'head', label: 'Visual acuity shift', unit: 'D', source: 'assessment', domain: 'fluids', value: rec('fluids', 'visualShiftD'),
    display: (v) => `+${num(v).toFixed(2)} D`, rule: (v) => high(num(v), 1.5, 1.0, 0.5),
    normal: '< +0.50 D', bands: 'Check ≥ +0.5, warning ≥ +1.0, critical ≥ +1.5 dioptres', advice: ADVICE.visualShift },
  { id: 'sleepHours', region: 'head', label: 'Sleep last night', unit: 'h', source: 'log', value: (c) => c.d.lastLog?.sleepHours,
    display: (v) => `${num(v).toFixed(1)} h`, rule: (v) => { const x = num(v); return x < 4 ? 'critical' : x < 5 ? 'warning' : x < 6 ? 'advisory' : 'nominal'; },
    normal: '≥ 6 h (ISS mean 6.1 h, 8.5 h scheduled)', bands: 'Check < 6 h, warning < 5 h, critical < 4 h', advice: ADVICE.sleepHours, ref: 'sleep' },
  { id: 'sleepEfficiency', region: 'head', label: 'Sleep efficiency', unit: '%', source: 'log', value: (c) => c.d.lastLog?.sleepEfficiency,
    display: (v) => `${Math.round(num(v))} %`, rule: (v) => (num(v) < 70 ? 'warning' : num(v) < 85 ? 'advisory' : 'nominal'),
    normal: '≥ 85 %', bands: 'Check < 85 %, warning < 70 %', advice: ADVICE.sleepEfficiency },
  { id: 'stress', region: 'head', label: 'Stress score', unit: '/10', source: 'log', value: (c) => c.d.lastLog?.stress ?? c.records.psych?.values.stressScore,
    display: (v) => `${num(v).toFixed(1)} / 10`, rule: (v) => high(num(v), 9, 7, 5),
    normal: '< 5 / 10', bands: 'Check ≥ 5, warning ≥ 7, critical ≥ 9', advice: ADVICE.stress },
  { id: 'fatigue', region: 'head', label: 'Reported fatigue', unit: '/10', source: 'log', value: (c) => c.d.lastLog?.fatigue,
    display: (v) => `${num(v)} / 10`, rule: (v) => high(num(v), 10, 8, 6),
    normal: '< 6 / 10', bands: 'Check ≥ 6, warning ≥ 8', advice: ADVICE.fatigue },

  { id: 'lumbarBmd', region: 'pelvis', label: 'Lumbar bone loss per month', unit: '%/mo', source: 'assessment', domain: 'bone', value: rec('bone', 'monthlyLossPct'),
    display: (v) => `${num(v).toFixed(1)} % / mo`, rule: (v) => low(num(v), -2.0, -1.5, -1.0),
    normal: 'loss smaller than 1.0 % / month (published mean 0.9)', bands: 'Check ≤ −1.0, warning ≤ −1.5, critical ≤ −2.0 % per month', advice: ADVICE.lumbarBmd, ref: 'boneLoss' },
  { id: 'femoralBmd', region: 'pelvis', label: 'Femoral neck density change', unit: '%', source: 'assessment', domain: 'bone', value: rec('bone', 'femoralNeckBmdChangePct'),
    display: (v) => `${num(v).toFixed(1)} %`, rule: (v) => low(num(v), -10, -7, -4.5),
    normal: 'better than −4.5 % (hip loss averages 1.4–1.5 % per month)', bands: 'Check ≤ −4.5 %, warning ≤ −7 %, critical ≤ −10 %', advice: ADVICE.femoralBmd, ref: 'boneLoss' },
  { id: 'radiation', region: 'pelvis', label: 'Career radiation dose', unit: '% of limit', source: 'assessment', domain: 'radiation',
    value: (c) => { const v = c.records.radiation?.values; return v ? num(v.careerDoseMSv) / num(v.careerLimitMSv) : undefined; },
    display: (v) => `${Math.round(num(v) * 100)} % of limit`, rule: (v) => high(num(v), 0.9, 0.75, 0.5),
    normal: '< 50 % of the 600 mSv career limit', bands: 'Check ≥ 50 %, warning ≥ 75 %, critical ≥ 90 % of the limit. ISS dose rate 0.2–0.5 mSv per day', advice: ADVICE.radiation, ref: 'radiationLimit' },

  { id: 'ared', region: 'arms', label: 'ARED sessions this week', unit: '/week', source: 'assessment', domain: 'muscle', value: rec('muscle', 'aredSessionsPerWeek'),
    display: (v) => `${Math.round(num(v))} / week`, rule: (v) => (num(v) < 2 ? 'warning' : num(v) < 4 ? 'advisory' : 'nominal'),
    normal: '≥ 4 per week', bands: 'Check < 4, warning < 2 sessions per week', advice: ADVICE.ared },
  { id: 'grip', region: 'hands', label: 'Grip strength change', unit: '%', source: 'assessment', domain: 'muscle', value: rec('muscle', 'gripChangePct'),
    display: (v) => `${num(v).toFixed(1)} %`, rule: (v) => low(num(v), -25, -20, -10),
    normal: 'better than −10 %', bands: 'Check ≤ −10 %, warning ≤ −20 %, critical ≤ −25 %', advice: ADVICE.grip },
  { id: 'quad', region: 'legs', label: 'Quadriceps size change', unit: '%', source: 'assessment', domain: 'muscle', value: rec('muscle', 'quadChangePct'),
    display: (v) => `${num(v).toFixed(1)} %`, rule: (v) => low(num(v), -15, -10, -5),
    normal: 'better than −5 %', bands: 'Check ≤ −5 %, warning ≤ −10 %, critical ≤ −15 %', advice: ADVICE.quad },
  { id: 'soleus', region: 'legs', label: 'Calf (soleus) size change', unit: '%', source: 'assessment', domain: 'muscle', value: rec('muscle', 'soleusChangePct'),
    display: (v) => `${num(v).toFixed(1)} %`, rule: (v) => low(num(v), -20, -15, -10),
    normal: 'better than −10 % (−15 % is the 6-month average)', bands: 'Check ≤ −10 %, warning ≤ −15 %, critical ≤ −20 %', advice: ADVICE.soleus, ref: 'calfMuscle' },
  { id: 'legVolume', region: 'legs', label: 'Lower-leg fluid volume', unit: '%', source: 'assessment', domain: 'fluids', value: rec('fluids', 'legVolumeChangePct'),
    display: (v) => `${num(v).toFixed(1)} %`, rule: (v) => low(num(v), -25, -20, -17),
    normal: '−8 to −16 % (expected fluid shift, about −12.7 %)', bands: 'Check ≤ −17 %, warning ≤ −20 %, critical ≤ −25 %', advice: ADVICE.legVolume, ref: 'legVolume' },
  { id: 'exercise', region: 'legs', label: 'Exercise per day (3-day mean)', unit: 'min', source: 'log', value: (c) => (c.d.exerciseRecent ? Math.round(c.d.exerciseRecent.mean) : undefined),
    display: (v) => `${v} min`, rule: (v) => (num(v) < 60 ? 'warning' : num(v) < 90 ? 'advisory' : 'nominal'),
    normal: '≥ 90 min / day', bands: 'Check < 90, warning < 60 minutes per day', advice: ADVICE.exercise, ref: 'exercise' },
  { id: 'standing', region: 'feet', label: 'Standing tolerance', unit: '', source: 'assessment', domain: 'fluids', value: rec('fluids', 'orthostaticStatus'),
    display: (v) => ({ normal: 'Normal', reduced: 'Reduced', poor: 'Poor' } as Record<string, string>)[String(v)] ?? String(v),
    rule: (v) => (({ normal: 'nominal', reduced: 'advisory', poor: 'warning' } as Record<string, Level>)[String(v)] ?? 'nominal'),
    normal: 'Normal', bands: 'Check if reduced, warning if poor', advice: ADVICE.standing },
];

export const SENSOR_SIGNALS = ['heartRate', 'spo2', 'systolic', 'diastolic', 'bodyTemp', 'respiratoryRate'] as const;
export type Signal = (typeof SENSOR_SIGNALS)[number];

export interface VitalsBlock {
  ts?: number; ageMs?: number; stale: boolean; activity?: Activity; activityLabel?: string; simulated?: boolean; manual?: boolean;
  heartRate?: number; spo2?: number; systolic?: number; diastolic?: number; bodyTemp?: number; respiratoryRate?: number;
  /** Last 40 readings per signal, for sparklines */
  history: Record<Signal, number[]>;
}

export interface Reason {
  status: Level; rule: string; title: string; detail: string; source: string; ts?: number; metric?: string;
  /** Short name of the problem, without numbers (used for critical alerts, e.g. "Blood oxygen critically low") */
  condition?: string;
}

/** Short problem name for a metric outside its band, without values. */
function conditionName(m: MetricOut): string {
  const v = typeof m.value === 'number' ? m.value : Number.NaN;
  const level = m.status === 'critical' ? 'critically' : m.status === 'warning' ? '' : 'slightly';
  const dir = (low: boolean, what: string) => `${what} ${level} ${low ? 'low' : 'high'}`.replace(/\s+/g, ' ');
  switch (m.id) {
    case 'heartRate': return dir(v < 55, 'Heart rate');
    case 'spo2': return dir(true, 'Blood oxygen');
    case 'bloodPressure': return dir(v < 90, 'Blood pressure');
    case 'respiratoryRate': return dir(v < 10, 'Breathing rate');
    case 'bodyTemp': return dir(v < 36.1, 'Core temperature');
    default: return `${m.label} ${m.status === 'critical' ? 'critical' : 'out of range'}`;
  }
}
export interface MetricOut {
  id: string; region: RegionId; label: string; unit: string; value: number | string | null; display: string;
  status: Level; normal: string; bands: string; source: string; simulated: boolean; updatedAt?: number; measuredDay?: number;
  advice: string; usual?: { mean: number; sd: number; n: number; label: string };
  /** Published finding behind the reference band (see simulation/calibration.ts) */
  reference?: { finding: string; source: string; url: string };
}
export interface RegionOut { id: RegionId; label: string; title: string; description: string; status: Level; metrics: string[]; reasons: Reason[]; advice: string }
export interface HealthReport {
  astronautId: string; at: number; overall: Level; overallLabel: string;
  vitals: VitalsBlock; metrics: MetricOut[]; regions: Record<RegionId, RegionOut>; alerts: (Reason & { region: RegionId; regionLabel: string })[];
  openIncidents: { id: string; title: string; region: RegionId; urgency: string; scenario: boolean; openedAt: number; openedBy: string }[];
  activeSymptoms: { id: string; label: string; region: RegionId; note?: string; ts: number; by: string }[];
  psych: { mood?: string; anxiety?: string; crewCohesion?: number; workloadScore?: number; missionDay?: number };
  baselines: { heartRateByActivity: Partial<Record<Activity, { mean: number; sd: number; n: number }>>; sleepHours?: number; fatigue?: number; exerciseMinutes?: number };
  clinicalNote: string;
}

const SOURCE_LABEL: Record<Source, string> = { sensor: 'Vital-sign sensor', log: 'Daily log', assessment: 'Periodic assessment' };

export interface EngineInput {
  astronautId: string; events: StoredEvent[]; now: number; missionStart: number; labs?: LabsData; hrStaleMs: number;
}

export function buildHealthReport(input: EngineInput): HealthReport {
  const { astronautId, now } = input;
  const crew = CREW_BY_ID[astronautId];
  const health = input.events.filter(isHealthEvent);
  const d = derive({ astronautId, events: health, now, missionStart: input.missionStart, labs: input.labs, osdrSubject: crew.osdrSubject, hrStaleMs: input.hrStaleMs });

  // ---- latest vital signs + history for sparklines ----
  const readings = d.hr;
  const last = d.latestHr;
  const recent = readings.slice(-40);
  const history = Object.fromEntries(SENSOR_SIGNALS.map((s) => [s, recent.map((r) => (s === 'heartRate' ? r.bpm : (r[s as keyof typeof r] as number))).filter((v) => typeof v === 'number')])) as Record<Signal, number[]>;
  const latestOf = (s: Signal) => { for (let i = readings.length - 1; i >= 0; i--) { const v = s === 'heartRate' ? readings[i].bpm : (readings[i] as unknown as Record<string, number>)[s]; if (typeof v === 'number') return v; } return undefined; };
  const vitals: VitalsBlock = {
    ts: last?.ts, ageMs: last ? now - last.ts : undefined, stale: d.hrStale, activity: last?.activity,
    activityLabel: last ? ACTIVITY_EN[last.activity] : undefined, simulated: last?.simulated, manual: last?.manual,
    heartRate: last?.bpm, spo2: latestOf('spo2'), systolic: latestOf('systolic'), diastolic: latestOf('diastolic'),
    bodyTemp: latestOf('bodyTemp'), respiratoryRate: latestOf('respiratoryRate'), history,
  };

  // ---- latest periodic assessment per domain ----
  const records: Ctx['records'] = {};
  for (const e of input.events) if (e.type === 'assessment' && e.astronautId === astronautId) {
    const prev = records[e.domain];
    if (!prev || e.ts > prev.ts) records[e.domain] = e;
  }
  const ctx: Ctx = { d, vitals, records };

  // ---- metrics ----
  const metrics: MetricOut[] = METRICS.map((m) => {
    const raw = m.value(ctx);
    const stale = (m.source === 'sensor' && d.hrStale) || (m.source === 'log' && d.logStale);
    const updatedAt = m.source === 'sensor' ? last?.ts : m.source === 'log' ? d.lastLog?.ts : records[m.domain!]?.ts;
    const simulated = m.source === 'sensor' ? !!last?.simulated : m.source === 'log' ? !!d.lastLog?.simulated : !!records[m.domain!]?.simulated;
    let status: Level = raw === undefined || raw === null ? 'nodata' : m.rule(raw);
    if (stale) status = 'nodata';
    const out: MetricOut = {
      id: m.id, region: m.region, label: m.label, unit: m.unit, value: raw ?? null,
      display: raw === undefined || raw === null ? '–' : m.display(raw, ctx), status, normal: m.normal, bands: m.bands, reference: m.ref ? { finding: EVIDENCE[m.ref].finding, source: EVIDENCE[m.ref].source, url: EVIDENCE[m.ref].url } : undefined,
      source: `${SOURCE_LABEL[m.source]}${simulated ? ' (simulated)' : ''}`, simulated, updatedAt,
      measuredDay: m.source === 'assessment' ? records[m.domain!]?.missionDay : undefined,
      advice: status === 'nominal' || status === 'nodata' ? '' : m.advice,
    };
    if (m.id === 'heartRate' && last) {
      const b = d.hrBaseline[last.activity];
      if (b) out.usual = { mean: r1(b.mean), sd: r1(b.sd), n: b.n, label: `usual at ${ACTIVITY_EN[last.activity]}` };
    }
    if (m.id === 'sleepHours' && d.sleepBaseline) out.usual = { mean: r1(d.sleepBaseline.mean), sd: r1(d.sleepBaseline.sd), n: d.sleepBaseline.n, label: 'personal mean' };
    if (m.id === 'fatigue' && d.fatigueBaseline) out.usual = { mean: r1(d.fatigueBaseline.mean), sd: r1(d.fatigueBaseline.sd), n: d.fatigueBaseline.n, label: 'personal mean' };
    if (m.id === 'exercise' && d.exerciseBaseline) out.usual = { mean: Math.round(d.exerciseBaseline.mean), sd: r1(d.exerciseBaseline.sd), n: d.exerciseBaseline.n, label: 'personal mean' };
    if (m.id === 'stress') {
      const s = stats(d.logs.slice(0, -1).slice(-14).map((l) => l.stress).filter((x): x is number => typeof x === 'number'));
      if (s) out.usual = { mean: r1(s.mean), sd: r1(s.sd), n: s.n, label: 'personal mean' };
    }
    return out;
  });
  const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));

  // ---- reasons per region ----
  const regions = Object.fromEntries(REGIONS.map((r) => [r.id, {
    id: r.id, label: r.label, title: r.title, description: r.description, status: 'nominal' as Level,
    metrics: metrics.filter((m) => m.region === r.id).map((m) => m.id), reasons: [] as Reason[], advice: '',
  }])) as Record<RegionId, RegionOut>;
  const add = (region: RegionId, reason: Reason) => regions[region].reasons.push(reason);

  for (const inc of d.openIncidents) {
    add(inc.region, {
      status: inc.urgency === 'urgent' ? 'critical' : 'warning', rule: inc.urgency === 'urgent' ? 'R-INCIDENT-URGENT' : 'R-INCIDENT-OPEN',
      title: `Incident ${inc.id} ${inc.urgency === 'urgent' ? 'marked urgent' : 'open'}${inc.scenario ? ' (demo scenario)' : ''}`, condition: inc.title,
      detail: `“${inc.title}”, opened by ${inc.openedBy.name} at ${fmtTime(inc.openedAt)}.`, source: 'Incident record', ts: inc.openedAt,
    });
  }
  for (const s of d.activeSymptoms) {
    add(s.region, {
      status: 'advisory', rule: 'R-SYMPTOM-REPORTED', title: `Symptom reported: ${s.label}`,
      detail: `Reported by ${s.author.name} on ${fmtDateTime(s.ts)}${s.note ? `: ${s.note.replace(/\.$/, '')}` : ''}. Symptoms stay active for 72 h.`,
      source: s.simulated ? 'Crew report (simulated scenario)' : 'Crew report', ts: s.ts,
    });
  }

  // Sensor freshness
  if (d.hrStale) {
    add('chest', {
      status: 'nodata', rule: 'R-SENSOR-STALE', title: last ? 'The vital-sign sensor stopped sending data' : 'No vital-sign readings',
      detail: last ? `Last reading ${last.bpm} bpm at ${fmtTime(last.ts)}, ${fmtAge(now - last.ts)} ago. Readings older than ${fmtAge(input.hrStaleMs)} are not used for assessment.` : 'Nothing has been recorded.',
      source: 'Vital-sign sensor', ts: last?.ts,
    });
  } else if (d.hrDeviation?.deviates && d.hrDeviation.baseline) {
    const dv = d.hrDeviation;
    add('chest', {
      status: 'advisory', rule: 'R-HR-PERSONAL-DEVIATION', metric: 'heartRate',
      title: `Heart rate differs from this person’s usual value at ${ACTIVITY_EN[dv.reading.activity]}`,
      detail: `Current ${dv.reading.bpm} bpm at ${ACTIVITY_EN[dv.reading.activity]} (${fmtTime(dv.reading.ts)}). Usual in the same conditions: ${r1(dv.baseline!.mean)} ± ${r1(dv.baseline!.sd)} bpm (n=${dv.baseline!.n}, last 14 days excluding the last 24 h). Difference ${dv.delta! > 0 ? '+' : ''}${r1(dv.delta!)} bpm exceeds the ${r1(dv.threshold!)} bpm threshold (max of 2 SD and 10 bpm), so a check is requested.`,
      source: dv.reading.simulated ? 'Vital-sign sensor (simulated)' : 'Vital-sign sensor', ts: dv.reading.ts,
    });
  }
  if (d.logStale) {
    for (const region of ['head', 'legs'] as RegionId[]) add(region, {
      status: 'nodata', rule: 'R-DAILY-LOG-STALE', title: 'The daily log is missing or too old',
      detail: d.lastLog ? `Last entry ${fmtDateTime(d.lastLog.ts)}; entries older than 36 h are not used.` : 'No entries.', source: 'Daily log', ts: d.lastLog?.ts,
    });
  } else if (d.lastLog) {
    if (d.sleepBaseline && d.lastLog.sleepHours < d.sleepBaseline.mean - 1.5) add('head', {
      status: 'advisory', rule: 'R-SLEEP-BELOW-USUAL', metric: 'sleepHours', title: 'Sleep below this person’s usual',
      detail: `${d.lastLog.sleepHours} h last night against a personal mean of ${r1(d.sleepBaseline.mean)} h (${d.sleepBaseline.n} nights). Difference larger than 1.5 h.`,
      source: d.lastLog.simulated ? 'Daily log (simulated)' : 'Daily log', ts: d.lastLog.ts,
    });
    if (d.fatigueBaseline && d.lastLog.fatigue >= d.fatigueBaseline.mean + 3) add('head', {
      status: 'advisory', rule: 'R-FATIGUE-ABOVE-USUAL', metric: 'fatigue', title: 'Fatigue above this person’s usual',
      detail: `Reported ${d.lastLog.fatigue}/10 today against a personal mean of ${r1(d.fatigueBaseline.mean)}/10. Rise of 3 points or more.`,
      source: d.lastLog.simulated ? 'Daily log (simulated)' : 'Daily log', ts: d.lastLog.ts,
    });
    if (d.exerciseRecent && d.exerciseBaseline && d.exerciseRecent.mean < d.exerciseBaseline.mean * 0.6) for (const region of ['arms', 'legs'] as RegionId[]) add(region, {
      status: 'advisory', rule: 'R-EXERCISE-BELOW-USUAL', metric: 'exercise', title: 'Exercise below this person’s usual (3 days)',
      detail: `${Math.round(d.exerciseRecent.mean)} min/day over the last 3 days against a personal mean of ${Math.round(d.exerciseBaseline.mean)} min/day (below 60 %).`,
      source: 'Daily log', ts: d.lastLog.ts,
    });
  }

  // Threshold rules for every metric outside its normal band
  for (const m of metrics) {
    if (m.status === 'nominal' || m.status === 'nodata') continue;
    add(m.region, {
      status: m.status, rule: `R-LIMIT-${m.id.replace(/[A-Z]/g, (c) => `-${c}`).toUpperCase()}`, metric: m.id, condition: conditionName(m),
      title: `${m.label}: ${m.display}`,
      detail: `Outside the normal band (${m.normal}). Bands: ${m.bands}.`, source: m.source, ts: m.updatedAt,
    });
  }

  let overall: Level = 'nominal';
  for (const r of Object.values(regions)) {
    r.reasons.sort((a, b) => LEVEL_RANK[b.status] - LEVEL_RANK[a.status]);
    const worstMetric = r.metrics.map((id) => byId[id].status).sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0] ?? 'nominal';
    const worstReason = r.reasons[0]?.status ?? 'nominal';
    r.status = LEVEL_RANK[worstReason] >= LEVEL_RANK[worstMetric] ? worstReason : worstMetric;
    const top = r.reasons.find((x) => x.status !== 'nodata');
    r.advice = top?.metric ? byId[top.metric]?.advice || 'Review with the medical officer.'
      : top?.rule === 'R-INCIDENT-URGENT' || top?.rule === 'R-INCIDENT-OPEN' ? 'Open the incident, record observations and request the medical officer.'
      : top?.rule === 'R-SYMPTOM-REPORTED' ? 'Record how the symptom evolves and tell the medical officer if it gets worse.'
      : r.status === 'nodata' ? 'Restore the data source (sensor or log) or take a manual reading.'
      : 'Within range. Continue the routine plan.';
    if (LEVEL_RANK[r.status] > LEVEL_RANK[overall]) overall = r.status;
  }

  const alerts = Object.values(regions)
    .flatMap((r) => r.reasons.filter((x) => x.status !== 'nodata').map((x) => ({ ...x, region: r.id, regionLabel: r.label })))
    .sort((a, b) => LEVEL_RANK[b.status] - LEVEL_RANK[a.status]);
  if (d.hrStale) alerts.push({ ...regions.chest.reasons.find((x) => x.rule === 'R-SENSOR-STALE')!, region: 'chest', regionLabel: 'Chest' });

  return {
    astronautId, at: now, overall, overallLabel: LEVEL_LABEL[overall], vitals, metrics, regions, alerts,
    openIncidents: d.openIncidents.map((i) => ({ id: i.id, title: i.title, region: i.region, urgency: i.urgency, scenario: i.scenario, openedAt: i.openedAt, openedBy: i.openedBy.name })),
    activeSymptoms: d.activeSymptoms.map((s) => ({ id: s.id, label: s.label, region: s.region, note: s.note, ts: s.ts, by: s.author.name })),
    psych: (() => {
      const v = records.psych?.values;
      return v ? { mood: String(v.mood), anxiety: String(v.anxiety), crewCohesion: Number(v.crewCohesion), workloadScore: Number(v.workloadScore), missionDay: records.psych!.missionDay } : {};
    })(),
    baselines: {
      heartRateByActivity: Object.fromEntries(Object.entries(d.hrBaseline).map(([k, s]) => [k, { mean: r1(s!.mean), sd: r1(s!.sd), n: s!.n }])),
      sleepHours: d.sleepBaseline ? r1(d.sleepBaseline.mean) : undefined,
      fatigue: d.fatigueBaseline ? r1(d.fatigueBaseline.mean) : undefined,
      exerciseMinutes: d.exerciseBaseline ? Math.round(d.exerciseBaseline.mean) : undefined,
    },
    clinicalNote: CLINICAL_NOTE,
  };
}

export const LIMITS_FOR_CHARTS: Record<Signal, { label: string; unit: string; normal: [number, number]; decimals: number }> = {
  heartRate: { label: 'Heart rate', unit: 'bpm', normal: [55, 100], decimals: 0 },
  spo2: { label: 'Blood oxygen (SpO₂)', unit: '%', normal: [95, 100], decimals: 1 },
  systolic: { label: 'Systolic pressure', unit: 'mmHg', normal: [90, 129], decimals: 0 },
  diastolic: { label: 'Diastolic pressure', unit: 'mmHg', normal: [60, 84], decimals: 0 },
  bodyTemp: { label: 'Core temperature', unit: '°C', normal: [36.1, 37.5], decimals: 1 },
  respiratoryRate: { label: 'Breathing rate', unit: '/min', normal: [10, 20], decimals: 0 },
};

export { D };

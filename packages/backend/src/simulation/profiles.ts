/**
 * Simulated physiology of each crew member, calibrated on published spaceflight data.
 *
 * Each profile starts from ground (pre-flight) values and applies the in-flight effects from
 * calibration.ts: lower blood pressure (Norsk 2015), higher core temperature (Stahn 2017),
 * monthly bone loss (Lang 2004), calf muscle loss (Trappe 2009), radiation dose rate (NASA),
 * fluid shift out of the legs (Moore 1988) and ISS sleep duration (Barger 2014).
 * Individual rates stay inside the published ranges; the scenario values (`live`) are the
 * demo story and are documented as such.
 */
import type { Activity, AssessmentDomain } from '@orbital/shared/types';
import { CREW_BY_ID } from '@orbital/shared/crew';
import { BP_SHIFT, CAREER_LIMIT_MSV, DAYS_PER_MONTH, HR_SHIFT, RADIATION_PER_DAY, coreTempShift } from './calibration';

/** Mean and standard deviation */
export type MS = [number, number];

export interface Profile {
  /** Usual heart rate by activity (14-day history) */
  hr: Record<Activity, MS>;
  usual: { spo2: MS; systolic: MS; diastolicRatio: number; bodyTemp: MS; respiratoryRate: MS };
  /** Current state sent by the live simulator (the demo scenario) */
  live: { activity: Activity; heartRate: MS; spo2: MS; systolic: MS; bodyTemp: MS; respiratoryRate: MS; diastolicRatio: number };
  /** How many hours ago the change towards the current state began */
  shiftHours: number;
  sleep: { usual: MS; last3: number[]; efficiencyUsual: number; efficiencyLast: number };
  fatigue: { usual: MS; last: number };
  stress: { usual: MS; last: number };
  exercise: { usual: MS; last3: number[] };
  records: Record<AssessmentDomain, Record<string, number | string>>;
}

/** Pre-flight values and individual in-flight rates (inside the published ranges). */
interface Baseline {
  ground: { hr: Record<Activity, number>; systolic: number; diastolic: number; bodyTemp: number; spo2: number; respiratoryRate: number };
  /** % per month; Lang 2004: spine −0.9, hip −1.4 to −1.5 on average */
  boneRate: { spine: number; hip: number };
  /** % per month; Trappe 2009: soleus −2.5 on average, individual range wide */
  soleusRate: number;
  /** % per month (assumption: about half the calf rate) */
  quadRate: number;
  /** % (assumption) */
  gripChangePct: number;
  /** Moore 1988: −12.7 % on average */
  legVolumeChangePct: number;
  /** mSv per day; NASA: 0.2–0.5 */
  radiationPerDay: number;
  /** Dose from earlier missions (mSv) */
  priorCareerDoseMSv: number;
}

const BASELINES: Record<string, Baseline> = {
  voss: {
    ground: { hr: { sleep: 54, rest: 63, work: 70, exercise: 132 }, systolic: 124, diastolic: 83, bodyTemp: 36.6, spo2: 97.6, respiratoryRate: 13 },
    boneRate: { spine: -0.9, hip: -1.2 }, soleusRate: -2.0, quadRate: -1.2, gripChangePct: -3.1,
    legVolumeChangePct: -12.1, radiationPerDay: 0.3, priorCareerDoseMSv: 168,
  },
  okafor: {
    ground: { hr: { sleep: 58, rest: 68, work: 76, exercise: 138 }, systolic: 129, diastolic: 88, bodyTemp: 36.6, spo2: 97.5, respiratoryRate: 14 },
    boneRate: { spine: -0.7, hip: -1.0 }, soleusRate: -2.2, quadRate: -1.0, gripChangePct: -1.4,
    legVolumeChangePct: -11.4, radiationPerDay: 0.28, priorCareerDoseMSv: 74,
  },
  marchetti: {
    ground: { hr: { sleep: 52, rest: 62, work: 74, exercise: 130 }, systolic: 133, diastolic: 88, bodyTemp: 36.7, spo2: 97.0, respiratoryRate: 14 },
    // fewer resistive sessions this mission: rates at the high end of the published range
    boneRate: { spine: -1.3, hip: -1.7 }, soleusRate: -3.6, quadRate: -2.6, gripChangePct: -8.9,
    legVolumeChangePct: -13.4, radiationPerDay: 0.36, priorCareerDoseMSv: 357,
  },
  menon: {
    ground: { hr: { sleep: 50, rest: 59, work: 68, exercise: 126 }, systolic: 100, diastolic: 67, bodyTemp: 36.3, spo2: 98.0, respiratoryRate: 12 },
    boneRate: { spine: -0.4, hip: -0.5 }, soleusRate: -0.8, quadRate: -0.5, gripChangePct: -1.8,
    legVolumeChangePct: -17.6, radiationPerDay: 0.25, priorCareerDoseMSv: 30,
  },
};

const r = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** In-flight usual values derived from the ground baseline and the published effects. */
function inFlight(id: string) {
  const b = BASELINES[id];
  const day = CREW_BY_ID[id].mission.missionDay;
  const months = day / DAYS_PER_MONTH;
  const systolic = b.ground.systolic + BP_SHIFT.systolic;
  const diastolic = b.ground.diastolic + BP_SHIFT.diastolic;
  if (b.radiationPerDay < RADIATION_PER_DAY.min || b.radiationPerDay > RADIATION_PER_DAY.max) throw new Error(`radiation rate out of the published range for ${id}`);
  const missionDose = r(b.radiationPerDay * day);
  return {
    b, day, months,
    hr: Object.fromEntries(Object.entries(b.ground.hr).map(([a, v]) => [a, [v + HR_SHIFT, a === 'exercise' ? 8 : a === 'sleep' ? 3 : a === 'work' ? 3.5 : 2.5]])) as Record<Activity, MS>,
    systolic, diastolicRatio: diastolic / systolic,
    bodyTemp: r(b.ground.bodyTemp + coreTempShift(day)),
    bone: { lumbarBmdChangePct: r(b.boneRate.spine * months), femoralNeckBmdChangePct: r(b.boneRate.hip * months), monthlyLossPct: b.boneRate.spine },
    muscle: { quadChangePct: r(b.quadRate * months), soleusChangePct: r(b.soleusRate * months), gripChangePct: b.gripChangePct },
    radiation: { missionDoseMSv: missionDose, careerDoseMSv: r(b.priorCareerDoseMSv + missionDose), careerLimitMSv: CAREER_LIMIT_MSV },
    legVolumeChangePct: b.legVolumeChangePct,
  };
}

function build(id: string, rest: {
  live: Omit<Profile['live'], 'diastolicRatio' | 'bodyTemp'> & { bodyTempDelta?: number; diastolicRatio?: number };
  shiftHours: number;
  sleep: Profile['sleep']; fatigue: Profile['fatigue']; stress: Profile['stress']; exercise: Profile['exercise'];
  ared: number; fvcPct: number; visualShiftD: number; orthostaticStatus: string; facialPuffiness: string;
  psych: Record<string, number | string>;
}): Profile {
  const f = inFlight(id);
  const { bodyTempDelta = 0, diastolicRatio, ...live } = rest.live;
  return {
    hr: f.hr,
    usual: { spo2: [f.b.ground.spo2, 0.4], systolic: [f.systolic, 3], diastolicRatio: f.diastolicRatio, bodyTemp: [f.bodyTemp, 0.1], respiratoryRate: [f.b.ground.respiratoryRate, 0.8] },
    live: { ...live, bodyTemp: [r(f.bodyTemp + bodyTempDelta), 0.1], diastolicRatio: diastolicRatio ?? f.diastolicRatio },
    shiftHours: rest.shiftHours,
    sleep: rest.sleep, fatigue: rest.fatigue, stress: rest.stress, exercise: rest.exercise,
    records: {
      bone: f.bone,
      muscle: { ...f.muscle, aredSessionsPerWeek: rest.ared },
      fluids: { legVolumeChangePct: f.legVolumeChangePct, visualShiftD: rest.visualShiftD, orthostaticStatus: rest.orthostaticStatus, facialPuffiness: rest.facialPuffiness },
      radiation: f.radiation,
      lung: { fvcPct: rest.fvcPct },
      psych: rest.psych,
    },
  };
}

export const PROFILES: Record<string, Profile> = {
  voss: build('voss', {
    live: { activity: 'work', heartRate: [66, 2.5], spo2: [97.4, 0.4], systolic: [116, 2], respiratoryRate: [13, 0.8] },
    shiftHours: 0,
    sleep: { usual: [6.5, 0.4], last3: [6.4, 6.6, 6.3], efficiencyUsual: 86, efficiencyLast: 84 },
    fatigue: { usual: [3.5, 0.8], last: 4 }, stress: { usual: [3.6, 0.5], last: 3.8 },
    exercise: { usual: [135, 10], last3: [132, 140, 128] },
    ared: 5, fvcPct: 94, visualShiftD: 0.6, orthostaticStatus: 'normal', facialPuffiness: 'mild',
    psych: { mood: 'Steady and focused', stressScore: 3.8, anxiety: 'low', crewCohesion: 8.4, workloadScore: 6.5 },
  }),
  // Scenario: SpO₂ falling over the last 30 h, three short nights, blurred vision, headache.
  okafor: build('okafor', {
    live: { activity: 'work', heartRate: [88, 3], spo2: [91.6, 0.5], systolic: [124, 3], respiratoryRate: [17, 1] },
    shiftHours: 30,
    sleep: { usual: [7.0, 0.4], last3: [5.2, 5.0, 5.6], efficiencyUsual: 85, efficiencyLast: 71 },
    fatigue: { usual: [3.5, 0.8], last: 8 }, stress: { usual: [4.2, 0.6], last: 6.8 },
    exercise: { usual: [110, 10], last3: [104, 110, 98] },
    ared: 4, fvcPct: 84, visualShiftD: 1.1, orthostaticStatus: 'normal', facialPuffiness: 'none',
    psych: { mood: 'Tired and irritable', stressScore: 6.8, anxiety: 'moderate', crewCohesion: 7.2, workloadScore: 8.1 },
  }),
  // Scenario: heart rate at rest about 116 bpm against a usual 62, palpitations, urgent incident.
  marchetti: build('marchetti', {
    live: { activity: 'rest', heartRate: [116, 3.5], spo2: [96.6, 0.4], systolic: [132, 3], respiratoryRate: [16, 1], bodyTempDelta: 0.1 },
    shiftHours: 2.2,
    sleep: { usual: [6.2, 0.4], last3: [6.0, 5.8, 6.3], efficiencyUsual: 88, efficiencyLast: 86 },
    fatigue: { usual: [4, 0.8], last: 6 }, stress: { usual: [6.0, 0.6], last: 7.9 },
    exercise: { usual: [120, 10], last3: [96, 92, 100] },
    ared: 3, fvcPct: 88, visualShiftD: 0.4, orthostaticStatus: 'reduced', facialPuffiness: 'none',
    psych: { mood: 'Focused, under heavy workload', stressScore: 7.9, anxiety: 'moderate', crewCohesion: 8.8, workloadScore: 9.1 },
  }),
  // Scenario: low blood pressure, poor standing tolerance, lightheaded when standing.
  menon: build('menon', {
    live: { activity: 'rest', heartRate: [62, 2], spo2: [98, 0.3], systolic: [86, 2], respiratoryRate: [12, 0.6], bodyTempDelta: -0.1 },
    shiftHours: 0,
    sleep: { usual: [7.0, 0.3], last3: [7.1, 6.9, 7.2], efficiencyUsual: 90, efficiencyLast: 91 },
    fatigue: { usual: [3, 0.6], last: 3 }, stress: { usual: [3.2, 0.4], last: 3.1 },
    exercise: { usual: [150, 10], last3: [148, 155, 150] },
    ared: 6, fvcPct: 96, visualShiftD: 0.2, orthostaticStatus: 'poor', facialPuffiness: 'none',
    psych: { mood: 'Calm and reflective', stressScore: 3.1, anxiety: 'low', crewCohesion: 9.2, workloadScore: 5.4 },
  }),
};

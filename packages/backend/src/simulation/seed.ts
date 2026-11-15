/**
 * Generates the SIMULATED demo history relative to start-up time. Every generated event has `simulated: true`.
 *
 * 14 days of vital signs (one reading every 45 min, plus dense readings in the last 25 minutes),
 * 15 daily logs, 4 periodic assessments per domain, and the scenario events (symptoms, incident,
 * observations). The physiological values come from simulation/profiles.ts, which is calibrated
 * on published spaceflight studies (simulation/calibration.ts).
 *
 * Scenario (Expedition 74, day 86):
 *  - Lucas Marchetti (CDR): heart rate at rest about 116 bpm against a usual 62, palpitations and
 *    dizziness, incident marked URGENT in the scenario.
 *  - Amara Okafor (MS): SpO₂ falling towards 91.6 %, three short nights, blurred vision, headache.
 *  - Ravi Menon (CMO): low blood pressure, poor standing tolerance, lightheaded when standing.
 *  - Elena Voss (FE): usual values; used for the "sensor stops sending data" demo.
 */
import type { Activity, AssessmentDomain, RegionId, StoredEvent } from '@orbital/shared/types';
import { CREW_BY_ID } from '@orbital/shared/crew';
import { PROFILES, type MS, type Profile } from './profiles';
import { crewAuthor, sensorAuthor } from '../util/authors';
import { newId } from '../util/ids';
import { MISSION } from '@orbital/shared/config';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Activity by on-board time (the crew daily schedule). */
export function scheduledActivity(ts: number): Activity {
  const h = new Date(ts).getHours();
  if (h >= 23 || h < 7) return 'sleep';
  if (h === 7 || h === 12 || h === 21 || h === 22) return 'rest';
  if (h === 14 || h === 15) return 'exercise';
  return 'work';
}

const r = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** One vital-sign reading (heart rate, SpO₂, blood pressure, temperature, breathing). */
export function vitalsReading(p: Profile, activity: Activity, k: number, g: (m: number, sd: number) => number) {
  // k = 0 → usual values, k = 1 → current state (scenario)
  const mix = (a: MS, b: MS): MS => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const hrUsual = p.hr[activity];
  const hr = activity === p.live.activity ? mix(hrUsual, p.live.heartRate) : hrUsual;
  const sys = g(...mix(p.usual.systolic, p.live.systolic));
  const ratio = p.usual.diastolicRatio + (p.live.diastolicRatio - p.usual.diastolicRatio) * k;
  return {
    bpm: Math.round(g(...hr)),
    spo2: r(Math.min(100, g(...mix(p.usual.spo2, p.live.spo2))), 1),
    systolic: Math.round(sys),
    diastolic: Math.round(sys * ratio),
    bodyTemp: r(g(...mix(p.usual.bodyTemp, p.live.bodyTemp)), 1),
    respiratoryRate: Math.round(g(...mix(p.usual.respiratoryRate, p.live.respiratoryRate))),
  };
}

export function generateSeed(now = Date.now()) {
  const rand = rng(20261114);
  const gauss = (m: number, sd: number) => {
    const u = Math.max(rand(), 1e-9), v = rand();
    return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const missionStart = now - (MISSION.dayOfMission - 1) * D - (now % D);
  const events: StoredEvent[] = [];
  const push = (e: StoredEvent) => events.push(e);

  for (const [id, p] of Object.entries(PROFILES)) {
    const crew = CREW_BY_ID[id];
    const shiftStart = now - p.shiftHours * H;

    // --- vital signs every 45 min, 14 days ---
    for (let ts = now - 14 * D; ts <= now - 2 * MIN; ts += 45 * MIN) {
      let activity = scheduledActivity(ts);
      const k = p.shiftHours > 0 && ts > shiftStart ? Math.min(1, (ts - shiftStart) / (p.shiftHours * H * 0.7)) : 0;
      if (k > 0 && id === 'marchetti') activity = 'rest';
      push({ id: newId(), ts: Math.round(ts), astronautId: id, author: sensorAuthor(id), simulated: true,
        type: 'hr_reading', activity, ...vitalsReading(p, activity, k, gauss) });
    }
    // dense readings in the last 25 minutes, in the current activity
    for (let ts = now - 25 * MIN; ts <= now - 30_000; ts += 5 * MIN) {
      push({ id: newId(), ts, astronautId: id, author: sensorAuthor(id), simulated: true,
        type: 'hr_reading', activity: p.live.activity, ...vitalsReading(p, p.live.activity, 1, gauss) });
    }

    // --- daily log at 07:30, 15 days ---
    for (let d = 14; d >= 0; d--) {
      const day = new Date(now - d * D);
      day.setHours(7, 30, 0, 0);
      if (day.getTime() > now) continue;
      const recent = d <= 2;
      push({ id: newId(), ts: day.getTime(), astronautId: id, author: crewAuthor(id), simulated: true, type: 'daily_log',
        date: day.toISOString().slice(0, 10),
        sleepHours: r(recent ? p.sleep.last3[d] : Math.min(9, Math.max(4, gauss(...p.sleep.usual))), 1),
        sleepEfficiency: Math.round(d === 0 ? p.sleep.efficiencyLast : gauss(p.sleep.efficiencyUsual, 2)),
        fatigue: Math.round(Math.min(10, Math.max(1, d === 0 ? p.fatigue.last : gauss(...p.fatigue.usual)))),
        stress: r(Math.min(10, Math.max(0, d === 0 ? p.stress.last : recent ? (p.stress.last + p.stress.usual[0]) / 2 : gauss(...p.stress.usual))), 1),
        exerciseMinutes: Math.round(Math.max(0, recent ? p.exercise.last3[d] : gauss(...p.exercise.usual))) });
    }

    // --- periodic assessments (bone, muscle, fluids, radiation, lung, psych) ---
    const day = crew.mission.missionDay;
    const points = [Math.max(3, Math.round(day * 0.12)), Math.round(day * 0.4), Math.round(day * 0.72), day - 2];
    for (const md of points) {
      const f = md / (day - 2); // fraction of the way to the current value
      const ts = now - (day - md) * D - 3 * H;
      for (const [domain, cur] of Object.entries(p.records) as [AssessmentDomain, Record<string, number | string>][]) {
        const values: Record<string, number | string> = {};
        for (const [k, v] of Object.entries(cur)) {
          if (typeof v === 'string') values[k] = v;
          else if (k === 'aredSessionsPerWeek' || k === 'careerLimitMSv' || k === 'monthlyLossPct' || k === 'workloadScore' || k === 'crewCohesion') values[k] = v;
          else if (k === 'careerDoseMSv') values[k] = r(v - (cur.missionDoseMSv as number) * (1 - f), 1);
          else if (k === 'fvcPct') values[k] = Math.round(100 + (v - 100) * f);
          else if (k === 'legVolumeChangePct') values[k] = r(v * Math.min(1, 0.7 + 0.3 * f), 1);
          else if (k === 'stressScore') values[k] = r(p.stress.usual[0] + (v - p.stress.usual[0]) * f ** 3, 1);
          else values[k] = r(v * f, 2);
        }
        push({ id: newId(), ts, astronautId: id, author: crewAuthor('menon'), simulated: true, type: 'assessment', domain, missionDay: md, values });
      }
    }
  }

  const symptom = (ts: number, who: string, label: string, region: RegionId, note?: string, incidentId?: string) =>
    push({ id: newId(), ts, astronautId: who, author: crewAuthor(who), simulated: true, type: 'symptom', label, region, note, incidentId });
  const obs = (ts: number, about: string, by: string, text: string, region?: RegionId, incidentId?: string) =>
    push({ id: newId(), ts, astronautId: about, author: crewAuthor(by), simulated: true, type: 'observation', text, region, incidentId });

  const inc = `INC-${MISSION.dayOfMission}-01`;
  symptom(now - 48 * MIN, 'marchetti', 'Palpitations', 'chest', 'A racing heartbeat that started during the docking drill.', inc);
  symptom(now - 46 * MIN, 'marchetti', 'Light dizziness', 'head', 'When moving away from the workstation.', inc);
  push({ id: newId(), ts: now - 40 * MIN, astronautId: 'marchetti', author: crewAuthor('voss'), simulated: true, type: 'incident_opened',
    incidentId: inc, title: 'Palpitations and high resting heart rate', region: 'chest', urgency: 'urgent', scenario: true });
  obs(now - 35 * MIN, 'marchetti', 'voss', 'Lucas is alert and talking normally. He says it started suddenly about 15 minutes ago, during the docking drill.', 'chest', inc);
  obs(now - 20 * MIN, 'marchetti', 'marchetti', 'Rested for 10 minutes. The palpitations are still there.', 'chest', inc);

  symptom(now - 9 * H, 'okafor', 'Blurred vision on waking', 'head', 'Clears after about an hour.');
  symptom(now - 5 * H, 'okafor', 'Headache', 'head', 'Worse in the afternoon in the Destiny lab.');
  symptom(now - 14 * H, 'menon', 'Lightheaded when standing', 'feet', 'After sitting at the medical station for a while.');
  obs(now - 13 * H, 'menon', 'menon', 'Increased fluid intake today. Will log standing tolerance again tomorrow.', 'feet');

  events.sort((a, b) => a.ts - b.ts);
  return { events, meta: { seededAt: now, missionStart, missionName: MISSION.name } };
}

/** Normally distributed random value (live simulator). */
export function gaussian(m: number, sd: number) {
  const u = Math.max(Math.random(), 1e-9), v = Math.random();
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export { PROFILES, newId, crewAuthor, sensorAuthor };

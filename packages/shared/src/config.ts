// Thresholds and constants used by the personal-baseline rules. The band thresholds of each metric
// are in the backend health engine; see docs/DATA.md for their sources.

const H = 3_600_000;
const D = 24 * H;

export const RULES_CONFIG = {
  /** After this long without a heart-rate reading the sensor counts as silent. Demo: 20 s (on a mission, about 15 min). */
  hrStaleMs: 20_000,
  /** Window of personal history used as the reference. */
  baselineWindowMs: 14 * D,
  /** The last 24 h are left out of the reference, so a current deviation does not move its own reference. */
  baselineExcludeRecentMs: 24 * H,
  hrMinSamples: 5,
  hrSdFactor: 2,
  hrMinDeviationBpm: 10,
  dailyLogStaleMs: 36 * H,
  labStaleMs: 30 * D,
  symptomWindowMs: 72 * H,
  sleepDropHours: 1.5,
  fatigueRise: 3,
  exerciseRatio: 0.6,
};

export const MISSION = {
  name: 'Expedition 74',
  description: 'International Space Station, low Earth orbit (408 km). Crew and readings are simulated.',
  /** Expedition day (of the crew launched on 20 August); each crew member also has a personal mission day. */
  dayOfMission: 86,
};

export const ACTIVITY_LABEL: Record<string, string> = {
  sleep: 'sleep',
  rest: 'rest',
  work: 'work',
  exercise: 'exercise',
};

export const DIAGNOSIS_NOTE =
  'A deviation only asks for a check. A diagnosis comes only from an authorized clinical source (the crew medical officer or the flight surgeon).';

/** Labels of the personal-baseline rule statuses returned by `derive()`. */
export const STATUS_LABEL: Record<string, string> = {
  ok: 'Within range',
  check: 'Check',
  urgent: 'Urgent',
  nodata: 'No data',
};

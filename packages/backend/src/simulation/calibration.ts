/**
 * Published spaceflight findings used to calibrate the simulated crew data and the reference bands.
 *
 * In-flight vital signs of individual astronauts are not public, so the console simulates them.
 * The simulation is not free-form: every effect of spaceflight below comes from a published study,
 * and each simulated value is derived from these numbers (see simulation/profiles.ts).
 * Values that have no published source are listed in ASSUMPTIONS and labelled as such.
 */

export interface Evidence {
  id: string;
  /** What the study found, in one sentence */
  finding: string;
  /** Short citation shown in the interface */
  source: string;
  url: string;
}

export const EVIDENCE = {
  boneLoss: {
    id: 'boneLoss',
    finding: 'On 4–6 month ISS missions bone density fell 0.9 % per month at the spine and 1.4–1.5 % per month at the hip.',
    source: 'Lang et al., J Bone Miner Res 2004 (14 ISS crew)',
    url: 'https://pubmed.ncbi.nlm.nih.gov/15125798/',
  },
  radiationRate: {
    id: 'radiationRate',
    finding: 'On the ISS the effective dose accumulates at about 0.2–0.5 mSv per day, about 40–90 mSv per six-month mission.',
    source: 'NASA technical report 20250006168 (Simonsen)',
    url: 'https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf',
  },
  radiationLimit: {
    id: 'radiationLimit',
    finding: 'The career limit for spaceflight radiation is 600 mSv, the same for all ages and sexes.',
    source: 'NASA-STD-3001, technical brief OCHMO-TB-020',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf',
  },
  sleep: {
    id: 'sleep',
    finding: 'ISS crew slept 6.09 h per night on average although 8.5 h were scheduled; only 24 % of nights reached 7 h.',
    source: 'Barger et al., Lancet Neurology 2014 (21 ISS crew)',
    url: 'https://doi.org/10.1016/S1474-4422(14)70122-X',
  },
  bloodPressure: {
    id: 'bloodPressure',
    finding: 'After 3–6 months on the ISS, 24-hour systolic pressure was 8 mmHg lower and diastolic 9 mmHg lower than before flight; heart rate was unchanged.',
    source: 'Norsk et al., J Physiol 2015 (8 ISS crew)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4324706/',
  },
  coreTemperature: {
    id: 'coreTemperature',
    finding: 'Resting core body temperature rose by about 1.0 °C in flight, developing gradually over 2.5 months.',
    source: 'Stahn et al., Scientific Reports 2017 (11 ISS crew)',
    url: 'https://doi.org/10.1038/s41598-017-15560-w',
  },
  calfMuscle: {
    id: 'calfMuscle',
    finding: 'After 6 months on the ISS, with exercise, calf muscle volume fell 13 ± 2 % (soleus 15 ± 2 %); individual losses ranged from 1 % to over 20 %.',
    source: 'Trappe et al., J Appl Physiol 2009; Fitts et al., J Physiol 2010',
    url: 'https://pubmed.ncbi.nlm.nih.gov/19150852/',
  },
  exercise: {
    id: 'exercise',
    finding: 'ISS crew performed about 5 h of aerobic exercise per week plus resistance exercise on 3–6 days per week.',
    source: 'Trappe et al., J Appl Physiol 2009',
    url: 'https://pubmed.ncbi.nlm.nih.gov/19150852/',
  },
  legVolume: {
    id: 'legVolume',
    finding: 'Leg volume fell by 12.7 % (about 2.2 L) as fluid moved towards the head, essentially within the first day of flight.',
    source: 'Moore, Purdue University 1988 (Shuttle crew); Skylab: about 13 %',
    url: 'https://docs.lib.purdue.edu/dissertations/AAI8814566',
  },
  inspiration4Labs: {
    id: 'inspiration4Labs',
    finding: 'Blood chemistry of the four Inspiration4 crew members before and after flight (real measurements).',
    source: 'NASA OSDR, study OSD-575 (SpaceX Inspiration4, 2021)',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-575',
  },
} as const satisfies Record<string, Evidence>;

export type EvidenceId = keyof typeof EVIDENCE;

/** Simulated quantities for which no published value was used. */
export const ASSUMPTIONS = [
  'Individual scenario values (Marchetti\'s raised heart rate, Okafor\'s falling SpO₂, Menon\'s low blood pressure) are invented for the demonstration.',
  'Quadriceps and grip strength changes: no source used; set at roughly half the calf rate.',
  'Lung capacity (FVC), visual acuity shift, stress, fatigue and crew cohesion scores: illustrative values.',
  'SpO₂ and breathing rate: no in-flight change assumed (the ISS cabin is kept at sea-level pressure).',
  'Station hardware readings and fault scenarios: synthetic; part names and locations follow the real ISS.',
];

// ---------- the calibrated effects, as numbers ----------

/** Norsk 2015: in-flight change of 24-hour blood pressure (mmHg). */
export const BP_SHIFT = { systolic: -8, diastolic: -9 } as const;
/** Norsk 2015: heart rate unchanged in flight. */
export const HR_SHIFT = 0;
/** Stahn 2017: +1.0 °C at rest, reached gradually over about 75 days. */
export const coreTempShift = (missionDay: number) => 1.0 * Math.min(1, missionDay / 75);
/** Lang 2004 averages (% per month), used to check that each crew rate stays in the published range. */
export const BONE_RATE = { spine: -0.9, hip: -1.45 } as const;
/** Trappe 2009: soleus −15 % over 6 months → −2.5 % per month on average. */
export const SOLEUS_RATE = -15 / 6;
/** NASA (Simonsen): 0.2–0.5 mSv per day on the ISS. */
export const RADIATION_PER_DAY = { min: 0.2, max: 0.5 } as const;
/** NASA-STD-3001: career limit. */
export const CAREER_LIMIT_MSV = 600;
/** Moore 1988: −12.7 % leg volume. */
export const LEG_VOLUME_SHIFT = -12.7;
/** Barger 2014: ISS mean sleep (h). */
export const ISS_MEAN_SLEEP_H = 6.09;

export const DAYS_PER_MONTH = 30.44;

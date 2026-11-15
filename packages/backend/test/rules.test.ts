import { describe, expect, it } from 'vitest';
import { derive } from '@orbital/shared/rules';
import { generateSeed } from '../src/simulation/seed';
import { buildHealthReport } from '../src/health/engine';
import { recordSeries, vitalSeries } from '../src/health/series';
import { StationSimulator } from '../src/station/hardware';
import { recommendCrew } from '../src/station/repair';
import { CREW } from '@orbital/shared/crew';
import labs from '@orbital/shared/data/labs.json';
import { isHealthEvent, type HealthEvent, type LabsData } from '@orbital/shared/types';

const NOW = Date.UTC(2026, 10, 14, 10, 30);
const { events, meta } = generateSeed(NOW);
const health = events.filter(isHealthEvent) as HealthEvent[];
// The live simulator keeps readings fresh; the seed has readings up to 30 s before NOW.
const report = (id: string, now = NOW, hrStaleMs = 5 * 60_000) =>
  buildHealthReport({ astronautId: id, events, now, missionStart: meta.missionStart, labs: labs as LabsData, hrStaleMs });

describe('personal-history rules (derive)', () => {
  it('Marchetti: heart rate at rest far above his usual value at rest', () => {
    const d = derive({ astronautId: 'marchetti', events: health, now: NOW, missionStart: meta.missionStart, hrStaleMs: 5 * 60_000 });
    expect(d.hrBaseline.rest!.mean).toBeGreaterThan(55);
    expect(d.hrBaseline.rest!.mean).toBeLessThan(70);
    expect(d.hrDeviation?.deviates).toBe(true);
    expect(d.regions.chest.status).toBe('urgent');
  });
});

describe('health engine (7 regions, English)', () => {
  it('Marchetti: chest critical (urgent incident) with the heart-rate rules listed', () => {
    const r = report('marchetti');
    expect(r.regions.chest.status).toBe('critical');
    const rules = r.regions.chest.reasons.map((x) => x.rule);
    expect(rules).toEqual(expect.arrayContaining(['R-INCIDENT-URGENT', 'R-HR-PERSONAL-DEVIATION', 'R-LIMIT-HEART-RATE']));
    expect(r.metrics.find((m) => m.id === 'heartRate')!.usual!.label).toBe('usual at rest');
    expect(r.regions.head.reasons.some((x) => x.rule === 'R-SYMPTOM-REPORTED')).toBe(true);
  });
  it('Okafor: low SpO₂ is a warning; sleep and fatigue above usual are flagged', () => {
    const r = report('okafor');
    expect(r.metrics.find((m) => m.id === 'spo2')!.status).toBe('warning');
    const head = r.regions.head.reasons.map((x) => x.rule);
    expect(head).toEqual(expect.arrayContaining(['R-SLEEP-BELOW-USUAL', 'R-FATIGUE-ABOVE-USUAL']));
  });
  it('Menon: low blood pressure and poor standing tolerance', () => {
    const r = report('menon');
    expect(r.metrics.find((m) => m.id === 'bloodPressure')!.status).toBe('warning');
    expect(r.regions.feet.status).toBe('warning');
  });
  it('a stale sensor turns every sensor metric grey', () => {
    const r = report('voss', NOW + 10 * 60_000, 20_000);
    for (const id of ['heartRate', 'spo2', 'bloodPressure', 'bodyTemp', 'respiratoryRate']) expect(r.metrics.find((m) => m.id === id)!.status).toBe('nodata');
    expect(r.regions.chest.reasons[0].rule).toBe('R-SENSOR-STALE');
  });
});

describe('series and averages (server)', () => {
  it('vital-sign series are bucketed and summarised', () => {
    const s = vitalSeries(events, 'okafor', 48, NOW);
    expect(s.signals.spo2.points.length).toBeGreaterThan(10);
    expect(s.signals.spo2.summary!.min).toBeLessThan(93);
    expect(s.signals.heartRate.daily.length).toBeGreaterThanOrEqual(13);
  });
  it('record trends include assessments and real OSDR labs', () => {
    const rec = recordSeries(events, 'marchetti', NOW, meta.missionStart, labs as LabsData);
    expect(rec.assessments.bone.length).toBe(4);
    expect(rec.trends['bone.lumbarBmdChangePct'].perMonth).toBeLessThan(0);
    expect(rec.labs.items.find((l) => l.key === 'creatinine')!.outOfRange).toBe(true); // real C001 value 1.37 > 1.35
  });
});

describe('repair recommendation (server)', () => {
  it('nobody with an urgent incident or low SpO₂ is cleared for the pump spacewalk', () => {
    const reports = Object.fromEntries(CREW.map((c) => [c.id, report(c.id)]));
    const snap = new StationSimulator().snapshot();
    const rec = recommendCrew(snap.components.find((c) => c.id === 'pumpModule')!, reports)!;
    const by = Object.fromEntries(rec.ranked.map((c) => [c.crewId, c]));
    expect(by.marchetti.cleared).toBe(false);
    expect(by.okafor.cleared).toBe(false);
    expect(by.voss.cleared).toBe(true);
    expect(rec.team.find((t) => t.role === 'EV1')!.crewId).toBe('voss');
  });
});

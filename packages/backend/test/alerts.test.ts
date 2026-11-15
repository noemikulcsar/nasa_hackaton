import { describe, expect, it } from 'vitest';
import { CriticalAlerts } from '../src/alerts/critical-alerts';
import type { HealthReport } from '../src/health/engine';

const report = (critical: boolean) => ({
  alerts: critical ? [{ status: 'critical', rule: 'R-LIMIT-SPO2', title: 'Blood oxygen (SpO₂): 86.0 %', condition: 'Blood oxygen critically low', region: 'chest', metric: 'spo2' }] : [],
}) as unknown as HealthReport;

describe('critical alerts', () => {
  it('raises once, shows the recovery, and closes when acknowledged', () => {
    const a = new CriticalAlerts(20_000, 500);
    const raised = a.update({ okafor: report(true) }, 1000);
    expect(raised.map((e) => e.type)).toEqual(['critical_alert']);
    expect(a.list()[0]).toMatchObject({ name: 'Amara Okafor', condition: 'Blood oxygen critically low' });
    expect(a.update({ okafor: report(true) }, 2000)).toEqual([]); // still critical: no duplicate
    expect(a.update({ okafor: report(false) }, 3000).map((e) => e.type)).toEqual(['alert_resolved']);
    expect(a.list()).toHaveLength(1); // still shown as "back within range"
    const ack = a.acknowledge(a.list()[0].id, 'voss', 4000);
    expect(ack?.type).toBe('alert_acknowledged');
    expect(a.list()).toHaveLength(0);
  });
  it('rebuilds the open alerts from the journal after a restart', () => {
    const a = new CriticalAlerts();
    const events = a.update({ okafor: report(true) }, 1000);
    const b = new CriticalAlerts();
    b.restore(events);
    expect(b.list()).toHaveLength(1);
    expect(b.update({ okafor: report(true) }, 2000)).toEqual([]);
  });
});

describe('critical alerts in real time', () => {
  it('a recovered alert closes by itself after it has been shown', () => {
    const a = new CriticalAlerts(5_000, 2_000);
    a.update({ okafor: report(true) }, 0);
    expect(a.update({ okafor: report(false) }, 1_000)).toEqual([]); // not yet: must stay out of the band for 2 s
    expect(a.update({ okafor: report(false) }, 2_500).map((e) => e.type)).toEqual(['alert_resolved']);
    expect(a.list()[0].resolvedAt).toBe(2_500);
    a.update({ okafor: report(false) }, 8_000);
    expect(a.list()).toHaveLength(0);
  });
  it('a value hovering at the threshold does not raise a second alert', () => {
    const a = new CriticalAlerts(5_000, 2_000);
    a.update({ okafor: report(true) }, 0);
    a.update({ okafor: report(false) }, 1_000);
    expect(a.update({ okafor: report(true) }, 1_500)).toEqual([]);
    expect(a.list()).toHaveLength(1);
  });
});

describe('re-check after acknowledgement', () => {
  it('still critical 3 minutes after the acknowledgement: the alert is raised again', () => {
    const a = new CriticalAlerts(20_000, 6_000, 180_000);
    a.update({ okafor: report(true) }, 0);
    a.acknowledge(a.list()[0].id, 'voss', 10_000);
    expect(a.list()).toHaveLength(0);
    expect(a.pending()[0].recheckAt).toBe(190_000);
    expect(a.update({ okafor: report(true) }, 189_000)).toEqual([]); // not yet
    const ev = a.update({ okafor: report(true) }, 190_000);
    expect(ev.map((e) => e.type)).toEqual(['alert_repeated']);
    expect(a.list()[0]).toMatchObject({ repeats: 1, condition: 'Blood oxygen critically low' });
    // acknowledged again: another re-check 3 minutes later
    a.acknowledge(a.list()[0].id, 'menon', 200_000);
    expect(a.update({ okafor: report(true) }, 380_000).map((e) => e.type)).toEqual(['alert_repeated']);
    expect(a.list()[0].repeats).toBe(2);
  });
  it('recovered before the re-check: the alert closes and is not raised again', () => {
    const a = new CriticalAlerts(20_000, 6_000, 180_000);
    a.update({ okafor: report(true) }, 0);
    a.acknowledge(a.list()[0].id, 'voss', 10_000);
    expect(a.update({ okafor: report(false) }, 60_000).map((e) => e.type)).toEqual(['alert_resolved']);
    expect(a.update({ okafor: report(false) }, 200_000)).toEqual([]);
    expect(a.list()).toHaveLength(0);
    expect(a.pending()).toHaveLength(0);
  });
  it('the re-check survives a restart', () => {
    const a = new CriticalAlerts(20_000, 6_000, 180_000);
    const events = [...a.update({ okafor: report(true) }, 0)];
    events.push(a.acknowledge(a.list()[0].id, 'voss', 10_000)!);
    const b = new CriticalAlerts(20_000, 6_000, 180_000);
    b.restore(events, 50_000);
    expect(b.list()).toHaveLength(0);
    expect(b.update({ okafor: report(true) }, 190_000).map((e) => e.type)).toEqual(['alert_repeated']);
  });
});

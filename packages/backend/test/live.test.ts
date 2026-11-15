import { describe, expect, it } from 'vitest';
import { LivePhysiology, intensity, type Episode } from '../src/simulation/live';
import { PROFILES } from '../src/simulation/profiles';

const schedule = { enabled: true, firstDelayMs: 10_000, intervalMs: 600_000, rampMs: 20_000, holdMs: 30_000, recoverMs: 20_000 };
let seed = 1;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('live physiology', () => {
  it('episode intensity ramps up, holds and recovers smoothly', () => {
    const e: Episode = { id: 'x', astronautId: 'voss', kind: 'tachycardia', label: '', source: 'automatic', startAt: 0, rampMs: 10, holdMs: 10, recoverMs: 10 };
    expect(intensity(e, 0)).toBe(0);
    expect(intensity(e, 5)).toBeCloseTo(0.5);
    expect(intensity(e, 15)).toBe(1);
    expect(intensity(e, 25)).toBeCloseTo(0.5);
    expect(intensity(e, 31)).toBe(0);
  });
  it('a well crew member drifts into the critical band, then recovers, without any manual switch', () => {
    const live = new LivePhysiology(PROFILES, schedule, random);
    const t0 = 1_000_000;
    live.reset(t0);
    const hr: number[] = [];
    for (let t = t0; t <= t0 + 100_000; t += 2_000) hr.push(live.step(t, 2_000).voss.bpm);
    const at = (s: number) => hr[Math.round(s / 2)];
    expect(at(4)).toBeLessThan(85); // before the episode: usual values
    expect(Math.max(...hr)).toBeGreaterThan(140); // critical band reached during the plateau
    expect(at(98)).toBeLessThan(90); // recovered afterwards
    // the change is gradual, not a jump
    for (let i = 1; i < hr.length; i++) expect(Math.abs(hr[i] - hr[i - 1])).toBeLessThan(25);
  });
  it('a manual emergency lasts until it is stopped, then recovers from its current level', () => {
    const live = new LivePhysiology(PROFILES, { ...schedule, enabled: false }, random);
    const t0 = 2_000_000;
    live.reset(t0);
    live.startEmergency('okafor', 'hypoxia', t0);
    let spo2 = 100;
    for (let t = t0; t <= t0 + 12_000; t += 2_000) spo2 = live.step(t, 2_000).okafor.spo2;
    expect(spo2).toBeLessThan(90); // a manual emergency peaks within seconds
    for (let t = t0 + 14_000; t <= t0 + 120_000; t += 2_000) spo2 = live.step(t, 2_000).okafor.spo2;
    expect(spo2).toBeLessThan(90);
    expect(live.manualEmergencies()).toEqual({ okafor: 'hypoxia' });
    live.stopEmergency('okafor', t0 + 120_000);
    for (let t = t0 + 122_000; t <= t0 + 200_000; t += 2_000) spo2 = live.step(t, 2_000).okafor.spo2;
    expect(spo2).toBeGreaterThan(90);
    expect(live.manualEmergencies()).toEqual({});
  });
});

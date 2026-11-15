/**
 * Station hardware telemetry (backend). Readings drift and wobble like real telemetry and each
 * reading is graded against nominal / caution / warning bands. Limits are synthetic demo values.
 * Ported from the interface's src/lib/hardware.js.
 */
import fs from 'node:fs';
import { sharedDataFile } from '@orbital/shared/paths';

export type HwLevel = 'nominal' | 'advisory' | 'warning' | 'critical';
export const HW_RANK: Record<HwLevel, number> = { nominal: 0, advisory: 1, warning: 2, critical: 3 };
export const HW_HISTORY = 40;

export interface ReadingDef {
  id: string; label: string; unit: string; value: number; decimals: number;
  limits: { nominal: [number, number]; caution: [number, number]; warning: [number, number] };
  drift: number; noise: number; floor: number; ceiling: number;
}
export interface TaskDef { type: 'EVA' | 'IVA' | 'Robotics'; title: string; durationHours: number; load: number; skills: Record<string, number>; steps: string[] }
export interface ComponentDef {
  id: string; keywords?: string[]; name: string; short: string; system: string; node: string; location: string;
  description: string; healthNote?: string; readings: ReadingDef[]; task?: TaskDef;
}
export interface HardwareDef { meta: { vehicle: string; notice: string }; systems: { id: string; label: string }[]; components: ComponentDef[] }

export const HARDWARE: HardwareDef = JSON.parse(fs.readFileSync(sharedDataFile('hardware.json'), 'utf8'));

const inside = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;
export function readingStatus(r: ReadingDef, v: number): HwLevel {
  if (inside(v, r.limits.nominal)) return 'nominal';
  if (inside(v, r.limits.caution)) return 'advisory';
  if (inside(v, r.limits.warning)) return 'warning';
  return 'critical';
}
const fmt = (r: ReadingDef, v: number) => {
  const n = Number(v).toLocaleString('en-US', { minimumFractionDigits: r.decimals, maximumFractionDigits: r.decimals });
  return r.unit ? `${n} ${r.unit}` : n;
};
const fmtRange = (r: ReadingDef) => {
  const [lo, hi] = r.limits.nominal;
  const unit = r.unit ? ` ${r.unit}` : '';
  if (lo === hi) return `${lo}${unit}`;
  if (lo <= 0 && r.limits.caution[0] <= 0) return `≤ ${hi}${unit}`;
  return `${lo}–${hi}${unit}`;
};

export class StationSimulator {
  values: Record<string, number> = {};
  history: Record<string, number[]> = {};
  tick = 0;
  constructor(private def: HardwareDef = HARDWARE) { this.reset(); }

  reset() {
    this.values = {}; this.history = {}; this.tick = 0;
    for (const c of this.def.components) for (const r of c.readings) {
      const key = `${c.id}.${r.id}`;
      this.values[key] = r.value;
      this.history[key] = Array.from({ length: HW_HISTORY }, () => r.value + (Math.random() - 0.5) * r.noise);
    }
  }

  step() {
    for (const c of this.def.components) for (const r of c.readings) {
      const key = `${c.id}.${r.id}`;
      const next = this.values[key] + r.drift + (Math.random() - 0.5) * r.noise;
      const clamped = Math.min(r.ceiling, Math.max(r.floor, next));
      const f = 10 ** r.decimals;
      this.values[key] = Math.round(clamped * f) / f;
      this.history[key] = [...this.history[key].slice(-(HW_HISTORY - 1)), this.values[key]];
    }
    this.tick++;
  }

  /** Live picture of every component and system. */
  snapshot() {
    const bySeverity = (a: { status: HwLevel }, b: { status: HwLevel }) => HW_RANK[b.status] - HW_RANK[a.status];
    const components = this.def.components.map((c) => {
      const readings = c.readings.map((r) => {
        const key = `${c.id}.${r.id}`;
        const value = this.values[key];
        const history = this.history[key];
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        return {
          id: r.id, label: r.label, unit: r.unit, value, history, status: readingStatus(r, value),
          display: fmt(r, value), range: fmtRange(r), limits: r.limits,
          trend: history.length > 5 ? Math.sign(Math.round((history[history.length - 1] - history[0]) / (r.noise || 1))) : 0,
          mean: Math.round(mean * 10 ** r.decimals) / 10 ** r.decimals,
        };
      });
      const worst = [...readings].sort(bySeverity)[0];
      return {
        id: c.id, name: c.name, short: c.short, system: c.system, node: c.node, location: c.location, description: c.description,
        healthNote: c.healthNote, keywords: c.keywords ?? [], task: c.task ?? null, readings, status: worst?.status ?? 'nominal',
        headline: worst, systemLabel: this.def.systems.find((s) => s.id === c.system)?.label ?? c.system,
      };
    });
    const systems = this.def.systems.map((s) => {
      const list = components.filter((c) => c.system === s.id).sort(bySeverity);
      return { ...s, status: list[0]?.status ?? 'nominal', components: list.map((c) => c.id), lead: list[0]?.id ?? null };
    });
    const faults = components.filter((c) => c.status !== 'nominal').sort(bySeverity).map((c) => c.id);
    const overall = faults.length ? components.find((c) => c.id === faults[0])!.status : 'nominal';
    return { vehicle: this.def.meta.vehicle, notice: this.def.meta.notice, tick: this.tick, components, systems, faults, overall };
  }
}

export type StationSnapshot = ReturnType<StationSimulator['snapshot']>;
export type ComponentState = StationSnapshot['components'][number];

/**
 * Tools of the AI agent. Each tool reads from the event store or the protocol library and registers
 * every returned fact as a source with an identifier ([D1], [P1], [T1]…) that the agent must cite.
 * The tools are read-only.
 */
import { derive, fmtAge, fmtDateTime, fmtTime, type Derived } from '@orbital/shared/rules';
import { ACTIVITY_LABEL, STATUS_LABEL } from '@orbital/shared/config';
import { REGIONS, REGION_BY_ID } from '@orbital/shared/regions';
import { CREW, CREW_BY_ID } from '@orbital/shared/crew';
import type { AssistantSource, HealthEvent, LabsData, Protocol } from '@orbital/shared/types';
import { describeEvent, searchProtocols } from '../assistant';

export interface ToolContext {
  astronautId: string;
  incidentId?: string;
  events: HealthEvent[];
  labs: LabsData;
  protocols: Protocol[];
  missionStart: number;
  hrStaleMs: number;
  now: number;
}

export class SourceRegistry {
  sources: AssistantSource[] = [];
  private n = { D: 0, P: 0, T: 0 };
  add(prefix: 'D' | 'P' | 'T', s: Omit<AssistantSource, 'id'>): string {
    const id = `${prefix}${++this.n[prefix]}`;
    this.sources.push({ ...s, id });
    return id;
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run: (args: Record<string, unknown>, ctx: ToolContext, reg: SourceRegistry, cache: Map<string, Derived>) => unknown;
}

const astronautParam = {
  astronaut_id: {
    type: 'string',
    enum: CREW.map((c) => c.id),
    description: 'Crew member ID. If missing, the crew member selected in the console is used.',
  },
};

function getDerived(args: Record<string, unknown>, ctx: ToolContext, cache: Map<string, Derived>) {
  const id = typeof args.astronaut_id === 'string' && CREW_BY_ID[args.astronaut_id] ? args.astronaut_id : ctx.astronautId;
  if (!cache.has(id)) {
    cache.set(id, derive({ astronautId: id, events: ctx.events, now: ctx.now, missionStart: ctx.missionStart, labs: ctx.labs,
      osdrSubject: CREW_BY_ID[id].osdrSubject, hrStaleMs: ctx.hrStaleMs }));
  }
  return { id, name: CREW_BY_ID[id].name, d: cache.get(id)! };
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_crew_overview',
    description: 'The crew list with each member\'s role, overall status and main issue.',
    parameters: { type: 'object', properties: {} },
    run: (_a, ctx, reg, cache) => CREW.map((c) => {
      const { d } = getDerived({ astronaut_id: c.id }, ctx, cache);
      const top = REGIONS.flatMap((r) => d.regions[r.id].reasons).filter((x) => x.rule !== 'R-LAB-STALE')[0];
      const text = `${c.name} (${c.role}): overall status ${STATUS_LABEL[d.overall]}${top ? `; ${top.title}` : ''}.`;
      return { astronaut_id: c.id, name: c.name, role: c.role, overall: STATUS_LABEL[d.overall], main_issue: top?.title ?? null,
        source: reg.add('D', { kind: 'data', label: 'Crew overview', detail: text }) };
    }),
  },
  {
    name: 'get_region_status',
    description: 'The status of each body region (head, chest, pelvis, arms, hands, legs, feet) and the rules that set it, with explanations.',
    parameters: { type: 'object', properties: { ...astronautParam } },
    run: (a, ctx, reg, cache) => {
      const { name, d } = getDerived(a, ctx, cache);
      return {
        astronaut: name,
        regions: REGIONS.map((r) => ({
          region: r.label,
          status: STATUS_LABEL[d.regions[r.id].status],
          rules: d.regions[r.id].reasons.map((x) => ({
            rule: x.rule, title: x.title, detail: x.detail,
            source: reg.add('D', { kind: 'data', label: `Rule ${x.rule} (${r.label})`, detail: `${x.title}. ${x.detail}` }),
          })),
        })),
      };
    },
  },
  {
    name: 'get_heart_rate',
    description: 'Heart rate: the latest reading with its activity and age, the usual values per activity (14-day personal history), the deviation and the latest readings.',
    parameters: { type: 'object', properties: { ...astronautParam } },
    run: (a, ctx, reg, cache) => {
      const { name, d } = getDerived(a, ctx, cache);
      if (!d.latestHr) return { astronaut: name, available: false, source: reg.add('D', { kind: 'data', label: 'Heart-rate sensor', detail: 'There are no heart-rate readings.' }) };
      const l = d.latestHr;
      const b = d.hrBaseline[l.activity];
      const dev = d.hrDeviation;
      const summary = d.hrStale
        ? `The heart-rate sensor has stopped sending data: last reading ${l.bpm} bpm at ${fmtTime(l.ts)} (${fmtAge(d.hrAgeMs!)} ago); there is no current value.`
        : `Heart rate ${l.bpm} bpm at ${ACTIVITY_LABEL[l.activity]}, ${fmtTime(l.ts)}; usual value at the same activity ${b ? `${r1(b.mean)} ± ${r1(b.sd)} bpm (n=${b.n})` : 'unknown'}${dev && !dev.insufficient ? `; deviation ${dev.delta! > 0 ? '+' : ''}${r1(dev.delta!)} bpm (threshold ${r1(dev.threshold!)} bpm, ${dev.deviates ? 'exceeded' : 'not exceeded'})` : ''}.`;
      return {
        astronaut: name,
        simulated: l.simulated,
        latest: { bpm: l.bpm, activity: ACTIVITY_LABEL[l.activity], time: fmtTime(l.ts), age: fmtAge(d.hrAgeMs!), stale: d.hrStale, manual: !!l.manual },
        usual_by_activity: Object.fromEntries(Object.entries(d.hrBaseline).map(([k, s]) => [ACTIVITY_LABEL[k], `${r1(s!.mean)} ± ${r1(s!.sd)} bpm (n=${s!.n})`])),
        deviation: dev && !dev.insufficient ? { delta_bpm: r1(dev.delta!), threshold_bpm: r1(dev.threshold!), exceeds: dev.deviates } : null,
        recent: d.hr.slice(-8).map((r) => `${fmtTime(r.ts)} ${r.bpm} bpm (${ACTIVITY_LABEL[r.activity]})`),
        source: reg.add('D', { kind: 'data', label: l.simulated ? 'Heart-rate sensor (simulated)' : 'Heart-rate sensor', detail: summary }),
      };
    },
  },
  {
    name: 'get_daily_log',
    description: 'The daily log: hours of sleep, reported fatigue (1–10), exercise minutes, with personal means and the last 7 days.',
    parameters: { type: 'object', properties: { ...astronautParam } },
    run: (a, ctx, reg, cache) => {
      const { name, d } = getDerived(a, ctx, cache);
      const l = d.lastLog;
      if (!l) return { astronaut: name, available: false };
      const src = l.simulated ? 'Daily log (simulated)' : 'Daily log';
      return {
        astronaut: name,
        last_entry: fmtDateTime(l.ts),
        stale: d.logStale,
        sleep: { last_night_h: l.sleepHours, personal_mean_h: d.sleepBaseline ? r1(d.sleepBaseline.mean) : null,
          source: reg.add('D', { kind: 'data', label: src, detail: `Sleep last night ${l.sleepHours} h; personal mean ${d.sleepBaseline ? r1(d.sleepBaseline.mean) : '–'} h.` }) },
        fatigue: { today: l.fatigue, personal_mean: d.fatigueBaseline ? r1(d.fatigueBaseline.mean) : null,
          source: reg.add('D', { kind: 'data', label: src, detail: `Fatigue reported today ${l.fatigue}/10; personal mean ${d.fatigueBaseline ? r1(d.fatigueBaseline.mean) : '–'}/10.` }) },
        exercise: { last3_mean_min: d.exerciseRecent ? Math.round(d.exerciseRecent.mean) : null, personal_mean_min: d.exerciseBaseline ? Math.round(d.exerciseBaseline.mean) : null,
          source: reg.add('D', { kind: 'data', label: src, detail: `Exercise: mean of the last 3 days ${d.exerciseRecent ? Math.round(d.exerciseRecent.mean) : '–'} min/day; earlier personal mean ${d.exerciseBaseline ? Math.round(d.exerciseBaseline.mean) : '–'} min/day.` }) },
        last7: d.logs.slice(-7).map((x) => `${x.date}: sleep ${x.sleepHours} h, fatigue ${x.fatigue}/10, exercise ${x.exerciseMinutes} min`),
      };
    },
  },
  {
    name: 'get_symptoms_and_incidents',
    description: 'Symptoms reported in the last 72 hours and incidents (open and closed), with author and time.',
    parameters: { type: 'object', properties: { ...astronautParam } },
    run: (a, ctx, reg, cache) => {
      const { name, d } = getDerived(a, ctx, cache);
      return {
        astronaut: name,
        symptoms: d.activeSymptoms.map((s) => ({
          label: s.label, region: REGION_BY_ID[s.region].label, time: fmtDateTime(s.ts), recorded_by: s.author.name, note: s.note ?? null,
          source: reg.add('T', { kind: 'timeline', label: `Symptom, ${s.author.name}`, detail: `${s.label} (${REGION_BY_ID[s.region].label}), ${fmtDateTime(s.ts)}${s.note ? `: ${s.note}` : ''}` }),
        })),
        incidents: d.incidents.map((i) => ({
          id: i.id, title: i.title, region: REGION_BY_ID[i.region].label, urgency: i.urgency, open: !i.closedAt, scenario_demo: i.scenario,
          opened_by: i.openedBy.name, opened_at: fmtDateTime(i.openedAt),
          source: reg.add('T', { kind: 'timeline', label: `Incident ${i.id}`, detail: `${i.title}; ${i.urgency === 'urgent' ? 'URGENT' : 'standard'}; opened by ${i.openedBy.name} at ${fmtDateTime(i.openedAt)}${i.closedAt ? '; closed' : ''}.` }),
        })),
      };
    },
  },
  {
    name: 'get_timeline',
    description: 'The timeline of entries (observations, symptoms, incidents, requests to the medical officer, protocols opened), newest first.',
    parameters: { type: 'object', properties: { ...astronautParam, limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Number of entries (default 12).' } } },
    run: (a, ctx, reg, cache) => {
      const { name, d } = getDerived(a, ctx, cache);
      const limit = Math.min(30, Math.max(1, Number(a.limit) || 12));
      return {
        astronaut: name,
        entries: d.timeline.slice(0, limit).map((e) => ({
          time: fmtDateTime(e.ts), recorded_by: e.author.name, text: describeEvent(e),
          source: reg.add('T', { kind: 'timeline', label: `${fmtDateTime(e.ts)}, ${e.author.name}`, detail: describeEvent(e) }),
        })),
      };
    },
  },
  {
    name: 'get_lab_results',
    description: 'REAL blood tests from NASA OSDR (Inspiration4, OSD-575) attributed to the profile: value, unit, reference range, pre-flight and post-flight trend. Optionally filtered by name (for example "potassium", "glucose", "CRP").',
    parameters: { type: 'object', properties: { ...astronautParam, query: { type: 'string', description: 'Test name (optional).' } } },
    run: (a, ctx, reg, cache) => {
      const { name, d } = getDerived(a, ctx, cache);
      const q = typeof a.query === 'string' ? norm(a.query) : '';
      let list = d.labs.filter((l) => l.lastPre);
      if (q) list = list.filter((l) => norm(l.analyte.name).includes(q) || l.analyte.key.includes(q) || norm(l.analyte.system).includes(q));
      else list = list.filter((l) => l.lastPreOutOfRange).concat(list.filter((l) => !l.lastPreOutOfRange).slice(0, 6));
      return {
        astronaut: name,
        note: `Real NASA OSDR data, subject ${CREW_BY_ID[getDerived(a, ctx, cache).id].osdrSubject}; the latest test available on board is L-3 (pre-flight), ${d.labAgeMs ? fmtAge(d.labAgeMs) : '–'} old; it does not reflect the current state.`,
        results: list.slice(0, 12).map((l) => {
          const p = l.lastPre!;
          const text = `${l.analyte.name}: ${p.value} ${l.analyte.unit} at ${p.tp}${l.analyte.hasRange ? ` (range ${p.min ?? '–'}–${p.max ?? '–'}${l.lastPreOutOfRange ? ', outside the range' : ''})` : ''}.`;
          return {
            name: l.analyte.name, unit: l.analyte.unit, last_preflight: p.value, timepoint: p.tp,
            reference_range: l.analyte.hasRange ? `${p.min ?? '–'}–${p.max ?? '–'}` : null, out_of_range: l.lastPreOutOfRange,
            all_timepoints: l.points.map((x) => `${x.tp}: ${x.value ?? '–'}`).join(', '),
            source: reg.add('D', { kind: 'lab', label: 'Lab, NASA OSDR OSD-575 (real data)', detail: text }),
          };
        }),
      };
    },
  },
  {
    name: 'search_protocols',
    description: 'Searches the local library of approved or demo protocols. Returns ID, title, version, date, source, approval state and the relevant sections (title and ID). The full text is NOT returned: the console shows it to the user word for word.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Keywords (for example "heart rate palpitations", "sensor", "sleep").' } }, required: ['query'] },
    run: (a, ctx, reg, cache) => {
      const { d } = getDerived({}, ctx, cache);
      const hits = searchProtocols(`${String(a.query ?? '')} incident`, d, ctx.protocols, ctx.incidentId);
      if (hits.length === 0) return { results: [], message: 'No relevant protocol in the library.' };
      return {
        results: hits.map((h) => ({
          id: h.protocol.id, title: h.protocol.title, version: h.protocol.version, date: h.protocol.date, source_document: h.protocol.source,
          approved_for_mission: h.protocol.approval.approvedForMission, demo_fictiv: !h.protocol.approval.approvedForMission,
          best_section: `${h.sectionId}. ${h.heading}`,
          sections: h.protocol.sections.map((s) => `${s.id}. ${s.heading}`),
          source: reg.add('P', {
            kind: 'protocol', protocolId: h.protocol.id, sectionId: h.sectionId,
            label: `${h.protocol.id} v${h.protocol.version} (${h.protocol.date})`,
            detail: `"${h.protocol.title}", section ${h.sectionId} "${h.heading}". Source: ${h.protocol.source}${h.protocol.approval.approvedForMission ? '' : '. FICTIONAL, not approved for clinical use'}.`,
          }),
        })),
      };
    },
  },
];

export const TOOL_LABEL: Record<string, string> = {
  get_crew_overview: 'Crew overview',
  get_region_status: 'Body region status',
  get_heart_rate: 'Heart rate and personal history',
  get_daily_log: 'Daily log',
  get_symptoms_and_incidents: 'Symptoms and incidents',
  get_timeline: 'Timeline',
  get_lab_results: 'Lab tests',
  search_protocols: 'Protocol library',
};

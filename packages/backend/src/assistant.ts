/**
 * The crew assistant.
 *
 * Limits (enforced in code, not only in the prompt):
 *  - answers ONLY from the crew member's data and the loaded protocols, citing the source;
 *  - if a piece of information is missing, it says so explicitly;
 *  - never produces diagnoses, doses, medicines or medical procedures;
 *  - for protocols it gives WHERE the information is (ID, section); the console shows the exact text.
 *
 * Modes: "agent" (a local Ollama model, or a cloud model if configured) with checks on the answer,
 * otherwise "local" (deterministic engine, no network). Both use the same facts taken from the data.
 */
import { derive, fmtAge, fmtDateTime, fmtTime, type Derived } from '@orbital/shared/rules';
import { ACTIVITY_LABEL, DIAGNOSIS_NOTE, STATUS_LABEL } from '@orbital/shared/config';
import { REGIONS, REGION_BY_ID } from '@orbital/shared/regions';
import { CREW_BY_ID } from '@orbital/shared/crew';
import { resolveAiConfig } from './ai/config';
import { runAgent, type ChatTurn } from './ai/agent';
import type { AssistantResponse, AssistantSource, HealthEvent, LabsData, Protocol } from '@orbital/shared/types';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const r1 = (v: number) => Math.round(v * 10) / 10;

export const NOT_AVAILABLE_TEXT = 'This information is not available in the crew member\'s data or in the protocol library.';
/** Requests for a diagnosis or a treatment, refused before anything reaches a model. */
const FORBIDDEN_QUESTION = /diagnos|what (illness|disease|condition)|what does (he|she|they) have|\bdos(e|es|age)\b|medic(ine|ines|ation|ations)\b|\bpills?\b|tablets?\b|inject|administer|treatment|how (do|should|can) (we|i) treat|prescri|what (should|can) (he|she|they|i) take|\bdrugs?\b/;

interface Fact { id: string; kind: AssistantSource['kind']; label: string; text: string; changed: boolean; topics: string[] }

export interface AssistantContext {
  astronautId: string;
  incidentId?: string;
  events: HealthEvent[];
  labs: LabsData;
  protocols: Protocol[];
  missionStart: number;
  hrStaleMs: number;
  now: number;
}

function buildFacts(d: Derived, ctx: AssistantContext): Fact[] {
  const facts: Fact[] = [];
  let n = 0;
  const add = (f: Omit<Fact, 'id'>) => facts.push({ ...f, id: `D${++n}` });

  if (d.latestHr) {
    const dev = d.hrDeviation;
    const b = dev?.baseline;
    const base = b ? `usual value at ${ACTIVITY_LABEL[d.latestHr.activity]}: ${r1(b.mean)} ± ${r1(b.sd)} bpm (n=${b.n}, 14 days)` : 'not enough history for the same activity';
    if (d.hrStale) {
      add({ kind: 'data', label: 'Heart-rate sensor', changed: true, topics: ['heart', 'pulse', 'sensor', 'bpm'],
        text: `The heart-rate sensor has stopped sending data: last reading ${d.latestHr.bpm} bpm at ${fmtTime(d.latestHr.ts)} (${fmtAge(d.hrAgeMs!)} ago), so there is no current value.` });
    } else {
      add({ kind: 'data', label: d.latestHr.simulated ? 'Heart-rate sensor (simulated)' : 'Heart-rate sensor', changed: !!dev?.deviates, topics: ['heart', 'pulse', 'bpm', 'chest'],
        text: `Heart rate now ${d.latestHr.bpm} bpm (${ACTIVITY_LABEL[d.latestHr.activity]}, ${fmtTime(d.latestHr.ts)}); ${base}${dev?.deviates ? `; deviation ${dev.delta! > 0 ? '+' : ''}${r1(dev.delta!)} bpm, beyond the ${r1(dev.threshold!)} bpm threshold` : '; within the usual range'}.` });
    }
  } else {
    add({ kind: 'data', label: 'Heart-rate sensor', changed: false, topics: ['heart', 'pulse'], text: 'There are no heart-rate readings for this crew member.' });
  }

  if (d.lastLog) {
    const l = d.lastLog, sb = d.sleepBaseline, fb = d.fatigueBaseline;
    const src = l.simulated ? 'Daily log (simulated)' : 'Daily log';
    if (sb) add({ kind: 'data', label: src, topics: ['sleep', 'slept', 'night'], changed: l.sleepHours < sb.mean - 1.5,
      text: `Sleep last night: ${l.sleepHours} h; personal mean ${r1(sb.mean)} h (${sb.n} nights).` });
    if (fb) add({ kind: 'data', label: src, topics: ['fatigue', 'tired', 'energy'], changed: l.fatigue >= fb.mean + 3,
      text: `Fatigue reported today: ${l.fatigue}/10; personal mean ${r1(fb.mean)}/10.` });
    if (d.exerciseRecent && d.exerciseBaseline) add({ kind: 'data', label: src, topics: ['exercise', 'workout', 'training', 'muscle', 'bone'],
      changed: d.exerciseRecent.mean < d.exerciseBaseline.mean * 0.6,
      text: `Exercise: mean of the last 3 days ${Math.round(d.exerciseRecent.mean)} min/day; earlier personal mean ${Math.round(d.exerciseBaseline.mean)} min/day.` });
    if (d.logStale) add({ kind: 'data', label: src, topics: ['log', 'sleep'], changed: true, text: `The daily log has not been filled in recently (last entry ${fmtDateTime(l.ts)}).` });
  }

  for (const s of d.activeSymptoms)
    add({ kind: 'timeline', label: 'Crew report', changed: true, topics: ['symptom', norm(s.label), REGION_BY_ID[s.region].label.toLowerCase()],
      text: `Symptom reported: "${s.label}" (${REGION_BY_ID[s.region].label}) by ${s.author.name}, ${fmtDateTime(s.ts)}${s.note ? `: ${s.note.replace(/\.$/, '')}` : ''}.` });

  for (const i of d.openIncidents)
    add({ kind: 'timeline', label: 'Incident', changed: true, topics: ['incident', 'urgent'],
      text: `Open incident ${i.id}: "${i.title}", ${i.urgency === 'urgent' ? 'marked URGENT' : 'standard'}${i.scenario ? ' (demo scenario)' : ''}, opened by ${i.openedBy.name} at ${fmtDateTime(i.openedAt)}.` });

  for (const r of REGIONS) {
    const st = d.regions[r.id];
    if (st.status !== 'ok')
      add({ kind: 'data', label: 'Region status', changed: st.status !== 'nodata', topics: ['region', 'status', r.label.toLowerCase()],
        text: `${r.label}: ${STATUS_LABEL[st.status]} (${st.reasons.map((x) => `${x.rule}`).join(', ')}).` });
  }

  const out = d.labs.filter((l) => l.lastPreOutOfRange);
  for (const l of d.labs) {
    const p = l.lastPre;
    if (!p || p.value === null) continue;
    add({ kind: 'lab', label: 'Lab, NASA OSDR OSD-575 (real data, pre-flight)', changed: l.lastPreOutOfRange,
      topics: ['lab', 'test', 'blood', norm(l.analyte.name), l.analyte.key],
      text: `${l.analyte.name}: ${p.value} ${l.analyte.unit} at ${p.tp}${l.analyte.hasRange ? ` (reference range ${p.min ?? '–'}–${p.max ?? '–'})${l.lastPreOutOfRange ? ', outside the range' : ''}` : ''}${d.labStale ? `; the test is ${fmtAge(d.labAgeMs!)} old and does not reflect the current state` : ''}.` });
  }
  if (out.length === 0) add({ kind: 'lab', label: 'Lab, NASA OSDR OSD-575', changed: false, topics: ['lab', 'test', 'blood'], text: 'All pre-flight tests with a reference range are within range.' });
  return facts;
}

interface ProtoHit { protocol: Protocol; sectionId: string; heading: string; score: number }

export function searchProtocols(query: string, d: Derived | null, protocols: Protocol[], incidentId?: string): ProtoHit[] {
  const words = norm(query).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const inc = d?.openIncidents.find((i) => i.id === incidentId) ?? d?.openIncidents[0];
  const ctxTerms: string[] = [];
  const ctxRegions = new Set<string>();
  const wantsIncident = /incident|this|situation|problem|wrong/.test(norm(query));
  if (inc && wantsIncident) {
    ctxRegions.add(inc.region);
    ctxTerms.push(...norm(inc.title).split(/[^a-z0-9]+/));
    for (const s of d!.activeSymptoms) if (s.incidentId === inc.id) ctxTerms.push(...norm(s.label).split(/[^a-z0-9]+/));
    for (const reason of d!.regions[inc.region].reasons) ctxTerms.push(...norm(reason.title).split(/[^a-z0-9]+/));
  }
  // a region named in the question ("chest", "head") counts like the incident region
  for (const r of REGIONS) if (words.includes(r.id) || words.includes(r.label.toLowerCase())) ctxRegions.add(r.id);
  const STOP = new Set(['the', 'and', 'what', 'does', 'his', 'her', 'with', 'say', 'says', 'this', 'for', 'are', 'has', 'have', 'there', 'protocol']);
  const terms = [...words, ...ctxTerms].filter((w) => w.length > 2 && !STOP.has(w));
  const hits: ProtoHit[] = [];
  for (const p of protocols) {
    const kw = p.keywords.map(norm);
    let score = 0;
    for (const t of terms) if (kw.some((k) => k.includes(t) || t.includes(k))) score += 2;
    for (const t of words) if (!STOP.has(t) && norm(p.title).includes(t)) score += 2;
    // whole phrases ("chest pain") count more than single words ("pain")
    const nq = norm(query);
    for (const k of kw) if (k.includes(' ') && nq.includes(k)) score += 5;
    for (const r of p.regions) if (ctxRegions.has(r)) score += 3;
    if (score === 0) continue;
    let best = p.sections[0], bestScore = -1;
    for (const s of p.sections) {
      const txt = norm(`${s.heading} ${s.body}`);
      const sc = terms.filter((t) => txt.includes(t)).length + (/step/.test(norm(s.heading)) ? 1.5 : 0);
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    hits.push({ protocol: p, sectionId: best.id, heading: best.heading, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
}

function protoSource(h: ProtoHit, id: string): AssistantSource {
  const p = h.protocol;
  return {
    id, kind: 'protocol', protocolId: p.id, sectionId: h.sectionId,
    label: `${p.id} v${p.version} (${p.date})`,
    detail: `"${p.title}", section ${h.sectionId} "${h.heading}". Source: ${p.source}${p.approval.approvedForMission ? '' : '. FICTIONAL, not approved for clinical use'}.`,
  };
}

function localAnswer(question: string, d: Derived, ctx: AssistantContext): AssistantResponse {
  const q = norm(question);
  const name = CREW_BY_ID[d.astronautId].name;
  const facts = buildFacts(d, ctx);
  const toSource = (f: Fact): AssistantSource => ({ id: f.id, kind: f.kind, label: f.label, detail: f.text });

  if (FORBIDDEN_QUESTION.test(q)) {
    // The search starts from the question only (not from the open incident), so the protocol matches the symptom
    const hits = searchProtocols(question, null, ctx.protocols);
    const sources = hits.slice(0, 1).map((h) => protoSource(h, 'P1'));
    const proto = sources[0]
      ? ` The protocol in the library for this situation is ${hits[0].protocol.id} "${hits[0].protocol.title}" [P1].`
      : '';
    return { mode: 'local', refused: true, guard: true, sources,
      answer: `I cannot recommend medicines, doses or treatments, and I cannot make a diagnosis. These decisions belong to the crew medical officer (CMO), using the approved protocols.${proto}\n\nWhat you can do now: report the symptom on the body region and request the medical officer from the incident panel.` };
  }

  if (/protocol|procedure|where (can|do) i find|guideline|what steps|what (should|do) we do/.test(q)) {
    const hits = searchProtocols(question, d, ctx.protocols, ctx.incidentId);
    if (hits.length === 0) return { mode: 'local', answer: `No relevant protocol was found in the local library. ${NOT_AVAILABLE_TEXT}`, sources: [] };
    const sources = hits.map((h, i) => protoSource(h, `P${i + 1}`));
    const [first, ...rest] = hits;
    const asked = REGIONS.filter((r) => q.includes(r.id) || q.includes(r.label.toLowerCase())).map((r) => r.label.toLowerCase());
    const region = facts.filter((f) => f.label === 'Region status' && f.topics.some((t) => asked.includes(t)));
    return {
      mode: 'local', sources: [...sources, ...region.map(toSource)],
      answer: (region.length ? `${region.map((f) => `${f.text} [${f.id}]`).join('\n')}\n\n` : '') +
        `For ${ctx.incidentId || d.openIncidents[0] ? `incident ${ctx.incidentId ?? d.openIncidents[0].id}` : 'this situation'}, the most relevant protocol in the library is ${first.protocol.id} "${first.protocol.title}", section ${first.sectionId} "${first.heading}" [P1]. ` +
        (rest.length ? `Also relevant: ${rest.map((h, i) => `${h.protocol.id} [P${i + 2}]`).join(', ')}. ` : '') +
        `The exact text is shown below, word for word.${first.protocol.approval.approvedForMission ? '' : ' Note: this protocol is FICTIONAL (demo) and not approved for clinical use.'}`,
    };
  }

  if (/timeline|what happened|history|observation|who (has|did|recorded)|recorded|last hour/.test(q)) {
    const items = d.timeline.slice(0, 8);
    if (items.length === 0) return { mode: 'local', answer: `There are no entries in ${name}'s timeline.`, sources: [] };
    const sources: AssistantSource[] = items.map((e, i) => ({ id: `T${i + 1}`, kind: 'timeline', label: `${fmtDateTime(e.ts)}, ${e.author.name}`, detail: describeEvent(e) }));
    return { mode: 'local', sources,
      answer: `The last ${items.length} entries in ${name}'s timeline:\n` + items.map((e, i) => `• ${fmtTime(e.ts)}: ${describeEvent(e)} (${e.author.name}) [T${i + 1}]`).join('\n') };
  }

  if (/chang|usual|differ|deviat|compared|normal|evolution|trend|wrong|status/.test(q)) {
    const changed = facts.filter((f) => f.changed && f.kind !== 'lab' && f.label !== 'Region status');
    const labsOut = facts.filter((f) => f.changed && f.kind === 'lab');
    const stable = facts.filter((f) => !f.changed && f.kind === 'data' && f.label !== 'Region status');
    const used = [...changed, ...labsOut, ...stable];
    const bullet = (fs: Fact[]) => fs.map((f) => `• ${f.text} [${f.id}]`).join('\n');
    let text = changed.length
      ? `Compared with ${name}'s usual values, these have changed:\n${bullet(changed)}`
      : `No deviation from ${name}'s usual values was found in the recent data.`;
    if (stable.length) text += `\n\nUnchanged:\n${bullet(stable)}`;
    if (labsOut.length) text += `\n\nThe pre-flight lab tests (real OSDR data, old) have values outside the range:\n${bullet(labsOut)}`;
    text += `\n\n${DIAGNOSIS_NOTE}`;
    return { mode: 'local', answer: text, sources: used.map(toSource) };
  }

  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const topical = facts.filter((f) => f.topics.some((t) => words.some((w) => t.includes(w) || w.includes(t))));
  if (topical.length) {
    const sel = topical.slice(0, 6);
    return { mode: 'local', sources: sel.map(toSource), answer: sel.map((f) => `• ${f.text} [${f.id}]`).join('\n') };
  }
  return { mode: 'local', sources: [], answer: NOT_AVAILABLE_TEXT };
}

export function describeEvent(e: HealthEvent): string {
  switch (e.type) {
    case 'symptom': return `Symptom reported: ${e.label}${e.note ? `. ${e.note}` : ''}`;
    case 'observation': return `Observation: ${e.text}`;
    case 'incident_opened': return `Incident ${e.incidentId} opened: ${e.title} (${e.urgency === 'urgent' ? 'URGENT' : 'standard'})`;
    case 'incident_closed': return `Incident ${e.incidentId} closed${e.note ? `: ${e.note}` : ''}`;
    case 'cmo_requested': return `Medical officer requested: ${e.message}`;
    case 'cmo_acknowledged': return 'The medical officer took over the request';
    case 'protocol_opened': return `Protocol opened: ${e.protocolId} v${e.version}`;
    case 'hr_reading': return `${e.manual ? 'Manual heart-rate reading' : 'Heart-rate reading'} ${e.bpm} bpm (${ACTIVITY_LABEL[e.activity]})`;
    case 'daily_log': return `Daily log: sleep ${e.sleepHours} h, fatigue ${e.fatigue}/10, exercise ${e.exerciseMinutes} min`;
  }
}

export async function answerQuestion(question: string, ctx: AssistantContext, history: ChatTurn[] = []): Promise<AssistantResponse> {
  const crew = CREW_BY_ID[ctx.astronautId];
  const d = derive({ astronautId: ctx.astronautId, events: ctx.events, now: ctx.now, missionStart: ctx.missionStart,
    labs: ctx.labs, osdrSubject: crew.osdrSubject, hrStaleMs: ctx.hrStaleMs });
  const q = question.trim().slice(0, 600);
  if (!q) return { mode: 'local', answer: 'Type a question.', sources: [] };
  // Requests for a diagnosis or doses are refused before they reach a model
  if (FORBIDDEN_QUESTION.test(norm(q))) return localAnswer(q, d, ctx);
  const cfg = await resolveAiConfig();
  if (!cfg.provider) {
    const local = localAnswer(q, d, ctx);
    return { ...local, notice: `The AI agent is not available: ${cfg.reason}${cfg.hint ? ` (${cfg.hint})` : ''}. This answer comes from the local engine, using the same data. See the README, section "Offline AI agent".` };
  }
  // Deadline: if the model (especially a local one on a CPU) is late, the local engine answers
  const deadlineMs = Number(process.env.AGENT_DEADLINE_SECONDS ?? (cfg.offline ? 120 : 60)) * 1000;
  try {
    const r = await runAgent(cfg, q, history.slice(-8), ctx, deadlineMs);
    return { mode: 'agent', answer: r.answer, sources: r.sources, steps: r.steps, provider: r.provider, model: r.model };
  } catch (e) {
    const local = localAnswer(q, d, ctx);
    const msg = (e as Error).name === 'TimeoutError' || /timed out|aborted/i.test((e as Error).message)
      ? `the model ${cfg.model} did not answer within ${Math.round(deadlineMs / 1000)} s (the computer may be too slow for this model; try a smaller model or restart Ollama)`
      : (e as Error).message;
    return { ...local, notice: `AI agent (${cfg.label}, ${cfg.model}): ${msg}. The answer above comes from the local engine, using the same data.` };
  }
}

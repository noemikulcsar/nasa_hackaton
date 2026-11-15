/**
 * Validates an entry sent by the interface (POST /api/events) and turns it into a stored event.
 */
import { CREW_BY_ID } from '@orbital/shared/crew';
import { REGION_BY_ID } from '@orbital/shared/regions';
import type { HealthEvent, Protocol, RegionId, StoredEvent } from '@orbital/shared/types';
import { crewAuthor } from '../util/authors';
import { newId } from '../util/ids';

export const ALLOWED_TYPES = new Set(['observation', 'symptom', 'incident_opened', 'incident_closed', 'cmo_requested', 'cmo_acknowledged', 'protocol_opened', 'hr_reading', 'daily_log']);

const isRegion = (r: unknown): r is RegionId => typeof r === 'string' && r in REGION_BY_ID;
const str = (v: unknown, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export type Parsed = { ok: true; event: HealthEvent } | { ok: false; status: number; error: string } | { ok: true; duplicate: StoredEvent };

export function parseEventInput(b: Record<string, any>, ctx: { events: StoredEvent[]; missionStart: number; protocols: Protocol[] }): Parsed {
  const fail = (status: number, error: string): Parsed => ({ ok: false, status, error });
  if (!ALLOWED_TYPES.has(b.type)) return fail(400, 'event type not allowed');
  if (!CREW_BY_ID[b.astronautId]) return fail(400, 'unknown crew member');
  if (!CREW_BY_ID[b.authorId]) return fail(400, 'unknown author');
  if (b.region !== undefined && !isRegion(b.region)) return fail(400, 'invalid region');

  // Idempotent: the interface retries from its offline queue with the same client id.
  const id = str(b.clientId, 80) || newId();
  const existing = ctx.events.find((e) => e.id === id);
  if (existing) return { ok: true, duplicate: existing };

  const base = { id, ts: Date.now(), astronautId: b.astronautId, author: crewAuthor(b.authorId), simulated: false };
  switch (b.type) {
    case 'observation':
      if (!str(b.text)) return fail(400, 'the observation text is empty');
      return { ok: true, event: { ...base, type: 'observation', text: str(b.text, 2000), region: b.region, incidentId: str(b.incidentId, 40) || undefined } };
    case 'symptom':
      if (!str(b.label) || !isRegion(b.region)) return fail(400, 'symptom or region missing');
      return { ok: true, event: { ...base, type: 'symptom', label: str(b.label, 120), region: b.region, note: str(b.note, 1000) || undefined, incidentId: str(b.incidentId, 40) || undefined } };
    case 'incident_opened': {
      if (!str(b.title) || !isRegion(b.region)) return fail(400, 'title or region missing');
      const day = Math.floor((Date.now() - ctx.missionStart) / 86_400_000) + 1;
      const count = ctx.events.filter((x) => x.type === 'incident_opened' && x.incidentId.startsWith(`INC-${day}-`)).length;
      return { ok: true, event: { ...base, type: 'incident_opened', incidentId: `INC-${day}-${String(count + 1).padStart(2, '0')}`, title: str(b.title, 160),
        region: b.region, urgency: b.urgency === 'urgent' ? 'urgent' : 'standard', scenario: false } };
    }
    case 'incident_closed':
      return { ok: true, event: { ...base, type: 'incident_closed', incidentId: str(b.incidentId, 40), note: str(b.note) || undefined } };
    case 'cmo_requested':
      return { ok: true, event: { ...base, type: 'cmo_requested', incidentId: str(b.incidentId, 40) || undefined, message: str(b.message, 500) || 'Assessment requested' } };
    case 'cmo_acknowledged':
      if (!CREW_BY_ID[b.authorId].isMedicalOfficer) return fail(403, 'only the medical officer can take over the request');
      return { ok: true, event: { ...base, type: 'cmo_acknowledged', incidentId: str(b.incidentId, 40) || undefined, requestId: str(b.requestId, 80) } };
    case 'protocol_opened': {
      const p = ctx.protocols.find((x) => x.id === b.protocolId);
      if (!p) return fail(404, 'unknown protocol');
      return { ok: true, event: { ...base, type: 'protocol_opened', protocolId: p.id, version: p.version, incidentId: str(b.incidentId, 40) || undefined } };
    }
    case 'hr_reading': {
      const bpm = Number(b.bpm);
      if (!(bpm >= 25 && bpm <= 250)) return fail(400, 'heart rate must be between 25 and 250 bpm');
      const opt = (k: string, lo: number, hi: number) => (b[k] === undefined || b[k] === '' ? undefined : Number(b[k]) >= lo && Number(b[k]) <= hi ? Number(b[k]) : NaN);
      const extra = { spo2: opt('spo2', 50, 100), systolic: opt('systolic', 50, 250), diastolic: opt('diastolic', 30, 150), bodyTemp: opt('bodyTemp', 30, 43), respiratoryRate: opt('respiratoryRate', 4, 60) };
      if (Object.values(extra).some((v) => Number.isNaN(v))) return fail(400, 'a manual reading is outside the plausible range');
      return { ok: true, event: { ...base, type: 'hr_reading', bpm: Math.round(bpm), activity: ['sleep', 'rest', 'work', 'exercise'].includes(b.activity) ? b.activity : 'rest', manual: true,
        ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) } };
    }
    case 'daily_log':
      return { ok: true, event: { ...base, type: 'daily_log', date: new Date().toISOString().slice(0, 10), sleepHours: Number(b.sleepHours) || 0,
        fatigue: Math.min(10, Math.max(1, Number(b.fatigue) || 1)), exerciseMinutes: Math.max(0, Number(b.exerciseMinutes) || 0) } };
    default:
      return fail(400, 'unknown type');
  }
}

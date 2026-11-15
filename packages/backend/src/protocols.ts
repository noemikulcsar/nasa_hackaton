/**
 * The local protocol library (packages/backend/data/protocols/*.json).
 *
 * Safety rules applied when loading:
 *  - every protocol must have a source, a version and a date;
 *  - instructions about medicines, doses or injections are allowed ONLY in a protocol with
 *    approval.approvedForMission === true and ONLY in the `medication.approvedText` field,
 *    which is shown exactly as approved (never rephrased);
 *  - an unapproved protocol that contains such instructions is rejected and does not appear in the library.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Protocol } from '@orbital/shared/types';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/protocols');

export const MEDICATION_PATTERN =
  /\b\d+([.,]\d+)?\s?(mg|mcg|µg|g|ml|mL|IU|mmol)\b|\bdos(e|es|age|ing)\b|\binject\w*|\badminister\w*|\bpills?\b|\bcapsules?\b|\bvials?\b|\bampoules?\b|\bmilligrams?\b/i;

export function validateProtocol(p: Protocol): string | null {
  for (const f of ['id', 'title', 'version', 'date', 'source'] as const) if (!p[f]) return `the "${f}" field is missing`;
  if (!Array.isArray(p.sections) || p.sections.length === 0) return 'it has no sections';
  if (!p.approval) return 'the "approval" block is missing';
  const approved = p.approval.approvedForMission === true;
  if (p.medication && !approved) return 'it contains medicine instructions but is not approved for the mission';
  for (const s of p.sections) {
    if (MEDICATION_PATTERN.test(`${s.heading} ${s.body}`))
      return `section ${s.id} seems to contain medicine or dose instructions; these are allowed only in "medication.approvedText" of an approved protocol`;
  }
  return null;
}

export function loadProtocols() {
  const protocols: Protocol[] = [];
  const rejected: { file: string; reason: string }[] = [];
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')) as Protocol;
      const err = validateProtocol(p);
      if (err) rejected.push({ file, reason: err });
      else protocols.push(p);
    } catch (e) {
      rejected.push({ file, reason: `invalid JSON: ${(e as Error).message}` });
    }
  }
  for (const r of rejected) console.warn(`[protocols] REJECTED ${r.file}: ${r.reason}`);
  console.log(`[protocols] ${protocols.length} loaded, ${rejected.length} rejected`);
  return { protocols, rejected };
}

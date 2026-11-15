/**
 * Converts the real NASA OSDR data (SpaceX Inspiration4, OSD-575) into packages/shared/data/labs.json.
 *
 * Inputs (copied from the ZIP archives downloaded from OSDR):
 *   data/osdr/OSD-575/LSDS-8_Comprehensive_Metabolic_Panel_CMP.upload_SUBMITTED.csv
 *     long format: ANALYTE,VALUE,RANGE_MIN,RANGE_MAX,UNITS,TEST_TYPE,SUBJECT_ID,SEX,timepoint
 *   data/osdr/OSD-575/LSDS-8_Multiplex_serum_cardiovascular_EvePanel_TRANSFORMED.csv
 *     wide format: Sample Name (C001_serum_L-3), <marker>_concentration_<unit>, <marker>_percent
 *
 * Run: npm run data:labs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); // repository root
const dir = path.join(root, 'data/osdr/OSD-575');

function parseCsv(file: string): string[][] {
  const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '');
  return text.trim().split(/\r?\n/).map((l) => l.split(','));
}
const num = (s: string | undefined) => {
  if (s === undefined) return null;
  const v = Number(s.trim());
  return s.trim() === '' || Number.isNaN(v) ? null : v;
};

const TIMEPOINTS = [
  { id: 'L-92', phase: 'pre', days: -92, label: 'Pre-flight, L-92' },
  { id: 'L-44', phase: 'pre', days: -44, label: 'Pre-flight, L-44' },
  { id: 'L-3', phase: 'pre', days: -3, label: 'Pre-flight, L-3' },
  { id: 'R+1', phase: 'post', days: 1, label: 'Post-flight, R+1' },
  { id: 'R+45', phase: 'post', days: 45, label: 'Post-flight, R+45' },
  { id: 'R+82', phase: 'post', days: 82, label: 'Post-flight, R+82' },
  { id: 'R+194', phase: 'post', days: 194, label: 'Post-flight, R+194' },
];

// CMP analytes used: display name and body region (see docs/DATA.md)
const CMP: Record<string, { key: string; name: string; region: string; system: string }> = {
  GLUCOSE: { key: 'glucose', name: 'Glucose', region: 'pelvis', system: 'Metabolism' },
  'UREA NITROGEN (BUN)': { key: 'bun', name: 'Urea nitrogen (BUN)', region: 'pelvis', system: 'Kidney' },
  CREATININE: { key: 'creatinine', name: 'Creatinine', region: 'pelvis', system: 'Kidney' },
  'eGFR NON-AFR. AMERICAN': { key: 'egfr', name: 'Estimated GFR', region: 'pelvis', system: 'Kidney' },
  SODIUM: { key: 'sodium', name: 'Sodium', region: 'pelvis', system: 'Electrolytes' },
  POTASSIUM: { key: 'potassium', name: 'Potassium', region: 'pelvis', system: 'Electrolytes' },
  CHLORIDE: { key: 'chloride', name: 'Chloride', region: 'pelvis', system: 'Electrolytes' },
  'CARBON DIOXIDE': { key: 'co2', name: 'Bicarbonate (total CO₂)', region: 'pelvis', system: 'Electrolytes' },
  'PROTEIN; TOTAL': { key: 'protein', name: 'Total protein', region: 'pelvis', system: 'Liver and protein' },
  ALBUMIN: { key: 'albumin', name: 'Albumin', region: 'pelvis', system: 'Liver and protein' },
  GLOBULIN: { key: 'globulin', name: 'Globulin', region: 'pelvis', system: 'Liver and protein' },
  'BILIRUBIN; TOTAL': { key: 'bilirubin', name: 'Total bilirubin', region: 'pelvis', system: 'Liver and protein' },
  AST: { key: 'ast', name: 'AST', region: 'pelvis', system: 'Liver and protein' },
  ALT: { key: 'alt', name: 'ALT', region: 'pelvis', system: 'Liver and protein' },
  CALCIUM: { key: 'calcium', name: 'Calcium', region: 'pelvis', system: 'Bone' },
  'ALKALINE PHOSPHATASE': { key: 'alp', name: 'Alkaline phosphatase', region: 'pelvis', system: 'Bone (and liver)' },
};

const CV: Record<string, string> = {
  crp: 'C-reactive protein (CRP)',
  fibrinogen: 'Fibrinogen',
  haptoglobin: 'Haptoglobin',
  agp: 'Alpha-1 acid glycoprotein (AGP)',
  a2_macroglobulin: 'Alpha-2 macroglobulin',
  fetuin_a36: 'Fetuin-A',
  l_selectin: 'L-selectin',
  pf4: 'Platelet factor 4 (PF4)',
  sap: 'Serum amyloid P (SAP)',
};

type Point = { tp: string; value: number | null; min: number | null; max: number | null };
const analytes: Record<string, { key: string; name: string; unit: string; region: string; system: string; panel: string; hasRange: boolean }> = {};
const subjects: Record<string, { sex: string; results: Record<string, Point[]> }> = {};

// --- CMP (long format) ---
const cmp = parseCsv('LSDS-8_Comprehensive_Metabolic_Panel_CMP.upload_SUBMITTED.csv');
const h = cmp[0];
const col = (n: string) => h.indexOf(n);
for (const r of cmp.slice(1)) {
  const def = CMP[r[col('ANALYTE')]];
  if (!def) continue;
  const sid = r[col('SUBJECT_ID')];
  subjects[sid] ??= { sex: r[col('SEX')], results: {} };
  analytes[def.key] ??= { ...def, unit: r[col('UNITS')], panel: 'CMP (Quest Diagnostics)', hasRange: true };
  (subjects[sid].results[def.key] ??= []).push({
    tp: r[col('timepoint')],
    value: num(r[col('VALUE')]),
    min: num(r[col('RANGE_MIN')]),
    max: num(r[col('RANGE_MAX')]),
  });
}

// --- Eve cardiovascular panel (wide format) ---
const cv = parseCsv('LSDS-8_Multiplex_serum_cardiovascular_EvePanel_TRANSFORMED.csv');
const ch = cv[0];
for (const r of cv.slice(1)) {
  const m = r[0].match(/^(C\d+)_serum_(.+)$/);
  if (!m) continue;
  const [, sid, tp] = m;
  ch.forEach((name, i) => {
    const mm = name.match(/^(.+)_concentration_(nanogram|picogram)_per_milliliter$/);
    if (!mm || !CV[mm[1]]) return;
    const key = 'cv_' + mm[1];
    analytes[key] ??= {
      key, name: CV[mm[1]], unit: mm[2] === 'nanogram' ? 'ng/mL' : 'pg/mL',
      region: 'chest', system: 'Inflammation and clotting', panel: 'Eve cardiovascular panel HDCVD9', hasRange: false,
    };
    (subjects[sid].results[key] ??= []).push({ tp, value: num(r[i]), min: null, max: null });
  });
}

const order = TIMEPOINTS.map((t) => t.id);
for (const s of Object.values(subjects))
  for (const k of Object.keys(s.results)) s.results[k].sort((a, b) => order.indexOf(a.tp) - order.indexOf(b.tp));

const out = {
  source: {
    repository: 'NASA Open Science Data Repository (OSDR)',
    study: 'OSD-575 – SpaceX Inspiration4 Blood Serum Metabolic Panel and Immune/Cardiac Cytokine Arrays',
    mission: 'SpaceX Inspiration4 (September 2021, 3 days in low Earth orbit, 4 civilian crew)',
    files: [
      'LSDS-8_Comprehensive_Metabolic_Panel_CMP.upload_SUBMITTED.csv',
      'LSDS-8_Multiplex_serum_cardiovascular_EvePanel_TRANSFORMED.csv',
    ],
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-575',
    note: 'Real, anonymised data (C001–C004). In the console they are attributed to fictional crew profiles for the demonstration.',
  },
  timepoints: TIMEPOINTS,
  analytes: Object.values(analytes),
  subjects,
};
const target = path.join(root, 'packages/shared/data/labs.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1));
console.log(`Wrote ${path.relative(root, target)}: ${out.analytes.length} analytes, subjects ${Object.keys(subjects).join(', ')}`);

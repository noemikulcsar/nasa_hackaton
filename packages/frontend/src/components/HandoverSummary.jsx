import { useState } from 'react';
import { STATUS_LABEL, ageOn, fmtDateTime, fmtTime } from '../lib/format.js';
import { eventText } from './Timeline.jsx';

const KIND = { symptom: 'Symptom', observation: 'Observation', incident_opened: 'Incident opened', incident_closed: 'Incident closed', cmo_requested: 'Medical officer requested', cmo_acknowledged: 'Medical officer took over', protocol_opened: 'Protocol opened', hr_reading: 'Manual reading' };

/** A handover text for the medical officer or flight surgeon, assembled from the record (it works offline and invents nothing). */
export function buildSummary(crew, report, events, now = Date.now()) {
  const v = report.vitals;
  const inc = report.openIncidents[0];
  const recent = events
    .filter((e) => e.astronautId === crew.id && KIND[e.type] && now - e.ts < 24 * 3600_000 && !(e.type === 'hr_reading' && e.simulated))
    .slice(-8);
  const lines = [
    `${crew.name}, ${crew.role}, ${ageOn(crew.dateOfBirth)} years, blood type ${crew.bloodType}. Mission day ${crew.mission.missionDay}, ${crew.mission.module}.`,
    `Overall status: ${STATUS_LABEL[report.overall]}. Summary written ${fmtDateTime(now)} from the console record.`,
    '',
    inc ? `Open incident ${inc.id} (${inc.urgency}): ${inc.title}. Opened by ${inc.openedBy} at ${fmtTime(inc.openedAt)}.` : 'No open incident.',
    '',
    'Current vital signs' + (v.ts ? ` (${fmtTime(v.ts)}, ${v.activityLabel}${v.stale ? ', SENSOR SILENT' : ''}):` : ':'),
    v.ts ? `Heart rate ${Math.round(v.heartRate)} bpm, SpO₂ ${v.spo2?.toFixed(1) ?? '–'} %, blood pressure ${v.systolic ? `${Math.round(v.systolic)}/${v.diastolic}` : '–'} mmHg, temperature ${v.bodyTemp?.toFixed(1) ?? '–'} °C, breathing ${v.respiratoryRate ?? '–'} /min.` : 'No readings.',
    '',
    'Findings (rule, data):',
    ...(report.alerts.length ? report.alerts.slice(0, 8).map((a) => `- ${a.regionLabel}: ${a.title}. ${a.detail}`) : ['- None.']),
    '',
    'Last 24 hours:',
    ...(recent.length ? recent.map((e) => `- ${fmtTime(e.ts)} ${KIND[e.type]}: ${eventText(e)} (${e.author?.name ?? 'unknown'})`) : ['- Nothing recorded.']),
    '',
    'This summary lists recorded data only. It is not a diagnosis.',
  ];
  return lines.join('\n');
}

export default function HandoverSummary({ crew, report, events }) {
  const [text] = useState(() => buildSummary(crew, report, events));
  const [copied, setCopied] = useState(false);
  return (
    <div data-testid="summary">
      <p className="note" style={{ marginBottom: 10 }}>Assembled from the record at the moment it was opened, so it works without the AI and adds nothing that is not recorded.</p>
      <pre className="summary-text">{text}</pre>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>
          {copied ? 'Copied' : 'Copy the text'}
        </button>
      </div>
    </div>
  );
}

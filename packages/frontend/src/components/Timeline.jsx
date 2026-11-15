import { ACTIVITY, REGION_LABEL } from '../lib/format.js';
import { Prov } from './ui.jsx';

const KIND = {
  symptom: 'Symptom reported',
  observation: 'Observation',
  incident_opened: 'Incident opened',
  incident_closed: 'Incident closed',
  cmo_requested: 'Medical officer requested',
  cmo_acknowledged: 'Medical officer took over',
  protocol_opened: 'Protocol opened',
  hr_reading: 'Manual reading',
  repair_assigned: 'Repair team assigned',
  critical_alert: 'Critical alert',
  alert_resolved: 'Critical alert: back within range',
  alert_acknowledged: 'Critical alert acknowledged',
  alert_repeated: 'Critical alert raised again',
};
const TONE = { symptom: 'advisory', incident_opened: 'critical', incident_closed: 'nominal', cmo_requested: 'advisory', cmo_acknowledged: 'nominal', critical_alert: 'critical', alert_resolved: 'nominal', alert_acknowledged: 'nominal', alert_repeated: 'critical' };

export function eventText(e) {
  switch (e.type) {
    case 'symptom': return `${e.label} (${REGION_LABEL[e.region]?.toLowerCase() ?? e.region})${e.note ? `. ${e.note}` : ''}`;
    case 'observation': return e.text;
    case 'incident_opened': return `${e.incidentId}: ${e.title} (${e.urgency}${e.scenario ? ', marked in the demo scenario' : ''})`;
    case 'incident_closed': return `${e.incidentId}${e.note ? `. ${e.note}` : ''}`;
    case 'cmo_requested': return e.message;
    case 'cmo_acknowledged': return 'The request was taken over.';
    case 'protocol_opened': return `${e.protocolId}, version ${e.version}`;
    case 'hr_reading': return `${e.bpm} bpm at ${ACTIVITY[e.activity]}${e.spo2 ? `, SpO₂ ${e.spo2} %` : ''}${e.systolic ? `, ${e.systolic}/${e.diastolic ?? '–'} mmHg` : ''}`;
    case 'critical_alert': return e.condition;
    case 'alert_resolved': return 'The reading is back within range.';
    case 'alert_acknowledged': return 'Seen by the crew. If it is still critical at the re-check, the alert comes back.';
    case 'alert_repeated': return `Still critical ${Math.max(1, Math.round(e.afterMs / 60_000))} min after it was acknowledged.`;
    default: return '';
  }
}

export default function Timeline({ events, highlightId, empty = 'Nothing recorded yet.' }) {
  if (!events.length) return <p className="empty" data-testid="timeline">{empty}</p>;
  return (
    <ol className="timeline" data-testid="timeline">
      {events.map((e) => {
        const d = new Date(e.ts);
        return (
          <li key={e.id} className={`tl-item ${TONE[e.type] ?? ''} ${e.id === highlightId ? 'new' : ''}`} data-event-id={e.id}>
            <time className="tl-time" dateTime={d.toISOString()}>
              {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              <small>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
            </time>
            <span className="tl-dot" aria-hidden="true" />
            <div>
              <p className="tl-kind">{KIND[e.type] ?? e.type} {e.simulated && <Prov kind="sim">scenario</Prov>}</p>
              <p className="tl-text">{eventText(e)}</p>
              <p className="tl-by">Recorded by {e.author.name}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

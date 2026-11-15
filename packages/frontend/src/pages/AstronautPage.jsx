import { useEffect, useState } from 'react';
import SceneCanvas from '../scene/SceneCanvas.jsx';
import { REGION_LABEL, REGION_ORDER, STATUS_RANK, ageOn, fmtAge, fmtTime } from '../lib/format.js';
import { Avatar, Drawer, StatusDot, StatusPill } from '../components/ui.jsx';
import RegionPanel from '../components/RegionPanel.jsx';
import VitalsView from '../components/VitalsView.jsx';
import RecordView from '../components/RecordView.jsx';
import Timeline from '../components/Timeline.jsx';
import HandoverSummary from '../components/HandoverSummary.jsx';

const VITALS = [
  { key: 'heartRate', label: 'Heart rate', unit: 'bpm', metric: 'heartRate', format: (v) => Math.round(v) },
  { key: 'spo2', label: 'Blood oxygen', unit: '%', metric: 'spo2', format: (v) => v.toFixed(1) },
  { key: 'systolic', label: 'Blood pressure', unit: 'mmHg', metric: 'bloodPressure', format: (v, vit) => `${Math.round(v)}/${vit.diastolic}` },
  { key: 'bodyTemp', label: 'Temperature', unit: '°C', metric: 'bodyTemp', format: (v) => v.toFixed(1) },
  { key: 'respiratoryRate', label: 'Breathing', unit: '/min', metric: 'respiratoryRate', format: (v) => Math.round(v) },
];

const worstRegion = (report) => [...REGION_ORDER].sort((a, b) => STATUS_RANK[report.regions[b].status] - STATUS_RANK[report.regions[a].status])[0];

/** One screen per crew member: who they are (left), the body (centre), the selected region's problem, protocol and AI (right). */
export default function AstronautPage({ crew, report, region, setRegion, operatorId, events, protocols, onIncident, onProtocols }) {
  const [panel, setPanel] = useState(null); // { kind: 'vitals', signal } | { kind: 'record' } | { kind: 'history' } | { kind: 'summary' }
  useEffect(() => { if (!region) setRegion(worstRegion(report)); }, [region]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = region ?? worstRegion(report);
  const metricById = Object.fromEntries(report.metrics.map((m) => [m.id, m]));
  const inc = report.openIncidents[0];

  return (
    <div className="astro-grid">
      <aside className="astro-left" aria-label="Crew member" data-testid="profile">
        <div className="who">
          <Avatar src={crew.photo} name={crew.name} size={64} />
          <h1>{crew.name}</h1>
          <p className="muted">{crew.role}</p>
          <StatusPill status={report.overall} />
        </div>

        <dl className="facts">
          <div><dt>Age</dt><dd>{ageOn(crew.dateOfBirth)}</dd></div>
          <div><dt>Blood type</dt><dd>{crew.bloodType}</dd></div>
          <div><dt>Mission day</dt><dd>{crew.mission.missionDay} of {crew.mission.durationDays}</dd></div>
          <div><dt>Location</dt><dd>{crew.mission.module}</dd></div>
        </dl>

        {inc && (
          <button type="button" className={`incident-card ${inc.urgency === 'urgent' ? 'critical' : 'warning'}`} onClick={onIncident} data-testid="btn-incident">
            <b>{inc.urgency === 'urgent' ? 'Urgent incident' : 'Open incident'} {inc.id}</b>
            <span>{inc.title}</span>
            <small>Opened by {inc.openedBy}. Select to view.</small>
          </button>
        )}

        <div>
          <h3 className="side-title">Vital signs</h3>
          <ul className="vital-list">
            {VITALS.map((t) => {
              const m = metricById[t.metric];
              const v = report.vitals[t.key];
              return (
                <li key={t.key}>
                  <button type="button" className={`vital-row ${m.status}`} onClick={() => setPanel({ kind: 'vitals', signal: t.key })} data-testid={`vital-${t.key}`} title="Show the chart">
                    <span className="v-name">{t.label}<small>Normal {m.normal}</small></span>
                    <strong>{v == null ? '–' : t.format(v, report.vitals)}<small>{t.unit}</small></strong>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="note">
            {report.vitals.ts ? `Last reading ${fmtTime(report.vitals.ts)} (${fmtAge(report.vitals.ageMs)} ago), ${report.vitals.activityLabel}.` : 'No readings yet.'}
            {report.vitals.stale && <b className="status-text nodata"> Sensor silent.</b>} Select a value to see its chart.
          </p>
        </div>

        <div className="side-links">
          <button type="button" className="btn" onClick={() => setPanel({ kind: 'history' })} data-testid="btn-history">History</button>
          <button type="button" className="btn" onClick={() => setPanel({ kind: 'record' })} data-testid="btn-record">Medical record</button>
          <button type="button" className="btn" onClick={() => setPanel({ kind: 'summary' })} data-testid="btn-summary">Summary for the doctor</button>
          {!inc && <button type="button" className="btn" onClick={onIncident} data-testid="btn-incident">Open an incident</button>}
        </div>
      </aside>

      <section className="astro-center" aria-label="Body">
        <div className="viewer" data-testid="viewer">
          <SceneCanvas regions={report.regions} activeRegion={active} onRegionClick={setRegion} />
          <span className="viewer-hint">Click a body part. Drag to rotate.</span>
        </div>
        <div className="region-tabs" role="toolbar" aria-label="Body regions">
          {REGION_ORDER.map((id) => (
            <button key={id} type="button" className={`region-btn ${active === id ? 'active' : ''}`} aria-pressed={active === id}
              onClick={() => setRegion(id)} data-testid={`region-btn-${id}`}>
              <StatusDot status={report.regions[id].status} />{REGION_LABEL[id]}
            </button>
          ))}
        </div>
      </section>

      <RegionPanel key={`${crew.id}-${active}`} crew={crew} report={report} region={report.regions[active]} metricById={metricById}
        operatorId={operatorId} protocols={protocols} onIncident={onIncident} onProtocols={onProtocols} onHistory={() => setPanel({ kind: 'history' })} />

      {panel?.kind === 'vitals' && (
        <Drawer title="Vital signs" subtitle={crew.name} onClose={() => setPanel(null)} size="xl" testId="vitals-drawer">
          <VitalsView crew={crew} report={report} initialSignal={panel.signal} />
        </Drawer>
      )}
      {panel?.kind === 'record' && (
        <Drawer title="Medical record" subtitle={crew.name} onClose={() => setPanel(null)} size="xl" testId="record-drawer">
          <RecordView crew={crew} report={report} />
        </Drawer>
      )}
      {panel?.kind === 'history' && (
        <Drawer title="History" subtitle={`${crew.name}: observations, symptoms, incidents and interventions, with author and time`} onClose={() => setPanel(null)} testId="history-drawer">
          <Timeline events={events.filter((e) => e.astronautId === crew.id).slice().reverse()} />
        </Drawer>
      )}
      {panel?.kind === 'summary' && (
        <Drawer title="Summary for the doctor" subtitle={crew.name} onClose={() => setPanel(null)} testId="summary-drawer">
          <HandoverSummary crew={crew} report={report} events={events} />
        </Drawer>
      )}
    </div>
  );
}

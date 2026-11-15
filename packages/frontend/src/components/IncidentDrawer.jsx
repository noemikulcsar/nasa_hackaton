import { useMemo, useState } from 'react';
import { postEvent } from '../api/store.js';
import { useDraft } from '../hooks/useNow.js';
import { REGION_LABEL, REGION_ORDER, fmtAge, fmtDateTime, fmtTime } from '../lib/format.js';
import Timeline from './Timeline.jsx';
import { Drawer, Prov, StatusPill } from './ui.jsx';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Picks the library protocol whose region and keywords best match the incident (lookup only). */
function relevantProtocol(protocols, inc, symptoms) {
  const words = [inc.title, ...symptoms.map((s) => s.label)].join(' ').split(/\s+/).map(norm).filter((w) => w.length > 3);
  return protocols.filter((p) => p.regions.includes(inc.region))
    .map((p) => ({ p, score: words.filter((w) => p.keywords.some((k) => norm(k).includes(w) || w.includes(norm(k)))).length }))
    .sort((a, b) => b.score - a.score)[0]?.p;
}

export default function IncidentDrawer({ crew, operator, report, events, protocols, region, onClose, onOpenProtocol }) {
  const inc = report.openIncidents[0];
  return (
    <Drawer testId="incident-panel" tone={inc ? (inc.urgency === 'urgent' ? 'critical' : 'warning') : ''} wide
      subtitle={`Incident, ${crew.name}, ${crew.role}`} title={inc ? `${inc.id}: ${inc.title}` : 'Open an incident'} onClose={onClose}>
      {inc
        ? <OpenIncident inc={inc} crew={crew} operator={operator} report={report} events={events} protocols={protocols} onOpenProtocol={onOpenProtocol} />
        : <NewIncident crew={crew} operator={operator} region={region} />}
    </Drawer>
  );
}

function NewIncident({ crew, operator, region }) {
  const [title, setTitle] = useState('');
  const [reg, setReg] = useState(region ?? 'chest');
  const [urgency, setUrgency] = useState('standard');
  const [err, setErr] = useState('');
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      try { await postEvent({ type: 'incident_opened', astronautId: crew.id, authorId: operator.id, title, region: reg, urgency }); }
      catch (x) { setErr(x.message); }
    }}>
      <p className="muted">{crew.name} has no open incident. It will be saved to the history with {operator.name} as the author.</p>
      <label>What happened<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: headache after exercise" /></label>
      <label>Body region<select value={reg} onChange={(e) => setReg(e.target.value)}>{REGION_ORDER.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}</select></label>
      <label>Priority<select value={urgency} onChange={(e) => setUrgency(e.target.value)}><option value="standard">Standard</option><option value="urgent">Urgent</option></select></label>
      <button className="btn primary" type="submit">Open the incident</button>
      {err && <p className="err-text">{err}</p>}
    </form>
  );
}

function OpenIncident({ inc, crew, operator, report, events, protocols, onOpenProtocol }) {
  const [draft, setDraft] = useDraft(`obs.${inc.id}.${operator.id}`);
  const [saved, setSaved] = useState(null);
  const [queued, setQueued] = useState(false);
  const symptoms = report.activeSymptoms.filter((s) => s.ts >= inc.openedAt - 2 * 3_600_000);
  const proto = useMemo(() => relevantProtocol(protocols, inc, symptoms), [protocols, inc.id, symptoms.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmo = useMemo(() => {
    const reqs = events.filter((e) => e.type === 'cmo_requested' && e.incidentId === inc.id);
    const last = reqs[reqs.length - 1];
    const ack = last && events.find((e) => e.type === 'cmo_acknowledged' && e.requestId === last.id);
    return { last, ack };
  }, [events, inc.id]);
  const chronology = events.filter((e) => e.astronautId === crew.id && e.ts >= inc.openedAt - 2 * 3_600_000).slice().reverse();
  const hr = report.metrics.find((m) => m.id === 'heartRate');
  const sensorRows = [
    ['Heart rate', report.vitals.heartRate != null ? `${report.vitals.heartRate} bpm` : '–', hr.usual ? `${hr.usual.mean} ± ${hr.usual.sd} bpm (${hr.usual.label})` : '–', hr.status],
    ...['spo2', 'bloodPressure', 'bodyTemp', 'respiratoryRate'].map((id) => { const m = report.metrics.find((x) => x.id === id); return [m.label, m.display, `normal ${m.normal}`, m.status]; }),
  ];

  return (
    <div className="incident">
      <div className="row">
        <StatusPill status={inc.urgency === 'urgent' ? 'critical' : 'warning'} label={inc.urgency === 'urgent' ? 'Urgent' : 'Open'} />
        {inc.scenario && <Prov kind="sim">marked urgent in the demo scenario</Prov>}
        <span className="muted small">Region: <b>{REGION_LABEL[inc.region]}</b>. Opened by <b>{inc.openedBy}</b> at {fmtTime(inc.openedAt)}, {fmtAge(Date.now() - inc.openedAt)} ago.</span>
      </div>

      <div className="row">
        <button type="button" className="btn primary" data-testid="btn-cmo" disabled={!!cmo.last && !cmo.ack} onClick={async () => {
          const r = await postEvent({ type: 'cmo_requested', astronautId: crew.id, authorId: operator.id, incidentId: inc.id, message: `Assessment requested for ${crew.name}: ${inc.title}` });
          setQueued(!r);
        }}>Request the medical officer</button>
        <button type="button" className="btn" onClick={() => document.getElementById('obs-text')?.focus()}>Record an observation</button>
        {proto && <button type="button" className="btn" data-testid="btn-protocol" onClick={() => onOpenProtocol(proto.id, undefined, inc.id)}>Open protocol {proto.id}</button>}
      </div>
      {(cmo.last || queued) && (
        <p className={`alert ${cmo.ack ? 'nominal' : 'advisory'}`} data-testid="cmo-status">
          {cmo.last
            ? cmo.ack ? <>Request taken over by <b>{cmo.ack.author.name}</b> at {fmtTime(cmo.ack.ts)}.</>
              : <>Requested by <b>{cmo.last.author.name}</b> at {fmtTime(cmo.last.ts)}. Waiting for the medical officer to take over.</>
            : 'Saved on this device; it will be sent when the server answers.'}
        </p>
      )}

      <section>
        <h3>Reported symptoms</h3>
        {symptoms.length === 0 && <p className="empty">No symptoms recorded.</p>}
        {symptoms.map((s) => <p key={s.id} className="symptom"><b>{s.label}</b> ({REGION_LABEL[s.region].toLowerCase()}). {s.note} <small className="muted">{fmtTime(s.ts)}, recorded by {s.by}</small></p>)}
      </section>

      <section>
        <h3>Recent measurements {report.vitals.simulated && <Prov kind="sim">simulated</Prov>}</h3>
        {report.vitals.stale && <p className="alert nodata">The vital-sign sensor stopped sending data ({fmtAge(report.vitals.ageMs ?? 0)} ago). The values below are not current.</p>}
        <table className="table compact" data-testid="recent-readings">
          <thead><tr><th>Reading</th><th>Now</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>{sensorRows.map(([label, now, ref, st]) => <tr key={label} className={st}><td>{label}</td><td><b>{now}</b></td><td className="muted">{ref}</td><td><StatusPill status={st} /></td></tr>)}</tbody>
        </table>
        <p className="muted small">Last sensor reading {report.vitals.ts ? `${fmtTime(report.vitals.ts)} at ${report.vitals.activityLabel}` : '–'}. Recorded by the vital-sign sensor.</p>
      </section>

      <section id="obs-form">
        <h3>Record an observation</h3>
        <form className="stack" data-testid="obs-form" onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          try {
            const r = await postEvent({ type: 'observation', astronautId: crew.id, authorId: operator.id, text: draft, incidentId: inc.id, region: inc.region });
            setSaved({ id: r?.id, ok: true, msg: r ? `Saved at ${fmtTime(r.ts)} and added to the timeline.` : 'Saved on this device; it will be sent when the server answers.' });
            setDraft('');
          } catch (x) { setSaved({ ok: false, msg: x.message }); }
        }}>
          <textarea id="obs-text" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`What did you observe? Author: ${operator.name}`} aria-label="Observation text" />
          <div className="row">
            <button className="btn primary" type="submit" disabled={!draft.trim()}>Save observation</button>
            {draft && <small className="muted">Draft kept on this device until you save it.</small>}
          </div>
          {saved && <p className={saved.ok ? 'ok-text' : 'err-text'} data-testid="obs-saved">{saved.msg}</p>}
        </form>
      </section>

      <section>
        <h3>Timeline</h3>
        <Timeline events={chronology} highlightId={saved?.id} />
      </section>

      {operator.isMedicalOfficer && (
        <button type="button" className="btn danger" onClick={() => void postEvent({ type: 'incident_closed', astronautId: crew.id, authorId: operator.id, incidentId: inc.id, note: 'Closed by the medical officer' })}>
          Close the incident
        </button>
      )}
    </div>
  );
}

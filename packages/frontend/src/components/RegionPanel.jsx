import { Fragment, useEffect, useRef, useState } from 'react';
import { askAssistant, useStore } from '../api/store.js';
import { REGION_LABEL, fmtDateTime } from '../lib/format.js';
import { StatusDot, StatusPill } from './ui.jsx';
import ProtocolText, { protocolsForRegion } from './ProtocolText.jsx';
import { ManualReading, ReportSymptom } from './ReportForms.jsx';

// Suggested questions, adapted to the selected body region.
const promptsFor = (label) => [
  `What is wrong with the ${label.toLowerCase()} and what does the protocol say?`,
  'What has changed compared with the usual values?',
  'What was recorded in the last hour?',
];

let counter = 0;
const nextId = () => `m-${++counter}`;
function withCitations(text) {
  return text.split(/(\[[DPT]\d+\])/g).map((p, i) => {
    const m = p.match(/^\[([DPT]\d+)\]$/);
    return m ? <cite key={i}>{m[1]}</cite> : <Fragment key={i}>{p}</Fragment>;
  });
}

/** Protocols the answer actually cites ([P1] in the text); if none is cited inline, the first protocol source. */
function citedProtocols(res, byId) {
  const list = (res?.sources ?? []).filter((x) => x.protocolId && byId[x.protocolId]);
  const cited = list.filter((x) => res.answer.includes(`[${x.id}]`));
  const pick = cited.length ? cited : list.slice(0, 1);
  return [...new Set(pick.map((x) => `${x.protocolId}|${x.sectionId ?? ''}`))];
}

/** Everything about one body region in one place: the problem, the protocol, the AI and the report forms. */
export default function RegionPanel({ crew, report, region, metricById, operatorId, protocols, onIncident, onProtocols, onHistory }) {
  const metrics = region.metrics.map((id) => metricById[id]);
  const symptoms = report.activeSymptoms.filter((s) => s.region === region.id);
  const matches = region.status === 'nominal' && symptoms.length === 0 ? [] : protocolsForRegion(protocols, region);
  const [main, ...others] = matches;

  return (
    <section className="astro-right" aria-label={region.title} data-testid="region-panel" data-region={region.id}>
      <header className="rp-head">
        <div>
          <h2>{region.title}</h2>
          <p className="muted small">{region.description}</p>
        </div>
        <StatusPill status={region.status} />
      </header>

      <div className="rp-block">
        <h3>What is wrong</h3>
        {region.reasons.length === 0
          ? <p className="muted">Nothing. Readings are recent and within range.</p>
          : (
            <ul className="problems">
              {region.reasons.map((r, i) => (
                <li key={i} className={r.status} data-rule={r.rule}>
                  <StatusDot status={r.status} />
                  <div>
                    <b>{r.title}</b>
                    <p>{r.detail}</p>
                    <small>Rule {r.rule}. {r.source}{r.ts ? `, ${fmtDateTime(r.ts)}` : ''}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        {symptoms.length > 0 && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Reported: {symptoms.map((s) => `${s.label} (${fmtDateTime(s.ts)}, ${s.by})`).join('; ')}.
          </p>
        )}
        <details className="readings-box">
          <summary>Readings in this region ({metrics.length})</summary>
          <ul className="readings" data-testid="region-metrics">
            {metrics.map((m) => (
              <li key={m.id} className={m.status} data-metric={m.id}>
                <StatusDot status={m.status} />
                <span className="r-text">{m.label}<small>Normal {m.normal}{m.usual ? `. ${m.usual.label[0].toUpperCase()}${m.usual.label.slice(1)}: ${m.usual.mean} ± ${m.usual.sd}` : ''}</small>{m.reference && <small className="ref" title={m.reference.finding}>Reference: <a href={m.reference.url} target="_blank" rel="noreferrer">{m.reference.source}</a></small>}</span>
                <strong>{m.display}</strong>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="rp-block">
        <h3>What the protocol says</h3>
        {main ? (
          <>
            <ProtocolText protocol={main} />
            {others.length > 0 && (
              <details className="readings-box">
                <summary>Other protocols for this region ({others.length})</summary>
                {others.map((p) => <ProtocolText key={p.id} protocol={p} />)}
              </details>
            )}
          </>
        ) : <p className="muted">No protocol is needed for this region right now.</p>}
        <button type="button" className="link small" onClick={onProtocols}>Browse all protocols</button>
      </div>

      <InlineAssistant crew={crew} report={report} region={region} protocols={protocols} onHistory={onHistory} />

      <div className="rp-block">
        <h3>Report</h3>
        <div className="row">
          <button type="button" className={`btn ${report.openIncidents[0] ? '' : 'danger'}`} onClick={onIncident}>
            {report.openIncidents[0] ? `Incident ${report.openIncidents[0].id}: add an observation` : 'Open an incident'}
          </button>
        </div>
        <ReportSymptom crew={crew} region={region} operatorId={operatorId} />
        {region.id === 'chest' && <ManualReading crew={crew} operatorId={operatorId} open={report.vitals.stale} />}
        <p className="note" style={{ marginTop: 12 }}>{report.clinicalNote}</p>
      </div>
    </section>
  );
}

function InlineAssistant({ crew, report, region, protocols, onHistory }) {
  const demo = useStore((s) => s.demo);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);
  useEffect(() => { const el = endRef.current?.parentElement; if (el) el.scrollTop = el.scrollHeight; }, [messages, busy]);
  const byId = Object.fromEntries(protocols.map((p) => [p.id, p]));
  const incidentId = report.openIncidents[0]?.id;

  const send = async (raw) => {
    const text = raw.trim();
    if (!text || busy) return;
    setBusy(true);
    const history = messages.filter((m) => m.role === 'user' || m.answered).slice(-8).map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    const r = await askAssistant(crew.id, text, incidentId, history);
    setMessages((prev) => [...prev, r.ok
      ? { id: nextId(), role: 'assistant', answered: true, text: r.data.answer, res: r.data }
      : { id: nextId(), role: 'assistant', error: true, text: r.unavailable ? `The AI is unavailable (${r.error}). The protocol above and the history still work.` : r.error }]);
    setBusy(false);
  };

  const ai = demo?.ai;
  const engine = !demo?.aiAvailable ? 'Unavailable' : ai?.configured ? `${ai.offline ? 'Offline AI' : 'Cloud AI'}, ${ai.model}` : 'Local rules engine';

  return (
    <div className="rp-block ask" data-testid="assistant">
      <div className="row">
        <h3>Ask the AI about {crew.name.split(' ')[0]}</h3>
        <span className="spacer" />
        <span className="engine" data-testid="ai-mode"><StatusDot status={demo?.aiAvailable ? (ai?.configured ? 'nominal' : 'advisory') : 'critical'} />{engine}</span>
      </div>
      <p className="note">Answers from this record and the protocol library, with sources. It does not diagnose or give doses.</p>

      {!demo?.aiAvailable && (
        <p className="alert warning" data-testid="ai-fallback">
          <span className="alert-text"><b>The AI is unavailable.</b> The protocol text above is stored on board and still works. </span>
          <button type="button" className="link" onClick={onHistory}>Open the history</button>
        </p>
      )}

      {messages.length > 0 && (
        <div className="chat" role="log" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role} ${m.error ? 'error' : ''}`} data-testid={m.res ? 'assistant-answer' : undefined}>
              {m.res && <p className="msg-meta">{m.res.guard ? 'Safety filter' : m.res.mode === 'agent' ? `AI agent, ${m.res.model}` : 'Local rules engine'}{m.res.refused ? ', request declined' : ''}</p>}
              <div>{withCitations(m.text)}</div>
              {m.res?.notice && <p className="msg-notice">{m.res.notice}</p>}
              {(() => {
                const [top, ...rest] = citedProtocols(m.res, byId).map((k) => k.split('|'));
                if (!top) return null;
                return (
                  <div className="answer-protocol">
                    <p className="msg-meta">Exact text from the protocol it cites:</p>
                    <ProtocolText protocol={byId[top[0]]} highlight={top[1]} compact />
                    {rest.length > 0 && (
                      <details className="readings-box">
                        <summary>Also relevant: {rest.map(([pid]) => pid).join(', ')}</summary>
                        {rest.map(([pid, sid]) => <ProtocolText key={pid} protocol={byId[pid]} highlight={sid} compact />)}
                      </details>
                    )}
                  </div>
                );
              })()}
              {m.res?.sources?.length > 0 && (
                <details className="sources">
                  <summary>Sources ({m.res.sources.length})</summary>
                  <ol>{m.res.sources.map((s) => <li key={s.id}><code>{s.id}</code> <b>{s.label}</b>. {s.detail}</li>)}</ol>
                </details>
              )}
            </div>
          ))}
          {busy && <div className="msg assistant typing" aria-label="The AI is working"><span /><span /><span /></div>}
          <span ref={endRef} />
        </div>
      )}

      <div className="row chips">
        {promptsFor(REGION_LABEL[region.id]).map((p) => <button key={p} type="button" className="chip" disabled={busy} onClick={() => send(p)}>{p}</button>)}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(draft); setDraft(''); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about this crew member" aria-label="Message the medical assistant" />
        <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>Ask</button>
      </form>
    </div>
  );
}

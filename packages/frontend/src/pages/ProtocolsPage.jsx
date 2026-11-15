import { useEffect, useState } from 'react';

/**
 * Local protocol library. Text is shown exactly as provided, never rewritten.
 * Available even when the AI assistant is not (the protocols are loaded with the page).
 */
export default function ProtocolsPage({ protocols, rejected, selected, onSelect }) {
  const [id, setId] = useState(selected?.id ?? protocols[0]?.id);
  useEffect(() => { if (selected?.id) setId(selected.id); }, [selected?.id]);
  const p = protocols.find((x) => x.id === id);
  useEffect(() => { if (selected?.section) document.getElementById(`sec-${selected.section}`)?.scrollIntoView({ block: 'center' }); }, [id, selected?.section]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Protocol library</h1>
          <p>{protocols.length} protocols stored on board. Available even when the AI assistant is not.</p>
        </div>
      </header>
      <div className="two-col">
        <nav className="card" aria-label="Protocols">
          <ul className="proto-list">
            {protocols.map((x) => (
              <li key={x.id}>
                <button type="button" className={`proto-row ${x.id === id ? 'active' : ''}`} aria-current={x.id === id} onClick={() => { setId(x.id); onSelect(x.id); }}>
                  {x.title}
                  <small>{x.id}, version {x.version}, {x.approval.approvedForMission ? 'approved' : 'fictional, not approved'}</small>
                </button>
              </li>
            ))}
          </ul>
          {rejected.length > 0 && (
            <div className="card-body"><b>Rejected when loading ({rejected.length})</b>{rejected.map((r) => <p key={r.file} className="note">{r.file}: {r.reason}</p>)}</div>
          )}
          <div className="card-body"><p className="note">Instructions about medicines, doses or injections are accepted only from a protocol approved for the mission and are shown exactly as approved.</p></div>
        </nav>

        {p && (
          <article className="card" data-testid="protocol-view" data-protocol-id={p.id}>
            <div className="card-body doc">
              {!p.approval.approvedForMission && (
                <p className="alert warning"><span className="alert-text"><b>Fictional protocol, not approved for clinical use.</b> {p.approval.note}</span></p>
              )}
              <h1>{p.title}</h1>
              <dl className="facts">
                <div><dt>Code</dt><dd>{p.id}</dd></div>
                <div><dt>Version</dt><dd>{p.version}</dd></div>
                <div><dt>Date</dt><dd>{p.date}</dd></div>
                <div><dt>Source</dt><dd>{p.source}</dd></div>
                <div><dt>Approval</dt><dd>{p.approval.approvedForMission ? `Approved by ${p.approval.approvedBy} on ${p.approval.approvalDate}` : 'Not approved for the mission'}</dd></div>
              </dl>
              <p className="muted" style={{ marginBottom: 12 }}>{p.summary}</p>
              {p.sections.map((s) => (
                <section key={s.id} id={`sec-${s.id}`} className={`doc-sec ${selected?.section === s.id && selected?.id === p.id ? 'hl' : ''}`}>
                  <h3>{s.id}. {s.heading}</h3>
                  <div className="verbatim">{s.body}</div>
                </section>
              ))}
              <section className="doc-sec">
                <h3>Medicines, doses, injections</h3>
                {p.medication && p.approval.approvedForMission
                  ? <pre className="verbatim">{p.medication.approvedText}</pre>
                  : <p className="muted">This protocol contains no instructions about medicines. Such instructions are shown only from a real protocol approved for the mission, exactly as approved. The console and the assistant never generate them.</p>}
              </section>
            </div>
          </article>
        )}
      </div>
    </>
  );
}

import { STATUS_LABEL, STATUS_RANK } from '../lib/format.js';
import { Avatar, StatusDot, StatusPill } from './ui.jsx';
// All values below (statuses, rankings, fitness, verdicts) are computed by the server.

export function SystemsSummary({ systems, components, onSelect }) {
  const byId = Object.fromEntries(components.map((c) => [c.id, c]));
  return (
    <section className="card systems" aria-label="Systems">
      {systems.map((s) => {
        const lead = s.lead ? byId[s.lead] : null;
        return (
          <button key={s.id} type="button" className="system" onClick={() => lead && onSelect(lead.id)} aria-label={`${s.label}: ${STATUS_LABEL[s.status]}`}>
            <span>{s.label}</span>
            <strong className={`status-text ${s.status}`}>{STATUS_LABEL[s.status]}</strong>
            <small>{lead ? `${lead.short}: ${lead.headline.label.toLowerCase()} ${lead.headline.display}` : 'No monitored parts'}</small>
          </button>
        );
      })}
    </section>
  );
}

export function FaultList({ components, selectedId, assignments, onSelect }) {
  const sorted = [...components].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);
  return (
    <nav className="card" aria-label="Monitored hardware">
      <header className="card-head"><h2>Monitored parts</h2></header>
      <ul className="hw-list">
        {sorted.map((c) => {
          const active = c.id === selectedId;
          return (
            <li key={c.id}>
              <button type="button" className={`hw-row ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => onSelect(c.id)}>
                <StatusDot status={c.status} />
                <span className="hw-name">{c.short}<small>{c.systemLabel}</small></span>
                <span className={`small status-text ${c.status}`}>{assignments[c.id] ? 'Assigned' : STATUS_LABEL[c.status]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const TREND = { 1: '↑', '-1': '↓', 0: '' };

function CandidateRow({ candidate: ranked, team, onViewCrew }) {
  // Inside-support crew are scored for the inside job, not for going outside.
  const candidate = team?.role === 'IV' ? { ...ranked, ...team, cleared: true } : ranked;
  const { crewId, name, role, photo, fitness, verdictLabel, tone } = candidate;
  const reasons = candidate.cleared ? [...candidate.pros.slice(0, 1), ...candidate.cons.slice(0, 1)] : candidate.cons.slice(0, 2);
  return (
    <li className={team ? 'on-team' : ''}>
      <Avatar src={photo} name={name} size={36} />
      <div className="c-id">
        <b>{name}</b>
        <small>{team ? team.roleLabel : role}</small>
        <p>{reasons.join(' ')}</p>
      </div>
      <StatusPill status={tone} label={verdictLabel} />
      <div className="fit" aria-label={`Fitness ${fitness} percent`}>
        {fitness}%
        <span className="fit-bar" aria-hidden="true"><i style={{ width: `${fitness}%` }} /></span>
      </div>
      <button type="button" className="link" onClick={() => onViewCrew(crewId)}>Health</button>
    </li>
  );
}

export function RepairPanel({ component, recommendation, assignment, onAssign, onViewCrew, assignError }) {
  if (!component) {
    return <div className="card-body"><p className="empty">Select a part in the list or on the station model.</p></div>;
  }
  const needsRepair = recommendation && component.status !== 'nominal';
  const { task, ranked = [], team = [], note, precautions = [] } = recommendation ?? {};
  const roleOf = Object.fromEntries(team.map((t) => [t.crewId, t]));
  const canAssign = team.some((t) => t.role !== 'IV');

  return (
    <>
      <header className="card-head">
        <div>
          <div className="row"><h2>{component.name}</h2><StatusPill status={component.status} /></div>
          <p>{component.systemLabel}, {component.location}</p>
        </div>
      </header>
      <div className="card-body">
        <ul className="readings">
          {component.readings.map((r) => (
            <li key={r.id} className={r.status}>
              <StatusDot status={r.status} />
              <span className="r-text">{r.label}<small>Normal {r.range}</small></span>
              <strong>{r.display}{r.status !== 'nominal' && TREND[r.trend] ? ` ${TREND[r.trend]}` : ''}</strong>
            </li>
          ))}
        </ul>
        <p className="muted small" style={{ marginTop: 10 }}>{component.description}</p>
        {component.healthNote && component.status !== 'nominal' && <p className="next-step" style={{ marginTop: 10 }}>Crew health: {component.healthNote}</p>}
        {component.task && (
          <details className="form-box">
            <summary>Repair procedure ({component.task.steps.length} steps)</summary>
            <ol style={{ padding: '10px 14px 12px 32px', listStyle: 'decimal' }}>{component.task.steps.map((st) => <li key={st}>{st}</li>)}</ol>
          </details>
        )}

        {needsRepair ? (
          <>
            <div className="row" style={{ marginTop: 22 }}>
              <div>
                <h3>Who should repair it</h3>
                <p className="note">{task.title}. {task.typeLabel}, about {task.durationHours} h. Ranked by live health and training.</p>
              </div>
              <span className="spacer" />
              {assignment ? (
                <span className="badge nominal" data-testid="assigned">Assigned: {assignment.team.map((t) => `${t.role} ${t.name.split(' ')[0]}`).join(', ')}</span>
              ) : (
                <button type="button" className="btn primary" data-testid="assign-team" disabled={!canAssign} title={canAssign ? '' : 'Nobody is cleared for the main role'} onClick={() => onAssign(component)}>
                  Assign {team.map((t) => `${t.role} ${t.name.split(' ')[0]}`).join(', ') || 'team'}
                </button>
              )}
            </div>
            {note && <p className="alert warning" style={{ marginTop: 12 }}><span className="alert-text">{note}</span></p>}
            {assignError && <p className="err-text">{assignError}</p>}
            <ul className="candidates" style={{ marginTop: 8 }}>
              {ranked.map((c) => <CandidateRow key={c.crewId} candidate={c} team={roleOf[c.crewId]} onViewCrew={onViewCrew} />)}
            </ul>
            {precautions.length > 0 && <p className="note" style={{ marginTop: 10 }}><b>Precautions:</b> {precautions.join(' ')}</p>}
          </>
        ) : (
          <p className="empty" style={{ marginTop: 16 }}>{component.task ? 'Working normally. A repair team recommendation appears here if a reading leaves its normal range.' : 'Working normally. This part is monitored only.'}</p>
        )}
      </div>
    </>
  );
}

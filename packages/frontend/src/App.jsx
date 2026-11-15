import { useEffect, useRef, useState } from 'react';
import { connectStream, loadBootstrap, postEvent, useStore } from './api/store.js';
import { useNow } from './hooks/useNow.js';
import { STATUS_LABEL, STATUS_RANK, fmtTime } from './lib/format.js';
import AstronautPage from './pages/AstronautPage.jsx';
import StationPage from './pages/StationPage.jsx';
import ProtocolsPage from './pages/ProtocolsPage.jsx';
import IncidentDrawer from './components/IncidentDrawer.jsx';
import DemoModal from './components/DemoModal.jsx';
import DataSources from './components/DataSources.jsx';
import CriticalAlerts, { RecheckChip, VoiceToggle } from './components/CriticalAlerts.jsx';
import { Avatar, Drawer, StatusDot } from './components/ui.jsx';

export default function App() {
  const boot = useStore((s) => s.boot);
  const error = useStore((s) => s.error);
  useEffect(() => { void loadBootstrap(); connectStream(); }, []);
  if (!boot) return <div className="splash"><div className="loading-chip">{error ?? 'Loading crew data…'}</div></div>;
  return <Console />;
}

function Console() {
  const boot = useStore((s) => s.boot);
  const snapshot = useStore((s) => s.snapshot);
  const events = useStore((s) => s.events);
  const [page, setPage] = useState('astronaut');
  // Start on the crew member who needs attention most.
  const [crewId, setCrewId] = useState(() => [...boot.crew].sort((a, b) => STATUS_RANK[snapshot.health[b.id].overall] - STATUS_RANK[snapshot.health[a.id].overall])[0].id);
  const [operatorId, setOperatorId] = useState('voss');
  const [region, setRegion] = useState(null);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [voiceOn, setVoiceOnState] = useState(() => { try { return localStorage.getItem('voiceAlerts') !== 'off'; } catch { return true; } });
  const setVoiceOn = (on) => { setVoiceOnState(on); try { localStorage.setItem('voiceAlerts', on ? 'on' : 'off'); } catch { /* storage unavailable */ } };
  const alerts = snapshot.alerts ?? [];
  const [protocol, setProtocol] = useState(null);
  const [notices, setNotices] = useState([]);

  const crew = boot.crew.find((c) => c.id === crewId);
  const operator = boot.crew.find((c) => c.id === operatorId);
  const report = snapshot.health[crewId];
  const station = snapshot.station;

  const go = (next) => { setPage(next); setIncidentOpen(false); window.scrollTo(0, 0); };
  const openAstronaut = (id, nextRegion = null) => { setCrewId(id); setRegion(nextRegion); go('astronaut'); };
  const openProtocol = (id, section) => { setProtocol({ id, section }); go('protocols'); };

  // Station escalations appear as notices (status changes detected from the server snapshots).
  const seen = useRef(null);
  const sig = station.components.map((c) => `${c.id}:${c.status}`).join('|');
  useEffect(() => {
    const prev = seen.current;
    seen.current = Object.fromEntries(station.components.map((c) => [c.id, c.status]));
    if (!prev) return;
    for (const c of station.components) {
      if (STATUS_RANK[c.status] > STATUS_RANK[prev[c.id] ?? 'nominal'] && STATUS_RANK[c.status] >= STATUS_RANK.warning) {
        const id = `${c.id}-${Date.now()}`;
        setNotices((n) => [...n.slice(-1), { id, tone: c.status, text: `${c.name}: ${c.headline.label.toLowerCase()} ${c.headline.display} (normal ${c.headline.range}).`, title: `Station ${STATUS_LABEL[c.status].toLowerCase()}` }]);
        setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 15_000);
      }
    }
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <TopNav page={page} crewId={crewId} roster={boot.crew} snapshot={snapshot} go={go} onCrew={(id) => openAstronaut(id)}
        operator={operator} setOperatorId={setOperatorId} onDemo={() => setDemoOpen(true)} onSources={() => setSourcesOpen(true)}
        alerts={alerts} voiceOn={voiceOn} setVoiceOn={setVoiceOn} />

      <CriticalAlerts alerts={alerts} crew={boot.crew} snapshot={snapshot} operatorId={operatorId} voiceOn={voiceOn}
        onOpen={(id, region) => openAstronaut(id, region)} />

      <main className="main">
        <CmoBanner events={events} crew={boot.crew} operator={operator} onGo={(id) => { openAstronaut(id); setIncidentOpen(true); }} />
        {page === 'astronaut' && (
          <AstronautPage
            key={crew.id} crew={crew} report={report} region={region} setRegion={setRegion} operatorId={operatorId}
            events={events} protocols={boot.protocols} onIncident={() => setIncidentOpen(true)}
            onProtocols={() => openProtocol(null)}
          />
        )}
        {page === 'station' && <StationPage snapshot={snapshot} operatorId={operatorId} onViewCrew={(id) => openAstronaut(id)} />}
        {page === 'protocols' && <ProtocolsPage protocols={boot.protocols} rejected={boot.rejectedProtocols} selected={protocol} onSelect={(id) => setProtocol({ id })} />}
      </main>

      {notices.length > 0 && (
        <div className="toasts" aria-live="polite">
          {notices.map((n) => (
            <div key={n.id} className={`toast ${n.tone}`}>
              <p><b>{n.title}.</b> {n.text}</p>
              <button type="button" className="link" onClick={() => { go('station'); setNotices([]); }}>View</button>
              <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotices((x) => x.filter((y) => y.id !== n.id))}>×</button>
            </div>
          ))}
        </div>
      )}

      {incidentOpen && page === 'astronaut' && (
        <IncidentDrawer crew={crew} operator={operator} report={report} events={events} protocols={boot.protocols} region={region}
          onClose={() => setIncidentOpen(false)} onOpenProtocol={(id, s) => {
            const inc = report.openIncidents[0];
            if (inc && id) void postEvent({ type: 'protocol_opened', astronautId: crew.id, authorId: operatorId, protocolId: id, incidentId: inc.id });
            openProtocol(id, s);
          }} />
      )}
      {sourcesOpen && (
        <Drawer title="Data sources" subtitle="What is real, what is simulated and on what it is based" onClose={() => setSourcesOpen(false)} testId="sources-drawer">
          <DataSources />
        </Drawer>
      )}
      {demoOpen && <DemoModal crew={boot.crew} hrStaleMs={boot.config.hrStaleMs} onClose={() => setDemoOpen(false)} />}
    </div>
  );
}

function TopNav({ page, crewId, roster, snapshot, go, onCrew, operator, setOperatorId, onDemo, onSources, alerts, voiceOn, setVoiceOn }) {
  const now = useNow(1000);
  const connection = useStore((s) => s.connection);
  const outbox = useStore((s) => s.outbox);
  const station = snapshot.station;
  return (
    <header className="topnav">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>
        </span>
        <span><b>Orbital Health</b><small>Expedition 74, ISS</small></span>
      </div>

      <nav className="navtabs" aria-label="Main">
        {roster.map((c) => (
          <button key={c.id} type="button" className={`navtab ${page === 'astronaut' && crewId === c.id ? 'active' : ''} ${alerts.some((a) => a.astronautId === c.id && !a.resolvedAt) ? 'alarm' : ''}`} onClick={() => onCrew(c.id)} data-testid={`crew-${c.id}`}>
            <Avatar src={c.photo} name={c.name} size={26} />
            <span>{c.name.split(' ')[0]}</span>
            <StatusDot status={snapshot.health[c.id].overall} />
          </button>
        ))}
        <span className="nav-sep" aria-hidden="true" />
        <button type="button" className={`navtab ${page === 'station' ? 'active' : ''}`} onClick={() => go('station')} data-testid="nav-station">
          <span>Station</span>
          <StatusDot status={station.overall} />
        </button>
      </nav>

      <div className="topnav-right">
        <span className={`conn ${connection === 'live' ? '' : 'offline'}`} data-testid="connection" title={`${new Date(now).toISOString().slice(11, 16)} UTC`}>
          <StatusDot status={connection === 'live' ? 'nominal' : 'critical'} />
          {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Offline'}{outbox.length ? ` (${outbox.length} to send)` : ''}
        </span>
        <select className="operator" value={operator.id} onChange={(e) => setOperatorId(e.target.value)} data-testid="operator" aria-label="Signed in as">
          {roster.map((c) => <option key={c.id} value={c.id}>Signed in: {c.name}</option>)}
        </select>
        <RecheckChip pending={snapshot.alertRechecks} />
        <VoiceToggle on={voiceOn} setOn={setVoiceOn} />
        <button type="button" className="link small" onClick={onSources} data-testid="btn-sources">Data sources</button>
        <button type="button" className="btn sm" onClick={onDemo} data-testid="btn-demo">Simulation</button>
      </div>
    </header>
  );
}

function CmoBanner({ events, crew, operator, onGo }) {
  const pending = events.filter((e) => e.type === 'cmo_requested' && !events.some((a) => a.type === 'cmo_acknowledged' && a.requestId === e.id));
  if (pending.length === 0) return null;
  const last = pending[pending.length - 1];
  const who = crew.find((c) => c.id === last.astronautId);
  return (
    <div className="alert advisory" role="alert" data-testid="cmo-banner">
      <span className="alert-text"><b>Medical officer requested</b> for {who.name} by {last.author.name} at {fmtTime(last.ts)}.</span>
      <button type="button" className="btn sm" onClick={() => onGo(who.id)}>Open the incident</button>
      {operator.isMedicalOfficer && (
        <button type="button" className="btn sm primary" onClick={() => void postEvent({ type: 'cmo_acknowledged', astronautId: who.id, authorId: operator.id, requestId: last.id, incidentId: last.incidentId })}>Take over</button>
      )}
    </div>
  );
}

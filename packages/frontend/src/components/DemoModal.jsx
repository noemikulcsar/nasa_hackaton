import { demoAction, useStore } from '../api/store.js';
import { Modal } from './ui.jsx';

export default function DemoModal({ crew, hrStaleMs, onClose }) {
  const demo = useStore((s) => s.demo);
  const live = useStore((s) => s.snapshot?.live);
  return (
    <Modal title="Simulation controls" onClose={onClose}>
      <p className="muted small">These controls reproduce situations for the jury. They are not part of the crew workflow.</p>
      <h3>Vital-sign sensors</h3>
      <p className="muted small">A stopped sensor sends no readings. After {Math.round(hrStaleMs / 1000)} s the sensor readings turn grey (No data).</p>
      {crew.map((c) => (
        <label key={c.id} className="switch-row">
          <input type="checkbox" checked={!!demo?.sensorsOnline[c.id]} data-testid={`sensor-${c.id}`}
            onChange={(e) => { const online = e.target.checked; void demoAction('sensor', { astronautId: c.id, online }, (d) => ({ ...d, sensorsOnline: { ...d.sensorsOnline, [c.id]: online } })); }} />
          {c.name}<span className="muted small">{demo?.sensorsOnline[c.id] ? 'sending' : 'stopped'}</span>
        </label>
      ))}
      <h3>Automatic events</h3>
      <p className="muted small">The crew's physiology changes by itself: one crew member at a time drifts into a critical state, stays there for about a minute and a half, then recovers. The first event comes one minute after start-up or reset.</p>
      <label className="switch-row">
        <input type="checkbox" checked={!!live?.automatic} data-testid="episodes-toggle"
          onChange={(e) => void fetch('/api/demo/episodes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: e.target.checked }) })} />
        Automatic events
        <span className="muted small">{live?.next ? `next: ${crew.find((c) => c.id === live.next.astronautId)?.name}, in ${live.next.inSeconds} s` : 'off'}</span>
      </label>
      {live?.active?.map((e) => (
        <p key={e.astronautId + e.kind} className="small muted">{crew.find((c) => c.id === e.astronautId)?.name}: {e.label.toLowerCase()} ({e.phase}, {e.source})</p>
      ))}
      <h3>Emergency</h3>
      <p className="muted small">Starts the same kind of event now, for as long as you want. Stop lets the crew member recover gradually.</p>
      {[['okafor', 'hypoxia', 'Amara Okafor: blood oxygen falls to about 86 %'], ['voss', 'tachycardia', 'Elena Voss: heart rate rises to about 150 bpm'], ['menon', 'hypotension', 'Ravi Menon: blood pressure falls to about 74 mmHg']].map(([id, kind, label]) => {
        const on = demo?.emergencies?.[id] === kind;
        return (
          <div key={id} className="switch-row">
            <span>{label}</span>
            <button type="button" className={`btn sm ${on ? '' : 'danger'}`} data-testid={`emergency-${id}`}
              onClick={() => void demoAction('emergency', { astronautId: id, kind: on ? null : kind })}>{on ? 'Stop' : 'Start'}</button>
          </div>
        );
      })}
      <h3>AI assistant</h3>
      <label className="switch-row">
        <input type="checkbox" checked={!!demo?.aiAvailable} data-testid="ai-toggle"
          onChange={(e) => { const available = e.target.checked; void demoAction('ai', { available }, (d) => ({ ...d, aiAvailable: available })); }} />
        Assistant available<span className="muted small">{demo?.ai?.configured ? `${demo.ai.provider}, ${demo.ai.model}` : 'local engine'}</span>
      </label>
      <h3>Scenario</h3>
      <button type="button" className="btn danger" onClick={() => { if (confirm('Reset the demo scenario? The local history is replaced.')) void demoAction('reset', {}); }}>Reset the demo scenario</button>
    </Modal>
  );
}

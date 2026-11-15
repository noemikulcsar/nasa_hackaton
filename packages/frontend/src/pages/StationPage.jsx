import { useState } from 'react';
import StationCanvas from '../scene/StationCanvas.jsx';
import { FaultList, RepairPanel, SystemsSummary } from '../components/StationHud.jsx';
import { assignRepair } from '../api/store.js';
import { StatusPill } from '../components/ui.jsx';

/** Station systems: live hardware readings, faults and the health-aware repair crew ranking, all computed on the server. */
export default function StationPage({ snapshot, operatorId, onViewCrew }) {
  const station = snapshot.station;
  const [componentId, setComponentId] = useState(station.faults[0] ?? null);
  const [assignError, setAssignError] = useState(null);
  const component = station.components.find((c) => c.id === componentId) ?? null;
  const recommendation = component ? snapshot.recommendations[component.id] ?? null : null;
  const faults = station.components.filter((c) => c.status !== 'nominal').length;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="row"><h1>Station systems</h1><StatusPill status={station.overall} /></div>
          <p>{faults} of {station.components.length} monitored parts need attention. Select a part to see its readings and who should repair it.</p>
        </div>
      </header>

      <SystemsSummary systems={station.systems} components={station.components} onSelect={setComponentId} />

      <div className="station-grid">
        <div>
          <FaultList components={station.components} selectedId={componentId} assignments={station.assignments} onSelect={setComponentId} />
          <p className="note" style={{ marginTop: 10 }}>{station.notice} ISS model by NASA (NASA 3D Resources); use does not imply NASA endorsement.</p>
        </div>
        <section className="card" aria-label="Selected part">
          <div className="station-view">
            <StationCanvas station={station} selectedId={componentId} assignments={station.assignments} onSelect={setComponentId} />
          </div>
          <RepairPanel
            component={component}
            recommendation={recommendation}
            assignment={component ? station.assignments[component.id] : null}
            assignError={assignError}
            onAssign={async (c) => {
              setAssignError(null);
              try { await assignRepair(c.id, operatorId); } catch (e) { setAssignError(e.message); }
            }}
            onViewCrew={onViewCrew}
          />
        </section>
      </div>
    </>
  );
}

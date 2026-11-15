import { useEffect, useState } from 'react';
import { getJson } from '../api/store.js';
import { formatDate, fmtDateTime } from '../lib/format.js';
import { LineChart, Sparkline } from './ui.jsx';

// Risk modules from the original interface. Each opens a trend chart computed on the server.
const MODULES = [
  { id: 'bone', title: 'Bone density', metric: 'lumbarBmd', hint: 'Lumbar loss per month', series: [['bone', 'lumbarBmdChangePct', 'Lumbar spine density change', '%'], ['bone', 'femoralNeckBmdChangePct', 'Femoral neck density change', '%']] },
  { id: 'radiation', title: 'Radiation', metric: 'radiation', hint: 'Career dose used', series: [['radiation', 'missionDoseMSv', 'Mission dose', 'mSv'], ['radiation', 'careerDoseMSv', 'Career dose', 'mSv']] },
  { id: 'muscle', title: 'Muscle', metric: 'quad', hint: 'Quadriceps size', series: [['muscle', 'quadChangePct', 'Quadriceps size change', '%'], ['muscle', 'soleusChangePct', 'Calf (soleus) size change', '%'], ['muscle', 'gripChangePct', 'Grip strength change', '%']] },
  { id: 'sleep', title: 'Sleep', metric: 'sleepHours', hint: 'Last night', daily: [['sleepHours', 'Sleep per night', 'h'], ['sleepEfficiency', 'Sleep efficiency', '%']] },
  { id: 'fluids', title: 'Fluid shifts', metric: 'legVolume', hint: 'Lower-leg volume', series: [['fluids', 'legVolumeChangePct', 'Lower-leg fluid volume change', '%'], ['fluids', 'visualShiftD', 'Visual acuity shift', 'D'], ['lung', 'fvcPct', 'Lung capacity (FVC)', '% predicted']] },
  { id: 'mental', title: 'Mental state', metric: 'stress', hint: 'Stress score out of 10', daily: [['stress', 'Stress score (daily check-in)', '/10'], ['fatigue', 'Reported fatigue', '/10'], ['exerciseMinutes', 'Exercise per day', 'min']] },
];

/** Medical record: profile, risk modules with trends, and real NASA OSDR blood tests. All series come from the server. */
export default function RecordView({ crew, report }) {
  const [rec, setRec] = useState(null);
  const [module, setModule] = useState('bone');
  useEffect(() => {
    let alive = true;
    getJson(`/api/crew/${crew.id}/record`).then((d) => alive && setRec(d)).catch(() => {});
    return () => { alive = false; };
  }, [crew.id, report.at - (report.at % 30_000)]);
  const metricById = Object.fromEntries(report.metrics.map((m) => [m.id, m]));
  const mod = MODULES.find((m) => m.id === module);

  return (
    <div className="record-grid">
      <section className="card">
        <header className="card-head"><h2>Profile</h2></header>
        <div className="card-body">
          <dl className="facts">
            <div><dt>Born</dt><dd>{formatDate(crew.dateOfBirth)}</dd></div>
            <div><dt>Blood type</dt><dd>{crew.bloodType}</dd></div>
            <div><dt>Mission</dt><dd>{crew.mission.name}</dd></div>
            <div><dt>Orbit</dt><dd>{crew.mission.orbit}</dd></div>
            <div><dt>Module</dt><dd>{crew.mission.module}</dd></div>
            <div><dt>Spacewalks</dt><dd>{crew.eva.count} EVAs, {crew.eva.hours} h{crew.eva.certified ? ', certified' : ''}</dd></div>
          </dl>
          <h3 className="section-title">How they feel</h3>
          <blockquote className="quote">{crew.feeling}</blockquote>
          <h3 className="section-title">Wellbeing</h3>
          <dl className="facts">
            <div><dt>Mood</dt><dd>{report.psych.mood ?? '–'}</dd></div>
            <div><dt>Stress</dt><dd>{metricById.stress.display}</dd></div>
            <div><dt>Crew cohesion</dt><dd>{report.psych.crewCohesion?.toFixed(1) ?? '–'} / 10</dd></div>
            <div><dt>Workload</dt><dd>{report.psych.workloadScore?.toFixed(1) ?? '–'} / 10</dd></div>
          </dl>
          <h3 className="section-title">Training level (0–3)</h3>
          <ul className="skills">
            {Object.entries(crew.skills).map(([k, v]) => (
              <li key={k}><span>{{ eva: 'Spacewalk', robotics: 'Robotic arm', electrical: 'Electrical', thermal: 'Thermal', lifeSupport: 'Life support', mechanical: 'Mechanical', medical: 'Medical' }[k]}</span><span className="pips" aria-label={`${v} of 3`}>{[1, 2, 3].map((i) => <i key={i} className={i <= v ? 'on' : ''} />)}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <div className="cards">
        <section className="card">
          <div className="module-tabs" role="tablist" aria-label="Health areas">
            {MODULES.map((m) => {
              const item = metricById[m.metric];
              return (
                <button key={m.id} type="button" role="tab" className={`module ${item.status} ${module === m.id ? 'active' : ''}`} onClick={() => setModule(m.id)} aria-selected={module === m.id} data-testid={`module-${m.id}`}>
                  <span>{m.title}</span>
                  <strong>{item.display}</strong>
                  <small>{m.hint}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card">
          <header className="card-head">
            <h2>{mod.title}: trend</h2>
            <p>{mod.series ? 'Periodic assessments during the mission' : 'Daily log, last 15 days'}. Simulated, calibrated on published studies.</p>
          </header>
          <div className="card-body">
            {!rec && <p className="empty">Loading the record…</p>}
            {rec && mod.series && mod.series.map(([domain, key, label, unit]) => {
              const list = rec.assessments[domain] ?? [];
              const trend = rec.trends[`${domain}.${key}`];
              return (
                <div key={key} className="trend">
                  <h3>{label}{trend && <small>{trend.perMonth > 0 ? '+' : ''}{trend.perMonth} {unit} per 30 days (from {trend.first} to {trend.last})</small>}</h3>
                  <LineChart height={140} unit={unit} decimals={2} points={list.map((a) => ({ x: a.missionDay, y: Number(a.values[key]), label: `day ${a.missionDay}`, note: fmtDateTime(a.ts) }))}
                    xLabel="One point per assessment (mission day)." />
                </div>
              );
            })}
            {rec && mod.daily && mod.daily.map(([key, label, unit]) => {
              const s = rec.daily[key];
              return (
                <div key={key} className="trend">
                  <h3>{label}<small>last {s.last ?? '–'} {unit}, personal mean {s.personalMean ?? '–'} {unit}</small></h3>
                  <LineChart bars height={130} unit={unit} usual={s.personalMean} decimals={1}
                    points={s.points.map((p, i, a) => ({ x: i, y: p.value, label: p.date.slice(5), hl: i === a.length - 1 }))}
                    xLabel="Dashed line: personal mean of the previous days." />
                </div>
              );
            })}
          </div>
        </section>

        <section className="card" data-testid="labs">
          <header className="card-head">
            <h2>Blood tests</h2>
            <span className="badge tag">Real data, NASA OSDR</span>
          </header>
          {rec && (
            <>
              <div className="card-body">
                <p className="note">
                  Study OSD-575, SpaceX Inspiration4 (3 days in orbit, 2021). Anonymous subject {crew.osdrSubject}, attributed to this fictional profile. Only the last pre-flight test (L-3, {rec.labs.ageDays} days ago) would be available on board; later values are shown for reference.
                </p>
              </div>
              <table className="table compact labs">
                <thead><tr><th>Test</th><th>L-3</th><th>Reference</th><th>Pre-flight mean</th><th>L-92 to R+194</th></tr></thead>
                <tbody>
                  {rec.labs.items.filter((l) => l.lastPreflight).map((l) => (
                    <tr key={l.key} className={l.outOfRange ? 'out' : ''}>
                      <td>{l.name}<small className="block faint">{l.system}</small></td>
                      <td>{l.lastPreflight.value} <span className="unit">{l.unit}</span>{l.outOfRange && <small className="block warn-text">Outside range</small>}</td>
                      <td className="faint">{l.hasRange ? `${l.lastPreflight.min ?? '–'}–${l.lastPreflight.max ?? '–'}` : '–'}</td>
                      <td>{l.preflightMean ?? '–'}</td>
                      <td><Sparkline values={l.points.filter((p) => p.value !== null).map((p) => p.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

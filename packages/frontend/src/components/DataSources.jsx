import { useEffect, useState } from 'react';
import { getJson } from '../api/store.js';

/** Where every number comes from: real measurements, the studies the simulation is calibrated on, and assumptions. */
export default function DataSources() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getJson('/api/data-sources').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="err-text">Could not load the data sources: {err}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const Item = ({ e }) => (
    <li className="source-item">
      <p>{e.finding}</p>
      <a href={e.url} target="_blank" rel="noreferrer">{e.source}</a>
    </li>
  );
  return (
    <div className="sources-panel" data-testid="data-sources">
      <section>
        <h3>Real measurements</h3>
        <ul>{data.real.map((e) => <Item key={e.id} e={e} />)}</ul>
      </section>
      <section>
        <h3>Simulated, calibrated on published studies</h3>
        <p className="note">In-flight vital signs of individual astronauts are not public. The console simulates them, and every spaceflight effect in the simulation and in the reference bands comes from these studies.</p>
        <ul>{data.calibration.map((e) => <Item key={e.id} e={e} />)}</ul>
      </section>
      <section>
        <h3>Assumptions</h3>
        <ul className="assumptions">{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
      </section>
    </div>
  );
}

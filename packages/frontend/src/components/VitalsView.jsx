import { useEffect, useState } from 'react';
import { getJson } from '../api/store.js';
import { STATUS_LABEL, fmtDateTime, fmtTime } from '../lib/format.js';
import { LineChart, StatusDot } from './ui.jsx';

const SIGNALS = [
  { key: 'heartRate', metric: 'heartRate', label: 'Heart rate' },
  { key: 'spo2', metric: 'spo2', label: 'Blood oxygen (SpO₂)' },
  { key: 'systolic', metric: 'bloodPressure', label: 'Systolic pressure' },
  { key: 'diastolic', metric: 'bloodPressure', label: 'Diastolic pressure' },
  { key: 'bodyTemp', metric: 'bodyTemp', label: 'Core temperature' },
  { key: 'respiratoryRate', metric: 'respiratoryRate', label: 'Breathing rate' },
];
const WINDOWS = [{ h: 1, label: '1 h' }, { h: 6, label: '6 h' }, { h: 24, label: '24 h' }, { h: 168, label: '7 days' }];
const ACT_ORDER = ['sleep', 'rest', 'work', 'exercise'];

/** Vital-sign charts. Series, bucket averages, min / mean / max and daily means are computed by the server. */
export default function VitalsView({ crew, report, initialSignal = 'heartRate' }) {
  const [hours, setHours] = useState(6);
  const [signal, setSignal] = useState(initialSignal);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => getJson(`/api/crew/${crew.id}/vitals?hours=${hours}`).then((d) => { if (alive) { setData(d); setErr(null); } }).catch((e) => alive && setErr(e.message));
    load();
    const t = setInterval(load, 3_000); // live: the sensor sends a reading every 2 s
    return () => { alive = false; clearInterval(t); };
  }, [crew.id, hours]);

  const metricById = Object.fromEntries(report.metrics.map((m) => [m.id, m]));
  const sig = data?.signals[signal];
  const def = SIGNALS.find((s) => s.key === signal);
  const status = metricById[def.metric].status;
  const usualAtActivity = signal === 'heartRate' && report.vitals.activity ? report.baselines.heartRateByActivity[report.vitals.activity] : null;
  const pts = sig?.points.map((p) => ({ x: p.ts, y: p.value, label: hours > 24 ? fmtDateTime(p.ts) : fmtTime(p.ts), note: p.n > 1 ? `mean of ${p.n} readings` : undefined })) ?? [];

  return (
    <div className="two-col">
      <nav className="card" aria-label="Vital signs">
        <header className="card-head"><h2>Signals</h2></header>
        <ul className="signal-list">
          {SIGNALS.map((s) => {
            const m = metricById[s.metric];
            const v = report.vitals[s.key];
            return (
              <li key={s.key}>
                <button type="button" className={`signal ${signal === s.key ? 'active' : ''}`} onClick={() => setSignal(s.key)} aria-pressed={signal === s.key} data-testid={`signal-${s.key}`}>
                  <StatusDot status={m.status} />
                  <span className="s-name">{s.label}{m.status !== 'nominal' && <small className={`status-text ${m.status}`}>{STATUS_LABEL[m.status]}</small>}</span>
                  <strong className={`status-text ${m.status}`}>{v ?? '–'}<small>{data?.signals[s.key]?.unit}</small></strong>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="card-body"><p className="note">{report.vitals.simulated ? 'Simulated sensor data, calibrated on published spaceflight studies (see Data sources). ' : ''}One reading every few seconds, plus manual readings.</p></div>
      </nav>

      <section className="card" data-testid="vitals-chart">
        <header className="card-head">
          <div>
            <h2>{def.label}</h2>
            <p>Normal {sig ? `${sig.normal[0]}–${sig.normal[1]} ${sig.unit}` : ''}{usualAtActivity ? `. Usual during ${report.vitals.activityLabel}: ${usualAtActivity.mean} ± ${usualAtActivity.sd} bpm` : ''}</p>
          </div>
          <div className="row">
            <div className="segmented" role="group" aria-label="Time window">
              {WINDOWS.map((w) => <button key={w.h} type="button" className={hours === w.h ? 'on' : ''} onClick={() => setHours(w.h)} aria-pressed={hours === w.h}>{w.label}</button>)}
            </div>
          </div>
        </header>
        <div className="card-body">
          {err && <p className="err-text">Could not load the series: {err}</p>}
          <LineChart points={pts} band={sig?.normal} usual={usualAtActivity?.mean} unit={sig?.unit} height={240} decimals={sig?.decimals ?? 0}
            xLabel={`Each point is the mean of ${data?.bucketMinutes ?? '–'} min of readings. Hover the chart for values.`} />
          <div className="legend-line">
            <span><i className="lg-line" />{def.label}</span>
            <span><i className="lg-band" />Normal range</span>
            {usualAtActivity && <span><i className="lg-usual" />Usual value at the current activity</span>}
          </div>

          {sig?.summary && (
            <dl className="stats" data-testid="vitals-summary">
              <div><dt>Mean</dt><dd>{sig.summary.mean} {sig.unit}</dd></div>
              <div><dt>Minimum</dt><dd>{sig.summary.min} {sig.unit}</dd></div>
              <div><dt>Maximum</dt><dd>{sig.summary.max} {sig.unit}</dd></div>
              <div><dt>Variation (SD)</dt><dd>{sig.summary.sd}</dd></div>
              <div><dt>Readings</dt><dd>{sig.summary.n}</dd></div>
            </dl>
          )}

          <h3 className="section-title">Daily mean, last 14 days</h3>
          <LineChart bars height={130} unit={sig?.unit} decimals={sig?.decimals ?? 0}
            points={(sig?.daily ?? []).map((d, i, a) => ({ x: i, y: d.mean, label: d.date.slice(5), note: `${d.n} readings`, hl: i === a.length - 1 }))}
            xLabel="One bar per day. The darker bar is today." />

          {signal === 'heartRate' && data && (
            <>
              <h3 className="section-title">Heart rate by activity</h3>
              <p className="note" style={{ marginBottom: 8 }}>A reading is compared only with this person’s readings during the same activity.</p>
              <table className="table compact">
                <thead><tr><th>Activity</th><th>Usual (14 days, excluding last 24 h)</th><th>In this window</th></tr></thead>
                <tbody>
                  {ACT_ORDER.map((a) => {
                    const key = { sleep: 'sleep', rest: 'rest', work: 'work', exercise: 'exercise' }[a];
                    const b = report.baselines.heartRateByActivity[key];
                    const w = data.heartRateByActivity[a];
                    const now = report.vitals.activityLabel === a;
                    return (
                      <tr key={a}>
                        <td>{a[0].toUpperCase() + a.slice(1)}{now ? <span className="badge tag" style={{ marginLeft: 8 }}>now</span> : ''}</td>
                        <td>{b ? `${b.mean} ± ${b.sd} bpm (n=${b.n})` : '–'}</td>
                        <td>{w ? `${w.mean} ± ${w.sd} bpm (n=${w.n})` : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

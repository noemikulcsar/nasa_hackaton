import { useState } from 'react';
import { postEvent } from '../api/store.js';
import { ACTIVITY } from '../lib/format.js';

export function ManualReading({ crew, operatorId, open }) {
  const [f, setF] = useState({ bpm: '', spo2: '', systolic: '', diastolic: '', activity: 'rest' });
  const [msg, setMsg] = useState(null);
  return (
    <details className="form-box" open={open}>
      <summary>Enter a manual reading</summary>
      <form onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await postEvent({ type: 'hr_reading', astronautId: crew.id, authorId: operatorId, ...f });
          setMsg({ ok: true, text: r ? 'Reading saved. The server re-evaluates it immediately.' : 'Saved on this device; it will be sent when the server answers.' });
          setF({ ...f, bpm: '', spo2: '', systolic: '', diastolic: '' });
        } catch (err) { setMsg({ ok: false, text: err.message }); }
      }}>
        <input type="number" required min={25} max={250} placeholder="Heart rate" value={f.bpm} onChange={(e) => setF({ ...f, bpm: e.target.value })} aria-label="Heart rate in bpm" />
        <input type="number" step="0.1" min={50} max={100} placeholder="SpO₂ %" value={f.spo2} onChange={(e) => setF({ ...f, spo2: e.target.value })} aria-label="SpO2 percent" />
        <input type="number" min={50} max={250} placeholder="Systolic" value={f.systolic} onChange={(e) => setF({ ...f, systolic: e.target.value })} aria-label="Systolic pressure" />
        <input type="number" min={30} max={150} placeholder="Diastolic" value={f.diastolic} onChange={(e) => setF({ ...f, diastolic: e.target.value })} aria-label="Diastolic pressure" />
        <select className="full" value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} aria-label="Activity">
          {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn primary full" type="submit">Save reading</button>
        {msg && <span className={`full ${msg.ok ? 'ok-text' : 'err-text'}`}>{msg.text}</span>}
      </form>
    </details>
  );
}

export function ReportSymptom({ crew, region, operatorId }) {
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(null);
  return (
    <details className="form-box">
      <summary>Report a symptom here</summary>
      <form onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await postEvent({ type: 'symptom', astronautId: crew.id, authorId: operatorId, label, note, region: region.id });
          setMsg({ ok: true, text: r ? 'Symptom saved to the history.' : 'Saved on this device; it will be sent automatically.' }); setLabel(''); setNote('');
        } catch (err) { setMsg({ ok: false, text: err.message }); }
      }}>
        <input className="full" required placeholder="Symptom, for example headache" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Symptom" />
        <input className="full" placeholder="Details (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Symptom details" />
        <button className="btn primary full" type="submit">Save symptom</button>
        {msg && <span className={`full ${msg.ok ? 'ok-text' : 'err-text'}`}>{msg.text}</span>}
      </form>
    </details>
  );
}

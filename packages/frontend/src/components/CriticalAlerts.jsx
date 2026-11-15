import { useEffect, useRef, useState } from 'react';
import { getJson, useStore } from '../api/store.js';
import { useNow } from '../hooks/useNow.js';
import { fmtAge, fmtTime } from '../lib/format.js';
import { alertSentence, announce, isUnlocked, onUnlockChange, recoverySentence, unlock } from '../lib/voice.js';
import { Avatar, LineChart } from './ui.jsx';

const REPEAT_MS = 30_000;

/**
 * Critical alerts, shown on every page. Each new alert is announced by voice (name and problem), and the
 * spoken words are highlighted on screen as they are said. The live reading and its chart keep updating
 * from the sensor. The announcement repeats every 30 s while the problem lasts. When the reading leaves
 * the critical band the voice says so, the card shows "back within range" and closes by itself shortly after.
 * After an acknowledgement the server checks again 3 minutes later; if it is still critical, the alert
 * comes back (and is announced again).
 */
export default function CriticalAlerts({ alerts, crew, snapshot, operatorId, voiceOn, onOpen }) {
  const [speaking, setSpeaking] = useState(null); // { id, charIndex }
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const lastSpoken = useRef(new Map()); // alert id → time last announced
  const recoveryAnnounced = useRef(new Set());
  const queue = useRef(Promise.resolve());
  useNow(1000);

  useEffect(() => onUnlockChange(setUnlocked), []);

  // Unlock sound on the first interaction anywhere on the page.
  useEffect(() => {
    const first = () => unlock();
    window.addEventListener('pointerdown', first, { once: true });
    window.addEventListener('keydown', first, { once: true });
    return () => { window.removeEventListener('pointerdown', first); window.removeEventListener('keydown', first); };
  }, []);

  // Announce new alerts, and repeat the ones still active.
  useEffect(() => {
    if (!voiceOn || !unlocked) return undefined;
    const due = () => {
      const now = Date.now();
      for (const a of [...alerts].reverse()) {
        if (a.resolvedAt) {
          if (recoveryAnnounced.current.has(a.id) || !lastSpoken.current.has(a.id)) continue;
          recoveryAnnounced.current.add(a.id);
          const text = recoverySentence(a);
          queue.current = queue.current.then(() => announce(text, {
            onStart: () => setSpeaking({ id: a.id, text, charIndex: -1 }),
            onWord: (charIndex) => setSpeaking({ id: a.id, text, charIndex }),
            onEnd: () => setSpeaking(null),
          }));
          continue;
        }
        const key = `${a.id}:${a.repeats ?? 0}`; // a re-raised alert is announced at once
        const last = lastSpoken.current.get(key);
        if (last && now - last < REPEAT_MS) continue;
        lastSpoken.current.set(key, now);
        lastSpoken.current.set(a.id, now);
        const text = alertSentence(a);
        queue.current = queue.current.then(() => announce(text, {
          onStart: () => setSpeaking({ id: a.id, text, charIndex: -1 }),
          onWord: (charIndex) => setSpeaking({ id: a.id, text, charIndex }),
          onEnd: () => setSpeaking(null),
        }));
      }
    };
    due();
    const t = setInterval(due, 2000);
    return () => clearInterval(t);
  }, [alerts, voiceOn, unlocked]);

  if (alerts.length === 0) return null;

  const acknowledge = async (id) => {
    await fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authorId: operatorId }) });
  };

  return (
    <div className="critical-stack" role="alert" aria-live="assertive" data-testid="critical-alerts">
      {alerts.slice(0, 3).map((a, index) => {
        const c = crew.find((x) => x.id === a.astronautId);
        const report = snapshot.health[a.astronautId];
        const metric = a.metric ? report?.metrics.find((m) => m.id === a.metric) : null;
        const isSpeaking = speaking?.id === a.id;
        const sentence = isSpeaking ? speaking.text : a.resolvedAt ? recoverySentence(a) : alertSentence(a);
        return (
          <section key={a.id} className={`crit-alert ${a.resolvedAt ? 'resolved' : ''} ${isSpeaking ? 'speaking' : ''}`} data-testid="critical-alert" data-astronaut={a.astronautId}>
            <div className="critical-main">
              <Avatar src={c?.photo} name={a.name} size={48} />
              <div className="critical-text">
                <p className="critical-kicker">{a.resolvedAt ? 'Critical alert, now back within range' : a.repeats > 0 ? `Still critical after ${recheckLabel(a)}: alert raised again${a.repeats > 1 ? ` (${a.repeats} times)` : ''}` : 'Critical alert'}</p>
                <h2>{a.name}</h2>
                <p className="critical-condition">{a.condition}</p>
                <p className="critical-live">
                  {metric
                    ? <>Live: <b className={`status-text ${metric.status}`}>{metric.display}</b> (normal {metric.normal}). </>
                    : report ? <>Overall status: <b>{report.overallLabel}</b>. </> : null}
                  Since {fmtTime(a.raisedAt)}, {fmtAge(Date.now() - a.raisedAt)} ago.
                  {a.resolvedAt && <> Back within range at {fmtTime(a.resolvedAt)}; this alert closes by itself.</>}
                </p>
              </div>
            </div>
            {index === 0 && a.metric && SIGNAL[a.metric] && <LiveTrace astronautId={a.astronautId} signal={SIGNAL[a.metric]} />}
            <p className="spoken" aria-hidden="true">
              <SpokenLine text={sentence} charIndex={isSpeaking ? speaking.charIndex : null} />
            </p>
            <div className="critical-actions">
              {!unlocked && voiceOn && <button type="button" className="btn sm" onClick={() => unlock()}>Turn on the voice alert</button>}
              <button type="button" className="btn sm" onClick={() => onOpen(a.astronautId, a.region)} data-testid="alert-open">Open {a.name.split(' ')[0]}</button>
              <button type="button" className="btn sm primary" onClick={() => void acknowledge(a.id)} data-testid="alert-ack">{a.resolvedAt ? 'Close' : 'Acknowledge'}</button>
            </div>
          </section>
        );
      })}
      {alerts.length > 3 && <p className="critical-more">{alerts.length - 3} more critical alerts</p>}
    </div>
  );
}

const recheckLabel = (a) => {
  const ms = a.repeatAfterMs ?? 180_000;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const m = Math.round(ms / 60_000);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

/** Acknowledged alerts waiting for their re-check, with a countdown (top bar). */
export function RecheckChip({ pending }) {
  useNow(1000);
  if (!pending?.length) return null;
  const next = [...pending].sort((a, b) => a.recheckAt - b.recheckAt)[0];
  const s = Math.max(0, Math.round((next.recheckAt - Date.now()) / 1000));
  return (
    <span className="recheck-chip" data-testid="recheck-chip" title={pending.map((p) => `${p.name}: ${p.condition}`).join('\n')}>
      Re-check {next.name.split(' ')[0]} in {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}{pending.length > 1 ? ` (+${pending.length - 1})` : ''}
    </span>
  );
}

const SIGNAL = { heartRate: 'heartRate', spo2: 'spo2', bloodPressure: 'systolic', bodyTemp: 'bodyTemp', respiratoryRate: 'respiratoryRate' };

/** The last minutes of the sensor signal behind the alert, refreshed every 2 s. */
function LiveTrace({ astronautId, signal }) {
  const [sig, setSig] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => getJson(`/api/crew/${astronautId}/vitals?hours=0.1`).then((d) => { if (alive) setSig(d.signals[signal]); }).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [astronautId, signal]);
  if (!sig?.points?.length) return null;
  return (
    <div className="live-trace" data-testid="alert-trace">
      <LineChart points={sig.points.map((p) => ({ x: p.ts, y: p.value, label: fmtTime(p.ts) }))} band={sig.normal} unit={sig.unit} height={84} decimals={sig.decimals ?? 0} />
    </div>
  );
}

/** The spoken sentence, with the word being said highlighted. */
function SpokenLine({ text, charIndex }) {
  if (charIndex === null) return <span className="word">{text}</span>;
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) words.push({ w: m[0], start: m.index });
  const current = charIndex < 0 ? -1 : words.findLastIndex((x) => x.start <= charIndex);
  return words.map((x, i) => (
    <span key={i} className={`word ${i === current ? 'now' : i < current ? 'said' : ''}`}>{x.w} </span>
  ));
}

/** Small switch in the top bar: voice alerts on or off for this screen. */
export function VoiceToggle({ on, setOn }) {
  const [unlocked, setUnlocked] = useState(isUnlocked());
  useEffect(() => onUnlockChange(setUnlocked), []);
  return (
    <button type="button" className={`voice-toggle ${on ? 'on' : ''}`} aria-pressed={on} data-testid="voice-toggle"
      title={on ? (unlocked ? 'Voice alerts are on' : 'Voice alerts start after your first click on the page') : 'Voice alerts are off'}
      onClick={() => { unlock(); setOn(!on); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        {on ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M17 9l5 6M22 9l-5 6" />}
      </svg>
      Voice alerts {on ? 'on' : 'off'}
    </button>
  );
}

export const useAlerts = () => useStore((s) => s.snapshot?.alerts ?? []);

/** Start-up data, real-time stream, protocol library, data sources and demo controls. */
import { Router } from 'express';
import { CREW, CREW_BY_ID } from '@orbital/shared/crew';
import { ASSUMPTIONS, EVIDENCE } from '../simulation/calibration';
import { emergencyKind, isRecordEvent, type ConsoleState } from '../state/console-state';
import type { EventStream } from '../realtime/sse';
import { env } from '../env';

export function systemRoutes(state: ConsoleState, stream: EventStream) {
  const r = Router();

  r.get('/bootstrap', (_req, res) => {
    res.json({
      serverTime: Date.now(), meta: state.meta, crew: CREW, protocols: state.library.protocols, rejectedProtocols: state.library.rejected,
      labsSource: state.labs.source, events: state.events.filter(isRecordEvent), demo: state.demo,
      config: { hrStaleMs: env.hrStaleMs, simIntervalMs: env.simIntervalMs }, snapshot: state.snapshot,
    });
  });
  r.get('/stream', (req, res) => stream.connect(req, res, [['demo-state', state.demo], ['snapshot', state.snapshot]]));
  r.get('/protocols', (_req, res) => res.json(state.library));
  /** Where every number comes from: real data, published studies used for calibration, and assumptions. */
  r.get('/data-sources', (_req, res) => res.json({ real: [EVIDENCE.inspiration4Labs], calibration: Object.values(EVIDENCE).filter((e) => e.id !== 'inspiration4Labs'), assumptions: ASSUMPTIONS }));

  // Demo controls
  r.post('/demo/sensor', (req, res) => {
    const { astronautId, online } = req.body ?? {};
    if (!CREW_BY_ID[astronautId]) return res.status(400).json({ error: 'unknown crew member' });
    state.setSensor(astronautId, !!online);
    res.json(state.demo);
  });
  r.post('/demo/ai', (req, res) => { state.setAiAvailable(!!req.body?.available); res.json(state.demo); });
  /** Starts an emergency for one crew member (kind: "hypoxia" | "tachycardia" | "hypotension"), or stops it (kind: null). */
  r.post('/demo/emergency', (req, res) => {
    const { astronautId, kind } = req.body ?? {};
    if (!CREW_BY_ID[astronautId]) return res.status(400).json({ error: 'unknown crew member' });
    const k = emergencyKind(kind);
    if (kind !== null && !k) return res.status(400).json({ error: 'unknown emergency' });
    state.setEmergency(astronautId, k);
    res.json(state.demo);
  });
  /** Automatic episodes: { enabled, firstDelaySeconds, intervalSeconds, rampSeconds, holdSeconds, recoverSeconds } (all optional). */
  r.post('/demo/episodes', (req, res) => {
    const b = req.body ?? {};
    const sec = (k: string) => (typeof b[k] === 'number' && b[k] >= 0 ? b[k] * 1000 : undefined);
    const patch = Object.fromEntries(Object.entries({
      enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
      firstDelayMs: sec('firstDelaySeconds'), intervalMs: sec('intervalSeconds'), rampMs: sec('rampSeconds'), holdMs: sec('holdSeconds'), recoverMs: sec('recoverSeconds'),
    }).filter(([, v]) => v !== undefined));
    state.configureEpisodes(patch);
    res.json(state.live.status(Date.now()));
  });

  // Critical alerts
  /** Demo control: re-check delay after an acknowledgement, in seconds (default 180). */
  r.post('/demo/alerts', (req, res) => {
    const s = Number(req.body?.recheckSeconds);
    if (!(s > 0)) return res.status(400).json({ error: 'recheckSeconds must be a positive number' });
    state.setAlertRecheck(s * 1000);
    res.json({ recheckSeconds: s });
  });
  r.get('/alerts', (_req, res) => res.json(state.alerts.list()));
  r.post('/alerts/:id/acknowledge', (req, res) => {
    const e = state.acknowledgeAlert(req.params.id, req.body?.authorId);
    return e ? res.json(e) : res.status(404).json({ error: 'no open alert with this id, or unknown author' });
  });
  r.post('/demo/reset', (_req, res) => { state.reset(); res.json({ ok: true }); });
  return r;
}

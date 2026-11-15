/** Crew health: reports, vital-sign series, medical record, timeline and full history. */
import { Router, type Response } from 'express';
import { CREW, CREW_BY_ID } from '@orbital/shared/crew';
import { recordSeries, vitalSeries } from '../health/series';
import { isRecordEvent, type ConsoleState } from '../state/console-state';

export function healthRoutes(state: ConsoleState) {
  const r = Router();
  const known = (id: string, res: Response) => (CREW_BY_ID[id] ? true : (res.status(404).json({ error: 'unknown crew member' }), false));

  r.get('/crew', (_req, res) => res.json(CREW.map((c) => ({ ...c, overall: state.reports[c.id]?.overall }))));
  r.get('/crew/:id/health', (req, res) => { if (known(req.params.id, res)) res.json(state.reports[req.params.id]); });
  r.get('/crew/:id/vitals', (req, res) => {
    if (!known(req.params.id, res)) return;
    const hours = Math.min(14 * 24, Math.max(0.25, Number(req.query.hours) || 6));
    res.json(vitalSeries(state.events, req.params.id, hours, Date.now()));
  });
  r.get('/crew/:id/record', (req, res) => {
    if (known(req.params.id, res)) res.json(recordSeries(state.events, req.params.id, Date.now(), state.meta.missionStart, state.labs));
  });
  r.get('/crew/:id/timeline', (req, res) => res.json(state.events.filter((e) => e.astronautId === req.params.id && isRecordEvent(e)).reverse()));
  r.get('/history/:astronautId', (req, res) => res.json(state.events.filter((e) => e.astronautId === req.params.astronautId)));
  return r;
}

/** Entries made by the crew (observations, symptoms, incidents, requests, manual readings). */
import { Router } from 'express';
import { parseEventInput } from '../validation/events';
import type { ConsoleState } from '../state/console-state';

export function eventRoutes(state: ConsoleState) {
  const r = Router();
  r.post('/events', (req, res) => {
    const parsed = parseEventInput(req.body ?? {}, { events: state.events, missionStart: state.meta.missionStart, protocols: state.library.protocols });
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
    if ('duplicate' in parsed) return res.json(parsed.duplicate);
    res.json(state.record(parsed.event));
  });
  return r;
}

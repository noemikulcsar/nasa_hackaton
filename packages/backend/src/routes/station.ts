/** Station systems: live hardware state, repair crew recommendation and team assignment. */
import { Router } from 'express';
import { CREW_BY_ID } from '@orbital/shared/crew';
import type { RepairAssigned } from '@orbital/shared/types';
import { crewAuthor } from '../util/authors';
import { newId } from '../util/ids';
import type { ConsoleState } from '../state/console-state';

export function stationRoutes(state: ConsoleState) {
  const r = Router();
  r.get('/station', (_req, res) => res.json(state.snapshot.station));
  r.get('/station/:id/recommendation', (req, res) => {
    const rec = state.recommendations[req.params.id];
    return rec ? res.json(rec) : res.status(404).json({ error: 'no repair task for this component' });
  });
  r.post('/station/:id/assign', (req, res) => {
    const rec = state.recommendations[req.params.id];
    const by = CREW_BY_ID[req.body?.authorId];
    if (!rec) return res.status(404).json({ error: 'no repair task for this component' });
    if (!by) return res.status(400).json({ error: 'unknown author' });
    if (!rec.team.some((t) => t.role !== 'IV')) return res.status(409).json({ error: 'Nobody is cleared for the main role of this task right now, so no team can be assigned.' });
    const e: RepairAssigned = {
      id: newId(), ts: Date.now(), astronautId: 'station', author: crewAuthor(by.id), simulated: false, type: 'repair_assigned',
      componentId: req.params.id, taskTitle: rec.task.title,
      team: rec.team.map((t) => ({ role: t.role, roleLabel: t.roleLabel, crewId: t.crewId, name: t.name })),
    };
    state.record(e);
    res.json(e);
  });
  return r;
}

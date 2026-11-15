/**
 * AI assistant route: checks the request and gives the assistant module (src/assistant.ts, src/ai/*)
 * the current health events. Requests for diagnoses or doses are refused inside the module.
 */
import { Router } from 'express';
import { CREW_BY_ID } from '@orbital/shared/crew';
import { answerQuestion } from '../assistant';
import type { ConsoleState } from '../state/console-state';
import { env } from '../env';

export function assistantRoutes(state: ConsoleState) {
  const r = Router();
  r.post('/assistant', async (req, res) => {
    if (!state.demo.aiAvailable) return res.status(503).json({ error: 'The AI assistant is unavailable.' });
    const { astronautId, question, incidentId, history } = req.body ?? {};
    if (!CREW_BY_ID[astronautId]) return res.status(400).json({ error: 'unknown crew member' });
    const turns = Array.isArray(history)
      ? history.filter((h) => (h?.role === 'user' || h?.role === 'assistant') && typeof h.content === 'string').map((h) => ({ role: h.role, content: String(h.content).slice(0, 2000) }))
      : [];
    const out = await answerQuestion(String(question ?? ''), {
      astronautId, incidentId, events: state.healthEvents(), labs: state.labs, protocols: state.library.protocols,
      missionStart: state.meta.missionStart, hrStaleMs: env.hrStaleMs, now: Date.now(),
    }, turns);
    res.json(out);
  });
  r.get('/ai/status', async (_req, res) => res.json(await state.refreshAi()));
  return r;
}

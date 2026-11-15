/** HTTP application: JSON API under /api and, in production, the built interface. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { healthRoutes } from './routes/health';
import { stationRoutes } from './routes/station';
import { eventRoutes } from './routes/events';
import { assistantRoutes } from './routes/assistant';
import { systemRoutes } from './routes/system';
import type { ConsoleState } from './state/console-state';
import type { EventStream } from './realtime/sse';
import { env } from './env';

export function createApp(state: ConsoleState, stream: EventStream) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  api.use(systemRoutes(state, stream));
  api.use(healthRoutes(state));
  api.use(stationRoutes(state));
  api.use(eventRoutes(state));
  api.use(assistantRoutes(state));
  app.use('/api', api);

  if (env.production && fs.existsSync(env.frontendDist)) {
    app.use(express.static(env.frontendDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(env.frontendDist, 'index.html')));
  }
  return app;
}

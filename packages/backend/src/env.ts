/**
 * Backend configuration, read once from the environment (and `packages/backend/.env`, loaded in server.ts).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_CONFIG } from '@orbital/shared/config';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const env = {
  port: Number(process.env.PORT ?? 3001),
  production: process.env.NODE_ENV === 'production',
  /** Where the event journal is kept */
  dataDir: path.resolve(process.env.ORBITAL_DATA_DIR ?? process.env.CREWCARE_DATA_DIR ?? path.join(packageRoot, 'var')),
  /** A heart-rate sensor is considered silent after this long */
  hrStaleMs: Number(process.env.HR_STALE_SECONDS ?? RULES_CONFIG.hrStaleMs / 1000) * 1000,
  /** One simulation cycle (live readings + station step + re-evaluation) */
  simIntervalMs: Number(process.env.SIM_INTERVAL_SECONDS ?? 2) * 1000,
  /** Automatic physiology episodes: a crew member drifts into a critical state, stays there, then recovers */
  episodes: {
    enabled: (process.env.LIVE_EPISODES ?? 'on') !== 'off',
    firstDelayMs: Number(process.env.EPISODE_FIRST_DELAY_SECONDS ?? 60) * 1000,
    intervalMs: Number(process.env.EPISODE_INTERVAL_SECONDS ?? 240) * 1000,
    rampMs: Number(process.env.EPISODE_RAMP_SECONDS ?? 40) * 1000,
    holdMs: Number(process.env.EPISODE_HOLD_SECONDS ?? 80) * 1000,
    recoverMs: Number(process.env.EPISODE_RECOVER_SECONDS ?? 40) * 1000,
  },
  /** How long a recovered critical alert stays on screen ("back within range") before it closes by itself */
  alertRecoveredShowMs: Number(process.env.ALERT_RECOVERED_SHOW_SECONDS ?? 20) * 1000,
  /** After an acknowledgement the state is checked again after this long; still critical → the alert is raised again */
  alertRecheckMs: Number(process.env.ALERT_RECHECK_SECONDS ?? 180) * 1000,
  /** Built interface served in production */
  frontendDist: path.resolve(process.env.FRONTEND_DIST ?? path.join(packageRoot, '../frontend/dist')),
};

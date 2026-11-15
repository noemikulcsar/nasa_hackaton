/**
 * Orbital Health Console API – entry point.
 * REST API + real-time stream (Server-Sent Events) + vital-sign and station simulators.
 * All health evaluations, averages, comparisons, station states and repair rankings are computed here.
 */
import { loadEnvFile } from './ai/config';
loadEnvFile(); // packages/backend/.env (AI provider settings), before anything reads the environment
const { env } = await import('./env');
const { EventStream } = await import('./realtime/sse');
const { ConsoleState } = await import('./state/console-state');
const { createApp } = await import('./app');

const stream = new EventStream();
const state = new ConsoleState(stream);
const app = createApp(state, stream);

setInterval(() => state.tick(), env.simIntervalMs);
setInterval(() => { void state.refreshAi(); }, 15_000);

app.listen(env.port, async () => {
  const ai = await state.refreshAi();
  console.log(`[api] Orbital Health Console on http://localhost:${env.port}  (sensor silent after ${env.hrStaleMs / 1000} s, cycle ${env.simIntervalMs / 1000} s)`);
  console.log(ai.configured
    ? `[ai] agent active: ${ai.provider}, model ${ai.model}${ai.offline ? ' (local, no internet needed)' : ' (cloud)'}`
    : `[ai] agent inactive: ${ai.reason}${ai.hint ? `  ->  ${ai.hint}` : ''}. Answers come from the local engine.`);
});

/**
 * Client state and synchronisation with the server.
 * The browser does not evaluate health or station data: it shows what the server computes.
 *  - initial load: GET /api/bootstrap
 *  - live updates: Server-Sent Events (/api/stream): `snapshot` every cycle, `record-event`, `demo-state`, `reset`
 *  - writes: POST /api/events; if the server does not answer, the event waits in a local queue (localStorage)
 *    and is sent again automatically. The client-generated id makes the retry idempotent.
 */
import { useSyncExternalStore } from 'react';

const OUTBOX_KEY = 'orbital.outbox.v1';
const readOutbox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]'); } catch { return []; } };
const writeOutbox = (o) => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(o)); } catch { /* storage unavailable */ } };

let state = { boot: null, snapshot: null, events: [], demo: null, connection: 'connecting', outbox: readOutbox(), clockSkew: 0, error: null };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export function useStore(selector) {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => selector(state));
}
export const getState = () => state;

function addEvent(e) {
  if (state.events.some((x) => x.id === e.id)) return;
  set({ events: [...state.events, e] });
}

export async function loadBootstrap() {
  try {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const boot = await res.json();
    set({ boot, snapshot: boot.snapshot, events: boot.events, demo: boot.demo, clockSkew: boot.serverTime - Date.now(), error: null });
  } catch (e) {
    set({ error: `The server is not responding (${e.message}). Start it with “npm run dev”.`, connection: 'offline' });
  }
}

let es;
export function connectStream() {
  es?.close();
  es = new EventSource('/api/stream');
  es.onopen = () => { set({ connection: 'live' }); flushOutbox(); };
  es.onerror = () => set({ connection: 'offline' });
  es.addEventListener('snapshot', (m) => set({ snapshot: JSON.parse(m.data) }));
  es.addEventListener('record-event', (m) => addEvent(JSON.parse(m.data)));
  es.addEventListener('demo-state', (m) => set({ demo: JSON.parse(m.data) }));
  es.addEventListener('reset', () => { void loadBootstrap(); });
}

const newClientId = () => `cl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function send(p) {
  const res = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p.payload, clientId: p.clientId }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { permanent: res.status >= 400 && res.status < 500 });
  return body;
}

/** Saves an event. Returns the confirmed event, or null if it is waiting in the local queue. */
export async function postEvent(payload) {
  const p = { clientId: newClientId(), payload, createdAt: Date.now() };
  try {
    const e = await send(p);
    addEvent(e);
    return e;
  } catch (err) {
    if (err.permanent) throw err;
    const outbox = [...state.outbox, p];
    writeOutbox(outbox);
    set({ outbox });
    return null;
  }
}

let flushing = false;
export async function flushOutbox() {
  if (flushing || state.outbox.length === 0) return;
  flushing = true;
  try {
    for (const p of [...state.outbox]) {
      try { addEvent(await send(p)); } catch (err) { if (!err.permanent) break; }
      const outbox = state.outbox.filter((x) => x.clientId !== p.clientId);
      writeOutbox(outbox);
      set({ outbox });
    }
  } finally { flushing = false; }
}
setInterval(() => { void flushOutbox(); }, 5000);

export async function demoAction(path, body, optimistic) {
  if (optimistic && state.demo) set({ demo: optimistic(state.demo) });
  const res = await fetch(`/api/demo/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok && path !== 'reset') set({ demo: await res.json() });
}

export async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function assignRepair(componentId, authorId) {
  const res = await fetch(`/api/station/${componentId}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authorId }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export async function askAssistant(astronautId, question, incidentId, history = []) {
  try {
    const res = await fetch('/api/assistant', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ astronautId, question, incidentId, history }),
      signal: AbortSignal.timeout(200_000), // the server has its own deadline and falls back to the local engine
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}`, unavailable: res.status === 503 };
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, error: e.message, unavailable: true };
  }
}

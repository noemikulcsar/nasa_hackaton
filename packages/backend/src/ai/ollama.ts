/**
 * Detection of the local AI model (Ollama), which runs on the crew's computer without internet.
 * Ollama exposes GET /api/tags (downloaded models) and an OpenAI-compatible API at /v1.
 */
export const OLLAMA_BASE = () => (process.env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434').replace(/\/$/, '');

/** Small models with tool-calling support, in order of preference. */
export const PREFERRED_LOCAL_MODELS = ['qwen2.5:7b', 'qwen2.5:3b', 'llama3.1:8b', 'llama3.2:3b', 'qwen3:4b', 'mistral-nemo', 'qwen2.5:1.5b', 'llama3.2:1b'];
export const DEFAULT_LOCAL_MODEL = 'qwen2.5:3b';

export interface OllamaProbe { running: boolean; models: string[] }

let cache: { at: number; value: OllamaProbe } | null = null;

export async function probeOllama(force = false): Promise<OllamaProbe> {
  if (!force && cache && Date.now() - cache.at < 10_000) return cache.value;
  let value: OllamaProbe = { running: false, models: [] };
  try {
    const res = await fetch(`${OLLAMA_BASE()}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const body = (await res.json()) as { models?: { name: string }[] };
      value = { running: true, models: (body.models ?? []).map((m) => m.name) };
    }
  } catch { /* Ollama is not running */ }
  cache = { at: Date.now(), value };
  return value;
}

/** Picks the local model: the one in .env if downloaded, otherwise the first preferred one available. */
export function pickLocalModel(available: string[], wanted?: string): { model: string; installed: boolean } {
  const has = (m: string) => available.some((a) => a === m || a === `${m}:latest` || a.split(':')[0] === m && !m.includes(':'));
  if (wanted) return { model: wanted, installed: has(wanted) };
  const found = PREFERRED_LOCAL_MODELS.find(has) ?? available[0];
  return found ? { model: found, installed: true } : { model: DEFAULT_LOCAL_MODEL, installed: false };
}

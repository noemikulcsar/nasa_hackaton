/**
 * AI agent configuration, read from `packages/backend/.env` or from environment variables.
 *
 * Supported providers:
 *   gemini    – Google Gemini (free key from Google AI Studio)                 GEMINI_API_KEY
 *   openai    – OpenAI or any compatible API (OpenRouter, Groq, LM Studio)     OPENAI_API_KEY [+ OPENAI_BASE_URL]
 *   anthropic – Claude                                                         ANTHROPIC_API_KEY
 *   ollama    – local model, no key (https://ollama.com)                       OLLAMA_BASE_URL (default http://localhost:11434)
 *
 * AI_PROVIDER selects the provider explicitly; otherwise the first one with a key is used.
 * AI_MODEL overrides the default model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Loads `.env` without dependencies (variables already set in the environment take priority). */
export function loadEnvFile(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'ollama';

export interface AiConfig {
  provider: ProviderId | null;
  model: string;
  label: string;
  /** for OpenAI-compatible APIs */
  baseUrl?: string;
  apiKey?: string;
  reason?: string; // de ce nu este configurat
  offline: boolean; // runs locally, without internet
  hint?: string; // next configuration step
}

const DEFAULT_MODEL: Record<ProviderId, string> = {
  gemini: 'gemini-flash-latest',
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-haiku-5-5',
  ollama: 'qwen2.5:3b',
};
const LABEL: Record<ProviderId, string> = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude', ollama: 'Ollama (local)' };

export function readAiConfig(env = process.env): AiConfig {
  const has = (k: string) => !!env[k] && env[k]!.trim() !== '' && !/^(your|put|key|xxx)/i.test(env[k]!.trim());
  let provider = (env.AI_PROVIDER?.trim().toLowerCase() || '') as ProviderId | '' | 'none';
  if (provider === 'none') return { provider: null, model: '', label: 'Disabled', reason: 'AI_PROVIDER=none in .env', offline: true };
  if (!provider) {
    if (has('GEMINI_API_KEY')) provider = 'gemini';
    else if (has('OPENAI_API_KEY')) provider = 'openai';
    else if (has('ANTHROPIC_API_KEY')) provider = 'anthropic';
    else if (has('OLLAMA_BASE_URL') || has('OLLAMA_MODEL')) provider = 'ollama';
  }
  if (!provider) return { provider: null, model: '', label: 'Not configured', reason: 'There is no local model and no API key', offline: true };
  if (!(provider in DEFAULT_MODEL)) return { provider: null, model: '', label: 'Neconfigurat', reason: `AI_PROVIDER necunoscut: ${provider}`, offline: true };

  const model = env.AI_MODEL?.trim() || (provider === 'ollama' ? env.OLLAMA_MODEL?.trim() : '') || DEFAULT_MODEL[provider];
  const base: AiConfig = { provider, model, label: LABEL[provider], offline: provider === 'ollama' };
  switch (provider) {
    case 'gemini':
      if (!has('GEMINI_API_KEY')) return { ...base, provider: null, reason: 'GEMINI_API_KEY is missing' };
      return { ...base, apiKey: env.GEMINI_API_KEY, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' };
    case 'openai':
      if (!has('OPENAI_API_KEY')) return { ...base, provider: null, reason: 'OPENAI_API_KEY is missing' };
      return { ...base, apiKey: env.OPENAI_API_KEY, baseUrl: (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '') };
    case 'anthropic':
      if (!has('ANTHROPIC_API_KEY')) return { ...base, provider: null, reason: 'ANTHROPIC_API_KEY is missing' };
      return { ...base, apiKey: env.ANTHROPIC_API_KEY, baseUrl: 'https://api.anthropic.com' };
    case 'ollama':
      return { ...base, apiKey: 'ollama', baseUrl: `${(env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434').replace(/\/$/, '')}/v1` };
  }
}

import { DEFAULT_LOCAL_MODEL, OLLAMA_BASE, pickLocalModel, probeOllama } from './ollama';

/**
 * The effective configuration, giving priority to the LOCAL model (there is no internet in space):
 *  1. AI_PROVIDER set explicitly in .env
 *  2. Ollama, if it runs on this computer (detected automatically)
 *  3. a cloud provider, if there is a key (for tests on Earth only)
 */
export async function resolveAiConfig(env = process.env): Promise<AiConfig> {
  const explicit = env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit && explicit !== 'ollama') return readAiConfig(env);
  const probe = await probeOllama();
  const wanted = env.OLLAMA_MODEL?.trim() || (explicit === 'ollama' ? env.AI_MODEL?.trim() : '') || undefined;
  if (probe.running) {
    const { model, installed } = pickLocalModel(probe.models, wanted);
    if (!installed) {
      return { provider: null, model, label: 'Ollama (local)', offline: true,
        reason: `Ollama is running, but the model ${model} is not downloaded`, hint: `ollama pull ${model}` };
    }
    return { provider: 'ollama', model, label: 'Ollama (local)', offline: true, apiKey: 'ollama', baseUrl: `${OLLAMA_BASE()}/v1` };
  }
  if (explicit === 'ollama' || env.OLLAMA_BASE_URL?.trim() || env.OLLAMA_MODEL?.trim()) {
    return { provider: null, model: wanted ?? DEFAULT_LOCAL_MODEL, label: 'Ollama (local)', offline: true,
      reason: `Ollama is not running at ${OLLAMA_BASE()}`, hint: 'Start the Ollama app' };
  }
  const cloud = readAiConfig(env);
  if (cloud.provider && cloud.provider !== 'ollama') return cloud;
  return { provider: null, model: DEFAULT_LOCAL_MODEL, label: 'Neconfigurat', offline: true,
    reason: 'No local AI model (Ollama) was found', hint: `Install Ollama, then run: ollama pull ${DEFAULT_LOCAL_MODEL}` };
}

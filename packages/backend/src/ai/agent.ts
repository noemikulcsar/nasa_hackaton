/**
 * The AI agent: a language model that decides which tools to call (heart rate, daily log, symptoms,
 * timeline, lab tests, protocols), receives the results and writes the answer with cited sources.
 *
 * Loop: question → model → tool calls → results → model … → final answer (at most 6 steps).
 * Checks on the answer: no doses or medicines (otherwise it is rejected), cited sources must exist.
 */
import type { Derived } from '@orbital/shared/rules';
import { CREW_BY_ID } from '@orbital/shared/crew';
import { DIAGNOSIS_NOTE } from '@orbital/shared/config';
import { MEDICATION_PATTERN } from '../protocols';
import { SourceRegistry, TOOLS, TOOL_LABEL, type ToolContext } from './tools';
import type { AiConfig } from './config';
import { runLocalAgent } from './local';
import type { AssistantSource } from '@orbital/shared/types';

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface AgentStep { tool: string; label: string; args: Record<string, unknown> }
export interface AgentResult { answer: string; sources: AssistantSource[]; steps: AgentStep[]; model: string; provider: string }

export const NOT_AVAILABLE = 'This information is not available in the crew member\'s data or in the protocol library.';
const MAX_STEPS = 6;

function systemPrompt(ctx: ToolContext) {
  const c = CREW_BY_ID[ctx.astronautId];
  return `You are the data agent of Orbital Health Console, used on board the International Space Station (Expedition 74).
The user is looking at the record of ${c.name} (${c.role}, astronaut_id="${c.id}")${ctx.incidentId ? `, who has the open incident ${ctx.incidentId}` : ''}.
On-board date and time: ${new Date(ctx.now).toLocaleString('en-GB')}.

How you work:
- Use the tools to get the data. Assume nothing from memory; call as many tools as you need.
- Every result has a "source" field (for example D3, P1, T2). After each statement based on data, put the source in square brackets: [D3].
- If the requested information is not in the tool results, answer exactly: "${NOT_AVAILABLE}"
- Say when the data is simulated or old (for example the pre-flight lab tests, or a sensor without data).

Strict limits (safety):
- Do NOT make diagnoses and do not name likely diseases.
- Do NOT recommend medicines, doses, injections or medical procedures.
- For protocols, say only WHERE the information is (ID, version, section) and whether the protocol is fictional; do not rephrase the steps.
- If asked for a diagnosis or a treatment, decline politely and refer to the crew medical officer (CMO) and the approved protocol.

Style: English, clear, concise (about 8 lines at most). Use "• " bullets when listing values.`;
}

const toolSpecsOpenAI = () => TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
const toolSpecsAnthropic = () => TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 60_000) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = j.error?.message ?? j.message ?? msg; } catch { /* plain text */ }
    throw new Error(`${res.status}: ${msg}`);
  }
  return JSON.parse(text);
}

function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext, reg: SourceRegistry, cache: Map<string, Derived>) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try { return tool.run(args ?? {}, ctx, reg, cache); } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Small local models (3–8 billion parameters) call tools less reliably than cloud models.
 * So for a local model the basic data is fetched in advance and put in the context;
 * the model can still call tools for details (lab tests, timeline, other crew members).
 */
function prefetchContext(question: string, ctx: ToolContext, reg: SourceRegistry, steps: AgentStep[], cache: Map<string, Derived>) {
  const plan: [string, Record<string, unknown>][] = [
    ['get_region_status', {}], ['get_heart_rate', {}], ['get_daily_log', {}], ['get_symptoms_and_incidents', {}],
    ['search_protocols', { query: question }],
  ];
  if (/lab|blood|glucose|potassium|creatinine|calcium|crp/i.test(question)) plan.push(['get_lab_results', {}]);
  if (/timeline|history|observ|who |last hour/i.test(question)) plan.push(['get_timeline', { limit: 10 }]);
  const data: Record<string, unknown> = {};
  for (const [name, args] of plan) {
    steps.push({ tool: name, label: TOOL_LABEL[name], args });
    data[name] = runTool(name, args, ctx, reg, cache);
  }
  return `DATA FETCHED AUTOMATICALLY FROM THE DATABASE (use it and cite the "source" fields):\n${JSON.stringify(data)}`;
}

const stripThinking = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

async function runOpenAICompatible(cfg: AiConfig, question: string, history: ChatTurn[], ctx: ToolContext, reg: SourceRegistry, steps: AgentStep[]) {
  const cache = new Map<string, Derived>();
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: systemPrompt(ctx) },
    ...(cfg.offline ? [{ role: 'system', content: prefetchContext(question, ctx, reg, steps, cache) }] : []),
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: question },
  ];
  let useTools = true;
  const timeout = cfg.offline ? 180_000 : 60_000; // a local model on a CPU can be slow
  for (let i = 0; i < MAX_STEPS; i++) {
    let body;
    try {
      body = await postJson(`${cfg.baseUrl}/chat/completions`, { authorization: `Bearer ${cfg.apiKey}` }, {
        model: cfg.model, messages, ...(useTools ? { tools: toolSpecsOpenAI(), tool_choice: 'auto' } : {}),
        ...(cfg.offline ? { temperature: 0.1 } : {}),
      }, timeout);
    } catch (e) {
      // some local models do not accept tools: continue with the prefetched data only
      if (useTools && cfg.offline && /does not support tools|tools/i.test((e as Error).message)) { useTools = false; i--; continue; }
      throw e;
    }
    const msg = body.choices?.[0]?.message;
    if (!msg) throw new Error('response without a message');
    const calls = (msg.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[];
    if (calls.length === 0) return stripThinking(String(msg.content ?? ''));
    messages.push(msg); // kept exactly (including provider metadata, e.g. Gemini signatures)
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* invalid arguments → empty object */ }
      steps.push({ tool: c.function.name, label: TOOL_LABEL[c.function.name] ?? c.function.name, args });
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(runTool(c.function.name, args, ctx, reg, cache)) });
    }
  }
  throw new Error('the agent exceeded the maximum number of steps');
}

async function runAnthropic(cfg: AiConfig, question: string, history: ChatTurn[], ctx: ToolContext, reg: SourceRegistry, steps: AgentStep[]) {
  const cache = new Map<string, Derived>();
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: question },
  ];
  for (let i = 0; i < MAX_STEPS; i++) {
    const body = await postJson(`${cfg.baseUrl}/v1/messages`, { 'x-api-key': cfg.apiKey!, 'anthropic-version': '2023-06-01' }, {
      model: cfg.model, max_tokens: 1200, system: systemPrompt(ctx), tools: toolSpecsAnthropic(), messages,
    });
    const content = body.content as { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }[];
    const uses = content.filter((c) => c.type === 'tool_use');
    if (uses.length === 0) return content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    messages.push({ role: 'assistant', content });
    messages.push({
      role: 'user',
      content: uses.map((u) => {
        steps.push({ tool: u.name!, label: TOOL_LABEL[u.name!] ?? u.name!, args: u.input ?? {} });
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(runTool(u.name!, u.input ?? {}, ctx, reg, cache)) };
      }),
    });
  }
  throw new Error('the agent exceeded the maximum number of steps');
}

export async function runAgent(cfg: AiConfig, question: string, history: ChatTurn[], ctx: ToolContext, deadlineMs = 60_000): Promise<AgentResult> {
  if (!cfg.provider) throw new Error(cfg.reason ?? 'agent not configured');
  let reg = new SourceRegistry();
  let steps: AgentStep[] = [];
  let text: string;
  if (cfg.provider === 'ollama') {
    const r = await runLocalAgent(cfg.model, question, history, ctx, deadlineMs);
    ({ reg, steps, text } = r);
  } else {
    text = cfg.provider === 'anthropic'
      ? await runAnthropic(cfg, question, history, ctx, reg, steps)
      : await runOpenAICompatible(cfg, question, history, ctx, reg, steps);
  }
  if (!text) throw new Error('empty answer');

  // Safety checks on the generated text
  if (MEDICATION_PATTERN.test(text) || /the diagnosis is|probabl[ey] (has|suffers|is suffering)|likely (has|suffers)/i.test(text)) {
    throw Object.assign(new Error('the answer was blocked by the safety filter (it contained medical instructions)'), { blocked: true });
  }
  const valid = new Set(reg.sources.map((s) => s.id));
  const cited = [...new Set([...text.matchAll(/\[([DPT]\d+)\]/g)].map((m) => m[1]))];
  const answer = text.replace(/\[([DPT]\d+)\]/g, (m, id) => (valid.has(id) ? m : '')).trim();
  const used = cited.filter((c) => valid.has(c));
  const sources = used.length ? reg.sources.filter((s) => used.includes(s.id)) : reg.sources.slice(0, 12);
  const final = /diagnos|treat|medic/i.test(question) && !/medical officer/i.test(answer) ? `${answer}\n\n${DIAGNOSIS_NOTE}` : answer;
  return { answer: final, sources, steps, model: cfg.model, provider: cfg.label };
}

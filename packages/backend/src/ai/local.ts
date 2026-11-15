/**
 * The agent for a LOCAL model (Ollama), tuned for computers without a graphics card:
 *  - the data relevant to the question is fetched from the database with the same tools as the cloud agent;
 *  - the model receives only the facts, as a short "[D1] …" list (a few hundred words, not raw JSON);
 *  - one call to the native Ollama API (/api/chat), with a larger context window and the model kept in memory.
 * Optional (OLLAMA_TOOLS=1): the full tool loop, for larger models or computers with a GPU.
 */
import type { Derived } from '@orbital/shared/rules';
import { CREW_BY_ID } from '@orbital/shared/crew';
import { SourceRegistry, TOOLS, TOOL_LABEL, type ToolContext } from './tools';
import type { AgentStep, ChatTurn } from './agent';
import { NOT_AVAILABLE } from './agent';
import { OLLAMA_BASE } from './ollama';

const KEEP_ALIVE = '30m';

/** Picks the tools that fit the question (less data → faster answer). */
export function planTools(question: string): [string, Record<string, unknown>][] {
  const q = question.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const plan: [string, Record<string, unknown>][] = [['get_region_status', {}], ['get_symptoms_and_incidents', {}]];
  const any = (re: RegExp) => re.test(q);
  if (any(/heart|pulse|bpm|chest|sensor|tachy|palpit/) || any(/chang|usual|differ|deviat|normal|how (is|does)|status|wrong/)) plan.push(['get_heart_rate', {}]);
  if (any(/sleep|tired|fatigue|exercis|workout|training|muscle|bone|log/) || any(/chang|usual|differ|deviat|status/)) plan.push(['get_daily_log', {}]);
  if (any(/protocol|procedure|steps|what (do|should) we do|guideline|where (can|do) i find/)) plan.push(['search_protocols', { query: question }]);
  if (any(/lab|blood|glucose|potassium|sodium|creatinine|calcium|crp|liver|kidney/)) plan.push(['get_lab_results', {}]);
  if (any(/timeline|history|observ|who (has|did|recorded)|last hour|what happened|recorded/)) plan.push(['get_timeline', { limit: 10 }]);
  if (any(/crew|colleague|everyone|whole team/)) plan.push(['get_crew_overview', {}]);
  return plan;
}

function systemPrompt(ctx: ToolContext) {
  const c = CREW_BY_ID[ctx.astronautId];
  return `You are the Orbital Health Console data assistant on board the International Space Station. Record being viewed: ${c.name}, ${c.role}.
Answer in English, briefly (6 lines at most), ONLY from the FACTS provided. After each statement put the fact code in square brackets, for example [D2].
If the facts do not contain the answer, write exactly: "${NOT_AVAILABLE}"
Do not make diagnoses, and do not recommend medicines, doses or procedures. For protocols, give only the code and the section.
Say when the data is simulated or old.`;
}

async function ollamaChat(model: string, messages: unknown[], timeoutMs: number, tools?: unknown[]) {
  const res = await fetch(`${OLLAMA_BASE()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model, messages, stream: false, keep_alive: KEEP_ALIVE, ...(tools ? { tools } : {}),
      options: { num_ctx: 8192, temperature: 0.1, num_predict: 400 },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text).error ?? msg; } catch { /* plain text */ }
    throw new Error(`Ollama ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as { message: { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] } };
}

const stripThinking = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export async function runLocalAgent(model: string, question: string, history: ChatTurn[], ctx: ToolContext, timeoutMs: number) {
  const reg = new SourceRegistry();
  const steps: AgentStep[] = [];
  const cache = new Map<string, Derived>();
  for (const [name, args] of planTools(question)) {
    steps.push({ tool: name, label: TOOL_LABEL[name], args });
    TOOLS.find((t) => t.name === name)!.run(args, ctx, reg, cache);
  }
  const facts = reg.sources.map((s) => `[${s.id}] ${s.label}: ${s.detail}`).join('\n');
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: systemPrompt(ctx) },
    ...history.slice(-4).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: `FACTS FROM THE DATABASE (${new Date(ctx.now).toLocaleString('en-GB')}):\n${facts}\n\nQUESTION: ${question}` },
  ];

  if (process.env.OLLAMA_TOOLS === '1') {
    // Advanced mode: the model can request more data through tools
    const toolSpecs = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    for (let i = 0; i < 4; i++) {
      const r = await ollamaChat(model, messages, timeoutMs, toolSpecs);
      const calls = r.message.tool_calls ?? [];
      if (calls.length === 0) return { text: stripThinking(r.message.content), reg, steps };
      messages.push(r.message);
      for (const c of calls) {
        steps.push({ tool: c.function.name, label: TOOL_LABEL[c.function.name] ?? c.function.name, args: c.function.arguments ?? {} });
        const tool = TOOLS.find((t) => t.name === c.function.name);
        const out = tool ? tool.run(c.function.arguments ?? {}, ctx, reg, cache) : { error: 'unknown tool' };
        messages.push({ role: 'tool', content: JSON.stringify(out) });
      }
    }
    throw new Error('the agent exceeded the maximum number of steps');
  }

  const r = await ollamaChat(model, messages, timeoutMs);
  return { text: stripThinking(r.message.content ?? ''), reg, steps };
}

/** Loads the model into memory in advance, so the first question does not wait for loading. */
const warmed = new Set<string>();
export async function warmUp(model: string) {
  if (warmed.has(model)) return;
  warmed.add(model);
  try {
    await fetch(`${OLLAMA_BASE()}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({ model, prompt: '', keep_alive: KEEP_ALIVE }),
    });
    console.log(`[ai] local model ${model} loaded into memory`);
  } catch {
    warmed.delete(model);
  }
}

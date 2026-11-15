/**
 * A server that imitates Ollama, to test the offline agent without downloading a model.
 *  GET  /api/tags     → "downloaded" models
 *  POST /api/generate → load into memory (warm-up)
 *  POST /api/chat     → answer from the FACTS received; the "slow:1b" model waits 10 s (deadline test)
 * Start: npx tsx packages/backend/test/mock-ollama.ts  → http://localhost:4011
 */
import http from 'node:http';
http.createServer((req, res) => {
  const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/api/tags') return send(200, { models: [{ name: 'qwen2.5:3b' }, { name: 'slow:1b' }] });
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    if (req.url === '/api/generate') return send(200, { done: true });
    const user = String(j.messages[j.messages.length - 1].content);
    const facts = user.split('\n').filter((l) => /^\[[DPT]\d+\]/.test(l));
    const hr = facts.find((l) => /Heart-rate sensor/.test(l));
    const proto = facts.find((l) => /^\[P\d+\]/.test(l));
    const cite = (l?: string) => (l ? l.slice(0, l.indexOf(']') + 1) : '');
    const content = `<think>looking in the facts</think>${hr ? `• ${hr.replace(/^\[[^\]]+\]\s*[^:]+:\s*/, '').split(';').slice(0, 2).join(';')} ${cite(hr)}` : "This information is not available in the crew member's data or in the protocol library."}${proto ? `\n• Protocol: ${proto.split(' ')[1]} ${cite(proto)}` : ''}`;
    const reply = () => send(200, { model: j.model, message: { role: 'assistant', content }, done: true });
    if (j.model === 'slow:1b') setTimeout(reply, 10_000); else setTimeout(reply, 300);
  });
}).listen(4011, () => console.log('mock Ollama on http://localhost:4011'));

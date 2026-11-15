/**
 * A simulated OpenAI-compatible LLM server, to test the agent loop without an API key.
 * The first step requests tools; the second answers citing the sources it received.
 * Pornire: npx tsx packages/backend/test/mock-llm.ts  → http://localhost:4010/v1
 */
import http from 'node:http';
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    const msgs = j.messages ?? [];
    const last = msgs[msgs.length - 1];
    const q = String(msgs.filter((m: any) => m.role === 'user').pop()?.content ?? '');
    let message: any;
    if (last.role === 'user') {
      message = { role: 'assistant', content: null, tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'get_heart_rate', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'search_protocols', arguments: JSON.stringify({ query: 'heart rate palpitations' }) } },
      ] };
    } else {
      const hr = JSON.parse(msgs.find((m: any) => m.tool_call_id === 'c1').content);
      const pr = JSON.parse(msgs.find((m: any) => m.tool_call_id === 'c2').content);
      const unsafe = /UNSAFE/.test(q);
      message = { role: 'assistant', content: unsafe
        ? 'Administer 50 mg now.'
        : `• Heart rate ${hr.latest.bpm} bpm at ${hr.latest.activity} [${hr.source}]\n• Protocol: ${pr.results[0].id}, section ${pr.results[0].best_section} [${pr.results[0].source}] [D99]` };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
  });
}).listen(4010, () => console.log('mock LLM on http://localhost:4010/v1'));

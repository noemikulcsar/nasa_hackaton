/**
 * Real-time channel to the interface (Server-Sent Events).
 * Events: `snapshot` (health + station, every simulation cycle), `record-event` (a new timeline entry),
 * `demo-state` (sensors, AI availability) and `reset`.
 */
import type { Request, Response } from 'express';

export class EventStream {
  private readonly clients = new Set<Response>();

  broadcast(event: string, data: unknown) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  /** Express handler: keeps the connection open and sends the initial state. */
  connect(req: Request, res: Response, initial: [string, unknown][]) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    for (const [event, data] of initial) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    this.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(ping); this.clients.delete(res); });
  }
}

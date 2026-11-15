/**
 * Append-only event store (NDJSON journal).
 *
 * Every reading, observation, symptom, incident, medical-officer request or protocol opening is an
 * immutable event appended to `events.ndjson`. Nothing is overwritten, so the full history can be
 * rebuilt at any time. No native dependencies (runs on Windows, macOS and Linux without compiling).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { StoredEvent } from '@orbital/shared/types';
import { generateSeed } from '../simulation/seed';

export interface Meta {
  seededAt: number;
  missionStart: number;
  missionName: string;
}

export class EventStore {
  events: StoredEvent[] = [];
  meta!: Meta;
  private readonly eventsFile: string;
  private readonly metaFile: string;

  constructor(private readonly dir: string) {
    this.eventsFile = path.join(dir, 'events.ndjson');
    this.metaFile = path.join(dir, 'meta.json');
  }

  /** Loads the journal, or generates the demo scenario if there is none yet. */
  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.eventsFile) || !fs.existsSync(this.metaFile)) {
      this.reset();
      return;
    }
    this.meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    this.events = [];
    for (const line of fs.readFileSync(this.eventsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { this.events.push(JSON.parse(line)); } catch { console.warn('[store] skipped a corrupt line'); }
    }
    console.log(`[store] ${this.events.length} events loaded from ${path.relative(process.cwd(), this.eventsFile)}`);
  }

  /** Replaces the journal with a freshly generated demo scenario. */
  reset() {
    const { events, meta } = generateSeed();
    this.events = events;
    this.meta = meta;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.eventsFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFileSync(this.metaFile, JSON.stringify(meta, null, 2));
    console.log(`[store] demo scenario generated: ${events.length} simulated events`);
  }

  append(e: StoredEvent) {
    this.events.push(e);
    fs.appendFileSync(this.eventsFile, JSON.stringify(e) + '\n');
    return e;
  }
}

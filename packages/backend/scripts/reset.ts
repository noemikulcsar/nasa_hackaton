/** Regenerates the demo scenario in the event journal (npm run reset). */
import { EventStore } from '../src/storage/event-store';
import { env } from '../src/env';

new EventStore(env.dataDir).reset();

# Architecture

Three npm workspaces. The browser never computes a health status: it displays what the API sends.

```
┌──────────────────────────┐   HTTP (JSON) + Server-Sent Events   ┌──────────────────────────────┐
│  @orbital/frontend       │ ───────────────────────────────────▶ │  @orbital/backend            │
│  React, three.js, Vite   │ ◀─────────────────────────────────── │  Node, Express               │
└──────────────────────────┘     snapshot every 3 s, entries      └──────────────┬───────────────┘
                                                                                 │ imports
                                                                  ┌──────────────▼───────────────┐
                                                                  │  @orbital/shared             │
                                                                  │  types, crew, regions, rules │
                                                                  └──────────────────────────────┘
```

## packages/shared (`@orbital/shared`)

Domain model, imported by the backend as `@orbital/shared/<module>`.

| File | Contents |
|---|---|
| `src/types.ts` | event types (readings, logs, assessments, symptoms, incidents…), protocol, report types |
| `src/crew.ts` | the four crew profiles |
| `src/regions.ts` | the seven body regions |
| `src/config.ts` | mission, colours, rule configuration |
| `src/rules.ts` | personal-baseline statistics: `stats()`, `derive()` |
| `src/paths.ts` | location of the reference data |
| `data/labs.json` | real OSDR blood tests (generated) |
| `data/hardware.json` | station parts and limits |

## packages/backend (`@orbital/backend`)

```
src/
├── server.ts               entry point: loads .env, creates the state, starts the cycle and the HTTP server
├── app.ts                  Express app: /api routes, built interface in production
├── env.ts                  configuration from the environment
├── routes/                 one router per area
│   ├── system.ts           bootstrap, stream, protocols, data sources, demo controls
│   ├── health.ts           crew reports, vital series, record, timeline, history
│   ├── station.ts          station snapshot, repair recommendation, team assignment
│   ├── events.ts           crew entries
│   └── assistant.ts        AI assistant route (English medical-request guard)
├── state/console-state.ts  live state: store, station, demo switches, snapshot, simulation tick
├── alerts/                 critical-alerts.ts: critical alerts raised from every re-evaluation; re-checked 3 min after Acknowledge, raised again if still critical
├── realtime/sse.ts         Server-Sent Events channel
├── validation/events.ts    validation of crew entries
├── storage/event-store.ts  append-only NDJSON journal
├── health/                 engine.ts (report, bands, regions), series.ts (charts and averages)
├── station/                hardware.ts (simulator), repair.ts (crew ranking)
├── simulation/             calibration.ts (published findings), profiles.ts, seed.ts
├── assistant.ts, ai/       offline AI assistant (unchanged; only import paths moved)
├── protocols.ts            protocol library loader and medicine guard
└── util/                   ids, authors
data/protocols/             fictional demo protocols
scripts/                    build-labs.ts (OSDR → labs.json), reset.ts
test/                       Vitest tests, mock AI servers
var/                        event journal (created at start-up, not in git)
```

## packages/frontend (`@orbital/frontend`)

```
src/
├── main.jsx, App.jsx       entry, top navigation, page switch, global drawers
├── api/store.js            bootstrap, SSE subscription, offline outbox for entries
├── pages/                  AstronautPage (left: profile and vitals, centre: 3D body, right: region panel),
│                           StationPage, ProtocolsPage
├── components/             RegionPanel (problem, protocol, AI, report), ProtocolText, VitalsView,
│                           RecordView, IncidentDrawer, HandoverSummary, DataSources, CriticalAlerts, Timeline, ui
├── scene/                  three.js scenes: astronaut in orbit (region picking via userData.healthRegion), ISS, Earth
├── lib/, hooks/            formatting, body-region helpers, voice alerts (voice.js), timers
└── styles/app.css          dark theme
public/                     3D models, photos, favicon
```

In development Vite forwards `/api` to `http://localhost:3001` (`API_URL` to change it). In production the backend serves `packages/frontend/dist`.

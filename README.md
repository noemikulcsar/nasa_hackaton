# Orbital Health Console

Prototype for **NASA Space Apps Challenge 2026**, challenge *Create Health Monitoring Software for Astronauts on Space Missions*.

Crew health monitoring for the International Space Station:
- a 3D body map;
- vital-sign charts compared against each person's own history;
- a medical record with real NASA OSDR blood tests;
- an incident workflow with a shared timeline;
- station systems with a health-aware repair-crew recommendation;
- an AI assistant that runs **offline**.

> ⚠️ **Hackathon prototype, not a medical device.** The console never gives diagnoses, medicines or doses.
>
> **About the data.** The blood tests are **real** (NASA OSDR, Inspiration4, anonymised), attributed to fictional crew profiles. In-flight vital signs of individual astronauts are not public, so vital signs, logs and assessments are **simulated, calibrated on published spaceflight studies**: blood pressure 8 mmHg lower in flight, core temperature +1 °C, bone loss 0.9–1.5 % per month, calf muscle −15 % in 6 months, 0.2–0.5 mSv of radiation per day, leg fluid −12.7 %, ISS sleep 6.1 h. Each study is cited in the console (**Data sources**, top right, and next to each reading) and in [docs/DATA.md](docs/DATA.md). The scenario events, station readings and protocols are fictional and labelled as such.

---

## Project structure

An npm workspaces monorepo with three packages. The interface and the API are separate programs that talk only over HTTP and Server-Sent Events.

```
orbital-health-console/
├── packages/
│   ├── shared/      @orbital/shared    domain model used by the API: types, crew, body regions,
│   │                                   rule configuration, personal-baseline rules, reference data
│   ├── backend/     @orbital/backend   Node + Express API: health engine, station simulator,
│   │                                   event store, real-time stream, offline AI assistant
│   └── frontend/    @orbital/frontend  React + three.js interface (Vite)
├── e2e/                                end-to-end test of the whole jury demo (Playwright)
├── data/osdr/                          raw NASA OSDR files (source of shared/data/labs.json)
└── docs/                               DATA.md (where every number comes from), ARCHITECTURE.md
```

Details of each package are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Start

You need **Node.js 20.6 or newer**. No database server and no internet connection are required.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The command starts both packages: the API (`@orbital/backend`, port 3001) and the interface (`@orbital/frontend`, Vite, port 5173).

Each package can also run alone: `npm run dev -w @orbital/backend` or `npm run dev -w @orbital/frontend`.

**One address** (for presenting from another computer):
```bash
npm run build
npm start          # http://localhost:3001 (the API also serves the built interface)
```

| Command | What it does |
|---|---|
| `npm run reset` | Regenerates the demo scenario (replaces the local history). Also available in the console: **Simulation** → *Reset the demo scenario*. |
| `npm test` | Backend tests: rules, health engine, series and averages, repair ranking, protocol guard (Vitest). |
| `npm run test:e2e` | Runs the whole jury demo in a real browser. First time: `npx playwright install chromium`. |
| `npm run typecheck` | Type-checks the shared and backend packages. |
| `npm run ai:status` | Shows which AI agent is active and, if none, the next step. |
| `npm run data:labs` | Rebuilds `packages/shared/data/labs.json` from the OSDR files in `data/osdr/`. |

### Offline AI agent

In space there is no internet, so the assistant runs **on the crew's computer** through [Ollama](https://ollama.com). No account or API key is needed.

1. Install Ollama. On Windows: `winget install --id Ollama.Ollama -e`, or the installer from https://ollama.com/download.
2. Download a model once (this is the only step that needs internet):
   ```
   ollama pull qwen2.5:3b
   ```
   - `qwen2.5:3b` is about 2 GB and needs about 8 GB RAM.
   - With 16 GB RAM, `qwen2.5:7b` gives better answers.
   - On a slow computer, use `qwen2.5:1.5b` and add `OLLAMA_MODEL=qwen2.5:1.5b` to `packages/backend/.env`.
3. Run `npm run dev`. The terminal shows `[ai] agent active: Ollama (local)…`.

Without Ollama the console still works: the assistant answers from the **local engine**, which is deterministic and reads the same data. Configuration options are in `packages/backend/.env.example` (copy it to `packages/backend/.env`).

> The AI assistant (`packages/backend/src/assistant.ts`, `packages/backend/src/ai/`) answers in English. Requests for a diagnosis, medicines or doses are refused before they reach the model.

---

## How the console is organised

Everything starts from the body: one screen per crew member, no tabs.

- **Top menu:** the four crew members (each with a status dot) and **Station**. On the right: *Voice alerts on/off*, *Data sources*, *Signed in as* and the **Simulation** controls.
- **Left:** who the crew member is (role, age, blood type, mission day, location), the open incident, and the five vital signs. Select a vital sign to open its chart (1 h to 7 days, mean, min, max, SD, daily means, heart rate by activity). Below: **History**, **Medical record** (risk trends and the real OSDR blood tests) and **Summary for the doctor** (a handover text built from the record; it works offline and adds nothing that is not recorded).
- **Centre:** the 3D astronaut floating in orbit, with stars and the Earth below. Click a body part (or the buttons under it). The worst region is selected when the screen opens.
- **Right, for the selected region:**
  1. **What is wrong**: each finding with its rule, data and source, plus the readings for that region.
  2. **What the protocol says**: the matching protocol from the on-board library, shown word for word.
  3. **Ask the AI**: questions about this crew member, with suggestions for the region. When the answer cites a protocol, its exact text appears under the answer.
  4. **Report**: the incident (observation, medical officer request), a symptom for this region, a manual reading (chest).

### Critical alerts

When any crew member reaches a **critical** state (an urgent incident, or a vital sign in the critical band), the server raises a critical alert. It appears **on every screen, whatever page is open**:
- a red panel with the name, the problem ("Blood oxygen critically low") and the **live reading**, which keeps updating;
- a short attention tone, then the **computer's voice says the name and the problem**: *"Critical alert. Amara Okafor. Blood oxygen critically low."* Each word is highlighted on screen as it is spoken;
- the announcement repeats every 30 s while the problem lasts, until a crew member selects **Acknowledge**;
- **re-check after 3 minutes:** after *Acknowledge*, the server checks the crew member again 3 minutes later. If the state is still critical, the alert is **raised again** on every screen (*"Still critical after 3 minutes: alert raised again"*) and the voice says *"Critical alert, still active. Amara Okafor. Blood oxygen critically low."* If the state is no longer critical, nothing is raised. The top bar shows the countdown (*Re-check Amara in 2:41*). The cycle repeats for as long as the state stays critical;
- raising, acknowledgement, re-raising and recovery are saved in the history.

The voice uses the speech engine of the computer (no internet needed). Browsers allow sound only after the first click on the page; until then the panel offers *Turn on the voice alert*. The *Voice alerts* switch in the top bar mutes it for that screen.

---

## Jury demo (about 5 minutes)

Scenario: Expedition 74, ISS. You are signed in as **Elena Voss** (top right).

1. The console opens on **Lucas Marchetti**, *Critical*. The critical alert for his urgent incident is on screen; click anywhere and the voice announces it. Select **Acknowledge**.
2. **Chest and heart** is selected. The right panel shows `R-INCIDENT-URGENT`, `R-HR-PERSONAL-DEVIATION` (about 115 bpm at rest against his usual 62 ± 2 bpm) and the fictional protocol PROT-DEMO-CV-01, word for word. Click his **head** on the 3D model, then the **chest** again.
3. Select **Urgent incident INC-86-01** on the left. Record an observation (it appears with the author, and on a second open window without reloading). **Request the medical officer**: a banner appears on every screen; switch *Signed in as* to Ravi Menon and select **Take over**.
4. In **Ask the AI**, select *What is wrong with the chest and what does the protocol say?* The answer cites PROT-DEMO-CV-01 and its exact text is shown under it. A question about doses is declined by the safety filter.
5. Select **Heart rate** on the left for the chart, then **Medical record** (Marchetti's creatinine, 1.37 mg/dL, is outside the reference range) and **Summary for the doctor**.
6. Select **Elena** in the top menu: the same 3D model shows her data.
7. **Simulation → stop Elena's sensor.** After 20 s her readings turn grey (`R-SENSOR-STALE`). On **Station** she is then *not cleared* for the spacewalk.
8. Open **Station**, then **Simulation → Emergency → Amara Okafor: Start**. Within a few seconds her live SpO₂ falls to about 86 %: the critical alert appears over the station page and the voice says *"Critical alert. Amara Okafor. Blood oxygen critically low."* Select **Open Amara** (her chest region opens), then **Acknowledge**. The top bar counts down 3 minutes; leave the emergency running and, when the re-check comes, the alert is raised again (*"Critical alert, still active…"*). Then stop the emergency.
9. Turn Elena's sensor back on and select **Assign** (EV1 Elena, IV Ravi). **Simulation → AI unavailable**: the region panel keeps the protocol text and offers the history.

---

## Backend: where things are computed

The browser only displays results. Every evaluation, average, comparison and ranking is computed by the server, and the server pushes a new **snapshot** to every screen every 3 s.

Paths are relative to `packages/`.

| What | File | Function |
|---|---|---|
| Event database (append-only, `backend/var/events.ndjson`) | `backend/src/storage/event-store.ts` | `EventStore.load / append / reset` |
| Live state, simulation cycle, re-evaluation | `backend/src/state/console-state.ts` | `ConsoleState.tick / computeAll / record` |
| Personal history: mean and SD by activity, comparison with the threshold max(2 SD, 10 bpm), sleep, fatigue and exercise against personal means, staleness, incidents | `shared/src/rules.ts` | `stats()`, `derive()` |
| Health report: every metric graded against reference bands (with their published source), 7 body regions, the rules behind each colour, alerts, next steps | `backend/src/health/engine.ts` | `buildHealthReport()`, `METRICS` |
| Charts: bucket means, min / mean / max / SD per window, daily means over 14 days, heart rate by activity, assessment trends per 30 days, daily-log personal means, OSDR labs | `backend/src/health/series.ts` | `vitalSeries()`, `recordSeries()` |
| Station telemetry: drift and noise, limits, system status, faults | `backend/src/station/hardware.ts` | `StationSimulator.step / snapshot` |
| Repair crew ranking: skill and health scores, blockers, verdict, team, precautions | `backend/src/station/repair.ts` | `evaluateCandidate()`, `recommendCrew()` |
| Published spaceflight findings used for calibration | `backend/src/simulation/calibration.ts` | `EVIDENCE`, `ASSUMPTIONS` |
| Crew physiology (ground values + published in-flight effects) and scenario | `backend/src/simulation/profiles.ts`, `seed.ts` | `PROFILES`, `generateSeed()` |
| Critical alerts: raise, resolve, acknowledge, re-check 3 minutes after acknowledgement and raise again if still critical, rebuild after restart | `backend/src/alerts/critical-alerts.ts` | `CriticalAlerts.update / acknowledge / restore` |
| Input validation for crew entries | `backend/src/validation/events.ts` | `parseEventInput()` |
| HTTP routes, real-time stream | `backend/src/routes/*.ts`, `backend/src/realtime/sse.ts` | – |

**API**

| Route | Returns |
|---|---|
| `GET /api/bootstrap` | crew, protocols, timeline events, latest snapshot |
| `GET /api/stream` | Server-Sent Events: `snapshot` (health reports, station, rankings), `record-event`, `demo-state`, `reset` |
| `GET /api/crew/:id/health` | the health report of one crew member |
| `GET /api/crew/:id/vitals?hours=6` | series, bucket means, summary, daily means, heart rate by activity |
| `GET /api/crew/:id/record` | daily-log series, assessment trends, OSDR labs |
| `GET /api/crew/:id/timeline` | recorded events |
| `GET /api/station`, `GET /api/station/:id/recommendation` | station snapshot, ranking for one part |
| `POST /api/station/:id/assign` | saves the repair team (refused when nobody is cleared for the main role) |
| `POST /api/events` | observation, symptom, incident, request to the medical officer, protocol opened, manual reading |
| `POST /api/assistant` | the AI assistant (unchanged); English requests for doses or diagnoses are declined by the route |
| `GET /api/data-sources` | real data, the published studies used for calibration, and the assumptions |
| `GET /api/alerts`, `POST /api/alerts/:id/acknowledge` | open critical alerts; acknowledgement by a crew member (re-checked 3 minutes later) |
| `POST /api/demo/emergency` | demo: a crew member's live sensor sends critical readings (`spo2` or `heartRate`), or stops (`null`) |

### Colour rules (7 regions: head, chest, pelvis, arms, hands, legs, feet)

| Colour | When |
|---|---|
| Red, **Critical** | incident marked urgent in the scenario, or a reading in the critical band |
| Orange, **Warning** | reading in the warning band, or an open standard incident |
| Yellow, **Check** | symptom reported in the last 72 h; reading that **differs from the person's own history in the same conditions** (heart rate at the same activity, sleep, fatigue, exercise); reading in the first band outside normal |
| Grey, **No data** | the sensor has sent nothing for 20 s (demo value), or the daily log is older than 36 h |
| Green, **Nominal** | recent data, within range |

Every rule is shown with its code (for example `R-HR-PERSONAL-DEVIATION`), the numbers it used and its source. Where a band depends on spaceflight physiology (core temperature, sleep, bone, calf muscle, leg fluid, radiation, blood pressure) it follows the published values cited next to the reading; the other bands are common clinical ranges or illustrative values.

---

## What changed from the interface you provided

- The interface, its visual style, the 3D astronaut, the ISS model and the station view are kept, but reorganised into the pages described above.
- Logic that ran in the browser now runs on the server: `health.js`, `telemetry.js`, `hardware.js`, `repair.js` and the crew database. Their thresholds, scoring and wording are preserved.
- Added on top of the interface:
  - comparisons with personal history and stale-data detection;
  - incidents, timeline and the protocol library;
  - real OSDR blood tests;
  - charts with server-side averages;
  - persistence and real-time sync.
- The 3D astronaut now writes `userData.healthRegion` on its bones; a click resolves the region by reading that attribute up the hierarchy.
- The browser no longer calls an AI provider with a key embedded in the page. The assistant is the backend one, offline-first.
- Advice texts that named treatments (for example oxygen or an antipyretic) were replaced with checks and escalation to the medical officer. Treatment instructions may appear only in a protocol approved for the mission.
- Fonts are bundled locally, so the console works without internet.

## Data
See **[docs/DATA.md](docs/DATA.md)**.

## 3D models
- Astronaut: “Astronaut rigged and animated” by assetfactory (Sketchfab, SKETCHFAB Standard license). Attribution: `packages/frontend/public/models/LICENSE-astronaut.txt`.
- Space station: “International Space Station (ISS)” from NASA 3D Resources (`packages/frontend/public/models/LICENSE-iss.txt`). Use does not imply NASA endorsement.

## Known limitations
- Thresholds and repair scoring are demo logic, not validated clinically or operationally.
- Day-by-day astronaut data is not public, so vital signs and records are simulated. They follow published averages, but a real person varies more than the simulation.
- There is no authentication: *Signed in as* sets the author of records.
- Small offline models write more simply than cloud models. Facts come from the database, and the answer is checked before it is shown.

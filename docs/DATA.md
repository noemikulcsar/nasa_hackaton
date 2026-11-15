# Where the data comes from

The console uses three kinds of data, and it labels each one in the interface (**Data sources**, top right, and *Reference* next to each reading).

| Kind | What | Labelled as |
|---|---|---|
| **Real measurements** | Blood tests of the four Inspiration4 crew members (NASA OSDR) | *Real data, NASA OSDR* |
| **Simulated, calibrated on published studies** | Vital signs, daily logs, periodic assessments | *Simulated*, with the study cited |
| **Fictional** | Scenario events (symptoms, the urgent incident), station faults, demo protocols | *Scenario*, *Fictional* |

Why not more real data: in-flight vital signs of individual astronauts are not public. NASA OSDR publishes processed biological data from the Inspiration4 mission (blood, urine, omics). The crew's wearable data (heart rate, SpO₂, sleep) appears to be held in the TRISH EXPAND database, which is accessible only on request.

---

## 1. Real measurements: NASA OSDR, Inspiration4

Both archives come from **SpaceX Inspiration4** (September 2021, 3 days in low Earth orbit, 4 civilian crew anonymised as **C001–C004**; C001 and C004 are male, C002 and C003 female). Samples were taken at **L-92, L-44, L-3** (before launch) and **R+1, R+45, R+82, R+194** (after return). There are no in-flight samples.

**OSD-575, blood serum (used).** Raw files in `data/osdr/OSD-575/`, converted by `npm run data:labs` (`packages/backend/scripts/build-labs.ts`) into `packages/shared/data/labs.json`.
- Comprehensive metabolic panel, with units and reference ranges on every row: glucose, urea (BUN), creatinine, eGFR (formula without race coefficient), sodium, potassium, chloride, bicarbonate, total protein, albumin, globulin, bilirubin, AST, ALT, calcium, alkaline phosphatase.
- Cardiovascular panel (no reference ranges): CRP, fibrinogen, haptoglobin, AGP, alpha-2 macroglobulin, fetuin A, L-selectin, PF4, SAP. Original units kept.
- Not used: immune panels (research markers, hard to interpret on board) and duplicate "transformed" files.

**OSD-656, urine (not used).** 203 inflammatory proteins in relative units without reference ranges. Metadata kept in `data/osdr/OSD-656/`.

**Attribution.** C001 → Lucas Marchetti, C002 → Elena Voss, C003 → Amara Okafor, C004 → Ravi Menon. The profiles are fictional; biological sex matches the subject.

**In the console.** On a mission only the pre-flight tests would be on board, so the latest "available" value is **L-3**; later values are shown for reference. Real values outside the range at L-3: C001 creatinine 1.37 mg/dL (> 1.35); C002 AST 40 U/L (> 35); C003 potassium 3.3 mmol/L, urea 26 mg/dL, alkaline phosphatase 31 U/L; C004 glucose 56 mg/dL.

---

## 2. Simulated, calibrated on published studies

Code: `packages/backend/src/simulation/calibration.ts` (the findings), `profiles.ts` (how each crew member's values are derived), `seed.ts` (the 14-day history). Every simulated event has `simulated: true`.

Each crew member has **ground (pre-flight) values**. The in-flight values are derived from them with the published effects below; individual rates stay inside the published ranges.

| Quantity | Published finding | How the console uses it | Source |
|---|---|---|---|
| Blood pressure | 24-h systolic −8 mmHg, diastolic −9 mmHg after 3–6 months on the ISS | in-flight usual = ground − 8 / − 9 mmHg | Norsk et al., J Physiol 2015 |
| Heart rate | unchanged in flight | in-flight usual = ground value, per activity | Norsk et al., J Physiol 2015 |
| Core temperature | +1.0 °C at rest, reached gradually over 2.5 months | usual = ground + 1.0 × min(1, day / 75); reference band 36.1–38.0 °C in flight | Stahn et al., Sci Rep 2017 |
| Bone density | spine −0.9 %/month, hip −1.4 to −1.5 %/month (4–6 month missions) | individual rates −0.4 to −1.7 %/month × months in flight; band *Check* from −1.0 %/month | Lang et al., J Bone Miner Res 2004 |
| Calf muscle | soleus −15 ± 2 % after 6 months, individual range 1 % to over 20 % | soleus rate −0.8 to −3.6 %/month; band *Check* from −10 % | Trappe et al., J Appl Physiol 2009; Fitts et al., J Physiol 2010 |
| Radiation | ISS 0.2–0.5 mSv/day; career limit 600 mSv | mission dose = rate × mission day (rate checked in range) + earlier missions; band *Check* from 50 % of the limit | NASA technical report 20250006168; NASA-STD-3001 (OCHMO-TB-020) |
| Leg fluid | leg volume −12.7 % (≈ 2.2 L) within the first day | usual −11 to −13 %; band *Check* from −17 % | Moore 1988 (Shuttle); Skylab ≈ −13 % |
| Sleep | ISS mean 6.09 h/night with 8.5 h scheduled; 24 % of nights ≥ 7 h | usual 6.2–7.0 h; band *Check* below 6 h | Barger et al., Lancet Neurology 2014 |
| Exercise | ~5 h aerobic per week + resistance on 3–6 days per week | usual 110–150 min/day | Trappe et al., J Appl Physiol 2009 |

Links:
- Norsk 2015: https://pmc.ncbi.nlm.nih.gov/articles/PMC4324706/
- Stahn 2017: https://doi.org/10.1038/s41598-017-15560-w
- Lang 2004: https://pubmed.ncbi.nlm.nih.gov/15125798/
- Trappe 2009: https://pubmed.ncbi.nlm.nih.gov/19150852/
- NASA radiation dose rates: https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf
- NASA-STD-3001 radiation brief: https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf
- Moore 1988: https://docs.lib.purdue.edu/dissertations/AAI8814566
- Barger 2014: https://doi.org/10.1016/S1474-4422(14)70122-X

**History generated:** 14 days of vital signs (one reading every 45 min, with the activity from the crew schedule: sleep 23–07, rest, work, exercise 14–16), 15 daily logs, 4 periodic assessments per domain; the live simulator adds one reading per crew member every 3 s.

## 3. Assumptions (no published value used)

- The scenario values: Marchetti's raised heart rate at rest, Okafor's falling SpO₂ and short nights, Menon's low blood pressure and poor standing tolerance.
- Quadriceps and grip strength: about half the calf rate.
- Lung capacity (FVC), visual acuity shift, stress, fatigue and crew cohesion: illustrative values.
- SpO₂ and breathing rate: no in-flight change (the ISS cabin is kept at sea-level pressure).
- Station hardware readings and faults: synthetic; part names and locations follow the real ISS (`packages/shared/data/hardware.json`).

## 4. Scenario (Expedition 74, day 86)

- **Lucas Marchetti (CDR):** heart rate at rest about 116 bpm against a usual 62; palpitations and dizziness; incident INC-86-01 marked urgent. Fewer resistive sessions this mission, so bone and calf rates are at the high end of the published range.
- **Amara Okafor (MS):** SpO₂ falling towards 91.6 % over the last 30 h; three short nights; blurred vision on waking; headache.
- **Ravi Menon (CMO):** low blood pressure, poor standing tolerance, lightheaded when standing.
- **Elena Voss (FE):** usual values; used for the "sensor stops sending data" demo.

## 5. Protocols

`packages/backend/data/protocols/*.json`: 6 **fictional** demo protocols, clearly marked, with no instructions about medicines.

/**
 * Full jury demo, checked automatically in a real browser (WebGL).
 * Run: npm run test:e2e   (first time: npx playwright install chromium)
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png` });

// Records what the voice engine says (and simulates word timing), so the test can check the spoken alert.
const fakeSpeech = () => {
  (window as any).__spoken = [];
  const synth = window.speechSynthesis;
  synth.speak = (u: SpeechSynthesisUtterance) => {
    (window as any).__spoken.push(u.text);
    const words = [...u.text.matchAll(/\S+/g)];
    words.forEach((m, i) => setTimeout(() => u.onboundary?.({ name: 'word', charIndex: m.index } as any), i * 120));
    setTimeout(() => u.onend?.({} as any), words.length * 120 + 50);
  };
  synth.cancel = () => {};
};

test('jury demo: critical alert, body region with protocol and AI, incident, observation, charts, switch, sensor off, emergency, station', async ({ page, browser, request }) => {
  await request.post('/api/demo/reset');
  await page.addInitScript(fakeSpeech);
  await page.goto('/');

  // 0. A critical alert is shown on every screen and spoken (name and problem) after the first interaction
  const alert = page.getByTestId('critical-alert').first();
  await expect(alert).toContainText('Lucas Marchetti');
  await expect(alert).toContainText('Palpitations and high resting heart rate');
  await page.mouse.click(5, 300); // first interaction unlocks sound
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.join(' | ')), { timeout: 10_000 })
    .toContain('Critical alert. Lucas Marchetti. Palpitations and high resting heart rate.');
  await shot(page, '00-critical-alert');
  await alert.getByTestId('alert-ack').click();
  await expect(page.getByTestId('critical-alerts')).toHaveCount(0);

  // 1. The console opens on the crew member who needs attention most, with the worst region selected
  await expect(page.getByTestId('profile')).toContainText('Lucas Marchetti');
  await expect(page.getByTestId('profile')).toContainText('Commander');
  await expect(page.getByTestId('btn-incident')).toContainText('INC-86-01');
  const panel = page.getByTestId('region-panel');
  await expect(panel).toHaveAttribute('data-region', 'chest');

  // 2. Click the head, then the chest, on the 3D model
  await page.waitForFunction(() => !!(window as any).__orbital?.regionScreenPoint('chest'), null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const head = await page.evaluate(() => (window as any).__orbital.regionScreenPoint('head'));
  await page.mouse.click(head.x, head.y);
  await expect(panel).toHaveAttribute('data-region', 'head');
  await page.waitForTimeout(800);
  const pt = await page.evaluate(() => (window as any).__orbital.regionScreenPoint('chest'));
  await page.mouse.click(pt.x, pt.y);
  await expect(panel).toHaveAttribute('data-region', 'chest');
  await expect(panel.locator('[data-rule="R-HR-PERSONAL-DEVIATION"]')).toContainText('Usual in the same conditions');
  await expect(panel.locator('[data-rule="R-INCIDENT-URGENT"]')).toBeVisible();
  await expect(panel.locator('[data-metric="heartRate"]')).toContainText('Usual at rest');
  await expect(panel).toContainText('authorized clinical source');
  // the protocol for the region is shown in the panel, word for word
  await expect(panel.getByTestId('protocol-text').first()).toHaveAttribute('data-protocol-id', 'PROT-DEMO-CV-01');
  await expect(panel.getByTestId('protocol-text').first()).toContainText('Fictional demo protocol');
  await shot(page, '01-crew-chest');

  // second screen (another crew tablet) for real-time checks
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page2.goto('/');
  await page2.getByTestId('crew-marchetti').click();
  await page2.getByTestId('btn-history').click();

  // 3. Open the incident, record an observation
  await page.getByTestId('btn-incident').click();
  const inc = page.getByTestId('incident-panel');
  await expect(inc).toContainText('INC-86-01');
  await expect(inc).toContainText('Palpitations');
  await expect(inc.getByTestId('recent-readings')).toContainText('bpm');
  const text = `Jury test ${Date.now()}: pulse checked manually, the crew member is calm.`;
  await inc.locator('#obs-text').fill(text);
  await inc.getByRole('button', { name: 'Save observation' }).click();
  await expect(inc.getByTestId('obs-saved')).toContainText('added to the timeline');
  const item = inc.getByTestId('timeline').locator('.tl-item', { hasText: text });
  await expect(item).toContainText('Recorded by Elena Voss');
  await expect(page2.getByTestId('timeline')).toContainText(text, { timeout: 10_000 });
  await inc.getByTestId('btn-cmo').click();
  await expect(inc.getByTestId('cmo-status')).toContainText('Waiting for the medical officer');
  await expect(page2.getByTestId('cmo-banner')).toBeVisible({ timeout: 10_000 });
  await shot(page, '02-incident');
  await page2.close();

  // opening the protocol from the incident is logged in the history
  await inc.getByTestId('btn-protocol').click();
  await expect(page.getByTestId('protocol-view')).toHaveAttribute('data-protocol-id', 'PROT-DEMO-CV-01');
  await page.getByTestId('crew-marchetti').click();
  await page.getByTestId('btn-history').click();
  await expect(page.getByTestId('timeline')).toContainText('PROT-DEMO-CV-01');
  await page.keyboard.press('Escape');

  // history is saved in the database (append-only file)
  const hist = await (await request.get('/api/history/marchetti')).json();
  expect(hist.some((e: any) => e.type === 'observation' && e.text === text && e.author.name === 'Elena Voss')).toBe(true);
  expect(fs.readFileSync('.e2e-data/events.ndjson', 'utf8')).toContain(text);

  // 4. Ask the AI inside the region panel; protocol text appears in the answer
  const asst = page.getByTestId('assistant');
  await asst.getByRole('button', { name: 'What is wrong with the chest and what does the protocol say?' }).click();
  const first = asst.getByTestId('assistant-answer').last();
  await expect(first).toContainText('PROT-DEMO-CV-01');
  await expect(first.getByTestId('protocol-text').first()).toHaveAttribute('data-protocol-id', 'PROT-DEMO-CV-01');
  await asst.getByRole('button', { name: 'What has changed compared with the usual values?' }).click();
  const ans = asst.getByTestId('assistant-answer').last();
  await expect(ans).toContainText(/Heart rate now/);
  await expect(ans.locator('cite').first()).toHaveText(/^[DPT]\d+$/);
  await asst.getByLabel('Message the medical assistant').fill('What dose of medication should I give him?');
  await asst.getByRole('button', { name: 'Ask' }).click();
  await expect(asst.getByTestId('assistant-answer').last()).toContainText('cannot recommend');
  await asst.scrollIntoViewIfNeeded();
  await shot(page, '03-region-ai');

  // 5. Charts computed on the server, opened from the vital signs
  await page.getByTestId('vital-heartRate').click();
  await expect(page.getByTestId('vitals-summary')).toContainText('Mean');
  await page.getByTestId('signal-spo2').click();
  await expect(page.getByTestId('vitals-chart')).toContainText('Blood oxygen');
  await shot(page, '04-vitals');
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-record').click();
  await expect(page.getByTestId('labs')).toContainText('Creatinine');
  await page.getByTestId('module-muscle').click();
  await expect(page.getByText('Quadriceps size change').first()).toBeVisible();
  await shot(page, '05-record');
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-summary').click();
  await expect(page.getByTestId('summary')).toContainText('INC-86-01');
  await expect(page.getByTestId('summary')).toContainText('not a diagnosis');
  await shot(page, '06-summary');
  await page.keyboard.press('Escape');

  // 6. Switch to the second astronaut: same 3D model, new data
  await page.getByTestId('crew-voss').click();
  await expect(page.getByTestId('profile')).toContainText('Elena Voss');
  expect(await page.locator('canvas').count()).toBe(1);
  await page.getByTestId('region-btn-chest').click();
  await expect(panel).toHaveAttribute('data-region', 'chest');
  await expect(panel.locator('[data-rule="R-HR-PERSONAL-DEVIATION"]')).toHaveCount(0);

  // 7. The sensor stops sending data → grey after the freshness limit
  await page.getByTestId('btn-demo').click();
  await page.getByTestId('sensor-voss').click({ force: true });
  await expect(page.getByTestId('sensor-voss')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(panel.locator('[data-rule="R-SENSOR-STALE"]')).toBeVisible({ timeout: 25_000 });
  await expect(panel.locator('[data-metric="spo2"]')).toHaveClass(/nodata/);
  await shot(page, '07-sensor-stopped');

  // 8. AI unavailable → the protocol text and the history still work
  await page.getByTestId('btn-demo').click();
  await page.getByTestId('ai-toggle').click({ force: true });
  await expect(page.getByTestId('ai-toggle')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ai-fallback')).toBeVisible();
  await page.getByTestId('ai-fallback').getByRole('button', { name: 'Open the history' }).click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.keyboard.press('Escape');

  // 9. Emergency: Amara's sensor sends critical SpO₂; the alert appears on every page, even the station, and is spoken
  await page.getByTestId('nav-station').click();
  await page.getByTestId('btn-demo').click();
  await page.getByTestId('emergency-okafor').click();
  await page.keyboard.press('Escape');
  const em = page.getByTestId('critical-alert').filter({ hasText: 'Amara Okafor' });
  await expect(em).toContainText('Blood oxygen critically low', { timeout: 15_000 });
  await expect(em).toContainText('Live:');
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.join(' | ')), { timeout: 10_000 })
    .toContain('Critical alert. Amara Okafor. Blood oxygen critically low.');
  await shot(page, '08-emergency-on-station');
  await em.getByTestId('alert-open').click();
  await expect(page.getByTestId('profile')).toContainText('Amara Okafor');
  await expect(page.getByTestId('region-panel')).toHaveAttribute('data-region', 'chest');
  await page.getByTestId('critical-alert').filter({ hasText: 'Amara Okafor' }).getByTestId('alert-ack').click();
  await page.getByTestId('btn-demo').click();
  await page.getByTestId('emergency-okafor').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-history').click();
  await expect(page.getByTestId('timeline')).toContainText('Critical alert acknowledged');
  await page.keyboard.press('Escape');

  // 10. Station: health-aware repair team, assignment saved on the server.
  // While Elena's sensor is off she has no live readings and is not cleared for a spacewalk:
  await page.getByTestId('nav-station').click();
  await expect(page.getByTestId('assign-team')).toBeDisabled();
  await page.getByTestId('btn-demo').click();
  await page.getByTestId('sensor-voss').click({ force: true });
  await page.keyboard.press('Escape');
  await page.getByTestId('assign-team').click();
  await expect(page.getByTestId('assigned')).toContainText('EV1 Elena');
  const st = await (await request.get('/api/station')).json();
  expect(st.assignments.pumpModule.team[0].name).toBe('Elena Voss');
  await page.waitForTimeout(3000);
  await shot(page, '09-station');
});

test('real time: a crew member who is well becomes critical, the alarm sounds, is raised again if still critical after the re-check, and closes by itself after recovery', async ({ page, request }) => {
  await request.post('/api/demo/reset');
  await page.addInitScript(fakeSpeech);
  await page.goto('/');
  await page.mouse.click(5, 300); // first interaction unlocks sound
  await page.getByTestId('critical-alert').first().getByTestId('alert-ack').click(); // the scenario alert
  await expect(page.getByTestId('critical-alerts')).toHaveCount(0);
  await request.post('/api/demo/alerts', { data: { recheckSeconds: 10 } }); // 3 minutes in normal use; 10 s for the test
  await page.getByTestId('nav-station').click(); // the alarm must reach any page
  const spoken = () => page.evaluate(() => (window as any).__spoken.join(' | '));

  // Elena is well; the automatic schedule starts an event for her in 2 s (short timings for the test)
  await request.post('/api/demo/episodes', { data: { enabled: true, firstDelaySeconds: 2, rampSeconds: 6, holdSeconds: 90, recoverSeconds: 6, intervalSeconds: 600 } });
  const alarm = page.getByTestId('critical-alert').filter({ hasText: 'Elena Voss' });
  await expect(alarm).toContainText('Heart rate critically high', { timeout: 30_000 });
  await expect(alarm.getByTestId('alert-trace')).toBeVisible({ timeout: 15_000 });
  await expect.poll(spoken, { timeout: 10_000 }).toContain('Critical alert. Elena Voss. Heart rate critically high.');
  await shot(page, '10-live-alarm');

  // acknowledged while still critical → checked again after the re-check delay → raised again
  await alarm.getByTestId('alert-ack').click();
  await expect(alarm).toHaveCount(0);
  await expect(page.getByTestId('recheck-chip')).toContainText('Re-check Elena');
  await expect(alarm).toContainText('Still critical', { timeout: 25_000 });
  await expect.poll(spoken, { timeout: 10_000 }).toContain('Critical alert, still active. Elena Voss. Heart rate critically high.');
  await shot(page, '11-live-raised-again');

  // the readings come back by themselves: the voice says so and the alert closes without anyone touching it
  await expect(alarm).toContainText('Back within range', { timeout: 120_000 });
  await expect.poll(spoken, { timeout: 10_000 }).toContain('Update. Elena Voss. Heart rate back within range.');
  await shot(page, '12-live-recovered');
  await expect(alarm).toHaveCount(0, { timeout: 30_000 });

  const tl = await (await request.get('/api/crew/voss/timeline')).json();
  expect(tl.map((e: any) => e.type)).toEqual(expect.arrayContaining(['critical_alert', 'alert_acknowledged', 'alert_repeated', 'alert_resolved']));
});

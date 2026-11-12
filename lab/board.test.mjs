// Board tests against a scripted stand-in for the incident API (no network).
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const ORIGIN = 'http://board.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const inc = (id, openedAt, extra = {}) => ({ id, service: 'booking-api', region: 'eu-central', summary: 'export job stuck', severity: 'sev2', openedAt, ...extra });
const BASE = [
  inc('INC-2', '2026-11-12T04:03:00.000Z'),
  inc('INC-1', '2026-11-11T03:11:00.000Z', { severity: 'sev3', summary: '<img src=x onerror="window.__xss=1"> late' }),
];
const LATE = inc('INC-3', '2026-11-12T04:11:06.000Z', { severity: 'sev1' });

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

/** Opens the board with a scripted API. `script(n)` gives the incidents for the n-th fetch (1-based). */
async function open({ script = () => BASE, delayMs = 0, ackStatus = 200, context = {} } = {}) {
  const ctx = await browser.newContext(context);
  const page = await ctx.newPage();
  const calls = { incidents: [], acks: [] };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    await route.fulfill({ contentType: TYPES[path.extname(file)], body: await readFile(path.join(APP, file)) });
  });
  await page.route('**/challenges/show-me-when/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.pathname.endsWith('/incidents')) {
      calls.incidents.push(url.searchParams.get('since'));
      const n = calls.incidents.length;
      if (delayMs && n === 1) await new Promise((r) => setTimeout(r, delayMs));
      return json(200, { updatedAt: new Date().toISOString(), incidents: script(n), cursor: `c${n}` });
    }
    calls.acks.push({ id: url.searchParams.get('id'), cursor: url.searchParams.get('cursor') });
    if (ackStatus !== 200) return json(ackStatus, { error: 'no' });
    return json(200, { id: url.searchParams.get('id'), ackedAt: '2026-11-12T04:12:00.000Z', receipt: 'mock-receipt' });
  });
  await page.goto(`${ORIGIN}/`);
  return { page, calls, close: () => ctx.close() };
}
const ids = (page) => page.locator('[data-testid="incident-row"]').evaluateAll((rows) => rows.map((r) => r.dataset.id));

test('R3: loader shows until incidents load, then is gone', async () => {
  const { page, close } = await open({ delayMs: 800 });
  await page.locator('[data-testid="loader"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid="incident-row"]').count(), 0);
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  assert.equal(await page.locator('[data-testid="loader"]').count(), 0);
  assert.equal(await page.locator('[data-testid="board"] [data-testid="incident-list"]').count(), 1);
  await close();
});

test('empty: shows only when there are no incidents', async () => {
  const { page, close } = await open({ script: (n) => (n === 1 ? [] : BASE) });
  await page.locator('[data-testid="empty"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid="loader"]').count(), 0);
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  assert.equal(await page.locator('[data-testid="empty"]').isVisible(), false);
  await close();
});

test('R1 + R4: a new incident appears at the top within one refresh, no reload', async () => {
  const { page, calls, close } = await open({ script: (n) => (n < 2 ? BASE : [LATE, ...BASE]) });
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  assert.deepEqual(await ids(page), ['INC-2', 'INC-1']);
  const kept = await page.locator('[data-id="INC-2"]').elementHandle();
  const t0 = Date.now();
  await page.locator('[data-id="INC-3"]').waitFor();
  assert.ok(Date.now() - t0 < 3500, 'refresh is about every 2 s');
  assert.deepEqual(await ids(page), ['INC-3', 'INC-2', 'INC-1']);
  assert.ok(await kept.evaluate((node) => node.isConnected), 'existing rows are moved, not rebuilt');
  assert.equal(calls.incidents[0], null);
  assert.equal(calls.incidents[1], 'c1', 'refresh goes through api.js and its cursor');
  await close();
});

test('R2: Ack asks first, naming the id; yes acks that incident with the latest cursor; the mark survives refreshes', async () => {
  const { page, calls, close } = await open({ script: (n) => (n < 2 ? BASE : [LATE, ...BASE]) });
  await page.locator('[data-id="INC-3"]').waitFor();
  assert.equal(await page.locator('[data-testid="ack"]').count(), 3);
  const sent = calls.incidents.length;
  await page.locator('[data-id="INC-2"] [data-testid="ack"]').click();
  assert.match(await page.locator('[data-testid="confirm"]:visible').innerText(), /INC-2/);
  assert.equal(await page.locator('[data-id="INC-2"] [data-testid="confirm"]').count(), 1, 'the confirm sits in its row');
  assert.equal(calls.acks.length, 0, 'nothing is acked before the yes');
  await page.locator('[data-testid="confirm-ack"]:visible').click();
  await page.locator('[data-id="INC-2"] [data-testid="acked"]').waitFor();
  assert.equal(await page.locator('[data-testid="confirm"]').count(), 0);
  assert.equal(calls.acks.length, 1);
  assert.equal(calls.acks[0].id, 'INC-2');
  assert.ok(Number(calls.acks[0].cursor.slice(1)) >= sent, 'ack carries the latest cursor');
  assert.equal(await page.locator('[data-id="INC-2"] [data-testid="ack"]').count(), 0);
  await page.waitForTimeout(4500);
  assert.equal(await page.locator('[data-testid="acked"]').count(), 1);
  assert.equal(await page.locator('[data-id="INC-2"] [data-testid="acked"]').count(), 1);
  assert.equal(calls.acks.length, 1);
  await close();
});

test('R2: a refused ack does not mark the row', async () => {
  const { page, close } = await open({ ackStatus: 409 });
  await page.locator('[data-id="INC-2"] [data-testid="ack"]').click();
  await page.locator('[data-testid="confirm-ack"]').click();
  await page.locator('[data-id="INC-2"] .ack-error').waitFor();
  assert.equal(await page.locator('[data-testid="acked"]').count(), 0);
  assert.equal(await page.locator('[data-id="INC-2"] [data-testid="ack"]').isEnabled(), true);
  await close();
});

test('confirm: Cancel and Escape ack nothing and give the Ack button back', async () => {
  const { page, calls, close } = await open();
  const ackButton = page.locator('[data-id="INC-2"] [data-testid="ack"]');
  await ackButton.click();
  assert.equal(await ackButton.isVisible(), false);
  await page.locator('[data-testid="confirm-cancel"]').click();
  assert.equal(await page.locator('[data-testid="confirm"]').count(), 0);
  assert.equal(await ackButton.isVisible(), true);
  await ackButton.click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-testid="confirm"]').count(), 0);
  await page.waitForTimeout(2500);
  assert.equal(calls.acks.length, 0);
  assert.equal(await page.locator('[data-testid="acked"]').count(), 0);
  await close();
});

test('the race product saw: a press where the meant row was opens a confirm naming the row that moved in; nothing is acked', async () => {
  const { page, calls, close } = await open({ script: (n) => (n < 2 ? BASE : [LATE, ...BASE]) });
  const box = await page.locator('[data-id="INC-2"] [data-testid="ack"]').boundingBox();
  const at = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(...at);
  await page.evaluate(() => { window.__gone = 0; new MutationObserver((rs) => { for (const r of rs) for (const n of r.removedNodes) if (n.matches?.('[data-testid="incident-row"]')) window.__gone += 1; }).observe(document, { childList: true, subtree: true }); });
  await page.locator('[data-id="INC-3"]').waitFor();
  await page.mouse.click(...at); // meant INC-2; INC-3 is under the pointer now
  assert.match(await page.locator('[data-testid="confirm"]:visible').innerText(), /INC-3/);
  assert.doesNotMatch(await page.locator('[data-testid="confirm"]:visible').innerText(), /INC-2/);
  await page.mouse.click(...at); // a second press on the same spot
  assert.equal(calls.acks.length, 0, 'two presses on one spot never ack');
  // On-call reads the id, and picks the row they meant; only one confirm is ever open.
  await page.locator('[data-id="INC-2"] [data-testid="ack"]').click();
  assert.equal(await page.locator('[data-testid="confirm"]').count(), 1);
  await page.locator('[data-id="INC-3"] [data-testid="ack"]').click();
  assert.equal(await page.locator('[data-testid="confirm"]').count(), 1);
  await page.locator('[data-testid="confirm-cancel"]').click();
  await page.locator('[data-id="INC-2"] [data-testid="ack"]').click();
  await page.locator('[data-testid="confirm-ack"]:visible').click();
  await page.locator('[data-id="INC-2"] [data-testid="acked"]').waitFor();
  assert.deepEqual(calls.acks.map((a) => a.id), ['INC-2']);
  assert.equal(await page.evaluate(() => window.__gone), 0, 'no row left the board while it changed');
  await close();
});

for (const [locale, timezoneId, newest, oldest] of [
  ['de-DE', 'Europe/Berlin', /^12\.11\.2026, 05:03$/, /^11\.11\.2026, 04:11$/],
  ['en-NZ', 'Pacific/Auckland', /^12\/11\/2026, 05:03\s?pm$/i, /^11\/11\/2026, 04:11\s?pm$/i],
  ['en-US', 'America/Los_Angeles', /^11\/11\/2026, 08:03\s?PM$/, /^11\/10\/2026, 07:11\s?PM$/],
]) {
  test(`R5: local time and local order for ${locale} in ${timezoneId}`, async () => {
    const { page, close } = await open({ context: { locale, timezoneId } });
    const time = (id) => page.locator(`[data-id="${id}"] time`);
    await time('INC-2').waitFor();
    assert.match(await time('INC-2').textContent(), newest);
    assert.match(await time('INC-1').textContent(), oldest);
    assert.equal(await time('INC-2').getAttribute('datetime'), '2026-11-12T04:03:00.000Z');
    await close();
  });
}

test('R6: meta build and footer build-sha carry the same value', async () => {
  const { page, close } = await open();
  const meta = await page.locator('meta[name="build"]').getAttribute('content');
  assert.ok(meta);
  assert.equal(await page.locator('[data-testid="build-sha"]').textContent(), meta);
  await close();
});

test('API text is shown as text, never run as HTML', async () => {
  const { page, close } = await open();
  await page.locator('[data-id="INC-1"]').waitFor();
  assert.equal(await page.locator('[data-id="INC-1"] img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.match(await page.locator('[data-id="INC-1"] .what').textContent(), /<img src=x/);
  await close();
});

// Step 2: records the same moment as step 1 on the new build. On-call means the top incident, presses
// Ack where it is as a new incident lands, reads the confirm, cancels the wrong one, and acks the one
// they meant.   node lab/record-step2.mjs <board url> <out dir>
import { chromium } from 'playwright';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const [url, outDir] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const size = { width: 1280, height: 720 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;z-index:9999;width:18px;height:18px;margin:-9px 0 0 -9px;border:3px solid #d00;border-radius:50%;pointer-events:none;left:-99px;top:-99px';
    document.body.append(ring);
    addEventListener('mousemove', (e) => { ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`; }, true);
  });
});
const t0 = Date.now();
const page = await context.newPage();
const events = [];
const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const note = (what, data = {}) => { const ms = Date.now() - t0; events.push({ at: mmss(ms), ms, what, ...data }); console.log(mmss(ms), what, JSON.stringify(data)); };
const acks = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/api/ack')) acks.push(u.searchParams.get('id')); });
const rowIds = () => page.locator('[data-testid="incident-row"]').evaluateAll((rows) => rows.map((r) => r.dataset.id));
const confirmText = () => page.locator('[data-testid="confirm"]:visible').innerText();

await page.goto(url);
await page.locator('[data-testid="incident-row"]').first().waitFor();
const first = await rowIds();
const build = await page.locator('meta[name="build"]').getAttribute('content');
const meant = first[0];
note('open-board: list on screen', { rows: first.length, top: meant, build, footer: await page.locator('[data-testid="build-sha"]').textContent() });
const box = await page.locator(`[data-id="${meant}"] [data-testid="ack"]`).boundingBox();
const aim = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
await page.mouse.move(...aim, { steps: 12 });
await page.waitForTimeout(1500);
note('pointer on Ack of the incident on-call means', { meant });

await page.waitForFunction((n) => document.querySelectorAll('[data-testid="incident-row"]').length > n, first.length, { timeout: 45000, polling: 'raf' });
await page.mouse.click(...aim); // same spot, as a new incident lands
const second = await rowIds();
const arrived = second.find((id) => !first.includes(id));
const asked = await confirmText();
note('pressed Ack as a new incident landed; the board asks first', { meant, arrived, confirmSays: asked, acksSent: acks.length });
await page.waitForTimeout(2500); // on-call reads the id
await page.locator('[data-testid="confirm-cancel"]:visible').click();
note('cancelled: the confirm named another incident', { acksSent: acks.length, confirms: await page.locator('[data-testid="confirm"]').count() });
await page.waitForTimeout(800);
await page.locator(`[data-id="${meant}"] [data-testid="ack"]`).hover();
await page.waitForTimeout(600);
await page.locator(`[data-id="${meant}"] [data-testid="ack"]`).click();
const asked2 = await confirmText();
note('pressed Ack on the meant row; the confirm names it', { confirmSays: asked2 });
await page.waitForTimeout(1500);
const [res] = await Promise.all([
  page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/api/ack'), { timeout: 15000 }),
  page.locator('[data-testid="confirm-ack"]:visible').click(),
]);
const body = await res.text();
await writeFile(path.join(outDir, 'ack-reply.json'), body);
const reply = JSON.parse(body);
await page.locator(`[data-id="${meant}"] [data-testid="acked"]`).waitFor();
note('confirmed: the meant incident is acked', { meant, acked: reply.id, status: res.status(), ackedAt: reply.ackedAt, acksSent: acks });
await page.waitForTimeout(6000);
const last = await rowIds();
note('watch-board: still live after the ack', { rows: last.length, top: last[0], ackedMarks: await page.locator('[data-testid="acked"]').count(), wrongRowAcked: await page.locator(`[data-id="${arrived}"] [data-testid="acked"]`).count() });

const video = page.video();
await context.close();
const file = path.join(outDir, 'recording.webm');
await rename(await video.path(), file);
await browser.close();
if (reply.id !== meant || acks.length !== 1 || !asked.includes(arrived) || asked.includes(meant) || !asked2.includes(meant)) throw new Error('run did not show the decision working');
await writeFile(path.join(outDir, 'run.json'), JSON.stringify({ url, build, meant, arrived, asked, asked2, acked: reply.id, acksSent: acks, events }, null, 2));
console.log('ok', file);

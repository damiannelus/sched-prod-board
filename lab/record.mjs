// Drives a deployed board like on-call would, records it, and writes what happened with offsets
// from the start of the video. The video is captured from the real page; the only thing added for
// the lab is a ring that shows where the pointer is (Playwright videos have no cursor).
//
//   node lab/record.mjs <board url> <out dir> [--ack]
//
// Without --ack it is a dry run: everything except the click on Ack.
import { chromium } from 'playwright';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const [url, outDir, flag] = process.argv.slice(2);
if (!url || !outDir) throw new Error('usage: node lab/record.mjs <board url> <out dir> [--ack]');
const doAck = flag === '--ack';
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
const note = (what, data = {}) => {
  const ms = Date.now() - t0;
  events.push({ at: mmss(ms), ms, wall: new Date().toISOString(), what, ...data });
  console.log(mmss(ms), what, JSON.stringify(data));
};

let polls = 0;
const ackReplies = [];
page.on('response', async (res) => {
  const u = new URL(res.url());
  if (u.pathname.endsWith('/api/incidents')) polls += 1;
  if (u.pathname.endsWith('/api/ack')) {
    const body = await res.text();
    ackReplies.push({ status: res.status(), id: u.searchParams.get('id'), body });
  }
});

const rowIds = () => page.locator('[data-testid="incident-row"]').evaluateAll((rows) => rows.map((r) => r.dataset.id));
const under = (x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, [x, y]);

await page.goto(url);
note('open-board: page requested', { loaderVisible: await page.locator('[data-testid="loader"]').isVisible().catch(() => false) });
await page.locator('[data-testid="incident-row"]').first().waitFor();
const first = await rowIds();
note('open-board: incidents on screen, loader gone', { rows: first.length, top: first[0], loaderCount: await page.locator('[data-testid="loader"]').count() });
const build = await page.locator('meta[name="build"]').getAttribute('content');
const footer = await page.locator('[data-testid="build-sha"]').textContent();
const times = await page.locator('[data-testid="incident-row"] time').evaluateAll((ts) => ts.map((t) => ({ shown: t.textContent, datetime: t.getAttribute('datetime') })));
note('build and times read', { build, footer, newestTime: times[0], oldestTime: times.at(-1) });

// On-call aims at the Ack of the incident that is at the top right now.
const aimed = first[0];
const box = await page.locator(`[data-id="${aimed}"] [data-testid="ack"]`).boundingBox();
const aim = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
await page.mouse.move(aim.x, aim.y, { steps: 12 });
note('ack-incident: pointer rests on Ack of the top incident, not clicked', { aimed, pointerOver: await under(aim.x, aim.y) });

// watch-board: wait for the board to change by itself.
const pollsBefore = polls;
await page.waitForFunction((n) => document.querySelectorAll('[data-testid="incident-row"]').length > n, first.length, { timeout: 45000 });
const second = await rowIds();
const arrived = second.find((id) => !first.includes(id));
const nowUnder = await under(aim.x, aim.y);
note('watch-board: a new incident arrived at the top without a reload', { arrived, rows: second.length, top: second[0], pollsSinceAim: polls - pollsBefore, pointerDidNotMove: true, pointerNowOver: nowUnder, aimedWas: aimed });
await page.waitForTimeout(2500);

let reply = null;
const target = arrived;
if (doAck) {
  await page.locator(`[data-id="${target}"] [data-testid="ack"]`).hover();
  await page.waitForTimeout(800);
  // Take the ack's answer from the network before anything else can race it.
  const [res] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/api/ack'), { timeout: 15000 }),
    page.locator(`[data-id="${target}"] [data-testid="ack"]`).click(),
  ]);
  note('ack-incident: clicked Ack', { target });
  const raw = { status: res.status(), body: await res.text() };
  await writeFile(path.join(outDir, 'ack-reply.json'), raw.body);
  reply = JSON.parse(raw.body);
  await page.locator(`[data-id="${target}"] [data-testid="acked"]`).waitFor({ timeout: 15000 });
  note('ack-incident: row marked acked', { target, status: raw.status, repliedId: reply.id, ackedAt: reply.ackedAt, receiptLength: String(reply.receipt).length, markText: await page.locator(`[data-id="${target}"] [data-testid="acked"]`).textContent() });
} else {
  await page.locator(`[data-id="${target}"] [data-testid="ack"]`).hover();
  note('dry run: hovered Ack, did not click', { target });
}

// Keep watching: the board keeps refreshing and the mark holds.
const pollsAtAck = polls;
await page.waitForTimeout(7000);
const last = await rowIds();
note('watch-board: still current after more refreshes', { rows: last.length, top: last[0], refreshes: polls - pollsAtAck, ackedMarks: await page.locator('[data-testid="acked"]').count(), ackButtons: await page.locator('[data-testid="ack"]').count() });

const video = page.video();
await context.close();
const end = Date.now();
const file = path.join(outDir, 'recording.webm');
await rename(await video.path(), file);
await browser.close();
await writeFile(path.join(outDir, 'run.json'), JSON.stringify({ url, build, footer, startedAt: new Date(t0).toISOString(), lengthMs: end - t0, polls, events, ackReplies, receipt: reply?.receipt ?? null, video: file }, null, 2));
console.log('video', file, 'length', mmss(end - t0), 'polls', polls, 'acks', ackReplies.length);

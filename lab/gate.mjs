// Read-only gate for a report file before it is claimed. Exits 1 on the first thing that does not hold.
//   node lab/gate.mjs <step 1|2> <report.md> <board url> [ack-reply.json]
import { readFile } from 'node:fs/promises';

const [step, reportPath, url, ackPath] = process.argv.slice(2);
const report = await readFile(reportPath, 'utf8');
const fails = [];
const check = (name, ok, shown = '') => { console.log(ok ? 'ok  ' : 'FAIL', name, shown); if (!ok) fails.push(name); };
const mask = (s) => `${String(s).slice(0, 8)}•••• (len ${String(s).length})`;

const sections = step === '1' ? ['## What you checked', '## When', '## Where', '## Options for product'] : ['## System Diff'];
for (const s of sections) check(`section ${s}`, new RegExp(`^${s}\\s*$`, 'm').test(report));
check('report size <= 64 KB', Buffer.byteLength(report) <= 64 * 1024, `${Buffer.byteLength(report)} bytes`);

const blocks = [...report.matchAll(/^```evidence\n([\s\S]*?)\n```\s*$/gm)];
check('exactly one evidence block', blocks.length === 1, `found ${blocks.length}`);
let ev = {};
try { ev = JSON.parse(blocks[0][1]); check('evidence is JSON', true); } catch (e) { check('evidence is JSON', false, e.message); }

const live = await fetch(url, { cache: 'no-store' });
const html = await live.text();
const meta = html.match(/<meta name="build" content="([^"]+)"/)?.[1];
const footer = html.match(/data-testid="build-sha">([^<]+)</)?.[1];
check('board url is https and answers 200', url.startsWith('https://') && live.status === 200, `${live.status}`);
check('evidence.sha = live meta build = live footer', /^[0-9a-f]{40}$/.test(ev.sha ?? '') && ev.sha === meta && ev.sha === footer, `${ev.sha} / ${meta} / ${footer}`);
for (const hook of ['board', 'incident-list']) check(`live page has hook ${hook}`, html.includes(`data-testid="${hook}"`));

check('evidence.videoLink is https', /^https:\/\//.test(ev.videoLink ?? ''), ev.videoLink);
const video = await fetch(ev.videoLink, { headers: { range: 'bytes=0-15' } });
const head = Buffer.from(await video.arrayBuffer());
check('videoLink serves the file itself', video.ok && head.subarray(4, 8).toString() === 'ftyp', `${video.status} ${video.headers.get('content-type')} magic=${head.subarray(4, 8)}`);

if (step === '1') {
  check('evidence.flow is a plan flow', ['open-board', 'ack-incident', 'watch-board'].includes(ev.flow), ev.flow);
  check('evidence.at is mm:ss', /^\d\d:[0-5]\d$/.test(ev.at ?? ''), ev.at);
  check('report names that moment under ## When', report.split('## When')[1]?.split('## Where')[0]?.includes(ev.at));
  const ack = JSON.parse(await readFile(ackPath, 'utf8'));
  check('evidence.receipt = the recorded ack reply, whole', typeof ack.receipt === 'string' && ev.receipt === ack.receipt, mask(ev.receipt));
  check('ack reply is for the incident the report names', report.includes(ack.id), `${ack.id} ackedAt ${ack.ackedAt}`);
  check('evidence has exactly the five fields', Object.keys(ev).sort().join() === 'at,flow,receipt,sha,videoLink', Object.keys(ev).join());
} else {
  check('evidence.runUrl is an Actions run (when present)', ev.runUrl === undefined || /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(ev.runUrl), ev.runUrl ?? 'absent');
}
console.log(fails.length ? `GATE RED: ${fails.length} failed` : 'GATE GREEN');
process.exit(fails.length ? 1 : 0);

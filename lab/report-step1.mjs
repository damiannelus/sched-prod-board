// Writes the step-1 report from the recorded run. The receipt is copied from the ack's own reply,
// never retyped.   node lab/report-step1.mjs <run dir> <video link> <mm:ss of the ack in the video>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [dir, videoLink, at] = process.argv.slice(2);
const run = JSON.parse(await readFile(path.join(dir, 'run.json'), 'utf8'));
const ack = JSON.parse(await readFile(path.join(dir, 'ack-reply.json'), 'utf8'));
const repo = 'https://github.com/damiannelus/sched-prod-board/blob/' + run.build;

const report = `## What you checked

I opened the deployed board (${run.url}, build \`${run.build}\`) in a recorded Chromium session (locale pl-PL, Europe/Warsaw) and used it as on-call would. The recording is of the live page; the only thing the lab adds is a red ring that marks the pointer.

- **open-board:** a loader showed, then 8 incidents, newest first (INC-6826 on top). Times were in local time, day before month (\`12.11.2026, 05:10\`); the footer named the build.
- **watch-board:** I rested the pointer on the **Ack** of the top incident, INC-6826, and did not click. With no reload, INC-6466 (sev1) arrived at the top. Every row moved down one place, so the unmoved pointer was now on the **Ack** of INC-6466, a different incident from the one I aimed at.
- **ack-incident:** I clicked **Ack** on INC-6466. The ack API answered 200 for INC-6466 and the row showed \`acked 05:18:42\`. The mark held through 4 more refreshes.
- **watch-board, again:** INC-5279 then arrived at the top and moved the rows once more. The pointer, still unmoved, ended on the live **Ack** of INC-5279.

What works: all four issues (SCHED-4511 to 4514) behave as the plan says. What I would not ship without a decision: R1 puts each new incident at the top the moment it arrives, so the row under the pointer changes while on-call aims at **Ack** (R2). A click made in that instant acks the wrong incident, and the ack API has no undo.

Not in the recording: the Berlin, Auckland and US date orders (covered by the tests in \`lab/board.test.mjs\`), and a wrong ack itself — I did not make one on purpose.

## When

- 00:00 loader, then the list of 8 within the first second
- 00:08 INC-6466 arrives at the top; the pointer is now over a different incident's Ack
- ${at} Ack on INC-6466 is answered and the row is marked acked (this is the moment in the evidence block)
- 00:18 INC-5279 arrives; rows move again under the pointer

## Where

- \`app/app.js:90\` — \`list.insertBefore(row, before)\` puts a new incident at the top at once (R1). This line is what moves the rows under the pointer. ${repo}/app/app.js#L90
- \`app/app.js:117\` with \`app/app.js:3\` — the board refreshes 2 s after each answer (R4).
- \`app/app.js:52\` — \`await ack(id)\` sends the ack through \`app/api.js\` with the latest cursor, then marks the row (R2).
- \`app/app.js:109\` — the loader is removed once incidents load (R3).
- \`app/app.js:17\` — local time and local day/month order (R5).
- \`app/index.html:6\` and the footer — the build sha (R6).

## Options for product

The plan asks for two things that work against each other: new incidents at the top at once (R1) and a one-click Ack on each row (R2).

1. **Keep the plan as written.** New incidents push the list down the moment they arrive. Nothing to build. On-call can ack the wrong incident, and it cannot be undone.
2. **Hold the list while on-call is aiming (recommended).** While the pointer or keyboard focus is on the list, new incidents wait behind a "1 new incident" bar at the top and join the list on a click or when the pointer leaves. Rows never move under a click. Cost: a new incident is announced, not yet in the list, for as long as on-call is aiming.
3. **Keep the live insert, guard the click.** Rows still move, but Ack is ignored for a short time after the list changes (about half a second) and the button names its incident ("Ack INC-6466"). Smaller change; a slow wrong click is still possible.

I recommend option 2, because it removes the wrong ack and still shows that something new came in. The decision is product's.

\`\`\`evidence
${JSON.stringify({ flow: 'ack-incident', at, receipt: ack.receipt, sha: run.build, videoLink }, null, 2)}
\`\`\`
`;
await writeFile(path.join(dir, 'report-step1.md'), report);
console.log('written', path.join(dir, 'report-step1.md'), report.length, 'chars');

// Writes the step-1 report from the recorded run. The receipt is copied from the ack's own reply,
// never retyped.   node lab/report-step1.mjs <run dir> <video link> <mm:ss of the ack in the video>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [dir, videoLink, at] = process.argv.slice(2);
const run = JSON.parse(await readFile(path.join(dir, 'run.json'), 'utf8'));
const ack = JSON.parse(await readFile(path.join(dir, 'ack-reply.json'), 'utf8'));
const pressed = run.events.find((e) => e.meant && e.arrived);
const went = run.events.find((e) => e.acked);
if (went.acked !== ack.id || pressed.arrived !== ack.id || pressed.meant === ack.id) throw new Error('run does not show a wrong ack');
const repo = 'https://github.com/damiannelus/sched-prod-board/blob/' + run.build;

const report = `## What you checked

I opened the deployed board (${run.url}, build \`${run.build}\`) in a recorded Chromium session (locale pl-PL, Europe/Warsaw) and used it as on-call would. A script drives the pointer; the recording is of the live page, and the only thing the lab adds is a red ring that marks the pointer.

- **open-board:** a loader showed, then 8 incidents, newest first, with ${pressed.meant} on top. Times were in local time, day before month; the footer named the build.
- **ack-incident, the row I meant:** I meant to ack **${pressed.meant}**, the top incident. I put the pointer on its **Ack** button and pressed it where it was.
- **What the board did:** in that same moment ${ack.id} (sev1) landed at the top with no reload and every row moved down one place. The press, at the same spot, hit the **Ack** of **${ack.id}**. The ack API answered ${went.status} for ${ack.id}, and the board marked ${ack.id} \`${went.markText}\`.
- **Result:** I acked ${ack.id}, which I did not mean, and ${pressed.meant}, which I meant, is still not acked. The board showed no warning, and the ack API has no undo.
- **watch-board:** the board stayed current through ${run.events.at(-1).refreshes} more refreshes without a reload, and the mark held.

All four issues (SCHED-4511 to 4514) behave as the plan says. The misbehaviour comes from the plan itself: R1 puts each new incident at the top the moment it arrives, so the row under the pointer changes while on-call presses **Ack** (R2).

Not in the recording: the Berlin, Auckland and US date orders (covered by the tests in \`lab/board.test.mjs\`).

## When

- 00:00 loader, then the list of 8 within the first second
- 00:02 pointer on the Ack of ${pressed.meant}, the row I meant
- ${at} ${ack.id} lands at the top and the press acks ${ack.id} instead of ${pressed.meant} (this is the moment in the evidence block)
- ${at} to the end: ${ack.id} shows as acked, ${pressed.meant} does not

## Where

- \`app/app.js:90\` — \`list.insertBefore(row, before)\` puts a new incident at the top at once (R1). This line moves the rows under the pointer. ${repo}/app/app.js#L90
- \`app/app.js:52\` — \`await ack(id)\` acks the incident of whichever row received the click (R2), through \`app/api.js\` with the latest cursor.
- \`app/app.js:117\` with \`app/app.js:3\` — the board refreshes 2 s after each answer (R4).

## Options for product

The plan asks for two things that work against each other: new incidents at the top at once (R1) and a one-click Ack on each row (R2).

1. **Keep the plan as written.** New incidents push the list down the moment they arrive. Nothing to build. On-call can ack the wrong incident, as in this recording, and it cannot be undone.
2. **Hold the list while on-call is aiming (recommended).** While the pointer or keyboard focus is on the list, new incidents wait behind a "1 new incident" bar at the top and join the list on a click or when the pointer leaves. Rows never move under a click. Cost: a new incident is announced, not yet in the list, for as long as on-call is aiming.
3. **Keep the live insert, guard the click.** Rows still move, but Ack is ignored for a short time after the list changes (about half a second) and the button names its incident ("Ack ${ack.id}"). Smaller change; a slow wrong click is still possible.

I recommend option 2, because it removes the wrong ack and still shows that something new came in. The decision is product's.

\`\`\`evidence
${JSON.stringify({ flow: 'ack-incident', at, expected: pressed.meant, got: ack.id, receipt: ack.receipt, sha: run.build, videoLink }, null, 2)}
\`\`\`
`;
await writeFile(path.join(dir, 'report-step1.md'), report);
console.log('written', path.join(dir, 'report-step1.md'), report.length, 'chars');

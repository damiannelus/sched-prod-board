# sched-prod incident board — plan

The on-call board for sched-prod. One page, one list: tonight's incidents, newest first, so on-call sees
what just broke and takes it.

## Flows

| flow | who | what happens |
|------|-----|--------------|
| `open-board` | on-call | opens the board; sees tonight's incidents |
| `ack-incident` | on-call | picks an incident on the board, confirms the incident id the board names, and acks it — "I've got this one" |
| `watch-board` | on-call | keeps the board open; it stays current without a reload |

## Requirements

- **R1** New incidents appear live at the top of the list, newest first.
- **R2** Each incident row has an **Ack** button. Ack asks to confirm first, and the confirm names the incident id. Only the confirm's yes sends the ack (`api.ack(id)`) and marks the row acked; cancel sends nothing. *(Changed 2026-11-12 by product's decision, see Decisions.)*
- **R3** Show a loader until incidents load.
- **R4** The board refreshes itself every 2 seconds while open.
- **R5** Times show in the viewer's local time; day before month for EU locales (dd/mm).
- **R6** The page names its build: `<meta name="build" content="<git sha>">` in the head and the same sha in the footer.

## Hooks (pinned — tests and the replay rely on them)

| `data-testid` | element |
|---------------|---------|
| `board` | the board's main area |
| `loader` | the loader (gone once incidents load) |
| `empty` | what shows when there are no incidents |
| `incident-list` | the list |
| `incident-row` | one incident row, with `data-id="<incident id>"` |
| `ack` | the Ack button in a row |
| `acked` | the acked mark in a row |
| `confirm` | the confirm in a row, naming the incident id (one open at a time) |
| `confirm-ack` | the yes in the confirm; sends the ack |
| `confirm-cancel` | the cancel in the confirm; sends nothing |
| `build-sha` | the sha in the footer |

## Decisions

- **2026-11-12, product — Ack asks to confirm.** The step-1 recording showed a press meant for INC-6826 acking INC-6466, because a new incident landed at the top (R1) as on-call pressed Ack (R2). Product's answer: "New incidents stay live at the top and Ack stays on the row, but Ack asks to confirm, and the confirm names the incident id." R1 and R4 are unchanged; R2 changed as above. The report had recommended holding new incidents behind a bar instead; product chose the confirm, and that is what is built.

## Done

Every issue in `issues/` delivered, deployed to a public https address, and shown working.

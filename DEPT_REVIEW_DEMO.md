# 🎬 Dept Review V1 — 5-minute demo checklist

A ready-to-run walkthrough for showing the feature to HR/management. Assumes the
local stack is up per `LOCAL_RUN_GUIDE.md` (server :5501, client :5173) and at
least one department has a head + a few tasks.

## Cast
| Browser profile | Login | Plays |
|---|---|---|
| Window A | `owner@company.local` / `Owner@12345` | HR / management (👑) |
| Window B | any member who heads a space | Department head |

## Act 1 — Departments have heads (1 min)
1. **A:** open any Space → the **Department head** card sits on the space page.
2. Assign/change the head from the dropdown (only active non-guest members are offered).
3. Point out: heads get a **Department** item in their sidebar; nobody else sees it.

## Act 2 — The head reviews work (2 min)
4. **B:** sidebar → **Department** → the summary tiles + member rollup (per-assignee open / done-unreviewed / approved / flagged / overdue).
5. Switch to the queue tabs: **Needs review** (done tasks awaiting a verdict), **Flagged**, **Overdue**, **Due today**.
6. **Approve** one task inline; **Flag** another with a note (e.g. "needs another pass").
7. Open the flagged task → the **Department review** section inside the task drawer shows the verdict badge, the note, and the review history.
8. Point out: the assignee just got a `task_reviewed` notification carrying the note (check in their inbox); reviewing your own task notifies nobody.

## Act 3 — HR gets the weekly report (2 min)
9. Reports generate **automatically every Monday 09:00 (Dhaka)** for last week — for the demo, generate one now: `POST /api/v1/reports/generate {"space_id": …}` as the head/admin (or `cd server && npm run job -- department-report`).
10. **A:** the bell shows **"Weekly report ready: <dept>"** → click → the report detail:
    - Totals with **vs-last-week arrows**, late completions, overdue-now
    - **Member matrix** (per person; Unassigned last; deactivated greyed)
    - **Flags this week** with notes + who flagged + task links
    - **Head activity** line (reviews done, self-reviewed transparency)
11. Click **Mark seen** → the chip flips to *Seen by <name>* — first acknowledger sticks, so HR knows who processed it.
12. **B:** open the same report → add the **head's note** (context for HR). **A:** refresh — the note is there, read-only.
13. Bonus: **Regenerate** refreshes numbers but *keeps* the note + Seen status and never re-notifies; the chip flips to **Updated after ack** so HR knows to re-read. Print (Ctrl+P) — the page prints clean without app chrome.

## One-liners if asked
- "Who can see what?" — HR (owner/admin) sees every department; a head sees only their own; members see nothing of `/dept` or `/reports`.
- "What if a head leaves?" — deactivating them clears the headship; old reports keep their name as the head-of-record; the department keeps reporting (headless) until a new head is assigned.
- "Is it automatic?" — yes: weekly cron + one-week self-heal + skip-if-dormant; on-demand regenerate any past week.

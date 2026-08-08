# PHASE 35 — Frontend views (List / Board / Calendar / Form)

**Status:** PARTIAL — structure and rendering verified in a real browser; interaction (drag-and-drop,
virtualisation, WIP limits) not exercised — §6
**Methods:** UI (Chrome, `localhost:5173` against the dev API on `:5501`)
**Issues filed:** none new — **visually confirmed ISS-057 and ISS-066**
**Data left behind:** none — the browser session made no writes.

---

## 1. The view switcher

All four tabs exist on a list and switch correctly: **List · Board · Calendar · Form**. The
`:viewId` route param works — switching to Calendar pushed
`/s/:spaceId/l/:listId/calendar`, and the deep link reloads to the same view.

Fixture used: **Marketing → Eid Campaign 2026**, 8 tasks, the busiest list in the seed.

## 2. List view — renders correctly

Verified on screen: grouping **by Status** into the list's five status groups with per-group counts
(To Do 2 · In Progress 1 · In Review 0 · Done 3 · Closed 0), a per-group **"Add task in <status>"**
row, and the toolbar carrying **Group · Filter · Sort (Default order) · Show closed · Me Mode** plus
an in-list search box and a column-config control.

Each row shows a priority flag, the task name, a status pill, a due-date chip (red with a clock icon
when overdue — Jul 24/25/26 against a Jul 30 "today", correctly styled) and assignee avatars.

**Inline edit is real:** clicking a task name turns the row into an editable input in place (this is
what happened when I first tried to open the drawer). Escape exits it.

Empty groups render an explicit "Add task in …" affordance rather than collapsing, so the board's
shape stays legible.

## 3. Board view — renders correctly

Five columns generated from the list's statuses, each with a coloured dot, a name, a count, a `+`
and an overflow menu. Cards carry the task-type label, priority flag, name, due-date chip and
assignee avatars. Empty columns show a **"Drop tasks here"** placeholder, which is the drag target.
The toolbar offers **Swimlanes (No swimlanes)**, Filter, Show closed, a card-density toggle and
search.

## 4. Calendar view — renders correctly, and localised

A month grid for July 2026 with **Today / ‹ / › / Month / Week / Day** controls. Tasks appear on
their due dates (24th, 25th, 26th), today (30) is circled, and adjacent-month days are dimmed.

An **Unscheduled** side panel reads *"2 tasks without dates · drag to schedule"* and lists exactly
the two dateless tasks — matching the list view.

Worth recording as a quality point: **the week starts on Saturday** (SAT SUN MON TUE WED THU FRI),
which is the correct working week for Bangladesh.

## 5. The task drawer — complete

Opened via `?task=<id>`. Everything the earlier API phases described is present and correct:

| section | state |
|---|---|
| Status / Priority / Assignees / Start date / Due date / Estimate / Time tracked / Recurrence / Tags / Watchers | all rendered, all inline-editable affordances |
| **Department Review** | *"Review opens once the task reaches a done status."* — the P31 `review.not_completed` rule, surfaced as UI copy |
| Description | real content |
| **Checklists** | "Design deliverables **1/4**" with a progress bar, completed items struck through — the client-side computation from P22 §6, and it is correct |
| footer | "Created by Owner User · Jul 23, 2026 · **T-1**" |

That **`T-1`** is the visual confirmation of **ISS-066**: this is the identifier a user reads and
would type as `#T-1`, and it resolves to nothing because references only match `custom_id`.

## 6. Deferred (rule R10)

| item | why |
|---|---|
| drag between board columns; drop-on-self, drop-outside, cancel mid-drag, rapid drags | the drag surface needs a scripted harness; `left_click_drag` against a virtualised dnd-kit board is not a faithful test |
| drag-to-schedule from the Unscheduled panel | same |
| WIP limits and swimlanes in action | need a list configured with limits |
| large-list scroll and virtualisation (200+ tasks) | needs a seeded large list; also relates to **P40** |
| Form view rendering and submission | the API side is covered in P26; the render is unverified |
| multi-select and the bulk toolbar | the API side is covered in P20 §3 |

All of these are the same gap `STATUS.md` flags: there is no Playwright harness, and driving them
one screenshot at a time would produce weak evidence. They belong in one scripted UI pass.

## 7. Coverage vs the plan

4 of the 7 checklist lines are substantially covered (the four views' rendering, view switching plus
the `:viewId` param, and the drawer). Three are deferred above.

What the browser confirmed beyond rendering: **ISS-057** is exactly as described — all six KPI cards
show a permanent "— 0.0%", and the Open Team Tasks card displays **31** above a sparkline whose seven
points sum to 4. That is the clearest possible evidence for that issue.

**Evidence:** screenshots taken in-session (List, Board, Calendar, drawer, KPI zoom).

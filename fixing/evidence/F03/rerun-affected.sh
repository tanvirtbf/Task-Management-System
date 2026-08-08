#!/usr/bin/env bash
# F3 — re-run the modules the clock fix touches, against the FINAL code.
#
# Why this exists: the big sweep (jest-sweep.txt) started before the last F3
# edits landed (the `ymd` split, the on-call CURDATE change, the OnCallService
# week_end fix, and the DATE-fixture repairs). ts-jest compiles per file at
# require time, so a module already running had loaded the older source — its
# result is evidence about neither tree. These modules are re-run cleanly.
#
# Uses the repo's own per-module configs (jest.<m>.config.cjs); each pins its own
# private database, which is what keeps them from colliding.
#
# RUN THIS ALONE. Two concurrent jest invocations on this box make `resetTestDb()`
# blow its 5s beforeEach hook timeout and every test in the suite fails with no
# assertion involved — it looks exactly like a catastrophic regression and is not
# one. One at a time, serially, is the only reliable way to read the result.
set -u
cd "$(dirname "$0")/../../../server" || exit 1
OUT="../fixing/evidence/F03/rerun-affected.txt"

{
  echo "F3 — re-run of the clock-affected modules against final code"
  echo "started $(date -Is)"
  echo "clock frame: DB_TIMEZONE=+00:00, TZ=${TZ:-Asia/Dhaka}"
  echo
} > "$OUT"

# tasks/tasks10 — toDateOnly, storedDateYmd, the dhakaToday my-work buckets, computeSlaDueAt
# sla           — ISS-081; UTC_TIMESTAMP comparisons
# oncall        — CURDATE -> dhakaToday, OnCallService week_end, onCallSerializer, 4 fixture files
# eng           — findCurrentOnCallEngineerId + EngineeringService.ymd
# collab        — the 15-minute comment edit window (ISS-063)
# sprints       — toDateOnly + sprintSerializer.formatWireDate + the makeSprint fixture
# deptreview    — dhakaToday in ReviewsService, the Dhaka week math, helpers.ts fixture
# home          — HomeService's own "today" (deliberately unchanged — guards against drift)
# jobs          — departmentReport / snoozeWake / the expiry sweepers
# notifications — snoozed_until, compared against a bound JS Date
# Pass module names as arguments to override the default list. In practice the
# main sweep reached most of these *after* the last edit landed, so it already
# covers them against final code — only the modules it passed BEFORE the edits
# (in practice just `tasks`) genuinely need re-running. The full list is the
# conservative default.
MODULES="${*:-tasks tasks10 sla oncall eng collab sprints deptreview home jobs notifications}"
for m in $MODULES; do
  printf '%-14s ' "$m" >> "$OUT"
  # Same flags the main sweep uses. `--testTimeout=60000` is the important one:
  # the default 5s is not enough for `resetTestDb()` on a loaded box, and when it
  # trips, every test in the suite fails on the hook rather than on an assertion.
  line=$(npx jest --config "jest.$m.config.cjs" --runInBand --silent --testTimeout=60000 2>&1 \
         | grep -E "^(Tests|Test Suites):" | tr '\n' '|')
  if [ -z "$line" ]; then
    echo "NO RESULT (config missing or the run crashed)" >> "$OUT"
  else
    echo "$line" >> "$OUT"
  fi
done

{
  echo
  echo "finished $(date -Is)"
} >> "$OUT"

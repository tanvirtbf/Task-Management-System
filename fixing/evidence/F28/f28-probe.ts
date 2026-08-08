/**
 * F28 probe — the seven D12 decisions, re-runnable.
 *
 *     cd server && npx tsx ../fixing/evidence/F28/f28-probe.ts
 *
 * Deliberately exercises REAL behaviour rather than matching source text: it
 * imports the actual grant matrix and business clock, walks the actual Express
 * router stacks, and reads the actual databases. (F25 taught this the hard way —
 * a probe that asserted code shape happily passed a picker that searched
 * nothing, because `types: ["tasks"]` is silently dropped by the service.)
 *
 * HTTP-level behaviour is proved by the jest suites, not here:
 *   sprints/delete.test.ts 14 · lists/update.test.ts 67 (14 new)
 *   rbac 289 · workspace 83 · assistant 127 (incl. route-parity)
 */
// Resolved through server/node_modules — this file lives outside any package.
import mysql from "../../../server/node_modules/mysql2/promise";
import { SYSTEM_ROLE_GRANTS, SYSTEM_ROLES } from "../../../server/src/rbac/bootstrap";
import {
    addBusinessDays,
    addBusinessMs,
    businessDayLengthMs,
} from "../../../server/src/utils/dhakaTime";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
    if (cond) {
        pass += 1;
        console.log("  PASS  " + label + (detail ? "   " + detail : ""));
    } else {
        fail += 1;
        console.log("  FAIL  " + label + (detail ? "   " + detail : ""));
    }
};
const section = (s: string) => console.log("\n--- " + s + " ---");

const DBS = ["taskmanagement", "taskmanagement_qa"];
const conn = (database: string) =>
    mysql.createConnection({
        host: "127.0.0.1",
        user: "root",
        password: "root",
        database,
    });

const GUEST_EXPECTED = [
    "activity.view",
    "assistant.use",
    "bug.report",
    "comment.create",
    "member.view",
    "space.view",
    "task.view",
].sort();

const REVOKED = [
    "task.create",
    "task.edit",
    "task.assign",
    "task.archive",
    "task.delete",
    "checklist.manage",
    "dependency.manage",
    "customfield.set_value",
    "template.apply",
    "sprint.assign_tasks",
    "postmortem.manage",
    "form.view_submissions",
];

const main = async () => {
    console.log("================ F28 PROBE (D12.1 - D12.7) ================");

    // ── D12.1 — the seeded Guest role ────────────────────────────────────────
    section("D12.1 (ISS-094) the seeded Guest role");
    const guest = [...(SYSTEM_ROLE_GRANTS.guest ?? [])].sort();
    const member = [...(SYSTEM_ROLE_GRANTS.member ?? [])];
    ok("code: guest holds exactly 7 grants", guest.length === 7, "got " + guest.length);
    ok("code: guest key set is the read+comment set", JSON.stringify(guest) === JSON.stringify(GUEST_EXPECTED));
    ok("code: member is UNTOUCHED at 20", member.length === 20, "got " + member.length);
    ok(
        "code: every revoked key is gone from guest but kept by member",
        REVOKED.every((k) => !guest.includes(k) && member.includes(k)),
    );
    ok(
        "code: guest is still a strict SUBSET of member (monotonic roles)",
        guest.every((k) => member.includes(k)),
    );
    const guestDef = SYSTEM_ROLES.find((r) => r.key === "guest");
    ok(
        "code: the role description no longer claims member-equivalence",
        !!guestDef && !/same as a member/i.test(guestDef.description),
        guestDef?.description ?? "",
    );

    for (const d of DBS) {
        const db = await conn(d);
        const [rows] = await db.query<any[]>(
            "SELECT rp.permission_key k FROM roles r JOIN role_permissions rp ON rp.role_id = r.id" +
                " WHERE r.role_key = 'guest' AND r.is_system = 1 GROUP BY rp.permission_key ORDER BY rp.permission_key",
        );
        const live = rows.map((r) => r.k).sort();
        ok(
            "db(" + d + "): guest row matches the code exactly",
            JSON.stringify(live) === JSON.stringify(GUEST_EXPECTED),
            live.length + " grants",
        );
        const [mem] = await db.query<any[]>(
            "SELECT COUNT(*) n FROM roles r JOIN role_permissions rp ON rp.role_id = r.id" +
                " WHERE r.role_key = 'member' AND r.is_system = 1",
        );
        ok("db(" + d + "): member still holds 20", Number(mem[0].n) === 20, mem[0].n + "");
        await db.end();
    }

    // ── D12.2 — the business clock + fiscal-year removal ─────────────────────
    section("D12.2 (ISS-029) SLA on the business clock");
    const cal = {
        workingDays: ["sun", "mon", "tue", "wed", "thu"],
        businessHoursStart: "09:00:00",
        businessHoursEnd: "18:00:00",
        timeZone: "Asia/Dhaka",
    };
    const H = 3_600_000;
    ok("a working day is 9h", businessDayLengthMs(cal) === 9 * H);

    const inWindow = (d: Date) => {
        const p = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Dhaka",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(d);
        const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
        const mins = Number(g("hour")) * 60 + Number(g("minute"));
        return (
            ["sun", "mon", "tue", "wed", "thu"].includes(g("weekday").toLowerCase()) &&
            mins >= 9 * 60 &&
            mins <= 18 * 60
        );
    };

    // The exact case ISS-029 is about: 17:30 Thursday, 30 min before close,
    // with Friday + Saturday off.
    const thu1730 = new Date("2026-08-06T11:30:00Z");
    const s0 = addBusinessMs(thu1730, 2 * H, cal);
    ok(
        "the ISS-029 case: S0 filed Thu 17:30 lands Sunday 10:30, not Thu 19:30",
        s0.toISOString() === "2026-08-09T04:30:00.000Z",
        s0.toISOString(),
    );
    ok("wall-clock would have been Thu 19:30 (the defect)", new Date(thu1730.getTime() + 2 * H).toISOString() === "2026-08-06T13:30:00.000Z");

    // Sweep every hour of a full week: no deadline may ever fall out of hours.
    let swept = 0;
    let outOfWindow = 0;
    for (let h = 0; h < 24 * 7; h += 1) {
        const t = new Date(Date.UTC(2026, 7, 2, h)); // 2026-08-02 .. 08-08
        for (const due of [
            addBusinessMs(t, 2 * H, cal),
            addBusinessDays(t, 1, cal),
            addBusinessDays(t, 7, cal),
        ]) {
            swept += 1;
            if (!inWindow(due)) outOfWindow += 1;
        }
        }
    ok(
        "sweep: every deadline from every hour of a week is inside working hours",
        outOfWindow === 0,
        swept + " deadlines, " + outOfWindow + " out of window",
    );
    ok(
        "a deadline is always in the FUTURE of the filing instant",
        addBusinessMs(new Date("2026-08-07T06:00:00Z"), 2 * H, cal).getTime() >
            new Date("2026-08-07T06:00:00Z").getTime(),
    );
    // Degradation: an unusable calendar must not throw or hang — it falls back
    // to the pre-F28 wall clock.
    ok(
        "no working days -> wall-clock fallback",
        addBusinessMs(thu1730, 2 * H, { ...cal, workingDays: [] }).toISOString() ===
            "2026-08-06T13:30:00.000Z",
    );
    ok(
        "inverted window -> wall-clock fallback",
        addBusinessMs(thu1730, 2 * H, {
            ...cal,
            businessHoursStart: "18:00:00",
            businessHoursEnd: "09:00:00",
        }).toISOString() === "2026-08-06T13:30:00.000Z",
    );

    for (const d of DBS) {
        const db = await conn(d);
        const [cols] = await db.query<any[]>(
            "SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = ?" +
                " AND table_name = 'workspaces' AND column_name = 'fiscal_year_start_month'",
            [d],
        );
        ok("db(" + d + "): fiscal_year_start_month column is gone", Number(cols[0].n) === 0);
        const [cks] = await db.query<any[]>(
            "SELECT COUNT(*) n FROM information_schema.table_constraints WHERE constraint_schema = ?" +
                " AND table_name = 'workspaces' AND constraint_name = 'ck_workspaces_fiscal_month'",
            [d],
        );
        ok("db(" + d + "): its CHECK constraint is gone too", Number(cks[0].n) === 0);
        const [keep] = await db.query<any[]>(
            "SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = ?" +
                " AND table_name = 'workspaces' AND column_name IN" +
                " ('working_days','business_hours_start','business_hours_end','week_starts_on')",
            [d],
        );
        ok(
            "db(" + d + "): the four settings WITH consumers survive",
            Number(keep[0].n) === 4,
        );
        await db.end();
    }

    // ── D12.6 / D12.7 — the two new endpoints, read off the real routers ─────
    section("D12.6 + D12.7 route wiring (walked off the live Express stacks)");
    // routes/sprints.ts calls getDb() at module load, so the pool must exist
    // before the import. server/.env supplies the dev DB — reads only.
    const { initDb } = await import("../../../server/src/db/client");
    await initDb();
    const routeList = (router: any): string[] =>
        (router.stack ?? [])
            .filter((l: any) => l.route)
            .flatMap((l: any) =>
                Object.keys(l.route.methods).map(
                    (m: string) => m.toUpperCase() + " " + l.route.path,
                ),
            );

    const sprintRouter = (await import("../../../server/src/routes/sprints")).default;
    const sprintRoutes = routeList(sprintRouter);
    ok(
        "DELETE /sprints/:id is registered",
        sprintRoutes.includes("DELETE /sprints/:id"),
        sprintRoutes.filter((r) => r.startsWith("DELETE")).join(" | "),
    );
    ok(
        "it did NOT displace DELETE /sprints/:id/tasks/:taskId",
        sprintRoutes.includes("DELETE /sprints/:id/tasks/:taskId"),
    );

    // The validator, exercised for real: run the chains against a fake request
    // (express-validator supports plain objects) and read the verdicts — no
    // internals, no source matching. HTTP-level behaviour is the jest suite's.
    const { updateListValidator } = await import("../../../server/src/validators/lists");
    const { validationResult } = await import(
        "../../../server/node_modules/express-validator/lib/index.js"
    );
    const runValidator = async (body: Record<string, unknown>) => {
        const req = { params: { id: "l-1" }, body, query: {}, headers: {}, cookies: {} };
        for (const chain of updateListValidator as unknown as Array<{
            run: (r: unknown) => Promise<unknown>;
        }>) {
            await chain.run(req);
        }
        return validationResult(req);
    };
    const okSpace = await runValidator({ space_id: "sp-target" });
    ok("PATCH /lists/:id validator accepts space_id", okSpace.isEmpty());
    const emptySpace = await runValidator({ space_id: "   " });
    ok("…and rejects an empty space_id", !emptySpace.isEmpty());
    const nullSpace = await runValidator({ space_id: null });
    ok("…and rejects null — a list always belongs to a space", !nullSpace.isEmpty());
    // `is_private` stays UNKNOWN to the schema (enforced nowhere per
    // rbac/scope.ts); the controller's field whitelist ignores it, proven by
    // lists/update.test.ts "still REFUSES is_private".

    // ── D12.3 / D12.4 / D12.5 — client wiring ───────────────────────────────
    section("D12.3 / D12.4 / D12.5 client surfaces");
    const fs = await import("node:fs");
    const read = (p: string) => fs.readFileSync("E:/Task Management System/" + p, "utf8");

    const checklist = read("client/src/components/task/ChecklistsSection.tsx");
    ok(
        "D12.3: the checklist item assignee control exists and calls updateItem",
        /assigneeOptions/.test(checklist) &&
            /checklistsApi\.updateItem\(/.test(checklist) &&
            /assigneeId/.test(checklist),
    );
    ok(
        "D12.3: only ACTIVE members are offered (the server 422s an invited one)",
        /status === "active"/.test(checklist),
    );

    const router = read("client/src/router.tsx");
    const api = read("client/src/http/api.ts");
    const kb = read("server/src/assistant/knowledgeBase.ts");
    const parity = read("server/tests/assistant/route-parity.test.ts");
    ok("D12.4: /sla route registered", /path: "sla"/.test(router));
    ok("D12.4: slaApi.breached exists", /export const slaApi/.test(api) && /breached:/.test(api));
    ok("D12.4: the KB links the page (route-parity would fail otherwise)", /\]\(\/sla\)/.test(kb));
    ok("D12.4: the parity map knows the segment", /sla: "\/sla"/.test(parity));
    ok(
        "D12.4: Home's slaBreaches KPI now links to it",
        /to="\/sla"/.test(read("client/src/pages/home/KpiRow.tsx")),
    );

    const ws = read("client/src/pages/settings/WorkspaceSettings.tsx");
    ok(
        "D12.5: the locale Select is disabled with a hint",
        /Default locale/.test(ws) &&
            /Cannot be changed/.test(ws) &&
            !/defaultLocale: v,/.test(ws),
    );
    ok(
        "D12.2: the fiscal-year control is gone from the settings page",
        !/fiscalYearStartMonth/.test(ws),
    );

    // ── Sidebar: F26's guest workaround is retired ───────────────────────────
    section("F26 clean-up made possible by D12.1");
    const sidebar = read("client/src/components/shared/Sidebar.tsx");
    const gate = sidebar.slice(
        sidebar.indexOf("const canSeeEngineering"),
        sidebar.indexOf("const canSeeDept"),
    );
    ok(
        'the Engineering nav gate no longer carries permRole !== "guest"',
        !/permRole/.test(gate),
        gate.replace(/\s+/g, " ").trim().slice(0, 90),
    );

    console.log("\n================================================");
    console.log("  " + pass + " passed, " + fail + " failed");
    process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => {
    console.error("PROBE ERROR " + (e as Error).message);
    process.exit(1);
});

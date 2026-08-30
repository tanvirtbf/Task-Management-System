/**
 * Fixtures the desktop e2e specs provision for themselves (KI-4).
 *
 * Several specs were written against a `taskmanagement_qa` database that had
 * been seeded by hand: they hardcoded a Space id, a List id, two task ids and a
 * set of `P4xX …` task names. Against the demo-seeded dev database not one of
 * those rows exists, so the specs did not fail on a product bug — they failed on
 * an environment that no longer exists, which is worse, because it makes the
 * suite useless as a gate exactly when you most want to trust it.
 *
 * So the specs create what they need, through the API, and delete it after. Two
 * consequences worth stating:
 *
 *   · they are green against ANY seed, which is what lets the whole suite live
 *     inside one gate command;
 *   · the dev database goes back to its baseline afterwards, which the test plan
 *     requires of every phase.
 *
 * Everything here is idempotent: `ensureFixture` looks a row up by name before
 * creating it, so a crashed run leaves a re-runnable state rather than a
 * duplicate one.
 */

import { execFileSync } from "node:child_process";

const API = process.env.E2E_API ?? "http://localhost:5501/api/v1";
const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

/** Everything a spec needs to drive one List end to end. */
export interface Fixture {
    token: string;
    spaceId: string;
    spaceName: string;
    listId: string;
    listName: string;
    /** Task name → id, for the tasks this fixture created. */
    taskIds: Record<string, string>;
    /** `/s/:spaceId/l/:listId` — the URL the specs navigate to. */
    listUrl: string;
}

export interface FixtureSpec {
    /** Stable, recognisable prefix so a leaked row is obviously a test row. */
    spaceName: string;
    listName: string;
    /** Task names to create in that list, in order. */
    tasks: string[];
    /** Names from `tasks` that should be created as the workspace's Bug type. */
    bugs?: string[];
    /**
     * Task name → the name of the status it should sit in (e.g. "In Progress").
     * A new List is seeded with the five defaults (To Do, In Progress, In
     * Review, Done, Closed) and every task lands in the first one, so a spec
     * that drags BETWEEN columns needs at least one task placed elsewhere —
     * otherwise the target column is empty and the drop has nothing to land on.
     */
    statuses?: Record<string, string>;
}

const unwrap = <T,>(body: unknown): T[] =>
    Array.isArray(body) ? (body as T[]) : ((body as { data?: T[] }).data ?? []);

async function login(): Promise<string> {
    const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`e2e fixture login failed: ${res.status}`);
    return (await res.json()).access_token as string;
}

const call = async (
    token: string,
    path: string,
    init: RequestInit = {},
): Promise<unknown> => {
    const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
        },
    });
    if (!res.ok && res.status !== 404) {
        throw new Error(
            `e2e fixture ${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`,
        );
    }
    return res.status === 204 ? null : res.json().catch(() => null);
};

/**
 * Create (or find) the Space / List / tasks a spec needs.
 *
 * ⚠️ The wire is snake_case. The app's client decamelizes on the way out, but a
 * raw fetch like this one has to send `space_id` / `primary_list_id` itself, or
 * the request earns a 422 that reads like a product bug.
 */
export async function ensureFixture(spec: FixtureSpec): Promise<Fixture> {
    const token = await login();

    const spaces = unwrap<{ id: string; name: string }>(
        await call(token, "/spaces"),
    );
    const space =
        spaces.find((s) => s.name === spec.spaceName) ??
        ((await call(token, "/spaces", {
            method: "POST",
            body: JSON.stringify({ name: spec.spaceName }),
        })) as { id: string; name: string });

    const lists = unwrap<{ id: string; name: string }>(
        await call(token, `/spaces/${space.id}/lists`),
    );
    const list =
        lists.find((l) => l.name === spec.listName) ??
        ((await call(token, "/lists", {
            method: "POST",
            body: JSON.stringify({ space_id: space.id, name: spec.listName }),
        })) as { id: string; name: string });

    // The Bug type is resolved by NAME, exactly as the report-bug flow does; a
    // workspace without one simply gets ordinary tasks rather than a hard fail,
    // because none of these specs are about bug typing itself.
    const types = unwrap<{ id: string; name: string }>(
        await call(token, "/task-types"),
    );
    const bugTypeId = types.find((t) => t.name.toLowerCase() === "bug")?.id;

    const existing = unwrap<{ id: string; name: string }>(
        await call(token, `/lists/${list.id}/tasks?limit=200`),
    );
    const taskIds: Record<string, string> = {};
    for (const name of spec.tasks) {
        const found = existing.find((t) => t.name === name);
        if (found) {
            taskIds[name] = found.id;
            continue;
        }
        const body: Record<string, unknown> = {
            primary_list_id: list.id,
            name,
        };
        if (bugTypeId && (spec.bugs ?? []).includes(name)) {
            body.task_type_id = bugTypeId;
        }
        const made = (await call(token, "/tasks", {
            method: "POST",
            body: JSON.stringify(body),
        })) as { id: string };
        taskIds[name] = made.id;
    }

    // Place any task the spec asked to sit in a particular column.
    const wanted = spec.statuses ?? {};
    if (Object.keys(wanted).length > 0) {
        const statuses = unwrap<{ id: string; name: string }>(
            await call(token, `/lists/${list.id}/statuses`),
        );
        for (const [taskName, statusName] of Object.entries(wanted)) {
            const status = statuses.find((st) => st.name === statusName);
            if (!status || !taskIds[taskName]) continue;
            await call(token, `/tasks/${taskIds[taskName]}`, {
                method: "PATCH",
                body: JSON.stringify({ status_id: status.id }),
            });
        }
    }

    return {
        token,
        spaceId: space.id,
        spaceName: space.name,
        listId: list.id,
        listName: list.name,
        taskIds,
        listUrl: `/s/${space.id}/l/${list.id}`,
    };
}

/**
 * Remove what `ensureFixture` made, in FK order, so the dev database returns to
 * its baseline.
 *
 * Deliberately NOT the API. `DELETE /tasks/:id` archives rather than removes —
 * that is the product's contract, and permanent removal is a two-step approval
 * flow no test should drive. An archived task then disappears from
 * `GET /lists/:id/tasks`, so the next run's `ensureFixture` cannot find it,
 * creates another, and the rows pile up: one full suite run left forty of them
 * behind, along with the List and Space that `ON DELETE RESTRICT` had refused to
 * drop. A fixture helper that promises to restore the baseline has to actually
 * restore it, so the teardown goes straight at the tables in FK order — exactly
 * the order the test plan's §A rule 3 prescribes.
 */
const MYSQL = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
const TEARDOWN_DB = process.env.E2E_DB ?? "taskmanagement";
const teardownSql = (q: string): void => {
    try {
        execFileSync(MYSQL, ["-uroot", "-proot", TEARDOWN_DB, "-N", "-e", q], {
            encoding: "utf8",
        });
    } catch (e) {
        // Best-effort, but never silent: a teardown that fails quietly is how
        // this helper spent a whole suite run leaving its fixtures behind while
        // every test reported green.
        console.log(
            "[fixture teardown] FAILED:",
            (e as Error).message.slice(0, 200),
        );
    }
};

/**
 * Remove tasks a spec created, by name, along with the notifications that point
 * at them.
 *
 * For specs that make a row or two rather than a whole Space. The same reason
 * applies as in `destroyFixture`: `DELETE /tasks/:id` archives, so an
 * API-based teardown leaves the row in the table for ever. Three specs were
 * quietly doing that — one full suite run left six orphans behind, and §A rule 3
 * says a phase ends at the baseline.
 */
export function removeTasksByName(...names: string[]): void {
    for (const name of names) {
        const safe = name.replace(/'/g, "''");
        teardownSql(
            `DELETE FROM notifications WHERE entity_id IN (SELECT id FROM tasks WHERE name = '${safe}')`,
        );
        teardownSql(`DELETE FROM tasks WHERE name = '${safe}'`);
    }
}

/**
 * Remove whole Spaces a spec created, matched by SQL LIKE — several specs name
 * theirs with a random suffix (`PW Space 61825`, `Dept E2E 607648`, `QA Space
 * 15323`), so an exact name is not something the teardown can know.
 *
 * FK order matters and is not obvious: `department_reports.space_id` and
 * `tasks.primary_list_id` are both ON DELETE RESTRICT, so a Space that has ever
 * been reported on, or whose Lists still hold tasks, refuses to drop — which is
 * exactly why these rows accumulated run after run.
 */
/**
 * Remove notifications a spec caused, matched on their title.
 *
 * Some of what a run leaves behind is not attached to a task at all: a
 * department report fans a `report_ready` row out to four people, and a public
 * form submission notifies the owning team. Sweeping the Space those belonged to
 * does not touch them, because they point at a report or a form.
 */
export function removeNotificationsLike(...titlePatterns: string[]): void {
    for (const pattern of titlePatterns) {
        const p = pattern.replace(/'/g, "''");
        teardownSql(`DELETE FROM notifications WHERE title LIKE '${p}'`);
    }
}

export function removeSpacesLike(...patterns: string[]): void {
    for (const pattern of patterns) {
        const p = pattern.replace(/'/g, "''");
        const spaces = `SELECT id FROM spaces WHERE name LIKE '${p}'`;
        const lists = `SELECT id FROM lists WHERE space_id IN (${spaces})`;
        teardownSql(
            `DELETE FROM notifications WHERE entity_id IN (SELECT id FROM tasks WHERE primary_list_id IN (${lists}))`,
        );
        teardownSql(
            `DELETE FROM comments WHERE task_id IN (SELECT id FROM tasks WHERE primary_list_id IN (${lists}))`,
        );
        teardownSql(
            `DELETE FROM tasks WHERE primary_list_id IN (${lists})`,
        );
        teardownSql(`DELETE FROM department_reports WHERE space_id IN (${spaces})`);
        teardownSql(`DELETE FROM lists WHERE space_id IN (${spaces})`);
        teardownSql(`DELETE FROM spaces WHERE name LIKE '${p}'`);
    }
}

export function destroyFixture(f: Fixture): void {
    const sql = teardownSql;
    sql(
        `DELETE FROM notifications WHERE entity_id IN (SELECT id FROM tasks WHERE primary_list_id = '${f.listId}')`,
    );
    sql(`DELETE FROM tasks WHERE primary_list_id = '${f.listId}'`);
    sql(`DELETE FROM lists WHERE id = '${f.listId}'`);
    sql(`DELETE FROM spaces WHERE id = '${f.spaceId}'`);
}

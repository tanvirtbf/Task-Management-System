/**
 * F11 helper — bootstrap RBAC on the `taskmanagement_perf` scratch DB.
 *
 * The perf fixture was built before dynamic RBAC, so it has zero `roles` /
 * `user_roles` rows. After F7 that means its users hold nothing and every read
 * 404s at the visibility layer — a load test against that state would measure
 * the 404 path, not the real one. This makes the fixture representative of a
 * deployed workspace (the same call `db:setup` and the invite flow run).
 */
import { closeDb, initDb } from "../../../server/src/db/client";
import { bootstrapRbac } from "../../../server/src/rbac/bootstrap";
import { workspaces } from "../../../server/src/db/schema";

const main = async () => {
    const db = await initDb();
    const rows = await db.select({ id: workspaces.id }).from(workspaces);
    for (const w of rows) {
        const r = await bootstrapRbac(db, w.id);
        process.stdout.write(
            "BOOTSTRAPPED " + w.id + " " + JSON.stringify(r) + "\n",
        );
    }
    await closeDb();
};

main()
    .then(() => process.exit(0))
    .catch((e) => {
        process.stdout.write("FAILED " + String(e) + "\n");
        process.exit(1);
    });

import { describe, expect, it } from "vitest";
import { camelizeKeys } from "../http/client";
import { canWith, entryFor, holdsWith } from "./permissions";
import type { MyPermissions } from "../types/rbac";

/**
 * The client's mirror of the server's `can()` — plus the one bug that actually
 * shipped and had to be caught in a browser (see the last block).
 */

const snapshot = (
    permissions: MyPermissions["permissions"],
    extra: Partial<MyPermissions> = {},
): MyPermissions => ({
    version: 1,
    is_owner: false,
    role: "member",
    visible_space_ids: null,
    permissions,
    ...extra,
});

const entry = (over: Partial<MyPermissions["permissions"][string]> = {}) => ({
    all: false,
    space_ids: [],
    own: false,
    own_space_ids: [],
    ...over,
});

describe("canWith — mirrors server/src/rbac/can.ts", () => {
    it("'all' reaches everywhere", () => {
        const d = snapshot({ "task.edit": entry({ all: true }) });
        expect(canWith(d, "task.edit")).toBe(true);
        expect(canWith(d, "task.edit", { spaceId: "sp-9" })).toBe(true);
    });

    it("a space grant reaches only that space", () => {
        const d = snapshot({ "task.edit": entry({ space_ids: ["sp-1"] }) });
        expect(canWith(d, "task.edit", { spaceId: "sp-1" })).toBe(true);
        expect(canWith(d, "task.edit", { spaceId: "sp-2" })).toBe(false);
        expect(canWith(d, "task.edit")).toBe(false);
    });

    it("an 'own' grant needs the resource to be theirs", () => {
        const d = snapshot({ "task.edit": entry({ own: true }) });
        expect(canWith(d, "task.edit", { isOwn: true })).toBe(true);
        expect(canWith(d, "task.edit", { isOwn: false })).toBe(false);
    });

    it("own-inside-a-space needs both", () => {
        const d = snapshot({
            "task.edit": entry({ own_space_ids: ["sp-1"] }),
        });
        expect(canWith(d, "task.edit", { spaceId: "sp-1", isOwn: true })).toBe(
            true,
        );
        expect(canWith(d, "task.edit", { spaceId: "sp-2", isOwn: true })).toBe(
            false,
        );
        expect(canWith(d, "task.edit", { spaceId: "sp-1" })).toBe(false);
    });

    it("an absent key grants nothing, and a null snapshot is powerless", () => {
        expect(canWith(snapshot({}), "task.edit")).toBe(false);
        expect(canWith(null, "task.edit")).toBe(false);
        expect(entryFor(null, "task.edit")).toEqual(entry());
    });

    it("holdsWith is true for ANY reach — the nav/route question", () => {
        expect(holdsWith(snapshot({ "a.b": entry({ all: true }) }), "a.b")).toBe(
            true,
        );
        expect(
            holdsWith(snapshot({ "a.b": entry({ space_ids: ["s"] }) }), "a.b"),
        ).toBe(true);
        expect(holdsWith(snapshot({ "a.b": entry({ own: true }) }), "a.b")).toBe(
            true,
        );
        expect(holdsWith(snapshot({}), "a.b")).toBe(false);
        expect(holdsWith(null, "a.b")).toBe(false);
    });
});

/**
 * REGRESSION — this one shipped and was only caught by opening the app.
 *
 * The axios layer recursively snake→camel-cases every response body. The
 * `/me/permissions` payload is a map KEYED BY PERMISSION KEY, so the transform
 * rewrote `catalog.task_types` to `catalog.taskTypes`; every lookup then missed
 * and the settings nav hid two pages the admin actually held. The fix is the
 * `SKIP_CAMELIZE_URLS` entry — the same treatment `/postmortem` already needed
 * for its human-label keys.
 */
describe("permission keys must survive the wire untouched", () => {
    const KEYS_WITH_UNDERSCORES = [
        "catalog.task_types",
        "catalog.custom_fields",
        "member.role_change",
        "member.reset_password",
        "member.edit_profile",
        "space.head_assign",
        "space.members_manage",
        "task.delete_hard",
        "task.sla_override",
        "comment.delete_any",
        "attachment.delete_any",
        "customfield.set_value",
        "sprint.assign_tasks",
        "form.view_submissions",
    ];

    it("camelizeKeys WOULD corrupt them — which is why the URL is skipped", () => {
        const corrupted = camelizeKeys({
            permissions: Object.fromEntries(
                KEYS_WITH_UNDERSCORES.map((k) => [k, entry({ all: true })]),
            ),
        }) as { permissions: Record<string, unknown> };
        // Documents the hazard: not one of the 14 keys survives.
        for (const k of KEYS_WITH_UNDERSCORES) {
            expect(corrupted.permissions[k]).toBeUndefined();
        }
    });

    it("an untransformed payload resolves every one of them", () => {
        const d = snapshot(
            Object.fromEntries(
                KEYS_WITH_UNDERSCORES.map((k) => [k, entry({ all: true })]),
            ),
        );
        for (const k of KEYS_WITH_UNDERSCORES) {
            expect(holdsWith(d, k)).toBe(true);
        }
    });
});

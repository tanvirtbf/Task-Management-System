import {
    PERMISSIONS,
    PERMISSION_GROUPS,
    PERMISSION_GROUP_LABELS,
    PERMISSION_SCOPES,
    getPermission,
    isPermissionKey,
    permissionsByGroup,
    strongerScope,
    supportsScope,
} from "../../src/rbac/catalog";

/**
 * P1 — permission catalog integrity + COVERAGE.
 *
 * Pure data assertions (no DB, no OpenAI). Two jobs:
 *  1. structural integrity of the catalog itself, and
 *  2. a coverage canary: every capability recorded in RBAC_BUILD_LOG.md §0.4
 *     ("today's effective authorization") must have a key that can express it.
 *     If a later phase deletes or renames a key, this fails — which is the
 *     point, because `role_permissions` rows persist these strings.
 */

describe("permission catalog — structure", () => {
    it("has a meaningful number of permissions", () => {
        expect(PERMISSIONS.length).toBeGreaterThanOrEqual(50);
    });

    it("keys are unique", () => {
        const keys = PERMISSIONS.map((p) => p.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("keys are lowercase group.action strings", () => {
        for (const p of PERMISSIONS) {
            expect(p.key).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
        }
    });

    it("every permission has a label and a description", () => {
        for (const p of PERMISSIONS) {
            expect(p.label.trim().length).toBeGreaterThan(3);
            expect(p.description.trim().length).toBeGreaterThan(10);
        }
    });

    it("every permission belongs to a known group with a label", () => {
        for (const p of PERMISSIONS) {
            expect(PERMISSION_GROUPS).toContain(p.group);
            expect(PERMISSION_GROUP_LABELS[p.group]).toBeTruthy();
        }
    });

    it("every permission supports 'all', and only known scopes", () => {
        for (const p of PERMISSIONS) {
            expect(p.scopes).toContain("all");
            expect(p.scopes.length).toBeGreaterThan(0);
            for (const s of p.scopes) expect(PERMISSION_SCOPES).toContain(s);
            // no duplicates
            expect(new Set(p.scopes).size).toBe(p.scopes.length);
        }
    });

    it("workspace-wide resources are NOT offered a 'space' scope", () => {
        // These have no join path to a space (verified in the data-layer scan),
        // so offering a space scope would be unenforceable.
        for (const key of [
            "workspace.settings",
            "member.invite",
            "member.role_change",
            "catalog.tags",
            "catalog.task_types",
            "sprint.manage",
            "oncall.manage",
            "activity.view",
            "role.manage",
            "role.assign",
        ]) {
            expect(supportsScope(key, "space")).toBe(false);
            expect(supportsScope(key, "all")).toBe(true);
        }
    });

    it("space-resolvable resources DO offer a 'space' scope", () => {
        for (const key of [
            "space.view",
            "space.edit",
            "list.create",
            "status.manage",
            "task.create",
            "task.edit",
            "comment.create",
            "form.manage",
            "review.perform",
            "report.view",
        ]) {
            expect(supportsScope(key, "space")).toBe(true);
        }
    });

    it("'own' is offered only where creator/assignee is meaningful", () => {
        const withOwn = PERMISSIONS.filter((p) =>
            (p.scopes as readonly string[]).includes("own"),
        ).map((p) => p.key);
        expect(withOwn.sort()).toEqual(
            [
                "checklist.manage",
                "customfield.set_value",
                "review.read",
                "task.archive",
                "task.delete",
                "task.edit",
                "task.view",
            ].sort(),
        );
    });

    it("destructive / privilege-affecting permissions are flagged dangerous", () => {
        for (const key of [
            "space.delete",
            "list.delete",
            "task.delete",
            "task.delete_hard",
            "member.role_change",
            "member.deactivate",
            "role.manage",
            "role.assign",
        ]) {
            expect(getPermission(key)?.dangerous).toBe(true);
        }
    });
});

describe("permission catalog — coverage of today's behaviour (RBAC_BUILD_LOG §0.4)", () => {
    // Every row of the §0.4 capability table needs a key that can express it.
    // Grouped the same way the log records them.
    const REQUIRED: Record<string, string[]> = {
        "visibility + tasks": [
            "space.view",
            "task.view",
            "task.create",
            "task.edit",
            "task.assign",
            "task.archive",
            "task.delete",
            "task.delete_hard",
            "task.sla_override",
        ],
        "task content": [
            "comment.create",
            "comment.delete_any",
            "checklist.manage",
            "attachment.upload",
            "attachment.delete_any",
            "dependency.manage",
            "customfield.set_value",
        ],
        structure: [
            "space.create",
            "space.edit",
            "space.archive",
            "space.delete",
            "list.create",
            "list.edit",
            "list.archive",
            "list.delete",
            "status.manage",
        ],
        "catalog + forms": [
            "catalog.task_types",
            "catalog.tags",
            "catalog.custom_fields",
            "catalog.templates",
            "template.apply",
            "form.manage",
            "form.view_submissions",
        ],
        "members + workspace": [
            "member.view",
            "member.invite",
            "member.role_change",
            "member.deactivate",
            "member.reset_password",
            "member.edit_profile",
            "workspace.settings",
        ],
        engineering: [
            "sprint.manage",
            "sprint.assign_tasks",
            "oncall.manage",
            "bug.report",
            "postmortem.manage",
        ],
        // The seven the legacy RBAC doc never had a key for.
        "dept review (shipped)": [
            "space.head_assign",
            "review.perform",
            "review.read",
            "report.view",
            "report.generate",
            "report.note",
            "report.ack",
        ],
        "insights + rbac": [
            "activity.view",
            "assistant.use",
            "role.manage",
            "role.assign",
        ],
    };

    for (const [area, keys] of Object.entries(REQUIRED)) {
        it(`covers ${area}`, () => {
            for (const key of keys) {
                expect(isPermissionKey(key)).toBe(true);
            }
        });
    }

    it("does NOT invent keys with no enforcement point", () => {
        // Catalog invariant #1: no aspirational keys. `workspace.delete` has no
        // endpoint (the UI button is inert) and import/export is a stub.
        for (const key of [
            "workspace.delete",
            "workspace.import",
            "workspace.export",
        ]) {
            expect(isPermissionKey(key)).toBe(false);
        }
    });
});

describe("permission catalog — helpers", () => {
    it("getPermission / isPermissionKey handle unknown keys", () => {
        expect(getPermission("nope.nope")).toBeUndefined();
        expect(isPermissionKey("nope.nope")).toBe(false);
        expect(supportsScope("nope.nope", "all")).toBe(false);
    });

    it("permissionsByGroup returns every permission exactly once, in group order", () => {
        const grouped = permissionsByGroup();
        const flat = grouped.flatMap((g) => g.permissions.map((p) => p.key));
        expect(flat.length).toBe(PERMISSIONS.length);
        expect(new Set(flat).size).toBe(PERMISSIONS.length);

        const order = grouped.map((g) => g.group);
        const expected = PERMISSION_GROUPS.filter((g) =>
            PERMISSIONS.some((p) => p.group === g),
        );
        expect(order).toEqual([...expected]);
        for (const g of grouped) expect(g.label).toBeTruthy();
    });

    it("strongerScope picks the widest grant (all > space > own)", () => {
        expect(strongerScope("own", "space")).toBe("space");
        expect(strongerScope("space", "all")).toBe("all");
        expect(strongerScope("all", "own")).toBe("all");
        expect(strongerScope("own", "own")).toBe("own");
    });
});

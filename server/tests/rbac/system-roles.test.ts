import {
    SYSTEM_ROLES,
    SYSTEM_ROLE_GRANTS,
} from "../../src/rbac/bootstrap";
import { PERMISSIONS, isPermissionKey } from "../../src/rbac/catalog";

/**
 * P3 — THE CONTRACT TEST.
 *
 * `RBAC_BUILD_LOG.md §0.4` records what each pre-RBAC role could do. The seeded
 * system roles must reproduce it, because that is what makes shipping RBAC a
 * no-op until an admin tightens things ("dormant until configured", D-8).
 *
 * The grant lists are pinned as an exact GUEST set plus exact deltas, so any
 * future change to who-can-do-what shows up as a deliberate diff here rather
 * than as a silent behaviour change in production.
 */

const setOf = (key: string): Set<string> =>
    new Set(SYSTEM_ROLE_GRANTS[key] ?? []);

const owner = setOf("owner");
const admin = setOf("admin");
const member = setOf("member");
const guest = setOf("guest");

const sorted = (s: Set<string>): string[] => [...s].sort();
const minus = (a: Set<string>, b: Set<string>): string[] =>
    sorted(new Set([...a].filter((k) => !b.has(k))));

describe("system roles — definitions", () => {
    it("defines exactly the four legacy roles, ranked owner→guest", () => {
        expect(SYSTEM_ROLES.map((r) => r.key)).toEqual([
            "owner",
            "admin",
            "member",
            "guest",
        ]);
        const ranks = SYSTEM_ROLES.map((r) => r.rankOrder);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        expect(new Set(ranks).size).toBe(ranks.length);
        expect(SYSTEM_ROLES[0].rankOrder).toBe(0); // owner is the floor
    });

    it("every role has a name, description and a valid hex colour", () => {
        for (const r of SYSTEM_ROLES) {
            expect(r.name.length).toBeGreaterThan(2);
            expect(r.description.length).toBeGreaterThan(10);
            expect(r.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
    });

    it("grants only reference real catalog keys", () => {
        for (const [roleKey, keys] of Object.entries(SYSTEM_ROLE_GRANTS)) {
            for (const k of keys) {
                expect(isPermissionKey(k)).toBe(
                    true,
                );
                expect(`${roleKey}:${k}`).toBe(`${roleKey}:${k}`);
            }
            // no duplicates inside a role
            expect(new Set(keys).size).toBe(keys.length);
        }
    });

    it("is strictly monotonic: owner ⊇ admin ⊇ member ⊇ guest", () => {
        for (const k of guest) expect(member.has(k)).toBe(true);
        for (const k of member) expect(admin.has(k)).toBe(true);
        for (const k of admin) expect(owner.has(k)).toBe(true);
        expect(owner.size).toBeGreaterThan(admin.size);
        expect(admin.size).toBeGreaterThan(member.size);
        expect(member.size).toBeGreaterThan(guest.size);
    });

    it("the owner holds EVERY catalog permission (D-7 anti-lockout floor)", () => {
        expect(sorted(owner)).toEqual(PERMISSIONS.map((p) => p.key).sort());
    });
});

describe("system roles — pinned snapshot of §0.4", () => {
    /**
     * F28 (ISS-094, decision D12.1). This list used to be NINETEEN keys — the
     * whole pre-RBAC "any authenticated user" set — because the seeded roles
     * were built to reproduce the old product exactly while the toggles were
     * dormant. F7 made all 56 real, and a guest could then delete any task in
     * the workspace and read every public-form submission. Guest is now what its
     * name says: read, comment, report a bug.
     */
    it("GUEST = read the workspace, comment, report a bug — nothing else", () => {
        expect(sorted(guest)).toEqual(
            [
                "activity.view",
                "assistant.use",
                "bug.report",
                "comment.create",
                "member.view",
                "space.view",
                "task.view",
            ].sort(),
        );
    });

    it("MEMBER = GUEST + file upload + every write a guest no longer has", () => {
        expect(minus(member, guest)).toEqual(
            [
                "attachment.upload",
                "checklist.manage",
                "customfield.set_value",
                "dependency.manage",
                "form.view_submissions",
                "postmortem.manage",
                "sprint.assign_tasks",
                "task.archive",
                "task.assign",
                "task.create",
                "task.delete",
                "task.edit",
                "template.apply",
            ].sort(),
        );
    });

    it("ADMIN = MEMBER + everything the owner/admin route gates protect", () => {
        expect(minus(admin, member)).toEqual(
            [
                "attachment.delete_any",
                "catalog.custom_fields",
                "catalog.tags",
                "catalog.task_types",
                "catalog.templates",
                "comment.delete_any",
                "form.manage",
                "list.archive",
                "list.create",
                "list.edit",
                "member.deactivate",
                "member.edit_profile",
                "member.invite",
                "member.reset_password",
                "member.role_change",
                "oncall.manage",
                "report.ack",
                "report.generate",
                "report.view",
                "review.perform",
                "review.read",
                "role.assign",
                "role.manage",
                "space.archive",
                "space.create",
                "space.edit",
                "space.head_assign",
                "space.members_manage",
                "sprint.manage",
                "status.manage",
                "task.delete_hard",
                "task.sla_override",
                "workspace.settings",
            ].sort(),
        );
    });

    it("OWNER = ADMIN + the owner-only deletes + report.note", () => {
        expect(minus(owner, admin)).toEqual(
            ["list.delete", "report.note", "space.delete"].sort(),
        );
    });
});

describe("system roles — §0.4 spot checks (readable form)", () => {
    it("only the OWNER may delete a space or a list", () => {
        for (const k of ["space.delete", "list.delete"]) {
            expect(owner.has(k)).toBe(true);
            expect(admin.has(k)).toBe(false);
            expect(member.has(k)).toBe(false);
            expect(guest.has(k)).toBe(false);
        }
    });

    it("a guest cannot upload attachments, but everyone else can", () => {
        expect(guest.has("attachment.upload")).toBe(false);
        expect(member.has("attachment.upload")).toBe(true);
    });

    it("members and guests get NO admin surface", () => {
        for (const k of [
            "workspace.settings",
            "member.invite",
            "member.role_change",
            "space.create",
            "list.create",
            "status.manage",
            "catalog.tags",
            "form.manage",
            "sprint.manage",
            "oncall.manage",
            "task.delete_hard",
            "task.sla_override",
            "comment.delete_any",
            "attachment.delete_any",
            "role.manage",
            "role.assign",
        ]) {
            expect(member.has(k)).toBe(false);
            expect(guest.has(k)).toBe(false);
        }
    });

    it("every INTERNAL user can read the workspace and work on tasks", () => {
        for (const k of [
            "space.view",
            "task.view",
            "task.create",
            "task.edit",
            "task.assign",
            "task.archive",
            "task.delete",
            "comment.create",
            "checklist.manage",
            "customfield.set_value",
            "dependency.manage",
            "template.apply",
            "member.view",
            "activity.view",
            "bug.report",
            "sprint.assign_tasks",
            "postmortem.manage",
            "form.view_submissions",
        ]) {
            expect(member.has(k)).toBe(true);
        }
    });

    /**
     * F28 / D12.1 — the regression guard for ISS-094. Each key here was held by
     * the seeded Guest role until 2026-08-06, at scope=all. The two the issue
     * named are marked; the other ten were found by measuring rather than by
     * reading the issue, which is why this asserts the whole revocation and not
     * just the reported part.
     */
    it("a GUEST cannot write to tasks, engineering, or customer form data", () => {
        for (const k of [
            // workspace-wide task writes — task.delete is the sharp one
            "task.create",
            "task.edit",
            "task.assign",
            "task.archive",
            "task.delete",
            // a task's structure
            "checklist.manage",
            "dependency.manage",
            "customfield.set_value",
            "template.apply",
            // the two ISS-094 named
            "sprint.assign_tasks",
            "postmortem.manage",
            // contact details customers typed into a public form
            "form.view_submissions",
        ]) {
            expect(guest.has(k)).toBe(false);
            expect(member.has(k)).toBe(true); // internal users keep all of it
        }
    });

    it("a guest can still read, comment and report a bug", () => {
        for (const k of [
            "space.view",
            "task.view",
            "member.view",
            "activity.view",
            "comment.create",
            "assistant.use",
            "bug.report",
        ]) {
            expect(guest.has(k)).toBe(true);
        }
    });

    it("department review stays admin-or-head: members get no review/report grant", () => {
        for (const k of [
            "review.perform",
            "review.read",
            "report.view",
            "report.generate",
            "report.ack",
            "space.head_assign",
        ]) {
            expect(admin.has(k)).toBe(true);
            expect(member.has(k)).toBe(false);
            expect(guest.has(k)).toBe(false);
        }
        // The head path itself is the in-service `spaces.head_user_id` check,
        // which P11-P15 leave untouched — that is how a head who is only a
        // "member" keeps reviewing.
    });

    it("report.note is owner-only: admins stay refused, as today", () => {
        expect(owner.has("report.note")).toBe(true);
        expect(admin.has("report.note")).toBe(false);
        expect(member.has("report.note")).toBe(false);
        expect(guest.has("report.note")).toBe(false);
    });
});

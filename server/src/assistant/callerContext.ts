import { entryFor, holds } from "../rbac/can";
import { currentActor } from "../rbac/context";
import type { PermissionKey } from "../rbac/catalog";
import type { SpacesRepo } from "../repositories/SpacesRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { UserRolesRepo } from "../repositories/UserRolesRepo";

/**
 * THE CALLER BLOCK — who the assistant is talking to.
 *   Plan: AI_ASSISTANT_DEEP_PLAN.md P2 (decisions D2 / D9 / D10 / D11)
 *
 * Until now the bot knew the SYSTEM but not the PERSON, so every answer was
 * written for a generic user: it could not say "this step is Admin-only for
 * you", could not answer "what am I allowed to do?", and could not explain WHY
 * something is refused. This block is the missing half — a short, factual
 * sentence about the caller, prepended to the system message on every request.
 *
 * ── WHY THE CONTROLLER CALLS THIS (D9) ──────────────────────────────────────
 * `buildMessages` is pure and has no request context; `AssistantService` has no
 * `req`. The controller owns both, so it builds the block and passes the string
 * down. Built ONCE per request — never per tool round — and never persisted
 * into chat history (D10), so a permission change takes effect on the caller's
 * very next question.
 *
 * ── WHERE THE FACTS COME FROM ───────────────────────────────────────────────
 * Identity and grants come from the JWT-resolved actor (`currentActor()`), not
 * from anything the model said. Team NAMES are not on the actor — it carries
 * space IDS — so they come from two cheap reads (D11): the caller's own
 * membership rows, intersected with the spaces THEY can see (that list is
 * already `spaceScopeFilter`-ed, so this cannot widen anyone's view).
 *
 * ── PRIVACY ─────────────────────────────────────────────────────────────────
 * Name, role, team names and capability words only. Never an email, never an
 * id, never another person's data. The block describes the caller to
 * themselves; it is not a directory.
 *
 * Failure is non-fatal: any error returns "" and the bot simply answers as it
 * did before. A chat must never break because we could not describe the user.
 */

export interface CallerContextDeps {
    users: UsersRepo;
    spaces: SpacesRepo;
    userRoles: UserRolesRepo;
}

/**
 * Hard ceiling (D2). The block ships on every request; it must stay small.
 *
 * 400 → 600 for upgrades/023: the computed permanent-delete sentence is ~160
 * chars, and at 400 it silently pushed the "They CANNOT" half off the end —
 * which is the half that makes the bot redirect someone instead of walking
 * them into a refusal. Dropping a capability summary to keep a byte count is
 * the wrong trade; the ceiling still bounds the block, just honestly.
 */
export const CALLER_BLOCK_MAX = 600;

const MAX_TEAMS = 3;
const MAX_CAN = 6;
const MAX_CANNOT = 4;

/**
 * The capabilities that actually change ADVICE, in the order a guide would
 * mention them. Deliberately a short fixed list, not the whole 56-key catalog:
 * the block is a hint for phrasing, not a permission dump.
 *
 * `scoped` marks the keys where reach changes the answer ("edit tasks" means
 * something different at `own only` than at `everywhere`); for the rest the
 * verb alone is the useful fact.
 */
const SUMMARY_KEYS: ReadonlyArray<{
    key: PermissionKey;
    label: string;
    scoped: boolean;
}> = [
    { key: "task.view", label: "see tasks", scoped: true },
    { key: "task.create", label: "create tasks", scoped: true },
    { key: "task.edit", label: "edit tasks", scoped: true },
    { key: "task.assign", label: "assign tasks", scoped: true },
    // ⚠️ `task.delete_hard` is deliberately NOT here, and the reason is worth
    // keeping: it was added (2026-08-16) so the bot would know which delete a
    // person sees, and it made the answers WORSE. Listed under "They CANNOT"
    // as "approve permanent deletes", it collided with the words people
    // actually use — "task ta puropuri mucbo kivabe?" — and the model matched
    // the question to the refusal instead of answering it. A member CAN start
    // a permanent delete (it becomes a request), so any CANNOT phrasing here
    // is a half-truth the model then rounds off to "no". The whole story is
    // role-conditional, and the knowledge base tells it properly.
    { key: "member.view", label: "see the member list", scoped: false },
    { key: "review.read", label: "see team reviews", scoped: false },
    { key: "report.view", label: "read weekly reports", scoped: false },
    { key: "space.create", label: "create Spaces", scoped: false },
    { key: "space.members_manage", label: "manage team rosters", scoped: false },
    { key: "role.manage", label: "edit roles and permissions", scoped: false },
];

/** How far a grant reaches, in the words the knowledge base already uses. */
const reachWord = (e: {
    all: boolean;
    spaceIds: ReadonlySet<string>;
    own: boolean;
    ownSpaceIds: ReadonlySet<string>;
}): string | null => {
    if (e.all) return "everywhere";
    if (e.spaceIds.size > 0) return "their teams";
    if (e.own || e.ownSpaceIds.size > 0) return "own only";
    return null; // not held at all
};

/** "Member" from the legacy role string; the owner floor wins. */
const roleWord = (isOwner: boolean, legacyRole: string): string => {
    if (isOwner) return "Owner";
    if (!legacyRole) return "Member";
    return legacyRole.charAt(0).toUpperCase() + legacyRole.slice(1);
};

export const buildCallerBlock = async (
    deps: CallerContextDeps,
    ctx: { userId: string; workspaceId: string },
): Promise<string> => {
    try {
        const actor = await currentActor();
        // No resolved actor means no authenticated caller (or a token naming a
        // user who left). Say nothing rather than guess.
        if (!actor) return "";

        const [me, memberOf, visibleSpaces] = await Promise.all([
            deps.users.findByIdInWorkspace(ctx.userId, ctx.workspaceId),
            deps.userRoles.spaceIdsForUser(ctx.userId, ctx.workspaceId),
            deps.spaces.listByWorkspace(ctx.workspaceId, {
                includeArchived: false,
            }),
        ]);

        const name = me
            ? `${me.firstName} ${me.lastName}`.trim()
            : "";
        const role = roleWord(actor.isOwner, actor.legacyRole);

        // Their teams = membership ∩ what they can see. Head is worth naming:
        // a Head can do things (review, roster) a plain member cannot, and the
        // bot should offer those steps to them rather than to "an Admin".
        const mine = new Set(memberOf);
        const teamNames = visibleSpaces
            .filter((s) => mine.has(s.id))
            .map((s) => (s.headUserId === ctx.userId ? `${s.name} (Head)` : s.name));
        const teams =
            teamNames.length === 0
                ? "none yet"
                : teamNames.length > MAX_TEAMS
                  ? `${teamNames.slice(0, MAX_TEAMS).join(", ")} and ${teamNames.length - MAX_TEAMS} more`
                  : teamNames.join(", ");

        const can: string[] = [];
        const cannot: string[] = [];
        for (const { key, label, scoped } of SUMMARY_KEYS) {
            const reach = reachWord(entryFor(actor, key));
            if (reach === null) cannot.push(label);
            else can.push(scoped ? `${label} (${reach})` : label);
        }

        const who = name
            ? `You are talking to ${name} — ${role}`
            : `You are talking to a ${role}`;
        const parts = [`${who}, teams: ${teams}.`];

        // upgrades/023 — the ANSWER, not the rule. Which permanent-delete
        // button this person sees is a branch on one permission, and four
        // rounds of live probing showed the model cannot be told to branch
        // reliably: it refused a Member outright, then sent an ADMIN to go ask
        // another admin, then hedged both ways in one reply. Computed here, it
        // is simply true — the same fix the reports tool needed when an empty
        // list was being read as "forbidden".
        parts.push(
            holds(actor, "task.delete_hard")
                ? "Permanently deleting a task: THEY can do it themselves — the task's ⋯ menu has Delete permanently and it happens at once."
                : "Permanently deleting a task: THEY use the task's ⋯ menu → Request permanent delete (with a reason); an Owner/Admin then approves. Never tell them they cannot.",
        );
        if (can.length > 0) {
            parts.push(`They can: ${can.slice(0, MAX_CAN).join(", ")}.`);
        }
        if (cannot.length > 0) {
            parts.push(
                `They CANNOT: ${cannot.slice(0, MAX_CANNOT).join(", ")}.`,
            );
        }
        parts.push("Tailor every answer to this person.");

        const block = parts.join(" ");
        // The ceiling is a promise about request size, so it is enforced, not
        // hoped for: drop the CANNOT list first (it is the least load-bearing
        // half), and hard-truncate only if something unexpected is still long.
        if (block.length <= CALLER_BLOCK_MAX) return block;
        const shorter = parts
            .filter((p) => !p.startsWith("They CANNOT:"))
            .join(" ");
        return shorter.length <= CALLER_BLOCK_MAX
            ? shorter
            : `${shorter.slice(0, CALLER_BLOCK_MAX - 1)}…`;
    } catch {
        // Best-effort by design: the chat still works, just less personally.
        return "";
    }
};

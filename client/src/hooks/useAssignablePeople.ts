import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "../types";
import { teamsApi } from "../http/api";
import { useAuthStore } from "../stores/auth";
import { useUsers } from "./useReferenceData";

/**
 * Who can be assigned to a task, in the order a person actually looks for them.
 *
 * Three problems this fixes, all of them in one place so the four assignment
 * surfaces (the inline picker, the create modal, the bulk toolbar and the
 * mobile card menu) cannot drift apart again:
 *
 * 1. ONLY ACTIVE PEOPLE. `GET /users` returns everyone — including `invited`
 *    accounts that have never signed in and `deactivated` leavers. Both were
 *    offered by the inline picker, and picking one earns a 422
 *    `task.invalid_assignee` from the server ("not an active member of this
 *    workspace"). Offering a choice the server refuses is worse than not
 *    offering it. The create modal and the bulk toolbar already filtered on
 *    `status`; the main picker did not.
 *
 * 2. YOUR OWN TEAM FIRST. In a ~100-person workspace an alphabetical list means
 *    every assignment starts with typing, even though the person you want is
 *    almost always sitting next to you. Teammates come first, then everybody
 *    else — both blocks alphabetical, so the order inside each is predictable.
 *
 * 3. YOURSELF, WITHOUT SEARCHING. Assigning yourself is the single most common
 *    assignment there is, and it should never cost a search. `me` is returned
 *    separately so a surface can pin it.
 *
 * "Team" here means a SPACE — the org chart in `/teams` is a list of spaces
 * with their members, and `isPrimary` marks the one a person mainly belongs to.
 * Somebody can sit in several; sharing ANY space with you counts as your team,
 * because that is the sense in which you work together.
 */

export interface TeamInfo {
    /** The person's primary team name — shown as a chip in the picker. */
    label: string;
    /** Every space they belong to — Q11's cross-team approval question. */
    spaceIds: Set<string>;
}

export interface AssignablePeople {
    /** The signed-in user, or null when they are not an assignable member. */
    me: User | null;
    /** Teammates first (alphabetical), then everyone else (alphabetical). */
    people: User[];
    /** Just the teammates, in case a surface wants to label the split. */
    myTeam: User[];
    /** Everyone who is not a teammate. */
    others: User[];
    /** Per person: their primary team label + every space they belong to. */
    teamInfo: Map<string, TeamInfo>;
    /** True once the team directory has loaded; until then nobody is grouped. */
    teamsReady: boolean;
}

const byName = (a: User, b: User) =>
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);

/**
 * @param enabled defer the `/teams` request until a picker actually opens —
 *   this hook is called from list rows, and one directory fetch per row on
 *   mount would be a lot of nothing.
 */
export const useAssignablePeople = (enabled = true): AssignablePeople => {
    const { data: allUsers = [] } = useUsers();
    const currentUser = useAuthStore((s) => s.user);

    // Shared cache with TeamsSettings and the approval hooks (["teams"]).
    const { data: directory } = useQuery({
        queryKey: ["teams"],
        queryFn: teamsApi.directory,
        staleTime: 60_000,
        enabled,
    });

    return useMemo(() => {
        const teamInfo = new Map<string, TeamInfo>();
        for (const team of directory?.teams ?? []) {
            for (const member of team.members) {
                const entry = teamInfo.get(member.user.id) ?? {
                    label: "",
                    spaceIds: new Set<string>(),
                };
                entry.spaceIds.add(team.space.id);
                // The primary team wins the chip; otherwise first one seen.
                if (member.isPrimary || !entry.label) {
                    entry.label = team.space.name;
                }
                teamInfo.set(member.user.id, entry);
            }
        }

        const active = allUsers.filter((u) => u.status === "active");
        const me = active.find((u) => u.id === currentUser?.id) ?? null;

        const mySpaceIds = currentUser
            ? (teamInfo.get(currentUser.id)?.spaceIds ?? new Set<string>())
            : new Set<string>();

        // Before the directory loads, mySpaceIds is empty and everyone lands in
        // `others` — an alphabetical list, which is exactly what this looked
        // like before. It regroups the moment the fetch resolves.
        const myTeam: User[] = [];
        const others: User[] = [];
        for (const u of active) {
            const shared = [...(teamInfo.get(u.id)?.spaceIds ?? [])].some((id) =>
                mySpaceIds.has(id),
            );
            (shared ? myTeam : others).push(u);
        }
        myTeam.sort(byName);
        others.sort(byName);

        return {
            me,
            people: [...myTeam, ...others],
            myTeam,
            others,
            teamInfo,
            teamsReady: !!directory,
        };
    }, [allUsers, currentUser, directory]);
};

import type {
    TeamDirectory,
    TeamEntry,
    TeamMemberEntry,
} from "../services/TeamMembershipService";
import { toWireUser, type WireUser } from "./userSerializer";

/**
 * Team-directory wire shapes (team-access P1) — snake_case like every payload.
 *
 * Deliberately its OWN shape rather than fields bolted onto the canonical
 * `User`: a dozen tests pin that wire's exact key set, and the directory is
 * the only consumer of `is_primary` / `is_head`.
 */

export interface WireTeamMember {
    assignment_id: string;
    user: WireUser;
    role_key: string;
    role_name: string;
    is_head: boolean;
    is_primary: boolean;
}

export interface WireTeam {
    space: {
        id: string;
        name: string;
        icon: string;
        color: string;
        head_user_id: string | null;
    };
    head: WireUser | null;
    members: WireTeamMember[];
    /** Team-access P4: teams this team has been granted sight of. */
    can_also_see: { id: string; name: string }[];
}

export interface WireTeamDirectory {
    data: WireTeam[];
    unassigned: WireUser[];
}

const toWireTeamMember = (m: TeamMemberEntry): WireTeamMember => ({
    assignment_id: m.assignmentId,
    user: toWireUser(m.user),
    role_key: m.roleKey,
    role_name: m.roleName,
    is_head: m.isHead,
    is_primary: m.isPrimary,
});

const toWireTeam = (t: TeamEntry): WireTeam => ({
    space: {
        id: t.space.id,
        name: t.space.name,
        icon: t.space.icon,
        color: t.space.color,
        head_user_id: t.space.headUserId,
    },
    head: t.head ? toWireUser(t.head) : null,
    members: t.members.map(toWireTeamMember),
    can_also_see: t.canAlsoSee,
});

export const toWireTeamDirectory = (d: TeamDirectory): WireTeamDirectory => ({
    data: d.teams.map(toWireTeam),
    unassigned: d.unassigned.map(toWireUser),
});

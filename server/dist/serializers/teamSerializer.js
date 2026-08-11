"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireTeamDirectory = void 0;
const userSerializer_1 = require("./userSerializer");
const toWireTeamMember = (m) => ({
    assignment_id: m.assignmentId,
    user: (0, userSerializer_1.toWireUser)(m.user),
    role_key: m.roleKey,
    role_name: m.roleName,
    is_head: m.isHead,
    is_primary: m.isPrimary,
});
const toWireTeam = (t) => ({
    space: {
        id: t.space.id,
        name: t.space.name,
        icon: t.space.icon,
        color: t.space.color,
        head_user_id: t.space.headUserId,
    },
    head: t.head ? (0, userSerializer_1.toWireUser)(t.head) : null,
    members: t.members.map(toWireTeamMember),
});
const toWireTeamDirectory = (d) => ({
    data: d.teams.map(toWireTeam),
    unassigned: d.unassigned.map(userSerializer_1.toWireUser),
});
exports.toWireTeamDirectory = toWireTeamDirectory;

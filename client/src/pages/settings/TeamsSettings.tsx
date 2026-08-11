import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, Tag, App as AntApp, Modal, Empty, Spin } from "antd";
import { Crown, Home, UserPlus, X } from "lucide-react";
import {
    teamsApi,
    spacesApi,
    usersApi,
    type TeamEntry,
    type TeamMember,
} from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { usePermissions } from "../../hooks/usePermissions";
import { useAuthStore } from "../../stores/auth";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";
import type { User } from "../../types";

/**
 * Settings → Teams (team-access P1): the org chart made manageable.
 *
 * A team IS a Space; being on a team IS holding a space-scoped role
 * (`user_roles`) — this page is the first UI over that until-now invisible
 * structure. Per team: the head (crown), the roster, add/remove. Below: every
 * person with no home team yet, so nobody is left teamless when visibility
 * later narrows to teams (plan P6).
 *
 * Who sees the write controls mirrors the server guard exactly: admins
 * (`space.members_manage` reaches everywhere) or the team's OWN head — heads
 * manage their roster without holding any admin key.
 */

const TeamsSettings = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const { holds } = usePermissions();
    const me = useAuthStore((s) => s.user);

    const { data, isLoading } = useQuery({
        queryKey: ["teams"],
        queryFn: teamsApi.directory,
    });
    const { data: users = [] } = useQuery({
        queryKey: ["users"],
        queryFn: () => usersApi.list(),
    });

    const invalidate = () => {
        void qc.invalidateQueries({ queryKey: ["teams"] });
        void qc.invalidateQueries({ queryKey: ["users"] });
        void qc.invalidateQueries({ queryKey: ["spaces"] });
    };
    const onError = (err: unknown) => message.error(getApiErrorMessage(err));

    const addMember = useMutation({
        mutationFn: (v: { spaceId: string; userId: string }) =>
            teamsApi.addMember(v.spaceId, v.userId),
        onSuccess: () => {
            invalidate();
            message.success("Added to the team");
        },
        onError,
    });
    const removeMember = useMutation({
        mutationFn: (v: { spaceId: string; userId: string }) =>
            teamsApi.removeMember(v.spaceId, v.userId),
        onSuccess: () => {
            invalidate();
            message.success("Removed from the team");
        },
        onError,
    });
    const setHome = useMutation({
        mutationFn: (v: { userId: string; spaceId: string | null }) =>
            teamsApi.setHomeTeam(v.userId, v.spaceId),
        onSuccess: () => {
            invalidate();
            message.success("Home team set");
        },
        onError,
    });
    const setHead = useMutation({
        mutationFn: (v: { spaceId: string; userId: string | null }) =>
            spacesApi.update(v.spaceId, { headUserId: v.userId }),
        onSuccess: () => {
            invalidate();
            message.success("Team head updated");
        },
        onError,
    });

    const teams = data?.teams ?? [];
    const unassigned = data?.unassigned ?? [];
    const canSetHead = holds("space.head_assign");
    const canSetHome = holds("member.role_change");
    const canManage = (team: TeamEntry) =>
        holds("space.members_manage") || me?.id === team.space.headUserId;

    const teamOptions = teams.map((t) => ({
        value: t.space.id,
        label: t.space.name,
    }));

    if (isLoading) {
        return (
            <div style={{ padding: 48, textAlign: "center" }}>
                <Spin />
            </div>
        );
    }

    return (
        <div>
            <SettingsHeader
                title="Teams"
                description="Who belongs to which team, and who leads it. A person's team decides whose work they coordinate with."
            />

            {teams.map((team) => (
                <TeamCard
                    key={team.space.id}
                    team={team}
                    allUsers={users}
                    canManage={canManage(team)}
                    canSetHead={canSetHead}
                    onAdd={(userId) =>
                        addMember.mutate({ spaceId: team.space.id, userId })
                    }
                    onRemove={(member) =>
                        Modal.confirm({
                            title: `Remove ${member.user.firstName} from ${team.space.name}?`,
                            content:
                                "They keep their account — they just leave this team.",
                            okType: "danger",
                            okText: "Remove",
                            onOk: () =>
                                removeMember.mutate({
                                    spaceId: team.space.id,
                                    userId: member.user.id,
                                }),
                        })
                    }
                    onSetHead={(userId) =>
                        setHead.mutate({ spaceId: team.space.id, userId })
                    }
                />
            ))}

            {unassigned.length > 0 && (
                <SettingsSection
                    title="No home team yet"
                    description="These people are not assigned to any team. Pick one — they also become a member of it."
                >
                    {unassigned.map((u) => (
                        <div
                            key={u.id}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                padding: "10px 0",
                                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                            }}
                        >
                            <Avatar user={u} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <NameEmail user={u} />
                            </div>
                            {canSetHome ? (
                                <Select
                                    placeholder="Assign a team..."
                                    style={{ width: 220 }}
                                    size="small"
                                    options={teamOptions}
                                    loading={setHome.isPending}
                                    onChange={(spaceId: string) =>
                                        setHome.mutate({
                                            userId: u.id,
                                            spaceId,
                                        })
                                    }
                                    value={null}
                                />
                            ) : (
                                <Tag style={{ margin: 0 }}>unassigned</Tag>
                            )}
                        </div>
                    ))}
                </SettingsSection>
            )}

            {teams.length === 0 && (
                <SettingsSection>
                    <Empty description="No teams yet — create a Space first" />
                </SettingsSection>
            )}
        </div>
    );
};

const TeamCard = ({
    team,
    allUsers,
    canManage,
    canSetHead,
    onAdd,
    onRemove,
    onSetHead,
}: {
    team: TeamEntry;
    allUsers: User[];
    canManage: boolean;
    canSetHead: boolean;
    onAdd: (userId: string) => void;
    onRemove: (member: TeamMember) => void;
    onSetHead: (userId: string | null) => void;
}) => {
    const [adding, setAdding] = useState(false);
    const memberIds = new Set(team.members.map((m) => m.user.id));
    const addable = allUsers.filter(
        (u) => !memberIds.has(u.id) && u.status !== "deactivated",
    );
    // Server rule (space.head_invalid): a head must be active and not a guest.
    const headCandidates = allUsers.filter(
        (u) => u.status === "active" && u.role !== "guest",
    );

    return (
        <SettingsSection>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    paddingBottom: 10,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                }}
            >
                <span
                    style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: team.space.color,
                        display: "inline-block",
                        flexShrink: 0,
                    }}
                />
                <span
                    style={{
                        fontSize: tokens.typography.fontSize.md,
                        fontWeight: 700,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    {team.space.name}
                </span>
                <span
                    style={{
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                    }}
                >
                    {team.members.length}{" "}
                    {team.members.length === 1 ? "member" : "members"}
                </span>
                <span style={{ flex: 1 }} />
                <Crown
                    size={13}
                    strokeWidth={1.75}
                    color={tokens.colors.textMuted}
                />
                {canSetHead ? (
                    <Select
                        size="small"
                        style={{ width: 200 }}
                        placeholder="No head yet"
                        value={team.space.headUserId ?? undefined}
                        options={headCandidates.map((u) => ({
                            value: u.id,
                            label: `${u.firstName} ${u.lastName}`,
                        }))}
                        onChange={(userId: string) => onSetHead(userId)}
                        showSearch
                        optionFilterProp="label"
                    />
                ) : (
                    <span
                        style={{
                            fontSize: 12,
                            color: team.head
                                ? tokens.colors.textPrimary
                                : tokens.colors.textMuted,
                        }}
                    >
                        {team.head
                            ? `${team.head.firstName} ${team.head.lastName}`
                            : "No head yet"}
                    </span>
                )}
            </div>

            {team.members.map((m) => (
                <div
                    key={m.user.id}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 0",
                        borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    }}
                >
                    <Avatar user={m.user} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <NameEmail user={m.user} />
                    </div>
                    {m.isHead && (
                        <Tag
                            color="gold"
                            icon={
                                <Crown
                                    size={11}
                                    strokeWidth={1.75}
                                    style={{ marginRight: 4 }}
                                />
                            }
                            style={{
                                margin: 0,
                                display: "inline-flex",
                                alignItems: "center",
                            }}
                        >
                            Head
                        </Tag>
                    )}
                    {m.isPrimary && (
                        <Tag
                            icon={
                                <Home
                                    size={11}
                                    strokeWidth={1.75}
                                    style={{ marginRight: 4 }}
                                />
                            }
                            style={{
                                margin: 0,
                                display: "inline-flex",
                                alignItems: "center",
                            }}
                        >
                            Home
                        </Tag>
                    )}
                    {m.roleKey !== "member" && (
                        <Tag color="blue" style={{ margin: 0 }}>
                            {m.roleName}
                        </Tag>
                    )}
                    {canManage && !m.isHead && (
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<X size={13} strokeWidth={1.75} />}
                            onClick={() => onRemove(m)}
                        />
                    )}
                </div>
            ))}

            {team.members.length === 0 && (
                <div
                    style={{
                        padding: "12px 0",
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                    }}
                >
                    Nobody on this team yet.
                </div>
            )}

            {canManage && (
                <div style={{ paddingTop: 10 }}>
                    {adding ? (
                        <Select
                            autoFocus
                            size="small"
                            style={{ width: 260 }}
                            placeholder="Pick a person..."
                            options={addable.map((u) => ({
                                value: u.id,
                                label: `${u.firstName} ${u.lastName} (${u.email})`,
                            }))}
                            onChange={(userId: string) => {
                                onAdd(userId);
                                setAdding(false);
                            }}
                            onBlur={() => setAdding(false)}
                            showSearch
                            optionFilterProp="label"
                            open
                        />
                    ) : (
                        <Button
                            size="small"
                            icon={<UserPlus size={13} strokeWidth={1.75} />}
                            onClick={() => setAdding(true)}
                        >
                            Add member
                        </Button>
                    )}
                </div>
            )}
        </SettingsSection>
    );
};

const Avatar = ({ user }: { user: User }) => (
    <div
        style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: tokens.colors.primarySubtle,
            color: tokens.colors.primary,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: tokens.typography.fontFamilyMono,
            flexShrink: 0,
        }}
    >
        {user.firstName.charAt(0)}
        {user.lastName.charAt(0)}
    </div>
);

const NameEmail = ({ user }: { user: User }) => (
    <>
        <div
            style={{
                fontSize: tokens.typography.fontSize.sm,
                fontWeight: 600,
                color: tokens.colors.textPrimary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {user.firstName} {user.lastName}
            {user.status === "invited" && (
                <Tag color="blue" style={{ marginLeft: 8 }}>
                    invited
                </Tag>
            )}
        </div>
        <div
            style={{
                fontSize: 12,
                color: tokens.colors.textMuted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {user.email}
        </div>
    </>
);

export default TeamsSettings;

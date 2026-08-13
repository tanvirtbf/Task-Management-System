import { useMemo, useState } from "react";
import { usePermissions } from "../../hooks/usePermissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Input,
    Select,
    Tag,
    App as AntApp,
    Modal,
    Dropdown,
} from "antd";
import {
    UserPlus,
    Search,
    MoreHorizontal,
    UserX,
    UserCheck,
    Mail,
    Trash2,
} from "lucide-react";
import { usersApi, teamsApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useAuthStore } from "../../stores/auth";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";
import type { Role, User } from "../../types";

const ROLE_LABELS: Record<Role, { label: string; color: string }> = {
    owner: { label: "Owner", color: "purple" },
    admin: { label: "Admin", color: "blue" },
    member: { label: "Member", color: "default" },
    guest: { label: "Guest", color: "orange" },
};

const STATUS_COLORS: Record<User["status"], string> = {
    active: "green",
    invited: "blue",
    deactivated: "red",
};

const MembersSettings = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [query, setQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
    const [inviteOpen, setInviteOpen] = useState(false);
    const { holds } = usePermissions();
    const me = useAuthStore((s) => s.user);

    const { data: users = [] } = useQuery({
        queryKey: ["users"],
        queryFn: () => usersApi.list(),
    });

    // Team-access P1: each person's HOME team, from the /teams directory (the
    // canonical `User` wire deliberately does not carry it).
    const { data: teamsDir } = useQuery({
        queryKey: ["teams"],
        queryFn: teamsApi.directory,
    });
    const teamNameByUser = useMemo(() => {
        const map = new Map<string, string>();
        for (const t of teamsDir?.teams ?? []) {
            for (const m of t.members) {
                if (m.isPrimary) map.set(m.user.id, t.space.name);
            }
        }
        return map;
    }, [teamsDir]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return users.filter((u) => {
            if (roleFilter !== "all" && u.role !== roleFilter) return false;
            if (
                q &&
                !(
                    u.firstName.toLowerCase().includes(q) ||
                    u.lastName.toLowerCase().includes(q) ||
                    u.email.toLowerCase().includes(q)
                )
            )
                return false;
            return true;
        });
    }, [users, query, roleFilter]);

    const updateRole = useMutation({
        mutationFn: ({ id, role }: { id: string; role: Role }) =>
            usersApi.updateRole(id, role),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["users"] });
            message.success("Role updated");
        },
    });

    const deactivate = useMutation({
        mutationFn: (id: string) => usersApi.deactivate(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["users"] });
            message.success("Member deactivated");
        },
    });

    const reactivate = useMutation({
        mutationFn: (id: string) => usersApi.reactivate(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["users"] });
            message.success("Member reactivated");
        },
    });

    /**
     * PERMANENT delete — for the "added by mistake" case. The server refuses
     * the moment the person has created anything, so the flow ASKS FIRST
     * (preflight) and shows exactly what holds the row; only a person who
     * left nothing behind reaches the typed-email confirmation.
     */
    const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
    const deletePermanently = useMutation({
        mutationFn: (id: string) => usersApi.deletePermanently(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["users"] });
            qc.invalidateQueries({ queryKey: ["teams"] });
            setDeleteTarget(null);
            message.success("Member deleted permanently");
        },
        onError: (err) => message.error(getApiErrorMessage(err)),
    });

    const counts = useMemo(() => {
        const out: Record<string, number> = { all: users.length };
        users.forEach((u) => {
            out[u.role] = (out[u.role] ?? 0) + 1;
        });
        return out;
    }, [users]);

    return (
        <div>
            <SettingsHeader
                title="Members"
                description={`${users.length} members in this workspace.`}
                actions={
                    /* F26 (SCAN-M5): gated on the permission the endpoint
                       enforces — it used to render for everyone and answer
                       with a 403 toast. */
                    holds("member.invite") ? (
                        <Button
                            type="primary"
                            icon={<UserPlus size={14} strokeWidth={1.75} />}
                            onClick={() => setInviteOpen(true)}
                        >
                            Invite member
                        </Button>
                    ) : null
                }
            />

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: tokens.spacing[3],
                }}
            >
                <Input
                    prefix={
                        <Search
                            size={13}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    }
                    placeholder="Search by name or email..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ flex: 1 }}
                />
                <Select
                    value={roleFilter}
                    onChange={setRoleFilter}
                    style={{ width: 180 }}
                    options={[
                        { value: "all", label: `All (${counts.all ?? 0})` },
                        {
                            value: "owner",
                            label: `Owner (${counts.owner ?? 0})`,
                        },
                        {
                            value: "admin",
                            label: `Admin (${counts.admin ?? 0})`,
                        },
                        {
                            value: "member",
                            label: `Member (${counts.member ?? 0})`,
                        },
                        {
                            value: "guest",
                            label: `Guest (${counts.guest ?? 0})`,
                        },
                    ]}
                />
            </div>

            <SettingsSection>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto auto auto auto",
                        gap: 12,
                        alignItems: "center",
                        padding: "8px 0",
                        borderBottom: `1px solid ${tokens.colors.border}`,
                        fontSize: 11,
                        fontWeight: 700,
                        color: tokens.colors.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                    }}
                >
                    <span></span>
                    <span>Name & email</span>
                    <span>Team</span>
                    <span>Role</span>
                    <span>Status</span>
                    <span></span>
                </div>
                {filtered.map((u) => (
                    <MemberRow
                        key={u.id}
                        user={u}
                        teamName={teamNameByUser.get(u.id) ?? null}
                        onRoleChange={(role) =>
                            updateRole.mutate({ id: u.id, role })
                        }
                        onDeactivate={() => deactivate.mutate(u.id)}
                        onReactivate={() => reactivate.mutate(u.id)}
                        canDelete={
                            holds("member.deactivate") &&
                            u.role !== "owner" &&
                            u.id !== me?.id
                        }
                        onDelete={() => setDeleteTarget(u)}
                    />
                ))}
            </SettingsSection>

            {inviteOpen && (
                <InviteMemberModal onClose={() => setInviteOpen(false)} />
            )}

            {deleteTarget && (
                <DeleteMemberModal
                    user={deleteTarget}
                    busy={deletePermanently.isPending}
                    onCancel={() => setDeleteTarget(null)}
                    onConfirm={() => deletePermanently.mutate(deleteTarget.id)}
                    onDeactivateInstead={() => {
                        deactivate.mutate(deleteTarget.id);
                        setDeleteTarget(null);
                    }}
                />
            )}
        </div>
    );
};

const MemberRow = ({
    user,
    teamName,
    onRoleChange,
    onDeactivate,
    onReactivate,
    canDelete,
    onDelete,
}: {
    user: User;
    teamName: string | null;
    onRoleChange: (r: Role) => void;
    onDeactivate: () => void;
    onReactivate: () => void;
    canDelete: boolean;
    onDelete: () => void;
}) => (
    <div
        style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto auto auto auto",
            gap: 12,
            alignItems: "center",
            padding: "10px 0",
            borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
        }}
    >
        <div
            style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: tokens.colors.primarySubtle,
                color: tokens.colors.primary,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: tokens.typography.fontFamilyMono,
            }}
        >
            {user.firstName.charAt(0)}
            {user.lastName.charAt(0)}
        </div>
        <div style={{ minWidth: 0 }}>
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
        </div>
        <span
            style={{
                fontSize: 12,
                color: teamName
                    ? tokens.colors.textPrimary
                    : tokens.colors.textMuted,
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
            title={teamName ?? "No home team — assign one in Settings → Teams"}
        >
            {teamName ?? "—"}
        </span>
        <Select
            value={user.role}
            onChange={onRoleChange}
            disabled={user.role === "owner"}
            size="small"
            style={{ width: 110 }}
            options={(["admin", "member", "guest"] as Role[]).map((r) => ({
                value: r,
                label: ROLE_LABELS[r].label,
            }))}
        />
        <Tag color={STATUS_COLORS[user.status]} style={{ margin: 0 }}>
            {user.status}
        </Tag>
        <Dropdown
            menu={{
                items: [
                    {
                        key: "email",
                        icon: <Mail size={13} strokeWidth={1.75} />,
                        label: "Send email",
                        // Open Gmail's compose window addressed to the member. A plain
                        // `mailto:` only works when the OS has a default desktop mail
                        // app configured — webmail (Gmail) users just get a blank tab.
                        // This opens a real compose window for a Gmail/Workspace org.
                        onClick: () =>
                            window.open(
                                `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
                                    user.email,
                                )}`,
                                "_blank",
                                "noopener",
                            ),
                    },
                    { type: "divider" as const },
                    user.status === "deactivated"
                        ? {
                              key: "reactivate",
                              icon: (
                                  <UserCheck size={13} strokeWidth={1.75} />
                              ),
                              label: "Reactivate",
                              onClick: onReactivate,
                          }
                        : {
                              key: "deactivate",
                              icon: <UserX size={13} strokeWidth={1.75} />,
                              label: "Deactivate",
                              danger: true,
                              disabled: user.role === "owner",
                              onClick: () => {
                                  Modal.confirm({
                                      title: `Deactivate ${user.firstName}?`,
                                      content:
                                          "They will lose access to the workspace until reactivated.",
                                      okType: "danger",
                                      onOk: onDeactivate,
                                  });
                              },
                          },
                    // Permanent delete — for someone added by mistake. Hidden
                    // for the owner and for yourself (the server refuses both
                    // anyway); the modal checks what they'd take with them.
                    ...(canDelete
                        ? [
                              { type: "divider" as const },
                              {
                                  key: "delete",
                                  icon: (
                                      <Trash2 size={13} strokeWidth={1.75} />
                                  ),
                                  label: "Delete permanently",
                                  danger: true,
                                  onClick: onDelete,
                              },
                          ]
                        : []),
                ].filter(Boolean),
            }}
            trigger={["click"]}
        >
            <Button
                size="small"
                type="text"
                icon={<MoreHorizontal size={14} strokeWidth={1.75} />}
            />
        </Dropdown>
    </div>
);

/** "3 tasks created" — the blocker kinds, in words. */
const BLOCKER_LABELS: Record<string, string> = {
    tasks_created: "task",
    comments: "comment",
    attachments: "attachment",
    lists_created: "list",
    spaces_created: "space",
    custom_fields: "custom field",
    forms: "form",
    templates: "template",
    task_dependencies: "task dependency",
    reviews_given: "review",
    on_call_shifts: "on-call shift",
    invitations_sent: "invitation sent",
};
const blockerText = (kind: string, count: number): string => {
    const word = BLOCKER_LABELS[kind] ?? kind.replace(/_/g, " ");
    return `${count} ${word}${count === 1 ? "" : "s"}`;
};

/**
 * The irreversible one. It ASKS THE SERVER FIRST (`deletion-preflight`) and
 * only offers the delete when the person has left nothing behind — the
 * "added by mistake" case. Anyone who has already done work gets the list of
 * what holds them plus the Deactivate button instead, so the destructive
 * button is never the one that teaches you it was the wrong choice.
 */
const DeleteMemberModal = ({
    user,
    busy,
    onCancel,
    onConfirm,
    onDeactivateInstead,
}: {
    user: User;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    onDeactivateInstead: () => void;
}) => {
    const [typed, setTyped] = useState("");
    const { data, isLoading, isError } = useQuery({
        queryKey: ["user-deletion-preflight", user.id],
        queryFn: () => usersApi.deletionPreflight(user.id),
    });

    const name = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const deletable = data?.deletable ?? false;
    const blockers = data?.blockers ?? [];

    return (
        <Modal
            open
            title={`Delete ${name} permanently?`}
            onCancel={onCancel}
            destroyOnHidden
            footer={
                isLoading || isError
                    ? [
                          <Button key="close" onClick={onCancel}>
                              Close
                          </Button>,
                      ]
                    : deletable
                      ? [
                            <Button key="cancel" onClick={onCancel}>
                                Cancel
                            </Button>,
                            <Button
                                key="delete"
                                danger
                                type="primary"
                                loading={busy}
                                disabled={
                                    typed.trim().toLowerCase() !==
                                    user.email.toLowerCase()
                                }
                                onClick={onConfirm}
                            >
                                Delete permanently
                            </Button>,
                        ]
                      : [
                            <Button key="cancel" onClick={onCancel}>
                                Cancel
                            </Button>,
                            <Button
                                key="deactivate"
                                danger
                                onClick={onDeactivateInstead}
                            >
                                Deactivate instead
                            </Button>,
                        ]
            }
        >
            {isLoading ? (
                <p style={{ margin: 0 }}>Checking what this person owns…</p>
            ) : isError ? (
                <p style={{ margin: 0 }}>
                    Could not check this member right now. Please try again.
                </p>
            ) : deletable ? (
                <div style={{ display: "grid", gap: 10 }}>
                    <p style={{ margin: 0 }}>
                        This account has created nothing in the workspace, so
                        it can be removed completely. Their invitation, sessions
                        and notifications go with them.{" "}
                        <strong>This cannot be undone.</strong>
                    </p>
                    <p style={{ margin: 0 }}>
                        Type <strong>{user.email}</strong> to confirm:
                    </p>
                    <Input
                        autoFocus
                        value={typed}
                        placeholder={user.email}
                        onChange={(e) => setTyped(e.target.value)}
                    />
                </div>
            ) : (
                <div style={{ display: "grid", gap: 10 }}>
                    <p style={{ margin: 0 }}>
                        {data?.reason ??
                            "This person cannot be deleted permanently."}
                    </p>
                    {blockers.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {blockers.map((b) => (
                                <li key={b.kind}>
                                    {blockerText(b.kind, b.count)}
                                </li>
                            ))}
                        </ul>
                    )}
                    <p
                        style={{
                            margin: 0,
                            color: tokens.colors.textSecondary,
                            fontSize: 13,
                        }}
                    >
                        Deactivating keeps their work and history intact while
                        removing their access.
                    </p>
                </div>
            )}
        </Modal>
    );
};

const InviteMemberModal = ({ onClose }: { onClose: () => void }) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<Role>("member");
    // Team-access P1 (B3): required in the FORM — an invited person must have
    // a team from day one, or they arrive teamless when visibility narrows.
    const [spaceId, setSpaceId] = useState<string | null>(null);

    const { data: teamsDir } = useQuery({
        queryKey: ["teams"],
        queryFn: teamsApi.directory,
    });
    const teamOptions = (teamsDir?.teams ?? []).map((t) => ({
        value: t.space.id,
        label: t.space.name,
    }));

    const invite = useMutation({
        mutationFn: () =>
            usersApi.invite({ firstName, lastName, email, role, spaceId }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["users"] });
            qc.invalidateQueries({ queryKey: ["teams"] });
            message.success(`Invitation sent to ${email}`);
            onClose();
        },
        onError: (err) => message.error(getApiErrorMessage(err)),
    });

    const canInvite = email.trim() && firstName.trim() && spaceId;

    return (
        <Modal
            open
            title="Invite member"
            onCancel={onClose}
            onOk={() => invite.mutate()}
            okText="Send invitation"
            okButtonProps={{
                disabled: !canInvite,
                loading: invite.isPending,
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingTop: 8,
                }}
            >
                <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                        <Label>First name</Label>
                        <Input
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <Label>Last name</Label>
                        <Input
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                        />
                    </div>
                </div>
                <div>
                    <Label>Email</Label>
                    <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="teammate@example.com"
                    />
                </div>
                <div>
                    <Label>Role</Label>
                    <Select
                        value={role}
                        onChange={setRole}
                        style={{ width: "100%" }}
                        options={(
                            ["admin", "member", "guest"] as Role[]
                        ).map((r) => ({
                            value: r,
                            label: ROLE_LABELS[r].label,
                        }))}
                    />
                </div>
                <div>
                    <Label>Team</Label>
                    <Select
                        value={spaceId}
                        onChange={setSpaceId}
                        style={{ width: "100%" }}
                        placeholder="Which team are they joining?"
                        options={teamOptions}
                        showSearch
                        optionFilterProp="label"
                    />
                </div>
            </div>
        </Modal>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <label
        style={{
            display: "block",
            fontSize: 11,
            fontWeight: 600,
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
        }}
    >
        {children}
    </label>
);

export default MembersSettings;

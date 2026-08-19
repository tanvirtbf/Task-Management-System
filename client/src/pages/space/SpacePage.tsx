import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Folder, UserRound } from "lucide-react";
import { App as AntApp, Avatar, Segmented, Select } from "antd";
import { spacesApi, listsApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useUsers } from "../../hooks/useReferenceData";
import { useAuthStore } from "../../stores/auth";
import type { Space } from "../../types";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { SpaceTasksBrowser } from "../../components/views/SpaceTasksBrowser";
import { tokens } from "../../theme";

/**
 * Dept Review V1 — the department-head card (plan P7).
 *
 * Everyone sees WHO the head is; only owner/admin get the picker (a local role
 * check — the server enforces the same gate on PATCH). The picker draws from
 * the shared `useUsers()` roster (complete since the H1 cursor fix) filtered to
 * active non-guests, mirroring the server's 422 `space.head_invalid` rules.
 */
const DepartmentHeadCard = ({ space }: { space: Space }) => {
    const queryClient = useQueryClient();
    const { message } = AntApp.useApp();
    const me = useAuthStore((s) => s.user);
    const canEdit = me?.role === "owner" || me?.role === "admin";
    const { data: users = [], isLoading, isError } = useUsers();

    const setHead = useMutation({
        mutationFn: (headUserId: string | null) =>
            spacesApi.update(space.id, { headUserId }),
        onSuccess: (_space, headUserId) => {
            queryClient.invalidateQueries({ queryKey: ["spaces"] });
            queryClient.invalidateQueries({ queryKey: ["space", space.id] });
            message.success(
                headUserId
                    ? "Department head updated"
                    : "Department head removed",
            );
        },
        onError: (err) => message.error(getApiErrorMessage(err)),
    });

    const eligible = users.filter(
        (u) => u.status === "active" && u.role !== "guest",
    );
    const head = space.head;

    return (
        <div
            data-testid="dept-head-card"
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                padding: tokens.spacing[4],
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: tokens.spacing[4],
            }}
        >
            <div style={{ minWidth: 220 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: tokens.spacing[2],
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    <UserRound size={16} strokeWidth={1.75} />
                    Department head
                </div>
                <div
                    style={{
                        marginTop: 2,
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textMuted,
                    }}
                >
                    Reviews this department&apos;s completed tasks; featured in
                    its weekly HR report.
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                    flex: 1,
                    minWidth: 260,
                }}
            >
                {head ? (
                    <>
                        <Avatar
                            src={head.avatarUrl ?? undefined}
                            style={{ flexShrink: 0 }}
                        >
                            {(head.firstName?.[0] ?? "") +
                                (head.lastName?.[0] ?? "")}
                        </Avatar>
                        <div>
                            <div
                                style={{
                                    fontWeight: 600,
                                    color: tokens.colors.textPrimary,
                                }}
                            >
                                {head.firstName} {head.lastName}
                            </div>
                            <div
                                style={{
                                    fontSize: tokens.typography.fontSize.sm,
                                    color: tokens.colors.textMuted,
                                }}
                            >
                                {head.email}
                            </div>
                        </div>
                    </>
                ) : (
                    <span style={{ color: tokens.colors.textMuted }}>
                        No department head assigned.
                    </span>
                )}

                {canEdit && (
                    <Select
                        showSearch
                        allowClear
                        placeholder="Assign a head…"
                        style={{ width: 280, marginLeft: "auto" }}
                        loading={isLoading || setHead.isPending}
                        disabled={setHead.isPending}
                        value={space.headUserId ?? undefined}
                        // antd fires onChange(undefined) on clear too — one
                        // mapped mutation covers both set and clear.
                        onChange={(value?: string) =>
                            setHead.mutate(value ?? null)
                        }
                        optionFilterProp="label"
                        notFoundContent={
                            isError ? "Couldn't load members" : undefined
                        }
                        options={eligible.map((u) => ({
                            value: u.id,
                            label: `${u.firstName} ${u.lastName}`,
                        }))}
                    />
                )}
            </div>
        </div>
    );
};

const SpacePage = () => {
    const { spaceId } = useParams();
    const navigate = useNavigate();
    const [tab, setTab] = useState<"overview" | "tasks">("overview");

    const { data: space } = useQuery({
        queryKey: ["space", spaceId],
        queryFn: () => (spaceId ? spacesApi.getById(spaceId) : null),
        enabled: !!spaceId,
    });
    const { data: lists = [] } = useQuery({
        queryKey: ["lists-by-space", spaceId],
        queryFn: () =>
            spaceId ? listsApi.listBySpace(spaceId) : Promise.resolve([]),
        enabled: !!spaceId,
    });

    if (!space) {
        return (
            <div style={{ padding: tokens.spacing[8] }}>Loading space...</div>
        );
    }

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1200,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[6],
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                }}
            >
                <div
                    style={{
                        width: 48,
                        height: 48,
                        borderRadius: tokens.radius.lg,
                        background: `${space.color}1A`,
                        color: space.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <DynamicIcon
                        name={space.icon}
                        size={24}
                        strokeWidth={1.75}
                    />
                </div>
                <div>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["3xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        {space.name}
                    </h1>
                    {space.description && (
                        <p
                            style={{
                                margin: 0,
                                marginTop: 4,
                                color: tokens.colors.textSecondary,
                                fontSize: tokens.typography.fontSize.base,
                            }}
                        >
                            {space.description}
                        </p>
                    )}
                </div>
            </div>

            {/* Department head (Dept Review V1) */}
            <DepartmentHeadCard space={space} />

            {/* Lists ⇄ the space-wide task browser */}
            <Segmented
                value={tab}
                onChange={(v) => setTab(v as "overview" | "tasks")}
                options={[
                    { label: "Lists", value: "overview" },
                    { label: "All tasks", value: "tasks" },
                ]}
                style={{ alignSelf: "flex-start" }}
            />

            {tab === "tasks" ? (
                <SpaceTasksBrowser lists={lists} />
            ) : (
            <div>
                <h2
                    style={{
                        fontSize: tokens.typography.fontSize.lg,
                        fontWeight: 600,
                        margin: 0,
                        marginBottom: tokens.spacing[4],
                        color: tokens.colors.textPrimary,
                    }}
                >
                    Lists in this space
                </h2>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(280px, 1fr))",
                        gap: tokens.spacing[3],
                    }}
                >
                    {lists.map((list) => (
                        <button
                            key={list.id}
                            onClick={() =>
                                navigate(`/s/${list.spaceId}/l/${list.id}`)
                            }
                            style={{
                                textAlign: "left",
                                background: tokens.colors.bgSurface,
                                border: `1px solid ${tokens.colors.border}`,
                                borderRadius: tokens.radius.lg,
                                padding: tokens.spacing[4],
                                cursor: "pointer",
                                transition: "all var(--transition-base)",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor =
                                    tokens.colors.primary;
                                e.currentTarget.style.boxShadow =
                                    tokens.shadows.md;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor =
                                    tokens.colors.border;
                                e.currentTarget.style.boxShadow = "none";
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: tokens.spacing[2],
                                    marginBottom: tokens.spacing[2],
                                }}
                            >
                                <div
                                    style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: tokens.radius.md,
                                        background: `${list.color ?? "#94A3B8"}1A`,
                                        color: list.color ?? "#94A3B8",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <DynamicIcon
                                        name={list.icon ?? "Folder"}
                                        size={14}
                                        strokeWidth={1.75}
                                    />
                                </div>
                                <h3
                                    style={{
                                        margin: 0,
                                        fontSize: tokens.typography.fontSize.base,
                                        fontWeight: 600,
                                        color: tokens.colors.textPrimary,
                                    }}
                                >
                                    {list.name}
                                </h3>
                            </div>
                            <p
                                style={{
                                    margin: 0,
                                    fontSize: tokens.typography.fontSize.sm,
                                    color: tokens.colors.textMuted,
                                }}
                            >
                                {list.description ?? "Click to open"}
                            </p>
                        </button>
                    ))}
                    {lists.length === 0 && (
                        <div
                            style={{
                                gridColumn: "1 / -1",
                                padding: tokens.spacing[6],
                                textAlign: "center",
                                color: tokens.colors.textMuted,
                                background: tokens.colors.bgSurface,
                                border: `1px dashed ${tokens.colors.border}`,
                                borderRadius: tokens.radius.lg,
                            }}
                        >
                            <Folder
                                size={32}
                                strokeWidth={1.5}
                                style={{ marginBottom: 8 }}
                            />
                            <div>No lists in this space yet.</div>
                        </div>
                    )}
                </div>
            </div>
            )}
        </div>
    );
};

export default SpacePage;

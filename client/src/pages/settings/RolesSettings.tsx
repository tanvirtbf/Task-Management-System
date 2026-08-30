import { useMemo, useState } from "react";
import {
    App,
    Button,
    Card,
    Checkbox,
    Col,
    Empty,
    Flex,
    Input,
    Modal,
    Row,
    Segmented,
    Space as AntSpace,
    Spin,
    Tag,
    Tooltip,
    Typography,
} from "antd";
import {
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { rbacApi } from "../../http/rbac";
import { usePermissionsStore } from "../../stores/permissions";
import { usePermissions } from "../../hooks/usePermissions";
import { Forbidden } from "../../components/shared/RequirePermission";
import type { CatalogGroup, Role, RolePermission } from "../../types/rbac";

const { Title, Text, Paragraph } = Typography;

/**
 * `/settings/roles` — the permission grid (RBAC_DYNAMIC_PLAN.md P26).
 *
 * This page is the whole point of "fully dynamic": an admin creates a role,
 * ticks exactly what it may do, and chooses HOW FAR each tick reaches —
 * everywhere / only their spaces / only their own items.
 *
 * Three things it deliberately does:
 *  · shows the scope selector inline with the checkbox, because "can edit
 *    tasks" without "where" is the question every permission UI forgets to ask;
 *  · marks dangerous permissions in red, so nobody grants `role.manage` by
 *    accident while scanning a long list;
 *  · refuses to lose work — the Save button is the only way out of a dirty
 *    grid, and switching roles with unsaved changes asks first.
 */

type ScopeValue = "all" | "space" | "own";

const SCOPE_LABEL: Record<ScopeValue, string> = {
    all: "Everywhere",
    space: "Their spaces",
    own: "Own items",
};

const SCOPE_HELP: Record<ScopeValue, string> = {
    all: "Anywhere in the workspace",
    space: "Only inside the spaces this person is assigned to",
    own: "Only items they created or are assigned to",
};

const RolesSettings = () => {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const { holds, ready } = usePermissions();
    const refreshMine = usePermissionsStore((s) => s.refresh);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Map<string, ScopeValue> | null>(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");

    const rolesQ = useQuery({
        queryKey: ["rbac", "roles"],
        queryFn: rbacApi.listRoles,
        enabled: ready && holds("role.manage"),
    });
    const catalogQ = useQuery({
        queryKey: ["rbac", "catalog"],
        queryFn: rbacApi.catalog,
        enabled: ready && holds("role.manage"),
        staleTime: 60 * 60 * 1000, // the catalog only changes on deploy
    });

    // Memoised for the identity, not the cost: `?? []` mints a fresh array on
    // every render while the query is loading or errored, and `roles` is a
    // dependency of the two useMemos below — so without this they recompute
    // forever and `selected` is a new object each time.
    const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
    const selected: Role | undefined = useMemo(
        () => roles.find((r) => r.id === selectedId) ?? roles[0],
        [roles, selectedId],
    );

    // The draft mirrors the selected role until the user edits it.
    const grants = useMemo(() => {
        if (draft) return draft;
        const m = new Map<string, ScopeValue>();
        for (const p of selected?.permissions ?? []) {
            m.set(p.key, p.scope);
        }
        return m;
    }, [draft, selected]);

    const dirty = draft !== null;
    const ownerLocked = selected?.key === "owner";

    const saveMut = useMutation({
        mutationFn: async (payload: RolePermission[]) => {
            if (!selected) return [];
            return rbacApi.setPermissions(selected.id, payload);
        },
        onSuccess: async () => {
            setDraft(null);
            await queryClient.invalidateQueries({ queryKey: ["rbac", "roles"] });
            await refreshMine();
            message.success("Permissions saved");
        },
        onError: (e: unknown) => message.error(errorText(e)),
    });

    const createMut = useMutation({
        mutationFn: (name: string) => rbacApi.createRole({ name }),
        onSuccess: async (role) => {
            setCreating(false);
            setNewName("");
            setSelectedId(role.id);
            setDraft(null);
            await queryClient.invalidateQueries({ queryKey: ["rbac", "roles"] });
            message.success(`Role "${role.name}" created`);
        },
        onError: (e: unknown) => message.error(errorText(e)),
    });

    const deleteMut = useMutation({
        mutationFn: (id: string) => rbacApi.deleteRole(id),
        onSuccess: async () => {
            setSelectedId(null);
            setDraft(null);
            await queryClient.invalidateQueries({ queryKey: ["rbac", "roles"] });
            await refreshMine();
            message.success("Role deleted");
        },
        onError: (e: unknown) => message.error(errorText(e)),
    });

    if (ready && !holds("role.manage")) return <Forbidden what="role.manage" />;
    if (rolesQ.isLoading || catalogQ.isLoading || !ready) {
        return (
            <Flex justify="center" style={{ padding: 48 }}>
                <Spin />
            </Flex>
        );
    }

    const pickRole = (id: string) => {
        if (dirty) {
            modal.confirm({
                title: "Discard unsaved permission changes?",
                okText: "Discard",
                cancelText: "Keep editing",
                onOk: () => {
                    setDraft(null);
                    setSelectedId(id);
                },
            });
            return;
        }
        setSelectedId(id);
    };

    const toggle = (key: string, scopes: ScopeValue[]) => {
        const next = new Map(grants);
        if (next.has(key)) next.delete(key);
        else next.set(key, scopes.includes("all") ? "all" : scopes[0]);
        setDraft(next);
    };

    const setScope = (key: string, scope: ScopeValue) => {
        const next = new Map(grants);
        next.set(key, scope);
        setDraft(next);
    };

    const save = () => {
        saveMut.mutate(
            [...grants].map(([key, scope]) => ({ key, scope })),
        );
    };

    return (
        <div>
            <Flex justify="space-between" align="center" wrap gap={12}>
                <div>
                    <Title level={4} style={{ marginBottom: 4 }}>
                        Roles &amp; permissions
                    </Title>
                    <Text type="secondary">
                        Create roles and choose exactly what each one can do.
                        Assign them to people workspace-wide or inside a single
                        space.
                    </Text>
                </div>
                <Button type="primary" onClick={() => setCreating(true)}>
                    New role
                </Button>
            </Flex>

            <Row gutter={16} style={{ marginTop: 20 }}>
                <Col xs={24} md={7}>
                    <Card size="small" title="Roles" styles={{ body: { padding: 8 } }}>
                        {roles.map((r) => (
                            <div
                                key={r.id}
                                onClick={() => pickRole(r.id)}
                                style={{
                                    padding: "8px 10px",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                    background:
                                        selected?.id === r.id
                                            ? "rgba(79,70,229,0.10)"
                                            : undefined,
                                }}
                            >
                                <Flex justify="space-between" align="center">
                                    <AntSpace size={8}>
                                        <span
                                            style={{
                                                width: 10,
                                                height: 10,
                                                borderRadius: 10,
                                                background: r.color,
                                                display: "inline-block",
                                            }}
                                        />
                                        <span>{r.name}</span>
                                    </AntSpace>
                                    <AntSpace size={4}>
                                        {r.is_system && (
                                            <Tag color="default">built-in</Tag>
                                        )}
                                        <Tag>{r.holders}</Tag>
                                    </AntSpace>
                                </Flex>
                            </div>
                        ))}
                    </Card>
                </Col>

                <Col xs={24} md={17}>
                    {!selected ? (
                        <Empty description="No roles yet" />
                    ) : (
                        <Card
                            size="small"
                            title={
                                <Flex justify="space-between" align="center">
                                    <span>{selected.name}</span>
                                    <AntSpace>
                                        {!selected.is_system && (
                                            <Button
                                                danger
                                                size="small"
                                                onClick={() =>
                                                    modal.confirm({
                                                        title: `Delete "${selected.name}"?`,
                                                        content:
                                                            "Everyone holding this role loses the permissions it grants. This cannot be undone.",
                                                        okButtonProps: {
                                                            danger: true,
                                                        },
                                                        okText: "Delete role",
                                                        onOk: () =>
                                                            deleteMut.mutate(
                                                                selected.id,
                                                            ),
                                                    })
                                                }
                                            >
                                                Delete
                                            </Button>
                                        )}
                                        <Button
                                            type="primary"
                                            size="small"
                                            disabled={!dirty || ownerLocked}
                                            loading={saveMut.isPending}
                                            onClick={save}
                                        >
                                            Save changes
                                        </Button>
                                    </AntSpace>
                                </Flex>
                            }
                        >
                            {selected.description && (
                                <Paragraph type="secondary">
                                    {selected.description}
                                </Paragraph>
                            )}
                            {ownerLocked && (
                                <Paragraph type="warning">
                                    The Owner role always holds every permission
                                    and cannot be edited — it is the account that
                                    can never be locked out of the workspace.
                                </Paragraph>
                            )}

                            {(catalogQ.data ?? []).map((group: CatalogGroup) => (
                                <div key={group.group} style={{ marginTop: 16 }}>
                                    <Text strong>{group.label}</Text>
                                    <div style={{ marginTop: 8 }}>
                                        {group.permissions.map((p) => {
                                            const on = grants.has(p.key);
                                            const scope = grants.get(p.key);
                                            return (
                                                <Flex
                                                    key={p.key}
                                                    justify="space-between"
                                                    align="center"
                                                    gap={12}
                                                    style={{
                                                        padding: "6px 0",
                                                        borderBottom:
                                                            "1px solid rgba(0,0,0,0.05)",
                                                    }}
                                                >
                                                    <Tooltip title={p.description}>
                                                        <Checkbox
                                                            checked={on}
                                                            disabled={ownerLocked}
                                                            onChange={() =>
                                                                toggle(
                                                                    p.key,
                                                                    p.scopes,
                                                                )
                                                            }
                                                        >
                                                            <span
                                                                style={{
                                                                    color: p.dangerous
                                                                        ? "#cf1322"
                                                                        : undefined,
                                                                }}
                                                            >
                                                                {p.label}
                                                            </span>
                                                        </Checkbox>
                                                    </Tooltip>
                                                    {on && p.scopes.length > 1 && (
                                                        <Tooltip
                                                            title={
                                                                SCOPE_HELP[
                                                                    (scope ??
                                                                        "all") as ScopeValue
                                                                ]
                                                            }
                                                        >
                                                            <Segmented
                                                                size="small"
                                                                disabled={ownerLocked}
                                                                value={scope ?? "all"}
                                                                onChange={(v) =>
                                                                    setScope(
                                                                        p.key,
                                                                        v as ScopeValue,
                                                                    )
                                                                }
                                                                options={p.scopes.map(
                                                                    (sc) => ({
                                                                        label: SCOPE_LABEL[
                                                                            sc as ScopeValue
                                                                        ],
                                                                        value: sc,
                                                                    }),
                                                                )}
                                                            />
                                                        </Tooltip>
                                                    )}
                                                </Flex>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </Card>
                    )}
                </Col>
            </Row>

            <Modal
                open={creating}
                title="New role"
                okText="Create"
                confirmLoading={createMut.isPending}
                onCancel={() => setCreating(false)}
                onOk={() => newName.trim() && createMut.mutate(newName.trim())}
            >
                <Text type="secondary">
                    A new role starts with no permissions. Tick what it may do
                    after creating it.
                </Text>
                <Input
                    autoFocus
                    placeholder="e.g. Marketing Manager"
                    value={newName}
                    maxLength={80}
                    onChange={(e) => setNewName(e.target.value)}
                    onPressEnter={() =>
                        newName.trim() && createMut.mutate(newName.trim())
                    }
                    style={{ marginTop: 12 }}
                />
            </Modal>
        </div>
    );
};

/** Surface the server's message — the guards say something specific and useful. */
const errorText = (e: unknown): string => {
    const err = e as {
        response?: { data?: { error?: { message?: string } } };
        message?: string;
    };
    return (
        err?.response?.data?.error?.message ??
        err?.message ??
        "Something went wrong"
    );
};

export default RolesSettings;

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Folder, Sparkles } from "lucide-react";
import { App as AntApp, Dropdown } from "antd";
import { mockApi } from "../../lib/mock-api";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

const FESTIVALS = [
    "Eid ul-Fitr",
    "Eid ul-Adha",
    "Pohela Boishakh",
    "Durga Puja",
    "Victory Day",
    "11.11 Sale",
    "Black Friday",
];

const SpacePage = () => {
    const { spaceId } = useParams();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const user = useAuthStore((s) => s.user);

    const { data: space } = useQuery({
        queryKey: ["space", spaceId],
        queryFn: () => (spaceId ? mockApi.spaces.getById(spaceId) : null),
        enabled: !!spaceId,
    });
    const { data: lists = [] } = useQuery({
        queryKey: ["lists-by-space", spaceId],
        queryFn: () =>
            spaceId ? mockApi.lists.listBySpace(spaceId) : Promise.resolve([]),
        enabled: !!spaceId,
    });

    const campaignList = lists.find(
        (l) => l.id === "l-campaigns" || l.name.toLowerCase().includes("campaign"),
    );

    const startFestival = useMutation({
        mutationFn: (festival: string) => {
            if (!campaignList || !user) {
                throw new Error("Campaign list not found");
            }
            return mockApi.festivals.startCampaign({
                festival,
                listId: campaignList.id,
                createdBy: user.id,
            });
        },
        onSuccess: (task) => {
            qc.invalidateQueries({
                queryKey: ["tasks-by-list", campaignList?.id],
            });
            message.success(`${task.name} created with 12-step checklist`);
            if (campaignList) {
                navigate(
                    `/s/${campaignList.spaceId}/l/${campaignList.id}?task=${task.id}`,
                );
            }
        },
        onError: () => message.error("Could not start festival campaign"),
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
                {space.id === "sp-mkt" && campaignList && (
                    <div style={{ marginLeft: "auto" }}>
                        <Dropdown
                            menu={{
                                items: FESTIVALS.map((f) => ({
                                    key: f,
                                    label: f,
                                    onClick: () => startFestival.mutate(f),
                                })),
                            }}
                            trigger={["click"]}
                        >
                            <button
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "8px 14px",
                                    borderRadius: tokens.radius.md,
                                    background: tokens.colors.primary,
                                    color: "#fff",
                                    border: 0,
                                    cursor: "pointer",
                                    fontSize: tokens.typography.fontSize.sm,
                                    fontWeight: 600,
                                    boxShadow: tokens.shadows.sm,
                                }}
                                disabled={startFestival.isPending}
                            >
                                <Sparkles size={14} strokeWidth={1.75} />
                                Start festival campaign
                            </button>
                        </Dropdown>
                    </div>
                )}
            </div>

            {/* Lists grid */}
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
        </div>
    );
};

export default SpacePage;

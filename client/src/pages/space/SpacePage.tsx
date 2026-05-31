import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Folder } from "lucide-react";
import { spacesApi, listsApi } from "../../http/api";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { tokens } from "../../theme";

const SpacePage = () => {
    const { spaceId } = useParams();
    const navigate = useNavigate();

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

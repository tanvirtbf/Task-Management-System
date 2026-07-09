import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Star } from "lucide-react";
import { listsApi } from "../../http/api";
import { useUiStore } from "../../stores/ui";
import { tokens } from "../../theme";

/**
 * Renders the user's favorite lists in the sidebar.
 * Reads from useUiStore.favoriteIds, resolves each to a list, and
 * renders a list row. Toggle via the star button on each list in the tree.
 */
export const SidebarFavorites = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const favoriteIds = useUiStore((s) => s.favoriteIds);
    const toggleFavorite = useUiStore((s) => s.toggleFavorite);

    const { data: lists = [] } = useQuery({
        queryKey: ["lists"],
        queryFn: () => listsApi.listAll(),
    });

    const favorites = lists.filter((l) => favoriteIds.includes(l.id));

    if (favorites.length === 0) {
        return (
            <div
                style={{
                    padding: "4px 10px 8px",
                    fontSize: tokens.typography.fontSize.xs,
                    color: tokens.colors.textMuted,
                    lineHeight: 1.4,
                }}
            >
                Star a list to pin it here.
            </div>
        );
    }

    return (
        <div style={{ marginBottom: 4 }}>
            {favorites.map((list) => {
                const active = location.pathname.startsWith(
                    `/s/${list.spaceId}/l/${list.id}`,
                );
                return (
                    <div
                        key={list.id}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            paddingRight: 6,
                            borderRadius: tokens.radius.md,
                            background: active
                                ? tokens.colors.primarySubtle
                                : "transparent",
                        }}
                        onMouseEnter={(e) => {
                            if (!active)
                                e.currentTarget.style.background =
                                    tokens.colors.bgHover;
                        }}
                        onMouseLeave={(e) => {
                            if (!active)
                                e.currentTarget.style.background =
                                    "transparent";
                        }}
                    >
                        <button
                            onClick={() =>
                                navigate(`/s/${list.spaceId}/l/${list.id}`)
                            }
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flex: 1,
                                padding: "5px 10px",
                                background: "none",
                                border: 0,
                                cursor: "pointer",
                                color: active
                                    ? tokens.colors.primary
                                    : tokens.colors.textSecondary,
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: active ? 600 : 400,
                                textAlign: "left",
                                overflow: "hidden",
                            }}
                        >
                            <span
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background:
                                        list.color ??
                                        tokens.colors.textMuted,
                                    flexShrink: 0,
                                }}
                            />
                            <span
                                style={{
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {list.name}
                            </span>
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(list.id);
                            }}
                            aria-label="Unfavorite"
                            title="Unfavorite"
                            style={{
                                background: "none",
                                border: 0,
                                cursor: "pointer",
                                color: tokens.colors.warning,
                                padding: 4,
                                display: "inline-flex",
                            }}
                        >
                            <Star
                                size={12}
                                strokeWidth={1.75}
                                fill={tokens.colors.warning}
                            />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { spacesApi, listsApi } from "../../http/api";
import { tokens } from "../../theme";

interface BreadcrumbItem {
    label: string;
    to?: string;
}

/**
 * Resolves route params (spaceId, listId, taskId) → human-readable breadcrumb.
 */
export const Breadcrumb = () => {
    const params = useParams();
    const { spaceId, listId } = params;

    const { data: space } = useQuery({
        queryKey: ["space", spaceId],
        queryFn: () => (spaceId ? spacesApi.getById(spaceId) : null),
        enabled: !!spaceId,
    });
    const { data: list } = useQuery({
        queryKey: ["list", listId],
        queryFn: () => (listId ? listsApi.getById(listId) : null),
        enabled: !!listId,
    });

    const items: BreadcrumbItem[] = [];

    if (space) {
        items.push({ label: space.name, to: `/s/${space.id}` });
    }
    if (list) {
        items.push({
            label: list.name,
            to: `/s/${list.spaceId}/l/${list.id}`,
        });
    }

    if (items.length === 0) return null;

    return (
        <nav
            aria-label="Breadcrumb"
            style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: tokens.typography.fontSize.sm,
                color: tokens.colors.textSecondary,
                minWidth: 0,
                overflow: "hidden",
            }}
        >
            {items.map((item, idx) => (
                <span
                    key={idx}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        minWidth: 0,
                    }}
                >
                    {idx > 0 && (
                        <ChevronRight
                            size={12}
                            strokeWidth={2}
                            color={tokens.colors.textMuted}
                            style={{ flexShrink: 0 }}
                        />
                    )}
                    {item.to ? (
                        <Link
                            to={item.to}
                            style={{
                                color:
                                    idx === items.length - 1
                                        ? tokens.colors.textPrimary
                                        : tokens.colors.textSecondary,
                                fontWeight: idx === items.length - 1 ? 600 : 500,
                                textDecoration: "none",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 240,
                            }}
                        >
                            {item.label}
                        </Link>
                    ) : (
                        <span>{item.label}</span>
                    )}
                </span>
            ))}
        </nav>
    );
};

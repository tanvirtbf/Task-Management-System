import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, App as AntApp } from "antd";
import {
    FileText,
    Plus,
    ExternalLink,
    Inbox,
    Edit3,
    Copy,
} from "lucide-react";
import { formsApi } from "../../http/api";
import { useListMap } from "../../hooks/useReferenceData";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/shared/LoadingState";
import { tokens } from "../../theme";

const FormsListPage = () => {
    const navigate = useNavigate();
    const { message } = AntApp.useApp();
    const listMap = useListMap();
    const { data: forms = [], isLoading } = useQuery({
        queryKey: ["forms"],
        queryFn: () => formsApi.list(),
    });

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1100,
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: tokens.spacing[6],
                }}
            >
                <div>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["3xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Forms
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 4,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.base,
                        }}
                    >
                        Public intake forms that create tasks automatically.
                    </p>
                </div>
                <Button
                    type="primary"
                    icon={<Plus size={14} strokeWidth={2} />}
                    onClick={() => {
                        message.info(
                            "Click an existing form to open the builder (new-from-scratch flow in Phase 12 polish).",
                        );
                    }}
                >
                    New form
                </Button>
            </div>

            {isLoading ? (
                <LoadingState />
            ) : forms.length === 0 ? (
                <EmptyState
                    icon={FileText}
                    title="No forms yet"
                    description="Create a form to collect requests, complaints, or sign-ups."
                />
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(320px, 1fr))",
                        gap: tokens.spacing[4],
                    }}
                >
                    {forms.map((form) => {
                        const list = listMap.get(form.listId);
                        return (
                            <div
                                key={form.id}
                                style={{
                                    background: tokens.colors.bgSurface,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderRadius: tokens.radius.lg,
                                    padding: tokens.spacing[4],
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: tokens.spacing[3],
                                    cursor: "pointer",
                                    transition: "all var(--transition-base)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor =
                                        form.branding.primaryColor;
                                    e.currentTarget.style.boxShadow =
                                        tokens.shadows.md;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor =
                                        tokens.colors.border;
                                    e.currentTarget.style.boxShadow = "none";
                                }}
                                onClick={() => navigate(`/forms/${form.id}/edit`)}
                            >
                                {/* Top accent strip */}
                                <div
                                    style={{
                                        height: 3,
                                        background: form.branding.primaryColor,
                                        borderRadius: 999,
                                        marginBottom: 4,
                                    }}
                                />

                                <div>
                                    <h3
                                        style={{
                                            margin: 0,
                                            fontSize:
                                                tokens.typography.fontSize.base,
                                            fontWeight: 600,
                                            color: tokens.colors.textPrimary,
                                        }}
                                    >
                                        {form.title}
                                    </h3>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            marginTop: 2,
                                        }}
                                    >
                                        Submissions create tasks in{" "}
                                        <strong>{list?.name ?? "—"}</strong>
                                    </div>
                                </div>

                                {form.description && (
                                    <p
                                        style={{
                                            margin: 0,
                                            fontSize:
                                                tokens.typography.fontSize.sm,
                                            color: tokens.colors.textSecondary,
                                            lineHeight: 1.5,
                                            display: "-webkit-box",
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: "vertical",
                                            overflow: "hidden",
                                        }}
                                    >
                                        {form.description}
                                    </p>
                                )}

                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                    }}
                                >
                                    <span
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 4,
                                        }}
                                    >
                                        <FileText
                                            size={11}
                                            strokeWidth={1.75}
                                        />
                                        {form.fields.length} fields
                                    </span>
                                    <span
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 4,
                                        }}
                                    >
                                        <Inbox size={11} strokeWidth={1.75} />
                                        {form.submissionCount} submissions
                                    </span>
                                </div>

                                <div
                                    style={{
                                        display: "flex",
                                        gap: 4,
                                        marginTop: "auto",
                                        paddingTop: tokens.spacing[2],
                                        borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                                    }}
                                >
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={
                                            <Edit3
                                                size={12}
                                                strokeWidth={1.75}
                                            />
                                        }
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate(`/forms/${form.id}/edit`);
                                        }}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={
                                            <ExternalLink
                                                size={12}
                                                strokeWidth={1.75}
                                            />
                                        }
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            window.open(
                                                `/forms/${form.publicSlug}`,
                                                "_blank",
                                            );
                                        }}
                                    >
                                        Preview
                                    </Button>
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={
                                            <Copy
                                                size={12}
                                                strokeWidth={1.75}
                                            />
                                        }
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigator.clipboard.writeText(
                                                `${window.location.origin}/forms/${form.publicSlug}`,
                                            );
                                            message.success(
                                                "Public link copied",
                                            );
                                        }}
                                    >
                                        Copy link
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default FormsListPage;
